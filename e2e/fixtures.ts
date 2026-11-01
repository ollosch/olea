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
}

type Fixtures = { ids: FixtureIds }
export const e2eApiBase = process.env.E2E_BASE_URL ?? `http://127.0.0.1:${process.env.E2E_PORT ?? '8091'}`

export const test = base.extend<Fixtures>({
  ids: async ({ request }, use) => {
    const api = `${e2eApiBase}/api/collections`
    const create = async <T extends { id: string }>(collection: string, fields: Record<string, unknown>) => {
      const response = await request.post(`${api}/${collection}/records`, { data: fields })
      expect(response.ok(), `${collection} fixture creation should succeed`).toBeTruthy()
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
    })

    const cleanup = await request.delete(`${api}/games/records/${game.id}`)
    expect(cleanup.ok(), 'E2E game cleanup should remove its fixture records').toBeTruthy()
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
