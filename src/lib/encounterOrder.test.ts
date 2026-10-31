import { orderParticipants, activeParticipant } from './encounterOrder.ts'
import { systemByKey } from './systems.ts'

const participants = [
  { id: 'a', name: 'A', sort_order: 0, initiative_known: true, initiative: 4 },
  { id: 'b', name: 'B', sort_order: 1, initiative_known: true, initiative: 15 },
  { id: 'c', name: 'C', sort_order: 2, initiative_known: true, initiative: 15 },
]
function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message) }
const five = orderParticipants(participants, '["c","b","a"]', systemByKey('dnd5e').encounter)
assert(five.map((p) => p.id).join('') === 'cba', '5e initiative and tie order')
assert(activeParticipant(five, 'a', 0)?.id === 'a', 'active participant survives reordered initiatives')
assert(activeParticipant(five, '', 1)?.id === 'b', 'legacy combat uses stored turn')
for (const key of ['adnd2e', 'invented']) {
  const manual = orderParticipants(participants, '["a","c","b"]', systemByKey(key).encounter)
  assert(manual.map((p) => p.id).join('') === 'acb', 'manual systems ignore initiative values')
  assert(activeParticipant(manual, 'c', 0)?.id === 'c', 'manual order retains active participant')
}
