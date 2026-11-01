import { createSystemRegistry, systemByKey, type SystemCapabilities } from './systems.ts'
import { orderParticipants, activeParticipant } from './encounterOrder.ts'
import { filterChoices, matchesCatalog } from './catalogFilters.ts'
import { coinWeight, totalBalances } from './currency.ts'
import type { CatalogRecord } from './catalog.ts'

// Test-only built-in module: lower initiative first, shells, and a source-specific field.
const invented: SystemCapabilities = {
  key: 'invented',
  encounter: {
    compare: (a, b) => a.initiative_known !== b.initiative_known ? (a.initiative_known ? -1 : 1) : a.initiative_known ? a.initiative - b.initiative : 0,
    initiative: null,
    creatureHP: () => ({ average: null, formula: null }),
  },
  catalog: {
    filters: { creature: [{ key: 'temperament', label: 'Temperament', field: 'original_json.temperament', match: 'exact' }] },
    resultLabel: (record) => `Temperament: ${(record.original_json as { temperament: string }).temperament}`,
    detailFields: (record) => [{ name: 'Temperament', value: (record.original_json as { temperament: string }).temperament }],
    description: (record) => record.alternate_description || (record.original_json as { description: string }).description,
    compare: (a, b) => a.name.localeCompare(b.name),
    defaultFilters: () => ({}),
  },
  currency: { denominations: [{ key: 'shell', label: 'Shells' }], weightUnit: 'stone', coinWeight: (balances) => (balances.shell ?? 0) / 10 },
  inventory: { catalogWeight: (record) => typeof (record.original_json as { stones?: unknown })?.stones === 'number' ? (record.original_json as { stones: number }).stones : null },
}
function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message) }
const registry = createSystemRegistry([invented])
const system = registry('invented')
assert(system === invented && registry('missing') === systemByKey('missing'), 'registration and neutral fallback')
const participants = [{ id: 'a', name: 'A', sort_order: 0, initiative_known: true, initiative: 9 }, { id: 'b', name: 'B', sort_order: 1, initiative_known: true, initiative: 2 }]
const order = orderParticipants(participants, '[]', system.encounter)
assert(order[0]?.id === 'b' && activeParticipant(order, 'a', 0)?.id === 'a', 'lower initiative and active participant')
assert(system.encounter.initiative === null && system.encounter.creatureHP({ dex: 20, hp: { average: 20 } }).average === null, 'unsupported combat rules stay manual')
const creature = { id: 'x', type: 'creature', name: 'Cloud', source: 'TEST', original_json: { temperament: 'sleepy', description: 'An invented cloud.' }, alternate_description: '' } as CatalogRecord
const filters = system.catalog.filters.creature!
assert(filterChoices([creature], filters[0]!).join() === 'sleepy' && matchesCatalog(creature, filters, { temperament: 'sleepy' }, ''), 'system-specific catalog filter')
assert(system.catalog.detailFields(creature)[0]?.value === 'sleepy' && system.catalog.description(creature) === 'An invented cloud.', 'system-specific catalog presentation')
const total = totalBalances([{ shell: 7 }, { shell: 13 }])
assert(total.shell === 20 && coinWeight(total, system.currency) === 2, 'invented denomination, party total, and weight')
const weighted = { original_json: { stones: 4 }, item_weight: 99 } as CatalogRecord
assert(system.inventory.catalogWeight(weighted) === 4 && registry('missing').inventory.catalogWeight(weighted) === null, 'catalog weight uses only system-specific units')
