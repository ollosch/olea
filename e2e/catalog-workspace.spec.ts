import { e2eApiBase, expect, test } from './fixtures'
import type { Page } from '@playwright/test'

const api = `${e2eApiBase}/api/collections`
const createdIds: string[] = []
let dnd5eId = ''
let adnd2eId = ''
let prefix = ''
let twinAId = ''
let twinBId = ''

async function openAdvancedFilters(page: Page) {
  const disclosure = page.locator('.catalog-filter-disclosure')
  if (!(await disclosure.evaluate((element) => (element as HTMLDetailsElement).open))) {
    await disclosure.locator('summary').click()
  }
}

async function expectNoHorizontalOverflow(page: Page) {
  const dimensions = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    document: document.documentElement.scrollWidth,
  }))
  expect(dimensions.document).toBeLessThanOrEqual(dimensions.viewport)
}

test.beforeAll(async ({ request }) => {
  const systems = await request.get(`${api}/systems/records?sort=key`)
  expect(systems.ok(), await systems.text()).toBeTruthy()
  const items = (await systems.json()).items as Array<{ id: string; key: string }>
  dnd5eId = items.find((entry) => entry.key === 'dnd5e')?.id ?? ''
  adnd2eId = items.find((entry) => entry.key === 'adnd2e')?.id ?? ''
  expect(dnd5eId, 'the fresh database should seed the D&D 5e system').toBeTruthy()
  expect(adnd2eId, 'the fresh database should seed the AD&D 2e system').toBeTruthy()

  const key = `${Date.now()}-${Math.random().toString(36).slice(2)}`
  prefix = `Workspace ${key}`
  const create = async (data: Record<string, unknown>) => {
    const response = await request.post(`${api}/catalog/records`, { data })
    expect(response.ok(), `catalog workspace fixture: ${await response.text()}`).toBeTruthy()
    const record = await response.json() as { id: string }
    createdIds.push(record.id)
    return record.id
  }

  for (const [index, source, level, school] of [
    [1, 'PHB', '1', 'Evocation'],
    [2, 'PHB', '1', 'Illusion'],
    [3, 'PHB', '2', 'Evocation'],
    [4, 'OTHER', '1', 'Evocation'],
    [5, 'OTHER', '1', 'Illusion'],
    [6, 'OTHER', '2', 'Evocation'],
  ] as const) {
    await create({
      system: dnd5eId,
      type: 'spell',
      source,
      source_id: `${key}-spell-${index}`,
      name: `${prefix} A Spell 0${index}`,
      level,
      school,
      original_json: { entries: [`Invented workspace spell ${index}.`] },
    })
  }

  twinAId = await create({
    system: dnd5eId,
    type: 'creature',
    source: 'SYNTH-A',
    source_id: `${key}-twin-a`,
    name: `${prefix} Twin`,
    creature_type: 'beast',
    challenge_rating: '1/2',
    original_json: { fluff: { entries: ['Twin A source text.'] }, hp: { average: 8, formula: '2d8' } },
    alternate_description: 'Twin A at-table text.',
    notes: 'Twin A notes.',
  })
  twinBId = await create({
    system: dnd5eId,
    type: 'creature',
    source: 'SYNTH-B',
    source_id: `${key}-twin-b`,
    name: `${prefix} Twin`,
    creature_type: 'construct',
    challenge_rating: '1',
    original_json: { fluff: { entries: ['Twin B source text.'] }, hp: { average: 10, formula: '2d8+2' } },
    alternate_description: 'Twin B at-table text.',
    notes: '',
  })

  for (const [index, book, level, school, sphere] of [
    [1, 'Book One', '1', 'Illusion', 'Time'],
    [2, 'Book One', '2', 'Evocation', 'Charm'],
    [3, 'Book Two', '1', 'Illusion', 'Time'],
    [4, 'Book Two', '2', 'Evocation', 'Charm'],
  ] as const) {
    await create({
      system: adnd2eId,
      type: 'spell',
      source: 'ADND-WIKI',
      source_id: `${key}-adnd-spell-${index}`,
      name: `${prefix} ADnD Spell 0${index}`,
      level,
      school,
      sphere,
      book_source: book,
      original_json: {
        format: 'adnd2e-wikitext',
        fields: { source: book, level, school, sphere, range: '10 feet' },
        body: `Invented AD&D spell text ${index}.`,
      },
    })
  }

  for (const [source, sourceId] of [['ADND-WIKI', 'wiki'], ['ADND-COMPENDIUM', 'compendium']] as const) {
    await create({
      system: adnd2eId,
      type: 'spell',
      source,
      source_id: `${key}-adnd-twin-${sourceId}`,
      name: `${prefix} ADnD Twin Spell`,
      level: '3',
      school: 'Alteration',
      sphere: 'All',
      book_source: 'Book One',
      original_json: {
        format: 'adnd2e-wikitext',
        fields: { source: 'Book One', level: '3', school: 'Alteration', sphere: 'All' },
        body: `Invented twin source text from ${source}.`,
      },
    })
  }

  await create({
    system: adnd2eId,
    type: 'creature',
    source: 'ADND-COMPENDIUM',
    source_id: `${key}-adnd-ooze`,
    name: `${prefix} ADnD Ooze`,
    book_source: 'Book One',
    original_json: {
      format: 'adnd2e-html',
      html: '<span class="interweave"><p>Invented ooze text.</p></span>',
      stats: { 'Hit Dice': '4+2' },
    },
  })
})

test.afterAll(async ({ request }) => {
  for (const id of createdIds) {
    const response = await request.delete(`${api}/catalog/records/${id}`)
    expect(response.ok(), `catalog workspace cleanup ${id}`).toBeTruthy()
  }
})

test('search, default filters, applied chips and clear actions stay usable', async ({ page, isMobile }) => {
  await page.goto('/catalog')
  await page.evaluate(() => localStorage.setItem('olea.catalogSystem', 'dnd5e'))
  await page.goto(`/catalog?system=dnd5e&type=spell&q=${encodeURIComponent(prefix)}`)
  await expect(page.getByText('3 entries', { exact: true })).toBeVisible()
  await expectNoHorizontalOverflow(page)

  await expect(page.locator('.catalog-row')).toHaveCount(3)
  await expect(page.locator('.catalog-row-source')).toHaveText(['PHB', 'PHB', 'PHB'])
  await expect(page.getByRole('button', { name: 'Remove Source filter: PHB' })).toBeVisible()

  const search = page.getByLabel('Search by name')
  await search.focus()
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
  if (!isMobile) {
    const box = await search.boundingBox()
    const viewport = page.viewportSize()
    expect(box).not.toBeNull()
    expect(viewport).not.toBeNull()
    expect(box!.y).toBeGreaterThanOrEqual(0)
    expect(box!.y + box!.height).toBeLessThanOrEqual(viewport!.height + 1)
  }

  await search.fill(`${prefix} A Spell 01`)
  await expect(page.locator('.catalog-row')).toHaveCount(1)
  await expect(search).toBeFocused()

  await search.fill(`${prefix} Missing`)
  await expect(page.getByText('No matching entries')).toBeVisible()
  await page.getByRole('button', { name: 'Clear search and filters' }).click()
  await expect(search).toHaveValue('')
  await expect(page.getByText('6 entries', { exact: true })).toBeVisible()
  await expect(page.locator('.catalog-filter-chip')).toHaveCount(0)

  await openAdvancedFilters(page)
  const source = page.locator('.catalog-filters label').filter({ hasText: 'Source' }).locator('select')
  await source.selectOption('OTHER')
  await expect(page.getByText('3 entries', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Remove Source filter: OTHER' })).toBeVisible()
  expect(new URL(page.url()).searchParams.get('source')).toBe('OTHER')

  await page.getByRole('button', { name: 'Remove Source filter: OTHER' }).click()
  await expect(page.getByText('6 entries', { exact: true })).toBeVisible()
  expect(new URL(page.url()).searchParams.get('source')).toBe('')

  await source.selectOption('PHB')
  const level = page.locator('.catalog-filters label').filter({ hasText: 'Level' }).locator('select')
  await level.selectOption('2')
  await expect(page.getByText('1 entry', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Remove Level filter: 2' })).toBeVisible()

  await page.getByRole('button', { name: 'Clear filters' }).click()
  await expect(page.getByText('6 entries', { exact: true })).toBeVisible()
  await expect(page.locator('.catalog-filter-chip')).toHaveCount(0)
  await expectNoHorizontalOverflow(page)
})

test('same-name records keep source context and edits target only the opened record', async ({ page, request }) => {
  await page.goto(`/catalog?system=dnd5e&type=creature&q=${encodeURIComponent(`${prefix} Twin`)}`)
  await expect(page.locator('.catalog-row')).toHaveCount(2)
  await expectNoHorizontalOverflow(page)

  const rows = page.locator('.catalog-row')
  const twinA = rows.filter({ hasText: 'SYNTH-A' })
  const twinB = rows.filter({ hasText: 'SYNTH-B' })
  await expect(twinA).toHaveCount(1)
  await expect(twinB).toHaveCount(1)
  await expect(twinA.locator('.catalog-row-source')).toHaveText('SYNTH-A')
  await expect(twinB.locator('.catalog-row-source')).toHaveText('SYNTH-B')

  await twinB.focus()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('heading', { name: `${prefix} Twin` })).toBeVisible()
  await expect(page).toHaveURL(new RegExp(twinBId))
  await expect(page.locator('.catalog-source')).toContainText('SYNTH-B')
  await expectNoHorizontalOverflow(page)

  const preferred = page.locator('.catalog-preferred-panel')
  const original = page.locator('.catalog-original-panel')
  await expect(preferred).toContainText('Twin B at-table text.')
  await expect(preferred).not.toContainText('Twin A at-table text.')
  await expect(original.locator('.catalog-original-body')).toBeHidden()
  await original.locator('summary').click()
  await expect(original.locator('.catalog-original-body')).toContainText('Twin B source text.')
  await expect(original).not.toContainText('Twin A source text.')

  await page.getByRole('button', { name: 'Edit at-table description' }).click()
  await page.getByLabel('At-table description', { exact: true }).fill('Twin B revised at the table.')
  await page.getByRole('button', { name: 'Save description' }).click()
  await expect(preferred).toContainText('Twin B revised at the table.')

  await page.getByRole('button', { name: /^(Add|Edit) notes$/ }).click()
  await page.getByLabel('Notes', { exact: true }).fill('Twin B revised notes.')
  await page.getByRole('button', { name: 'Save notes' }).click()
  await expect(page.locator('.catalog-notes')).toHaveText('Twin B revised notes.')

  const savedB = await (await request.get(`${api}/catalog/records/${twinBId}`)).json()
  expect(savedB.alternate_description).toBe('Twin B revised at the table.')
  expect(savedB.notes).toBe('Twin B revised notes.')
  const savedA = await (await request.get(`${api}/catalog/records/${twinAId}`)).json()
  expect(savedA.alternate_description).toBe('Twin A at-table text.')
  expect(savedA.notes).toBe('Twin A notes.')

  await page.getByRole('link', { name: '← Back to catalog' }).click()
  await expect(page.locator('.catalog-row')).toHaveCount(2)
  await expect(page.getByLabel('Search by name')).toHaveValue(`${prefix} Twin`)
})

test('AD&D same-name same-book records stay distinguishable by import source', async ({ page }) => {
  const name = `${prefix} ADnD Twin Spell`
  await page.goto(`/catalog?system=adnd2e&type=spell&q=${encodeURIComponent(name)}`)
  await expect(page.locator('.catalog-row')).toHaveCount(2)
  await expectNoHorizontalOverflow(page)

  const labels = await page.locator('.catalog-row-source').allTextContents()
  expect(labels.sort()).toEqual(['Book One · ADND-COMPENDIUM', 'Book One · ADND-WIKI'].sort())
  await expect(page.locator('.catalog-row').filter({ hasText: 'ADND-WIKI' })).toHaveCount(1)
  await expect(page.locator('.catalog-row').filter({ hasText: 'ADND-COMPENDIUM' })).toHaveCount(1)

  await page.locator('.catalog-row').filter({ hasText: 'ADND-COMPENDIUM' }).click()
  await expect(page.getByRole('heading', { name })).toBeVisible()
  await expect(page.locator('.catalog-source-chip')).toHaveText('Book One · ADND-COMPENDIUM')
  await expect(page.locator('.catalog-source')).toContainText('Book One')
  await expect(page.locator('.catalog-source')).toContainText('ADND-COMPENDIUM')
  await expect(page.locator('.catalog-preferred-panel')).toContainText('Invented twin source text from ADND-COMPENDIUM.')
  await expectNoHorizontalOverflow(page)
})

test('AD&D book filters, source labels and detail fields keep their semantics', async ({ page }) => {
  await page.goto(`/catalog?system=adnd2e&type=spell&q=${encodeURIComponent(`${prefix} ADnD Spell`)}`)
  await expect(page.locator('.catalog-row')).toHaveCount(4)
  await expectNoHorizontalOverflow(page)
  await expect(page.locator('.catalog-row').filter({ hasText: 'Book One' }).first()).toBeVisible()

  await openAdvancedFilters(page)
  const book = page.locator('.catalog-filters label').filter({ hasText: 'Source book' }).locator('select')
  await book.selectOption('Book One')
  await expect(page.getByText('2 entries', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Remove Source book filter: Book One' })).toBeVisible()

  const level = page.locator('.catalog-filters label').filter({ hasText: 'Level' }).locator('select')
  await level.selectOption('1')
  await expect(page.getByText('1 entry', { exact: true })).toBeVisible()

  await page.getByRole('button', { name: 'Clear filters' }).click()
  await expect(page.getByText('4 entries', { exact: true })).toBeVisible()

  await page.goto(`/catalog?system=adnd2e&type=creature&q=${encodeURIComponent(`${prefix} ADnD Ooze`)}`)
  await expect(page.locator('.catalog-row')).toHaveCount(1)
  await page.locator('.catalog-row').click()
  await expect(page.getByRole('heading', { name: `${prefix} ADnD Ooze` })).toBeVisible()
  await expect(page.locator('.catalog-source')).toContainText('Book One')
  await expect(page.locator('.catalog-stats')).toContainText('HP roll')
  await expect(page.locator('.catalog-stats')).toContainText('4d8+2')
  await expect(page.locator('.catalog-preferred-panel')).toContainText('Invented ooze text.')
  await expectNoHorizontalOverflow(page)
})
