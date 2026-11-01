import { itemTypeLabel, type CatalogRecord } from './catalog.ts'
import type { SystemCapabilities } from './systems.ts'
import type { PrintCard } from '../components/CardPrintPreview.vue'
import { getCardOverflowWarnings } from './cardPrintWarnings.ts'

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function text(value: unknown): string {
  if (typeof value === 'string') return value.trim()
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (Array.isArray(value)) return value.map(text).filter(Boolean).join(', ')
  if (value && typeof value === 'object') return Object.entries(value as Record<string, unknown>).map(([key, entry]) => {
    const formatted = text(entry)
    return formatted ? `${key}: ${formatted}` : ''
  }).filter(Boolean).join(', ')
  return ''
}

function hasContent(value: unknown): boolean {
  if (typeof value === 'string') return Boolean(value.trim())
  if (Array.isArray(value)) return value.some(hasContent)
  if (value && typeof value === 'object') return Object.values(value).some(hasContent)
  return value !== null && value !== undefined
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

export type MonsterCardInput = { record: CatalogRecord; encounterNotes?: string[] }

export function monsterPrintCard(input: MonsterCardInput, system: SystemCapabilities): PrintCard {
  const { record } = input
  const original = object(record.original_json)
  const stats: Array<{ label: string; value: string }> = system.catalog.detailFields(record).map((field) => ({ label: field.name, value: field.value }))
  if (original.format === 'adnd2e-html') {
    const rawStats = object(original.stats)
    for (const [label, raw] of Object.entries(rawStats)) if (typeof raw === 'string' && raw.trim()) stats.push({ label, value: raw.trim() })
  }
  if (record.hp_average !== undefined && record.hp_average !== null) stats.push({ label: 'Hit points', value: `${record.hp_average}${record.hp_formula ? ` (${record.hp_formula})` : ''}` })
  const abilityScores = object(original.abilities)
  if (Object.keys(abilityScores).length) {
    for (const [key, label] of [['str', 'STR'], ['dex', 'DEX'], ['con', 'CON'], ['int', 'INT'], ['wis', 'WIS'], ['cha', 'CHA']] as const) {
      const score = abilityScores[key]
      if (typeof score === 'number' || typeof score === 'string') stats.push({ label, value: String(score) })
    }
  }
  for (const [key, label] of [['ac', 'Armor'], ['speed', 'Speed'], ['saves', 'Saves'], ['skills', 'Skills'], ['damageResistances', 'Resistances'], ['damageImmunities', 'Immunities'], ['conditionImmune', 'Condition immunity'], ['senses', 'Senses'], ['languages', 'Languages']] as const) {
    const value = text(original[key])
    if (value) stats.push({ label, value })
  }
  const actionEntries = (key: string) => {
    const raw = key === 'action' && Array.isArray(record.actions_json) ? record.actions_json : original[key]
    return Array.isArray(raw) ? raw.map((entry) => {
    const data = object(entry)
    const name = text(data.name)
    const description = text(data.entries ?? data.desc ?? data.text)
    return name && description ? `${name}. ${description}` : name || description
    }).filter(Boolean) : []
  }
  const sections = [
    ...actionEntries('trait').map((entry) => ({ type: 'entries', name: 'Traits', entries: [entry] })),
    ...actionEntries('action').map((entry) => ({ type: 'entries', name: 'Actions', entries: [entry] })),
    ...actionEntries('reaction').map((entry) => ({ type: 'entries', name: 'Reactions', entries: [entry] })),
    ...actionEntries('legendary').map((entry) => ({ type: 'entries', name: 'Legendary actions', entries: [entry] })),
  ]
  const fluff = object(original.fluff)
  const sourceFluff: unknown = fluff.entries ?? fluff.description ?? (original.format === 'adnd2e-html' ? system.catalog.description(record, false) : '')
  const flavour = text(sourceFluff)
  const rawNotes = (input.encounterNotes ?? []).map((note) => note.trim()).filter(Boolean)
  if (record.notes?.trim()) rawNotes.push(record.notes.trim())
  const notes = [...new Set(rawNotes)]
  const missingFluff = !record.alternate_description?.trim() && !hasContent(sourceFluff)
  const frontContent = [
    record.alternate_description?.trim() ? { type: 'entries', name: 'At-table description', entries: [record.alternate_description.trim()] } : null,
    !record.alternate_description?.trim() && hasContent(sourceFluff) ? { type: 'entries', name: 'Flavour', entries: [sourceFluff] } : null,
    ...sections,
  ].filter(Boolean)
  const backContent = [hasContent(sourceFluff) ? { type: 'entries', name: 'Flavour', entries: [sourceFluff] } : null, ...notes.map((note) => ({ type: 'entries', name: 'Encounter notes', entries: [note] }))].filter(Boolean)
  const warnings = getCardOverflowWarnings([JSON.stringify({ stats, frontContent, backContent, notes })], 1250)
  if (missingFluff) warnings.push('No alternate description or source flavour is available.')
  if (!stats.length) warnings.push('Creature has no modeled stats; consult the original source or enter them manually.')
  return {
    id: record.id,
    name: record.name,
    front: { title: system.catalog.resultLabel(record), fields: stats, content: frontContent.length ? frontContent : 'No actions or description are available.' },
    back: { title: 'Creature', content: backContent.length ? backContent : missingFluff ? 'No flavour text is available.' : undefined, note: notes.length ? undefined : 'No encounter notes.' },
    warnings,
  }
}

export type ItemCardInput = { id: string; name: string; record?: CatalogRecord; quantity: number; weight: string; notes: string }

export function itemPrintCard(input: ItemCardInput, system: SystemCapabilities): PrintCard {
  const record = input.record
  const original = object(record?.original_json)
  const fields: Array<{ label: string; value: string }> = []
  const add = (label: string, value: unknown) => {
    const formatted = text(value)
    if (formatted) fields.push({ label, value: formatted })
  }
  if (record) {
    const rawType = record.item_type
    const typeCode = typeof rawType === 'string' ? rawType : text(rawType)
    const type = itemTypeLabel(typeCode) || record.type
    const weapon = /weapon/i.test(type) || Boolean(original.dmg1 || original.dmg2 || original.damage)
    add('Type', type)
    if (record.rarity) add('Rarity', record.rarity)
    if (input.weight) add('Weight', input.weight)
    else if (record.item_weight !== undefined) add('Weight', record.item_weight)
    if (record.item_value !== undefined) add('Value', record.item_value)
    if (weapon) {
      add('Damage', original.dmg1 ?? original.damage ?? original.dmg2)
      add('Damage type', original.dmgType ?? original.damageType ?? original.damage_type)
      add('Versatile damage', original.dmg2)
      add('Range', original.range)
      add('Properties', original.property ?? original.properties)
      add('Mastery', original.mastery)
      add('Attack type', original.weaponCategory ?? original.weapon_category)
      add('Strength requirement', original.strength)
    } else {
      add('Attunement', original.reqAttune === true ? 'Required' : typeof original.reqAttune === 'string' ? original.reqAttune : '')
      add('Value', original.value && record.item_value === undefined ? original.value : '')
      add('Weight', original.weight && record.item_weight === undefined ? original.weight : '')
    }
  } else {
    add('Custom item', true)
    add('Weight', input.weight)
  }
  add('Quantity', input.quantity > 1 ? input.quantity : '')
  const description = record ? system.catalog.description(record) : ''
  const preferred = record?.alternate_description?.trim() || (typeof description === 'string' ? description : description)
  const warnings = getCardOverflowWarnings([JSON.stringify({ fields, preferred, notes: input.notes })], 1250)
  if (!preferred && !input.notes.trim()) warnings.push('No item description or notes are available.')
  return {
    id: input.id,
    name: input.name,
    front: { title: record ? itemTypeLabel(record.item_type) || 'Item' : 'Custom item', subtitle: record?.source, fields, content: preferred || 'No description available.' },
    back: { title: input.notes.trim() ? 'Notes' : 'Item', content: input.notes.trim() || undefined, note: input.notes.trim() ? undefined : 'No additional notes.' },
    warnings,
  }
}
