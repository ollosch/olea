import { systemByKey } from './systems.ts'
import { matchesSpellbookQuery, spellbookEntryText, type SpellbookEntry } from './spellbook.ts'
import type { CatalogRecord } from './catalog.ts'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

const five = systemByKey('dnd5e')
const adnd = systemByKey('adnd2e')
const unknown = systemByKey('invented')
const spell = {
  id: 'spell-1',
  type: 'spell',
  source: 'SYNTHETIC',
  book_source: 'Invented Sourcebook',
  source_id: 'invented-1',
  name: 'Invisible Lantern',
  level: '1',
  school: 'Illusion',
  sphere: 'Sun',
  original_json: { entries: ['Original text'] },
  alternate_description: 'Preferred at-table text',
  notes: 'Prepared at dawn',
} as CatalogRecord
const entry: SpellbookEntry = { id: 'entry-1', spell: spell.id, expand: { spell } }

assert(matchesSpellbookQuery(entry, five, ''), 'an empty query matches every spell')
assert(matchesSpellbookQuery(entry, five, '  lantern  '), 'search trims and matches the spell name')
assert(matchesSpellbookQuery(entry, five, 'synthetic sourcebook'), 'every term can match source identity')
assert(matchesSpellbookQuery(entry, five, 'prepared dawn'), 'notes are searchable')
assert(!matchesSpellbookQuery(entry, five, 'fireball'), 'unmatched terms do not match')
assert(spellbookEntryText(entry, five).includes('level 1'), '5e search text includes the system label')
assert(spellbookEntryText(entry, adnd).includes('sun'), 'AD&D search text includes the sphere')
assert(spellbookEntryText(entry, unknown).includes('synthetic'), 'unknown systems keep the neutral source label')
assert(!spellbookEntryText(entry, unknown).includes('cantrip'), 'unknown systems do not invent 5e spell vocabulary')

const missing: SpellbookEntry = { id: 'entry-2', spell: 'missing-catalog-id' }
assert(spellbookEntryText(missing, five).includes('missing catalog reference'), 'missing references are labelled')
assert(matchesSpellbookQuery(missing, five, 'missing'), 'missing references remain searchable')
assert(!matchesSpellbookQuery(missing, five, 'lantern'), 'a missing reference cannot pretend to have a catalog name')

const long = {
  ...spell,
  name: 'Long Form',
  notes: 'A '.repeat(400),
} as CatalogRecord
assert(matchesSpellbookQuery({ id: 'entry-3', spell: long.id, expand: { spell: long } }, five, 'long form'), 'long stored text does not break matching')

console.log('spellbook search checks passed')
