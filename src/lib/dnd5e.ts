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
