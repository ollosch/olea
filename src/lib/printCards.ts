import type { CatalogRecord } from './catalog'
import type { SystemCapabilities } from './systems'
import type { PrintCard } from '../components/CardPrintPreview.vue'
import { getCardOverflowWarnings } from './cardPrintWarnings.ts'

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function text(value: unknown): string {
  if (typeof value === 'string') return value.trim()
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (Array.isArray(value)) return value.map(text).filter(Boolean).join(', ')
  return ''
}

function componentsLabel(value: unknown): string {
  if (typeof value === 'string') return value
  if (Array.isArray(value)) return value.map(text).filter(Boolean).join(', ')
  const data = object(value)
  const parts = ['v', 's', 'm'].flatMap((key) => {
    const component = data[key]
    if (!component) return []
    const label = key.toUpperCase()
    if (key === 'm') {
      const material = typeof component === 'string' ? component : text(object(component).text)
      return [material ? `${label} (${material})` : label]
    }
    return [label]
  })
  if (data.r) parts.push('Ritual')
  return parts.join(', ')
}

function castingTimeLabel(value: unknown): string {
  const entries = Array.isArray(value) ? value : value ? [value] : []
  return entries.map((entry) => {
    const data = object(entry)
    return [text(data.number), text(data.unit), data.condition ? `(${text(data.condition)})` : ''].filter(Boolean).join(' ')
  }).filter(Boolean).join(' or ')
}

function rangeLabel(value: unknown): string {
  const data = object(value)
  const distance = object(data.distance)
  if (text(distance.amount) && text(distance.type)) return `${text(distance.amount)} ${text(distance.type)}`
  return text(distance.type || data.type || value)
}

function durationLabel(value: unknown): string {
  const entries = Array.isArray(value) ? value : value ? [value] : []
  return entries.map((entry) => {
    const data = object(entry)
    const duration = object(data.duration)
    const amount = [text(duration.amount), text(duration.type)].filter(Boolean).join(' ')
    return [data.concentration ? 'Concentration' : '', amount, text(data.type)].filter(Boolean).join(' ')
  }).filter(Boolean).join(' or ')
}

function spellFields(record: CatalogRecord, system: SystemCapabilities): Array<{ label: string; value: string }> {
  const original = object(record.original_json)
  const rawFields = object(original.fields)
  const adnd = original.format === 'adnd2e-wikitext'
  const fields: Array<{ label: string; value: string }> = system.catalog.detailFields(record).map((field) => ({ label: field.name, value: field.value }))
  const add = (label: string, value: string) => { if (value) fields.push({ label, value }) }
  if (adnd) {
    add('Class', text(rawFields.class))
    add('Casting time', text(rawFields.castingtime))
    add('Range', text(rawFields.range))
    add('Duration', text(rawFields.duration))
    add('Area', text(rawFields.aoe))
    add('Components', componentsLabel({ v: rawFields.verbal, s: rawFields.somatic, m: rawFields.material }))
    add('Saving throw', text(rawFields.save))
  } else {
    add('Casting time', castingTimeLabel(original.time))
    add('Range', rangeLabel(original.range))
    add('Duration', durationLabel(original.duration))
    add('Components', componentsLabel(original.components))
    add('Classes', text(original.classes && object(original.classes).from))
  }
  const seen = new Set<string>()
  return fields.filter((field) => {
    const key = field.label.toLowerCase()
    if (seen.has(key)) return false
    seen.add(key)
    return Boolean(field.value.trim())
  })
}

export function spellPrintCard(record: CatalogRecord, system: SystemCapabilities): PrintCard {
  const preferred = system.catalog.description(record)
  const original = object(record.original_json)
  const content = record.alternate_description?.trim()
    ? record.alternate_description.trim()
    : preferred
  const fields = spellFields(record, system)
  const fieldValue = (label: string) => fields.find((field) => field.label.toLowerCase() === label.toLowerCase())?.value ?? ''
  const warnings = getCardOverflowWarnings([typeof content === 'string' ? content : JSON.stringify(content)], 520)
  for (const [label, value] of [['Level', fieldValue('Level')], ['Casting time', fieldValue('Casting time')], ['Range', fieldValue('Range')], ['Duration', fieldValue('Duration')], ['Components', fieldValue('Components')]] as const) {
    if (!value) warnings.push(`${label} is missing.`)
  }
  return {
    id: record.id,
    name: record.name,
    front: { title: 'Spell', subtitle: record.source, fields, content },
    back: { nameOnly: true },
    warnings,
  }
}
