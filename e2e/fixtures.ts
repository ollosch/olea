import { expect, test as base, type Page } from '@playwright/test'

type FixtureIds = {
  gameId: string
  characterId: string
  otherCharacterId: string
  inventoryId: string
  stashId: string
  encounterId: string
  combatId: string
  itemId: string
  containerId: string
  combatantId: string
  spellbookId: string
  spellIds: string[]
  encounterIds: string[]
  monsterIds: string[]
}

type Fixtures = { ids: FixtureIds }
export const e2eApiBase = process.env.E2E_BASE_URL ?? `http://127.0.0.1:${process.env.E2E_PORT ?? '8091'}`
const uniqueFixtureKey = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`

export const test = base.extend<Fixtures>({
  ids: async ({ request }, use) => {
    const api = `${e2eApiBase}/api/collections`
    const create = async <T extends { id: string }>(collection: string, fields: Record<string, unknown>) => {
      const response = await request.post(`${api}/${collection}/records`, { data: fields })
      expect(response.ok(), `${collection} fixture creation should succeed: ${await response.text()}`).toBeTruthy()
      return await response.json() as T
    }

    const systemResponse = await request.get(`${api}/systems/records?filter=(key='dnd5e')`)
    expect(systemResponse.ok()).toBeTruthy()
    const systems = await systemResponse.json() as { items: Array<{ id: string }> }
    const systemId = systems.items[0]?.id
    expect(systemId, 'the fresh database should seed the D&D 5e system').toBeTruthy()

    const game = await create<FixtureIds>('games', {
      name: `E2E table ${Date.now()}`,
      system: systemId,
      encounter_visible: true,
      encounter_show_initiative: true,
      encounter_show_enemy_names: true,
      encounter_show_hp: true,
      encounter_show_conditions: true,
    })
    const character = await create<FixtureIds>('characters', { game: game.id, name: 'E2E Ranger' })
    const otherCharacter = await create<FixtureIds>('characters', { game: game.id, name: 'E2E Bard' })
    const spellbook = await create<FixtureIds>('spellbooks', { character: character.id, name: 'E2E Spellbook' })
    const spell = await create<FixtureIds>('catalog', {
      system: systemId,
      type: 'spell',
      source: 'SYNTHETIC',
      source_id: `e2e-card-spark-${uniqueFixtureKey()}`,
      name: 'E2E Spark',
      level: '1',
      school: 'Evocation',
      original_json: { time: [{ number: 1, unit: 'action' }], range: { type: 'point', distance: { amount: 60, type: 'feet' } }, duration: [{ type: 'instant' }], components: { v: true, s: true }, entries: ['A bright invented spark.'] },
      alternate_description: 'A table-friendly invented spark.',
    })
    const longSpell = await create<FixtureIds>('catalog', {
      system: systemId,
      type: 'spell',
      source: 'SYNTHETIC',
      source_id: `e2e-card-long-verse-${uniqueFixtureKey()}`,
      name: 'E2E Long Verse',
      level: '2',
      school: 'Illusion',
      original_json: { time: [{ number: 1, unit: 'minute' }], range: { type: 'self' }, duration: [{ type: 'timed', duration: { amount: 1, type: 'hour' } }], components: { v: true, m: 'a harmless pebble' }, entries: ['An invented phrase.'] },
      alternate_description: 'A '.repeat(400),
    })
    await create<FixtureIds>('spellbook_spells', { spellbook: spellbook.id, spell: spell.id })
    await create<FixtureIds>('spellbook_spells', { spellbook: spellbook.id, spell: longSpell.id })
    const inventory = await create<FixtureIds>('inventories', {
      game: game.id,
      character: character.id,
    })
    const stash = await create<FixtureIds>('stashes', {
      game: game.id,
      kind: 'party',
      name: 'E2E Party Stash',
    })
    for (const [collection, id, balances] of [
      ['inventories', inventory.id, { cp: 0, sp: 0, ep: 0, gp: 12, pp: 0 }],
      ['stashes', stash.id, { cp: 0, sp: 0, ep: 0, gp: 3, pp: 0 }],
    ] as const) {
      const response = await request.post(`${e2eApiBase}/api/olea/records/${collection}/${id}/update`, {
        data: { expected: { balances: {} }, fields: { balances } },
      })
      expect(response.ok(), `${collection} starting balances should save`).toBeTruthy()
    }
    const item = await create<FixtureIds>('inventory_items', {
      inventory: inventory.id,
      name: 'E2E Potion',
      quantity: 3,
      weight: 1,
      weight_known: true,
      is_container: false,
    })
    const container = await create<FixtureIds>('inventory_items', {
      inventory: inventory.id,
      name: 'E2E Satchel',
      quantity: 1,
      weight: 1,
      weight_known: true,
      is_container: true,
    })
    const encounter = await create<FixtureIds>('encounters', { game: game.id, name: 'E2E Bridge Encounter' })
    const secondEncounter = await create<FixtureIds>('encounters', { game: game.id, name: 'E2E Forest Encounter' })
    const catalogA = await create<FixtureIds>('catalog', { system: systemId, type: 'creature', source: 'SYNTHETIC', source_id: `e2e-monster-a-${uniqueFixtureKey()}`, name: 'E2E Shared Name', creature_type: 'beast', challenge_rating: '1/2', original_json: { hp: { average: 8, formula: '2d8' }, abilities: { str: 12, dex: 14 }, action: [{ name: 'Claw', entries: ['A synthetic claw.'] }], fluff: { entries: ['A synthetic creature.'] } }, alternate_description: 'A quick invented creature.', notes: '' })
    const catalogB = await create<FixtureIds>('catalog', { system: systemId, type: 'creature', source: 'OTHER', source_id: `e2e-monster-b-${uniqueFixtureKey()}`, name: 'E2E Shared Name', creature_type: 'construct', challenge_rating: '1', original_json: { hp: { average: 10, formula: '2d8+2' }, abilities: { str: 14, dex: 10 }, action: [{ name: 'Slam', entries: ['A different invented slam.'] }] }, alternate_description: '', notes: '' })
    for (const [targetEncounter, creature, name, notes, custom] of [
      [encounter.id, catalogA.id, catalogA.name, 'By the old bridge.', false],
      [secondEncounter.id, catalogA.id, catalogA.name, 'At dusk.', false],
      [secondEncounter.id, catalogB.id, catalogB.name, '', false],
      [encounter.id, '', 'E2E Custom Wisp', 'Glows blue.', true],
    ] as const) await create<FixtureIds>('encounter_creatures', { encounter: targetEncounter, creature, name, quantity: 3, notes, custom })
    const combat = await create<FixtureIds>('combats', {
      encounter: encounter.id,
      active: true,
      round: 1,
      turn: 0,
      tie_order: '[]',
      name: 'E2E Bridge Encounter',
    })
    const combatant = await create<FixtureIds>('combatants', {
      combat: combat.id,
      name: 'E2E Goblin Scout',
      enemy: true,
      sort_order: 0,
      initiative: 12,
      initiative_known: true,
      current_hp: 7,
      max_hp: 7,
      hp_known: true,
      conditions: '',
    })

    await use({
      gameId: game.id,
      characterId: character.id,
      otherCharacterId: otherCharacter.id,
      inventoryId: inventory.id,
      stashId: stash.id,
      encounterId: encounter.id,
      combatId: combat.id,
      itemId: item.id,
      containerId: container.id,
      combatantId: combatant.id,
      spellbookId: spellbook.id,
      spellIds: [spell.id, longSpell.id],
      encounterIds: [encounter.id, secondEncounter.id],
      monsterIds: [catalogA.id, catalogB.id],
    })

    const cleanup = await request.delete(`${api}/games/records/${game.id}`)
    expect(cleanup.ok(), 'E2E game cleanup should remove its fixture records').toBeTruthy()
    for (const id of [spell.id, longSpell.id]) {
      const removed = await request.delete(`${api}/catalog/records/${id}`)
      expect(removed.ok(), 'E2E catalog fixture cleanup should succeed').toBeTruthy()
    }
    for (const id of [catalogA.id, catalogB.id]) {
      const removed = await request.delete(`${api}/catalog/records/${id}`)
      expect(removed.ok(), 'E2E monster fixture cleanup should succeed').toBeTruthy()
    }
  },
})

export { expect }

export async function openInventory(page: Page, characterId: string) {
  await page.goto(`/characters/${characterId}/inventory`)
  await expect(page.getByRole('heading', { name: /E2E Ranger’s items/ })).toBeVisible()
}

export async function openEncounters(page: Page, gameId: string) {
  await page.goto(`/games/${gameId}/encounters`)
  await expect(page.getByRole('heading', { name: 'Encounters' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'E2E Bridge Encounter' })).toBeVisible()
}
