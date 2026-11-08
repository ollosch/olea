import { previewSetupHP } from './combatSetup.ts'
import type { CreatureHP } from './systems.ts'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

const supported: CreatureHP = { average: 8, formula: '2d8' }
const missing: CreatureHP = { average: null, formula: null }
const formulaOnly: CreatureHP = { average: null, formula: '3d8+2' }

assert(previewSetupHP(supported, 'average', { currentHp: '', maxHp: '' }).preview?.current === 8, 'average uses imported HP')
assert(previewSetupHP({ average: 0, formula: null }, 'average', { currentHp: '', maxHp: '' }).preview?.max === 0, 'zero average remains known')
assert(previewSetupHP(supported, 'roll', { currentHp: '', maxHp: '' }, () => 4).preview?.current === 8, 'roll uses the supported formula')
assert(previewSetupHP(formulaOnly, 'roll', { currentHp: '', maxHp: '' }, () => 1).preview?.current === 5, 'formula-only HP can roll')
assert(previewSetupHP(supported, 'manual', { currentHp: 5, maxHp: 9 }).preview?.max === 9, 'manual HP accepts physical dice values')
assert(previewSetupHP(supported, 'manual', { currentHp: 0, maxHp: 0 }).preview?.current === 0, 'manual zero HP stays known')
assert(previewSetupHP(supported, 'manual', { currentHp: '', maxHp: 9 }).preview === null, 'manual HP needs both values')
assert(previewSetupHP(supported, 'manual', { currentHp: -1, maxHp: 9 }).preview === null, 'manual HP rejects negatives')
assert(previewSetupHP(missing, 'average', { currentHp: '', maxHp: '' }).error.includes('no imported HP average'), 'average is unavailable without data')
assert(previewSetupHP(missing, 'roll', { currentHp: '', maxHp: '' }).error.includes('missing or unsupported'), 'roll is unavailable without a formula')
