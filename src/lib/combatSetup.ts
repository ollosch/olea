import { evaluateDice, type DieRoller } from './dice.ts'
import type { CreatureHP } from './systems.ts'

export type SetupHPMode = 'average' | 'roll' | 'manual'
export type SetupHPValues = { current: number; max: number }
export type SetupHPResult = { preview: SetupHPValues | null; error: string }

/** Resolve the HP values a setup action will stage, without writing to the server. */
export function previewSetupHP(
  source: CreatureHP,
  mode: SetupHPMode,
  manual: { currentHp: number | ''; maxHp: number | '' },
  roller?: DieRoller,
): SetupHPResult {
  if (mode === 'manual') {
    const current = Number(manual.currentHp)
    const max = Number(manual.maxHp)
    if (manual.currentHp === '' || manual.maxHp === '' || !Number.isFinite(current) || !Number.isFinite(max) || current < 0 || max < 0) {
      return { preview: null, error: 'Enter nonnegative current and max HP first.' }
    }
    return { preview: { current, max }, error: '' }
  }
  if (mode === 'average') {
    if (source.average === null) {
      return { preview: null, error: 'This creature has no imported HP average. Enter HP manually or use a supported formula.' }
    }
    return { preview: { current: source.average, max: source.average }, error: '' }
  }
  if (!source.formula) {
    return { preview: null, error: 'This HP formula is missing or unsupported. Enter HP manually.' }
  }
  try {
    const result = Math.max(0, evaluateDice(source.formula, roller))
    return { preview: { current: result, max: result }, error: '' }
  } catch (cause) {
    return { preview: null, error: cause instanceof Error ? cause.message : 'HP formula could not be rolled.' }
  }
}
