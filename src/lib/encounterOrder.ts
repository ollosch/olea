import type { SystemCapabilities, InitiativeParticipant } from './systems.ts'

export type OrderedParticipant = InitiativeParticipant & { id: string; name: string; sort_order: number }

export function orderParticipants<T extends OrderedParticipant>(participants: readonly T[], tieOrderJSON: string, rules: SystemCapabilities['encounter']): T[] {
  let order: string[] = []
  try {
    const parsed: unknown = JSON.parse(tieOrderJSON || '[]')
    if (Array.isArray(parsed)) order = parsed.filter((id): id is string => typeof id === 'string')
  } catch { /* Invalid legacy order falls back to stable preparation order. */ }
  const indexes = new Map<string, number>()
  order.forEach((id, index) => { if (!indexes.has(id)) indexes.set(id, index) })
  return [...participants].sort((a, b) => rules.compare(a, b)
    || (indexes.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (indexes.get(b.id) ?? Number.MAX_SAFE_INTEGER)
    || a.sort_order - b.sort_order || a.name.localeCompare(b.name) || a.id.localeCompare(b.id))
}

export function activeParticipant<T extends OrderedParticipant>(ordered: readonly T[], activeId: string, legacyTurn: number): T | null {
  return ordered.find((entry) => entry.id === activeId) ?? ordered[legacyTurn] ?? ordered[0] ?? null
}
