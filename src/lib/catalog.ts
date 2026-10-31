export type CatalogType = 'spell' | 'creature' | 'item'
export type CatalogRecord = {
  id: string
  type: CatalogType
  source: string
  source_id: string
  name: string
  level: string
  school: string
  creature_type: string
  challenge_rating: string
  hp_average?: number
  hp_formula?: string
  dexterity?: number
  actions_json?: unknown
  item_type?: unknown
  item_weight?: unknown
  item_value?: unknown
  rarity?: string
  original_json: unknown
  alternate_description: string
  notes: string
  expand?: { system?: { key: string; name: string } }
}

export function recordDescription(record: CatalogRecord): unknown {
  const original = record.original_json as Record<string, unknown> | null
  if (record.alternate_description.trim()) return record.alternate_description
  if (!original) return ''
  if (record.type === 'creature') {
    const fluff = original.fluff as Record<string, unknown> | undefined
    const content = fluff?.entries ?? fluff?.description
    return [content, original.trait, original.action, original.reaction, original.legendary]
      .filter((entry) => Array.isArray(entry) ? entry.length > 0 : Boolean(entry))
  }
  return original.entries ?? original.description ?? ''
}

export function sourceLabel(record: CatalogRecord): string {
  const original = record.original_json as Record<string, unknown> | null
  const page = original?.page
  return typeof page === 'number' ? `${record.source} · p. ${page}` : record.source
}

export function itemTypeLabel(value: unknown): string {
  if (typeof value !== 'string') return ''
  const primary = value.split('|')[0]
  const labels: Record<string, string> = {
    A: 'Ammunition', AT: 'Artisan tools', G: 'Adventuring gear', HA: 'Heavy armor',
    INS: 'Instrument', M: 'Melee weapon', MA: 'Medium armor', P: 'Potion',
    R: 'Ranged weapon', RG: 'Ring', S: 'Shield', SC: 'Spellcasting focus',
    W: 'Wondrous item', WD: 'Wand', TG: 'Trade good',
  }
  return labels[primary] ?? primary
}

export function compareChallengeRating(left: string, right: string): number {
  return challengeValue(left) - challengeValue(right)
}

function challengeValue(value: string): number {
  const [numerator, denominator] = value.split('/').map(Number)
  return denominator ? numerator / denominator : Number(value)
}
