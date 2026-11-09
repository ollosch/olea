// Opt-in measurement of a large invented catalog. The disposable server seeds
// it through scripts/e2e-server.sh; run only with E2E_CATALOG_PERF=1.
import { expect, test } from './fixtures'
import type { Page } from '@playwright/test'

const enabled = process.env.E2E_CATALOG_PERF === '1'
const recordCount = Number(process.env.E2E_CATALOG_PERF_COUNT ?? 2000)
const xgeCount = Math.floor(recordCount / 7)
const phbCount = recordCount - xgeCount
const partialCount = Math.min(1000, Math.max(0, recordCount - 999))
const levelCount = Math.floor((recordCount + 7) / 10)
const pageCount = Math.ceil(recordCount / 30)

type CatalogResources = {
  count: number
  transferBytes: number
  encodedBytes: number
  decodedBytes: number
  durations: number[]
}

async function catalogResources(page: Page): Promise<CatalogResources> {
  return page.evaluate(() => {
    const entries = performance.getEntriesByType('resource')
      .filter((entry) => entry.name.includes('/api/collections/catalog/records?') && !entry.name.match(/\/records\/[^/?]+/))
      .map((entry) => entry as PerformanceResourceTiming)
    return {
      count: entries.length,
      transferBytes: entries.reduce((sum, entry) => sum + (entry.transferSize || 0), 0),
      encodedBytes: entries.reduce((sum, entry) => sum + (entry.encodedBodySize || 0), 0),
      decodedBytes: entries.reduce((sum, entry) => sum + (entry.decodedBodySize || 0), 0),
      durations: entries.map((entry) => Math.round(entry.duration * 10) / 10),
    }
  })
}

async function detailResources(page: Page): Promise<CatalogResources> {
  return page.evaluate(() => {
    const entries = performance.getEntriesByType('resource')
      .filter((entry) => /\/api\/collections\/catalog\/records\/[^/?]+/.test(entry.name))
      .map((entry) => entry as PerformanceResourceTiming)
    return {
      count: entries.length,
      transferBytes: entries.reduce((sum, entry) => sum + (entry.transferSize || 0), 0),
      encodedBytes: entries.reduce((sum, entry) => sum + (entry.encodedBodySize || 0), 0),
      decodedBytes: entries.reduce((sum, entry) => sum + (entry.decodedBodySize || 0), 0),
      durations: entries.map((entry) => Math.round(entry.duration * 10) / 10),
    }
  })
}

async function heapUsed(cdp: { send: (method: string, params?: Record<string, unknown>) => Promise<unknown> }): Promise<number> {
  await cdp.send('HeapProfiler.collectGarbage')
  const usage = await cdp.send('Runtime.getHeapUsage') as { usedSize: number }
  return usage.usedSize
}

async function searchLatency(page: Page, query: string) {
  return page.evaluate(async (value) => {
    const input = document.querySelector('#catalog-search') as HTMLInputElement
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
    const started = performance.now()
    setter.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await new Promise<void>((resolve) => {
      const check = () => {
        if (new URL(location.href).searchParams.get('q') === value) resolve()
        else requestAnimationFrame(check)
      }
      requestAnimationFrame(check)
    })
    // Two frames cover Vue's render flush; the ~33 ms frame floor is included.
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
    return {
      ms: Math.round((performance.now() - started) * 10) / 10,
      count: (document.querySelector('.catalog-count') as HTMLElement | null)?.textContent?.trim() ?? '',
    }
  }, query)
}

test('measures large-catalog load, search, transfer, detail and memory', async ({ page, context, isMobile }) => {
  test.skip(!enabled, 'Set E2E_CATALOG_PERF=1 to run the opt-in large-catalog measurement.')
  test.setTimeout(180_000)
  if (!isMobile) await page.setViewportSize({ width: 1920, height: 1080 })
  await context.addInitScript(() => {
    try { localStorage.setItem('olea.catalogSystem', 'dnd5e') } catch { /* about:blank has no storage. */ }
  })
  const cdp = await context.newCDPSession(page)
  if (isMobile) await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 })
  // Warm the app shell so the measurement isolates catalog data/work, not Vite module loading.
  await page.goto('/games')
  await expect(page.getByRole('heading', { name: 'Your games' })).toBeVisible()
  const heapBefore = await heapUsed(cdp)

  const started = Date.now()
  await page.goto('/catalog?system=dnd5e&type=spell&source=')
  await page.waitForFunction((expected) => document.querySelector('.catalog-count')?.textContent?.includes(`${expected} entries`), recordCount, { timeout: 120_000 })
  const loadMs = Date.now() - started
  const list = await catalogResources(page)
  const heapAfter = await heapUsed(cdp)

  await expect(page.locator('.catalog-row')).toHaveCount(30)
  await expect(page.locator('.catalog-row').first()).toContainText('Perf Spell 0001')
  await expect(page.locator('.catalog-pagination')).toContainText(`Page 1 of ${pageCount}`)

  const search = []
  for (const query of ['Perf Spell', 'Perf Spell 1', 'Perf Spell 1999', 'Perf Spell']) {
    search.push(await searchLatency(page, query))
  }
  expect(search.map((entry) => entry.count)).toEqual([
    `${recordCount} entries`,
    `${partialCount} entries`,
    '1 entry',
    `${recordCount} entries`,
  ])

  const detailStarted = Date.now()
  await page.locator('.catalog-row').first().click()
  await page.locator('.catalog-detail-heading h1').waitFor({ timeout: 30_000 })
  const detailMs = Date.now() - detailStarted
  const detail = await detailResources(page)

  const measurement = {
    project: isMobile ? 'phone-pixel8-4x-cpu' : 'desktop-1920',
    dataset: { records: recordCount, type: 'spell' },
    loadMs,
    list,
    heap: { before: heapBefore, after: heapAfter, delta: heapAfter - heapBefore },
    search,
    detailMs,
    detail,
  }
  console.log(`catalog-performance ${JSON.stringify(measurement)}`)

  expect(list.count).toBeGreaterThan(0)
  expect(list.decodedBytes).toBeGreaterThan(1_000_000)
  expect(loadMs).toBeLessThan(isMobile ? 15_000 : 10_000)
  expect(search.every((entry) => entry.ms < 1_000)).toBeTruthy()
  expect(detail.decodedBytes).toBeGreaterThan(0)
  expect(detail.decodedBytes).toBeLessThan(list.decodedBytes / 100)
  await expect(page.getByRole('heading', { name: 'Perf Spell 0001' })).toBeVisible()
})

test('large catalog keeps existing filter, sort, count and default semantics', async ({ page }) => {
  test.skip(!enabled, 'Set E2E_CATALOG_PERF=1 to run the opt-in large-catalog measurement.')
  test.setTimeout(60_000)
  await page.goto('/catalog?system=dnd5e&type=spell&source=')
  await expect(page.getByText(`${recordCount} entries`, { exact: true })).toBeVisible()
  await expect(page.locator('.catalog-row')).toHaveCount(30)
  await expect(page.locator('.catalog-row').first()).toContainText('Perf Spell 0001')

  await page.getByRole('button', { name: 'Next', exact: true }).click()
  await expect(page.locator('.catalog-pagination')).toContainText(`Page 2 of ${pageCount}`)
  await expect(page.locator('.catalog-row').first()).toContainText('Perf Spell 0031')

  await page.goto(`/catalog?system=dnd5e&type=spell&source=&level=3`)
  await expect(page.getByText(`${levelCount} entries`, { exact: true })).toBeVisible()
  await expect(page.locator('.catalog-row').first()).toContainText('Perf Spell 0003')

  await page.goto('/catalog?system=dnd5e&type=spell')
  await expect(page.getByText(`${phbCount} entries`, { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Remove Source filter: PHB' })).toBeVisible()

  await page.goto('/catalog?system=dnd5e&type=spell&source=XGE')
  await expect(page.getByText(`${xgeCount} entries`, { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Remove Source filter: XGE' })).toBeVisible()

  await page.goto('/catalog?system=dnd5e&type=spell&source=')
  await expect(page.getByText(`${recordCount} entries`, { exact: true })).toBeVisible()
  const search = page.getByLabel('Search by name')
  await search.fill('Perf Spell 1999')
  await expect(page.getByText('1 entry', { exact: true })).toBeVisible()
  await expect(page.locator('.catalog-row')).toContainText('Perf Spell 1999')
  await expect(page.locator('.catalog-row')).not.toContainText('Perf Spell 1998')
})
