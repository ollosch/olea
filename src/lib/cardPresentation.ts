import type { CatalogRecord } from './catalog.ts'

export type CardField = { label: string; value: string }
export type SpellCardPresentation = { fields: CardField[]; missingFields: string[] }
export type CreatureCardPresentation = { fields: CardField[]; actions: unknown; flavour: unknown }
export type ItemCardPresentation = { title: string; fields: CardField[] }

/** Ruleset-specific source interpretation. Card layout, user notes, and selection remain shared. */
export type CardPresentation = {
  spell: (record: CatalogRecord) => SpellCardPresentation
  creature: (record: CatalogRecord) => CreatureCardPresentation
  item: (record: CatalogRecord) => ItemCardPresentation
}

/** Unknown systems do not interpret fields from another ruleset's source format. */
export const neutralCardPresentation: CardPresentation = {
  spell: () => ({ fields: [], missingFields: [] }),
  creature: () => ({ fields: [], actions: [], flavour: '' }),
  item: () => ({ title: 'Item', fields: [] }),
}

export function sourceObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

export function sourceText(value: unknown): string {
  if (typeof value === 'string') return value.trim()
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (Array.isArray(value)) return value.map(sourceText).filter(Boolean).join(', ')
  if (value && typeof value === 'object') return Object.entries(value as Record<string, unknown>).map(([key, entry]) => {
    const formatted = sourceText(entry)
    return formatted ? `${key}: ${formatted}` : ''
  }).filter(Boolean).join(', ')
  return ''
}

export function addCardField(fields: CardField[], label: string, value: unknown): void {
  const formatted = sourceText(value)
  if (formatted && !fields.some((field) => field.label.toLowerCase() === label.toLowerCase())) fields.push({ label, value: formatted })
}
