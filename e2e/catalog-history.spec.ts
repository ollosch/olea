import { e2eApiBase, expect, test } from './fixtures'
import type { Page } from '@playwright/test'

const api = `${e2eApiBase}/api/collections`
let prefix = ''
let systemId = ''
let firstSpellId = ''
let firstSpellName = ''
const catalogIds: string[] = []

async function openAdvancedFilters(page: Page) {
  const disclosure = page.locator('.catalog-filter-disclosure')
  if (!(await disclosure.evaluate((element) => (element as HTMLDetailsElement).open))) {
    await disclosure.locator('summary').click()
  }
}

test.beforeAll(async ({ request }) => {
  const systems = await request.get(`${api}/systems/records?filter=${encodeURIComponent("(key='dnd5e')")}`)
  expect(systems.ok(), await systems.text()).toBeTruthy()
  systemId = (await systems.json()).items[0].id as string
  const key = `${Date.now()}-${Math.random().toString(36).slice(2)}`
  prefix = `Catalog State ${key}`
  const create = async (data: Record<string, unknown>) => {
    const response = await request.post(`${api}/catalog/records`, { data })
    expect(response.ok(), `catalog fixture: ${await response.text()}`).toBeTruthy()
    const record = await response.json() as { id: string }
    catalogIds.push(record.id)
    return record.id
  }
  for (let index = 1; index <= 40; index++) {
    const number = String(index).padStart(2, '0')
    const id = await create({
      system: systemId,
      type: 'spell',
      source: 'PHB',
      source_id: `${key}-spell-${number}`,
      name: `${prefix} Spell ${number}`,
      level: '1',
      school: 'Evocation',
      original_json: { entries: [`Invented catalog state spell ${number}.`] },
    })
    if (!firstSpellId) {
      firstSpellId = id
      firstSpellName = `${prefix} Spell ${number}`
    }
  }
  for (let index = 1; index <= 5; index++) {
    const number = String(index).padStart(2, '0')
    await create({
      system: systemId,
      type: 'spell',
      source: 'OTHER',
      source_id: `${key}-other-${number}`,
      name: `${prefix} Other ${number}`,
      level: '2',
      school: 'Illusion',
      original_json: { entries: [`Invented other-source spell ${number}.`] },
    })
  }
})

test.afterAll(async ({ request }) => {
  for (const id of catalogIds) {
    const response = await request.delete(`${api}/catalog/records/${id}`)
    expect(response.ok(), `catalog cleanup ${id}`).toBeTruthy()
  }
})

test('catalog context, scroll and focus survive browser and explicit returns', async ({ page }) => {
  await page.goto('/catalog?system=dnd5e&type=spell')
  await expect(page.locator('.catalog-row')).toHaveCount(30)

  const search = page.getByLabel('Search by name')
  await search.fill(prefix)
  await expect(page.getByText('40 entries', { exact: true })).toBeVisible()

  await openAdvancedFilters(page)
  const level = page.locator('.catalog-filters label').filter({ hasText: 'Level' }).locator('select')
  await level.selectOption('1')
  await page.getByRole('button', { name: 'Next', exact: true }).click()
  await expect(page.locator('.catalog-pagination')).toContainText('Page 2 of 2')
  await expect(page.locator('.catalog-row')).toHaveCount(10)
  await expect(page).toHaveURL(/page=2/)

  const last = page.locator('.catalog-row').last()
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
  await last.focus()
  await last.scrollIntoViewIfNeeded()
  const before = await page.evaluate(() => ({
    scrollY: Math.round(window.scrollY),
    focusId: (document.activeElement as HTMLElement | null)?.id ?? '',
  }))
  expect(before.scrollY).toBeGreaterThan(0)
  const clickedId = await last.getAttribute('id')

  await last.click()
  await expect(page.getByRole('heading', { name: `${prefix} Spell 40` })).toBeVisible()
  await expect(page).toHaveURL(/from=/)

  await page.goBack()
  await expect(page.locator('.catalog-row')).toHaveCount(10)
  await expect(search).toHaveValue(prefix)
  await expect(level).toHaveValue('1')
  await expect(page.locator('.catalog-pagination')).toContainText('Page 2 of 2')
  await expect(page).toHaveURL(/page=2/)
  await expect.poll(() => page.evaluate(() => Math.round(window.scrollY))).toBeGreaterThan(0)
  const restored = await page.evaluate(() => ({
    scrollY: Math.round(window.scrollY),
    focusId: (document.activeElement as HTMLElement | null)?.id ?? '',
  }))
  expect(Math.abs(restored.scrollY - before.scrollY)).toBeLessThan(80)
  expect(restored.focusId).toBe(clickedId)

  await page.goForward()
  await expect(page.getByRole('heading', { name: `${prefix} Spell 40` })).toBeVisible()
  await page.getByRole('link', { name: '← Back to catalog' }).click()
  await expect(page.locator('.catalog-row')).toHaveCount(10)
  await expect(search).toHaveValue(prefix)
  await expect(page.locator('.catalog-pagination')).toContainText('Page 2 of 2')
  await expect.poll(() => page.evaluate(() => Math.round(window.scrollY))).toBeGreaterThan(0)
  await expect.poll(() => page.evaluate(() => (document.activeElement as HTMLElement | null)?.id ?? '')).toBe(clickedId)
})

test('keeps typed search and explicit filters while a delayed response arrives', async ({ page }) => {
  const delayed = async (route: import('@playwright/test').Route) => {
    await new Promise((resolve) => setTimeout(resolve, 700))
    await route.continue()
  }
  await page.route('**/api/collections/catalog/records?*', delayed)
  try {
    await page.goto('/catalog?system=dnd5e&type=spell&source=PHB&level=1')
    await expect(page.getByText('Loading catalog…')).toBeVisible()

    const search = page.getByLabel('Search by name')
    await search.fill(prefix)
    await expect(search).toHaveValue(prefix)

    await expect(page.getByText('40 entries', { exact: true })).toBeVisible()
    await expect(search).toHaveValue(prefix)
    const level = page.locator('.catalog-filters label').filter({ hasText: 'Level' }).locator('select')
    const source = page.locator('.catalog-filters label').filter({ hasText: 'Source' }).locator('select')
    await expect(level).toHaveValue('1')
    await expect(source).toHaveValue('PHB')
    const params = new URL(await page.url()).searchParams
    expect(params.get('q')).toBe(prefix)
    expect(params.get('source')).toBe('PHB')
    expect(params.get('level')).toBe('1')
  } finally {
    await page.unroute('**/api/collections/catalog/records?*', delayed)
  }
})

test('direct catalog URLs, reload, stale state and direct detail fallback', async ({ page }) => {
  await page.goto('/games')
  await page.evaluate(() => localStorage.setItem('olea.catalogSystem', 'dnd5e'))
  await page.goto(`/catalog?system=dnd5e&type=spell&q=${encodeURIComponent(prefix)}&source=PHB&level=1&page=2`)
  await expect(page.locator('.catalog-row')).toHaveCount(10)
  await expect(page.getByLabel('Search by name')).toHaveValue(prefix)
  await expect(page.locator('.catalog-pagination')).toContainText('Page 2 of 2')

  await page.reload()
  await expect(page.locator('.catalog-row')).toHaveCount(10)
  await expect(page.getByLabel('Search by name')).toHaveValue(prefix)
  await expect(page.locator('.catalog-pagination')).toContainText('Page 2 of 2')

  await page.goto(`/catalog?system=missing-system&type=banana&q=${encodeURIComponent(prefix)}&source=PHB&level=999&page=999`)
  await expect(page.locator('.catalog-row')).toHaveCount(10)
  await expect(page.locator('.catalog-pagination')).toContainText('Page 2 of 2')
  await expect.poll(() => {
    const params = new URL(page.url()).searchParams
    return {
      system: params.get('system'),
      type: params.get('type'),
      source: params.get('source'),
      level: params.get('level'),
      page: params.get('page'),
      q: params.get('q'),
    }
  }).toEqual({ system: null, type: null, source: 'PHB', level: null, page: '2', q: prefix })

  await page.goto(`/catalog/${firstSpellId}`)
  await expect(page.getByRole('heading', { name: firstSpellName })).toBeVisible()
  await page.getByRole('link', { name: '← Back to catalog' }).click()
  await expect(page.getByRole('heading', { name: 'Catalog' })).toBeVisible()
  const fallback = new URL(await page.url()).searchParams
  expect(fallback.get('system')).toBe('dnd5e')
  expect(fallback.get('type')).toBe('spell')
})

test('typing a narrower query keeps focus and removes an impossible page', async ({ page }) => {
  await page.goto(`/catalog?system=dnd5e&type=spell&q=${encodeURIComponent(prefix)}&source=PHB&level=1&page=2`)
  await expect(page.locator('.catalog-row')).toHaveCount(10)

  const search = page.getByLabel('Search by name')
  await search.focus()
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
  await search.fill(`${prefix} Spell 01`)
  await expect(page.locator('.catalog-row')).toHaveCount(1)
  await expect(search).toHaveValue(`${prefix} Spell 01`)
  await expect(search).toBeFocused()
  await expect(page.getByText('1 entry', { exact: true })).toBeVisible()
  await expect(page).not.toHaveURL(/[?&]page=/)
})

test('a catalog response finishing after navigation does not rewrite the next screen', async ({ page }) => {
  let release: () => void = () => {}
  const gate = new Promise<void>((resolve) => { release = resolve })
  const delayed = async (route: import('@playwright/test').Route) => {
    await gate
    await route.continue()
  }
  await page.route('**/api/collections/catalog/records?*', delayed)
  try {
    await page.goto('/catalog?system=dnd5e&type=spell')
    await expect(page.getByText('Loading catalog…')).toBeVisible()
    await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name: /^Games/ }).click()
    await expect(page.getByRole('heading', { name: 'Your games' })).toBeVisible()
    release()
    await page.waitForTimeout(300)
    await expect(page).toHaveURL(/\/games$/)
    await expect(page.getByRole('heading', { name: 'Your games' })).toBeVisible()
  } finally {
    release()
    await page.unroute('**/api/collections/catalog/records?*', delayed)
  }
})

test('uses the saved system preference without adding it to the URL', async ({ page }) => {
  await page.goto('/games')
  await page.evaluate(() => localStorage.setItem('olea.catalogSystem', 'dnd5e'))
  await page.goto(`/catalog?q=${encodeURIComponent(prefix)}`)
  await expect(page.locator('.catalog-row')).toHaveCount(30)
  await expect(page.getByText('40 entries', { exact: true })).toBeVisible()
  await expect(page.locator('#catalog-system')).toHaveValue(systemId)
  expect(new URL(page.url()).searchParams.has('system')).toBe(false)
})

test('does not overwrite user scroll made while a restored catalog is loading', async ({ page }) => {
  await page.goto(`/catalog?system=dnd5e&type=spell&q=${encodeURIComponent(prefix)}`)
  await expect(page.locator('.catalog-row')).toHaveCount(30)

  const row = page.locator('.catalog-row').nth(20)
  await row.scrollIntoViewIfNeeded()
  await row.click()
  await expect(page.locator('.catalog-detail-heading h1')).toBeVisible()

  let release: () => void = () => {}
  const gate = new Promise<void>((resolve) => { release = resolve })
  const delayed = async (route: import('@playwright/test').Route) => {
    await gate
    await route.continue()
  }
  await page.route('**/api/collections/catalog/records?*', delayed)
  try {
    await page.goBack()
    await expect(page.getByText('Loading catalog…')).toBeVisible()
    await page.keyboard.press('Home')
    release()
    await expect(page.locator('.catalog-row')).toHaveCount(30)
    await expect.poll(() => page.evaluate(() => Math.round(window.scrollY))).toBeLessThan(100)
  } finally {
    release()
    await page.unroute('**/api/collections/catalog/records?*', delayed)
  }
})

test('restoration falls back to search when the saved result disappears', async ({ page, request }) => {
  const key = `${Date.now()}-${Math.random().toString(36).slice(2)}`
  const name = `${prefix} Transient ${key}`
  const created = await request.post(`${api}/catalog/records`, {
    data: {
      system: systemId,
      type: 'spell',
      source: 'PHB',
      source_id: `${key}-transient`,
      name,
      level: '1',
      school: 'Evocation',
      original_json: { entries: ['Invented transient spell.'] },
    },
  })
  expect(created.ok(), `transient catalog fixture: ${await created.text()}`).toBeTruthy()
  const recordId = (await created.json()).id as string
  try {
    await page.goto(`/catalog?system=dnd5e&type=spell&q=${encodeURIComponent(name)}`)
    await expect(page.locator('.catalog-row')).toHaveCount(1)
    const row = page.locator('.catalog-row')
    await row.focus()
    await row.click()
    await expect(page.locator('.catalog-detail-heading h1')).toHaveText(name)

    const removed = await request.delete(`${api}/catalog/records/${recordId}`)
    expect(removed.ok(), `transient catalog cleanup before return: ${await removed.text()}`).toBeTruthy()

    await page.goBack()
    await expect(page.getByText('No matching entries')).toBeVisible()
    await expect(page.getByLabel('Search by name')).toBeFocused()
    await expect(page.getByLabel('Search by name')).toHaveValue(name)
  } finally {
    await request.delete(`${api}/catalog/records/${recordId}`)
  }
})

test('a transient catalog failure keeps URL state and retry recovers', async ({ page }) => {
  let failures = 1
  const handler = async (route: import('@playwright/test').Route) => {
    if (failures-- > 0) {
      await route.abort('failed')
      return
    }
    await route.continue()
  }
  await page.route('**/api/collections/catalog/records?*', handler)
  try {
    const url = `/catalog?system=dnd5e&type=spell&q=${encodeURIComponent(prefix)}&source=PHB&level=1&page=2`
    await page.goto(url)
    await expect(page.getByText('Catalog entries could not be loaded. Check the connection and try again.')).toBeVisible()

    const failedParams = Object.fromEntries(new URL(page.url()).searchParams)
    expect(failedParams).toEqual({ system: 'dnd5e', type: 'spell', q: prefix, source: 'PHB', level: '1', page: '2' })

    await page.getByRole('button', { name: 'Try again' }).click()
    await expect(page.locator('.catalog-row')).toHaveCount(10)
    await expect(page.locator('.catalog-pagination')).toContainText('Page 2 of 2')
    await expect(page.getByLabel('Search by name')).toHaveValue(prefix)
    await expect(page.locator('.catalog-filters label').filter({ hasText: 'Source' }).locator('select')).toHaveValue('PHB')
    await expect(page.locator('.catalog-filters label').filter({ hasText: 'Level' }).locator('select')).toHaveValue('1')
    expect(Object.fromEntries(new URL(page.url()).searchParams)).toEqual({ system: 'dnd5e', type: 'spell', q: prefix, source: 'PHB', level: '1', page: '2' })
  } finally {
    await page.unroute('**/api/collections/catalog/records?*', handler)
  }
})

test('retry recovers when the initial systems request failed', async ({ page }) => {
  let failures = 1
  const handler = async (route: import('@playwright/test').Route) => {
    if (failures-- > 0) {
      await route.abort('failed')
      return
    }
    await route.continue()
  }
  await page.route('**/api/collections/systems/records?*', handler)
  try {
    await page.goto(`/catalog?system=dnd5e&type=spell&q=${encodeURIComponent(prefix)}`)
    await expect(page.getByText('Systems could not be loaded. Check the local server and try again.')).toBeVisible()

    await page.getByRole('button', { name: 'Try again' }).click()
    await expect(page.locator('.catalog-row')).toHaveCount(30)
    await expect(page.locator('#catalog-system')).toHaveValue(systemId)
    expect(Object.fromEntries(new URL(page.url()).searchParams)).toEqual({ system: 'dnd5e', type: 'spell', q: prefix })
  } finally {
    await page.unroute('**/api/collections/systems/records?*', handler)
  }
})

test('explicit catalog return keeps modified-click and new-tab behavior', async ({ page, context }) => {
  const url = `/catalog?system=dnd5e&type=spell&q=${encodeURIComponent(prefix)}&source=PHB&level=1&page=2`
  await page.goto(url)
  await expect(page.locator('.catalog-row')).toHaveCount(10)
  await page.locator('.catalog-row').last().click()
  await expect(page.locator('.catalog-detail-heading h1')).toBeVisible()
  const detailUrl = page.url()

  const back = page.getByRole('link', { name: '← Back to catalog' })
  expect(await back.getAttribute('href')).toContain('/catalog?')
  const popupPromise = context.waitForEvent('page')
  await back.click({ modifiers: ['Control'] })
  const popup = await popupPromise
  await popup.waitForLoadState('domcontentloaded')
  const popupParams = new URL(popup.url()).searchParams
  expect(new URL(popup.url()).pathname).toBe('/catalog')
  expect(popupParams.get('system')).toBe('dnd5e')
  expect(popupParams.get('q')).toBe(prefix)
  expect(popupParams.get('source')).toBe('PHB')
  expect(popupParams.get('level')).toBe('1')
  expect(popupParams.get('page')).toBe('2')

  await expect(page).toHaveURL(detailUrl)
  await expect(page.locator('.catalog-detail-heading h1')).toBeVisible()
  await popup.close()

  await back.click()
  await expect(page.locator('.catalog-row')).toHaveCount(10)
  await expect(page.locator('.catalog-pagination')).toContainText('Page 2 of 2')
})
