import { abilityModifier, evaluateDice, parseHPFormula, rollInitiative } from './dice.ts'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

assert(evaluateDice('2d6+3', () => 4) === 11, 'dice expression should include each die and constant')
assert(evaluateDice('1d8 - 2', () => 2) === 0, 'signed constant should be supported')
assert(parseHPFormula('3d8 + 6') === '3d8 + 6', 'supported HP formula should parse')
assert(parseHPFormula('3d8/2') === null, 'unsupported HP formula should be manual')
assert(abilityModifier(9) === -1 && abilityModifier(10) === 0, 'ability modifiers should floor correctly')
assert(rollInitiative(-2, () => 10) === 8, 'initiative modifier should be applied')
for (const expression of ['0d6', '1d0', '101d6', '1d1001', '1d6+2d4', '2 ** 10']) {
  let rejected = false
  try { evaluateDice(expression) } catch { rejected = true }
  assert(rejected, `invalid expression should reject: ${expression}`)
}
