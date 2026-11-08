import { pb } from './pocketbase'

export type VersionedRecord = { id: string; updated: string }

const conflictFields: Record<string, string[]> = {
  combatants: ['initiative', 'initiative_known', 'initiative_modifier', 'initiative_modifier_override', 'current_hp', 'max_hp', 'hp_known', 'conditions', 'notes', 'dexterity_modifier', 'dexterity_known'],
  combats: ['active', 'round', 'turn', 'active_participant', 'tie_order', 'visible', 'show_initiative', 'show_enemy_names', 'show_hp', 'show_conditions'],
  inventories: ['balances', 'capacity', 'capacity_known'],
  inventory_items: ['quantity', 'notes', 'weight', 'weight_known', 'is_container', 'container'],
  stashes: ['balances', 'name', 'location', 'notes'],
  games: ['encounter_visible', 'encounter_show_initiative', 'encounter_show_enemy_names', 'encounter_show_hp', 'encounter_show_conditions'],
}

export async function guardedUpdate<T extends VersionedRecord>(collection: string, record: T, fields: Record<string, unknown>): Promise<void> {
  for (const key of Object.keys(fields)) {
    if (!conflictFields[collection]?.includes(key)) throw new Error(`Unsupported guarded field: ${key}`)
  }
  const expected = Object.fromEntries((conflictFields[collection] ?? []).map((key) => {
    const raw = (record as unknown as Record<string, unknown>)[key]
    return [key, raw ?? (key === 'balances' ? {} : key === 'container' || key === 'notes' || key === 'location' || key === 'active_participant' ? '' : typeof fields[key] === 'boolean' ? false : typeof fields[key] === 'string' ? '' : 0)]
  }))
  if (collection === 'inventory_items') {
    expected.inventory = (record as unknown as { inventory: string }).inventory ?? ''
    expected.stash = (record as unknown as { stash: string }).stash ?? ''
  }
  await pb.send(`/api/olea/records/${encodeURIComponent(collection)}/${encodeURIComponent(record.id)}/update`, {
    method: 'POST',
    body: { expected, fields },
  })
}

export function isConflict(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'status' in error && (error as { status?: number }).status === 409)
}

/**
 * Only explicit client validation/authorization rejections are definite failures.
 * 408 and 5xx responses, aborts and network errors may follow a committed write.
 */
const definiteWriteRejections = new Set([400, 401, 403, 404, 405, 409, 413, 415, 422, 429])

export function isDefiniteWriteRejection(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'status' in error && typeof (error as { status?: unknown }).status === 'number' && definiteWriteRejections.has((error as { status: number }).status))
}
