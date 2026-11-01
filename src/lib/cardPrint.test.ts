import { backSlotForFront, CARD_LAYOUTS, cardsPerSheet, pageCards, sheetCount } from './cardPrint.ts'

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
