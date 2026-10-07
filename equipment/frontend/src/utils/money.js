// Money helpers.
//
// A game defines its own list of currencies. Each currency has a base_value
// expressed in the game's smallest unit (base_value = 1). Examples:
//   DnD      : copper 1, silver 10, gold 100
//   Numenera : shin 1
//   CoC      : cent 1, dollar 100

// Sum of a player's amounts into a single value in base units.
// amounts: { [currencyId]: integer }
export function walletTotal(amounts, currencies) {
  return currencies.reduce((sum, c) => sum + (amounts[c.id] || 0) * c.base_value, 0)
}

// Greedily represent a total value using the fewest coins possible.
// Returns [{ currency, amount }] (only non-zero amounts, largest first).
export function optimizeAmounts(amounts, currencies) {
  let total = walletTotal(amounts, currencies)
  const sorted = [...currencies].sort((a, b) => b.base_value - a.base_value)
  const out = []
  for (const c of sorted) {
    const amt = Math.floor(total / c.base_value)
    if (amt > 0) out.push({ currency: c, amount: amt })
    total -= amt * c.base_value
  }
  return out
}

export function currencyLabel(c) {
  return c.symbol || c.name
}

export function formatAmount(amount, currency) {
  return `${amount} ${currencyLabel(currency)}`
}
