import { applyLiveHPAdjustment, liveDraftDiffers, validateLiveHPInput } from './liveCombat.ts'

function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message) }
const known = { current: 7, max: 10, known: true }

const damaged = applyLiveHPAdjustment(known, -3)
assert(damaged.next === 4, 'damage reduces current HP')
const healed = applyLiveHPAdjustment(known, 2)
assert(healed.next === 9, 'healing adds to current HP')
assert(applyLiveHPAdjustment({ current: 0, max: 10, known: true }, -1).next === null, 'damage cannot silently clamp zero')
assert(applyLiveHPAdjustment({ current: 0, max: 10, known: true }, 2).next === 2, 'healing from zero works')
assert(applyLiveHPAdjustment({ current: 9, max: 10, known: true }, 2).next === null, 'healing cannot silently clamp to max')
assert(applyLiveHPAdjustment({ current: 0, max: 0, known: true }, 1).next === null, 'healing cannot exceed a zero max')
assert(applyLiveHPAdjustment({ current: 0, max: 0, known: false }, 1).next === null, 'unknown HP blocks adjustment')
assert(applyLiveHPAdjustment(known, 0).next === null, 'zero amount is not a write')
assert(applyLiveHPAdjustment(known, Number.NaN).next === null, 'non-numeric amount is rejected')

const blank = validateLiveHPInput('', '')
assert(blank.valid && !blank.known, 'both blank means unknown, not zero')
const partial = validateLiveHPInput(5, '')
assert(!partial.valid && partial.error.includes('both current and max'), 'partial HP needs both sides')
const zero = validateLiveHPInput(0, 0)
assert(zero.valid && zero.known && zero.current === 0 && zero.max === 0, 'zero is a known value')
const aboveMax = validateLiveHPInput(12, 10)
assert(aboveMax.valid && aboveMax.current === 12 && aboveMax.max === 10, 'direct correction is not silently clamped')
const negative = validateLiveHPInput(-1, 10)
assert(!negative.valid && negative.error.includes('nonnegative'), 'negative HP is rejected')

const baselineDraft = { initiative: 10, current_hp: 7, max_hp: 7, conditions: '', notes: '' }
assert(!liveDraftDiffers(baselineDraft, { ...baselineDraft }, '', ''), 'identical draft and modifier are clean')
assert(liveDraftDiffers(baselineDraft, { ...baselineDraft, current_hp: 0 }, '', ''), 'zero current HP is a real dirty value')
assert(liveDraftDiffers({ ...baselineDraft, initiative: '' }, { ...baselineDraft, initiative: 0 }, '', ''), 'zero initiative differs from unset')
assert(liveDraftDiffers(baselineDraft, { ...baselineDraft, conditions: 'prone' }, '', ''), 'conditions are dirty')
assert(liveDraftDiffers(baselineDraft, { ...baselineDraft, notes: 'note' }, '', ''), 'notes are dirty')
assert(liveDraftDiffers(baselineDraft, { ...baselineDraft }, '', 2), 'modifier-only edits are dirty')
assert(!liveDraftDiffers(baselineDraft, { ...baselineDraft }, 2, 2), 'matching modifier is clean')
