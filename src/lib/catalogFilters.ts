import { compareChallengeRating, type CatalogRecord } from './catalog.ts'
import type { CatalogFilter } from './systems.ts'

/** Field paths may address preserved source JSON, e.g. original_json.mood. */
function valueFor(record: CatalogRecord, path: string): string {
  let value: unknown = record
  for (const part of path.split('.')) {
    if (!value || typeof value !== 'object') return ''
    value = (value as Record<string, unknown>)[part]
  }
  return typeof value === 'string' || typeof value === 'number' ? String(value) : ''
}
function valuesFor(record: CatalogRecord, filter: CatalogFilter): string[] {
  const value = valueFor(record, filter.field)
  return (filter.match === 'list' ? value.split(/[,\n]/) : [value]).map((part) => filter.normalize?.(part.trim()) ?? part.trim()).filter(Boolean)
}
export function filterChoices(records: readonly CatalogRecord[], filter: CatalogFilter): string[] {
  const choices = [...new Set(records.flatMap((record) => valuesFor(record, filter)))]
  return choices.sort(filter.match === 'minimum' || filter.match === 'maximum' ? compareChallengeRating : (a, b) => a.localeCompare(b, undefined, { numeric: true }))
}
export function matchesCatalog(record: CatalogRecord, filters: readonly CatalogFilter[], selected: Readonly<Record<string, string>>, query: string): boolean {
  if (query.trim() && !record.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())) return false
  return filters.every((filter) => {
    const wanted = selected[filter.key]
    if (!wanted) return true
    const values = valuesFor(record, filter)
    if (filter.match === 'minimum') return values.length > 0 && compareChallengeRating(values[0]!, wanted) >= 0
    if (filter.match === 'maximum') return values.length > 0 && compareChallengeRating(values[0]!, wanted) <= 0
    return values.includes(wanted)
  })
}
