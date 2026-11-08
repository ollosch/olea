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

async function systemIdByKey(request: APIRequestContext, key: string) {
  const response = await request.get(`${api}/systems/records?filter=${encodeURIComponent(`(key='${key}')`)}`)
  expect(response.ok(), await response.text()).toBeTruthy()
  return (await response.json() as { items: Array<{ id: string }> }).items[0]!.id
}

async function createGame(request: APIRequestContext, systemId: string, name: string, settings: Record<string, boolean> = {}) {
  return await createRecord(request, 'games', {
    name,
    system: systemId,
    encounter_visible: settings.encounter_visible ?? true,
    encounter_show_initiative: settings.encounter_show_initiative ?? true,
    encounter_show_enemy_names: settings.encounter_show_enemy_names ?? true,
    encounter_show_hp: settings.encounter_show_hp ?? true,
    encounter_show_conditions: settings.encounter_show_conditions ?? true,
  })
}

type ParticipantSeed = {
  name: string
  initiative?: number
  current?: number
  max?: number
  conditions?: string
  enemy?: boolean
}

async function createCombat(request: APIRequestContext, gameId: string, encounterName: string, seeds: ParticipantSeed[], activeIndex = 0) {
  const encounter = await createRecord(request, 'encounters', { game: gameId, name: encounterName })
  const combat = await createRecord(request, 'combats', { encounter: encounter.id, active: true, round: 1, turn: 0, tie_order: '[]', name: encounterName })
  const participants: Array<{ id: string; name: string }> = []
  for (const [index, seed] of seeds.entries()) {
    const participant = await createRecord(request, 'combatants', {
      combat: combat.id,
      name: seed.name,
      enemy: seed.enemy ?? true,
      sort_order: index,
      initiative: seed.initiative ?? 0,
      initiative_known: true,
      current_hp: seed.current ?? 10,
      max_hp: seed.max ?? 10,
      hp_known: true,
      conditions: seed.conditions ?? '',
    })
    participants.push({ id: participant.id, name: seed.name })
  }
  if (participants[activeIndex]) {
    const updated = await request.patch(`${api}/combats/records/${combat.id}`, { data: { active_participant: participants[activeIndex]!.id } })
    expect(updated.ok(), await updated.text()).toBeTruthy()
  }
  return { encounter, combat, participants }
}

async function openCombat(page: Page, gameId: string, encounterId: string) {
  await page.goto(`/games/${gameId}/encounters?encounter=${encounterId}`)
  await expect(page.getByRole('heading', { name: 'Combat in progress' })).toBeVisible()
  await expect(page.locator('.screen')).toHaveAttribute('data-live-state', 'live')
}

async function openPlayer(page: Page, gameId: string) {
  await page.goto(`/games/${gameId}/encounter`)
  await expect(page.locator('.screen')).toHaveAttribute('data-live-state', 'live')
}

function gmRow(page: Page, name: string) {
  return page.locator('.combatant-card').filter({ hasText: name })
}

function playerRow(page: Page, name: string) {
  return page.locator('.player-combatant-list .combatant-card').filter({ hasText: name })
}

async function cleanupGame(request: APIRequestContext, gameId: string) {
  const removed = await request.delete(`${api}/games/records/${gameId}`)
  expect(removed.ok(), `game cleanup: ${await removed.text()}`).toBeTruthy()
}

test('updates GM and player in place without loading, jumps or lost open work', async ({ browser, page, request }) => {
  test.setTimeout(45_000)
  const systemId = await systemIdByKey(request, 'dnd5e')
  const game = await createGame(request, systemId, uniqueName('Realtime in-place game'))
  const seeds: ParticipantSeed[] = Array.from({ length: 20 }, (_, index) => ({
    name: `Realtime participant ${String(index + 1).padStart(2, '0')}`,
    initiative: 20 - index,
    current: 10,
    max: 10,
  }))
  const { encounter, participants } = await createCombat(request, game.id, uniqueName('Realtime in-place combat'), seeds)
  const playerContext = await browser.newContext()

  try {
    const playerPage = await playerContext.newPage()
    await openCombat(page, game.id, encounter.id)
    await openPlayer(playerPage, game.id)
    await expect(playerPage.locator('.player-combatant-list .combatant-card')).toHaveCount(20)

    await playerPage.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
    const playerScroll = await playerPage.evaluate(() => Math.round(scrollY))
    expect(playerScroll).toBeGreaterThan(0)

    const last = gmRow(page, seeds[19]!.name)
    await last.scrollIntoViewIfNeeded()
    await last.locator('.combatant-summary').click()
    await last.getByLabel('Conditions').fill('GM live draft')
    const gmScroll = await page.evaluate(() => Math.round(scrollY))

    let releaseUpdate = () => {}
    const updateGate = new Promise<void>((resolve) => { releaseUpdate = resolve })
    let markRequested = () => {}
    const updateRequested = new Promise<void>((resolve) => { markRequested = resolve })
    await playerPage.route('**/api/collections/combatants/records?*', async (route) => {
      if (route.request().method() === 'GET') {
        markRequested()
        await updateGate
      }
      await route.continue()
    })

    const external = await request.patch(`${api}/combatants/records/${participants[0]!.id}`, { data: { current_hp: 3 } })
    expect(external.ok(), await external.text()).toBeTruthy()
    await updateRequested
    await expect(playerPage.getByText('Loading active encounter…')).toHaveCount(0)
    await expect(playerPage.locator('.player-combatant-list .combatant-card')).toHaveCount(20)
    await expect(playerRow(playerPage, seeds[0]!.name)).toContainText('HP 10/10')
    expect(await playerPage.evaluate(() => Math.round(scrollY))).toBe(playerScroll)
    await expect(last.locator('.combatant-summary')).toHaveAttribute('aria-expanded', 'true')
    await expect(last.getByLabel('Conditions')).toHaveValue('GM live draft')
    expect(await page.evaluate(() => Math.round(scrollY))).toBe(gmScroll)

    releaseUpdate()
    await expect(playerRow(playerPage, seeds[0]!.name)).toContainText('HP 3/10')
    await expect(playerPage.getByText('Loading active encounter…')).toHaveCount(0)
    expect(await playerPage.evaluate(() => Math.round(scrollY))).toBe(playerScroll)
    await expect(last.getByLabel('Conditions')).toHaveValue('GM live draft')

    await last.getByLabel('Damage or healing amount').fill('2')
    await last.getByRole('button', { name: 'Apply damage' }).click()
    await expect(last).toContainText('HP 8/10')
    await expect(playerRow(playerPage, seeds[19]!.name)).toContainText('HP 8/10')
    await expect(playerPage.getByText('Loading active encounter…')).toHaveCount(0)
    expect(await playerPage.evaluate(() => Math.round(scrollY))).toBe(playerScroll)
    await expect(last.getByLabel('Conditions')).toHaveValue('GM live draft')
  } finally {
    await playerContext.close()
    await cleanupGame(request, game.id)
  }
})

test('does not leak hidden initiative through player ordering or labels', async ({ browser, page, request }) => {
  test.setTimeout(30_000)
  const systemId = await systemIdByKey(request, 'dnd5e')
  const game = await createGame(request, systemId, uniqueName('Player visibility game'), {
    encounter_show_initiative: false,
    encounter_show_enemy_names: false,
    encounter_show_hp: false,
    encounter_show_conditions: false,
  })
  const { encounter } = await createCombat(request, game.id, uniqueName('Player visibility combat'), [
    { name: 'Order Alpha', initiative: 5, enemy: false, conditions: 'alpha condition' },
    { name: 'Order Bravo', initiative: 30, enemy: false },
    { name: 'Order Charlie', initiative: 20, enemy: false, conditions: 'charlie condition' },
    { name: 'Secret Lurker', initiative: 25, enemy: true, current: 3, max: 9, conditions: 'secret condition' },
  ], 1)
  const playerContext = await browser.newContext()

  try {
    const playerPage = await playerContext.newPage()
    await openPlayer(playerPage, game.id)
    const names = playerPage.locator('.player-combatant-list .combatant-title strong')
    await expect(names).toHaveCount(4)
    await expect.poll(() => names.allTextContents()).toEqual(['Order Alpha', 'Order Bravo', 'Order Charlie', 'Enemy'])
    await expect(playerPage.locator('.player-combatant-list')).not.toContainText('Init ')
    await expect(playerPage.getByText('Round 1')).toHaveCount(0)
    await expect(playerPage.locator('.player-combatant-list')).not.toContainText('alpha condition')
    await expect(playerPage.locator('.player-combatant-list')).not.toContainText('Secret Lurker')

    await openCombat(page, game.id, encounter.id)
    await page.getByText('Player display settings').click()
    await page.getByLabel('Show initiative', { exact: true }).check()
    await expect.poll(() => names.allTextContents()).toEqual(['Order Bravo', 'Enemy', 'Order Charlie', 'Order Alpha'])
    await expect(playerPage.locator('.player-combatant-list')).toContainText('Init 30')
    await expect(playerPage.getByText('Round 1')).toBeVisible()
    await expect(playerPage.getByText('Loading active encounter…')).toHaveCount(0)

    await page.getByLabel('Show enemy names', { exact: true }).check()
    await expect(playerPage.locator('.player-combatant-list')).toContainText('Secret Lurker')

    await page.getByLabel('Show conditions', { exact: true }).check()
    await expect(playerPage.locator('.player-combatant-list')).toContainText('alpha condition')
    await expect(playerPage.locator('.player-combatant-list')).toContainText('secret condition')

    await page.getByLabel('Show enemy HP', { exact: true }).check()
    await expect(playerRow(playerPage, 'Secret Lurker')).toContainText('HP 3/9')
    await expect(playerPage.getByText('Loading active encounter…')).toHaveCount(0)
  } finally {
    await playerContext.close()
    await cleanupGame(request, game.id)
  }
})

test('keeps an unsaved GM draft when another browser changes the same participant', async ({ browser, page, request }) => {
  test.setTimeout(30_000)
  const systemId = await systemIdByKey(request, 'dnd5e')
  const game = await createGame(request, systemId, uniqueName('Realtime draft game'))
  const { encounter, participants } = await createCombat(request, game.id, uniqueName('Realtime draft combat'), [
    { name: 'Draft target', initiative: 15 },
    { name: 'Draft witness', initiative: 10 },
  ])
  const secondContext = await browser.newContext()

  try {
    const secondPage = await secondContext.newPage()
    await openCombat(page, game.id, encounter.id)
    await openCombat(secondPage, game.id, encounter.id)
    const target = gmRow(page, 'Draft target')
    const otherTarget = gmRow(secondPage, 'Draft target')
    await target.locator('.combatant-summary').click()
    await otherTarget.locator('.combatant-summary').click()
    await target.getByLabel('Conditions').fill('Local GM draft')
    await target.getByLabel('Notes').fill('Keep this local note')
    const gmScroll = await page.evaluate(() => Math.round(scrollY))

    await otherTarget.getByLabel('Current HP').fill('4')
    await otherTarget.getByLabel('Conditions').fill('Other client value')
    await otherTarget.getByRole('button', { name: 'Save participant' }).click()
    await expect(otherTarget).toContainText('Other client value')

    await expect(target.locator('.combatant-summary')).toContainText('Other client value')
    await expect(target.locator('.combatant-summary')).toHaveAttribute('aria-expanded', 'true')
    await expect(target.getByLabel('Conditions')).toHaveValue('Local GM draft')
    await expect(target.getByLabel('Notes')).toHaveValue('Keep this local note')
    expect(await page.evaluate(() => Math.round(scrollY))).toBe(gmScroll)

    await target.getByRole('button', { name: 'Save participant' }).click()
    await expect(target.getByRole('alert')).toContainText('conflicts with another change')
    await expect(target.getByLabel('Conditions')).toHaveValue('Local GM draft')
    const beforeResolution = await request.get(`${api}/combatants/records/${participants[0]!.id}`)
    expect(await beforeResolution.json()).toMatchObject({ conditions: 'Other client value' })

    await target.getByRole('button', { name: 'Keep my draft and retry' }).click()
    await target.getByRole('button', { name: 'Save participant' }).click()
    await expect(target.locator('.combatant-summary')).toContainText('Local GM draft')
    const saved = await request.get(`${api}/combatants/records/${participants[0]!.id}`)
    expect(await saved.json()).toMatchObject({ conditions: 'Local GM draft', notes: 'Keep this local note' })
  } finally {
    await secondContext.close()
    await cleanupGame(request, game.id)
  }
})

test('moves the active turn and reorders initiatives without replacing either view', async ({ browser, page, request }) => {
  test.setTimeout(30_000)
  const systemId = await systemIdByKey(request, 'dnd5e')
  const game = await createGame(request, systemId, uniqueName('Realtime order game'))
  const seeds: ParticipantSeed[] = Array.from({ length: 8 }, (_, index) => ({
    name: `Order participant ${index + 1}`,
    initiative: 20 - index,
  }))
  const { encounter, combat, participants } = await createCombat(request, game.id, uniqueName('Realtime order combat'), seeds)
  const playerContext = await browser.newContext()

  try {
    const playerPage = await playerContext.newPage()
    await openCombat(page, game.id, encounter.id)
    await openPlayer(playerPage, game.id)
    await expect(playerPage.locator('.player-combatant-list .combatant-card')).toHaveCount(8)
    await playerPage.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
    const playerScroll = await playerPage.evaluate(() => Math.round(scrollY))

    const selected = gmRow(page, seeds[3]!.name)
    await selected.locator('.combatant-summary').click()
    await selected.getByLabel('Conditions').fill('Turn draft')

    const activeUpdate = await request.patch(`${api}/combats/records/${combat.id}`, { data: { active_participant: participants[5]!.id } })
    expect(activeUpdate.ok(), await activeUpdate.text()).toBeTruthy()
    await expect(playerPage.locator('.player-combatant-list .combatant-card.active')).toContainText(seeds[5]!.name)
    await expect(selected.locator('.combatant-summary')).toHaveAttribute('aria-expanded', 'true')
    await expect(selected.getByLabel('Conditions')).toHaveValue('Turn draft')
    expect(await playerPage.evaluate(() => Math.round(scrollY))).toBe(playerScroll)
    await expect(playerPage.getByText('Loading active encounter…')).toHaveCount(0)

    const initiativeUpdate = await request.patch(`${api}/combatants/records/${participants[0]!.id}`, { data: { initiative: 1 } })
    expect(initiativeUpdate.ok(), await initiativeUpdate.text()).toBeTruthy()
    const names = playerPage.locator('.player-combatant-list .combatant-title strong')
    await expect.poll(() => names.allTextContents()).toEqual([
      'Order participant 2',
      'Order participant 3',
      'Order participant 4',
      'Order participant 5',
      'Order participant 6',
      'Order participant 7',
      'Order participant 8',
      'Order participant 1',
    ])
    await expect(playerPage.locator('.player-combatant-list .combatant-card.active')).toContainText(seeds[5]!.name)
    await expect(selected.locator('.combatant-summary')).toHaveAttribute('aria-expanded', 'true')
    await expect(selected.getByLabel('Conditions')).toHaveValue('Turn draft')
    // The list legitimately reorders; browser anchoring may shift by one compact row,
    // but the view must not return to the top or replace itself with a loader.
    const reorderedScroll = await playerPage.evaluate(() => Math.round(scrollY))
    expect(reorderedScroll).toBeGreaterThan(0)
    expect(Math.abs(reorderedScroll - playerScroll)).toBeLessThanOrEqual(160)
    await expect(playerPage.getByText('Loading active encounter…')).toHaveCount(0)
  } finally {
    await playerContext.close()
    await cleanupGame(request, game.id)
  }
})

test('shows offline and reconnect feedback, then reconciles the player without a loading replacement', async ({ browser, page, request }) => {
  test.setTimeout(30_000)
  const systemId = await systemIdByKey(request, 'dnd5e')
  const game = await createGame(request, systemId, uniqueName('Realtime reconnect game'))
  const seeds: ParticipantSeed[] = Array.from({ length: 12 }, (_, index) => ({
    name: `Reconnect participant ${String(index + 1).padStart(2, '0')}`,
    initiative: 15 - index,
  }))
  const { encounter, participants } = await createCombat(request, game.id, uniqueName('Realtime reconnect combat'), seeds)
  const playerContext = await browser.newContext()

  try {
    const playerPage = await playerContext.newPage()
    await openPlayer(playerPage, game.id)
    await expect(playerPage.locator('.player-combatant-list .combatant-card')).toHaveCount(12)
    await playerPage.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
    const playerScroll = await playerPage.evaluate(() => Math.round(scrollY))

    await playerContext.setOffline(true)
    await playerPage.evaluate(() => window.dispatchEvent(new Event('offline')))
    await expect(playerPage.getByText(/You are offline/)).toBeVisible()

    const offlineChange = await request.patch(`${api}/combatants/records/${participants[0]!.id}`, { data: { current_hp: 2 } })
    expect(offlineChange.ok(), await offlineChange.text()).toBeTruthy()
    await expect(playerRow(playerPage, seeds[0]!.name)).toContainText('HP 10/10')

    await playerContext.setOffline(false)
    await playerPage.evaluate(() => {
      window.dispatchEvent(new Event('online'))
      window.dispatchEvent(new Event('focus'))
    })
    await expect(playerRow(playerPage, seeds[0]!.name)).toContainText('HP 2/10')
    await expect(playerPage.locator('.screen')).toHaveAttribute('data-live-state', 'live')
    await expect(playerPage.getByText('Loading active encounter…')).toHaveCount(0)
    expect(await playerPage.evaluate(() => Math.round(scrollY))).toBe(playerScroll)
  } finally {
    await playerContext.close()
    await cleanupGame(request, game.id)
  }
})

test('does not replay an uncertain live write after reconnect', async ({ page, request }) => {
  test.setTimeout(30_000)
  const systemId = await systemIdByKey(request, 'dnd5e')
  const game = await createGame(request, systemId, uniqueName('Realtime uncertain game'))
  const { encounter, participants } = await createCombat(request, game.id, uniqueName('Realtime uncertain combat'), [
    { name: 'Uncertain target', initiative: 10, current: 7, max: 7 },
  ])

  try {
    await openCombat(page, game.id, encounter.id)
    const target = gmRow(page, 'Uncertain target')
    await target.locator('.combatant-summary').click()
    let updatePosts = 0
    await page.route('**/api/olea/records/combatants/*/update', async (route) => {
      if (route.request().method() !== 'POST') { await route.continue(); return }
      updatePosts++
      await route.fetch()
      await route.abort('failed')
    })
    await target.getByLabel('Damage or healing amount').fill('2')
    await target.getByRole('button', { name: 'Apply damage' }).click()
    await expect(target.getByRole('alert')).toContainText('could not be confirmed')
    expect(updatePosts).toBe(1)
    const committed = await request.get(`${api}/combatants/records/${participants[0]!.id}`)
    expect((await committed.json() as { current_hp: number }).current_hp).toBe(5)

    await page.context().setOffline(true)
    await page.evaluate(() => window.dispatchEvent(new Event('offline')))
    await expect(page.getByText(/You are offline/)).toBeVisible()
    await page.context().setOffline(false)
    await page.evaluate(() => {
      window.dispatchEvent(new Event('online'))
      window.dispatchEvent(new Event('focus'))
    })
    await expect(target).toContainText('HP 5/7')
    await page.waitForTimeout(300)
    expect(updatePosts).toBe(1)

    await target.getByRole('button', { name: 'Refresh live state' }).click()
    await expect(target.getByRole('button', { name: 'Apply damage' })).toBeEnabled()
    expect(updatePosts).toBe(1)
    await page.unroute('**/api/olea/records/combatants/*/update')
  } finally {
    await cleanupGame(request, game.id)
  }
})

test('reconciles concurrent visibility and combatant changes without showing stale data', async ({ browser, page, request }) => {
  test.setTimeout(30_000)
  const systemId = await systemIdByKey(request, 'dnd5e')
  const game = await createGame(request, systemId, uniqueName('Realtime visibility race game'))
  const { encounter, participants } = await createCombat(request, game.id, uniqueName('Realtime visibility race combat'), [
    { name: 'Visibility target', initiative: 10, current: 7, max: 7 },
  ])
  const playerContext = await browser.newContext()

  try {
    const playerPage = await playerContext.newPage()
    await openPlayer(playerPage, game.id)
    await expect(playerRow(playerPage, 'Visibility target')).toContainText('HP 7/7')

    let releaseGames = () => {}
    const gamesGate = new Promise<void>((resolve) => { releaseGames = resolve })
    let markGamesHeld = () => {}
    const gamesHeld = new Promise<void>((resolve) => { markGamesHeld = resolve })
    let heldOnce = false
    await playerPage.route(`**/api/collections/games/records/${game.id}**`, async (route) => {
      if (!heldOnce && route.request().method() === 'GET') {
        heldOnce = true
        markGamesHeld()
        await gamesGate
      }
      await route.continue()
    })

    const hidden = await request.patch(`${api}/games/records/${game.id}`, { data: { encounter_visible: false } })
    expect(hidden.ok(), await hidden.text()).toBeTruthy()
    await gamesHeld
    const combatantChange = await request.patch(`${api}/combatants/records/${participants[0]!.id}`, { data: { current_hp: 1 } })
    expect(combatantChange.ok(), await combatantChange.text()).toBeTruthy()

    releaseGames()
    await expect(playerPage.getByRole('heading', { name: 'No player encounter is visible' })).toBeVisible()
    await expect(playerPage.locator('.player-combatant-list')).toHaveCount(0)
    await expect(playerPage.getByText('Loading active encounter…')).toHaveCount(0)

    const shown = await request.patch(`${api}/games/records/${game.id}`, { data: { encounter_visible: true } })
    expect(shown.ok(), await shown.text()).toBeTruthy()
    await expect(playerRow(playerPage, 'Visibility target')).toContainText('HP 1/7')
    await expect(playerPage.locator('.screen')).toHaveAttribute('data-live-state', 'live')
    await expect(playerPage.getByText('Loading active encounter…')).toHaveCount(0)
    await playerPage.unroute(`**/api/collections/games/records/${game.id}**`)
  } finally {
    await playerContext.close()
    await cleanupGame(request, game.id)
  }
})

test('subscribes before reconciling a reconnect and keeps changes made during the refresh', async ({ browser, page, request }) => {
  test.setTimeout(45_000)
  const systemId = await systemIdByKey(request, 'dnd5e')
  const game = await createGame(request, systemId, uniqueName('Realtime reconnect gap game'))
  const { encounter, participants } = await createCombat(request, game.id, uniqueName('Realtime reconnect gap combat'), [
    { name: 'Gap target', initiative: 12, current: 7, max: 7 },
    { name: 'Gap witness', initiative: 8, current: 7, max: 7 },
  ])
  const playerContext = await browser.newContext()

  try {
    const playerPage = await playerContext.newPage()
    await openPlayer(playerPage, game.id)
    await expect(playerRow(playerPage, 'Gap target')).toContainText('HP 7/7')
    await playerPage.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
    const playerScroll = await playerPage.evaluate(() => Math.round(scrollY))

    await playerContext.setOffline(true)
    await playerPage.evaluate(() => window.dispatchEvent(new Event('offline')))
    await expect(playerPage.getByText(/You are offline/)).toBeVisible()

    let releaseCombatants = () => {}
    const combatantsGate = new Promise<void>((resolve) => { releaseCombatants = resolve })
    let markCaptured = () => {}
    const capturedOldResponse = new Promise<void>((resolve) => { markCaptured = resolve })
    let heldOnce = false
    await playerPage.route('**/api/collections/combatants/records?*', async (route) => {
      if (!heldOnce && route.request().method() === 'GET') {
        heldOnce = true
        const response = await route.fetch()
        markCaptured()
        await combatantsGate
        await route.fulfill({ response })
        return
      }
      await route.continue()
    })

    await playerContext.setOffline(false)
    await playerPage.evaluate(() => {
      window.dispatchEvent(new Event('online'))
      window.dispatchEvent(new Event('focus'))
    })
    await capturedOldResponse
    const combatantChange = await request.patch(`${api}/combatants/records/${participants[0]!.id}`, { data: { current_hp: 1 } })
    expect(combatantChange.ok(), await combatantChange.text()).toBeTruthy()
    const gameChange = await request.patch(`${api}/games/records/${game.id}`, { data: { encounter_show_initiative: false } })
    expect(gameChange.ok(), await gameChange.text()).toBeTruthy()

    releaseCombatants()
    await expect(playerRow(playerPage, 'Gap target')).toContainText('HP 1/7')
    await expect(playerPage.locator('.player-combatant-list')).not.toContainText('Init ')
    await expect(playerPage.getByText('Round 1')).toHaveCount(0)
    await expect(playerPage.locator('.screen')).toHaveAttribute('data-live-state', 'live')
    await expect(playerPage.getByText('Loading active encounter…')).toHaveCount(0)
    const reconnectedScroll = await playerPage.evaluate(() => Math.round(scrollY))
    expect(reconnectedScroll).toBeGreaterThan(0)
    expect(Math.abs(reconnectedScroll - playerScroll)).toBeLessThanOrEqual(160)
    await playerPage.unroute('**/api/collections/combatants/records?*')
  } finally {
    await playerContext.close()
    await cleanupGame(request, game.id)
  }
})

test('recovers from a failed realtime subscription and resumes live updates', async ({ browser, page, request }) => {
  test.setTimeout(45_000)
  const systemId = await systemIdByKey(request, 'dnd5e')
  const game = await createGame(request, systemId, uniqueName('Realtime subscription recovery game'))
  const { encounter, participants } = await createCombat(request, game.id, uniqueName('Realtime subscription recovery combat'), [
    { name: 'Recovery target', initiative: 10, current: 7, max: 7 },
  ])
  const playerContext = await browser.newContext()

  try {
    const playerPage = await playerContext.newPage()
    await playerPage.route('**/api/realtime**', (route) => route.abort('failed'))
    await playerPage.goto(`/games/${game.id}/encounter`)
    await expect(playerPage.locator('.player-combatant-list .combatant-card')).toHaveCount(1)
    await expect(playerPage.getByText(/Live updates are unavailable/)).toBeVisible()
    await expect(playerPage.locator('.screen')).toHaveAttribute('data-live-state', 'unavailable')

    await playerPage.unroute('**/api/realtime**')
    await playerPage.getByRole('button', { name: 'Retry live updates' }).click()
    await expect(playerPage.locator('.screen')).toHaveAttribute('data-live-state', 'live')

    const changed = await request.patch(`${api}/combatants/records/${participants[0]!.id}`, { data: { current_hp: 4 } })
    expect(changed.ok(), await changed.text()).toBeTruthy()
    await expect(playerRow(playerPage, 'Recovery target')).toContainText('HP 4/7')
  } finally {
    await playerContext.close()
    await cleanupGame(request, game.id)
  }
})

test('reconciles a GM refresh superseded by another change while preserving the open draft', async ({ page, request }) => {
  test.setTimeout(30_000)
  const systemId = await systemIdByKey(request, 'dnd5e')
  const game = await createGame(request, systemId, uniqueName('Realtime GM race game'))
  const { encounter, participants } = await createCombat(request, game.id, uniqueName('Realtime GM race combat'), [
    { name: 'GM race target', initiative: 10, current: 7, max: 7 },
    { name: 'GM race witness', initiative: 8, current: 7, max: 7 },
  ])

  try {
    await openCombat(page, game.id, encounter.id)
    const target = gmRow(page, 'GM race target')
    await target.locator('.combatant-summary').click()
    await target.getByLabel('Conditions').fill('Local GM race draft')

    let releaseCombatants = () => {}
    const combatantsGate = new Promise<void>((resolve) => { releaseCombatants = resolve })
    let markCaptured = () => {}
    const capturedOldResponse = new Promise<void>((resolve) => { markCaptured = resolve })
    let heldOnce = false
    await page.route('**/api/collections/combatants/records?*', async (route) => {
      if (!heldOnce && route.request().method() === 'GET') {
        heldOnce = true
        const response = await route.fetch()
        markCaptured()
        await combatantsGate
        await route.fulfill({ response })
        return
      }
      await route.continue()
    })

    const firstChange = await request.patch(`${api}/combatants/records/${participants[0]!.id}`, { data: { current_hp: 4 } })
    expect(firstChange.ok(), await firstChange.text()).toBeTruthy()
    await capturedOldResponse
    const secondChange = await request.patch(`${api}/combatants/records/${participants[0]!.id}`, { data: { conditions: 'Late server change' } })
    expect(secondChange.ok(), await secondChange.text()).toBeTruthy()

    releaseCombatants()
    await expect(target).toContainText('HP 4/7')
    await expect(target.locator('.combatant-summary')).toContainText('Late server change')
    await expect(target.locator('.combatant-summary')).toHaveAttribute('aria-expanded', 'true')
    await expect(target.getByLabel('Conditions')).toHaveValue('Local GM race draft')
    await expect(page.locator('.screen')).toHaveAttribute('data-live-state', 'live')
    expect(await page.getByText('Loading encounters…').count()).toBe(0)
    await page.unroute('**/api/collections/combatants/records?*')
  } finally {
    await cleanupGame(request, game.id)
  }
})

test('fails closed when a visibility change cannot be confirmed, then recovers', async ({ browser, page, request }) => {
  test.setTimeout(30_000)
  const systemId = await systemIdByKey(request, 'dnd5e')
  const game = await createGame(request, systemId, uniqueName('Realtime visibility failure game'))
  const { encounter, participants } = await createCombat(request, game.id, uniqueName('Realtime visibility failure combat'), [
    { name: 'Failure target', initiative: 11, current: 6, max: 6 },
  ])
  const playerContext = await browser.newContext()

  try {
    const playerPage = await playerContext.newPage()
    await openPlayer(playerPage, game.id)
    await expect(playerRow(playerPage, 'Failure target')).toContainText('HP 6/6')

    let failedOnce = false
    await playerPage.route(`**/api/collections/games/records/${game.id}**`, async (route) => {
      if (!failedOnce && route.request().method() === 'GET') {
        failedOnce = true
        await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ message: 'Synthetic visibility failure' }) })
        return
      }
      await route.continue()
    })
    const changed = await request.patch(`${api}/games/records/${game.id}`, { data: { encounter_show_initiative: false } })
    expect(changed.ok(), await changed.text()).toBeTruthy()
    await expect(playerPage.getByRole('heading', { name: 'Live encounter unavailable' })).toBeVisible()
    await expect(playerPage.locator('.player-combatant-list')).toHaveCount(0)
    await expect(playerPage.getByText(/Latest live changes could not be loaded|could not be confirmed/)).toBeVisible()

    await playerPage.unroute(`**/api/collections/games/records/${game.id}**`)
    await playerPage.locator('.feedback-slot').getByRole('button', { name: 'Retry live updates' }).click()
    await expect(playerRow(playerPage, 'Failure target')).toContainText('HP 6/6')
    await expect(playerPage.locator('.player-combatant-list')).not.toContainText('Init ')
    await expect(playerPage.locator('.screen')).toHaveAttribute('data-live-state', 'live')
  } finally {
    await playerContext.close()
    await cleanupGame(request, game.id)
  }
})
