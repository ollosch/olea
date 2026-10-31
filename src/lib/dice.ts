export type DieRoller = (sides: number) => number

const MAX_DICE = 100
const MAX_SIDES = 1000
const MAX_TOTAL = 100000

export function evaluateDice(expression: string, roller: DieRoller = (sides) => Math.floor(Math.random() * sides) + 1): number {
  const match = /^\s*(\d{1,3})\s*[dD]\s*(\d{1,4})\s*([+-]\s*\d{1,6})?\s*$/.exec(expression)
  if (!match) throw new Error('Use NdM with an optional signed constant, such as 2d8+3.')
  const count = Number(match[1])
  const sides = Number(match[2])
  const constant = match[3] ? Number(match[3].replace(/\s/g, '')) : 0
  if (count < 1 || count > MAX_DICE) throw new Error(`Dice count must be between 1 and ${MAX_DICE}.`)
  if (sides < 1 || sides > MAX_SIDES) throw new Error(`Die sides must be between 1 and ${MAX_SIDES}.`)
  if (Math.abs(constant) > MAX_TOTAL || count * sides + Math.abs(constant) > MAX_TOTAL) throw new Error('The expression exceeds the supported range.')
  let total = constant
  for (let index = 0; index < count; index++) {
    let result: number
    try { result = roller(sides) } catch { throw new Error('The die roller failed.') }
    if (!Number.isInteger(result) || result < 1 || result > sides) throw new Error('The die roller returned an invalid result.')
    total += result
  }
  return total
}

export function parseHPFormula(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const match = /^(\d{1,3}d\d{1,4}(?:\s*[+-]\s*\d{1,6})?)$/i.exec(value.trim())
  if (!match) return null
  try { evaluateDice(match[1], () => 1); return match[1] } catch { return null }
}

export function abilityModifier(score: number): number {
  if (!Number.isInteger(score) || score < 0 || score > 30) throw new Error('Ability score must be an integer from 0 to 30.')
  return Math.floor((score - 10) / 2)
}

export function rollInitiative(modifier: number, d20: () => number = () => Math.floor(Math.random() * 20) + 1): number {
  if (!Number.isInteger(modifier) || modifier < -20 || modifier > 20) throw new Error('Initiative modifier must be between −20 and +20.')
  let die: number
  try { die = d20() } catch { throw new Error('The die roller failed.') }
  if (!Number.isInteger(die) || die < 1 || die > 20) throw new Error('The die roller returned an invalid d20 result.')
  return die + modifier
}

export function rollGroupInitiative(modifiers: number[], d20: () => number = () => Math.floor(Math.random() * 20) + 1): number[] {
  if (!modifiers.length) throw new Error('Select at least one combatant.')
  const die = d20()
  return modifiers.map((modifier) => rollInitiative(modifier, () => die))
}
