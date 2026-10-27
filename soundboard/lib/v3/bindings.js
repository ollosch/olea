// Pure MIDI binding helpers for v3.
//
// Binding maps are `{ notes: { [key]: action }, ccs: { [key]: action } }`.
// Canonical keys are `"<channel>:<type>:<number>"`, where type is `note` or
// `cc`, channel is 0..15, and number is 0..127.
//
// Actions are explicit and scoped: global actions may only live in global.json,
// local actions may only live in a scene. Re-learning a target replaces its
// previous key; a target may have at most one binding. All functions are pure
// and return new objects.

const BUS_KEYS = ['loop', 'random', 'oneshot']

const NOTE_ACTIONS = new Set([
  'stopAll',
  'paletteTrigger',
  'openScene',
  'trackTrigger',
  'moodSelect',
  'sceneToggle',
])

const CC_ACTIONS = new Set([
  'masterVolume',
  'busVolume',
  'paletteVolume',
  'trackVolume',
])

const GLOBAL_ACTIONS = new Set([
  'stopAll',
  'masterVolume',
  'busVolume',
  'paletteTrigger',
  'paletteVolume',
  'openScene',
  'sceneToggle',
])

const LOCAL_ACTIONS = new Set(['trackTrigger', 'trackVolume', 'moodSelect', 'sceneToggle'])

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)

function idString(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : ''
}

function scopeName(scope) {
  if (scope === 'scene') return 'local'
  return scope === 'local' || scope === 'global' ? scope : null
}

function intInRange(value, min, max) {
  const n = typeof value === 'number' ? value : typeof value === 'string' && value.trim() !== '' ? Number(value) : NaN
  return Number.isInteger(n) && n >= min && n <= max ? n : null
}

// Action factories. The object shape is the v3 action contract.
export function stopAll() {
  return { type: 'stopAll' }
}

export function masterVolume() {
  return { type: 'masterVolume' }
}

export function busVolume(bus) {
  return { type: 'busVolume', bus }
}

export function paletteTrigger(paletteId) {
  return { type: 'paletteTrigger', paletteId }
}

export function paletteVolume(paletteId) {
  return { type: 'paletteVolume', paletteId }
}

export function openScene(sceneId) {
  return { type: 'openScene', sceneId }
}

export function trackTrigger(trackId) {
  return { type: 'trackTrigger', trackId }
}

export function trackVolume(trackId) {
  return { type: 'trackVolume', trackId }
}

export function moodSelect(moodId) {
  return { type: 'moodSelect', moodId }
}

export function sceneToggle() {
  return { type: 'sceneToggle' }
}

export const ACTION = {
  stopAll,
  masterVolume,
  busVolume,
  paletteTrigger,
  paletteVolume,
  openScene,
  trackTrigger,
  trackVolume,
  moodSelect,
  sceneToggle,
}

export function actionChannelType(action) {
  if (!isObj(action) || typeof action.type !== 'string') return null
  if (NOTE_ACTIONS.has(action.type)) return 'note'
  if (CC_ACTIONS.has(action.type)) return 'cc'
  return null
}

export function normalizeMidiAction(action, scope) {
  const resolvedScope = scopeName(scope)
  if (!resolvedScope || !isObj(action)) return null
  const type = action.type
  const allowed = resolvedScope === 'global' ? GLOBAL_ACTIONS : LOCAL_ACTIONS
  if (typeof type !== 'string' || !allowed.has(type)) return null

  switch (type) {
    case 'busVolume': {
      if (!BUS_KEYS.includes(action.bus)) return null
      return { type, bus: action.bus }
    }
    case 'paletteTrigger':
    case 'paletteVolume': {
      const paletteId = idString(action.paletteId)
      return paletteId ? { type, paletteId } : null
    }
    case 'openScene': {
      const sceneId = idString(action.sceneId)
      return sceneId ? { type, sceneId } : null
    }
    case 'trackTrigger':
    case 'trackVolume': {
      const trackId = idString(action.trackId)
      return trackId ? { type, trackId } : null
    }
    case 'moodSelect': {
      const moodId = idString(action.moodId)
      return moodId ? { type, moodId } : null
    }
    default:
      return { type }
  }
}

export function sameTarget(a, b) {
  if (!isObj(a) || !isObj(b) || a.type !== b.type) return false
  switch (a.type) {
    case 'busVolume':
      return a.bus === b.bus
    case 'paletteTrigger':
    case 'paletteVolume':
      return a.paletteId === b.paletteId
    case 'openScene':
      return a.sceneId === b.sceneId
    case 'trackTrigger':
    case 'trackVolume':
      return a.trackId === b.trackId
    case 'moodSelect':
      return a.moodId === b.moodId
    default:
      return true
  }
}

export function targetKey(action) {
  if (!isObj(action)) return ''
  switch (action.type) {
    case 'busVolume':
      return `busVolume|${action.bus ?? ''}`
    case 'paletteTrigger':
    case 'paletteVolume':
      return `${action.type}|${action.paletteId ?? ''}`
    case 'openScene':
      return `openScene|${action.sceneId ?? ''}`
    case 'trackTrigger':
    case 'trackVolume':
      return `${action.type}|${action.trackId ?? ''}`
    case 'moodSelect':
      return `moodSelect|${action.moodId ?? ''}`
    default:
      return String(action.type ?? '')
  }
}

export function bindingKey(channel, type, number) {
  const normalizedType = type === 'notes' ? 'note' : type === 'ccs' ? 'cc' : type
  const ch = intInRange(channel, 0, 15)
  const value = intInRange(number, 0, 127)
  if (ch === null || value === null || (normalizedType !== 'note' && normalizedType !== 'cc')) {
    throw new Error(`Invalid MIDI binding: ${channel}:${type}:${number}`)
  }
  return `${ch}:${normalizedType}:${value}`
}

export function parseBindingKey(key) {
  if (typeof key !== 'string') return null
  const parts = key.split(':')
  if (parts.length !== 3) return null
  const channel = intInRange(parts[0], 0, 15)
  const number = intInRange(parts[2], 0, 127)
  const type = parts[1].trim().toLowerCase()
  if (channel === null || number === null || (type !== 'note' && type !== 'cc')) return null
  return { channel, type, number }
}

function canonicalKey(key) {
  const parsed = parseBindingKey(key)
  return parsed ? bindingKey(parsed.channel, parsed.type, parsed.number) : null
}

function mapNameFor(type) {
  return type === 'note' ? 'notes' : 'ccs'
}

function cloneMaps(midi) {
  return {
    notes: { ...(isObj(midi?.notes) ? midi.notes : {}) },
    ccs: { ...(isObj(midi?.ccs) ? midi.ccs : {}) },
  }
}

export function findTargetBinding(midi, scope, action) {
  const normalized = normalizeMidiAction(action, scope)
  if (!normalized) return null
  for (const mapName of ['notes', 'ccs']) {
    const map = isObj(midi?.[mapName]) ? midi[mapName] : {}
    for (const [key, binding] of Object.entries(map)) {
      if (sameTarget(binding, normalized)) return key
    }
  }
  return null
}

export function removeTargetBindings(midi, scope, action) {
  const out = cloneMaps(midi)
  const normalized = normalizeMidiAction(action, scope)
  if (!normalized) return out
  for (const mapName of ['notes', 'ccs']) {
    for (const [key, binding] of Object.entries(out[mapName])) {
      if (sameTarget(binding, normalized)) delete out[mapName][key]
    }
  }
  return out
}

export function setBinding(midi, scope, key, action) {
  const parsed = parseBindingKey(key)
  if (!parsed) throw new Error(`Invalid MIDI key: ${key}`)
  const normalized = normalizeMidiAction(action, scope)
  if (!normalized) throw new Error(`Invalid MIDI action for scope "${scope}"`)
  if (actionChannelType(normalized) !== parsed.type) {
    throw new Error(`Action "${normalized.type}" cannot be bound to a ${parsed.type} key`)
  }

  const canonical = bindingKey(parsed.channel, parsed.type, parsed.number)
  const out = cloneMaps(midi)

  for (const mapName of ['notes', 'ccs']) {
    for (const [existingKey, binding] of Object.entries(out[mapName])) {
      if (sameTarget(binding, normalized)) delete out[mapName][existingKey]
    }
    delete out[mapName][key]
    delete out[mapName][canonical]
  }

  out[mapNameFor(parsed.type)][canonical] = normalized
  return out
}

function flattenBindings(midi) {
  const map = new Map()
  for (const mapName of ['notes', 'ccs']) {
    const bindings = isObj(midi?.[mapName]) ? midi[mapName] : {}
    for (const [key, action] of Object.entries(bindings)) {
      const canonical = canonicalKey(key) || key
      map.set(canonical, action)
    }
  }
  return map
}

export function findConflicts(globalMidi, sceneMidi) {
  const globalBindings = flattenBindings(globalMidi)
  const localBindings = flattenBindings(sceneMidi)
  const conflicts = []
  for (const [key, globalAction] of globalBindings) {
    const localAction = localBindings.get(key)
    if (localAction) conflicts.push({ key, globalAction, localAction })
  }
  return conflicts.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
}

export function localShadowing(globalMidi, sceneMidi, key) {
  const canonical = canonicalKey(key)
  if (!canonical) return null
  const globalAction = flattenBindings(globalMidi).get(canonical)
  const localAction = flattenBindings(sceneMidi).get(canonical)
  return globalAction && localAction ? localAction : null
}

export function cleanupBindings(midi, scope = 'global', predicate) {
  const out = { notes: {}, ccs: {} }
  for (const mapName of ['notes', 'ccs']) {
    const bindings = isObj(midi?.[mapName]) ? midi[mapName] : {}
    for (const [key, action] of Object.entries(bindings)) {
      const normalized = normalizeMidiAction(action, scope)
      if (!normalized) continue
      if (typeof predicate === 'function' && predicate(normalized, key)) continue
      out[mapName][key] = normalized
    }
  }
  return out
}

export function removeBindingsForTargets(midi, scope, targets) {
  const list = Array.isArray(targets) ? targets : []
  const normalized = list.map((target) => normalizeMidiAction(target, scope)).filter(Boolean)
  return cleanupBindings(midi, scope, (action) => normalized.some((target) => sameTarget(action, target)))
}
