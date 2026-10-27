// Soundboard v3 schema: constants, normalization, and default constructors.
//
// Dependency-free and browser-safe. Every normalizer returns exactly the v3
// shape and is idempotent (normalizing its own output yields the same value).
// Normalizers never throw for missing/mistyped fields; the only exception is a
// category containing a `..` segment, which is rejected explicitly.

import {
  actionChannelType,
  bindingKey,
  normalizeMidiAction,
  parseBindingKey,
  targetKey,
} from './bindings.js'

export const VERSION = 3

export const KINDS = ['loop', 'random', 'oneshot']
export const BUSES = KINDS
export const SELECTIONS = ['random', 'ordered']

export const DEFAULT_RANDOM_TRIGGER = Object.freeze({
  min: 10,
  max: 30,
  startMin: 2,
  startMax: 10,
})

// Curated reverb presets. `null` (or "Off") means no reverb send.
export const REVERB_PRESETS = [
  'City',
  'Cave',
  'Stone Dungeon',
  'Soft furnished room',
  'Stone room',
  'Forest',
  'Mountains',
  'Plain',
  'Alley',
  'Hallway',
  'Auditorium',
  'Arena',
]

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
const hasOwn = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key)

function str(v, def = '') {
  return typeof v === 'string' ? v : def
}

function num(v, def) {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN
  return Number.isFinite(n) ? n : def
}

function uidFallback() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (ch) => {
    const r = (Math.random() * 16) | 0
    const v = ch === 'x' ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}

export function uid() {
  const c = globalThis.crypto
  if (c && typeof c.randomUUID === 'function') return c.randomUUID()
  return uidFallback()
}

export function clamp01(v) {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN
  if (!Number.isFinite(n)) return 0
  return Math.min(1, Math.max(0, n))
}

export function clampPan(v) {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN
  if (!Number.isFinite(n)) return 0
  return Math.min(1, Math.max(-1, n))
}

function triggerNum(v) {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN
  if (!Number.isFinite(n) || n < 0) return 0
  return n
}

export function sanitizeTrigger(raw) {
  const t = isObj(raw) ? raw : {}
  let min = triggerNum(t.min)
  let max = triggerNum(t.max)
  let startMin = triggerNum(t.startMin)
  let startMax = triggerNum(t.startMax)
  if (min > max) [min, max] = [max, min]
  if (startMin > startMax) [startMin, startMax] = [startMax, startMin]
  return { min, max, startMin, startMax }
}

export function isZeroTrigger(t) {
  const s = sanitizeTrigger(t)
  return s.min === 0 && s.max === 0 && s.startMin === 0 && s.startMax === 0
}

function zeroTrigger() {
  return { min: 0, max: 0, startMin: 0, startMax: 0 }
}

export function normalizeTriggerForKind(kind, raw) {
  if (kind !== 'random') return zeroTrigger()
  return sanitizeTrigger(raw)
}

export function resolveTriggerValue(kind, ...candidates) {
  if (kind !== 'random') return zeroTrigger()
  for (const candidate of candidates) {
    if (candidate == null) continue
    const trigger = sanitizeTrigger(candidate)
    if (!isZeroTrigger(trigger)) return trigger
  }
  return { ...DEFAULT_RANDOM_TRIGGER }
}

export function normalizeCategory(value) {
  if (typeof value !== 'string') return ''
  const segments = value.replace(/\\/g, '/').split('/')
  const out = []
  for (const raw of segments) {
    const segment = raw.trim()
    if (!segment || segment === '.') continue
    if (segment === '..') {
      throw new Error(`Invalid category: ".." segments are not allowed in "${value}"`)
    }
    out.push(segment)
  }
  return out.join('/')
}

export function normalizeTags(value) {
  if (!Array.isArray(value)) return []
  const seen = new Set()
  const out = []
  for (const raw of value) {
    if (typeof raw !== 'string') continue
    const tag = raw.trim()
    if (!tag) continue
    const key = tag.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(tag)
  }
  return out
}

export function coerceKind(value, fallback = 'oneshot') {
  return KINDS.includes(value) ? value : fallback
}

export function coerceReverb(value) {
  if (value == null || typeof value !== 'string') return null
  const name = value.trim()
  if (!name || name.toLowerCase() === 'off') return null
  return REVERB_PRESETS.find((preset) => preset.toLowerCase() === name.toLowerCase()) || null
}

function coerceSelection(value) {
  return SELECTIONS.includes(value) ? value : 'random'
}

function uniqueStrings(value) {
  if (!Array.isArray(value)) return []
  const seen = new Set()
  const out = []
  for (const raw of value) {
    if (typeof raw !== 'string') continue
    const id = raw.trim()
    if (!id || seen.has(id)) continue
    seen.add(id)
    out.push(id)
  }
  return out
}

export function normalizeSound(raw) {
  const s = isObj(raw) ? raw : {}
  let duration = null
  if (s.duration != null) {
    const n = num(s.duration, NaN)
    if (Number.isFinite(n) && n > 0) duration = n
  }
  return {
    id: str(s.id) || uid(),
    hash: str(s.hash).trim().toLowerCase(),
    ext: str(s.ext).trim().replace(/^\./, '').toLowerCase(),
    size: Math.max(0, num(s.size, 0)),
    duration,
    originalName: str(s.originalName),
    addedAt: str(s.addedAt) || new Date().toISOString(),
  }
}

export function normalizeCatalog(raw) {
  const c = isObj(raw) ? raw : {}
  const sounds = []
  const seen = new Set()
  for (const item of Array.isArray(c.sounds) ? c.sounds : []) {
    const sound = normalizeSound(item)
    if (seen.has(sound.id)) continue
    seen.add(sound.id)
    sounds.push(sound)
  }
  return { version: VERSION, sounds }
}

export function normalizeGroup(raw) {
  const g = isObj(raw) ? raw : {}
  const defaults = isObj(g.defaults) ? g.defaults : {}
  return {
    id: str(g.id) || uid(),
    name: str(g.name),
    category: normalizeCategory(g.category),
    tags: normalizeTags(g.tags),
    sounds: uniqueStrings(g.sounds),
    selection: coerceSelection(g.selection),
    defaultKind: KINDS.includes(g.defaultKind) ? g.defaultKind : null,
    defaults: {
      gain: clamp01(num(defaults.gain, 0.8)),
      reverb: coerceReverb(defaults.reverb),
      pan: clampPan(num(defaults.pan, 0)),
      trigger: sanitizeTrigger(defaults.trigger),
    },
    notes: str(g.notes),
  }
}

export function normalizeLibrary(raw) {
  const lib = Array.isArray(raw) ? { groups: raw } : isObj(raw) ? raw : {}
  const groups = []
  const seen = new Set()
  for (const item of Array.isArray(lib.groups) ? lib.groups : []) {
    const group = normalizeGroup(item)
    if (seen.has(group.id)) continue
    seen.add(group.id)
    groups.push(group)
  }
  return { version: VERSION, groups }
}

export function normalizeTrack(raw, fallbackOrder = 0) {
  const t = isObj(raw) ? raw : {}
  const kind = coerceKind(t.kind)
  const order = num(t.order, fallbackOrder)
  return {
    id: str(t.id) || uid(),
    groupId: str(t.groupId),
    kind,
    order,
    trigger: normalizeTriggerForKind(kind, t.trigger),
  }
}

function normalizeMoodParam(raw) {
  const p = isObj(raw) ? raw : {}
  const out = {}
  if (typeof p.enabled === 'boolean') out.enabled = p.enabled
  if (p.gain != null) {
    const n = num(p.gain, NaN)
    if (Number.isFinite(n)) out.gain = clamp01(n)
  }
  if (hasOwn(p, 'reverb')) out.reverb = coerceReverb(p.reverb)
  if (p.pan != null) {
    const n = num(p.pan, NaN)
    if (Number.isFinite(n)) out.pan = clampPan(n)
  }
  if (p.trigger != null) out.trigger = sanitizeTrigger(p.trigger)
  return out
}

export function normalizeMood(raw, knownTrackIds) {
  const m = isObj(raw) ? raw : {}
  const known =
    knownTrackIds == null
      ? null
      : new Set(Array.isArray(knownTrackIds) ? knownTrackIds : Array.from(knownTrackIds))
  const params = {}
  if (isObj(m.params)) {
    for (const [trackId, rawParam] of Object.entries(m.params)) {
      if (known && !known.has(trackId)) continue
      const param = normalizeMoodParam(rawParam)
      if (Object.keys(param).length) params[trackId] = param
    }
  }
  return {
    id: str(m.id) || uid(),
    name: str(m.name) || 'New mood',
    params,
  }
}

export function normalizePaletteEntry(raw) {
  const e = isObj(raw) ? raw : {}
  let gain = null
  if (e.gain != null) {
    const n = num(e.gain, NaN)
    gain = Number.isFinite(n) ? clamp01(n) : null
  }
  return {
    id: str(e.id) || uid(),
    groupId: str(e.groupId),
    label: str(e.label),
    gain,
    order: num(e.order, 0),
  }
}

export function normalizeMidi(raw, scope = 'global') {
  const midi = isObj(raw) ? raw : {}
  const notes = {}
  const ccs = {}
  const seenTargets = new Set()

  const sources = [
    ['notes', midi.notes, 'note'],
    ['ccs', midi.ccs, 'cc'],
  ]

  for (const [, map, defaultType] of sources) {
    if (!isObj(map)) continue
    const target = defaultType === 'note' ? notes : ccs
    for (const [rawKey, rawAction] of Object.entries(map)) {
      const parsed = parseBindingKey(rawKey)
      if (!parsed || parsed.type !== defaultType) continue
      const action = normalizeMidiAction(rawAction, scope)
      if (!action) continue
      if (actionChannelType(action) !== parsed.type) continue
      const key = bindingKey(parsed.channel, parsed.type, parsed.number)
      const signature = targetKey(action)
      if (seenTargets.has(signature)) continue
      seenTargets.add(signature)
      target[key] = action
    }
  }

  return { notes: sortObject(notes), ccs: sortObject(ccs) }
}

function sortObject(obj) {
  const out = {}
  for (const key of Object.keys(obj).sort()) out[key] = obj[key]
  return out
}

export function normalizeGlobal(raw) {
  const g = isObj(raw) ? raw : {}
  const buses = isObj(g.buses) ? g.buses : {}
  const palette = []
  const seen = new Set()
  for (const item of Array.isArray(g.palette) ? g.palette : []) {
    const entry = normalizePaletteEntry(item)
    if (seen.has(entry.id)) continue
    seen.add(entry.id)
    palette.push(entry)
  }
  return {
    version: VERSION,
    master: clamp01(num(g.master, 0.8)),
    buses: {
      loop: clamp01(num(buses.loop, 1)),
      random: clamp01(num(buses.random, 1)),
      oneshot: clamp01(num(buses.oneshot, 1)),
    },
    palette,
    midi: normalizeMidi(g.midi, 'global'),
  }
}

export function normalizeScene(raw) {
  const s = isObj(raw) ? raw : {}

  const seenTrackIds = new Set()
  let tracks = (Array.isArray(s.tracks) ? s.tracks : []).map((rawTrack, index) => {
    const track = normalizeTrack(rawTrack, index)
    while (seenTrackIds.has(track.id)) track.id = uid()
    seenTrackIds.add(track.id)
    return track
  })

  tracks.sort(compareByOrderThenId)
  tracks = tracks.map((track, index) => ({ ...track, order: index }))

  const trackIds = tracks.map((track) => track.id)
  const seenMoodIds = new Set()
  let moods = (Array.isArray(s.moods) ? s.moods : []).map((rawMood) => {
    const mood = normalizeMood(rawMood, trackIds)
    while (seenMoodIds.has(mood.id)) mood.id = uid()
    seenMoodIds.add(mood.id)
    return mood
  })
  if (!moods.length) moods = [newMood('Default')]

  let defaultMoodId = str(s.defaultMoodId)
  if (!moods.some((mood) => mood.id === defaultMoodId)) defaultMoodId = moods[0].id

  return {
    version: VERSION,
    id: str(s.id) || uid(),
    name: str(s.name),
    disabled: s.disabled === true,
    defaultMoodId,
    tracks,
    moods,
    midi: normalizeMidi(s.midi, 'local'),
  }
}

function compareByOrderThenId(a, b) {
  const ao = num(a.order, 0)
  const bo = num(b.order, 0)
  if (ao !== bo) return ao - bo
  const aid = String(a.id)
  const bid = String(b.id)
  return aid < bid ? -1 : aid > bid ? 1 : 0
}

export function newSound(raw = {}) {
  return normalizeSound(raw)
}

export function newGroup(raw = {}) {
  return normalizeGroup(raw)
}

export const newLibraryGroup = newGroup

export function newTrack(raw = {}, fallbackOrder = 0) {
  return normalizeTrack(raw, fallbackOrder)
}

export function newMood(name = 'New mood') {
  return normalizeMood({ name })
}

export function newScene(raw = {}) {
  return normalizeScene(raw)
}

export function newPaletteEntry(raw = {}) {
  return normalizePaletteEntry(raw)
}

export function defaultCatalog() {
  return normalizeCatalog({})
}

export function defaultLibrary() {
  return normalizeLibrary({})
}

export function defaultGlobal() {
  return normalizeGlobal({})
}

export function defaultMidi(scope = 'global') {
  return normalizeMidi({}, scope)
}

export function newCatalog(raw = {}) {
  return normalizeCatalog(raw)
}

export function newLibrary(raw = {}) {
  return normalizeLibrary(raw)
}

export function newGlobal(raw = {}) {
  return normalizeGlobal(raw)
}
