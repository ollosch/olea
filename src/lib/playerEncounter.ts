import { orderParticipants } from './encounterOrder.ts'
import type { SystemCapabilities } from './systems.ts'

export type EncounterDisplaySettings = {
  showInitiative: boolean
  showEnemyNames: boolean
  showHP: boolean
  showConditions: boolean
}

export type EncounterParticipantDisplay = {
  name: string
  enemy: boolean
  initiative: number
  initiativeKnown: boolean
  currentHP: number
  maxHP: number
  hpKnown: boolean
  conditions: string
}

export function participantDisplay(participant: EncounterParticipantDisplay, settings: EncounterDisplaySettings) {
  return {
    name: participant.enemy && !settings.showEnemyNames ? 'Enemy' : participant.name,
    initiative: settings.showInitiative && participant.initiativeKnown ? participant.initiative : null,
    hp: settings.showHP && participant.enemy && participant.hpKnown ? { current: participant.currentHP, max: participant.maxHP } : null,
    conditions: settings.showConditions ? participant.conditions : '',
  }
}

export type PlayerParticipantOrder = {
  id: string
  name: string
  sort_order: number
  initiative: number
  initiative_known: boolean
}

/**
 * Hidden initiative must not influence the player-visible list order.
 * When initiative is hidden, fall back to the stored preparation order only.
 */
export function orderPlayerParticipants<T extends PlayerParticipantOrder>(
  participants: readonly T[],
  tieOrderJSON: string,
  rules: SystemCapabilities['encounter'],
  showInitiative: boolean,
): T[] {
  if (showInitiative) return orderParticipants(participants, tieOrderJSON, rules)
  return [...participants].sort((a, b) => a.sort_order - b.sort_order || a.id.localeCompare(b.id))
}
