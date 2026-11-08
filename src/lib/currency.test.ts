import { balanceDraft, coinWeight, mergeBalances, nonZeroBalances, parseBalanceDraft, totalBalances, unsupportedBalanceEntries } from './currency.ts'
import { systemByKey, type SystemCapabilities } from './systems.ts'
function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message) }
const five = systemByKey('dnd5e').currency
assert(coinWeight({ gp: 50, sp: 25 }, five) === 1.5, '5e weight')
assert(coinWeight({ gp: 50, strange: 1 }, five) === null, 'unsupported balances have unknown weight')
assert(coinWeight({ gp: 1 }, systemByKey('adnd2e').currency) === null, 'AD&D has no invented coin weight')
assert(coinWeight({}, systemByKey('invented').currency) === 0, 'no coins have no weight')
const invented: SystemCapabilities['currency'] = { denominations: [{ key: 'shell', label: 'Shells' }], weightUnit: 'stone', coinWeight: (balances) => (balances.shell ?? 0) / 10 }
assert(coinWeight({ shell: 20 }, invented) === 2, 'invented system weight')
const total = totalBalances([{ shell: 2, legacy: 3 }, { shell: 4 }, null])
assert(total.shell === 6 && total.legacy === 3, 'party balances preserve keys')

const denominations = five.denominations
const draft = balanceDraft({ gp: 12, old: 8 }, denominations)
assert(draft.gp === '12' && draft.cp === '0' && !('old' in draft), 'draft covers supported keys only')
assert(JSON.stringify(mergeBalances({ gp: 12, old: 8 }, { gp: 3, sp: 2 })) === JSON.stringify({ gp: 3, old: 8, sp: 2 }), 'merge preserves unsupported balances')

const parsed = parseBalanceDraft({ cp: '0', sp: ' 2 ', ep: '', gp: '1', pp: '9999999999999999' }, denominations)
assert('error' in parsed && parsed.error.includes('EP'), 'blank supported balance is not silently zero')
const valid = parseBalanceDraft({ cp: '1', sp: '2', ep: '3', gp: '4', pp: '5' }, denominations)
assert('values' in valid && valid.values.pp === 5, 'valid direct balances parse')
for (const invalid of [{ gp: '-1' }, { gp: '1.5' }, { gp: 'abc' }, { gp: '9007199254740992' }]) {
  const result = parseBalanceDraft(Object.assign({ cp: '0', sp: '0', ep: '0', gp: '0', pp: '0' }, invalid), denominations)
  assert('error' in result, `invalid balance rejected: ${JSON.stringify(invalid)}`)
}

assert(nonZeroBalances({ cp: 0, gp: 4, old: 2 }, denominations).map((entry) => entry.key).join(',') === 'gp', 'summary hides zero and unsupported entries')
const unsupported = unsupportedBalanceEntries({ gp: 2, old: 8, other: 0 }, denominations)
assert(unsupported.length === 1 && unsupported[0].key === 'old' && unsupported[0].amount === 8, 'unsupported balances are listed without zeroes')
