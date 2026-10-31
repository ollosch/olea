import { filterChoices, matchesCatalog } from './catalogFilters.ts'
import { systemByKey } from './systems.ts'
import type { CatalogRecord } from './catalog.ts'
const record = { name: 'Test', source: 'T', school: 'Illusion, Charm', sphere: 'Sun, Moon', item_type: 'M|T', challenge_rating: '1/4', original_json: { mood: 'strange' } } as CatalogRecord
function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message) }
const adnd = systemByKey('adnd2e').catalog.filters.spell!
assert(matchesCatalog(record, adnd, { school: 'Charm', sphere: 'Moon' }, 'test'), 'AD&D list filters combine')
assert(!matchesCatalog(record, adnd, { school: 'Char' }, ''), 'list filters use exact members')
const item = systemByKey('dnd5e').catalog.filters.item!
assert(filterChoices([record], item[1]!).join() === 'M' && matchesCatalog(record, item, { itemType: 'M' }, ''), 'item types normalize consistently')
const creature = systemByKey('dnd5e').catalog.filters.creature!
assert(matchesCatalog(record, creature, { minCR: '1/8', maxCR: '1/2' }, ''), 'fractional CR range')
assert(matchesCatalog(record, [{ key: 'mood', field: 'original_json.mood', label: 'Mood', match: 'exact' }], { mood: 'strange' }, ''), 'system-specific source field')
