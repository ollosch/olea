export type CatalogEntrySnapshot = {
  scrollY: number
  focusId: string | null
  savedAt: number
}

const storagePrefix = 'olea.catalog.entry.'
const fallback = new Map<string, CatalogEntrySnapshot>()

/** Identify the current browser history entry without replacing Vue Router's own state. */
function entryKey(): string {
  const state = typeof history === 'undefined' ? null : history.state as Record<string, unknown> | null
  const existing = state && typeof state.oleaCatalogEntry === 'string' ? state.oleaCatalogEntry : ''
  if (existing) return existing
  const key = `entry-${Date.now()}-${Math.random().toString(36).slice(2)}`
  try { history.replaceState({ ...(state ?? {}), oleaCatalogEntry: key }, '', location.href) } catch { /* History memory is optional. */ }
  return key
}

export function readCatalogEntrySnapshot(): CatalogEntrySnapshot | null {
  const key = storagePrefix + entryKey()
  try {
    const saved = sessionStorage.getItem(key)
    if (saved) {
      const parsed = JSON.parse(saved) as CatalogEntrySnapshot
      if (typeof parsed.scrollY === 'number' && typeof parsed.savedAt === 'number') return parsed
    }
  } catch { /* Fall back to in-memory storage. */ }
  return fallback.get(key) ?? null
}

export function saveCatalogEntrySnapshot(snapshot: CatalogEntrySnapshot): void {
  const key = storagePrefix + entryKey()
  try { sessionStorage.setItem(key, JSON.stringify(snapshot)) } catch { fallback.set(key, snapshot) }
}
