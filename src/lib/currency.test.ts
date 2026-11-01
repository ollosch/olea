import { coinWeight, totalBalances } from './currency.ts'
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
