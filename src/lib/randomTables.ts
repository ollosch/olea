import { evaluateDice } from './dice.ts'

export type ResultType = '' | 'item' | 'spell' | 'creature' | 'encounter'
export type TableEntry = { min: number | ''; max: number | ''; text: string; type: ResultType; ref: string }
export type TableData = { name: string; dice: string; entries: TableEntry[] }

export function validateTable(table: TableData): string {
  if (!table.name.trim()) return 'Enter a table name.'
  if (table.dice.trim()) {
    try { evaluateDice(table.dice, () => 1) } catch (error) { return error instanceof Error ? error.message : 'Invalid dice expression.' }
  }
  if (!table.entries.length) return 'Add at least one entry.'
  const entries = [...table.entries].sort((a, b) => Number(a.min) - Number(b.min))
  for (const [i, entry] of entries.entries()) {
    if (entry.min === '' || entry.max === '' || !Number.isInteger(entry.min) || !Number.isInteger(entry.max) || entry.min < -100000 || entry.max > 100000 || entry.min > entry.max) return 'Each range needs whole numbers from −100000 to 100000, with the start no greater than the end.'
    const previous = entries[i - 1]
    if (previous && entry.min <= Number(previous.max)) return 'Entry ranges overlap.'
    if (!entry.text.trim() && !entry.ref) return 'Each entry needs text or a reference.'
    if (entry.type && !entry.ref) return 'Choose a reference or select text only.'
  }
  return ''
}

export function findResult(entries: TableEntry[], roll: number): TableEntry | undefined {
  return entries.find((entry) => entry.min !== '' && entry.max !== '' && roll >= entry.min && roll <= entry.max)
}
