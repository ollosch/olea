const visibleInlineTags = new Set([
  'action', 'area', 'atk', 'book', 'chance', 'condition', 'creature', 'damage',
  'dice', 'dc', 'filter', 'hit', 'item', 'quickref', 'scaledamage', 'sense',
  'skill', 'spell', 'status', 'table', 'vehicle',
])

/** Convert common 5e inline tags to readable text without interpreting HTML. */
export function renderInlineText(value: string): string {
  return value.replace(/\{@([\w-]+)\s+([^{}]*)\}/g, (tag, rawKind: string, rawValue: string) => {
    const kind = rawKind.toLowerCase()
    if (!visibleInlineTags.has(kind)) return `${rawValue.trim()} (${kind})`
    const parts = rawValue.split('|').map((part) => part.trim())
    if (kind === 'quickref') return parts.at(-1) || parts[0] || rawValue
    if (kind === 'filter') return parts[0] || rawValue
    return parts[0] || rawValue
  })
}
