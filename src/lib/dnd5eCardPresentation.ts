import { itemTypeLabel, type CatalogRecord } from './catalog.ts'
import { addCardField, sourceObject as object, sourceText as text, type CardField, type CardPresentation } from './cardPresentation.ts'

function componentsLabel(value: unknown): string {
  if (typeof value === 'string') return value
  if (Array.isArray(value)) return value.map(text).filter(Boolean).join(', ')
  const data = object(value)
  const parts = ['v', 's', 'm'].flatMap((key) => {
    const component = data[key]
    if (!component) return []
    const material = key === 'm' ? typeof component === 'string' ? component : text(object(component).text) : ''
    return [material ? `${key.toUpperCase()} (${material})` : key.toUpperCase()]
  })
  if (data.r) parts.push('Ritual')
  return parts.join(', ')
}

function spellFields(record: CatalogRecord) {
  const original = object(record.original_json)
  const fields: CardField[] = []
  addCardField(fields, 'Level', record.level === '0' ? 'Cantrip' : record.level)
  addCardField(fields, 'School', record.school)
  const times = Array.isArray(original.time) ? original.time : original.time ? [original.time] : []
  addCardField(fields, 'Casting time', times.map((entry) => {
    const data = object(entry)
    return [text(data.number), text(data.unit), data.condition ? `(${text(data.condition)})` : ''].filter(Boolean).join(' ')
  }).filter(Boolean).join(' or '))
  const range = object(original.range), distance = object(range.distance)
  addCardField(fields, 'Range', text(distance.amount) && text(distance.type) ? `${text(distance.amount)} ${text(distance.type)}` : text(distance.type || range.type || original.range))
  const durations = Array.isArray(original.duration) ? original.duration : original.duration ? [original.duration] : []
  addCardField(fields, 'Duration', durations.map((entry) => {
    const data = object(entry), duration = object(data.duration)
    return [data.concentration ? 'Concentration' : '', [text(duration.amount), text(duration.type)].filter(Boolean).join(' '), text(data.type)].filter(Boolean).join(' ')
  }).filter(Boolean).join(' or '))
  addCardField(fields, 'Components', componentsLabel(original.components))
  addCardField(fields, 'Classes', object(original.classes).from)
  const required = ['Level', 'Casting time', 'Range', 'Duration', 'Components']
  return { fields, missingFields: required.filter((label) => !fields.some((field) => field.label === label)) }
}

function creatureFields(record: CatalogRecord) {
  const original = object(record.original_json)
  const fields: CardField[] = []
  addCardField(fields, 'Type', record.creature_type)
  addCardField(fields, 'Challenge rating', record.challenge_rating)
  const hp = object(original.hp)
  if (typeof hp.average === 'number' && Number.isFinite(hp.average) && hp.average >= 0) addCardField(fields, 'Hit points', `${hp.average}${typeof hp.formula === 'string' && hp.formula ? ` (${hp.formula})` : ''}`)
  else if (typeof hp.formula === 'string') addCardField(fields, 'Hit points', hp.formula)
  const abilities = object(original.abilities)
  for (const [key, label] of [['str', 'STR'], ['dex', 'DEX'], ['con', 'CON'], ['int', 'INT'], ['wis', 'WIS'], ['cha', 'CHA']] as const) addCardField(fields, label, original[key] ?? abilities[key])
  for (const [key, label] of [['ac', 'Armor'], ['speed', 'Speed'], ['save', 'Saves'], ['skill', 'Skills'], ['resist', 'Resistances'], ['immune', 'Immunities'], ['conditionImmune', 'Condition immunity'], ['senses', 'Senses'], ['languages', 'Languages']] as const) addCardField(fields, label, original[key])
  const sections = (['trait', 'action', 'reaction', 'legendary'] as const).flatMap((key) => {
    const raw = key === 'action' && Array.isArray(original.action) ? original.action : key === 'action' && Array.isArray(record.actions_json) ? record.actions_json : original[key]
    if (!Array.isArray(raw)) return []
    return raw.map((entry) => {
      const data = object(entry)
      return typeof entry === 'string' ? entry : { type: 'entries', name: data.name, entries: Array.isArray(data.entries) ? data.entries : [data.desc ?? data.text ?? ''] }
    })
  })
  const fluff = object(original.fluff)
  return { fields, actions: sections, flavour: fluff.entries ?? fluff.description ?? '' }
}

function itemFields(record: CatalogRecord) {
  const original = object(record.original_json)
  const fields: CardField[] = []
  const title = itemTypeLabel(record.item_type) || 'Item'
  const weapon = /weapon/i.test(title) || Boolean(original.dmg1 || original.dmg2 || original.damage)
  addCardField(fields, 'Type', title)
  addCardField(fields, 'Rarity', record.rarity)
  if (record.item_weight !== undefined) addCardField(fields, 'Weight', record.item_weight)
  if (record.item_value !== undefined) addCardField(fields, 'Value', record.item_value)
  if (weapon) {
    addCardField(fields, 'Damage', original.dmg1 ?? original.damage ?? original.dmg2)
    addCardField(fields, 'Damage type', original.dmgType ?? original.damageType ?? original.damage_type)
    addCardField(fields, 'Versatile damage', original.dmg2)
    addCardField(fields, 'Range', original.range)
    addCardField(fields, 'Properties', original.property ?? original.properties)
    addCardField(fields, 'Mastery', original.mastery)
    addCardField(fields, 'Attack type', original.weaponCategory ?? original.weapon_category)
    addCardField(fields, 'Strength requirement', original.strength)
  } else {
    addCardField(fields, 'Attunement', original.reqAttune === true ? 'Required' : typeof original.reqAttune === 'string' ? original.reqAttune : '')
    if (record.item_value === undefined) addCardField(fields, 'Value', original.value)
    if (record.item_weight === undefined) addCardField(fields, 'Weight', original.weight)
  }
  return { title, fields }
}

export const dnd5eCardPresentation: CardPresentation = { spell: spellFields, creature: creatureFields, item: itemFields }
