export function entryWeight(entry) {
  const item = entry?.expand?.item
  if (!item) return 0
  const weight = Number(item.weight) || 0
  if (item.kind === 'stack') return weight * (Number(entry.quantity) || 0)
  return weight
}

export function totalWeight(entries) {
  return entries.reduce((sum, entry) => sum + entryWeight(entry), 0)
}

export function formatWeight(value, unit = 'lb') {
  const rounded = Math.round((Number(value) || 0) * 100) / 100
  return `${rounded} ${unit || 'lb'}`
}
