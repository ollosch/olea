import type { CatalogRecord } from './catalog.ts'
import type { SystemCapabilities } from './systems.ts'
import type { PrintCard } from '../components/CardPrintPreview.vue'
import { getCardOverflowWarnings } from './cardPrintWarnings.ts'

function hasContent(value: unknown): boolean {
  if (typeof value === 'string') return Boolean(value.trim())
  if (Array.isArray(value)) return value.some(hasContent)
  if (value && typeof value === 'object') return Object.values(value).some(hasContent)
  return value !== null && value !== undefined
}

export function spellPrintCard(record: CatalogRecord, system: SystemCapabilities): PrintCard {
  const { fields, missingFields } = system.cards.spell(record)
  const content = system.catalog.description(record)
  const warnings = getCardOverflowWarnings([typeof content === 'string' ? content : JSON.stringify(content) ?? ''], 520)
  warnings.push(...missingFields.map((label) => `${label} is missing.`))
  return {
    id: record.id,
    name: record.name,
    front: { title: 'Spell', subtitle: record.source, fields, content },
    back: { nameOnly: true },
    warnings,
  }
}

export type MonsterCardInput = { record: CatalogRecord; encounterNotes?: string[] }

export function monsterPrintCard(input: MonsterCardInput, system: SystemCapabilities): PrintCard {
  const { record } = input
  const { fields, actions, flavour } = system.cards.creature(record)
  const notes = [...new Set([...(input.encounterNotes ?? []), record.notes ?? ''].map((note) => note.trim()).filter(Boolean))]
  const missingFluff = !record.alternate_description?.trim() && !hasContent(flavour)
  const frontContent = [
    record.alternate_description?.trim() ? { type: 'entries', name: 'At-table description', entries: [record.alternate_description.trim()] } : null,
    !record.alternate_description?.trim() && hasContent(flavour) ? { type: 'entries', name: 'Flavour', entries: [flavour] } : null,
    hasContent(actions) ? actions : null,
  ].filter(Boolean)
  const backContent = [hasContent(flavour) ? { type: 'entries', name: 'Flavour', entries: [flavour] } : null, ...notes.map((note) => ({ type: 'entries', name: 'Encounter notes', entries: [note] }))].filter(Boolean)
  const warnings = getCardOverflowWarnings([JSON.stringify({ fields, frontContent, backContent, notes })], 1250)
  if (missingFluff) warnings.push('No alternate description or source flavour is available.')
  if (!fields.length) warnings.push('Creature has no modeled stats; consult the original source or enter them manually.')
  return {
    id: record.id,
    name: record.name,
    front: { title: system.catalog.resultLabel(record), fields, content: frontContent.length ? frontContent : 'No actions or description are available.' },
    back: { title: 'Creature', content: backContent.length ? backContent : missingFluff ? 'No flavour text is available.' : undefined, note: notes.length ? undefined : 'No encounter notes.' },
    warnings,
  }
}

export type ItemCardInput = { id: string; name: string; record?: CatalogRecord; quantity: number; weight: string; notes: string }

export function itemPrintCard(input: ItemCardInput, system: SystemCapabilities): PrintCard {
  const { record } = input
  const presentation = record ? system.cards.item(record) : { title: 'Custom item', fields: [] }
  const fields = presentation.fields.filter((field) => !input.weight || field.label.toLowerCase() !== 'weight')
  if (input.weight) fields.push({ label: 'Weight', value: input.weight })
  if (input.quantity > 1) fields.push({ label: 'Quantity', value: String(input.quantity) })
  const description = record ? system.catalog.description(record) : ''
  const warnings = getCardOverflowWarnings([JSON.stringify({ fields, description, notes: input.notes })], 1250)
  if (!hasContent(description) && !input.notes.trim()) warnings.push('No item description or notes are available.')
  return {
    id: input.id,
    name: input.name,
    front: { title: presentation.title, subtitle: record?.source, fields, content: hasContent(description) ? description : 'No description available.' },
    back: { title: input.notes.trim() ? 'Notes' : 'Item', content: input.notes.trim() || undefined, note: input.notes.trim() ? undefined : 'No additional notes.' },
    warnings,
  }
}
