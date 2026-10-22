// Pure helpers for MIDI binding maps (`{ [key]: action }`).
//
// A binding map is keyed by a Web MIDI identifier (`"channel:note"` or
// `"channel:cc"`). Actions are small objects such as
// `{ type: 'element', elementId }` or `{ type: 'palette', paletteId }`.
//
// Re-learning an action must never leave that action bound to more than one
// key, so `bindAction` removes any previous same-action entry before writing
// the new one. Any binding already present on the captured key is replaced.

// Note actions store the element kind for readability, but dispatch always
// uses the element's current kind. Treat every element-note kind as the same
// target so re-learning still replaces the old binding after a reclassification.
const NOTE_ACTION_TYPES = new Set(['loop', 'random', 'oneshot'])

function sameType(a, b) {
  return (
    a.type === b.type ||
    (NOTE_ACTION_TYPES.has(a.type) && NOTE_ACTION_TYPES.has(b.type))
  )
}

// Compare actions for "same target". `scope` is deliberately ignored: local
// and global maps are separate, and the same conceptual action should replace
// itself wherever it is stored.
export function sameAction(a, b) {
  if (!a || !b) return false
  if (!sameType(a, b)) return false
  return (
    (a.elementId ?? null) === (b.elementId ?? null) &&
    (a.moodId ?? null) === (b.moodId ?? null) &&
    (a.soundsetId ?? null) === (b.soundsetId ?? null) &&
    (a.paletteId ?? null) === (b.paletteId ?? null) &&
    (a.bus ?? null) === (b.bus ?? null)
  )
}

// Return a NEW map with every entry targeting `action` removed, then `key`
// set to `action` (replacing whatever was on that key).
export function bindAction(map, key, action) {
  const out = { ...(map || {}) }
  for (const [existingKey, existing] of Object.entries(out)) {
    if (sameAction(existing, action)) delete out[existingKey]
  }
  out[key] = { ...action }
  return out
}

// Return a NEW map without bindings that target `action`.
export function removeActionBindings(map, action) {
  return removeBindings(map, (binding) => sameAction(binding, action))
}

// Return a NEW map without bindings for which `predicate(binding, key)` is true.
export function removeBindings(map, predicate) {
  const out = {}
  for (const [key, binding] of Object.entries(map || {})) {
    if (typeof predicate === 'function' && predicate(binding, key)) continue
    out[key] = binding
  }
  return out
}

// Key currently bound to `action`, or null.
export function findBindingKey(map, action) {
  for (const [key, binding] of Object.entries(map || {})) {
    if (sameAction(binding, action)) return key
  }
  return null
}
