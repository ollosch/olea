import { findResult, validateTable, type TableData } from './randomTables.ts'

function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message) }
const table: TableData = { name: 'Test', dice: '1d6', entries: [{ min: 1, max: 2, text: 'low', type: '', ref: '' }, { min: 3, max: 5, text: 'high', type: '', ref: '' }] }
assert(!validateTable(table), 'valid table should pass')
assert(findResult(table.entries, 1)?.text === 'low' && findResult(table.entries, 2)?.text === 'low', 'range endpoints are inclusive')
assert(findResult(table.entries, 3)?.text === 'high' && findResult(table.entries, 5)?.text === 'high', 'second range endpoints are inclusive')
assert(!findResult(table.entries, 0) && !findResult(table.entries, 6), 'uncovered rolls should not match')
table.entries[1]!.min = 2
assert(validateTable(table).includes('overlap'), 'overlapping endpoints should fail')
table.entries[1]!.min = ''
assert(validateTable(table).includes('range'), 'empty range should fail')
