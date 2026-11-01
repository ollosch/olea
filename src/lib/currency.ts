import type { SystemCapabilities } from './systems.ts'

export type Balances = Record<string, number>
export function totalBalances(stores: readonly (Balances | null | undefined)[]): Balances {
  const total: Balances = {}
  for (const store of stores) for (const [key, amount] of Object.entries(store ?? {})) total[key] = (total[key] ?? 0) + amount
  return total
}
export function coinWeight(balances: Balances, rules: SystemCapabilities['currency']): number | null {
  const supported = new Set(rules.denominations.map((entry) => entry.key))
  if (Object.entries(balances).some(([key, amount]) => amount > 0 && !supported.has(key))) return null
  if (!rules.coinWeight) return Object.values(balances).every((amount) => amount === 0) ? 0 : null
  return rules.coinWeight(balances)
}
