import type { SystemCapabilities } from './systems.ts'

export type Balances = Record<string, number>
export type BalanceDraft = Record<string, string>
type Denomination = { key: string; label: string }

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

/** Start an edit with one direct-entry field per supported denomination, including zero. */
export function balanceDraft(balances: Balances | null | undefined, denominations: readonly Denomination[]): BalanceDraft {
  return Object.fromEntries(denominations.map((entry) => [entry.key, String(balances?.[entry.key] ?? 0)]))
}

/** Validate only the supported denominations the user can edit. Empty is not silently converted to zero. */
export function parseBalanceDraft(draft: BalanceDraft, denominations: readonly Denomination[]): { values: Balances } | { error: string } {
  const values: Balances = {}
  for (const denomination of denominations) {
    const text = String(draft[denomination.key] ?? '').trim()
    const amount = Number(text)
    if (!text || !Number.isSafeInteger(amount) || amount < 0) {
      return { error: `Enter a nonnegative whole number for ${denomination.label}.` }
    }
    values[denomination.key] = amount
  }
  return { values }
}

/**
 * Keep every unsupported balance from the guarded snapshot, even though only supported
 * denominations are editable. This never converts or drops an unknown balance.
 */
export function mergeBalances(base: Balances | null | undefined, values: Balances): Balances {
  return { ...(base ?? {}), ...values }
}

export function nonZeroBalances(balances: Balances | null | undefined, denominations: readonly Denomination[]): Array<{ key: string; label: string; amount: number }> {
  return denominations
    .filter((entry) => (balances?.[entry.key] ?? 0) !== 0)
    .map((entry) => ({ key: entry.key, label: entry.label, amount: balances?.[entry.key] ?? 0 }))
}

export function unsupportedBalanceEntries(balances: Balances | null | undefined, denominations: readonly Denomination[]): Array<{ key: string; amount: number }> {
  const supported = new Set(denominations.map((entry) => entry.key))
  return Object.entries(balances ?? {}).filter(([key, amount]) => amount !== 0 && !supported.has(key)).map(([key, amount]) => ({ key, amount }))
}
