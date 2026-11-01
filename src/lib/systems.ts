import { adndHitDice, adndSpellFields } from './adnd.ts'
import { parseHPFormula } from './dice.ts'
import { abilityModifier, rollGroupInitiative, rollInitiative } from './dnd5e.ts'
import { compareChallengeRating, itemTypeLabel, neutralDescription, recordDescription, sourceLabel, type CatalogRecord, type CatalogType } from './catalog.ts'

/** Rules supplied by built-in systems; persistence and generic dice remain shared. */
export type InitiativeParticipant = { initiative: number; initiative_known: boolean }
export type CreatureHP = { average: number | null; formula: string | null }
export type CatalogFilter = {
  key: string
  label: string
  field: string
  match: 'exact' | 'list' | 'minimum' | 'maximum'
  labelValue?: (value: string) => string
  normalize?: (value: string) => string
}
export type Denomination = { key: string; label: string }
export type SystemCapabilities = {
  key: string
  encounter: {
    /** Compare initiative only. Shared code handles ties and stable ordering. */
    compare: (a: InitiativeParticipant, b: InitiativeParticipant) => number
    initiative: null | {
      modifier: (original: unknown) => number | null
      roll: typeof rollInitiative
      rollGroup: typeof rollGroupInitiative
      groupLabel: string
      modifierMin: number
      modifierMax: number
    }
    creatureHP: (original: unknown) => CreatureHP
  }
  catalog: {
    filters: Partial<Record<'spell' | 'creature' | 'item', readonly CatalogFilter[]>>
    resultLabel: (record: CatalogRecord) => string
    detailFields: (record: CatalogRecord) => Array<{ name: string; value: string }>
    description: (record: CatalogRecord, preferAlternate?: boolean) => unknown
    compare: (a: CatalogRecord, b: CatalogRecord) => number
    defaultFilters: (type: CatalogType, records: readonly CatalogRecord[]) => Record<string, string>
  }
  currency: {
    denominations: readonly Denomination[]
    /** Null means coin weight is unknown, not zero. */
    coinWeight: ((balances: Readonly<Record<string, number>>) => number) | null
  weightUnit: string | null
  }
  inventory: { catalogWeight: (record: CatalogRecord) => number | null }
}

const noHP = (): CreatureHP => ({ average: null, formula: null })
const manualOrder = (): number => 0
const unknown: SystemCapabilities = {
  key: '',
  encounter: { compare: manualOrder, initiative: null, creatureHP: noHP },
  catalog: { filters: { spell: [{ key: 'source', label: 'Source', field: 'source', match: 'exact' }], creature: [{ key: 'source', label: 'Source', field: 'source', match: 'exact' }], item: [{ key: 'source', label: 'Source', field: 'source', match: 'exact' }] }, resultLabel: (record) => record.source, detailFields: () => [], description: neutralDescription, compare: (a, b) => a.name.localeCompare(b.name), defaultFilters: () => ({}) },
  currency: { denominations: [], coinWeight: null, weightUnit: null },
  inventory: { catalogWeight: () => null },
}

const source: CatalogFilter = { key: 'source', label: 'Source', field: 'source', match: 'exact' }
const level: CatalogFilter = { key: 'level', label: 'Level', field: 'level', match: 'exact' }
const school: CatalogFilter = { key: 'school', label: 'School', field: 'school', match: 'exact' }

const dnd5e: SystemCapabilities = {
  key: 'dnd5e',
  encounter: {
    compare: (a, b) => a.initiative_known !== b.initiative_known ? (a.initiative_known ? -1 : 1)
      : a.initiative_known ? b.initiative - a.initiative : 0,
    initiative: {
      modifier: (original) => {
        const dex = original && typeof original === 'object' ? (original as Record<string, unknown>).dex : null
        return typeof dex === 'number' && Number.isInteger(dex) && dex >= 0 && dex <= 30 ? abilityModifier(dex) : null
      },
      roll: rollInitiative,
      rollGroup: rollGroupInitiative,
      groupLabel: 'Roll selected initiative with one shared d20',
      modifierMin: -20,
      modifierMax: 20,
    },
    creatureHP: (original) => {
      if (!original || typeof original !== 'object') return noHP()
      const hp = (original as Record<string, unknown>).hp
      if (!hp || typeof hp !== 'object') return noHP()
      const { average, formula } = hp as Record<string, unknown>
      return { average: typeof average === 'number' && Number.isFinite(average) && average >= 0 ? average : null, formula: parseHPFormula(formula) }
    },
  },
  catalog: { filters: {
    spell: [source, level, school],
    creature: [source, { key: 'creatureType', label: 'Creature type', field: 'creature_type', match: 'exact' }, { key: 'minCR', label: 'Minimum CR', field: 'challenge_rating', match: 'minimum' }, { key: 'maxCR', label: 'Maximum CR', field: 'challenge_rating', match: 'maximum' }],
    item: [source, { key: 'itemType', label: 'Type', field: 'item_type', match: 'exact', normalize: (value) => value.split('|')[0]!, labelValue: itemTypeLabel }, { key: 'rarity', label: 'Rarity', field: 'rarity', match: 'exact' }],
  },
  resultLabel: (record) => {
    const parts = [sourceLabel(record)]
    if (record.type === 'spell') parts.push(record.level === '0' ? 'Cantrip' : record.level ? `Level ${record.level}` : 'Level unknown', record.school)
    if (record.type === 'creature') parts.push(record.creature_type || 'Unknown type', `CR ${record.challenge_rating || '—'}`)
    if (record.type === 'item') parts.push(itemTypeLabel(record.item_type) || 'Item', record.rarity ?? '')
    return parts.filter(Boolean).join(' · ')
  },
  detailFields: (record) => {
    const fields: Array<{ name: string; value: string }> = []
    const add = (name: string, value: unknown) => { if (value !== undefined && value !== null && value !== '') fields.push({ name, value: String(value) }) }
    if (record.type === 'spell') { add('Level', record.level === '0' ? 'Cantrip' : record.level || '—'); add('School', record.school || '—') }
    if (record.type === 'creature') {
      add('Type', record.creature_type || '—'); add('Challenge rating', record.challenge_rating || '—')
      const hp = dnd5e.encounter.creatureHP(record.original_json)
      if (hp.average !== null || hp.formula) add('Hit points', `${hp.average ?? '—'}${hp.formula ? ` (${hp.formula})` : ''}`)
      const original = record.original_json as Record<string, unknown> | null
      if (typeof original?.dex === 'number') add('Dexterity', original.dex)
    }
    if (record.type === 'item') { add('Type', itemTypeLabel(record.item_type)); if (record.item_weight !== undefined) add('Weight', `${record.item_weight} lb.`); if (record.item_value !== undefined) add('Value', `${record.item_value} cp`); add('Rarity', record.rarity) }
    return fields
  }, description: recordDescription,
  compare: (a, b) => a.type === 'creature' ? compareChallengeRating(a.challenge_rating, b.challenge_rating) || a.name.localeCompare(b.name) : a.name.localeCompare(b.name),
  defaultFilters: (type, records): Record<string, string> => { const primary = type === 'creature' ? 'MM' : 'PHB'; return records.some((record) => record.source === primary) ? { source: primary } : {} },
  },
  currency: { denominations: ['cp', 'sp', 'ep', 'gp', 'pp'].map((key) => ({ key, label: key.toUpperCase() })), coinWeight: (balances) => Object.values(balances).reduce((sum, amount) => sum + amount, 0) / 50, weightUnit: 'lb.' },
  inventory: { catalogWeight: (record) => {
    let raw = record.item_weight
    if (raw && typeof raw === 'object' && 'value' in raw) raw = (raw as { value: unknown }).value
    const value = typeof raw === 'number' ? raw : typeof raw === 'string' && raw.trim() ? Number(raw) : NaN
    return Number.isFinite(value) && value >= 0 ? value : null
  } },
}

const book: CatalogFilter = { key: 'bookSource', label: 'Source book', field: 'book_source', match: 'exact' }
const adnd2e: SystemCapabilities = {
  key: 'adnd2e',
  encounter: { compare: manualOrder, initiative: null, creatureHP: (original) => ({ average: null, formula: adndHitDice(original) }) },
  catalog: { filters: { spell: [book, level, { ...school, match: 'list' }, { key: 'sphere', label: 'Sphere', field: 'sphere', match: 'list' }], creature: [book], item: [book] },
    resultLabel: (record) => [record.book_source || record.source, ...(record.type === 'spell' ? [record.level ? `Level ${record.level}` : 'Level unknown', record.school, record.sphere] : [])].filter(Boolean).join(' · '),
    detailFields: (record) => record.type === 'spell' ? [{ name: 'Level', value: record.level || '—' }, { name: 'School', value: record.school || '—' }, ...(record.sphere ? [{ name: 'Sphere', value: record.sphere }] : []), ...adndSpellFields(record.original_json)] : record.type === 'creature' && adndHitDice(record.original_json) ? [{ name: 'HP roll', value: adndHitDice(record.original_json)! }] : [],
    description: recordDescription,
    compare: (a, b) => a.name.localeCompare(b.name),
    defaultFilters: () => ({}),
  },
  currency: { denominations: [], coinWeight: null, weightUnit: null },
  inventory: { catalogWeight: () => null },
}

const builtIns: Readonly<Record<string, SystemCapabilities>> = { dnd5e, adnd2e }

/** Construct a static registry from built-in modules; no runtime discovery or plugins. */
export function createSystemRegistry(modules: readonly SystemCapabilities[]) {
  const registry = new Map<string, SystemCapabilities>()
  for (const module of modules) {
    if (!module.key || registry.has(module.key)) throw new Error(`Invalid or duplicate system key: ${module.key}`)
    registry.set(module.key, module)
  }
  return (key: string | null | undefined): SystemCapabilities => key ? registry.get(key) ?? unknown : unknown
}
const resolveBuiltIn = createSystemRegistry(Object.values(builtIns))

/** A missing expansion, stale relation, or unregistered key always resolves to manual rules. */
export function systemForGame(game: { system?: string; expand?: { system?: { id?: string; key?: string } } } | null | undefined): SystemCapabilities {
  const system = game?.expand?.system
  if (!game?.system || !system || (system.id && system.id !== game.system)) return unknown
  return systemByKey(system.key)
}

export function systemByKey(key: string | null | undefined): SystemCapabilities {
  return resolveBuiltIn(key)
}
