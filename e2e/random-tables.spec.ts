import type { Locator, Page } from '@playwright/test'
import { e2eApiBase, expect, test } from './fixtures'

const api = `${e2eApiBase}/api/collections`
const key = `${Date.now()}-${Math.random().toString(36).slice(2)}`
const prefix = `Tables ${key}`
let systemId = ''
let gameId = ''
let encounterId = ''
let secondEncounterId = ''
let thirdEncounterId = ''
let itemId = ''
let creatureId = ''
let longTableId = ''
let gapTableId = ''
let itemTableId = ''
let creatureTableId = ''
let encounterTableId = ''
let editTableId = ''
let longName = ''
let gapName = ''
let itemTableName = ''
let creatureTableName = ''
let encounterTableName = ''
let editTableName = ''
let encounterName = ''
let secondEncounterName = ''
let thirdEncounterName = ''
let itemName = ''
let creatureName = ''

const wait = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds))

async function doubleClick(locator: Locator) {
  await locator.evaluate((element) => {
    const button = element as HTMLButtonElement
    button.click()
    button.click()
  })
}

async function manualRoll(page: Page, value: number) {
  await page.getByLabel('Manual roll').fill(String(value))
  await page.getByRole('button', { name: 'Use roll' }).click()
}

test.beforeAll(async ({ request }) => {
  const create = async <T extends { id: string }>(collection: string, data: Record<string, unknown>) => {
    const response = await request.post(`${api}/${collection}/records`, { data })
    expect(response.ok(), `${collection} fixture: ${await response.text()}`).toBeTruthy()
    return await response.json() as T
  }
  const systems = await request.get(`${api}/systems/records?filter=${encodeURIComponent("(key='dnd5e')")}`)
  expect(systems.ok(), await systems.text()).toBeTruthy()
  systemId = (await systems.json()).items[0].id as string

  const game = await create('games', { name: `${prefix} Game`, system: systemId })
  gameId = game.id
  encounterName = `${prefix} Encounter`
  const encounter = await create('encounters', { game: gameId, name: encounterName })
  encounterId = encounter.id
  secondEncounterName = `${prefix} Review Encounter`
  const secondEncounter = await create('encounters', { game: gameId, name: secondEncounterName })
  secondEncounterId = secondEncounter.id
  thirdEncounterName = `${prefix} Concurrent Encounter`
  const thirdEncounter = await create('encounters', { game: gameId, name: thirdEncounterName })
  thirdEncounterId = thirdEncounter.id
  itemName = `${prefix} Rope`
  const item = await create('catalog', {
    system: systemId,
    type: 'item',
    source: 'SYNTH',
    source_id: `${key}-rope`,
    name: itemName,
    item_type: 'G',
    item_weight: 5,
    item_value: 1,
    original_json: { entries: ['An invented rope.'] },
    alternate_description: 'A synthetic rope for the table test.',
    notes: '',
  })
  itemId = item.id
  creatureName = `${prefix} Owl`
  const creature = await create('catalog', {
    system: systemId,
    type: 'creature',
    source: 'SYNTH',
    source_id: `${key}-owl`,
    name: creatureName,
    creature_type: 'beast',
    challenge_rating: '0',
    original_json: { hp: { average: 1, formula: '1d4' }, fluff: { entries: ['An invented owl.'] } },
    alternate_description: '',
    notes: '',
  })
  creatureId = creature.id

  const saveTable = async (table: { name: string; dice: string; entries: Array<{ min: number; max: number; text: string; type: string; ref: string }> }) => {
    const response = await request.post(`${e2eApiBase}/api/olea/tables/save`, { data: { game: gameId, id: '', table } })
    expect(response.ok(), `random table fixture: ${await response.text()}`).toBeTruthy()
    return (await response.json()).id as string
  }

  longName = `${prefix} Long`
  longTableId = await saveTable({
    name: longName,
    dice: '1d1',
    entries: Array.from({ length: 80 }, (_, index) => ({
      min: index + 1,
      max: index + 1,
      text: `Long entry ${String(index + 1).padStart(2, '0')}`,
      type: '',
      ref: '',
    })),
  })
  gapName = `${prefix} Gaps`
  gapTableId = await saveTable({
    name: gapName,
    dice: '1d6',
    entries: [
      { min: 1, max: 2, text: 'Gap low', type: '', ref: '' },
      { min: 4, max: 5, text: 'Gap high', type: '', ref: '' },
    ],
  })
  itemTableName = `${prefix} Item reference`
  itemTableId = await saveTable({ name: itemTableName, dice: '', entries: [{ min: 1, max: 1, text: 'Referenced item', type: 'item', ref: itemId }] })
  creatureTableName = `${prefix} Creature reference`
  creatureTableId = await saveTable({ name: creatureTableName, dice: '', entries: [{ min: 1, max: 1, text: 'Referenced creature', type: 'creature', ref: creatureId }] })
  encounterTableName = `${prefix} Encounter reference`
  encounterTableId = await saveTable({ name: encounterTableName, dice: '', entries: [{ min: 1, max: 1, text: 'Referenced encounter', type: 'encounter', ref: encounterId }] })
  editTableName = `${prefix} Editable`
  editTableId = await saveTable({
    name: editTableName,
    dice: '',
    entries: [
      { min: 1, max: 2, text: 'Editable low', type: '', ref: '' },
      { min: 5, max: 6, text: 'Editable high', type: '', ref: '' },
    ],
  })
})

test.afterAll(async ({ request }) => {
  if (gameId) await request.delete(`${api}/games/records/${gameId}`)
  for (const id of [itemId, creatureId]) {
    if (id) await request.delete(`${api}/catalog/records/${id}`)
  }
})

test('a long table keeps roll controls and the latest result above the full entry list', async ({ page }) => {
  await page.goto(`/games/${gameId}/tables?table=${longTableId}`)
  await expect(page.getByRole('heading', { name: 'Random tables' })).toBeVisible()
  await expect(page.getByRole('heading', { name: longName })).toBeVisible()

  await page.getByRole('button', { name: 'Roll 1d1' }).click()
  await expect(page.locator('.table-outcome')).toContainText('Roll: 1')
  await expect(page.locator('.table-outcome')).toContainText('Long entry 01')

  await manualRoll(page, 42)
  await expect(page.locator('.table-outcome')).toContainText('Roll: 42')
  await expect(page.locator('.table-outcome')).toContainText('Long entry 42')

  const entries = page.locator('details.table-entries')
  expect(await entries.evaluate((element) => (element as HTMLDetailsElement).open)).toBe(false)
  const resultBox = await page.locator('.table-outcome').boundingBox()
  const entriesBox = await entries.boundingBox()
  expect(resultBox).not.toBeNull()
  expect(entriesBox).not.toBeNull()
  expect(resultBox!.y).toBeLessThan(entriesBox!.y)

  await entries.locator('summary').click()
  await expect(entries.locator('.table-entry-row')).toHaveCount(80)
  const geometry = await page.evaluate(() => ({ viewport: document.documentElement.clientWidth, document: document.documentElement.scrollWidth }))
  expect(geometry.document).toBeLessThanOrEqual(geometry.viewport)
})

test('table selection is direct-linkable, survives reload, and falls back from an unknown query', async ({ page }) => {
  await page.goto(`/games/${gameId}/tables?table=${gapTableId}`)
  await expect(page.getByRole('heading', { name: gapName })).toBeVisible()

  await page.locator('.table-tabs').getByRole('button', { name: new RegExp(longName) }).click()
  await expect(page).toHaveURL(new RegExp(`table=${longTableId}`))
  await expect(page.getByRole('heading', { name: longName })).toBeVisible()

  await page.reload()
  await expect(page.getByRole('heading', { name: longName })).toBeVisible()
  await expect(page.locator('.table-tabs').getByRole('button', { name: new RegExp(longName) })).toHaveAttribute('aria-pressed', 'true')

  await page.goto(`/games/${gameId}/tables?table=missing-${key}`)
  await expect(page.locator('.table-selected h2')).toBeVisible()
  await expect(page).not.toHaveURL(new RegExp(`missing-${key}`))
})

test('manual rolls cover inclusive endpoints and gaps, and result links restore the table and result', async ({ page }) => {
  await page.goto(`/games/${gameId}/tables?table=${gapTableId}`)
  await expect(page.getByRole('heading', { name: gapName })).toBeVisible()

  await manualRoll(page, 1)
  await expect(page.locator('.table-outcome')).toContainText('Gap low')
  await manualRoll(page, 2)
  await expect(page.locator('.table-outcome')).toContainText('Gap low')
  await manualRoll(page, 3)
  await expect(page.locator('.table-outcome')).toContainText('No entry matches this roll.')
  await manualRoll(page, 4)
  await expect(page.locator('.table-outcome')).toContainText('Gap high')
  await manualRoll(page, 5)
  await expect(page.locator('.table-outcome')).toContainText('Gap high')
  await manualRoll(page, 6)
  await expect(page.locator('.table-outcome')).toContainText('No entry matches this roll.')

  await page.goto(`/games/${gameId}/tables?table=${itemTableId}`)
  await expect(page.getByRole('heading', { name: itemTableName })).toBeVisible()
  await manualRoll(page, 1)
  await expect(page.locator('.table-outcome')).toContainText('Referenced item')
  await expect(page.locator('.table-outcome')).toContainText(itemName)

  await page.getByRole('link', { name: 'Open catalog entry' }).click()
  await expect(page).toHaveURL(new RegExp(`/catalog/${itemId}$`))
  await expect(page.getByRole('heading', { name: itemName })).toBeVisible()
  await page.goBack()
  await expect(page).toHaveURL(new RegExp(`/games/${gameId}/tables\\?table=${itemTableId}`))
  await expect(page.getByRole('heading', { name: itemTableName })).toBeVisible()
  await expect(page.locator('.table-outcome')).toContainText('Roll: 1')
  await expect(page.locator('.table-outcome')).toContainText(itemName)

  await page.route(`**/api/collections/catalog/records/${itemId}`, (route) => route.fulfill({ status: 404, contentType: 'application/json', body: '{}' }))
  await manualRoll(page, 1)
  await expect(page.locator('.table-outcome')).toContainText('missing or belongs to another system or game')
  await page.unroute(`**/api/collections/catalog/records/${itemId}`)

  await page.route(`**/api/collections/catalog/records/${itemId}`, (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ id: itemId, name: itemName, source: 'SYNTH', system: 'another-system', type: 'item' }),
  }))
  await manualRoll(page, 1)
  await expect(page.locator('.table-outcome')).toContainText('missing or belongs to another system or game')
  await page.unroute(`**/api/collections/catalog/records/${itemId}`)

  await page.goto(`/games/${gameId}/tables?table=${encounterTableId}`)
  await expect(page.getByRole('heading', { name: encounterTableName })).toBeVisible()
  await page.route(`**/api/collections/encounters/records/${encounterId}`, (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ id: encounterId, name: encounterName, game: 'another-game' }),
  }))
  await manualRoll(page, 1)
  await expect(page.locator('.table-outcome')).toContainText('missing or belongs to another system or game')
  await page.unroute(`**/api/collections/encounters/records/${encounterId}`)
})

test('editing reports overlap and missing-reference validation while preserving allowed gaps', async ({ page }) => {
  await page.goto(`/games/${gameId}/tables?table=${editTableId}`)
  await expect(page.getByRole('heading', { name: editTableName })).toBeVisible()
  await page.getByRole('button', { name: new RegExp(`Table actions for ${editTableName}`) }).click()
  await page.getByRole('menuitem', { name: 'Edit table' }).click()
  await expect(page.getByRole('heading', { name: 'Edit table' })).toBeVisible()

  const secondEntry = page.locator('.table-entry').nth(1)
  await secondEntry.getByLabel('From').fill('2')
  await page.getByRole('button', { name: 'Save table' }).click()
  await expect(page.getByRole('alert')).toContainText('Entry ranges overlap.')

  await secondEntry.getByLabel('From').fill('5')
  const firstEntry = page.locator('.table-entry').nth(0)
  await firstEntry.getByLabel('Reference').selectOption('item')
  await page.getByRole('button', { name: 'Save table' }).click()
  await expect(page.getByRole('alert')).toContainText('Choose a reference or select text only.')
  await firstEntry.getByLabel('Reference').selectOption('')

  await page.getByRole('button', { name: 'Save table' }).click()
  await expect(page.getByRole('heading', { name: editTableName })).toBeVisible()
  await expect(page.getByText('Table saved.')).toBeVisible()

  await manualRoll(page, 1)
  await expect(page.locator('.table-outcome')).toContainText('Editable low')
  await manualRoll(page, 2)
  await expect(page.locator('.table-outcome')).toContainText('Editable low')
  await manualRoll(page, 3)
  await expect(page.locator('.table-outcome')).toContainText('No entry matches this roll.')
  await manualRoll(page, 5)
  await expect(page.locator('.table-outcome')).toContainText('Editable high')
  await manualRoll(page, 6)
  await expect(page.locator('.table-outcome')).toContainText('Editable high')
  await manualRoll(page, 7)
  await expect(page.locator('.table-outcome')).toContainText('No entry matches this roll.')
})

test('copying a system template selects an independent editable table', async ({ page }) => {
  await page.goto(`/games/${gameId}/tables`)
  await expect(page.getByRole('heading', { name: 'Random tables' })).toBeVisible()
  const templates = page.locator('details.table-templates')
  if (!(await templates.evaluate((element) => (element as HTMLDetailsElement).open))) {
    await templates.locator('summary').click()
  }
  const template = templates.locator('.table-template').filter({ hasText: 'E2E Template Table' })
  await expect(template).toBeVisible()
  await template.getByRole('button', { name: 'Copy to game' }).click()

  await expect(page).toHaveURL(/[?&]table=/)
  const copiedId = new URL(page.url()).searchParams.get('table')
  expect(copiedId).toBeTruthy()
  await expect(page.getByRole('heading', { name: 'E2E Template Table' })).toBeVisible()
  await page.getByRole('button', { name: 'Roll 1d1' }).click()
  await expect(page.locator('.table-outcome')).toContainText('Template result')
  await expect(templates.locator('.table-template').filter({ hasText: 'E2E Template Table' })).toBeVisible()
})

test('a creature result can be added to one of the game encounters', async ({ page, request }) => {
  await page.goto(`/games/${gameId}/tables?table=${creatureTableId}`)
  await expect(page.getByRole('heading', { name: creatureTableName })).toBeVisible()
  await manualRoll(page, 1)
  await expect(page.locator('.table-outcome')).toContainText(creatureName)
  await page.getByLabel('Add to encounter').selectOption({ label: encounterName })
  await page.getByRole('button', { name: 'Add creature' }).click()
  await expect(page.getByText(`Added ${creatureName} to ${encounterName}.`)).toBeVisible()

  const entries = await request.get(`${api}/encounter_creatures/records?filter=${encodeURIComponent(`encounter='${encounterId}' && creature='${creatureId}'`)}`)
  expect(entries.ok(), await entries.text()).toBeTruthy()
  expect((await entries.json()).totalItems).toBe(1)
})

test('duplicate save clicks are suppressed and an uncertain save is reconciled before retrying', async ({ page, request }) => {
  await page.goto(`/games/${gameId}/tables?table=${longTableId}`)
  await expect(page.getByRole('heading', { name: 'Random tables' })).toBeVisible()

  const duplicateName = `${prefix} Guarded`
  let saveRequests = 0
  await page.route('**/api/olea/tables/save', async (route) => {
    saveRequests++
    await wait(400)
    await route.continue()
  })
  await page.getByRole('button', { name: '＋ New table' }).click()
  await page.getByLabel('Name').fill(duplicateName)
  await page.locator('#entry-text-0').fill('One guarded result.')
  await doubleClick(page.getByRole('button', { name: 'Save table' }))
  await expect(page.locator('.table-tabs').getByRole('button', { name: new RegExp(duplicateName) })).toBeVisible()
  expect(saveRequests).toBe(1)
  await page.unroute('**/api/olea/tables/save')

  const uncertainName = `${prefix} Uncertain`
  let uncertainRequests = 0
  await page.route('**/api/olea/tables/save', async (route) => {
    uncertainRequests++
    await route.fetch()
    await route.abort('failed')
  })
  await page.getByRole('button', { name: '＋ New table' }).click()
  await page.getByLabel('Name').fill(uncertainName)
  await page.locator('#entry-text-0').fill('One uncertain result.')
  await page.getByRole('button', { name: 'Save table' }).click()
  await expect(page.getByRole('alert')).toContainText('Could not confirm whether the table was saved')
  await expect(page.getByRole('button', { name: 'Save table' })).toBeDisabled()
  expect(uncertainRequests).toBe(1)
  await page.unroute('**/api/olea/tables/save')

  await page.getByRole('button', { name: 'Refresh' }).click()
  await expect(page.locator('.table-tabs').getByRole('button', { name: new RegExp(uncertainName) })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Edit table' })).toHaveCount(0)
  expect(uncertainRequests).toBe(1)

  const records = await request.get(`${api}/random_tables/records?filter=${encodeURIComponent(`game='${gameId}' && name='${uncertainName}'`)}`)
  expect(records.ok(), await records.text()).toBeTruthy()
  expect((await records.json()).totalItems).toBe(1)
})

test('a confirmed save with a failed list reload locks stale tables until refresh', async ({ page, request }) => {
  await page.goto(`/games/${gameId}/tables?table=${longTableId}`)
  await expect(page.getByRole('heading', { name: 'Random tables' })).toBeVisible()
  const savedName = `${prefix} Saved Lock`
  let failReads = false
  await page.route('**/api/collections/random_tables/records?*', async (route) => {
    if (failReads && route.request().method() === 'GET') {
      await route.abort('failed')
      return
    }
    await route.continue()
  })

  await page.getByRole('button', { name: '＋ New table' }).click()
  await page.getByLabel('Name').fill(savedName)
  await page.locator('#entry-text-0').fill('Saved before the list refresh failed.')
  failReads = true
  await page.getByRole('button', { name: 'Save table' }).click()
  await expect(page.getByRole('alert')).toContainText('The table was saved, but the table list could not refresh')
  await expect(page.getByRole('button', { name: 'Refresh' })).toBeVisible()
  await expect(page.getByRole('button', { name: '＋ New table' })).toBeDisabled()
  await expect(page.getByRole('button', { name: /Table actions for/ })).toBeDisabled()
  await expect(page.locator('.table-tabs').getByRole('button', { name: new RegExp(savedName) })).toHaveCount(0)

  failReads = false
  await page.getByRole('button', { name: 'Refresh' }).click()
  await expect(page.locator('.table-tabs').getByRole('button', { name: new RegExp(savedName) })).toBeVisible()
  await expect(page.getByRole('button', { name: '＋ New table' })).toBeEnabled()
  const records = await request.get(`${api}/random_tables/records?filter=${encodeURIComponent(`game='${gameId}' && name='${savedName}'`)}`)
  expect(records.ok(), await records.text()).toBeTruthy()
  expect((await records.json()).totalItems).toBe(1)
})

test('a confirmed delete with a failed list reload keeps the stale table locked until refresh', async ({ page, request }) => {
  const tempName = `${prefix} Delete Lock`
  const created = await request.post(`${e2eApiBase}/api/olea/tables/save`, {
    data: { game: gameId, id: '', table: { name: tempName, dice: '', entries: [{ min: 1, max: 1, text: 'Delete me', type: '', ref: '' }] } },
  })
  expect(created.ok(), await created.text()).toBeTruthy()
  const tempId = (await created.json()).id as string

  await page.goto(`/games/${gameId}/tables?table=${tempId}`)
  await expect(page.getByRole('heading', { name: tempName })).toBeVisible()
  let failReads = false
  await page.route('**/api/collections/random_tables/records?*', async (route) => {
    if (failReads && route.request().method() === 'GET') {
      await route.abort('failed')
      return
    }
    await route.continue()
  })
  await page.getByRole('button', { name: new RegExp(`Table actions for ${tempName}`) }).click()
  page.once('dialog', (dialog) => dialog.accept())
  failReads = true
  await page.getByRole('menuitem', { name: 'Delete table' }).click()
  await expect(page.getByRole('alert')).toContainText('The table was deleted, but the remaining tables could not refresh')
  await expect(page.getByRole('button', { name: '＋ New table' })).toBeDisabled()
  await expect(page.locator('.table-tabs').getByRole('button', { name: new RegExp(tempName) })).toBeVisible()

  failReads = false
  await page.getByRole('button', { name: 'Refresh' }).click()
  await expect(page.locator('.table-tabs').getByRole('button', { name: new RegExp(tempName) })).toHaveCount(0)
  await expect(page.getByRole('button', { name: '＋ New table' })).toBeEnabled()
})

test('a confirmed template copy with a failed list reload locks stale tables until refresh', async ({ page, request }) => {
  await page.goto(`/games/${gameId}/tables?table=${gapTableId}`)
  await expect(page.getByRole('heading', { name: 'Random tables' })).toBeVisible()
  const before = await request.get(`${api}/random_tables/records?filter=${encodeURIComponent(`game='${gameId}' && name='E2E Template Table'`)}`)
  expect(before.ok(), await before.text()).toBeTruthy()
  const beforeCount = (await before.json()).totalItems as number

  const templates = page.locator('details.table-templates')
  if (!(await templates.evaluate((element) => (element as HTMLDetailsElement).open))) {
    await templates.locator('summary').click()
  }
  let failReads = false
  await page.route('**/api/collections/random_tables/records?*', async (route) => {
    if (failReads && route.request().method() === 'GET') {
      await route.abort('failed')
      return
    }
    await route.continue()
  })
  failReads = true
  await templates.locator('.table-template').filter({ hasText: 'E2E Template Table' }).getByRole('button', { name: 'Copy to game' }).click()
  await expect(page.getByRole('alert')).toContainText('The template was copied, but the table list could not refresh')
  await expect(page.getByRole('button', { name: '＋ New table' })).toBeDisabled()
  await expect(page.getByRole('button', { name: 'Copy to game' })).toBeDisabled()

  failReads = false
  await page.getByRole('button', { name: 'Refresh' }).click()
  await expect(page.getByRole('button', { name: '＋ New table' })).toBeEnabled()
  const after = await request.get(`${api}/random_tables/records?filter=${encodeURIComponent(`game='${gameId}' && name='E2E Template Table'`)}`)
  expect(after.ok(), await after.text()).toBeTruthy()
  expect((await after.json()).totalItems).toBe(beforeCount + 1)
})

test('a committed creature add with a lost response is reviewed against the target encounter without replay', async ({ page, request }) => {
  await page.goto(`/games/${gameId}/tables?table=${creatureTableId}`)
  await expect(page.getByRole('heading', { name: creatureTableName })).toBeVisible()
  await manualRoll(page, 1)
  await expect(page.locator('.table-outcome')).toContainText(creatureName)

  let addRequests = 0
  await page.route('**/api/olea/tables/add-creature', async (route) => {
    addRequests++
    await route.fetch()
    await route.abort('failed')
  })
  await page.getByLabel('Add to encounter').selectOption({ label: secondEncounterName })
  await page.getByRole('button', { name: 'Add creature' }).click()
  await expect(page.getByRole('alert')).toContainText('Could not confirm whether')
  await expect(page.getByRole('alert')).toContainText('A delayed write may still arrive')
  await expect(page.getByRole('button', { name: 'Check encounter' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Review target encounter' })).toHaveAttribute('href', `/games/${gameId}/encounters?encounter=${secondEncounterId}`)
  await expect(page.getByLabel('Add to encounter')).toHaveValue(secondEncounterId)
  await expect(page.getByRole('button', { name: 'Add creature' })).toBeDisabled()
  expect(addRequests).toBe(1)

  const committed = await request.get(`${api}/encounter_creatures/records?filter=${encodeURIComponent(`encounter='${secondEncounterId}' && creature='${creatureId}'`)}`)
  expect(committed.ok(), await committed.text()).toBeTruthy()
  expect((await committed.json()).totalItems).toBe(1)

  await page.getByRole('button', { name: 'Check encounter' }).click()
  await expect(page.getByRole('alert')).toContainText('Review required')
  await expect(page.getByRole('alert')).toContainText('may be another client’s add or the delayed write')
  await expect(page.getByText(`1 matching entry observed in ${secondEncounterName}.`)).toBeVisible()
  await expect(page.locator('.table-add-review-list li')).toContainText(creatureName)
  await expect(page.getByText('Confirmed:')).toHaveCount(0)
  await expect(page.getByLabel('Add to encounter')).toHaveValue(secondEncounterId)
  await expect(page.getByRole('button', { name: 'Add creature' })).toBeDisabled()
  await expect(page.getByRole('button', { name: '＋ New table' })).toBeDisabled()
  expect(addRequests).toBe(1)

  await page.getByRole('button', { name: 'Acknowledge review and unlock' }).click()
  await expect(page.getByText(`Add lock cleared after reviewing ${secondEncounterName}. No retry was sent.`)).toBeVisible()
  await expect(page.getByLabel('Add to encounter')).toHaveValue('')
  await expect(page.getByRole('button', { name: 'Add creature' })).toBeDisabled()
  await expect(page.getByRole('button', { name: '＋ New table' })).toBeEnabled()
  expect(addRequests).toBe(1)
  await page.unroute('**/api/olea/tables/add-creature')
})

test('a concurrent other-client add is not treated as confirmation of a failed creature request', async ({ page, request }) => {
  await page.goto(`/games/${gameId}/tables?table=${creatureTableId}`)
  await expect(page.getByRole('heading', { name: creatureTableName })).toBeVisible()
  await manualRoll(page, 1)
  await expect(page.locator('.table-outcome')).toContainText(creatureName)

  let addRequests = 0
  await page.route('**/api/olea/tables/add-creature', async (route) => {
    addRequests++
    await route.abort('failed')
  })
  await page.getByLabel('Add to encounter').selectOption({ label: thirdEncounterName })
  await page.getByRole('button', { name: 'Add creature' }).click()
  await expect(page.getByRole('alert')).toContainText('Could not confirm whether')
  expect(addRequests).toBe(1)

  const otherClient = await request.post(`${api}/encounter_creatures/records`, {
    data: { encounter: thirdEncounterId, creature: creatureId, name: creatureName, quantity: 1, notes: 'Added by another client', custom: false },
  })
  expect(otherClient.ok(), await otherClient.text()).toBeTruthy()

  await page.getByRole('button', { name: 'Check encounter' }).click()
  await expect(page.getByRole('alert')).toContainText('Review required')
  await expect(page.getByRole('alert')).toContainText('may be another client’s add or the delayed write')
  await expect(page.locator('.table-add-review-list li')).toContainText('Added by another client')
  await expect(page.locator('.table-add-review-new')).toContainText('may be another client’s entry or the delayed write')
  await expect(page.getByText('Confirmed:')).toHaveCount(0)
  await expect(page.getByLabel('Add to encounter')).toHaveValue(thirdEncounterId)
  await expect(page.getByRole('button', { name: 'Add creature' })).toBeDisabled()
  await expect(page.getByRole('button', { name: '＋ New table' })).toBeDisabled()
  expect(addRequests).toBe(1)

  await page.getByRole('button', { name: 'Acknowledge review and unlock' }).click()
  await expect(page.getByText(`Add lock cleared after reviewing ${thirdEncounterName}. No retry was sent.`)).toBeVisible()
  await expect(page.getByLabel('Add to encounter')).toHaveValue('')
  await expect(page.getByRole('button', { name: 'Add creature' })).toBeDisabled()
  await expect(page.getByRole('button', { name: '＋ New table' })).toBeEnabled()
  expect(addRequests).toBe(1)
  await page.unroute('**/api/olea/tables/add-creature')
})
