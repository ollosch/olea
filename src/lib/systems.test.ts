import { systemByKey, systemForGame } from './systems.ts'
import type { CatalogRecord } from './catalog.ts'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

const five = systemByKey('dnd5e')
assert(five.encounter.initiative?.modifier({ dex: 9 }) === -1, '5e Dexterity modifier')
assert(five.encounter.initiative?.modifier({}) === null, 'missing Dexterity is not zero')
assert(five.encounter.creatureHP({ hp: { average: 0, formula: '2d6+1' } }).average === 0, 'zero HP average is present')
assert(five.encounter.creatureHP({ hp: { formula: '2d6/2' } }).formula === null, 'unsupported HP is manual')
assert(five.encounter.compare({ initiative: 12, initiative_known: true }, { initiative: 5, initiative_known: true }) < 0, '5e highest initiative first')
assert(five.currency.coinWeight?.({ gp: 50 }) === 1, '5e coin weight')

const adnd = systemByKey('adnd2e')
assert(adnd.encounter.initiative === null, 'AD&D initiative is manual')
assert(adnd.encounter.creatureHP({ format: 'adnd2e-html', stats: { 'Hit Dice': '3+2' } }).formula === '3d8+2', 'AD&D supported hit dice')
assert(adnd.currency.coinWeight === null, 'unverified coin weight is unknown')

const spell = { type: 'spell', source: 'TEST', name: 'Invented', level: '0', school: 'Illusion', sphere: 'Sun', original_json: { entries: ['Source text'] }, alternate_description: 'My note' } as CatalogRecord
assert(five.catalog.resultLabel(spell).includes('Cantrip'), '5e spell label')
assert(adnd.catalog.resultLabel(spell).includes('Level 0'), 'AD&D level does not become a cantrip')
assert(five.catalog.description(spell) === 'My note', 'alternate text is preferred')
assert(JSON.stringify(five.catalog.description(spell, false)).includes('Source text'), 'original remains available')
assert(adnd.catalog.filters.spell?.some((filter) => filter.key === 'sphere' && filter.match === 'list'), 'AD&D sphere uses list matching')

for (const system of [systemByKey('invented'), systemByKey('__proto__'), systemForGame(null), systemForGame({ system: 'missing' }), systemForGame({ system: 'a', expand: { system: { id: 'b', key: 'dnd5e' } } })]) {
  assert(system.encounter.initiative === null && system.encounter.creatureHP({ hp: { average: 10 } }).average === null, 'unknown systems do not acquire rules')
  assert(system.currency.denominations.length === 0 && system.currency.coinWeight === null, 'unknown currency remains unknown')
  assert(system.catalog.detailFields(spell).length === 0 && !system.catalog.resultLabel(spell).includes('Cantrip'), 'unknown catalog presentation is neutral')
}
assert(systemForGame({ system: 'a', expand: { system: { id: 'a', key: 'dnd5e' } } }) === five, 'resolve expanded game system')
