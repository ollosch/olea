import { backSlotForFront, CARD_LAYOUTS, cardsPerSheet, pageCards, sheetCount } from './cardPrint.ts'
import { itemPrintCard, monsterPrintCard, spellPrintCard } from './printCards.ts'
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

const monster = {
  id: 'catalog-monster-a', type: 'creature', source: 'SYNTHETIC', source_id: 'a', name: 'Same Name', level: '', school: '', creature_type: 'beast', challenge_rating: '1/2',
  hp_average: 11, hp_formula: '2d8+2', actions_json: [{ name: 'Bite', entries: ['A short bite.'] }],
  original_json: { ac: [{ ac: 13 }], hp: { average: 11, formula: '2d8+2' }, speed: { walk: 30 }, abilities: { str: 12, dex: 14, con: 12 }, action: [{ name: 'Bite', entries: ['A short bite.'] }], fluff: { entries: ['An invented, small beast.'] } },
  alternate_description: 'A quick table description.', notes: '',
} as CatalogRecord
const monsterCard = monsterPrintCard({ record: monster, encounterNotes: ['Guard the bridge.'] }, systemByKey('dnd5e'))
assert(monsterCard.front.fields?.some((field) => field.label === 'DEX' && field.value === '14'), 'monster card contains ability scores')
assert(JSON.stringify(monsterCard.front.content).includes('Bite. A short bite.'), 'monster card contains actions')
assert(JSON.stringify(monsterCard.back.content).includes('An invented, small beast.'), 'monster back contains available fluff')
assert(JSON.stringify(monsterCard.back.content).includes('Guard the bridge.'), 'monster back contains encounter notes')
const sameNameDifferentRecord = { ...monster, id: 'catalog-monster-b', source_id: 'b' } as CatalogRecord
const distinctCards = [monsterPrintCard({ record: monster }, systemByKey('dnd5e')), monsterPrintCard({ record: sameNameDifferentRecord }, systemByKey('dnd5e'))]
assert(distinctCards.length === 2 && distinctCards[0]!.id !== distinctCards[1]!.id && distinctCards[0]!.name === distinctCards[1]!.name, 'same-name different-identity monsters remain separate')
const repeatedCard = monsterPrintCard({ record: monster, encounterNotes: ['Guard the bridge.', 'At dusk.'] }, systemByKey('dnd5e'))
assert((JSON.stringify(repeatedCard.back.content).match(/Encounter notes/g) ?? []).length === 2, 'deduplicated monster card retains notes from each encounter')
const noFluff = monsterPrintCard({ record: { ...monster, id: 'catalog-monster-b', source_id: 'b', original_json: { action: [{ name: 'Claw', entries: ['An attack.'] }] }, alternate_description: '' } as CatalogRecord }, systemByKey('dnd5e'))
assert(noFluff.warnings?.some((warning) => warning.includes('No alternate description')), 'missing fluff is warned')

const weapon: CatalogRecord = { ...spell, id: 'weapon-id', type: 'item', source: 'SYNTHETIC', source_id: 'sword', name: 'Training blade', item_type: 'M|M', item_weight: 3, item_value: 10, rarity: '', original_json: { dmg1: '1d6', dmgType: 'S', property: ['V', 'L'], range: { normal: 5 } }, alternate_description: 'A wooden practice weapon.' }
const weaponCard = itemPrintCard({ id: 'weapon-copy', name: 'Training blade', record: weapon, quantity: 1, weight: '3 lb.', notes: 'Painted red.' }, systemByKey('dnd5e'))
assert(weaponCard.front.fields?.some((field) => field.label === 'Damage' && field.value === '1d6'), 'weapon card includes damage')
assert(weaponCard.front.fields?.some((field) => field.label === 'Damage type' && field.value === 'S'), 'weapon card includes damage type')
assert(weaponCard.front.fields?.some((field) => field.label === 'Properties' && field.value.includes('V')), 'weapon card includes properties')
assert(JSON.stringify(weaponCard.back.content).includes('Painted red.'), 'item card back contains item notes')
const customItem = itemPrintCard({ id: 'custom-item-id', name: 'Handmade charm', quantity: 2, weight: '', notes: 'Keepsake.' }, systemByKey('dnd5e'))
assert(customItem.front.title === 'Custom item' && JSON.stringify(customItem.back.content).includes('Keepsake.'), 'custom item receives a printable card')
