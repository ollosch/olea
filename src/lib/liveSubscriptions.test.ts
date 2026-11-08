import { subscribeAll } from './liveSubscriptions.ts'
import type { Unsubscribe } from './liveSubscriptions.ts'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

const stopped: string[] = []
const subscribe = (topic: string): Promise<Unsubscribe> => {
  if (topic === 'failing') return Promise.reject(new Error('synthetic subscription failure'))
  return Promise.resolve(async () => { stopped.push(topic) })
}

let failed = false
try {
  await subscribeAll(['games', 'failing', 'combatants'], subscribe)
} catch {
  failed = true
}
assert(failed, 'a partial subscription failure must reject')
assert(stopped.join(',') === 'games', 'partial failure must clean up the subscriptions that succeeded')

const complete = await subscribeAll(['games', 'combats'], subscribe)
assert(complete.length === 2, 'a complete subscription set returns every stop function')
for (const stop of complete) await stop()
assert(stopped.slice(1).join(',') === 'games,combats', 'complete subscriptions can be stopped individually')
