import { e2eApiBase, expect, test } from './fixtures'
import type { APIRequestContext, Page } from '@playwright/test'

const api = `${e2eApiBase}/api/collections`
let sequence = 0

function uniqueName(label: string) {
  sequence++
  return `${label} ${Date.now()}-${sequence}`
}

async function createRecord(request: APIRequestContext, collection: string, data: Record<string, unknown>) {
  const response = await request.post(`${api}/${collection}/records`, { data })
  expect(response.ok(), `${collection}: ${await response.text()}`).toBeTruthy()
  return await response.json() as { id: string }
}

async function dnd5eSystem(request: APIRequestContext) {
  const response = await request.get(`${api}/systems/records?filter=${encodeURIComponent("(key='dnd5e')")}`)
  expect(response.ok(), await response.text()).toBeTruthy()
  return (await response.json() as { items: Array<{ id: string }> }).items[0]!.id
}

async function createGame(request: APIRequestContext, systemId: string, name: string) {
  return await createRecord(request, 'games', {
    name,
    system: systemId,
    encounter_visible: true,
    encounter_show_initiative: true,
    encounter_show_enemy_names: true,
    encounter_show_hp: true,
    encounter_show_conditions: true,
  })
}

async function createCreature(request: APIRequestContext, systemId: string, name: string) {
  return await createRecord(request, 'catalog', {
    system: systemId,
    type: 'creature',
    source: 'SYNTH',
    source_id: `${Date.now()}-${sequence}-${name.replace(/\W+/g, '-').toLowerCase()}`,
    name,
    creature_type: 'beast',
    challenge_rating: '1',
    original_json: { hp: { average: 8, formula: '2d8' }, abilities: { dex: 14 }, fluff: { entries: ['A synthetic creature.'] } },
    alternate_description: '',
    notes: '',
  })
}

async function cleanupGame(request: APIRequestContext, gameId: string, catalogIds: string[] = []) {
  const removed = await request.delete(`${api}/games/records/${gameId}`)
  expect(removed.ok(), `game cleanup: ${await removed.text()}`).toBeTruthy()
  for (const id of catalogIds) {
    const response = await request.delete(`${api}/catalog/records/${id}`)
    expect(response.ok(), `catalog cleanup: ${await response.text()}`).toBeTruthy()
  }
}

async function openPreparedEncounter(page: Page, gameId: string, encounterId: string) {
  await page.goto(`/games/${gameId}/encounters?encounter=${encounterId}`)
}

async function pushSameRoute(page: Page, to: string) {
  await page.evaluate((url) => {
    const current = (window.history.state ?? {}) as Record<string, unknown>
    const position = typeof current.position === 'number' ? current.position : 0
    const state = { ...current, current: url, position: position + 1 }
    window.history.pushState(state, '', url)
    window.dispatchEvent(new PopStateEvent('popstate', { state }))
  }, to)
}

test('builds a multi-creature preparation, edits quantities and notes, and duplicates it', async ({ page, request }) => {
  const systemId = await dnd5eSystem(request)
  const game = await createGame(request, systemId, uniqueName('Preparation game'))
  const encounter = await createRecord(request, 'encounters', { game: game.id, name: uniqueName('Bridge preparation') })
  const alpha = await createCreature(request, systemId, uniqueName('Synthetic Alpha'))
  const beta = await createCreature(request, systemId, uniqueName('Synthetic Beta'))
  const catalogIds = [alpha.id, beta.id]

  try {
    await openPreparedEncounter(page, game.id, encounter.id)
    await expect(page.getByRole('heading', { name: encounter.name })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'No creatures prepared' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Ready to start' })).toBeVisible()

    await page.getByRole('button', { name: '＋ Add catalog creature' }).first().click()
    const dialog = page.getByRole('dialog', { name: 'Choose a creature' })
    const search = dialog.getByRole('searchbox')

    await search.fill(alpha.name)
    await dialog.locator('.picker-result').filter({ hasText: alpha.name }).click()
    await expect(dialog.getByText(`Added ${alpha.name}. Search stays open so you can add another.`)).toBeVisible()
    await expect(page.locator('.encounter-entry-list .inventory-row')).toHaveCount(1)

    await search.fill(beta.name)
    await dialog.locator('.picker-result').filter({ hasText: beta.name }).click()
    await expect(dialog.getByText(`Added ${beta.name}. Search stays open so you can add another.`)).toBeVisible()
    await expect(page.locator('.encounter-entry-list .inventory-row')).toHaveCount(2)
    await dialog.getByRole('button', { name: 'Close catalog picker' }).click()

    const alphaRow = page.locator('.encounter-entry-list .inventory-row').filter({ hasText: alpha.name })
    await alphaRow.getByLabel('Quantity').fill('4')
    await alphaRow.getByLabel('Notes').fill('Alpha note for the next session.')
    await alphaRow.getByRole('button', { name: 'Save' }).click()
    await expect(alphaRow.getByLabel('Quantity')).toHaveValue('4')

    await page.reload()
    await expect(page.getByRole('heading', { name: encounter.name })).toBeVisible()
    const reloadedAlpha = page.locator('.encounter-entry-list .inventory-row').filter({ hasText: alpha.name })
    await expect(reloadedAlpha.getByLabel('Quantity')).toHaveValue('4')
    await expect(reloadedAlpha.getByLabel('Notes')).toHaveValue('Alpha note for the next session.')

    await page.getByRole('button', { name: `Encounter actions for ${encounter.name}` }).click()
    await page.getByRole('menuitem', { name: 'Duplicate encounter' }).click()
    const copyName = `${encounter.name} (copy)`
    await expect(page.getByRole('heading', { name: copyName })).toBeVisible()

    const copyId = new URL(page.url()).searchParams.get('encounter')
    expect(copyId, 'duplicating an encounter selects it and writes it to the query').toBeTruthy()
    expect(copyId).not.toBe(encounter.id)
    await expect(page.locator('.encounter-entry-list .inventory-row')).toHaveCount(2)
    const copiedAlpha = page.locator('.encounter-entry-list .inventory-row').filter({ hasText: alpha.name })
    await expect(copiedAlpha.getByLabel('Quantity')).toHaveValue('4')

    const stored = await request.get(`${api}/encounter_creatures/records?filter=${encodeURIComponent(`encounter='${copyId}'`)}`)
    expect(stored.ok(), await stored.text()).toBeTruthy()
    expect((await stored.json() as { items: unknown[] }).items).toHaveLength(2)
  } finally {
    await cleanupGame(request, game.id, catalogIds)
  }
})

test('switches encounters, keeps the direct query, and returns from print with the selection and position', async ({ page, request }) => {
  const systemId = await dnd5eSystem(request)
  const game = await createGame(request, systemId, uniqueName('Switching game'))
  const first = await createRecord(request, 'encounters', { game: game.id, name: uniqueName('First preparation') })
  const second = await createRecord(request, 'encounters', { game: game.id, name: uniqueName('Second preparation') })
  for (let index = 1; index <= 18; index++) {
    await createRecord(request, 'encounter_creatures', {
      encounter: first.id,
      name: `Prepared marker ${String(index).padStart(2, '0')}`,
      quantity: 1,
      notes: index === 1 ? 'The printed position starts here.' : '',
      custom: true,
    })
  }
  await createRecord(request, 'encounter_creatures', { encounter: second.id, name: 'Second marker', quantity: 1, notes: '', custom: true })

  try {
    await openPreparedEncounter(page, game.id, second.id)
    await expect(page.getByRole('heading', { name: second.name })).toBeVisible()
    await expect(page.locator('.spellbook-tab.selected')).toContainText(second.name)

    await page.locator('.spellbook-tab').filter({ hasText: first.name }).click()
    await expect(page.getByRole('heading', { name: first.name })).toBeVisible()
    await expect(page).toHaveURL(new RegExp(`encounter=${first.id}`))
    await expect(page.locator('.encounter-entry-list .inventory-row')).toHaveCount(18)

    await page.reload()
    await expect(page.getByRole('heading', { name: first.name })).toBeVisible()
    await expect(page).toHaveURL(new RegExp(`encounter=${first.id}`))
    await expect(page.locator('.encounter-entry-list .inventory-row')).toHaveCount(18)

    await page.evaluate(() => window.scrollTo(0, 420))
    const savedPosition = await page.evaluate(() => Math.round(window.scrollY))
    expect(savedPosition).toBeGreaterThan(100)

    await page.locator('a').filter({ hasText: 'Print monster cards' }).evaluate((element) => (element as HTMLAnchorElement).click())
    await expect(page.getByRole('heading', { name: 'Choose encounters and creatures' })).toBeVisible()
    await expect(page.getByLabel('Encounters (select multiple)')).toHaveValues([first.id])

    await page.getByRole('link', { name: `← ${game.name} encounters` }).click()
    await expect(page.getByRole('heading', { name: first.name })).toBeVisible()
    await expect(page).toHaveURL(new RegExp(`encounter=${first.id}`))
    await expect(page.locator('.encounter-entry-list .inventory-row')).toHaveCount(18)
    await expect.poll(async () => Math.abs((await page.evaluate(() => Math.round(window.scrollY))) - savedPosition)).toBeLessThanOrEqual(12)

    await page.evaluate(() => window.scrollTo(0, 260))
    const browserBackPosition = await page.evaluate(() => Math.round(window.scrollY))
    expect(browserBackPosition).toBeGreaterThan(100)
    await page.locator('a').filter({ hasText: 'Print monster cards' }).evaluate((element) => (element as HTMLAnchorElement).click())
    await expect(page.getByRole('heading', { name: 'Choose encounters and creatures' })).toBeVisible()
    await page.goBack()
    await expect(page.getByRole('heading', { name: first.name })).toBeVisible()
    await expect(page).toHaveURL(new RegExp(`encounter=${first.id}`))
    await expect(page.locator('.encounter-entry-list .inventory-row')).toHaveCount(18)
    await expect.poll(async () => Math.abs((await page.evaluate(() => Math.round(window.scrollY))) - browserBackPosition)).toBeLessThanOrEqual(12)
  } finally {
    await cleanupGame(request, game.id)
  }
})

test('synchronizes same-mounted Back/Forward and external query links without letting stale loads win', async ({ page, request }) => {
  const systemId = await dnd5eSystem(request)
  const game = await createGame(request, systemId, uniqueName('Query sync game'))
  const first = await createRecord(request, 'encounters', { game: game.id, name: uniqueName('Sync first') })
  const second = await createRecord(request, 'encounters', { game: game.id, name: uniqueName('Sync second') })
  await createRecord(request, 'encounter_creatures', { encounter: first.id, name: 'Sync first marker', quantity: 1, notes: '', custom: true })
  await createRecord(request, 'encounter_creatures', { encounter: second.id, name: 'Sync second marker', quantity: 1, notes: '', custom: true })

  const pathFor = (encounterId: string) => `/games/${game.id}/encounters?encounter=${encounterId}`

  try {
    await openPreparedEncounter(page, game.id, first.id)
    await expect(page.getByRole('heading', { name: first.name })).toBeVisible()
    await expect(page.getByText('Sync first marker')).toBeVisible()

    await pushSameRoute(page, pathFor(second.id))
    await expect(page).toHaveURL(new RegExp(`encounter=${second.id}`))
    await expect(page.getByRole('heading', { name: second.name })).toBeVisible()
    await expect(page.getByText('Sync second marker')).toBeVisible()
    await expect(page.locator('.spellbook-tab.selected')).toContainText(second.name)

    await page.evaluate(() => window.history.back())
    await expect(page).toHaveURL(new RegExp(`encounter=${first.id}`))
    await expect(page.getByRole('heading', { name: first.name })).toBeVisible()
    await expect(page.getByText('Sync first marker')).toBeVisible()

    await page.evaluate(() => window.history.forward())
    await expect(page).toHaveURL(new RegExp(`encounter=${second.id}`))
    await expect(page.getByRole('heading', { name: second.name })).toBeVisible()
    await expect(page.getByText('Sync second marker')).toBeVisible()

    await page.route('**/api/collections/encounter_creatures/records**', async (route) => {
      const filter = new URL(route.request().url()).searchParams.get('filter') ?? ''
      if (filter.includes(first.id)) await new Promise((resolve) => setTimeout(resolve, 700))
      if (filter.includes(second.id)) await new Promise((resolve) => setTimeout(resolve, 40))
      await route.continue()
    })
    await pushSameRoute(page, pathFor(first.id))
    await pushSameRoute(page, pathFor(second.id))
    await expect(page.getByRole('heading', { name: second.name })).toBeVisible()
    await expect(page.getByText('Sync second marker')).toBeVisible()
    await page.waitForTimeout(850)
    await expect(page.getByRole('heading', { name: second.name })).toBeVisible()
    await expect(page.getByText('Sync second marker')).toBeVisible()
    await expect(page.getByText('Sync first marker')).toHaveCount(0)
    await page.unroute('**/api/collections/encounter_creatures/records**')
  } finally {
    await cleanupGame(request, game.id)
  }
})

test('keeps switching atomic and rejects A to B to A responses that match only the final id', async ({ page, request }) => {
  const systemId = await dnd5eSystem(request)
  const game = await createGame(request, systemId, uniqueName('Atomic switch game'))
  const first = await createRecord(request, 'encounters', { game: game.id, name: uniqueName('Atomic first') })
  const second = await createRecord(request, 'encounters', { game: game.id, name: uniqueName('Atomic second') })
  await createRecord(request, 'encounter_creatures', { encounter: first.id, name: 'Generation A real marker', quantity: 1, notes: '', custom: true })
  await createRecord(request, 'encounter_creatures', { encounter: second.id, name: 'Generation B marker', quantity: 1, notes: '', custom: true })

  let releaseFirstA = () => {}
  let releaseB = () => {}
  const firstAGate = new Promise<void>((resolve) => { releaseFirstA = resolve })
  const bGate = new Promise<void>((resolve) => { releaseB = resolve })
  let firstARequests = 0

  try {
    await openPreparedEncounter(page, game.id, first.id)
    await expect(page.getByText('Generation A real marker')).toBeVisible()

    await page.route('**/api/collections/encounter_creatures/records**', async (route) => {
      const filter = new URL(route.request().url()).searchParams.get('filter') ?? ''
      if (filter.includes(first.id)) {
        firstARequests++
        if (firstARequests === 1) {
          await firstAGate
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
              page: 1,
              perPage: 500,
              totalItems: 1,
              totalPages: 1,
              items: [{ id: 'stale-a-entry', encounter: first.id, creature: '', name: 'Stale A response marker', quantity: 1, notes: '', custom: true }],
            }),
          })
          return
        }
        await route.continue()
        return
      }
      if (filter.includes(second.id)) {
        await bGate
        await route.continue()
        return
      }
      await route.continue()
    })

    await page.locator('.spellbook-tab').filter({ hasText: second.name }).click()
    await expect(page.locator('.encounter-switching')).toBeVisible()
    await expect(page.locator('.encounter-switching')).toContainText(second.name)
    await expect(page.getByText('Generation A real marker')).toHaveCount(0)
    await expect(page.getByText('Generation B marker')).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Start combat' })).toHaveCount(0)
    await expect(page.getByRole('link', { name: 'Print monster cards' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Save' })).toHaveCount(0)

    await page.locator('.spellbook-tab').filter({ hasText: first.name }).click()
    await page.locator('.spellbook-tab').filter({ hasText: second.name }).click()
    await page.locator('.spellbook-tab').filter({ hasText: first.name }).click()
    await expect(page.getByRole('heading', { name: first.name })).toBeVisible()
    await expect(page.getByText('Generation A real marker')).toBeVisible()
    await expect(page.locator('.encounter-entry-list .inventory-row')).toHaveCount(1)
    await expect(page.locator('.encounter-switching')).toHaveCount(0)

    releaseFirstA()
    releaseB()
    await page.waitForTimeout(300)
    await expect(page.getByRole('heading', { name: first.name })).toBeVisible()
    await expect(page.getByText('Generation A real marker')).toBeVisible()
    await expect(page.getByText('Stale A response marker')).toHaveCount(0)
    await expect(page.getByText('Generation B marker')).toHaveCount(0)
    await expect(page.locator('.encounter-entry-list .inventory-row')).toHaveCount(1)
    await expect(page.getByRole('button', { name: 'Start combat' })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Print monster cards' })).toBeVisible()
    await page.unroute('**/api/collections/encounter_creatures/records**')
  } finally {
    releaseFirstA()
    releaseB()
    await cleanupGame(request, game.id)
  }
})

test('returns from print to the originating preparation even when print selections change', async ({ page, request }) => {
  const systemId = await dnd5eSystem(request)
  const game = await createGame(request, systemId, uniqueName('Print origin game'))
  const first = await createRecord(request, 'encounters', { game: game.id, name: uniqueName('Print origin first') })
  const second = await createRecord(request, 'encounters', { game: game.id, name: uniqueName('Print origin second') })
  const third = await createRecord(request, 'encounters', { game: game.id, name: uniqueName('Print origin third') })
  await createRecord(request, 'encounter_creatures', { encounter: first.id, name: 'Origin first marker', quantity: 1, notes: '', custom: true })
  await createRecord(request, 'encounter_creatures', { encounter: second.id, name: 'Origin second marker', quantity: 1, notes: '', custom: true })
  await createRecord(request, 'encounter_creatures', { encounter: third.id, name: 'Origin third marker', quantity: 1, notes: '', custom: true })

  try {
    await openPreparedEncounter(page, game.id, first.id)
    await page.locator('a').filter({ hasText: 'Print monster cards' }).click()
    await expect(page.getByRole('heading', { name: 'Choose encounters and creatures' })).toBeVisible()
    await expect(page.getByLabel('Encounters (select multiple)')).toHaveValues([first.id])

    await page.getByLabel('Encounters (select multiple)').selectOption([second.id, third.id])
    await expect(page.locator('.card-choice')).toHaveCount(2)
    await page.getByRole('link', { name: `← ${game.name} encounters` }).click()
    await expect(page).toHaveURL(new RegExp(`encounter=${first.id}`))
    await expect(page.getByRole('heading', { name: first.name })).toBeVisible()

    await page.goto(`/games/${game.id}/monsters/print?encounter=${second.id}`)
    await expect(page.getByRole('heading', { name: 'Choose encounters and creatures' })).toBeVisible()
    await expect(page.getByLabel('Encounters (select multiple)')).toHaveValues([second.id])
    await page.getByLabel('Encounters (select multiple)').selectOption([third.id])
    await expect(page.locator('.card-choice')).toHaveCount(1)
    await expect(page.locator('.card-choice')).toContainText('Origin third marker')
    await page.getByRole('link', { name: `← ${game.name} encounters` }).click()
    await expect(page).toHaveURL(new RegExp(`encounter=${second.id}`))
    await expect(page.getByRole('heading', { name: second.name })).toBeVisible()
  } finally {
    await cleanupGame(request, game.id)
  }
})

test('cancels delayed print position restoration when the user interacts during the return', async ({ page, request }) => {
  const systemId = await dnd5eSystem(request)
  const game = await createGame(request, systemId, uniqueName('Cancel restore game'))
  const encounter = await createRecord(request, 'encounters', { game: game.id, name: uniqueName('Cancel restore preparation') })
  for (let index = 1; index <= 18; index++) {
    await createRecord(request, 'encounter_creatures', { encounter: encounter.id, name: `Cancel marker ${String(index).padStart(2, '0')}`, quantity: 1, notes: '', custom: true })
  }

  try {
    await openPreparedEncounter(page, game.id, encounter.id)
    await expect(page.locator('.encounter-entry-list .inventory-row')).toHaveCount(18)
    await page.evaluate(() => window.scrollTo(0, 420))
    const savedPosition = await page.evaluate(() => Math.round(window.scrollY))
    expect(savedPosition).toBeGreaterThan(100)
    await page.locator('a').filter({ hasText: 'Print monster cards' }).evaluate((element) => (element as HTMLAnchorElement).click())
    await expect(page.getByRole('heading', { name: 'Choose encounters and creatures' })).toBeVisible()

    await page.route('**/api/collections/encounter_creatures/records**', async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 700))
      await route.continue()
    })
    await page.getByRole('link', { name: `← ${game.name} encounters` }).click()
    await page.mouse.wheel(0, 500)
    await page.keyboard.press('Tab')
    await expect(page.getByRole('heading', { name: encounter.name })).toBeVisible()
    await expect(page.locator('.encounter-entry-list .inventory-row')).toHaveCount(18)
    const finalPosition = await page.evaluate(() => Math.round(window.scrollY))
    expect(finalPosition).toBeLessThan(80)
    await page.unroute('**/api/collections/encounter_creatures/records**')
  } finally {
    await cleanupGame(request, game.id)
  }
})

test('starts combat from preparation and keeps reusable preparation changes out of the active combat', async ({ page, request }) => {
  const systemId = await dnd5eSystem(request)
  const game = await createGame(request, systemId, uniqueName('Start game'))
  const encounter = await createRecord(request, 'encounters', { game: game.id, name: uniqueName('Start preparation') })
  const creature = await createCreature(request, systemId, uniqueName('Synthetic Guard'))
  const catalogIds = [creature.id]
  await createRecord(request, 'encounter_creatures', { encounter: encounter.id, creature: creature.id, name: creature.name, quantity: 2, notes: 'Prepared twice.', custom: false })
  await createRecord(request, 'encounter_creatures', { encounter: encounter.id, name: 'Custom torchbearer', quantity: 1, notes: '', custom: true })

  try {
    await openPreparedEncounter(page, game.id, encounter.id)
    await expect(page.locator('.encounter-preparation')).toContainText('Changes here update the reusable encounter')
    await expect(page.locator('.encounter-live')).toContainText('Ready to start')
    const dimensions = await page.evaluate(() => ({ viewport: document.documentElement.clientWidth, document: document.documentElement.scrollWidth }))
    expect(dimensions.document).toBeLessThanOrEqual(dimensions.viewport)

    await page.getByRole('button', { name: 'Start combat' }).click()
    await expect(page.getByRole('heading', { name: 'Combat in progress' })).toBeVisible()
    await expect(page.locator('.combatant-card')).toHaveCount(3)
    await expect(page.locator('.combatant-card').filter({ hasText: `${creature.name} 1` })).toBeVisible()
    await expect(page.locator('.combatant-card').filter({ hasText: `${creature.name} 2` })).toBeVisible()
    await expect(page.locator('.combatant-card').filter({ hasText: 'Custom torchbearer' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Start combat' })).toHaveCount(0)

    const preparedRow = page.locator('.encounter-entry-list .inventory-row').filter({ hasText: creature.name })
    await preparedRow.getByLabel('Quantity').fill('5')
    await preparedRow.getByRole('button', { name: 'Save' }).click()
    await expect(preparedRow.getByLabel('Quantity')).toHaveValue('5')
    await expect(page.locator('.combatant-card')).toHaveCount(3)
    await expect(page.locator('.encounter-preparation')).toContainText('An active combat has its own participants and values.')

    await page.getByRole('button', { name: 'End combat' }).click()
    await expect(page.getByRole('heading', { name: 'Ready to start' })).toBeVisible()
    await expect(page.locator('.combatant-card')).toHaveCount(0)
  } finally {
    await cleanupGame(request, game.id, catalogIds)
  }
})

test('shows the empty preparation state and recovers from an initial load failure', async ({ page, request }) => {
  const systemId = await dnd5eSystem(request)
  const game = await createGame(request, systemId, uniqueName('Empty game'))
  const encounter = await createRecord(request, 'encounters', { game: game.id, name: uniqueName('Empty preparation') })

  try {
    await openPreparedEncounter(page, game.id, encounter.id)
    await expect(page.getByRole('heading', { name: 'No creatures prepared' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Start combat' })).toBeDisabled()
    await expect(page.locator('.spellbook-tab.selected')).toContainText('0 creature types')

    let requests = 0
    await page.route('**/api/collections/encounters/records**', async (route) => {
      requests++
      if (requests === 1) {
        await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ message: 'Synthetic load failure' }) })
        return
      }
      await route.continue()
    })
    await page.reload()
    await expect(page.getByRole('alert')).toContainText('Encounters could not be loaded')
    await page.getByRole('button', { name: 'Refresh' }).click()
    await expect(page.getByRole('heading', { name: encounter.name })).toBeVisible()
    await expect(page.getByRole('alert')).toHaveCount(0)
    await page.unroute('**/api/collections/encounters/records**')
  } finally {
    await cleanupGame(request, game.id)
  }
})

test('adds custom participants and labels a missing catalog record clearly', async ({ page, request }) => {
  const systemId = await dnd5eSystem(request)
  const game = await createGame(request, systemId, uniqueName('Custom game'))
  const encounter = await createRecord(request, 'encounters', { game: game.id, name: uniqueName('Custom preparation') })
  const creature = await createCreature(request, systemId, uniqueName('Vanishing creature'))
  await createRecord(request, 'encounter_creatures', { encounter: encounter.id, creature: creature.id, name: creature.name, quantity: 1, notes: 'Its catalog record will disappear.', custom: false })

  try {
    const removed = await request.delete(`${api}/catalog/records/${creature.id}`)
    expect(removed.ok(), await removed.text()).toBeTruthy()

    await openPreparedEncounter(page, game.id, encounter.id)
    const missingRow = page.locator('.encounter-entry-list .inventory-row').filter({ hasText: creature.name })
    await expect(missingRow).toContainText('Catalog record missing')

    await page.getByRole('button', { name: '＋ Add custom participant' }).click()
    const form = page.locator('.editor-panel')
    await form.getByLabel('Name').fill('Custom brute')
    await form.getByLabel('Quantity').fill('2')
    await form.getByLabel('Notes').fill('Carries the improvised key.')
    await form.getByRole('button', { name: 'Add participant' }).click()

    const customRow = page.locator('.encounter-entry-list .inventory-row').filter({ hasText: 'Custom brute' })
    await expect(customRow).toContainText('Custom participant')
    await expect(customRow.getByLabel('Quantity')).toHaveValue('2')
    await expect(customRow.getByLabel('Notes')).toHaveValue('Carries the improvised key.')
    await expect(page.locator('.encounter-entry-list .inventory-row')).toHaveCount(2)
  } finally {
    await cleanupGame(request, game.id)
  }
})

test('reports an uncertain combat start and recovers after refresh instead of claiming atomic creation', async ({ page, request }) => {
  const systemId = await dnd5eSystem(request)
  const game = await createGame(request, systemId, uniqueName('Failure game'))
  const encounter = await createRecord(request, 'encounters', { game: game.id, name: uniqueName('Failure preparation') })
  await createRecord(request, 'encounter_creatures', { encounter: encounter.id, name: 'Synthetic failure participant', quantity: 1, notes: '', custom: true })

  try {
    await page.route('**/api/collections/combatants/records', async (route) => {
      await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ message: 'Synthetic participant failure' }) })
    })
    await openPreparedEncounter(page, game.id, encounter.id)
    await page.getByRole('button', { name: 'Start combat' }).click()
    await expect(page.getByRole('alert')).toContainText('Combat could not be started. Refresh to check whether a partial combat remains.')

    await page.unroute('**/api/collections/combatants/records')
    await page.getByRole('button', { name: 'Refresh' }).click()
    await expect(page.getByRole('heading', { name: 'Ready to start' })).toBeVisible()
    await page.getByRole('button', { name: 'Start combat' }).click()
    await expect(page.getByRole('heading', { name: 'Combat in progress' })).toBeVisible()
    await expect(page.locator('.combatant-card')).toHaveCount(1)
  } finally {
    await cleanupGame(request, game.id)
  }
})
