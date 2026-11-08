export type InventoryTreeItem = { id: string; name: string; container: string }

export type InventoryRow<T extends InventoryTreeItem> = {
  item: T
  depth: number
  /** Container names from the outermost container to the immediate parent. */
  location: string[]
  childCount: number
  expanded: boolean
}

export type InventoryRows<T extends InventoryTreeItem> = {
  rows: InventoryRow<T>[]
  matched: number
  total: number
}

type Options<T extends InventoryTreeItem> = {
  collapsed?: ReadonlySet<string>
  query?: string
  text?: (item: T, location: readonly string[]) => string
}

const byName = (a: InventoryTreeItem, b: InventoryTreeItem) => a.name.localeCompare(b.name)

/**
 * Flatten inventory items into hierarchy rows. Missing or self-referential parents
 * become roots, and cycles are shown once as roots instead of being hidden or looping.
 */
export function inventoryRows<T extends InventoryTreeItem>(items: readonly T[], options: Options<T> = {}): InventoryRows<T> {
  const byId = new Map(items.map((item) => [item.id, item]))
  const children = new Map<string, T[]>()
  const roots: T[] = []
  for (const item of items) {
    const parent = item.container && item.container !== item.id && byId.has(item.container) ? item.container : ''
    if (!parent) {
      roots.push(item)
      continue
    }
    const siblings = children.get(parent) ?? []
    siblings.push(item)
    children.set(parent, siblings)
  }
  roots.sort(byName)
  for (const siblings of children.values()) siblings.sort(byName)

  const locationOf = (item: T): string[] => {
    const names: string[] = []
    const seen = new Set([item.id])
    let parent = item.container
    while (parent && byId.has(parent) && !seen.has(parent)) {
      const container = byId.get(parent)!
      seen.add(container.id)
      names.unshift(container.name)
      parent = container.container
    }
    return names
  }

  const query = options.query?.trim().toLocaleLowerCase() ?? ''
  const matches = new Set<string>()
  const visible = new Set<string>()
  if (query) {
    for (const item of items) {
      const location = locationOf(item)
      const haystack = (options.text?.(item, location) ?? [item.name, ...location].join(' ')).toLocaleLowerCase()
      if (!haystack.includes(query)) continue
      matches.add(item.id)
      visible.add(item.id)
      const seen = new Set([item.id])
      let parent = item.container
      while (parent && byId.has(parent) && !seen.has(parent)) {
        seen.add(parent)
        visible.add(parent)
        parent = byId.get(parent)!.container
      }
    }
  } else {
    for (const item of items) visible.add(item.id)
  }

  const reachable = new Set<string>()
  const markReachable = (item: T) => {
    if (reachable.has(item.id)) return
    reachable.add(item.id)
    for (const child of children.get(item.id) ?? []) markReachable(child)
  }
  for (const root of roots) markReachable(root)

  const rows: InventoryRow<T>[] = []
  const visited = new Set<string>()
  const walk = (item: T, depth: number, location: string[]) => {
    if (visited.has(item.id) || !visible.has(item.id)) return
    visited.add(item.id)
    const descendants = children.get(item.id) ?? []
    const expanded = query ? true : !options.collapsed?.has(item.id)
    rows.push({ item, depth, location, childCount: descendants.length, expanded })
    if (!expanded) return
    for (const child of descendants) walk(child, depth + 1, [...location, item.name])
  }
  for (const root of roots) walk(root, 0, [])
  for (const item of items) {
    if (!visited.has(item.id) && visible.has(item.id) && !reachable.has(item.id)) walk(item, 0, locationOf(item))
  }
  return { rows, matched: query ? matches.size : items.length, total: items.length }
}
