export type Unsubscribe = () => Promise<void>

/**
 * Subscribe sequentially so a partial failure can clean up every subscription
 * that was established before the failure.
 */
export async function subscribeAll<T>(topics: readonly T[], subscribe: (topic: T) => Promise<Unsubscribe>): Promise<Unsubscribe[]> {
  const stops: Unsubscribe[] = []
  try {
    for (const topic of topics) stops.push(await subscribe(topic))
    return stops
  } catch (cause) {
    await Promise.all(stops.map((stop) => stop().catch(() => {})))
    throw cause
  }
}
