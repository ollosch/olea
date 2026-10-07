// Central reactive state + actions + MIDI dispatch for the soundboard.
// The library is modelled after Syrinscape's XML: a soundset is a list of
// *elements*, each of which groups one or more sample files and is one of
//   - 'loop'    — continuous ambience/music (started with the soundset)
//   - 'random'  — auto-triggered one-shots at bounded random intervals
//   - 'oneshot' — manually triggered one-shots
// User edits (renames, hidden elements, added groups, custom soundsets) live in
// a JSON overlay that is merged over the scanned library.
import { reactive, computed } from 'vue'
import { engine } from './engine'
import { midi, connectMidi as connectMidiDevice, onMidiMessage } from './midi'

const DEFAULT_LOOP_GAIN = 0.8

function emptyOverlay() {
  return { renames: {}, hidden: {}, addedElements: {}, customSoundsets: [] }
}

export const store = reactive({
  rawSoundsets: [], // as scanned by the server (no user edits applied)
  files: [], // file index for the editor's picker: [{ dir, name, files:[{name,file}] }]
  overlay: emptyOverlay(),
  activeId: null,
  loopsPlaying: false, // whether the active soundset's loops were started as a set
  randomsPlaying: false, // whether the active soundset's randoms were started as a set
  loaded: false,
  masterVolume: 0.8,
  loopsVolume: 1,
  randomsVolume: 1,
  effectsVolume: 1,
  elementGains: {}, // `${soundsetId}::${elementId}` -> gain (0..~2)
  mapping: { notes: {}, ccs: {} },
  learning: null, // { mode: 'note'|'cc', action: {...} }
  midiConnected: false,
  midiError: '',
})

const randomTimers = reactive(new Map()) // key -> { timeout } (reactive so toggles re-render)

export const mergedSoundsets = computed(() => {
  const renames = store.overlay.renames || {}
  const hidden = store.overlay.hidden || {}
  const added = store.overlay.addedElements || {}
  const out = []

  for (const ss of store.rawSoundsets) {
    const elRenames = renames[ss.id] || {}
    const hiddenIds = new Set(hidden[ss.id] || [])
    const elements = []
    for (const el of ss.elements) {
      if (hiddenIds.has(el.id)) continue
      elements.push({ ...el, name: elRenames[el.id] ?? el.name })
    }
    for (const el of added[ss.id] || []) {
      elements.push({ ...el, name: elRenames[el.id] ?? el.name })
    }
    out.push({ ...ss, elements })
  }

  for (const cs of store.overlay.customSoundsets || []) {
    const elRenames = renames[cs.id] || {}
    out.push({
      ...cs,
      elements: (cs.elements || []).map((el) => ({ ...el, name: elRenames[el.id] ?? el.name })),
    })
  }

  out.sort((a, b) => a.name.localeCompare(b.name))
  return out
})

export const activeSoundset = computed(
  () => mergedSoundsets.value.find((s) => s.id === store.activeId) || null
)

export function audioUrl(dir, file) {
  return `/audio/${encodeURIComponent(dir)}/${encodeURIComponent(file)}`
}

const elKey = (ssId, elId) => `${ssId}::${elId}`

function fileUrl(ss, f) {
  return audioUrl(f.dir || ss.dir, f.file)
}

export function elementGainOf(ss, el) {
  return store.elementGains[elKey(ss.id, el.id)] ?? el.gain ?? DEFAULT_LOOP_GAIN
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
  return el.files.some((f) => engine.state.loading.has(fileUrl(ss, f)))
}

export function soundsetElements(ss) {
  const loops = []
  const oneshots = []
  const randoms = []
  for (const el of ss.elements) {
    if (el.kind === 'loop') loops.push(el)
    else if (el.kind === 'random') randoms.push(el)
    else oneshots.push(el)
  }
  return { loops, oneshots, randoms }
}

function findSoundset(id) {
  return mergedSoundsets.value.find((s) => s.id === id) || null
}

function findElement(ss, elId) {
  return ss ? ss.elements.find((el) => el.id === elId) || null : null
}

const randBetween = (min, max) => {
  if (min == null || Number.isNaN(min)) min = 0
  if (max == null || Number.isNaN(max)) max = min
  if (min === max) return min
  return min + Math.random() * (max - min)
}

const lastPicks = new Map() // elKey -> last file index (avoid immediate repeats)

function pickIndex(el, key) {
  const n = el.files.length
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

// ---- loaders / persistence ----

export async function loadLibrary() {
  const res = await fetch('/api/library')
  const data = await res.json()
  store.rawSoundsets = data.soundsets || []
  store.overlay = Object.assign(emptyOverlay(), data.overlay || {})
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

export async function loadMapping() {
  try {
    const res = await fetch('/api/mapping')
    const data = await res.json()
    if (data && typeof data === 'object') {
      store.mapping = { notes: data.notes || {}, ccs: data.ccs || {} }
    }
  } catch {
    /* ignore */
  }
}

export async function saveMapping() {
  try {
    await fetch('/api/mapping', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(store.mapping),
    })
  } catch {
    /* ignore */
  }
}

export function saveOverlay() {
  fetch('/api/library', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(store.overlay),
  }).catch(() => {})
}

// ---- editor actions ----

function uid(prefix) {
  return `${prefix}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`
}

export function isCustomSoundset(ssId) {
  return (store.overlay.customSoundsets || []).some((s) => s.id === ssId)
}

// Which place a given element lives in: scanned / added / custom.
export function elementSource(ssId, elId) {
  if (isCustomSoundset(ssId)) return 'custom'
  if ((store.overlay.addedElements || {})[ssId]?.some((el) => el.id === elId)) return 'added'
  return 'scanned'
}

export function renameElement(ssId, elId, name) {
  if (!store.overlay.renames[ssId]) store.overlay.renames[ssId] = {}
  store.overlay.renames[ssId][elId] = name
  saveOverlay()
}

export function hideElement(ssId, elId) {
  if (!store.overlay.hidden[ssId]) store.overlay.hidden[ssId] = []
  if (!store.overlay.hidden[ssId].includes(elId)) store.overlay.hidden[ssId].push(elId)
  saveOverlay()
}

export function unhideElement(ssId, elId) {
  store.overlay.hidden[ssId] = (store.overlay.hidden[ssId] || []).filter((id) => id !== elId)
  saveOverlay()
}

export function addElement(ssId, def) {
  const el = { id: uid('el'), gain: 1, randomise: 'random', ...def }
  const custom = (store.overlay.customSoundsets || []).find((s) => s.id === ssId)
  if (custom) {
    custom.elements = custom.elements || []
    custom.elements.push(el)
  } else {
    if (!store.overlay.addedElements[ssId]) store.overlay.addedElements[ssId] = []
    store.overlay.addedElements[ssId].push(el)
  }
  saveOverlay()
  return el.id
}

export function updateElement(ssId, elId, patch) {
  const custom = (store.overlay.customSoundsets || []).find((s) => s.id === ssId)
  if (custom) {
    const el = custom.elements.find((e) => e.id === elId)
    if (el) Object.assign(el, patch)
  } else {
    const arr = store.overlay.addedElements[ssId] || []
    const el = arr.find((e) => e.id === elId)
    if (el) Object.assign(el, patch)
  }
  saveOverlay()
}

export function deleteElement(ssId, elId) {
  const custom = (store.overlay.customSoundsets || []).find((s) => s.id === ssId)
  if (custom) {
    custom.elements = (custom.elements || []).filter((e) => e.id !== elId)
  } else {
    store.overlay.addedElements[ssId] = (store.overlay.addedElements[ssId] || []).filter((e) => e.id !== elId)
  }
  saveOverlay()
}

export function createSoundset(name) {
  const id = uid('set')
  store.overlay.customSoundsets.push({
    id,
    name: name || 'New soundscape',
    gain: 1,
    custom: true,
    elements: [],
    moods: [],
  })
  saveOverlay()
  return id
}

export function renameSoundset(id, name) {
  const s = (store.overlay.customSoundsets || []).find((s) => s.id === id)
  if (s) {
    s.name = name
    saveOverlay()
  }
}

export function deleteSoundset(id) {
  store.overlay.customSoundsets = (store.overlay.customSoundsets || []).filter((s) => s.id !== id)
  if (store.activeId === id) {
    stopEverything()
    store.activeId = null
  }
  saveOverlay()
}

// ---- loop elements ----

function startLoop(ss, el) {
  const key = elKey(ss.id, el.id)
  engine.playLoopElement(key, {
    files: el.files.map((f) => fileUrl(ss, f)),
    gain: elementGainOf(ss, el),
    randomise: el.randomise === 'random' || el.randomise === 'shuffle',
  })
}

function stopLoop(ss, el) {
  engine.stopLoopElement(elKey(ss.id, el.id))
}

export function toggleLoopElement(ssId, elId) {
  const ss = findSoundset(ssId)
  const el = findElement(ss, elId)
  if (!ss || !el) return
  if (engine.isLoopPlaying(elKey(ss.id, el.id))) stopLoop(ss, el)
  else startLoop(ss, el)
}

// ---- one-shot elements ----

export function playOneshotElement(ssId, elId) {
  const ss = findSoundset(ssId)
  const el = findElement(ss, elId)
  if (!ss || !el || !el.files.length) return
  const key = elKey(ss.id, el.id)
  const f = el.files[pickIndex(el, key)]
  engine.playOneShot(key, fileUrl(ss, f), {
    gain: elementGainOf(ss, el),
    bus: 'effects',
  })
}

export function stopOneshotElement(ssId, elId) {
  const ss = findSoundset(ssId)
  const el = findElement(ss, elId)
  if (!ss || !el) return
  engine.stopOneShot(elKey(ss.id, el.id))
}

// ---- random (auto-injection) elements ----

function triggerRandom(ss, el) {
  const key = elKey(ss.id, el.id)
  if (!randomTimers.has(key)) return
  const f = el.files[pickIndex(el, key)]
  engine.playOneShot(key, fileUrl(ss, f), { gain: elementGainOf(ss, el), bus: 'random' })
  const wait = Math.max(0, randBetween(el.trigger.min, el.trigger.max))
  randomTimers.get(key).timeout = setTimeout(() => triggerRandom(ss, el), wait * 1000)
}

function startRandom(ss, el) {
  const key = elKey(ss.id, el.id)
  if (randomTimers.has(key)) return
  randomTimers.set(key, { timeout: null })
  const start = Math.max(0, randBetween(el.trigger.startMin, el.trigger.startMax))
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
  const ss = findSoundset(ssId)
  const el = findElement(ss, elId)
  if (!ss || !el) return
  if (randomTimers.has(elKey(ss.id, el.id))) stopRandom(ss, el)
  else startRandom(ss, el)
}

export function playRandomOnce(ssId, elId) {
  const ss = findSoundset(ssId)
  const el = findElement(ss, elId)
  if (!ss || !el || !el.files.length) return
  const key = elKey(ss.id, el.id)
  const f = el.files[pickIndex(el, key)]
  engine.playOneShot(key, fileUrl(ss, f), { gain: elementGainOf(ss, el), bus: 'random' })
}

// ---- soundset lifecycle ----

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
  for (const el of soundsetElements(ss).loops) engine.stopLoopElement(elKey(ss.id, el.id))
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

export function startSoundset(id) {
  const ss = findSoundset(id)
  if (!ss) return
  if ((store.loopsPlaying || store.randomsPlaying) && store.activeId && store.activeId !== id) {
    stopSoundset()
  }
  store.activeId = id
  startLoops()
  startRandoms()
}

export function stopSoundset() {
  stopLoops()
  stopRandoms()
}

export function stopEffects() {
  engine.stopAllOneshots()
}

export function stopEverything() {
  stopSoundset()
  engine.stopAllOneshots()
}

export function leaveSoundset() {
  stopEverything()
  store.activeId = null
}

export function toggleSoundset(id) {
  if (store.activeId === id && (store.loopsPlaying || store.randomsPlaying)) stopSoundset()
  else startSoundset(id)
}

export function setElementVolume(ssId, elId, v) {
  const ss = findSoundset(ssId)
  const el = findElement(ss, elId)
  if (!ss || !el) return
  const key = elKey(ss.id, el.id)
  store.elementGains[key] = v
  if (el.kind === 'loop') engine.setLoopGain(key, v)
}

export function isVolumeOverridden(ss, el) {
  return elKey(ss.id, el.id) in store.elementGains
}

export function resetElementVolume(ssId, elId) {
  const ss = findSoundset(ssId)
  const el = findElement(ss, elId)
  if (!ss || !el) return
  const key = elKey(ss.id, el.id)
  delete store.elementGains[key]
  if (el.kind === 'loop') engine.setLoopGain(key, elementGainOf(ss, el))
}

export function resetSectionVolume(ssId, kind) {
  const ss = findSoundset(ssId)
  if (!ss) return
  const { loops, oneshots, randoms } = soundsetElements(ss)
  const list = kind === 'loop' ? loops : kind === 'random' ? randoms : oneshots
  for (const el of list) {
    const key = elKey(ss.id, el.id)
    delete store.elementGains[key]
    if (el.kind === 'loop') engine.setLoopGain(key, elementGainOf(ss, el))
  }
}

export function setMaster(v) {
  store.masterVolume = v
  engine.setMasterGain(v)
}

export function setLoopsVolume(v) {
  store.loopsVolume = v
  engine.setBusGain('loop', v)
}

export function setRandomsVolume(v) {
  store.randomsVolume = v
  engine.setBusGain('random', v)
}

export function setEffectsVolume(v) {
  store.effectsVolume = v
  engine.setBusGain('effects', v)
}

// ---- moods ----

export function applyMood(ssId, moodIndex) {
  const ss = findSoundset(ssId)
  if (!ss || !ss.moods || !ss.moods[moodIndex]) return
  const mood = ss.moods[moodIndex]
  const { loops, randoms } = soundsetElements(ss)

  for (const el of [...loops, ...randoms]) {
    const p = mood.params[el.id]
    if (!p) continue
    setElementVolume(ss.id, el.id, p.volume)
    if (el.kind === 'loop') {
      const playing = engine.isLoopPlaying(elKey(ss.id, el.id))
      if (p.plays && !playing) startLoop(ss, el)
      else if (!p.plays && playing) stopLoop(ss, el)
    } else {
      const active = randomTimers.has(elKey(ss.id, el.id))
      if (p.plays && !active) startRandom(ss, el)
      else if (!p.plays && active) stopRandom(ss, el)
    }
  }
  store.loopsPlaying = loops.some((el) => engine.isLoopPlaying(elKey(ss.id, el.id)))
  store.randomsPlaying = randoms.some((el) => randomTimers.has(elKey(ss.id, el.id)))
}

// ---- MIDI learn ----

export function learnNote(action) {
  store.learning = { mode: 'note', action }
}

export function learnCC(action) {
  store.learning = { mode: 'cc', action }
}

export function cancelLearn() {
  store.learning = null
}

export function clearMapping() {
  store.mapping = { notes: {}, ccs: {} }
  saveMapping()
}

export async function connectMidi() {
  const ok = await connectMidiDevice()
  store.midiConnected = ok
  store.midiError = midi.error || ''
  return ok
}

function keyFor(m) {
  return `${m.channel}:${m.note}`
}

function ccKeyFor(m) {
  return `${m.channel}:${m.cc}`
}

function runNoteAction(action) {
  if (!action) return
  if (action.type === 'oneshot') playOneshotElement(action.soundsetId, action.elementId)
  else if (action.type === 'loop') toggleLoopElement(action.soundsetId, action.elementId)
  else if (action.type === 'random') toggleRandomElement(action.soundsetId, action.elementId)
  else if (action.type === 'soundset') toggleSoundset(action.soundsetId)
}

function runCCAction(action, value) {
  if (!action) return
  const v = value / 127
  if (action.type === 'master') setMaster(v)
  else if (action.type === 'element') setElementVolume(action.soundsetId, action.elementId, v)
}

onMidiMessage((m) => {
  if (m.type === 'note' && m.on) {
    const key = keyFor(m)
    if (store.learning && store.learning.mode === 'note') {
      store.mapping.notes[key] = store.learning.action
      store.learning = null
      saveMapping()
      return
    }
    runNoteAction(store.mapping.notes[key])
  } else if (m.type === 'cc') {
    const key = ccKeyFor(m)
    if (store.learning && store.learning.mode === 'cc') {
      store.mapping.ccs[key] = store.learning.action
      store.learning = null
      saveMapping()
      return
    }
    runCCAction(store.mapping.ccs[key], m.value)
  }
})
