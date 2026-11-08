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

type ParticipantSeed = { name: string; initiative?: number; known?: boolean; current?: number; max?: number; hpKnown?: boolean; conditions?: string; enemy?: boolean }

async function createCombat(request: APIRequestContext, gameId: string, encounterName: string, seeds: ParticipantSeed[]) {
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
      initiative_known: seed.known ?? true,
      current_hp: seed.current ?? 0,
      max_hp: seed.max ?? 0,
      hp_known: seed.hpKnown ?? true,
      conditions: seed.conditions ?? '',
    })
    participants.push({ id: participant.id, name: seed.name })
  }
  if (participants[0]) {
    const updated = await request.patch(`${api}/combats/records/${combat.id}`, { data: { active_participant: participants[0].id } })
    expect(updated.ok(), await updated.text()).toBeTruthy()
  }
  return { encounter, combat, participants }
}

async function openCombat(page: Page, gameId: string, encounterId: string) {
  await page.goto(`/games/${gameId}/encounters?encounter=${encounterId}`)
  await expect(page.getByRole('heading', { name: 'Combat in progress' })).toBeVisible()
}

function row(page: Page, name: string) {
  return page.locator('.combatant-card').filter({ hasText: name })
}

async function selectRow(page: Page, name: string) {
  await row(page, name).locator('.combatant-summary').click()
}

async function cleanupGame(request: APIRequestContext, gameId: string) {
  const removed = await request.delete(`${api}/games/records/${gameId}`)
  expect(removed.ok(), `game cleanup: ${await removed.text()}`).toBeTruthy()
}

test('keeps a compact ordered roster and applies entered damage, healing, direct corrections and conditions', async ({ page, request }) => {
  test.setTimeout(30_000)
  const systemId = await systemIdByKey(request, 'dnd5e')
  const game = await createGame(request, systemId, uniqueName('Live roster game'))
  const seeds: ParticipantSeed[] = Array.from({ length: 20 }, (_, index) => ({
    name: `Roster participant ${String(index + 1).padStart(2, '0')}`,
    initiative: 20 - index,
    current: 10,
    max: 10,
  }))
  seeds[19] = { name: 'Roster participant 20', known: false, hpKnown: false, current: 0, max: 0, enemy: true }
  const { encounter, combat, participants } = await createCombat(request, game.id, uniqueName('Live roster combat'), seeds)

  try {
    await openCombat(page, game.id, encounter.id)
    await expect(page.locator('.combatant-card')).toHaveCount(20)
    await expect(page.locator('.combatant-details')).toHaveCount(1)
    await expect(page.getByLabel('Current HP')).toHaveCount(1)
    const dimensions = await page.evaluate(() => ({ viewport: document.documentElement.clientWidth, document: document.documentElement.scrollWidth }))
    expect(dimensions.document).toBeLessThanOrEqual(dimensions.viewport)
    await expect(page.locator('.turn-controls')).toContainText(`Active: ${seeds[0].name}`)
    await expect(row(page, seeds[0].name)).toContainText('HP 10/10')
    await expect(row(page, seeds[19].name)).toContainText('HP unknown')
    await expect(row(page, seeds[19].name)).toContainText('No initiative')

    const first = row(page, seeds[0].name)
    await first.getByLabel('Damage or healing amount').fill('3')
    await first.getByRole('button', { name: 'Apply damage' }).click()
    await expect(first).toContainText('HP 7/10')

    await first.getByLabel('Damage or healing amount').fill('1')
    await first.getByRole('button', { name: 'Apply healing' }).click()
    await expect(first).toContainText('HP 8/10')

    await first.getByLabel('Damage or healing amount').fill('20')
    await first.getByRole('button', { name: 'Apply damage' }).click()
    await expect(page.getByRole('alert').filter({ hasText: 'Damage is more than the current 8 HP' })).toBeVisible()
    await expect(first).toContainText('HP 8/10')

    await first.getByLabel('Damage or healing amount').fill('20')
    await first.getByRole('button', { name: 'Apply healing' }).click()
    await expect(page.getByRole('alert').filter({ hasText: 'Healing would exceed max HP 10' })).toBeVisible()
    await expect(first).toContainText('HP 8/10')

    await first.getByLabel('Current HP').fill('0')
    await first.getByLabel('Max HP').fill('10')
    await first.getByRole('button', { name: 'Save participant' }).click()
    await expect(first).toContainText('HP 0/10')

    await first.getByLabel('Damage or healing amount').fill('2')
    await first.getByRole('button', { name: 'Apply healing' }).click()
    await expect(first).toContainText('HP 2/10')

    await first.getByLabel('Conditions').fill('Prone')
    await first.getByRole('button', { name: 'Save participant' }).click()
    await expect(first).toContainText('Prone')

    const unknown = row(page, seeds[19].name)
    await unknown.locator('.combatant-summary').click()
    await expect(unknown).toContainText('HP is unknown')
    await unknown.getByLabel('Damage or healing amount').fill('2')
    await unknown.getByRole('button', { name: 'Apply damage' }).click()
    await expect(page.getByRole('alert').filter({ hasText: 'HP is unknown' })).toBeVisible()
    await expect(unknown).toContainText('HP unknown')

    await unknown.getByLabel('Current HP').fill('8')
    await unknown.getByLabel('Max HP').fill('8')
    await unknown.getByRole('button', { name: 'Save participant' }).click()
    await expect(unknown).toContainText('HP 8/8')

    const stored = await request.get(`${api}/combatants/records/${participants[0]!.id}`)
    expect((await stored.json() as { current_hp: number; max_hp: number; hp_known: boolean; conditions: string }).current_hp).toBe(2)
    const active = await request.get(`${api}/combats/records/${combat.id}`)
    expect((await active.json() as { active_participant: string }).active_participant).toBe(participants[0]!.id)
  } finally {
    await cleanupGame(request, game.id)
  }
})

test('keeps the active participant when initiative and tie order change', async ({ page, request }) => {
  const systemId = await systemIdByKey(request, 'dnd5e')
  const game = await createGame(request, systemId, uniqueName('Live order game'))
  const { encounter, combat, participants } = await createCombat(request, game.id, uniqueName('Live order combat'), [
    { name: 'Order alpha', initiative: 12, current: 10, max: 10 },
    { name: 'Order bravo', initiative: 15, current: 10, max: 10 },
    { name: 'Order charlie', initiative: 10, current: 10, max: 10 },
  ])

  try {
    await openCombat(page, game.id, encounter.id)
    await expect(page.locator('.combatant-card').first()).toContainText('Order bravo')
    await expect(page.locator('.combatant-card.active')).toContainText('Order alpha')

    await selectRow(page, 'Order alpha')
    const alpha = row(page, 'Order alpha')
    await alpha.getByLabel('Initiative', { exact: true }).fill('20')
    await alpha.getByRole('button', { name: 'Save participant' }).click()
    await expect(page.locator('.combatant-card').first()).toContainText('Order alpha')
    await expect(page.locator('.combatant-card.active')).toContainText('Order alpha')

    await selectRow(page, 'Order charlie')
    const charlie = row(page, 'Order charlie')
    await charlie.getByLabel('Initiative', { exact: true }).fill('15')
    await charlie.getByRole('button', { name: 'Save participant' }).click()
    await expect.poll(() => page.locator('.combatant-copy strong').allTextContents()).toEqual(['Order alpha', 'Order bravo', 'Order charlie'])

    await charlie.getByRole('button', { name: 'Participant actions for Order charlie' }).click()
    await page.getByRole('menuitem', { name: 'Move up in tie order' }).click()
    await expect.poll(() => page.locator('.combatant-copy strong').allTextContents()).toEqual(['Order alpha', 'Order charlie', 'Order bravo'])
    await expect(page.locator('.combatant-card.active')).toContainText('Order alpha')

    const active = await request.get(`${api}/combats/records/${combat.id}`)
    expect((await active.json() as { active_participant: string }).active_participant).toBe(participants[0]!.id)
  } finally {
    await cleanupGame(request, game.id)
  }
})

test('supports manual tie ordering without automatic initiative controls', async ({ page, request }) => {
  const systemId = await systemIdByKey(request, 'adnd2e')
  const game = await createGame(request, systemId, uniqueName('Manual order game'))
  const { encounter, combat, participants } = await createCombat(request, game.id, uniqueName('Manual order combat'), [
    { name: 'Manual one', current: 5, max: 5 },
    { name: 'Manual two', current: 5, max: 5 },
    { name: 'Manual three', current: 5, max: 5 },
  ])

  try {
    await openCombat(page, game.id, encounter.id)
    await expect(page.locator('.encounter-live')).toContainText('Initiative and turn order are manual.')
    await expect(page.getByRole('button', { name: 'Roll group' })).toHaveCount(0)
    await selectRow(page, 'Manual two')
    const second = row(page, 'Manual two')
    await second.getByRole('button', { name: 'Participant actions for Manual two' }).click()
    await expect(page.getByRole('menuitem', { name: 'Roll initiative' })).toHaveCount(0)
    await page.getByRole('menuitem', { name: 'Move up in tie order' }).click()
    await expect.poll(() => page.locator('.combatant-copy strong').allTextContents()).toEqual(['Manual two', 'Manual one', 'Manual three'])
    await expect(page.locator('.combatant-card.active')).toContainText('Manual one')

    const active = await request.get(`${api}/combats/records/${combat.id}`)
    expect((await active.json() as { active_participant: string }).active_participant).toBe(participants[0]!.id)
  } finally {
    await cleanupGame(request, game.id)
  }
})

test('wraps rounds forward and backward without losing the active participant', async ({ page, request }) => {
  const systemId = await systemIdByKey(request, 'dnd5e')
  const game = await createGame(request, systemId, uniqueName('Round wrap game'))
  const { encounter } = await createCombat(request, game.id, uniqueName('Round wrap combat'), [
    { name: 'Wrap one', initiative: 15, current: 5, max: 5 },
    { name: 'Wrap two', initiative: 10, current: 5, max: 5 },
    { name: 'Wrap three', initiative: 5, current: 5, max: 5 },
  ])

  try {
    await openCombat(page, game.id, encounter.id)
    await expect(page.locator('.round-pill')).toContainText('Round 1')
    await page.getByRole('button', { name: '← Previous' }).click()
    await expect(page.locator('.round-pill')).toContainText('Round 1')
    await expect(page.locator('.combatant-card.active')).toContainText('Wrap one')

    await page.getByRole('button', { name: 'Next →' }).click()
    await expect(page.locator('.combatant-card.active')).toContainText('Wrap two')
    await page.getByRole('button', { name: 'Next →' }).click()
    await expect(page.locator('.combatant-card.active')).toContainText('Wrap three')
    await page.getByRole('button', { name: 'Next →' }).click()
    await expect(page.locator('.round-pill')).toContainText('Round 2')
    await expect(page.locator('.combatant-card.active')).toContainText('Wrap one')

    await page.getByRole('button', { name: '← Previous' }).click()
    await expect(page.locator('.round-pill')).toContainText('Round 1')
    await expect(page.locator('.combatant-card.active')).toContainText('Wrap three')
  } finally {
    await cleanupGame(request, game.id)
  }
})

test('retains a stale two-browser draft after a conflict and reconciles it on the next save', async ({ browser, page, request }) => {
  const systemId = await systemIdByKey(request, 'dnd5e')
  const game = await createGame(request, systemId, uniqueName('Stale live game'))
  const { encounter, participants } = await createCombat(request, game.id, uniqueName('Stale live combat'), [
    { name: 'Stale target', initiative: 10, current: 7, max: 7 },
    { name: 'Stale witness', initiative: 5, current: 7, max: 7 },
  ])
  const secondContext = await browser.newContext()

  try {
    const secondPage = await secondContext.newPage()
    await secondPage.route('**/api/realtime**', (route) => route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ message: 'Synthetic realtime disabled for stale edit' }) }))
    await openCombat(page, game.id, encounter.id)
    await openCombat(secondPage, game.id, encounter.id)
    await selectRow(page, 'Stale target')
    await selectRow(secondPage, 'Stale target')

    const first = row(page, 'Stale target')
    await first.getByLabel('Current HP').fill('4')
    await first.getByLabel('Conditions').fill('Prone')
    await first.getByRole('button', { name: 'Save participant' }).click()
    await expect(first).toContainText('HP 4/7')

    const stale = row(secondPage, 'Stale target')
    await stale.getByLabel('Current HP').fill('6')
    await stale.getByLabel('Conditions').fill('Stunned')
    await stale.getByRole('button', { name: 'Save participant' }).click()
    await expect(stale.getByRole('alert')).toContainText('conflicts with another change')
    await expect(stale.getByLabel('Current HP')).toHaveValue('6')
    await expect(stale.getByLabel('Conditions')).toHaveValue('Stunned')
    await expect(stale.getByRole('button', { name: 'Save participant' })).toBeDisabled()

    const beforeResolution = await request.get(`${api}/combatants/records/${participants[0]!.id}`)
    expect(await beforeResolution.json()).toMatchObject({ current_hp: 4, conditions: 'Prone' })

    await stale.getByRole('button', { name: 'Keep my draft and retry' }).click()
    await stale.getByRole('button', { name: 'Save participant' }).click()
    await expect(stale).toContainText('HP 6/7')
    await expect(stale).toContainText('Stunned')

    const stored = await request.get(`${api}/combatants/records/${participants[0]!.id}`)
    expect(await stored.json()).toMatchObject({ current_hp: 6, max_hp: 7, hp_known: true, conditions: 'Stunned' })
  } finally {
    await secondContext.close()
    await cleanupGame(request, game.id)
  }
})

test('prevents repeated and uncertain damage writes from being replayed', async ({ page, request }) => {
  const systemId = await systemIdByKey(request, 'dnd5e')
  const game = await createGame(request, systemId, uniqueName('Guarded live game'))
  const { encounter, participants } = await createCombat(request, game.id, uniqueName('Guarded live combat'), [
    { name: 'Guarded target', initiative: 10, current: 7, max: 7 },
  ])

  try {
    await openCombat(page, game.id, encounter.id)
    await selectRow(page, 'Guarded target')
    const target = row(page, 'Guarded target')

    await page.route('**/api/olea/records/combatants/*/update', async (route) => {
      if (route.request().method() !== 'POST') { await route.continue(); return }
      await new Promise((resolve) => setTimeout(resolve, 400))
      await route.continue()
    })
    await target.getByLabel('Damage or healing amount').fill('2')
    await target.getByRole('button', { name: 'Apply damage' }).evaluate((button) => {
      ;(button as HTMLButtonElement).click()
      ;(button as HTMLButtonElement).click()
    })
    await expect(target).toContainText('HP 5/7')
    let stored = await request.get(`${api}/combatants/records/${participants[0]!.id}`)
    expect((await stored.json() as { current_hp: number }).current_hp).toBe(5)
    await page.unroute('**/api/olea/records/combatants/*/update')

    await page.route('**/api/olea/records/combatants/*/update', async (route) => {
      if (route.request().method() !== 'POST') { await route.continue(); return }
      await route.fetch()
      await route.abort('failed')
    })
    await target.getByLabel('Damage or healing amount').fill('2')
    await target.getByRole('button', { name: 'Apply damage' }).click()
    await expect(target.getByRole('alert').filter({ hasText: 'HP change could not be confirmed' })).toBeVisible()
    await expect(target.getByRole('button', { name: 'Apply damage' })).toBeDisabled()
    stored = await request.get(`${api}/combatants/records/${participants[0]!.id}`)
    expect((await stored.json() as { current_hp: number }).current_hp).toBe(3)

    await page.unroute('**/api/olea/records/combatants/*/update')
    await target.getByRole('button', { name: 'Refresh live state' }).click()
    await expect(target).toContainText('HP 3/7')
    await target.getByLabel('Damage or healing amount').fill('1')
    await target.getByRole('button', { name: 'Apply healing' }).click()
    await expect(target).toContainText('HP 4/7')
    stored = await request.get(`${api}/combatants/records/${participants[0]!.id}`)
    expect((await stored.json() as { current_hp: number }).current_hp).toBe(4)
  } finally {
    await cleanupGame(request, game.id)
  }
})

test('applies a delayed confirm HP only once across a double click', async ({ page, request }) => {
  test.setTimeout(30_000)
  const systemId = await systemIdByKey(request, 'dnd5e')
  const game = await createGame(request, systemId, uniqueName('Confirm HP game'))
  const { encounter, participants } = await createCombat(request, game.id, uniqueName('Confirm HP combat'), [
    { name: 'Confirm target', initiative: 10, current: 5, max: 5 },
  ])

  try {
    await openCombat(page, game.id, encounter.id)
    await selectRow(page, 'Confirm target')
    const target = row(page, 'Confirm target')
    await target.getByLabel('Current HP').fill('8')
    await target.getByLabel('Max HP').fill('8')
    await target.getByRole('button', { name: 'Preview manual' }).click()
    await expect(target).toContainText('Preview: 8/8')

    let updates = 0
    await page.route('**/api/olea/records/combatants/*/update', async (route) => {
      if (route.request().method() !== 'POST') { await route.continue(); return }
      updates++
      await new Promise((resolve) => setTimeout(resolve, 400))
      await route.continue()
    })
    await target.getByRole('button', { name: 'Confirm HP' }).evaluate((button) => {
      ;(button as HTMLButtonElement).click()
      ;(button as HTMLButtonElement).click()
    })
    await expect(target).toContainText('HP 8/8')
    expect(updates).toBe(1)
    const stored = await request.get(`${api}/combatants/records/${participants[0]!.id}`)
    expect((await stored.json() as { current_hp: number; max_hp: number }).current_hp).toBe(8)
    await page.unroute('**/api/olea/records/combatants/*/update')
  } finally {
    await cleanupGame(request, game.id)
  }
})

test('preserves unrelated drafts across successful HP changes and a conflict retry', async ({ page, request }) => {
  test.setTimeout(30_000)
  const systemId = await systemIdByKey(request, 'dnd5e')
  const game = await createGame(request, systemId, uniqueName('Draft retention game'))
  const { encounter, participants } = await createCombat(request, game.id, uniqueName('Draft retention combat'), [
    { name: 'Draft target', initiative: 15, current: 7, max: 7 },
    { name: 'Draft witness', initiative: 10, current: 7, max: 7 },
  ])

  try {
    await openCombat(page, game.id, encounter.id)
    await selectRow(page, 'Draft witness')
    const witness = row(page, 'Draft witness')
    await witness.getByLabel('Conditions').fill('Watching the door')
    await witness.getByLabel('Notes').fill('Keep this unsaved note.')

    await selectRow(page, 'Draft target')
    const target = row(page, 'Draft target')
    await target.getByLabel('Damage or healing amount').fill('2')
    await target.getByRole('button', { name: 'Apply damage' }).click()
    await expect(target).toContainText('HP 5/7')

    await witness.locator('.combatant-summary').click()
    await expect(witness.getByLabel('Conditions')).toHaveValue('Watching the door')
    await expect(witness.getByLabel('Notes')).toHaveValue('Keep this unsaved note.')

    await target.locator('.combatant-summary').click()
    await target.getByLabel('Current HP').fill('4')
    await target.getByLabel('Conditions').fill('Local plan')

    const external = await request.patch(`${api}/combatants/records/${participants[0]!.id}`, { data: { current_hp: 3, conditions: 'Changed by other client' } })
    expect(external.ok(), await external.text()).toBeTruthy()

    await target.getByRole('button', { name: 'Save participant' }).click()
    await expect(target.getByRole('alert')).toContainText('conflicts with another change')
    await expect(target.getByLabel('Current HP')).toHaveValue('4')
    await expect(target.getByLabel('Conditions')).toHaveValue('Local plan')
    await expect(target.getByRole('button', { name: 'Save participant' })).toBeDisabled()

    await witness.locator('.combatant-summary').click()
    await expect(witness.getByLabel('Conditions')).toHaveValue('Watching the door')
    await expect(witness.getByLabel('Notes')).toHaveValue('Keep this unsaved note.')

    await target.locator('.combatant-summary').click()
    await target.getByRole('button', { name: 'Keep my draft and retry' }).click()
    await target.getByRole('button', { name: 'Save participant' }).click()
    await expect(target).toContainText('HP 4/7')
    await expect(target).toContainText('Local plan')
  } finally {
    await cleanupGame(request, game.id)
  }
})

test('reports a saved HP change whose refresh failed without claiming an uncertain write', async ({ page, request }) => {
  test.setTimeout(30_000)
  const systemId = await systemIdByKey(request, 'dnd5e')
  const game = await createGame(request, systemId, uniqueName('Saved refresh failure game'))
  const { encounter, participants } = await createCombat(request, game.id, uniqueName('Saved refresh failure combat'), [
    { name: 'Saved target', initiative: 10, current: 7, max: 7 },
  ])

  try {
    await openCombat(page, game.id, encounter.id)
    await selectRow(page, 'Saved target')
    const target = row(page, 'Saved target')
    let failCombatantReads = true
    await page.route('**/api/collections/combatants/records?*', async (route) => {
      if (failCombatantReads && route.request().method() === 'GET') {
        await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ message: 'Synthetic refresh failure' }) })
        return
      }
      await route.continue()
    })
    await target.getByLabel('Damage or healing amount').fill('2')
    await target.getByRole('button', { name: 'Apply damage' }).click()
    const error = target.getByRole('alert')
    await expect(error).toContainText('was saved, but the live tracker could not refresh')
    await expect(error).not.toContainText('could not be confirmed')
    await expect(target.getByRole('button', { name: 'Apply damage' })).toBeDisabled()

    failCombatantReads = false
    await target.getByRole('button', { name: 'Refresh live state' }).click()
    await expect(target).toContainText('HP 5/7')
    await expect(target.getByRole('alert')).toHaveCount(0)
    await expect(target.getByRole('button', { name: 'Apply damage' })).toBeEnabled()
    const stored = await request.get(`${api}/combatants/records/${participants[0]!.id}`)
    expect((await stored.json() as { current_hp: number }).current_hp).toBe(5)
    await page.unroute('**/api/collections/combatants/records?*')
  } finally {
    await cleanupGame(request, game.id)
  }
})

test('continues a group initiative roll after one response is lost and reports the partial result', async ({ page, request }) => {
  test.setTimeout(30_000)
  const systemId = await systemIdByKey(request, 'dnd5e')
  const game = await createGame(request, systemId, uniqueName('Group partial game'))
  const { encounter, participants } = await createCombat(request, game.id, uniqueName('Group partial combat'), [
    { name: 'Group alpha', initiative: 10, current: 5, max: 5 },
    { name: 'Group bravo', initiative: 9, current: 5, max: 5 },
  ])

  try {
    await openCombat(page, game.id, encounter.id)
    await page.evaluate(() => { Math.random = () => 0 })
    await row(page, 'Group alpha').getByRole('checkbox', { name: 'Select Group alpha for group initiative' }).check()
    await row(page, 'Group bravo').getByRole('checkbox', { name: 'Select Group bravo for group initiative' }).check()
    await page.route('**/api/olea/records/combatants/*/update', async (route) => {
      if (route.request().method() !== 'POST') { await route.continue(); return }
      if (route.request().url().includes(participants[0]!.id)) {
        await route.fetch()
        await route.abort('failed')
        return
      }
      await route.continue()
    })
    await page.getByRole('button', { name: 'Roll group' }).click()
    const groupError = page.getByRole('alert').filter({ hasText: '1 of 2 initiative rolls were not confirmed' })
    await expect(groupError).toBeVisible()
    await expect(row(page, 'Group alpha').getByRole('alert')).toContainText('Initiative roll could not be confirmed')
    await expect(row(page, 'Group bravo')).toContainText('Init 1')

    await groupError.getByRole('button', { name: 'Refresh live state' }).click()
    await expect(page.getByRole('alert').filter({ hasText: 'initiative rolls were not confirmed' })).toHaveCount(0)
    await expect(row(page, 'Group alpha')).toContainText('Init 1')
    await page.unroute('**/api/olea/records/combatants/*/update')
  } finally {
    await cleanupGame(request, game.id)
  }
})

test('applies one turn change across a delayed double click and blocks an uncertain turn until refresh', async ({ page, request }) => {
  test.setTimeout(30_000)
  const systemId = await systemIdByKey(request, 'dnd5e')
  const game = await createGame(request, systemId, uniqueName('Turn guard game'))
  const { encounter, combat, participants } = await createCombat(request, game.id, uniqueName('Turn guard combat'), [
    { name: 'Turn one', initiative: 15, current: 5, max: 5 },
    { name: 'Turn two', initiative: 10, current: 5, max: 5 },
    { name: 'Turn three', initiative: 5, current: 5, max: 5 },
  ])

  try {
    await openCombat(page, game.id, encounter.id)
    let updates = 0
    await page.route('**/api/olea/records/combats/*/update', async (route) => {
      if (route.request().method() !== 'POST') { await route.continue(); return }
      updates++
      await new Promise((resolve) => setTimeout(resolve, 400))
      await route.continue()
    })
    await page.getByRole('button', { name: 'Next →' }).evaluate((button) => {
      ;(button as HTMLButtonElement).click()
      ;(button as HTMLButtonElement).click()
    })
    await expect(page.locator('.combatant-card.active')).toContainText('Turn two')
    expect(updates).toBe(1)
    const afterFirst = await request.get(`${api}/combats/records/${combat.id}`)
    expect((await afterFirst.json() as { active_participant: string }).active_participant).toBe(participants[1]!.id)
    await page.unroute('**/api/olea/records/combats/*/update')

    await page.route('**/api/olea/records/combats/*/update', async (route) => {
      if (route.request().method() !== 'POST') { await route.continue(); return }
      await route.fetch()
      await route.abort('failed')
    })
    await page.getByRole('button', { name: 'Next →' }).click()
    const trackerError = page.getByRole('alert').filter({ hasText: 'Combat tracker update could not be confirmed' })
    await expect(trackerError).toBeVisible()
    await expect(page.getByRole('button', { name: 'Next →' })).toBeDisabled()
    await expect(page.getByRole('button', { name: 'Reset' })).toBeDisabled()

    await page.unroute('**/api/olea/records/combats/*/update')
    await trackerError.getByRole('button', { name: 'Refresh live state' }).click()
    await expect(page.locator('.combatant-card.active')).toContainText('Turn three')
    await expect(page.getByRole('button', { name: 'Next →' })).toBeEnabled()
  } finally {
    await cleanupGame(request, game.id)
  }
})

test('keeps a local dirty participant baseline through another client change and an unrelated save', async ({ page, request }) => {
  test.setTimeout(30_000)
  const systemId = await systemIdByKey(request, 'dnd5e')
  const game = await createGame(request, systemId, uniqueName('Dirty baseline game'))
  const { encounter, combat, participants } = await createCombat(request, game.id, uniqueName('Dirty baseline combat'), [
    { name: 'Unrelated alpha', initiative: 15, current: 7, max: 7 },
    { name: 'Dirty bravo', initiative: 10, current: 7, max: 7 },
  ])

  try {
    await openCombat(page, game.id, encounter.id)
    await selectRow(page, 'Dirty bravo')
    const dirty = row(page, 'Dirty bravo')
    await dirty.getByLabel('Conditions').fill('Local B draft')
    await dirty.getByLabel('Notes').fill('Local B note')

    const external = await request.patch(`${api}/combatants/records/${participants[1]!.id}`, { data: { current_hp: 4, conditions: 'Server B change' } })
    expect(external.ok(), await external.text()).toBeTruthy()

    await selectRow(page, 'Unrelated alpha')
    const alpha = row(page, 'Unrelated alpha')
    await alpha.getByLabel('Damage or healing amount').fill('2')
    await alpha.getByRole('button', { name: 'Apply damage' }).click()
    await expect(alpha).toContainText('HP 5/7')

    await expect(dirty).toContainText('HP 4/7')
    await expect(dirty).toContainText('Server B change')
    await dirty.locator('.combatant-summary').click()
    await expect(dirty.getByLabel('Conditions')).toHaveValue('Local B draft')
    await expect(dirty.getByLabel('Notes')).toHaveValue('Local B note')

    await dirty.getByRole('button', { name: 'Save participant' }).click()
    await expect(dirty.getByRole('alert')).toContainText('conflicts with another change')
    await expect(dirty.getByRole('button', { name: 'Save participant' })).toBeDisabled()
    await expect(dirty.getByRole('button', { name: 'Use server values' })).toBeVisible()

    const stored = await request.get(`${api}/combatants/records/${participants[1]!.id}`)
    expect(await stored.json()).toMatchObject({ current_hp: 4, max_hp: 7, conditions: 'Server B change' })
    const active = await request.get(`${api}/combats/records/${combat.id}`)
    expect((await active.json() as { active_participant: string }).active_participant).toBe(participants[0]!.id)
  } finally {
    await cleanupGame(request, game.id)
  }
})

test('keeps a conflicting draft when the conflict refresh fails and requires explicit review', async ({ page, request }) => {
  test.setTimeout(30_000)
  const systemId = await systemIdByKey(request, 'dnd5e')
  const game = await createGame(request, systemId, uniqueName('Conflict reload failure game'))
  const { encounter, participants } = await createCombat(request, game.id, uniqueName('Conflict reload failure combat'), [
    { name: 'Conflict target', initiative: 10, current: 7, max: 7 },
  ])

  try {
    await openCombat(page, game.id, encounter.id)
    await selectRow(page, 'Conflict target')
    const target = row(page, 'Conflict target')
    await target.getByLabel('Conditions').fill('Local conflict draft')
    const external = await request.patch(`${api}/combatants/records/${participants[0]!.id}`, { data: { current_hp: 4, conditions: 'Server conflict value' } })
    expect(external.ok(), await external.text()).toBeTruthy()

    let failCombatantReads = true
    await page.route('**/api/collections/combatants/records?*', async (route) => {
      if (failCombatantReads && route.request().method() === 'GET') {
        await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ message: 'Synthetic conflict refresh failure' }) })
        return
      }
      await route.continue()
    })
    await target.getByRole('button', { name: 'Save participant' }).click()
    await expect(target.getByRole('alert')).toContainText('latest values could not be refreshed')
    await expect(target.getByLabel('Conditions')).toHaveValue('Local conflict draft')
    await expect(target.getByRole('button', { name: 'Save participant' })).toBeDisabled()
    await expect(target.getByRole('button', { name: 'Keep my draft and retry' })).toHaveCount(0)

    const unchanged = await request.get(`${api}/combatants/records/${participants[0]!.id}`)
    expect(await unchanged.json()).toMatchObject({ current_hp: 4, conditions: 'Server conflict value' })

    failCombatantReads = false
    await target.getByRole('button', { name: 'Refresh live state' }).click()
    await expect(target.getByRole('alert')).toContainText('Server now:')
    await expect(target.getByRole('button', { name: 'Keep my draft and retry' })).toBeVisible()
    await expect(target.getByRole('button', { name: 'Use server values' })).toBeVisible()

    await target.getByRole('button', { name: 'Use server values' }).click()
    await expect(target.getByLabel('Conditions')).toHaveValue('Server conflict value')
    await expect(target.getByLabel('Current HP')).toHaveValue('4')
    await expect(target.getByRole('alert')).toHaveCount(0)
    const stillUnchanged = await request.get(`${api}/combatants/records/${participants[0]!.id}`)
    expect(await stillUnchanged.json()).toMatchObject({ current_hp: 4, conditions: 'Server conflict value' })
    await page.unroute('**/api/collections/combatants/records?*')
  } finally {
    await cleanupGame(request, game.id)
  }
})
