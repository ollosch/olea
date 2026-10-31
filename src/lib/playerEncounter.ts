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
