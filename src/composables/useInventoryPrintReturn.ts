import { preparePrintReturn, rememberPrintReturn, type PrintReturnRestore } from './usePrintReturn'

const RETURN_STATE_KEY = 'oleaInventoryReturn'
const SCROLL_PREFIX = 'olea.inventory.scroll'
const SNAPSHOT_PREFIX = 'olea.inventory.snapshot'

export type InventoryPrintSnapshot = {
  storeId: string
  search: string
  collapsed: string[]
}

export type InventoryPrintRestore = PrintReturnRestore & {
  snapshot: InventoryPrintSnapshot | null
}

function scrollKey(characterId: string) {
  return `${SCROLL_PREFIX}.${characterId}`
}

function snapshotKey(characterId: string) {
  return `${SNAPSHOT_PREFIX}.${characterId}`
}

function readSnapshot(characterId: string): InventoryPrintSnapshot | null {
  try {
    const parsed = JSON.parse(sessionStorage.getItem(snapshotKey(characterId)) ?? 'null') as unknown
    if (!parsed || typeof parsed !== 'object') return null
    const record = parsed as Record<string, unknown>
    return {
      storeId: typeof record.storeId === 'string' ? record.storeId : '',
      search: typeof record.search === 'string' ? record.search : '',
      collapsed: Array.isArray(record.collapsed) ? record.collapsed.filter((id): id is string => typeof id === 'string') : [],
    }
  } catch {
    return null
  }
}

export function rememberInventoryPrintReturn(characterId: string, snapshot: InventoryPrintSnapshot) {
  if (!characterId) return
  try { sessionStorage.setItem(snapshotKey(characterId), JSON.stringify(snapshot)) } catch {}
  rememberPrintReturn(RETURN_STATE_KEY, scrollKey(characterId))
}

export function prepareInventoryPrintReturn(characterId: string): InventoryPrintRestore | null {
  if (!characterId) return null
  const restore = preparePrintReturn(RETURN_STATE_KEY, scrollKey(characterId))
  if (!restore) return null
  const snapshot = readSnapshot(characterId)
  try { sessionStorage.removeItem(snapshotKey(characterId)) } catch {}
  return { ...restore, snapshot }
}
