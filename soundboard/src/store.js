// Central reactive state + actions + MIDI dispatch for the soundboard.
// Single-document model: the server stores one `config.json` per soundset (plus a
// `global.json` for app-level state), and this module mirrors that state 1:1 with
// no overlay/merge layer. A soundset is a list of *elements*, each of which groups
// one or more sample files and is one of
//   - 'loop'    — continuous ambience/music (started with the soundset)
//   - 'random'  — auto-triggered one-shots at bounded random intervals
//   - 'oneshot' — manually triggered one-shots
import { reactive, computed } from 'vue'
import { engine } from './engine.js'
import { midi, connectMidi as connectMidiDevice, onMidiMessage } from './midi.js'
import { newId, newElement, newMood, normalizeElement } from '../lib/schema.js'

export const store = reactive({
  soundsets: [],
  files: [],
  global: { version: 1, buses: { loop: 1, random: 1, effects: 1 }, midi: { notes: {}, ccs: {} } },
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

export function audioUrl(ss, file) {
  return '/audio/' + resolvePath(ss.dir, file).map(encodeURIComponent).join('/')
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

// ---- element helpers ----

export function soundsetElements(ss) {
  const hidden = new Set(ss.hidden || [])
  const loops = []
  const randoms = []
  const oneshots = []
  for (const el of ss.elements || []) {
    if (hidden.has(el.id)) continue
    if (el.kind === 'loop') loops.push(el)
    else if (el.kind === 'random') randoms.push(el)
    else oneshots.push(el)
  }
  return { loops, randoms, oneshots }
}

function activeMood(ss) {
  if (!store.activeMoodId) return null
  return (ss.moods || []).find((m) => m.id === store.activeMoodId) || null
}

export function elementGainOf(ss, el) {
  const key = elKey(ss.id, el.id)
  if (key in store.volumeOverrides) return store.volumeOverrides[key]
  const mood = activeMood(ss)
  if (mood && mood.params[el.id]) return mood.params[el.id].volume
  return el.gain
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
  return (el.files || []).some((f) => engine.state.loading.has(audioUrl(ss, f)))
}

// ---- lookup helpers ----

function findElementByPair(ssId, elId) {
  const ss = store.soundsets.find((s) => s.id === ssId)
  const el = ss ? (ss.elements || []).find((e) => e.id === elId) : null
  return { ss, el }
}

// ---- loaders / persistence ----

export async function loadLibrary() {
  const res = await fetch('/api/library')
  const data = await res.json()
  store.soundsets = data.soundsets || []
  store.global = data.global || { version: 1, buses: { loop: 1, random: 1, effects: 1 }, midi: { notes: {}, ccs: {} } }
  engine.setBusGain('loop', store.global.buses.loop)
  engine.setBusGain('random', store.global.buses.random)
  engine.setBusGain('effects', store.global.buses.effects)
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

// ---- transport ----

export function startSoundset(id) {
  const ss = store.soundsets.find((s) => s.id === id)
  if (!ss) return
  if (store.activeId && store.activeId !== id && (store.loopsPlaying || store.randomsPlaying)) {
    stopSoundset()
  }
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

export function startLoops() {
  const ss = activeSoundset.value
  if (!ss) return
  for (const el of soundsetElements(ss).loops) startLoop(ss, el)
  store.loopsPlaying = true
}

export function stopLoops() {
  const ss = activeSoundset.value
  if (!ss) {
    store.loopsPlaying = false
    return
  }
  for (const el of soundsetElements(ss).loops) stopLoop(ss, el)
  store.loopsPlaying = false
}

export function startRandoms() {
  const ss = activeSoundset.value
  if (!ss) return
  for (const el of soundsetElements(ss).randoms) startRandom(ss, el)
  store.randomsPlaying = true
}

export function stopRandoms() {
  const ss = activeSoundset.value
  if (!ss) {
    store.randomsPlaying = false
    return
  }
  for (const el of soundsetElements(ss).randoms) stopRandom(ss, el)
  store.randomsPlaying = false
}

export function stopEffects() {
  engine.stopAllOneshots()
}

export function stopEverything() {
  stopSoundset()
  stopEffects()
}

// ---- loop elements ----

function startLoop(ss, el) {
  const key = elKey(ss.id, el.id)
  engine.playLoopElement(key, {
    files: (el.files || []).map((f) => audioUrl(ss, f)),
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
  const { ss, el } = findElementByPair(ssId, elId)
  if (!ss || !el) return
  const key = elKey(ss.id, el.id)
  if (engine.isLoopPlaying(key)) stopLoop(ss, el)
  else startLoop(ss, el)
}

// ---- one-shot elements ----

export function playOneshotElement(ssId, elId) {
  const { ss, el } = findElementByPair(ssId, elId)
  if (!ss || !el || !(el.files || []).length) return
  const key = elKey(ss.id, el.id)
  engine.playOneShot(key, audioUrl(ss, el.files[pickIndex(el, key)]), {
    gain: elementGainOf(ss, el),
    bus: 'effects',
    reverb: el.reverb,
  })
}

export function stopOneshotElement(ssId, elId) {
  const { ss, el } = findElementByPair(ssId, elId)
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

function triggerRandom(ss, el) {
  const key = elKey(ss.id, el.id)
  if (!randomTimers.has(key)) return
  const trig = el.trigger || {}
  engine.playOneShot(key, audioUrl(ss, el.files[pickIndex(el, key)]), {
    gain: elementGainOf(ss, el),
    bus: 'random',
    reverb: el.reverb,
  })
  const wait = Math.max(0, randBetween(trig.min, trig.max))
  randomTimers.get(key).timeout = setTimeout(() => triggerRandom(ss, el), wait * 1000)
}

function startRandom(ss, el) {
  const key = elKey(ss.id, el.id)
  if (randomTimers.has(key)) return
  randomTimers.set(key, { timeout: null })
  const trig = el.trigger || {}
  const start = Math.max(0, randBetween(trig.startMin, trig.startMax))
  randomTimers.get(key).timeout = setTimeout(() => triggerRandom(ss, el), start * 1000)
}

function stopRandom(ss, el) {
  const key = elKey(ss.id, el.id)
  const t = randomTimers.get(key)
  if (t && t.timeout) clearTimeout(t.timeout)
  randomTimers.delete(key)
  engine.stopOneShot(key)
}

export function toggleRandomElement(ssId, elId) {
  const { ss, el } = findElementByPair(ssId, elId)
  if (!ss || !el) return
  if (randomTimers.has(elKey(ss.id, el.id))) stopRandom(ss, el)
  else startRandom(ss, el)
}

export function playRandomOnce(ssId, elId) {
  const { ss, el } = findElementByPair(ssId, elId)
  if (!ss || !el || !(el.files || []).length) return
  const key = elKey(ss.id, el.id)
  engine.playOneShot(key, audioUrl(ss, el.files[pickIndex(el, key)]), {
    gain: elementGainOf(ss, el),
    bus: 'random',
    reverb: el.reverb,
  })
}

// ---- volume ----

export function setElementVolume(ssId, elId, v) {
  const { ss, el } = findElementByPair(ssId, elId)
  if (!ss || !el) return
  const key = elKey(ss.id, el.id)
  store.volumeOverrides[key] = v
  if (el.kind === 'loop') engine.setLoopGain(key, v)
}

export function resetElementVolume(ssId, elId) {
  const { ss, el } = findElementByPair(ssId, elId)
  if (!ss || !el) return
  const key = elKey(ss.id, el.id)
  delete store.volumeOverrides[key]
  if (el.kind === 'loop') engine.setLoopGain(key, elementGainOf(ss, el))
}

export function resetSectionVolume(ssId, kind) {
  const ss = store.soundsets.find((s) => s.id === ssId)
  if (!ss) return
  const { loops, randoms, oneshots } = soundsetElements(ss)
  const list = kind === 'loop' ? loops : kind === 'random' ? randoms : oneshots
  for (const el of list) {
    const key = elKey(ss.id, el.id)
    delete store.volumeOverrides[key]
    if (el.kind === 'loop') engine.setLoopGain(key, elementGainOf(ss, el))
  }
}

export function setMaster(v) {
  store.masterVolume = v
  engine.setMasterGain(v)
}

export function setLoopsVolume(v) {
  store.global.buses.loop = v
  engine.setBusGain('loop', v)
  persistGlobal()
}

export function setRandomsVolume(v) {
  store.global.buses.random = v
  engine.setBusGain('random', v)
  persistGlobal()
}

export function setEffectsVolume(v) {
  store.global.buses.effects = v
  engine.setBusGain('effects', v)
  persistGlobal()
}

// ---- moods ----

export function applyMood(ssId, moodId) {
  const ss = store.soundsets.find((s) => s.id === ssId)
  if (!ss) return
  const mood = (ss.moods || []).find((m) => m.id === moodId)
  if (!mood) return
  store.activeMoodId = moodId
  const { loops, randoms } = soundsetElements(ss)

  for (const el of [...loops, ...randoms]) {
    const p = mood.params[el.id]
    if (!p) continue
    const key = elKey(ss.id, el.id)
    delete store.volumeOverrides[key]
    if (el.kind === 'loop') {
      const playing = engine.isLoopPlaying(key)
      if (p.plays && !playing) startLoop(ss, el)
      else if (!p.plays && playing) stopLoop(ss, el)
      else if (p.plays && playing) engine.setLoopGain(key, elementGainOf(ss, el))
    } else {
      const active = randomTimers.has(key)
      if (p.plays && !active) startRandom(ss, el)
      else if (!p.plays && active) stopRandom(ss, el)
    }
  }
  store.loopsPlaying = loops.some((el) => engine.isLoopPlaying(elKey(ss.id, el.id)))
  store.randomsPlaying = randoms.some((el) => randomTimers.has(elKey(ss.id, el.id)))
}

export function createMood(ssId, name) {
  const ss = store.soundsets.find((s) => s.id === ssId)
  if (!ss) return
  ss.moods.push(newMood(name))
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

export function deleteMood(ssId, moodId) {
  const ss = store.soundsets.find((s) => s.id === ssId)
  if (!ss) return
  ss.moods = (ss.moods || []).filter((m) => m.id !== moodId)
  if (store.activeMoodId === moodId) store.activeMoodId = null
  persistSoundset(ss)
}

// ---- editor ----

export function renameElement(ssId, elId, name) {
  const { ss, el } = findElementByPair(ssId, elId)
  if (!ss || !el) return
  el.name = name
  persistSoundset(ss)
}

export function hideElement(ssId, elId) {
  const { ss, el } = findElementByPair(ssId, elId)
  if (!ss || !el) return
  if (!ss.hidden) ss.hidden = []
  if (!ss.hidden.includes(elId)) ss.hidden.push(elId)
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
  const el = newElement(def.kind || 'oneshot')
  el.name = def.name || ''
  if (def.gain != null) el.gain = def.gain
  if (def.randomise != null) el.randomise = def.randomise
  if (def.reverb != null) el.reverb = def.reverb
  if (def.trigger != null) el.trigger = def.trigger
  el.files = (def.files || []).map((f) => relativeFile(ss.dir, f.dir, f.file))
  ss.elements.push(el)
  persistSoundset(ss)
  return el.id
}

export function updateElement(ssId, elId, patch = {}) {
  const { ss, el } = findElementByPair(ssId, elId)
  if (!ss || !el) return
  const merged = { ...el, ...patch }
  if (patch.files != null) {
    merged.files = patch.files.map((f) => relativeFile(ss.dir, f.dir, f.file))
  }
  Object.assign(el, normalizeElement(merged))
  persistSoundset(ss)
}

export function deleteElement(ssId, elId) {
  const { ss, el } = findElementByPair(ssId, elId)
  if (!ss || !el) return
  const key = elKey(ss.id, elId)
  if (el.kind === 'loop') stopLoop(ss, el)
  else if (el.kind === 'random') stopRandom(ss, el)
  else engine.stopOneShot(key)
  ss.elements = (ss.elements || []).filter((e) => e.id !== elId)
  ss.hidden = (ss.hidden || []).filter((id) => id !== elId)
  for (const mood of ss.moods || []) {
    if (mood.params && elId in mood.params) delete mood.params[elId]
  }
  persistSoundset(ss)
}

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
  const body = {
    id: newId(),
    name: name || 'New soundscape',
    disabled: false,
    elements: [],
    hidden: [],
    moods: [],
    midi: { notes: {}, ccs: {} },
  }
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

export function cancelLearn() {
  store.learning = null
}

export function actionScope(a) {
  if (!a) return 'local'
  if (a.scope) return a.scope
  if (a.type === 'stop' || a.type === 'master' || a.type === 'bus') return 'global'
  if (a.type === 'soundset') return a.soundsetId ? 'global' : 'local'
  return 'local'
}

function saveLearned(key, mode, action) {
  const scope = actionScope(action)
  const mapKey = mode === 'note' ? 'notes' : 'ccs'
  if (scope === 'global') {
    store.global.midi[mapKey][key] = action
    persistGlobal()
  } else {
    const ss = activeSoundset.value
    if (ss) {
      ss.midi[mapKey][key] = action
      persistSoundset(ss)
    }
  }
  store.learning = null
}

function runLocalNote(ss, action) {
  if (!action) return
  const sid = ss.id
  if (action.type === 'oneshot') playOneshotElement(sid, action.elementId)
  else if (action.type === 'loop') toggleLoopElement(sid, action.elementId)
  else if (action.type === 'random') toggleRandomElement(sid, action.elementId)
  else if (action.type === 'mood') applyMood(sid, action.moodId)
  else if (action.type === 'soundset') toggleSoundset(sid)
}

function runGlobalNote(action) {
  if (!action) return
  if (action.type === 'stop') stopEverything()
  else if (action.type === 'soundset') toggleSoundset(action.soundsetId)
}

function runLocalCC(ss, action, value) {
  if (!action) return
  if (action.type === 'element') setElementVolume(ss.id, action.elementId, value / 127)
}

function runGlobalCC(action, value) {
  if (!action) return
  const v = value / 127
  if (action.type === 'master') setMaster(v)
  else if (action.type === 'bus') {
    if (action.bus === 'loop') setLoopsVolume(v)
    else if (action.bus === 'random') setRandomsVolume(v)
    else if (action.bus === 'effects') setEffectsVolume(v)
  }
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
