import { participantDisplay } from './playerEncounter.ts'

const hidden = participantDisplay({ name: 'Goblin Scout', enemy: true, initiative: 14, initiativeKnown: true, currentHP: 3, maxHP: 7, hpKnown: true, conditions: 'prone' }, { showInitiative: false, showEnemyNames: false, showHP: false, showConditions: false })
if (hidden.name !== 'Enemy' || hidden.initiative !== null || hidden.hp !== null || hidden.conditions !== '') throw new Error('disabled player settings leaked details')
const visible = participantDisplay({ name: 'Goblin Scout', enemy: true, initiative: 14, initiativeKnown: true, currentHP: 3, maxHP: 7, hpKnown: true, conditions: 'prone' }, { showInitiative: true, showEnemyNames: true, showHP: true, showConditions: true })
if (visible.name !== 'Goblin Scout' || visible.initiative !== 14 || visible.hp?.current !== 3 || visible.conditions !== 'prone') throw new Error('enabled player settings failed to show details')
const character = participantDisplay({ name: 'Rowan', enemy: false, initiative: 9, initiativeKnown: true, currentHP: 4, maxHP: 9, hpKnown: true, conditions: 'stunned' }, { showInitiative: false, showEnemyNames: false, showHP: true, showConditions: false })
if (character.name !== 'Rowan' || character.hp !== null || character.conditions !== '') throw new Error('enemy HP policy should not expose player HP')

import { orderPlayerParticipants } from './playerEncounter.ts'
import { systemByKey } from './systems.ts'

const orderParticipants = [
  { id: 'a', name: 'Alpha', sort_order: 0, initiative: 5, initiative_known: true },
  { id: 'b', name: 'Bravo', sort_order: 1, initiative: 30, initiative_known: true },
  { id: 'c', name: 'Charlie', sort_order: 2, initiative: 20, initiative_known: true },
]
const hiddenOrder = orderPlayerParticipants(orderParticipants, '[]', systemByKey('dnd5e').encounter, false)
if (hiddenOrder.map((entry) => entry.id).join('') !== 'abc') throw new Error('hidden initiative changed the player list order')
const visibleOrder = orderPlayerParticipants(orderParticipants, '[]', systemByKey('dnd5e').encounter, true)
if (visibleOrder.map((entry) => entry.id).join('') !== 'bca') throw new Error('shown initiative did not use the system order')
