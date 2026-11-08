export type LiveHPState = { current: number; max: number; known: boolean }
export type LiveHPInput = { currentHp: number | ''; maxHp: number | '' }
export type LiveHPInputResult = { valid: boolean; known: boolean; current: number; max: number; error: string }
export type LiveHPAdjustment = { next: number | null; error: string }

/** Validate a direct HP correction without clamping or inventing values. */
export function validateLiveHPInput(currentHp: number | '', maxHp: number | ''): LiveHPInputResult {
  const currentBlank = currentHp === ''
  const maxBlank = maxHp === ''
  if (currentBlank !== maxBlank) {
    return { valid: false, known: false, current: 0, max: 0, error: 'Enter both current and max HP, or leave both unset.' }
  }
  if (currentBlank) return { valid: true, known: false, current: 0, max: 0, error: '' }
  const current = Number(currentHp)
  const max = Number(maxHp)
  if (!Number.isFinite(current) || !Number.isFinite(max) || current < 0 || max < 0) {
    return { valid: false, known: false, current: 0, max: 0, error: 'HP values must be nonnegative numbers.' }
  }
  return { valid: true, known: true, current, max, error: '' }
}

/**
 * Resolve an entered damage (negative) or healing (positive) amount.
 * The caller must never clamp: impossible results become an explicit correction request.
 */
export function applyLiveHPAdjustment(hp: LiveHPState, amount: number): LiveHPAdjustment {
  if (!hp.known) return { next: null, error: 'HP is unknown. Set current and max HP before applying damage or healing.' }
  if (!Number.isFinite(amount) || amount === 0) return { next: null, error: 'Enter an amount greater than zero.' }
  if (amount < 0) {
    const next = hp.current + amount
    if (next < 0) return { next: null, error: `Damage is more than the current ${hp.current} HP. Use Set HP for a correction.` }
    return { next, error: '' }
  }
  const next = hp.current + amount
  if (next > hp.max) return { next: null, error: `Healing would exceed max HP ${hp.max}. Use Set HP for a correction.` }
  return { next, error: '' }
}

export type LiveDraftValues = { initiative: number | ''; current_hp: number | ''; max_hp: number | ''; conditions: string; notes: string }

/** Dirty detection used to keep the original guard baseline for unsaved participant edits. */
export function liveDraftDiffers(baseline: LiveDraftValues, draft: LiveDraftValues, baselineModifier: number | '', currentModifier: number | ''): boolean {
  return draft.initiative !== baseline.initiative
    || draft.current_hp !== baseline.current_hp
    || draft.max_hp !== baseline.max_hp
    || draft.conditions !== baseline.conditions
    || draft.notes !== baseline.notes
    || currentModifier !== baselineModifier
}
