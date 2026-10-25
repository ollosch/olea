// Central reactive state + actions + MIDI dispatch for the soundboard v2.
//
// The server stores one `config.json` per scene, one app-level `library.json`,
// and one `global.json` for buses/palette/global MIDI. A scene is composed of
// scene-local elements plus *includes* of reusable library groups. This module
// resolves those includes on demand (see `lib/resolve.js`) so library edits are
// reflected everywhere without duplicating data.
//
// Element kinds:
//   - 'loop'    — continuous ambience/music (started with the scene/mood)
//   - 'random'  — auto-triggered one-shots at bounded random intervals
//   - 'oneshot' — manually triggered one-shots
import { reactive, computed } from 'vue'
import { engine } from './engine.js'
import { midi, connectMidi as connectMidiDevice, onMidiMessage } from './midi.js'
import {
  newElement,
  newMood,
  newInclude,
  newPaletteEntry,
  newConfig,
  normalizeElement,
  normalizeInclude,
  normalizeLibrary,
  normalizeLibraryGroup,
  normalizeGlobal,
} from '../lib/schema.js'
import { resolveElement, resolveScene, resolveSceneElements } from '../lib/resolve.js'
import { mergeElements as mergeElementsPure } from '../lib/edit.js'
import {
  bindAction,
  findBindingKey,
  removeBindings,
} from '../lib/bindings.js'

const BUSES = ['loop', 'random', 'effects']

export const store = reactive({
  soundsets: [],
  library: { version: 2, groups: [] },
  files: [],
  global: {
    version: 2,
    buses: { loop: 1, random: 1, effects: 1 },
    palette: [],
    midi: { notes: {}, ccs: {} },
  },
  activeId: null,
  activeMoodId: null,
  masterVolume: 0.8,
  volumeOverrides: {},
  learning: null,
  loaded: false,
  loopsPlaying: false,
  randomsPlaying: false,
  midiConnected: false,
  midiError: '',
})

const randomTimers = reactive(new Map()) // key -> { timeout }
const lastPicks = new Map() // key -> last file index (avoid immediate repeats)

const elKey = (ssId, elId) => `${ssId}::${elId}`
const paletteKey = (paletteId) => `palette:${paletteId}`
const DEFAULT_RANDOM_TRIGGER = { min: 10, max: 30, startMin: 2, startMax: 10 }

function triggerIsZero(t) {
  return [t?.min, t?.max, t?.startMin, t?.startMax].every((v) => !Number(v))
}

function randomTriggerOf(el) {
  return triggerIsZero(el?.trigger)
    ? { ...DEFAULT_RANDOM_TRIGGER }
    : el.trigger
}

function ensureRandomTrigger(el) {
  if (el && el.kind === 'random' && triggerIsZero(el.trigger)) {
    el.trigger = { ...DEFAULT_RANDOM_TRIGGER }
  }
  return el
}

function clamp01(v) {
  const n = Number(v)
  if (!Number.isFinite(n)) return 0
  return Math.min(1, Math.max(0, n))
}

// ---- computed views ----

export const activeSoundset = computed(
  () => store.soundsets.find((s) => s.id === store.activeId) || null
)

export const enabledSoundsets = computed(() => store.soundsets.filter((s) => !s.disabled))

export const disabledSoundsets = computed(() => store.soundsets.filter((s) => s.disabled))

// ---- path helpers ----

export function resolvePath(fromDir, rel) {
  const parts = [...(fromDir ? fromDir.split('/') : []), ...(rel ? rel.split('/') : [])]
  const out = []
  for (const p of parts) {
    if (!p || p === '.') continue
    if (p === '..') out.pop()
    else out.push(p)
  }
  return out
}

export function audioUrlFor(baseDir, file) {
  return '/audio/' + resolvePath(baseDir, file).map(encodeURIComponent).join('/')
}

// Accept either an old-style soundset (`{ dir }`), a resolved element
// (`{ baseDir }`), or a raw base directory string.
export function audioUrl(target, file) {
  if (typeof target === 'string') return audioUrlFor(target, file)
  const baseDir =
    target && Object.prototype.hasOwnProperty.call(target, 'baseDir')
      ? target.baseDir
      : target && target.dir
  return audioUrlFor(baseDir || '', file)
}

export function relativeFile(fromDir, toDir, file) {
  const from = (fromDir || '').split('/').filter(Boolean)
  const to = (toDir || '').split('/').filter(Boolean)
  let i = 0
  while (i < from.length && i < to.length && from[i] === to[i]) i++
  const up = Array(from.length - i).fill('..')
  return [...up, ...to.slice(i), file].filter(Boolean).join('/')
}

export function fileName(file) {
  const base = (file || '').split('/').pop()
  return base.replace(/\.(ogg|mp3|wav)$/i, '')
}

// Resolve a stored relative file reference back to its picker location
// { dir, file, name } for the group editor (dir = top-level audio folder).
export function fileLocation(ss, file) {
  const segs = resolvePath(ss.dir, file)
  const filePart = segs.pop()
  return { dir: segs.join('/'), file: filePart || file, name: fileName(file) }
}

// ---- resolved element access ----

export function resolvedSceneElements(ss) {
  return resolveSceneElements(ss, store.library)
}

export function sceneWarnings(ss) {
  return resolveScene(ss, store.library).warnings
}

export function soundsetElements(ss) {
  const loops = []
  const randoms = []
  const oneshots = []
  for (const el of resolvedSceneElements(ss)) {
    if (el.kind === 'loop') loops.push(el)
    else if (el.kind === 'random') randoms.push(el)
    else oneshots.push(el)
  }
  return { loops, randoms, oneshots }
}

export function findElement(ssId, instanceId) {
  const ss = store.soundsets.find((s) => s.id === ssId)
  if (!ss) return null
  return resolveElement(ss, store.library, instanceId)
}

export function findLibraryGroup(id) {
  return (store.library.groups || []).find((group) => group.id === id) || null
}

function findElementPair(ssId, elId) {
  const ss = store.soundsets.find((s) => s.id === ssId)
  const el = ss ? resolveElement(ss, store.library, elId) : null
  return { ss, el }
}

// Raw instance lookup (ignores `hidden`) used by editor/delete actions.
function rawInstance(ss, instanceId) {
  const element = (ss.elements || []).find((el) => el.id === instanceId)
  if (element) return { type: 'scene', element }
  const include = (ss.includes || []).find((inc) => inc.id === instanceId)
  if (include) return { type: 'include', include }
  return null
}

function instanceKind(ss, instanceId) {
  const resolved = resolveElement(ss, store.library, instanceId)
  if (resolved) return resolved.kind
  const raw = rawInstance(ss, instanceId)
  if (!raw) return 'oneshot'
  if (raw.type === 'scene') return raw.element.kind || 'oneshot'
  const group = findLibraryGroup(raw.include.libraryId)
  return raw.include.overrides?.kind || group?.kind || 'oneshot'
}

function activeMood(ss) {
  if (!store.activeMoodId) return null
  return (ss.moods || []).find((m) => m.id === store.activeMoodId) || null
}

export function elementGainOf(ss, el) {
  const key = elKey(ss.id, el.id)
  let value
  if (key in store.volumeOverrides) {
    value = store.volumeOverrides[key]
  } else {
    const mood = activeMood(ss)
    const param = mood && mood.params ? mood.params[el.id] : null
    value = param && param.volume != null ? param.volume : el.gain
  }
  return clamp01(value == null ? 0 : value)
}

export function isVolumeOverridden(ss, el) {
  return elKey(ss.id, el.id) in store.volumeOverrides
}

export function isLoopPlaying(ss, el) {
  return engine.isLoopPlaying(elKey(ss.id, el.id))
}

export function isOneshotPlaying(ss, el) {
  return engine.isOneShotPlaying(elKey(ss.id, el.id))
}

export function isRandomActive(ss, el) {
  return randomTimers.has(elKey(ss.id, el.id))
}

export function isLoadingElement(ss, el) {
  return (el.files || []).some((f) => engine.state.loading.has(audioUrl(el, f)))
}

// ---- loaders / persistence ----

export async function loadLibrary() {
  const res = await fetch('/api/library')
  const data = await res.json()
  store.soundsets = data.soundsets || []
  store.library = normalizeLibrary(data.library || {})
  store.global = normalizeGlobal(data.global || {})
  for (const bus of BUSES) {
    engine.setBusGain(bus, clamp01(store.global.buses?.[bus] ?? 1))
  }
  store.loaded = true
}

export async function loadFiles() {
  try {
    const res = await fetch('/api/files')
    const data = await res.json()
    store.files = data.folders || []
  } catch {
    store.files = []
  }
}

async function persistSoundset(ss) {
  try {
    const res = await fetch('/api/soundset/' + encodeURIComponent(ss.dir), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(ss),
    })
    const data = await res.json()
    if (data.ok) {
      const i = store.soundsets.findIndex((s) => s.id === ss.id)
      if (i !== -1) store.soundsets[i] = data.soundset
    }
  } catch {
    /* ignore */
  }
}

async function persistGlobal() {
  try {
    const res = await fetch('/api/global', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(store.global),
    })
    const data = await res.json()
    if (data.ok) store.global = data.global
  } catch {
    /* ignore */
  }
}

async function persistLibrary() {
  try {
    const res = await fetch('/api/library', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(store.library),
    })
    const data = await res.json()
    if (data.ok) store.library = data.library
  } catch {
    /* ignore */
  }
}

// ---- palette ----

function paletteEntryById(paletteId) {
  return (store.global.palette || []).find((entry) => entry.id === paletteId) || null
}

function paletteRow(entry) {
  const group = findLibraryGroup(entry.libraryId)
  const label = entry.label || (group ? group.name : '')
  const id = paletteKey(entry.id)

  if (!group) {
    return {
      id,
      paletteId: entry.id,
      libraryId: entry.libraryId,
      entry,
      label,
      name: label,
      kind: 'oneshot',
      gain: 0,
      trigger: { min: 10, max: 30, startMin: 2, startMax: 10 },
      baseDir: '_library',
      source: 'palette',
      files: [],
      missing: true,
    }
  }

  return {
    ...group,
    id,
    paletteId: entry.id,
    libraryId: entry.libraryId,
    entry,
    label,
    name: label,
    gain: clamp01(entry.gain != null ? entry.gain : group.gain),
    baseDir: '_library',
    source: 'palette',
    files: group.files || [],
  }
}

export function paletteElements() {
  return (store.global.palette || [])
    .slice()
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    .map(paletteRow)
}

function paletteRowById(paletteId) {
  const entry = paletteEntryById(paletteId)
  return entry ? paletteRow(entry) : null
}

export function pinToPalette(libraryId) {
  const group = findLibraryGroup(libraryId)
  if (!group) return null
  const existing = (store.global.palette || []).find((entry) => entry.libraryId === libraryId)
  if (existing) return existing.id

  const order = (store.global.palette || []).reduce(
    (max, entry) => Math.max(max, Number(entry.order) || 0),
    -1
  ) + 1
  const entry = newPaletteEntry(libraryId, order)
  store.global.palette = [...(store.global.palette || []), entry]
  persistGlobal()
  return entry.id
}

function removeGlobalPaletteBindings(paletteIds) {
  const ids = new Set(paletteIds)
  if (!ids.size) return
  for (const mapKey of ['notes', 'ccs']) {
    if (!store.global.midi) store.global.midi = { notes: {}, ccs: {} }
    store.global.midi[mapKey] = removeBindings(
      store.global.midi[mapKey],
      (binding) => binding && ids.has(binding.paletteId)
    )
  }
}

export function unpinFromPalette(paletteId) {
  stopPaletteItem(paletteId)
  removeGlobalPaletteBindings([paletteId])
  store.global.palette = (store.global.palette || []).filter((entry) => entry.id !== paletteId)
  persistGlobal()
}

function triggerPaletteRandom(paletteId) {
  const key = paletteKey(paletteId)
  if (!randomTimers.has(key)) return
  const row = paletteRowById(paletteId)
  if (!row || row.missing || !row.files.length) return

  engine.playOneShot(key, audioUrl(row, row.files[pickIndex(row, key)]), {
    gain: clamp01(row.gain),
    bus: 'random',
    reverb: row.reverb,
  })

  const entry = randomTimers.get(key)
  if (!entry) return
  const trigger = row.trigger || {}
  const wait = Math.max(0, randBetween(trigger.min, trigger.max))
  entry.timeout = setTimeout(() => triggerPaletteRandom(paletteId), wait * 1000)
}

function startPaletteRandom(row) {
  const key = paletteKey(row.paletteId)
  if (randomTimers.has(key)) return
  randomTimers.set(key, { timeout: null })
  const trigger = row.trigger || {}
  const start = Math.max(0, randBetween(trigger.startMin, trigger.startMax))
  const entry = randomTimers.get(key)
  if (entry) entry.timeout = setTimeout(() => triggerPaletteRandom(row.paletteId), start * 1000)
}

export function playPaletteItem(paletteId) {
  const row = paletteRowById(paletteId)
  if (!row || row.missing || !(row.files || []).length) return
  const key = paletteKey(paletteId)

  if (row.kind === 'loop') {
    if (engine.isLoopPlaying(key)) {
      engine.stopLoopElement(key)
      return
    }
    engine.playLoopElement(key, {
      files: row.files.map((file) => audioUrl(row, file)),
      gain: clamp01(row.gain),
      randomise: row.randomise === 'random' || row.randomise === 'shuffle',
      reverb: row.reverb,
      bus: 'loop',
    })
  } else if (row.kind === 'random') {
    if (randomTimers.has(key)) stopPaletteItem(paletteId)
    else startPaletteRandom(row)
  } else {
    engine.playOneShot(key, audioUrl(row, row.files[pickIndex(row, key)]), {
      gain: clamp01(row.gain),
      bus: 'effects',
      reverb: row.reverb,
    })
  }
}

export function stopPaletteItem(paletteId) {
  const key = paletteKey(paletteId)
  const entry = randomTimers.get(key)
  if (entry && entry.timeout) clearTimeout(entry.timeout)
  randomTimers.delete(key)
  engine.stopLoopElement(key)
  engine.stopOneShot(key)
}

export function isPaletteLoopPlaying(paletteId) {
  return engine.isLoopPlaying(paletteKey(paletteId))
}

export function isPaletteRandomActive(paletteId) {
  return randomTimers.has(paletteKey(paletteId))
}

export function isPaletteOneshotPlaying(paletteId) {
  return engine.isOneShotPlaying(paletteKey(paletteId))
}

export function setPaletteVolume(paletteId, v) {
  const entry = paletteEntryById(paletteId)
  if (!entry) return
  const value = clamp01(v)
  entry.gain = value
  const key = paletteKey(paletteId)
  engine.setLoopGain(key, value)
  engine.setOneShotGain(key, value)
  persistGlobal()
}

// ---- library browser preview ----

const libraryKey = (libraryId) => `library:${libraryId}`

export function stopLibraryPreview(libraryId) {
  const key = libraryKey(libraryId)
  engine.stopLoopElement(key)
  engine.stopOneShot(key)
}

function stopAllLibraryPreviews() {
  for (const group of store.library.groups || []) stopLibraryPreview(group.id)
}

export function isLibraryPreviewPlaying(libraryId) {
  const key = libraryKey(libraryId)
  return engine.isLoopPlaying(key) || engine.isOneShotPlaying(key)
}

// ---- review preview ----

const reviewKey = (ssId, elId) => `review:${ssId}::${elId}`
let activeReviewPreview = null

function stopReviewPreviewKey() {
  if (!activeReviewPreview) return
  engine.stopLoopElement(activeReviewPreview)
  engine.stopOneShot(activeReviewPreview)
  activeReviewPreview = null
}

export function stopReviewPreviews() {
  stopReviewPreviewKey()
}

export function isReviewPreviewPlaying(ssId, elId) {
  const key = reviewKey(ssId, elId)
  return engine.isLoopPlaying(key) || engine.isOneShotPlaying(key)
}

export function toggleReviewPreview(ssId, elId) {
  const { ss, el } = findElementPair(ssId, elId)
  if (!ss || !el || !(el.files || []).length) return
  const key = reviewKey(ss.id, el.id)
  if (engine.isLoopPlaying(key) || engine.isOneShotPlaying(key)) {
    stopReviewPreviewKey()
    return
  }

  stopReviewPreviewKey()
  activeReviewPreview = key
  const bus = el.kind === 'loop' ? 'loop' : el.kind === 'random' ? 'random' : 'effects'

  if (el.kind === 'loop') {
    engine.playLoopElement(key, {
      files: el.files.map((file) => audioUrl(el, file)),
      gain: clamp01(el.gain),
      randomise: el.randomise === 'random' || el.randomise === 'shuffle',
      reverb: el.reverb,
      bus,
    })
  } else {
    engine.playOneShot(key, audioUrl(el, el.files[pickIndex(el, key)]), {
      gain: clamp01(el.gain),
      bus,
      reverb: el.reverb,
    })
  }
}

export function toggleLibraryPreview(libraryId) {
  const group = findLibraryGroup(libraryId)
  if (!group || !(group.files || []).length) return
  if (isLibraryPreviewPlaying(libraryId)) {
    stopLibraryPreview(libraryId)
    return
  }

  stopAllLibraryPreviews()
  const key = libraryKey(libraryId)
  const bus = group.kind === 'loop' ? 'loop' : group.kind === 'random' ? 'random' : 'effects'

  if (group.kind === 'loop') {
    engine.playLoopElement(key, {
      files: group.files.map((file) => audioUrlFor('_library', file)),
      gain: clamp01(group.gain),
      randomise: group.randomise === 'random' || group.randomise === 'shuffle',
      reverb: group.reverb,
      bus,
    })
  } else {
    engine.playOneShot(key, audioUrlFor('_library', group.files[pickIndex(group, key)]), {
      gain: clamp01(group.gain),
      bus,
      reverb: group.reverb,
    })
  }
}

// ---- transport ----

function updateTransportFlags(ss) {
  if (!ss) {
    store.loopsPlaying = false
    store.randomsPlaying = false
    return
  }
  const { loops, randoms } = soundsetElements(ss)
  store.loopsPlaying = loops.some((el) => engine.isLoopPlaying(elKey(ss.id, el.id)))
  store.randomsPlaying = randoms.some((el) => randomTimers.has(elKey(ss.id, el.id)))
}

export function startSoundset(id) {
  const ss = store.soundsets.find((s) => s.id === id)
  if (!ss) return
  if (store.activeId && store.activeId !== id) stopSoundset()
  store.activeId = id
  store.activeMoodId = null
  startLoops()
  startRandoms()
}

export function stopSoundset() {
  stopLoops()
  stopRandoms()
}

export function leaveSoundset() {
  stopEverything()
  store.activeId = null
  store.activeMoodId = null
}

export function toggleSoundset(id) {
  if (store.activeId === id && (store.loopsPlaying || store.randomsPlaying)) stopSoundset()
  else startSoundset(id)
}

export function desiredMoodElements(ss) {
  const { loops, randoms } = soundsetElements(ss)
  const all = [...loops, ...randoms]
  if (!store.activeMoodId) return all
  const mood = activeMood(ss)
  if (!mood) return all
  return all.filter((el) => {
    const param = mood.params ? mood.params[el.id] : null
    return !!param && param.plays !== false
  })
}

export function startLoops() {
  const ss = activeSoundset.value
  if (!ss) return
  const desired = store.activeMoodId
    ? new Set(desiredMoodElements(ss).map((el) => el.id))
    : null
  for (const el of soundsetElements(ss).loops) {
    if (desired && !desired.has(el.id)) continue
    startLoop(ss, el)
  }
  updateTransportFlags(ss)
}

export function stopLoops() {
  const ss = activeSoundset.value
  if (!ss) {
    store.loopsPlaying = false
    return
  }
  for (const el of soundsetElements(ss).loops) stopLoop(ss, el)
  updateTransportFlags(ss)
}

export function startRandoms() {
  const ss = activeSoundset.value
  if (!ss) return
  const desired = store.activeMoodId
    ? new Set(desiredMoodElements(ss).map((el) => el.id))
    : null
  for (const el of soundsetElements(ss).randoms) {
    if (desired && !desired.has(el.id)) continue
    startRandom(ss, el)
  }
  updateTransportFlags(ss)
}

export function stopRandoms() {
  const ss = activeSoundset.value
  if (!ss) {
    store.randomsPlaying = false
    return
  }
  for (const el of soundsetElements(ss).randoms) stopRandom(ss, el)
  updateTransportFlags(ss)
}

export function stopEffects() {
  engine.stopAllOneshots()
}

export function stopEverything() {
  stopSoundset()
  stopEffects()
  for (const entry of store.global.palette || []) stopPaletteItem(entry.id)
  stopAllLibraryPreviews()
  stopReviewPreviews()
}

// ---- loop elements ----

function startLoop(ss, el) {
  const key = elKey(ss.id, el.id)
  engine.playLoopElement(key, {
    files: (el.files || []).map((file) => audioUrl(el, file)),
    gain: elementGainOf(ss, el),
    randomise: el.randomise === 'random' || el.randomise === 'shuffle',
    reverb: el.reverb,
    bus: 'loop',
  })
}

function stopLoop(ss, el) {
  engine.stopLoopElement(elKey(ss.id, el.id))
}

export function toggleLoopElement(ssId, elId) {
  const { ss, el } = findElementPair(ssId, elId)
  if (!ss || !el) return
  const key = elKey(ss.id, el.id)
  if (engine.isLoopPlaying(key)) stopLoop(ss, el)
  else startLoop(ss, el)
  if (store.activeId === ss.id) updateTransportFlags(ss)
}

// ---- one-shot elements ----

export function playOneshotElement(ssId, elId) {
  const { ss, el } = findElementPair(ssId, elId)
  if (!ss || !el || !(el.files || []).length) return
  const key = elKey(ss.id, el.id)
  engine.playOneShot(key, audioUrl(el, el.files[pickIndex(el, key)]), {
    gain: elementGainOf(ss, el),
    bus: 'effects',
    reverb: el.reverb,
  })
}

export function stopOneshotElement(ssId, elId) {
  const { ss, el } = findElementPair(ssId, elId)
  if (!ss || !el) return
  engine.stopOneShot(elKey(ss.id, el.id))
}

// ---- random (auto-injection) elements ----

const randBetween = (min, max) => {
  if (min == null || Number.isNaN(min)) min = 0
  if (max == null || Number.isNaN(max)) max = min
  if (min === max) return min
  return min + Math.random() * (max - min)
}

export function pickIndex(el, key) {
  const files = el.files || []
  const n = files.length
  if (n <= 1) return 0
  const avoid = lastPicks.get(key)
  let idx
  if (avoid == null) {
    idx = Math.floor(Math.random() * n)
  } else {
    const i = Math.floor(Math.random() * (n - 1))
    idx = i >= avoid ? i + 1 : i
  }
  lastPicks.set(key, idx)
  return idx
}

function triggerRandom(ssId, elId) {
  const key = elKey(ssId, elId)
  if (!randomTimers.has(key)) return
  const { ss, el } = findElementPair(ssId, elId)
  if (!ss || !el || !(el.files || []).length) {
    randomTimers.delete(key)
    if (ss) updateTransportFlags(ss)
    return
  }

  engine.playOneShot(key, audioUrl(el, el.files[pickIndex(el, key)]), {
    gain: elementGainOf(ss, el),
    bus: 'random',
    reverb: el.reverb,
  })

  const entry = randomTimers.get(key)
  if (!entry) return
  const trigger = randomTriggerOf(el)
  const wait = Math.max(0, randBetween(trigger.min, trigger.max))
  entry.timeout = setTimeout(() => triggerRandom(ssId, elId), wait * 1000)
}

function startRandom(ss, el) {
  const key = elKey(ss.id, el.id)
  if (randomTimers.has(key)) return
  randomTimers.set(key, { timeout: null })
  const trigger = randomTriggerOf(el)
  const start = Math.max(0, randBetween(trigger.startMin, trigger.startMax))
  const entry = randomTimers.get(key)
  if (entry) entry.timeout = setTimeout(() => triggerRandom(ss.id, el.id), start * 1000)
}

function stopRandom(ss, el) {
  const key = elKey(ss.id, el.id)
  const entry = randomTimers.get(key)
  if (entry && entry.timeout) clearTimeout(entry.timeout)
  randomTimers.delete(key)
  engine.stopOneShot(key)
}

export function toggleRandomElement(ssId, elId) {
  const { ss, el } = findElementPair(ssId, elId)
  if (!ss || !el) return
  if (randomTimers.has(elKey(ss.id, el.id))) stopRandom(ss, el)
  else startRandom(ss, el)
  if (store.activeId === ss.id) updateTransportFlags(ss)
}

export function playRandomOnce(ssId, elId) {
  const { ss, el } = findElementPair(ssId, elId)
  if (!ss || !el || !(el.files || []).length) return
  const key = elKey(ss.id, el.id)
  engine.playOneShot(key, audioUrl(el, el.files[pickIndex(el, key)]), {
    gain: elementGainOf(ss, el),
    bus: 'random',
    reverb: el.reverb,
  })
}

// ---- volume ----

export function setElementVolume(ssId, elId, v) {
  const { ss, el } = findElementPair(ssId, elId)
  if (!ss || !el) return
  const key = elKey(ss.id, el.id)
  const value = clamp01(v)
  store.volumeOverrides[key] = value
  engine.setLoopGain(key, value)
  engine.setOneShotGain(key, value)
}

export function resetElementVolume(ssId, elId) {
  const { ss, el } = findElementPair(ssId, elId)
  if (!ss || !el) return
  const key = elKey(ss.id, el.id)
  delete store.volumeOverrides[key]
  const value = elementGainOf(ss, el)
  engine.setLoopGain(key, value)
  engine.setOneShotGain(key, value)
}

export function resetSectionVolume(ssId, kind) {
  const ss = store.soundsets.find((s) => s.id === ssId)
  if (!ss) return
  const { loops, randoms, oneshots } = soundsetElements(ss)
  const list = kind === 'loop' ? loops : kind === 'random' ? randoms : oneshots
  for (const el of list) {
    const key = elKey(ss.id, el.id)
    delete store.volumeOverrides[key]
    const value = elementGainOf(ss, el)
    engine.setLoopGain(key, value)
    engine.setOneShotGain(key, value)
  }
}

export function setMaster(v) {
  const value = clamp01(v)
  store.masterVolume = value
  engine.setMasterGain(value)
}

export function setBusVolume(bus, v) {
  if (!BUSES.includes(bus)) return
  const value = clamp01(v)
  if (!store.global.buses) store.global.buses = { loop: 1, random: 1, effects: 1 }
  store.global.buses[bus] = value
  engine.setBusGain(bus, value)
  persistGlobal()
}

export function setLoopsVolume(v) {
  setBusVolume('loop', v)
}

export function setRandomsVolume(v) {
  setBusVolume('random', v)
}

export function setEffectsVolume(v) {
  setBusVolume('effects', v)
}

// ---- moods ----

function clearSceneVolumeOverrides(ss) {
  const prefix = ss.id + '::'
  for (const key of Object.keys(store.volumeOverrides)) {
    if (key.startsWith(prefix)) delete store.volumeOverrides[key]
  }
}

export function applyMood(ssId, moodId) {
  const ss = store.soundsets.find((s) => s.id === ssId)
  if (!ss) return
  const mood = (ss.moods || []).find((m) => m.id === moodId)
  if (!mood) return

  store.activeMoodId = moodId
  clearSceneVolumeOverrides(ss)

  const { loops, randoms } = soundsetElements(ss)
  const desired = new Set(desiredMoodElements(ss).map((el) => el.id))

  for (const el of loops) {
    const key = elKey(ss.id, el.id)
    const playing = engine.isLoopPlaying(key)
    if (desired.has(el.id)) {
      if (!playing) startLoop(ss, el)
      else engine.setLoopGain(key, elementGainOf(ss, el))
    } else if (playing) {
      stopLoop(ss, el)
    }
  }

  for (const el of randoms) {
    const key = elKey(ss.id, el.id)
    const active = randomTimers.has(key)
    if (desired.has(el.id)) {
      if (!active) startRandom(ss, el)
      engine.setOneShotGain(key, elementGainOf(ss, el))
    } else if (active) {
      stopRandom(ss, el)
    }
  }

  updateTransportFlags(ss)
}

export function createMood(ssId, name, params = {}) {
  const ss = store.soundsets.find((s) => s.id === ssId)
  if (!ss) return
  const mood = newMood(name)
  mood.params = params
  ss.moods.push(mood)
  persistSoundset(ss)
}

export function updateMood(ssId, moodId, patch = {}) {
  const ss = store.soundsets.find((s) => s.id === ssId)
  if (!ss) return
  const mood = (ss.moods || []).find((m) => m.id === moodId)
  if (!mood) return
  if (patch.name != null) mood.name = patch.name
  if (patch.params != null) mood.params = patch.params
  persistSoundset(ss)
}

function cleanLocalMoodBindings(ss, moodId) {
  if (!ss.midi) return
  for (const mapKey of ['notes', 'ccs']) {
    if (!ss.midi[mapKey]) continue
    ss.midi[mapKey] = removeBindings(
      ss.midi[mapKey],
      (binding) => binding && binding.moodId === moodId
    )
  }
}

export function deleteMood(ssId, moodId) {
  const ss = store.soundsets.find((s) => s.id === ssId)
  if (!ss) return
  ss.moods = (ss.moods || []).filter((m) => m.id !== moodId)
  cleanLocalMoodBindings(ss, moodId)
  if (store.activeMoodId === moodId) store.activeMoodId = null
  persistSoundset(ss)
}

// ---- instance cleanup ----

function stopInstancePlayback(ss, instanceId) {
  const key = elKey(ss.id, instanceId)
  const entry = randomTimers.get(key)
  if (entry && entry.timeout) clearTimeout(entry.timeout)
  randomTimers.delete(key)
  engine.stopLoopElement(key)
  engine.stopOneShot(key)
}

function cleanLocalElementBindings(ss, instanceId) {
  if (!ss.midi) return
  for (const mapKey of ['notes', 'ccs']) {
    if (!ss.midi[mapKey]) continue
    ss.midi[mapKey] = removeBindings(
      ss.midi[mapKey],
      (binding) => binding && binding.elementId === instanceId
    )
  }
}

function cleanupInstance(ss, instanceId) {
  ss.hidden = (ss.hidden || []).filter((id) => id !== instanceId)
  for (const mood of ss.moods || []) {
    if (mood.params && instanceId in mood.params) delete mood.params[instanceId]
  }
  cleanLocalElementBindings(ss, instanceId)
}

function sceneFilesFromInput(ss, files) {
  if (!Array.isArray(files)) return []
  return files
    .map((entry) => {
      if (typeof entry === 'string') return entry
      if (!entry || typeof entry !== 'object' || typeof entry.file !== 'string') return null
      if (typeof entry.dir === 'string') return relativeFile(ss.dir, entry.dir, entry.file)
      return entry.file
    })
    .filter(Boolean)
}

// ---- library actions ----

export function addLibraryGroup(def = {}) {
  const group = ensureRandomTrigger(normalizeLibraryGroup(def))
  store.library.groups = [...(store.library.groups || []), group]
  persistLibrary()
  return group.id
}

export function updateLibraryGroup(id, patch = {}) {
  const group = findLibraryGroup(id)
  if (!group) return
  Object.assign(group, ensureRandomTrigger(normalizeLibraryGroup({ ...group, ...patch })))
  persistLibrary()
}

export function deleteLibraryGroup(id) {
  const group = findLibraryGroup(id)
  if (!group) return

  stopLibraryPreview(id)
  const affected = []
  for (const ss of store.soundsets) {
    const includes = ss.includes || []
    const doomed = includes.filter((inc) => inc.libraryId === id)
    if (!doomed.length) continue
    for (const inc of doomed) {
      stopInstancePlayback(ss, inc.id)
      delete store.volumeOverrides[elKey(ss.id, inc.id)]
      cleanupInstance(ss, inc.id)
    }
    ss.includes = includes.filter((inc) => inc.libraryId !== id)
    affected.push(ss)
  }

  const paletteIds = (store.global.palette || [])
    .filter((entry) => entry.libraryId === id)
    .map((entry) => entry.id)
  for (const paletteId of paletteIds) stopPaletteItem(paletteId)
  removeGlobalPaletteBindings(paletteIds)
  const paletteChanged = paletteIds.length > 0
  store.global.palette = (store.global.palette || []).filter((entry) => entry.libraryId !== id)
  store.library.groups = (store.library.groups || []).filter((item) => item.id !== id)

  persistLibrary()
  for (const ss of affected) persistSoundset(ss)
  if (paletteChanged) persistGlobal()
}

export function addIncludeToScene(ssId, libraryId) {
  const ss = store.soundsets.find((s) => s.id === ssId)
  const group = findLibraryGroup(libraryId)
  if (!ss || !group) return null
  const include = newInclude(libraryId)
  ss.includes = [...(ss.includes || []), include]
  persistSoundset(ss)
  return include.id
}

export function removeIncludeFromScene(ssId, includeId) {
  const ss = store.soundsets.find((s) => s.id === ssId)
  if (!ss) return
  const include = (ss.includes || []).find((inc) => inc.id === includeId)
  if (!include) return
  stopInstancePlayback(ss, includeId)
  delete store.volumeOverrides[elKey(ss.id, includeId)]
  ss.includes = (ss.includes || []).filter((inc) => inc.id !== includeId)
  cleanupInstance(ss, includeId)
  if (store.activeId === ss.id) updateTransportFlags(ss)
  persistSoundset(ss)
}

export async function promoteToLibrary(ssId, elementId, category) {
  const ss = store.soundsets.find((s) => s.id === ssId)
  if (!ss) return { ok: false, error: 'Soundset not found' }

  const kind = instanceKind(ss, elementId)
  stopInstancePlayback(ss, elementId)
  if (store.activeId === ss.id) updateTransportFlags(ss)

  try {
    const res = await fetch('/api/library/promote', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ soundsetDir: ss.dir, elementId, category }),
    })
    const data = await res.json()
    if (!data.ok) return data
    await loadLibrary()
    await loadFiles()
    return data
  } catch (err) {
    return { ok: false, error: err.message || `Could not promote ${kind} to library` }
  }
}

export function updateIncludeOverrides(ssId, includeId, patch = {}) {
  const ss = store.soundsets.find((s) => s.id === ssId)
  if (!ss) return
  const include = (ss.includes || []).find((inc) => inc.id === includeId)
  if (!include) return
  const overrides = { ...(include.overrides || {}) }
  for (const key of ['gain', 'kind', 'trigger', 'reverb', 'randomise']) {
    if (Object.prototype.hasOwnProperty.call(patch, key)) overrides[key] = patch[key]
  }
  Object.assign(include, normalizeInclude({ ...include, overrides }))
  persistSoundset(ss)
}

export function mergeSceneElements(ssId, ids, kind) {
  const index = store.soundsets.findIndex((s) => s.id === ssId)
  if (index === -1) return { warnings: ['Soundset not found'], element: null }
  const ss = store.soundsets[index]

  const requested = Array.isArray(ids) ? ids : []
  const localIds = requested.filter((id) =>
    (ss.elements || []).some((element) => element.id === id)
  )
  const includeIds = requested.filter((id) =>
    (ss.includes || []).some((include) => include.id === id)
  )

  const result = mergeElementsPure(ss, localIds, kind)
  store.soundsets[index] = result.soundset
  persistSoundset(store.soundsets[index])

  const warnings = [...result.warnings]
  if (includeIds.length) {
    warnings.push(
      `Ignored ${includeIds.length} library include${includeIds.length === 1 ? '' : 's'}; ` +
        'only scene elements can be merged'
    )
  }
  return { ...result, warnings }
}

export function reclassifyElements(ssId, ids, patch = {}) {
  const ss = store.soundsets.find((s) => s.id === ssId)
  if (!ss) return
  const wanted = new Set(Array.isArray(ids) ? ids : [])

  for (const element of ss.elements || []) {
    if (!wanted.has(element.id)) continue
    const next = { ...element }
    for (const key of ['kind', 'trigger', 'reverb']) {
      if (Object.prototype.hasOwnProperty.call(patch, key)) next[key] = patch[key]
    }
    Object.assign(element, ensureRandomTrigger(normalizeElement(next)))
  }

  for (const include of ss.includes || []) {
    if (!wanted.has(include.id)) continue
    const overrides = { ...(include.overrides || {}) }
    for (const key of ['kind', 'trigger', 'reverb']) {
      if (Object.prototype.hasOwnProperty.call(patch, key)) overrides[key] = patch[key]
    }
    const next = normalizeInclude({ ...include, overrides })
    if (
      next.overrides.kind === 'random' &&
      next.overrides.trigger &&
      triggerIsZero(next.overrides.trigger)
    ) {
      next.overrides.trigger = { ...DEFAULT_RANDOM_TRIGGER }
    }
    Object.assign(include, next)
  }

  persistSoundset(ss)
}

export function markReviewed(ssId) {
  const ss = store.soundsets.find((s) => s.id === ssId)
  if (!ss) return
  ss.reviewed = true
  persistSoundset(ss)
}

// ---- editor ----

export function renameElement(ssId, elId, name) {
  const ss = store.soundsets.find((s) => s.id === ssId)
  if (!ss) return
  const raw = rawInstance(ss, elId)
  if (!raw) return
  if (raw.type === 'scene') {
    raw.element.name = name
    persistSoundset(ss)
  } else {
    const group = findLibraryGroup(raw.include.libraryId)
    if (group) {
      group.name = name
      persistLibrary()
    }
  }
}

export function hideElement(ssId, elId) {
  const ss = store.soundsets.find((s) => s.id === ssId)
  if (!ss) return
  if (!rawInstance(ss, elId)) return
  if (!ss.hidden) ss.hidden = []
  if (!ss.hidden.includes(elId)) ss.hidden.push(elId)
  stopInstancePlayback(ss, elId)
  if (store.activeId === ss.id) updateTransportFlags(ss)
  persistSoundset(ss)
}

export function unhideElement(ssId, elId) {
  const ss = store.soundsets.find((s) => s.id === ssId)
  if (!ss) return
  ss.hidden = (ss.hidden || []).filter((id) => id !== elId)
  persistSoundset(ss)
}

export function addElement(ssId, def = {}) {
  const ss = store.soundsets.find((s) => s.id === ssId)
  if (!ss) return null
  const kind = def.kind || 'oneshot'
  const base = newElement(kind)
  const next = { ...base, files: sceneFilesFromInput(ss, def.files) }
  if (def.name != null) next.name = def.name
  if (def.gain != null) next.gain = def.gain
  if (def.randomise != null) next.randomise = def.randomise
  if (def.reverb != null) next.reverb = def.reverb
  if (def.trigger != null) next.trigger = def.trigger
  else if (kind === 'random') next.trigger = { ...DEFAULT_RANDOM_TRIGGER }

  const element = normalizeElement(next)
  ss.elements.push(element)
  persistSoundset(ss)
  return element.id
}

export function updateElement(ssId, elId, patch = {}) {
  const ss = store.soundsets.find((s) => s.id === ssId)
  if (!ss) return
  const raw = rawInstance(ss, elId)
  if (!raw) return

  if (raw.type === 'scene') {
    const merged = { ...raw.element, ...patch }
    if (patch.files != null) merged.files = sceneFilesFromInput(ss, patch.files)
    Object.assign(raw.element, ensureRandomTrigger(normalizeElement(merged)))
  } else {
    const overrides = { ...(raw.include.overrides || {}) }
    for (const key of ['gain', 'kind', 'trigger', 'reverb', 'randomise']) {
      if (Object.prototype.hasOwnProperty.call(patch, key)) overrides[key] = patch[key]
    }
    Object.assign(raw.include, normalizeInclude({ ...raw.include, overrides }))
    if (patch.name != null) {
      const group = findLibraryGroup(raw.include.libraryId)
      if (group) {
        group.name = patch.name
        persistLibrary()
      }
    }
  }

  persistSoundset(ss)
}

export function deleteElement(ssId, elId) {
  const ss = store.soundsets.find((s) => s.id === ssId)
  if (!ss) return
  const raw = rawInstance(ss, elId)
  if (!raw) return

  stopInstancePlayback(ss, elId)
  delete store.volumeOverrides[elKey(ss.id, elId)]

  if (raw.type === 'scene') {
    ss.elements = (ss.elements || []).filter((element) => element.id !== elId)
  } else {
    ss.includes = (ss.includes || []).filter((include) => include.id !== elId)
  }

  cleanupInstance(ss, elId)
  if (store.activeId === ss.id) updateTransportFlags(ss)
  persistSoundset(ss)
}

// ---- soundset lifecycle ----

function slugify(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

export async function createSoundset(name) {
  const base = slugify(name) || 'soundscape'
  let dir = base
  let n = 2
  while (store.soundsets.some((s) => s.dir === dir)) {
    dir = `${base}-${n++}`
  }
  const body = newConfig(name || 'New soundscape')
  try {
    const res = await fetch('/api/soundset/' + encodeURIComponent(dir), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const data = await res.json()
    if (!data.ok) return null
    store.soundsets.push(data.soundset)
    store.soundsets.sort((a, b) => a.name.localeCompare(b.name))
    return data.soundset.id
  } catch {
    return null
  }
}

export function renameSoundset(id, name) {
  const ss = store.soundsets.find((s) => s.id === id)
  if (!ss) return
  ss.name = name
  persistSoundset(ss)
}

export async function deleteSoundset(id) {
  const ss = store.soundsets.find((s) => s.id === id)
  if (!ss) return
  if (store.activeId === id) {
    stopEverything()
    store.activeId = null
    store.activeMoodId = null
  }
  store.soundsets = store.soundsets.filter((s) => s.id !== id)

  let globalChanged = false
  for (const mapKey of ['notes', 'ccs']) {
    if (!store.global.midi || !store.global.midi[mapKey]) continue
    const before = Object.keys(store.global.midi[mapKey]).length
    store.global.midi[mapKey] = removeBindings(
      store.global.midi[mapKey],
      (binding) => binding && binding.soundsetId === id
    )
    if (Object.keys(store.global.midi[mapKey]).length !== before) globalChanged = true
  }
  if (globalChanged) persistGlobal()

  try {
    await fetch('/api/soundset/' + encodeURIComponent(ss.dir), { method: 'DELETE' })
  } catch {
    /* ignore */
  }
}

export function disableSoundset(id) {
  const ss = store.soundsets.find((s) => s.id === id)
  if (!ss) return
  ss.disabled = true
  persistSoundset(ss)
}

export function enableSoundset(id) {
  const ss = store.soundsets.find((s) => s.id === id)
  if (!ss) return
  ss.disabled = false
  persistSoundset(ss)
}

// ---- MIDI ----

export async function connectMidi() {
  const ok = await connectMidiDevice()
  store.midiConnected = ok
  store.midiError = midi.error || ''
  return ok
}

export function learnNote(action) {
  store.learning = { mode: 'note', action }
}

export function learnCC(action) {
  store.learning = { mode: 'cc', action }
}

export function learnPaletteNote(paletteId) {
  learnNote({ type: 'palette', paletteId })
}

export function learnPaletteCC(paletteId) {
  learnCC({ type: 'paletteVolume', paletteId })
}

export function cancelLearn() {
  store.learning = null
}

export function actionScope(a) {
  if (!a) return 'local'
  if (a.scope) return a.scope
  if (a.type === 'stop' || a.type === 'master' || a.type === 'bus') return 'global'
  if (a.type === 'palette' || a.type === 'paletteVolume') return 'global'
  if (a.type === 'soundset') return a.soundsetId ? 'global' : 'local'
  return 'local'
}

export function saveLearned(key, mode, action) {
  const scope = actionScope(action)
  const mapKey = mode === 'note' ? 'notes' : 'ccs'

  if (scope === 'global') {
    if (!store.global.midi) store.global.midi = { notes: {}, ccs: {} }
    store.global.midi[mapKey] = bindAction(store.global.midi[mapKey], key, action)
    persistGlobal()
  } else {
    const ss = activeSoundset.value
    if (ss) {
      if (!ss.midi) ss.midi = { notes: {}, ccs: {} }
      if (!ss.midi[mapKey]) ss.midi[mapKey] = {}
      ss.midi[mapKey] = bindAction(ss.midi[mapKey], key, action)
      persistSoundset(ss)
    }
  }

  store.learning = null
}

export function assignedBinding(action, mode) {
  const mapKey = mode === 'note' ? 'notes' : 'ccs'
  const map =
    actionScope(action) === 'global'
      ? store.global.midi && store.global.midi[mapKey]
      : activeSoundset.value && activeSoundset.value.midi && activeSoundset.value.midi[mapKey]
  return findBindingKey(map, action)
}

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']

function noteLabel(note) {
  const n = Number(note)
  if (!Number.isFinite(n)) return ''
  const name = NOTE_NAMES[((n % 12) + 12) % 12]
  const octave = Math.floor(n / 12) - 1
  return `${name}${octave}`
}

export function bindingLabel(action, mode) {
  const key = assignedBinding(action, mode)
  if (!key) return ''
  const [channel, value] = String(key).split(':')
  if (mode === 'note') return noteLabel(value)
  return `CC ${value}`
}

export function isBindingShadowed(action, mode) {
  if (actionScope(action) !== 'global') return false
  const key = assignedBinding(action, mode)
  if (!key) return false
  const ss = activeSoundset.value
  const map = ss && ss.midi && ss.midi[mode === 'note' ? 'notes' : 'ccs']
  return !!map && key in map
}

function runLocalNote(ss, action) {
  if (!action) return
  if (action.type === 'mood') {
    applyMood(ss.id, action.moodId)
    return
  }
  if (action.type === 'soundset') {
    toggleSoundset(ss.id)
    return
  }

  if (!action.elementId) return
  const el = findElement(ss.id, action.elementId)
  if (!el) return

  // Dispatch by the element's CURRENT kind so reclassified elements work.
  if (el.kind === 'loop') toggleLoopElement(ss.id, el.id)
  else if (el.kind === 'random') toggleRandomElement(ss.id, el.id)
  else playOneshotElement(ss.id, el.id)
}

function runGlobalNote(action) {
  if (!action) return
  if (action.type === 'stop') stopEverything()
  else if (action.type === 'soundset') toggleSoundset(action.soundsetId)
  else if (action.type === 'palette') playPaletteItem(action.paletteId)
}

function runLocalCC(ss, action, value) {
  if (!action) return
  if (action.type === 'element') setElementVolume(ss.id, action.elementId, value / 127)
}

function runGlobalCC(action, value) {
  if (!action) return
  const v = value / 127
  if (action.type === 'master') setMaster(v)
  else if (action.type === 'bus') setBusVolume(action.bus, v)
  else if (action.type === 'paletteVolume') setPaletteVolume(action.paletteId, v)
}

onMidiMessage((m) => {
  if (m.type === 'note' && m.on) {
    const key = `${m.channel}:${m.note}`
    if (store.learning && store.learning.mode === 'note') {
      saveLearned(key, 'note', store.learning.action)
      return
    }
    const ss = activeSoundset.value
    const local = ss && ss.midi && ss.midi.notes && ss.midi.notes[key]
    if (local) runLocalNote(ss, local)
    else runGlobalNote(store.global.midi.notes[key])
  } else if (m.type === 'cc') {
    const key = `${m.channel}:${m.cc}`
    if (store.learning && store.learning.mode === 'cc') {
      saveLearned(key, 'cc', store.learning.action)
      return
    }
    const ss = activeSoundset.value
    const local = ss && ss.midi && ss.midi.ccs && ss.midi.ccs[key]
    if (local) runLocalCC(ss, local, m.value)
    else runGlobalCC(store.global.midi.ccs[key], m.value)
  }
})
