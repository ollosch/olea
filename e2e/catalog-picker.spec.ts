import { e2eApiBase, expect, test } from './fixtures'
import type { Locator, Page } from '@playwright/test'

const api = `${e2eApiBase}/api/collections`
const key = `${Date.now()}-${Math.random().toString(36).slice(2)}`
const prefix = `Picker ${key}`
const catalogIds: string[] = []
let systemId = ''
let gameId = ''
let characterId = ''
let inventoryId = ''
let spellbookId = ''
let encounterId = ''
let tableId = ''
let itemName = ''
let writeItemName = ''
let uncertainItemName = ''
let serverErrorItemName = ''
let newSpellName = ''
let failedSpellName = ''
let takenSpellName = ''
let creatureName = ''

async function openFilters(page: Page) {
  const dialog = page.locator('.picker-dialog')
  const disclosure = dialog.locator('.catalog-filter-disclosure')
  if (!(await disclosure.evaluate((element) => (element as HTMLDetailsElement).open))) {
    await disclosure.locator('summary').click()
  }
}

function searchField(page: Page) {
  return page.locator('.picker-dialog').getByRole('searchbox')
}

async function scrollY(page: Page) {
  return page.evaluate(() => Math.round(window.scrollY))
}

async function doubleClick(locator: Locator) {
  await locator.evaluate((element) => {
    const button = element as HTMLButtonElement
    button.click()
    button.click()
  })
}

const wait = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds))

test.beforeAll(async ({ request }) => {
  const systems = await request.get(`${api}/systems/records?filter=${encodeURIComponent("(key='dnd5e')")}`)
  expect(systems.ok(), await systems.text()).toBeTruthy()
  systemId = (await systems.json()).items[0].id as string

  const create = async (collection: string, data: Record<string, unknown>) => {
    const response = await request.post(`${api}/${collection}/records`, { data })
    expect(response.ok(), `${collection} fixture: ${await response.text()}`).toBeTruthy()
    const record = await response.json() as { id: string }
    return record.id
  }

  gameId = await create('games', {
    name: `${prefix} Game`,
    system: systemId,
    encounter_visible: true,
    encounter_show_initiative: true,
    encounter_show_enemy_names: true,
    encounter_show_hp: true,
    encounter_show_conditions: true,
  })
  characterId = await create('characters', { game: gameId, name: `${prefix} Ranger` })
  inventoryId = await create('inventories', { game: gameId, character: characterId })
  spellbookId = await create('spellbooks', { character: characterId, name: `${prefix} Book` })
  encounterId = await create('encounters', { game: gameId, name: `${prefix} Encounter` })

  const createCatalog = async (data: Record<string, unknown>) => {
    const id = await create('catalog', { system: systemId, source: 'PHB', ...data })
    catalogIds.push(id)
    return id
  }

  itemName = `${prefix} Rope`
  await createCatalog({
    type: 'item',
    source_id: `${key}-rope`,
    name: itemName,
    item_type: 'G',
    item_weight: 5,
    item_value: 1,
    original_json: { entries: ['Invented rope used by the picker test.'] },
    alternate_description: '',
    notes: '',
  })
  writeItemName = `${prefix} Lantern`
  await createCatalog({
    type: 'item',
    source_id: `${key}-lantern`,
    name: writeItemName,
    item_type: 'G',
    item_weight: 2,
    item_value: 5,
    original_json: { entries: ['Invented lantern used by the write test.'] },
    alternate_description: '',
    notes: '',
  })
  uncertainItemName = `${prefix} Uncertain Compass`
  await createCatalog({
    type: 'item',
    source_id: `${key}-compass`,
    name: uncertainItemName,
    item_type: 'G',
    item_weight: 1,
    item_value: 10,
    original_json: { entries: ['Invented compass used by the uncertain-write test.'] },
    alternate_description: '',
    notes: '',
  })
  serverErrorItemName = `${prefix} Server Error Torch`
  await createCatalog({
    type: 'item',
    source_id: `${key}-server-error-torch`,
    name: serverErrorItemName,
    item_type: 'G',
    item_weight: 1,
    item_value: 1,
    original_json: { entries: ['Invented torch used by the committed-500 test.'] },
    alternate_description: '',
    notes: '',
  })
  takenSpellName = `${prefix} Known Spell`
  const takenSpellId = await createCatalog({
    type: 'spell',
    source_id: `${key}-known-spell`,
    name: takenSpellName,
    level: '1',
    school: 'Evocation',
    original_json: { entries: ['An invented spell already in the book.'] },
    alternate_description: '',
    notes: '',
  })
  newSpellName = `${prefix} New Spell`
  await createCatalog({
    type: 'spell',
    source_id: `${key}-new-spell`,
    name: newSpellName,
    level: '2',
    school: 'Illusion',
    original_json: { entries: ['An invented spell not yet in the book.'] },
    alternate_description: '',
    notes: '',
  })
  failedSpellName = `${prefix} Unstable Spell`
  await createCatalog({
    type: 'spell',
    source_id: `${key}-failed-spell`,
    name: failedSpellName,
    level: '3',
    school: 'Abjuration',
    original_json: { entries: ['An invented spell used to test a failed create.'] },
    alternate_description: '',
    notes: '',
  })
  creatureName = `${prefix} Owl`
  await createCatalog({
    type: 'creature',
    source_id: `${key}-owl`,
    name: creatureName,
    creature_type: 'beast',
    challenge_rating: '0',
    original_json: { hp: { average: 1, formula: '1d4' }, fluff: { entries: ['An invented owl.'] } },
    alternate_description: '',
    notes: '',
  })
  for (const [source, suffix] of [['SYNTH-A', 'a'], ['SYNTH-B', 'b']] as const) {
    catalogIds.push(await create('catalog', {
      system: systemId,
      type: 'item',
      source,
      source_id: `${key}-twin-${suffix}`,
      name: `${prefix} Twin Item`,
      item_type: 'P',
      original_json: { entries: [`Invented twin item from ${source}.`] },
      alternate_description: '',
      notes: '',
    }))
  }
  await create('spellbook_spells', { spellbook: spellbookId, spell: takenSpellId })
  const tableResponse = await request.post(`${e2eApiBase}/api/olea/tables/save`, {
    data: {
      game: gameId,
      id: '',
      table: {
        name: `${prefix} Table`,
        dice: '1d6',
        entries: [{ min: 1, max: 6, text: 'A reference roll.', type: '', ref: '' }],
      },
    },
  })
  expect(tableResponse.ok(), `random table fixture: ${await tableResponse.text()}`).toBeTruthy()
  tableId = (await tableResponse.json()).id as string
  for (let index = 1; index <= 24; index++) {
    await create('inventory_items', {
      inventory: inventoryId,
      name: `${prefix} Filler ${String(index).padStart(2, '0')}`,
      quantity: 1,
      weight: 0,
      weight_known: true,
      is_container: false,
    })
  }
})

test.afterAll(async ({ request }) => {
  const remove = async (collection: string, id: string) => {
    const response = await request.delete(`${api}/${collection}/records/${id}`)
    expect(response.ok(), `${collection} cleanup ${id}: ${await response.text()}`).toBeTruthy()
  }
  if (tableId) {
    const response = await request.post(`${e2eApiBase}/api/olea/tables/delete`, { data: { game: gameId, id: tableId } })
    expect(response.ok(), `random table cleanup: ${await response.text()}`).toBeTruthy()
  }
  if (encounterId) await remove('encounters', encounterId)
  if (inventoryId) {
    const items = await request.get(`${api}/inventory_items/records?filter=${encodeURIComponent(`inventory='${inventoryId}'`)}`)
    for (const item of (await items.json()).items as Array<{ id: string }>) await remove('inventory_items', item.id)
    await remove('inventories', inventoryId)
  }
  if (spellbookId) {
    const spells = await request.get(`${api}/spellbook_spells/records?filter=${encodeURIComponent(`spellbook='${spellbookId}'`)}`)
    for (const entry of (await spells.json()).items as Array<{ id: string }>) await remove('spellbook_spells', entry.id)
    await remove('spellbooks', spellbookId)
  }
  if (characterId) await remove('characters', characterId)
  if (gameId) await remove('games', gameId)
  for (const id of catalogIds) await remove('catalog', id)
})

test('item picker keeps typed input and touched filters during a delayed catalog load', async ({ page }) => {
  await page.goto(`/characters/${characterId}/inventory`)
  await expect(page.getByRole('heading', { name: `${prefix} Ranger’s items` })).toBeVisible()
  const invoker = page.getByRole('button', { name: '＋ Add catalog item' }).first()
  await invoker.scrollIntoViewIfNeeded()
  const before = await scrollY(page)

  await page.route('**/api/collections/catalog/records**', async (route) => {
    await wait(600)
    await route.continue()
  })
  await invoker.click()
  const dialog = page.getByRole('dialog', { name: 'Choose an item' })
  await expect(dialog).toBeVisible()
  const search = searchField(page)
  await expect(search).toBeFocused()
  await expect(dialog.getByText('Searching catalog…')).toBeVisible()

  await search.fill(`${prefix} Twin Item`)
  await openFilters(page)
  const source = dialog.locator('.catalog-filters label').filter({ hasText: 'Source' }).locator('select')
  await source.selectOption('')
  await expect(dialog.locator('.picker-result')).toHaveCount(2)
  await expect(source).toHaveValue('')
  await expect(search).toHaveValue(`${prefix} Twin Item`)
  await expect(dialog.locator('.picker-result').filter({ hasText: 'SYNTH-A' })).toHaveCount(1)
  await expect(dialog.locator('.picker-result').filter({ hasText: 'SYNTH-B' })).toHaveCount(1)

  await page.unroute('**/api/collections/catalog/records**')
  await dialog.getByRole('button', { name: 'Close catalog picker' }).click()
  await expect(dialog).toBeHidden()
  await expect(invoker).toBeFocused()
  expect(await scrollY(page)).toBe(before)
})

test('item picker retries, filters by source, selects and restores its trigger', async ({ page }) => {
  await page.goto(`/characters/${characterId}/inventory`)
  await expect(page.getByRole('heading', { name: `${prefix} Ranger’s items` })).toBeVisible()

  const invoker = page.getByRole('button', { name: '＋ Add catalog item' }).first()
  await invoker.scrollIntoViewIfNeeded()
  const before = await scrollY(page)
  await page.route('**/api/collections/catalog/records**', (route) => route.abort())
  await invoker.click()
  const dialog = page.getByRole('dialog', { name: 'Choose an item' })
  await expect(dialog).toBeVisible()
  const search = searchField(page)
  await expect(search).toBeFocused()
  const searchId = await search.getAttribute('id')
  expect(searchId).not.toBe('item-search')
  expect(searchId).toMatch(/^catalog-picker-search-/)
  await expect(dialog.getByText('Catalog entries could not be loaded. Check the connection and try again.')).toBeVisible()

  await page.unroute('**/api/collections/catalog/records**')
  await dialog.getByRole('button', { name: 'Retry' }).click()
  await expect(dialog.locator('.picker-result').first()).toBeVisible()
  await expect(search).toBeFocused()

  await openFilters(page)
  const source = dialog.locator('.catalog-filters label').filter({ hasText: 'Source' }).locator('select')
  await source.selectOption('')
  await search.fill(`${prefix} Twin Item`)
  await expect(dialog.locator('.picker-result')).toHaveCount(2)
  await expect(dialog.locator('.picker-result').filter({ hasText: 'SYNTH-A' })).toHaveCount(1)
  await expect(dialog.locator('.picker-result').filter({ hasText: 'SYNTH-B' })).toHaveCount(1)

  await search.fill(itemName)
  await expect(dialog.locator('.picker-result')).toHaveCount(1)
  await dialog.locator('.picker-result').click()
  await expect(dialog).toBeHidden()
  await expect(invoker).toBeFocused()
  await expect(page.locator('.inventory-row').filter({ hasText: itemName })).toBeVisible()
  expect(await scrollY(page)).toBe(before)
  const geometry = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    document: document.documentElement.scrollWidth,
  }))
  expect(geometry.document).toBeLessThanOrEqual(geometry.viewport)
})

test('item picker blocks double writes and cannot duplicate a completed add on refresh retry', async ({ page }) => {
  await page.goto(`/characters/${characterId}/inventory`)
  await expect(page.getByRole('heading', { name: `${prefix} Ranger’s items` })).toBeVisible()
  const invoker = page.getByRole('button', { name: '＋ Add catalog item' }).first()

  await page.route('**/api/collections/inventory_items/records**', async (route) => {
    if (route.request().method() === 'POST') await wait(500)
    await route.continue()
  })
  await invoker.click()
  const dialog = page.getByRole('dialog', { name: 'Choose an item' })
  await expect(dialog).toBeVisible()
  const search = searchField(page)
  await search.fill(writeItemName)
  const result = dialog.locator('.picker-result')
  await expect(result).toHaveCount(1)
  await doubleClick(result)
  await expect(dialog.getByText(`Adding ${writeItemName}…`)).toBeVisible()
  await expect(result).toBeDisabled()
  await expect(dialog).toBeHidden()
  await expect(page.locator('.inventory-row').filter({ hasText: writeItemName })).toHaveCount(1)
  await page.unroute('**/api/collections/inventory_items/records**')

  let created = false
  await page.route('**/api/collections/inventory_items/records**', async (route) => {
    if (route.request().method() === 'POST') {
      created = true
      await route.continue()
      return
    }
    if (created) return route.abort()
    await route.continue()
  })
  await invoker.click()
  await expect(dialog).toBeVisible()
  await searchField(page).fill(writeItemName)
  await expect(dialog.locator('.picker-result')).toHaveCount(1)
  await dialog.locator('.picker-result').click()
  await expect(dialog.getByText(`${writeItemName} was added, but the inventory could not refresh. Refresh this screen before adding anything else.`)).toBeVisible()
  await expect(dialog.locator('.picker-result')).toBeDisabled()
  await dialog.getByRole('button', { name: 'Close catalog picker' }).click()
  await expect(dialog).toBeHidden()
  await expect(page.getByText(`${writeItemName} was added, but the inventory could not refresh. Refresh to see it.`)).toBeVisible()
  await page.unroute('**/api/collections/inventory_items/records**')

  await page.locator('.alert-message').getByRole('button', { name: 'Retry' }).click()
  await expect(page.locator('.inventory-row').filter({ hasText: writeItemName })).toHaveCount(2)
  const list = await page.request.get(`${api}/inventory_items/records?filter=${encodeURIComponent(`inventory='${inventoryId}'`)}&perPage=200`)
  const items = (await list.json()).items as Array<{ name: string }>
  expect(items.filter((entry) => entry.name === writeItemName)).toHaveLength(2)
})

test('inventory picker treats a lost create response as uncertain and blocks blind replay', async ({ page }) => {
  await page.goto(`/characters/${characterId}/inventory`)
  await expect(page.getByRole('heading', { name: `${prefix} Ranger’s items` })).toBeVisible()
  const invoker = page.getByRole('button', { name: '＋ Add catalog item' }).first()
  let createRequests = 0
  await page.route('**/api/collections/inventory_items/records**', async (route) => {
    if (route.request().method() !== 'POST') {
      await route.continue()
      return
    }
    createRequests++
    await route.fetch()
    await route.abort('failed')
  })
  await invoker.click()
  const dialog = page.getByRole('dialog', { name: 'Choose an item' })
  await expect(dialog).toBeVisible()
  await searchField(page).fill(uncertainItemName)
  const result = dialog.locator('.picker-result')
  await expect(result).toHaveCount(1)
  await result.click()
  await expect(dialog.getByText(`Could not confirm whether ${uncertainItemName} was added because the connection failed.`)).toBeVisible()
  await expect(result).toBeDisabled()
  await doubleClick(result)
  expect(createRequests).toBe(1)

  await dialog.getByRole('button', { name: 'Close catalog picker' }).click()
  await expect(dialog).toBeHidden()
  await invoker.click()
  await expect(dialog).toBeVisible()
  await expect(dialog.locator('.picker-result').first()).toBeDisabled()
  await dialog.getByRole('button', { name: 'Close catalog picker' }).click()
  await expect(dialog).toBeHidden()
  await page.unroute('**/api/collections/inventory_items/records**')

  await page.locator('.alert-message').getByRole('button', { name: 'Retry' }).click()
  await expect(page.locator('.inventory-row').filter({ hasText: uncertainItemName })).toHaveCount(1)
  await invoker.click()
  const reopened = page.getByRole('dialog', { name: 'Choose an item' })
  await expect(reopened).toBeVisible()
  await searchField(page).fill(uncertainItemName)
  await expect(reopened.locator('.picker-result')).toBeEnabled()
  expect(createRequests).toBe(1)
  const list = await page.request.get(`${api}/inventory_items/records?filter=${encodeURIComponent(`inventory='${inventoryId}'`)}&perPage=200`)
  const items = (await list.json()).items as Array<{ name: string }>
  expect(items.filter((entry) => entry.name === uncertainItemName)).toHaveLength(1)
})

test('inventory picker treats a committed 500 as uncertain and reconciles before retry', async ({ page }) => {
  await page.goto(`/characters/${characterId}/inventory`)
  await expect(page.getByRole('heading', { name: `${prefix} Ranger’s items` })).toBeVisible()
  const invoker = page.getByRole('button', { name: '＋ Add catalog item' }).first()
  let createRequests = 0
  await page.route('**/api/collections/inventory_items/records**', async (route) => {
    if (route.request().method() !== 'POST') {
      await route.continue()
      return
    }
    createRequests++
    await route.fetch()
    await route.fulfill({
      status: 500,
      contentType: 'application/json',
      body: JSON.stringify({ code: 500, message: 'Injected response failure after commit.', data: {} }),
    })
  })
  await invoker.click()
  const dialog = page.getByRole('dialog', { name: 'Choose an item' })
  await expect(dialog).toBeVisible()
  await searchField(page).fill(serverErrorItemName)
  const result = dialog.locator('.picker-result')
  await expect(result).toHaveCount(1)
  await result.click()
  await expect(dialog.getByText(`Could not confirm whether ${serverErrorItemName} was added because the connection failed.`)).toBeVisible()
  await expect(result).toBeDisabled()
  await doubleClick(result)
  expect(createRequests).toBe(1)

  await dialog.getByRole('button', { name: 'Close catalog picker' }).click()
  await expect(dialog).toBeHidden()
  await expect(page.getByText(`Could not confirm whether ${serverErrorItemName} was added. Refresh before trying again.`)).toBeVisible()
  await page.unroute('**/api/collections/inventory_items/records**')
  await page.locator('.alert-message').getByRole('button', { name: 'Retry' }).click()
  await expect(page.locator('.inventory-row').filter({ hasText: serverErrorItemName })).toHaveCount(1)

  await invoker.click()
  const reopened = page.getByRole('dialog', { name: 'Choose an item' })
  await expect(reopened).toBeVisible()
  await searchField(page).fill(serverErrorItemName)
  await expect(reopened.locator('.picker-result')).toBeEnabled()
  expect(createRequests).toBe(1)
  const list = await page.request.get(`${api}/inventory_items/records?filter=${encodeURIComponent(`inventory='${inventoryId}'`)}&perPage=200`)
  const items = (await list.json()).items as Array<{ name: string }>
  expect(items.filter((entry) => entry.name === serverErrorItemName)).toHaveLength(1)
})

test('spell picker reports failed creates without claiming a selection and retries cleanly', async ({ page }) => {
  await page.goto(`/characters/${characterId}/spellbooks`)
  await expect(page.getByRole('heading', { name: `${prefix} Book` })).toBeVisible()
  const invoker = page.getByRole('button', { name: '＋ Add spell' }).first()
  await invoker.click()
  const dialog = page.getByRole('dialog', { name: 'Choose a spell' })
  await expect(dialog).toBeVisible()
  const search = searchField(page)
  await expect(search).toBeFocused()

  await search.fill(takenSpellName)
  const known = dialog.locator('.picker-result')
  await expect(known).toHaveCount(1)
  await expect(known).toBeDisabled()
  await expect(known).toContainText('Already in this book')

  await page.route('**/api/collections/spellbook_spells/records**', async (route) => {
    if (route.request().method() !== 'POST') {
      await route.continue()
      return
    }
    await wait(300)
    await route.fulfill({
      status: 422,
      contentType: 'application/json',
      body: JSON.stringify({ code: 422, message: 'Injected validation rejection.', data: {} }),
    })
  })
  await search.fill(failedSpellName)
  const retryable = dialog.locator('.picker-result')
  await expect(retryable).toHaveCount(1)
  await retryable.click()
  await expect(dialog.getByText(`Adding ${failedSpellName}…`)).toBeVisible()
  await expect(retryable).toBeDisabled()
  await expect(dialog.getByText(`${failedSpellName} was not added. Check the connection`)).toBeVisible()
  await expect(retryable).toBeEnabled()
  await expect(page.locator('.spell-entry').filter({ hasText: failedSpellName })).toHaveCount(0)
  await page.unroute('**/api/collections/spellbook_spells/records**')

  await retryable.click()
  await expect(dialog).toBeHidden()
  await expect(invoker).toBeFocused()
  await expect(page.locator('.spell-entry').filter({ hasText: failedSpellName })).toHaveCount(1)

  await invoker.click()
  await expect(dialog).toBeVisible()
  await searchField(page).fill(failedSpellName)
  await expect(dialog.locator('.picker-result')).toBeDisabled()
  await expect(dialog.locator('.picker-result')).toContainText('Already in this book')
  await searchField(page).fill(newSpellName)
  await expect(dialog.locator('.picker-result')).toBeEnabled()
  await dialog.locator('.picker-result').click()
  await expect(dialog).toBeHidden()
  await expect(page.locator('.spell-entry').filter({ hasText: newSpellName })).toHaveCount(1)
  await expect(invoker).toBeFocused()
})

test('creature picker holds pending through a slow refresh and blocks repeat writes', async ({ page }) => {
  await page.goto(`/games/${gameId}/encounters?encounter=${encounterId}`)
  await expect(page.getByRole('heading', { name: `${prefix} Encounter` })).toBeVisible()
  const invoker = page.getByRole('button', { name: '＋ Add catalog creature' }).first()
  await invoker.scrollIntoViewIfNeeded()
  const before = await scrollY(page)
  let createRequests = 0
  let created = false
  await page.route('**/api/collections/encounter_creatures/records**', async (route) => {
    const method = route.request().method()
    if (method === 'POST') {
      createRequests++
      created = true
      await wait(300)
      await route.continue()
      return
    }
    if (created) await wait(900)
    await route.continue()
  })
  await invoker.click()
  const dialog = page.getByRole('dialog', { name: 'Choose a creature' })
  await expect(dialog).toBeVisible()
  const search = searchField(page)
  await expect(search).toBeFocused()

  await search.fill(creatureName)
  const result = dialog.locator('.picker-result')
  await expect(result).toHaveCount(1)
  await doubleClick(result)
  await expect(dialog.getByText(`Adding ${creatureName}…`)).toBeVisible()
  await expect(result).toBeDisabled()
  await expect(dialog.getByText(`Added ${creatureName}. Refreshing the encounter list…`)).toBeVisible()
  await expect(result).toBeDisabled()
  await expect(page.locator('.encounter-entry-list .inventory-row')).toHaveCount(0)
  await doubleClick(result)
  expect(createRequests).toBe(1)
  await expect(dialog.getByText(`Added ${creatureName}. Search stays open so you can add another.`)).toBeVisible()
  await expect(result).toBeEnabled()
  await expect(search).toHaveValue(creatureName)
  await expect(page.locator('.encounter-entry-list .inventory-row')).toHaveCount(1)

  await result.click()
  await expect(dialog.getByText(`Adding ${creatureName}…`)).toBeVisible()
  await expect(dialog.getByText(`Added ${creatureName}. Refreshing the encounter list…`)).toBeVisible()
  await expect(dialog.getByText(`Added ${creatureName}. Search stays open so you can add another.`)).toBeVisible()
  await expect(page.locator('.encounter-entry-list .inventory-row')).toHaveCount(2)
  await expect(search).toHaveValue(creatureName)
  expect(createRequests).toBe(2)

  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
  await expect(invoker).toBeFocused()
  expect(await scrollY(page)).toBe(before)
  await page.unroute('**/api/collections/encounter_creatures/records**')
})

test('table-reference picker returns focus and keeps the edit form position', async ({ page }) => {
  await page.goto(`/games/${gameId}/tables`)
  await expect(page.getByRole('heading', { name: 'Random tables' })).toBeVisible()
  await page.getByRole('button', { name: 'Edit', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Edit table' })).toBeVisible()
  await page.getByLabel('Reference').selectOption('item')
  const choose = page.getByRole('button', { name: 'Choose item' })
  await choose.scrollIntoViewIfNeeded()
  const before = await scrollY(page)
  await choose.click()
  const dialog = page.getByRole('dialog', { name: 'Choose item' })
  await expect(dialog).toBeVisible()
  const search = searchField(page)
  await expect(search).toBeFocused()
  await search.fill(itemName)
  await expect(dialog.locator('.picker-result')).toHaveCount(1)
  await dialog.locator('.picker-result').click()
  await expect(dialog).toBeHidden()
  await expect(choose).toBeFocused()
  await expect(page.getByText(`Selected: ${itemName} · PHB`)).toBeVisible()
  expect(Math.abs((await scrollY(page)) - before)).toBeLessThan(60)
})
