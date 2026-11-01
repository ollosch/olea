import { backSlotForFront, CARD_LAYOUTS, cardsPerSheet, pageCards, sheetCount } from './cardPrint.ts'
import { spellPrintCard } from './printCards.ts'
import type { CatalogRecord } from './catalog.ts'
import { systemByKey } from './systems.ts'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}
function equal<T>(actual: T, expected: T, message: string) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`${message}: ${JSON.stringify(actual)} !== ${JSON.stringify(expected)}`)
}

const four = CARD_LAYOUTS.a6Four
assert(cardsPerSheet(four) === 4, 'four-card format should have four positions')
assert(sheetCount(0, four) === 0, 'empty selection has no sheets')
assert(sheetCount(4, four) === 1 && sheetCount(5, four) === 2, 'partial sheet should round up')
equal(pageCards(['a', 'b', 'c', 'd', 'e'], four, 1), ['e', null, null, null], 'partial page keeps empty slots')
equal(Array.from({ length: 4 }, (_, slot) => backSlotForFront(slot, four, 'long-edge')), [1, 0, 3, 2], 'long-edge duplex mapping')
equal(Array.from({ length: 4 }, (_, slot) => backSlotForFront(slot, four, 'short-edge')), [2, 3, 0, 1], 'short-edge duplex mapping')

const item = CARD_LAYOUTS.a7Eight
assert(cardsPerSheet(item) === 8, 'A7 format should have eight positions')
assert(sheetCount(9, item) === 2, 'A7 partial sheet should round up')
equal(Array.from({ length: 8 }, (_, slot) => backSlotForFront(slot, item, 'long-edge')), [1, 0, 3, 2, 5, 4, 7, 6], 'A7 duplex mapping')

const spell = {
  id: 'synthetic-spell', type: 'spell', source: 'SYNTHETIC', source_id: 'spark', name: 'Spark', level: '1', school: 'Evocation',
  creature_type: '', challenge_rating: '', original_json: { time: [{ number: 1, unit: 'action' }], range: { type: 'point', distance: { amount: 60, type: 'feet' } }, duration: [{ type: 'instant' }], components: { v: true, s: true }, entries: ['Source text.'] },
  alternate_description: 'Preferred short text.', notes: '',
} as CatalogRecord
const card = spellPrintCard(spell, systemByKey('dnd5e'))
assert(card.front.content === 'Preferred short text.', 'spell front should prefer alternate description')
equal(card.back, { nameOnly: true }, 'spell back contains only the name')
assert(card.front.fields?.some((field) => field.label === 'Casting time' && field.value === '1 action'), 'spell card has casting time')
assert(card.front.fields?.some((field) => field.label === 'Range' && field.value === '60 feet'), 'spell card has range')
assert(!card.warnings?.some((warning) => warning.includes('may exceed')), 'complete short spell has no content overflow warning')
const fallbackCard = spellPrintCard({ ...spell, alternate_description: '' }, systemByKey('dnd5e'))
assert(JSON.stringify(fallbackCard.front.content).includes('Source text.'), 'spell card falls back to original entries')
