import type { CatalogRecord } from './catalog.ts'
import type { SystemCapabilities } from './systems.ts'

export type SpellbookEntry = {
  id: string
  spell: string
  expand?: { spell?: CatalogRecord }
}

/** Search names, source identity and modeled spell fields without exposing full descriptions. */
export function spellbookEntryText(entry: SpellbookEntry, system: SystemCapabilities): string {
  const record = entry.expand?.spell
  if (!record) return `unknown spell missing catalog reference ${entry.spell}`.toLocaleLowerCase()
  return [
    record.name,
    record.source,
    record.book_source ?? '',
    record.level,
    record.school,
    record.sphere ?? '',
    record.notes ?? '',
    system.catalog.resultLabel(record),
  ].join(' ').toLocaleLowerCase()
}

export function matchesSpellbookQuery(entry: SpellbookEntry, system: SystemCapabilities, query: string): boolean {
  const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean)
  if (!terms.length) return true
  const haystack = spellbookEntryText(entry, system)
  return terms.every((term) => haystack.includes(term))
}
