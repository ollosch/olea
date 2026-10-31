/** Render common wiki syntax as text. Unknown templates remain visible. */
export function wikiText(value: string): string {
  return value
    .replace(/<!--[^]*?-->/g, '')
    .replace(/\[\[Category:[^\]]+\]\]/gi, '')
    .replace(/\[\[([^\[\]]+)\]\]/g, (_, content: string) => content.split('|').at(-1) ?? content)
    .replace(/\{\{\s*br\s*\}\}/gi, '\n')
    .replace(/\{\{\s*frac\s*\|([^{}]+)\}\}/gi, (_, content: string) => content.split('|').join('/'))
    .replace(/\{\{([^{}]+)\}\}/g, (_, content: string) => `[${content.replaceAll('|', ': ')}]`)
    .replace(/<br\s*\/?\s*>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/'{2,5}/g, '')
    .replace(/^\s*={2,}\s*(.*?)\s*={2,}\s*$/gm, '$1')
    .replace(/^\s*\{\|[^\n]*|^\s*\|\}|^\s*\|-.*$/gm, '')
    .replace(/^\s*[!|]\s*/gm, '').replace(/\s*\|\|\s*/g, ' | ')
    .replace(/\n{3,}/g, '\n\n').trim()
}

export function htmlContent(value: string): unknown[] {
  const document = new DOMParser().parseFromString(value, 'text/html')
  document.querySelectorAll('script,style,iframe,object,embed,svg,math').forEach((node) => node.remove())
  const root = document.body.firstElementChild
  if (!root || root.tagName.toLowerCase() !== 'span') return []
  function nodeText(node: Node): string {
    if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? ''
    if (node.nodeType !== Node.ELEMENT_NODE) return ''
    const element = node as Element
    if (element.tagName === 'BR') return '\n'
    return Array.from(node.childNodes).map(nodeText).join('')
  }
  const blocks: unknown[] = []
  for (const element of Array.from(root.children)) {
    const tag = element.tagName.toLowerCase()
    if (tag === 'table') {
      const rows = Array.from(element.querySelectorAll('tr')).map((row) => Array.from(row.children).filter((cell) => cell.tagName === 'TD' || cell.tagName === 'TH').map((cell) => nodeText(cell).trim())).filter((row) => row.length)
      if (rows.length) blocks.push({ type: 'table', rows })
    } else if (['p', 'div', 'ul', 'ol', 'h1', 'h2', 'h3', 'h4'].includes(tag)) {
      const value = nodeText(element).trim(); if (value) blocks.push(value)
    }
  }
  return blocks
}

export function adndSpellFields(original: unknown): Array<{ name: string; value: string }> {
  if (!original || typeof original !== 'object') return []
  const source = original as { format?: string; fields?: Record<string, unknown> }
  if (source.format !== 'adnd2e-wikitext' || !source.fields) return []
  const fields = [['class', 'Class'], ['range', 'Range'], ['aoe', 'Area'], ['castingtime', 'Casting time'], ['duration', 'Duration'], ['save', 'Saving throw']].flatMap(([key, name]) => {
    const value = source.fields?.[key!]; return typeof value === 'string' && value.trim() ? [{ name: name!, value: wikiText(value) }] : []
  })
  const components = [['verbal', 'V'], ['somatic', 'S'], ['material', 'M']].filter(([key]) => source.fields?.[key!] === '1').map(([, label]) => label).join(', ')
  if (components) fields.push({ name: 'Components', value: components })
  return fields
}

export function adndHitDice(value: unknown): string | null {
  if (!value || typeof value !== 'object') return null
  const source = value as { format?: string; stats?: Record<string, string> }
  if (source.format !== 'adnd2e-html') return null
  // Fractional, variable, annotated, and multi-column hit dice need manual handling.
  const match = /^\s*(\d{1,2})\s*(?:(\+)\s*(\d{1,3}))?\s*$/.exec(source.stats?.['Hit Dice'] ?? '')
  if (!match || Number(match[1]) < 1 || Number(match[1]) > 100) return null
  return `${Number(match[1])}d8${match[2] ? match[2] + Number(match[3]) : ''}`
}
