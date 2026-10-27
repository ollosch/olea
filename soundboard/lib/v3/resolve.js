// v3 scene/track resolution.
//
// Inheritance order (plan section 5):
//   sounds/selection -> group
//   kind             -> track (never inherited)
//   trigger          -> mood -> track -> group defaults -> kind default
//   gain/reverb/pan  -> mood -> group defaults
//   enabled          -> mood param -> true
//
// Missing groups never throw; they resolve to an invalid result with no sounds.

import {
  KINDS,
  SELECTIONS,
  clamp01,
  clampPan,
  coerceReverb,
  resolveTriggerValue,
} from './schema.js'

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
const hasOwn = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key)

export function defaultMood(scene) {
  const moods = Array.isArray(scene?.moods) ? scene.moods : []
  if (!moods.length) return null
  return moods.find((mood) => mood.id === scene.defaultMoodId) || moods[0]
}

function groupLookup(groupsById) {
  if (groupsById instanceof Map) return (id) => groupsById.get(id) || null
  if (Array.isArray(groupsById)) {
    const index = new Map(groupsById.map((group) => [group?.id, group]))
    return (id) => index.get(id) || null
  }
  if (isObj(groupsById)) return (id) => groupsById[id] || null
  return () => null
}

export function resolveTrack(track, group, moodParam) {
  const t = isObj(track) ? track : {}
  const param = isObj(moodParam) ? moodParam : {}
  const g = isObj(group) ? group : null
  const defaults = isObj(g?.defaults) ? g.defaults : {}

  const kind = KINDS.includes(t.kind) ? t.kind : 'oneshot'
  const warnings = []
  if (!g) {
    warnings.push({
      type: 'missing-group',
      trackId: t.id ?? null,
      groupId: t.groupId ?? null,
    })
  }

  const sounds = g && Array.isArray(g.sounds) ? g.sounds.filter((s) => typeof s === 'string') : []
  const selection = g && SELECTIONS.includes(g.selection) ? g.selection : 'random'

  let gain = hasOwn(defaults, 'gain') ? defaults.gain : 0.8
  if (hasOwn(param, 'gain') && param.gain != null) gain = param.gain

  let reverb = hasOwn(defaults, 'reverb') ? defaults.reverb : null
  if (hasOwn(param, 'reverb')) reverb = param.reverb

  let pan = hasOwn(defaults, 'pan') ? defaults.pan : 0
  if (hasOwn(param, 'pan') && param.pan != null) pan = param.pan

  return {
    trackId: t.id ?? null,
    groupId: t.groupId ?? null,
    kind,
    sounds,
    selection,
    gain: clamp01(gain),
    reverb: coerceReverb(reverb),
    pan: clampPan(pan),
    enabled: typeof param.enabled === 'boolean' ? param.enabled : true,
    trigger: resolveTriggerValue(kind, param.trigger, t.trigger, defaults.trigger),
    order: Number.isFinite(t.order) ? t.order : 0,
    valid: Boolean(g),
    warnings,
    warning: warnings[0] || null,
  }
}

export function resolveScene(scene, groupsById, moodId) {
  const s = isObj(scene) ? scene : {}
  const lookup = groupLookup(groupsById)
  const moods = Array.isArray(s.moods) ? s.moods : []

  let mood = null
  if (moodId != null) mood = moods.find((candidate) => candidate.id === moodId) || null
  if (!mood) mood = defaultMood(s)

  const tracks = (Array.isArray(s.tracks) ? s.tracks : []).map((track) =>
    resolveTrack(track, lookup(track?.groupId), mood?.params?.[track?.id])
  )

  return { scene: s, mood, tracks }
}
