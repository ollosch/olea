// Central reactive store for the v3 soundboard frontend.
//
// The store owns all browser-side state and every user/MIDI action. It talks to
// the v3 HTTP API, resolves scenes for playback, persists edits (debounced and
// serialized), and coordinates the Web Audio engine. Components should call
// these methods rather than touching the API directly.

import { reactive, computed } from 'vue'
import { engine } from './engine.js'
import {
  KINDS,
  REVERB_PRESETS,
  clamp01,
  clampPan,
  coerceReverb,
  normalizeMood,
  normalizeScene,
  sanitizeTrigger,
  uid,
} from '../lib/v3/schema.js'
import {
  addTracksForGroups,
  dropInsertionIndex,
  moveTracks,
} from '../lib/v3/order.js'
import {
  resolveScenePlan,
  initialTransportPlan,
  moodChangePlan,
  applyManualToggle,
  palettePlan,
  nextPaletteKind,
} from './playback-model.js'
import {
  actionChannelType,
  bindingKey,
  findConflicts,
  normalizeMidiAction,
  parseBindingKey,
  removeBindingsForTargets,
  sameTarget,
  setBinding,
  targetKey,
} from '../lib/v3/bindings.js'

const DEFAULT_GLOBAL = {
  version: 3,
  master: 0.8,
  buses: { loop: 1, random: 1, oneshot: 1 },
  palette: [],
  midi: { notes: {}, ccs: {} },
}

const ZERO_TRIGGER = { min: 0, max: 0, startMin: 0, startMax: 0 }

const clone = (value) => JSON.parse(JSON.stringify(value))
const triggerCopy = (value) => sanitizeTrigger(value)

export const store = reactive({
  bootstrapped: false,
  loading: false,
  sceneLoading: false,
  error: '',
  status: '',
  statusTone: 'info',
  warnings: [],
  mode: 'edit',
  view: 'editor',
  browserTab: 'scenes',
  scenes: [],
  activeScene: null,
  selectedMoodId: null,
  selectedTrackId: null,
  selectedTrackIds: [],
  library: { version: 3, groups: [] },
  global: clone(DEFAULT_GLOBAL),
  stats: { total: 0, assigned: 0, unassigned: 0, groups: 0, uncategorized: 0 },
  catalogCount: 0,
  importDone: false,
  soundsById: {},
  soundsLoading: false,
  transportRunning: false,
  master: 0.8,
  buses: { loop: 1, random: 1, oneshot: 1 },
  learning: null,
  collision: null,
  bindingsOverview: null,
  showMidiPanel: false,
  lastSavedAt: null,
  librarySelection: [],
  editingGroupId: null,
  import: {
    query: '',
    unassigned: false,
    kind: '',
    category: '',
    tag: '',
    offset: 0,
    limit: 50,
    sounds: [],
    total: 0,
    loading: false,
    error: '',
    selectedSoundIds: [],
    selectedGroupIds: [],
    groupQuery: '',
    splitGroupId: '',
    splitSoundIds: [],
  },
})

// ---------------------------------------------------------------------------
// HTTP helpers / status

function messageFor(err) {
  if (!err) return 'Unknown error'
  let message = err.message || 'Request failed'
  if (Array.isArray(err.errors) && err.errors.length) {
    const types = err.errors
      .slice(0, 3)
      .map((item) => item?.type || item?.message)
      .filter(Boolean)
    if (types.length) message += ` (${types.join(', ')})`
  }
  return message
}

async function api(path, options = {}) {
  const init = { ...options }
  if (init.body !== undefined && typeof init.body !== 'string') {
    init.body = JSON.stringify(init.body)
  }
  if (init.body !== undefined) {
    init.headers = { 'Content-Type': 'application/json', ...(init.headers || {}) }
  }
  const res = await fetch(path, init)
  const text = await res.text()
  let data = null
  if (text) {
    try {
      data = JSON.parse(text)
    } catch {
      data = null
    }
  }
  if (!res.ok) {
    const err = new Error(data?.error || `Request failed (${res.status})`)
    err.status = res.status
    err.errors = data?.errors
    throw err
  }
  return data
}

let statusTimer = null

export function setStatus(message, tone = 'info') {
  store.status = message
  store.statusTone = tone
  if (statusTimer) clearTimeout(statusTimer)
  statusTimer = setTimeout(() => {
    store.status = ''
    store.statusTone = 'info'
  }, 5000)
}

export function setError(err) {
  store.error = messageFor(err)
}

export function clearError() {
  store.error = ''
}

// ---------------------------------------------------------------------------
// Derived state

function groupsByIdMap() {
  return new Map(store.library.groups.map((group) => [group.id, group]))
}

export const groupsById = computed(groupsByIdMap)

export function groupById(id) {
  return store.library.groups.find((group) => group.id === id) || null
}

export function soundUrl(sound) {
  if (!sound) return ''
  return sound.url || `/audio/${sound.hash}`
}

function soundMeta(id) {
  const sound = store.soundsById[id]
  if (!sound) return null
  return { ...sound, url: soundUrl(sound) }
}

function augmentTrack(track, groups) {
  const group = groups.get(track.groupId) || null
  return {
    ...track,
    group,
    groupName: group?.name || '(missing group)',
    sounds: track.sounds || [],
    soundData: (track.sounds || []).map(soundMeta).filter(Boolean),
  }
}

function buildPlan(moodId = store.selectedMoodId) {
  const scene = store.activeScene
  if (!scene) {
    return { mood: null, loops: [], randoms: [], oneshots: [], all: [] }
  }
  const groups = groupsByIdMap()
  const plan = resolveScenePlan(scene, groups, moodId)
  return {
    mood: plan.mood,
    loops: plan.loops.map((track) => augmentTrack(track, groups)),
    randoms: plan.randoms.map((track) => augmentTrack(track, groups)),
    oneshots: plan.oneshots.map((track) => augmentTrack(track, groups)),
    all: plan.all.map((track) => augmentTrack(track, groups)),
  }
}

export const currentPlan = computed(() => buildPlan(store.selectedMoodId))

export const sceneSections = computed(() => {
  const plan = currentPlan.value
  return [
    { kind: 'loop', label: 'Loops', tracks: plan.loops },
    { kind: 'random', label: 'Random', tracks: plan.randoms },
    { kind: 'oneshot', label: 'One-shots', tracks: plan.oneshots },
  ]
})

export const selectedTrack = computed(() => {
  if (!store.selectedTrackId) return null
  return currentPlan.value.all.find((track) => track.trackId === store.selectedTrackId) || null
})

export const selectedMood = computed(() => {
  const scene = store.activeScene
  if (!scene) return null
  return scene.moods.find((mood) => mood.id === store.selectedMoodId) || scene.moods[0] || null
})

export const paletteEntries = computed(() => {
  const groups = groupsByIdMap()
  return palettePlan(store.library, store.global.palette, groups).map((entry) => {
    const group = entry.group
    const soundIds = Array.isArray(group?.sounds) ? group.sounds : []
    return {
      ...entry,
      groupName: group?.name || '',
      sounds: soundIds,
      soundData: soundIds.map(soundMeta).filter(Boolean),
      selection: group?.selection || 'random',
      reverb: group?.defaults?.reverb ?? null,
      pan: group?.defaults?.pan ?? 0,
      trigger: group?.defaults?.trigger,
      gain: entry.gain ?? group?.defaults?.gain ?? 0.8,
    }
  })
})

export const bindingConflicts = computed(() =>
  findConflicts(store.global.midi, store.activeScene?.midi)
)

// ---------------------------------------------------------------------------
// Sounds cache

export async function ensureSounds(ids) {
  const missing = []
  const seen = new Set()
  for (const id of Array.isArray(ids) ? ids : []) {
    if (typeof id !== 'string' || !id || seen.has(id) || store.soundsById[id]) continue
    seen.add(id)
    missing.push(id)
  }
  if (!missing.length) return
  store.soundsLoading = true
  try {
    for (let i = 0; i < missing.length; i += 500) {
      const chunk = missing.slice(i, i + 500)
      const params = new URLSearchParams({ ids: chunk.join(',') })
      const data = await api(`/api/sounds?${params.toString()}`)
      for (const sound of data?.sounds || []) {
        store.soundsById[sound.id] = { ...sound, url: soundUrl(sound) }
      }
    }
  } catch (err) {
    setError(err)
  } finally {
    store.soundsLoading = false
  }
}

function collectGroupSounds(groupIds) {
  const groups = groupsByIdMap()
  const ids = []
  for (const id of groupIds) {
    const group = groups.get(id)
    if (group) ids.push(...group.sounds)
  }
  return ids
}

export async function ensureGroupSounds(groupId) {
  const group = groupById(groupId)
  if (!group) return
  await ensureSounds(group.sounds)
  refreshWarnings()
}

export async function ensureSceneSounds(scene) {
  if (!scene) return
  const groupIds = new Set((scene.tracks || []).map((track) => track.groupId))
  await ensureSounds(collectGroupSounds(groupIds))
}

export async function ensurePaletteSounds() {
  const groupIds = new Set((store.global.palette || []).map((entry) => entry.groupId))
  await ensureSounds(collectGroupSounds(groupIds))
}

function refreshWarnings() {
  const warnings = []
  const groups = groupsByIdMap()
  const referenced = new Set()
  for (const track of store.activeScene?.tracks || []) referenced.add(track.groupId)
  for (const entry of store.global.palette || []) referenced.add(entry.groupId)

  for (const groupId of referenced) {
    if (!groupId) continue
    const group = groups.get(groupId)
    if (!group) {
      warnings.push(`Missing library group: ${groupId}`)
      continue
    }
    const missing = (group.sounds || []).filter((soundId) => !store.soundsById[soundId])
    if (missing.length) {
      warnings.push(`Group "${group.name}" is missing ${missing.length} sound(s)`)
    }
  }
  store.warnings = [...new Set(warnings)]
}

// ---------------------------------------------------------------------------
// Bootstrap / scene loading

function applyGlobal(global) {
  store.global = global && typeof global === 'object' ? global : clone(DEFAULT_GLOBAL)
  store.master = clamp01(store.global.master ?? 0.8)
  store.buses = {
    loop: clamp01(store.global.buses?.loop ?? 1),
    random: clamp01(store.global.buses?.random ?? 1),
    oneshot: clamp01(store.global.buses?.oneshot ?? 1),
  }
  engine.setMaster(store.master)
  for (const bus of KINDS) engine.setBus(bus, store.buses[bus])
}

function applyBootstrap(data) {
  store.scenes = Array.isArray(data?.scenes) ? data.scenes : []
  store.library = data?.library || { version: 3, groups: [] }
  applyGlobal(data?.global)
  store.stats = data?.stats || store.stats
  store.catalogCount = data?.catalog?.count ?? store.stats.total ?? 0
  store.importDone = Boolean(data?.stats?.importDone)
}

export async function bootstrap() {
  store.loading = true
  clearError()
  try {
    const data = await api('/api/bootstrap')
    applyBootstrap(data)
    const first = store.scenes.find((scene) => !scene.disabled) || store.scenes[0] || null
    if (first) await openScene(first.id)
    await ensurePaletteSounds()
    refreshWarnings()
    store.bootstrapped = true
  } catch (err) {
    setError(err)
  } finally {
    store.loading = false
  }
}

export async function refreshScenes() {
  try {
    const scenes = await api('/api/scenes')
    store.scenes = Array.isArray(scenes) ? scenes : []
  } catch (err) {
    setError(err)
  }
}

export async function openScene(id) {
  if (!id) return null
  await flushSave()
  transportGeneration += 1
  engine.stopScene()
  store.transportRunning = false
  store.sceneLoading = true
  clearError()
  try {
    const raw = await api(`/api/scenes/${encodeURIComponent(id)}`)
    const scene = normalizeScene(raw)
    await ensureSceneSounds(scene)
    store.activeScene = scene
    const mood = scene.moods.find((item) => item.id === scene.defaultMoodId) || scene.moods[0]
    store.selectedMoodId = mood?.id || null
    store.selectedTrackId = null
    store.selectedTrackIds = []
    refreshWarnings()
    return scene
  } catch (err) {
    setError(err)
    return null
  } finally {
    store.sceneLoading = false
  }
}

// ---------------------------------------------------------------------------
// Debounced persistence

let sceneTimer = null
let sceneChain = Promise.resolve()

export function scheduleSave(delay = 350) {
  if (!store.activeScene) return
  if (sceneTimer) clearTimeout(sceneTimer)
  sceneTimer = setTimeout(() => {
    sceneTimer = null
    persistScene()
  }, delay)
}

function persistScene() {
  const scene = store.activeScene
  if (!scene) return Promise.resolve()
  const snapshot = clone(scene)
  sceneChain = sceneChain
    .catch(() => {})
    .then(async () => {
      await api(`/api/scenes/${encodeURIComponent(snapshot.id)}`, {
        method: 'PUT',
        body: JSON.stringify(snapshot),
      })
      store.lastSavedAt = Date.now()
      const summary = store.scenes.find((item) => item.id === snapshot.id)
      if (summary) {
        summary.name = snapshot.name
        summary.disabled = snapshot.disabled
        summary.trackCount = snapshot.tracks.length
        summary.moodCount = snapshot.moods.length
        summary.defaultMoodId = snapshot.defaultMoodId
      }
    })
    .catch((err) => setError(err))
  return sceneChain
}

export async function flushSave() {
  if (sceneTimer) {
    clearTimeout(sceneTimer)
    sceneTimer = null
  }
  if (!store.activeScene) return
  await persistScene()
}

let globalTimer = null
let globalChain = Promise.resolve()

export function scheduleGlobalSave(delay = 300) {
  if (globalTimer) clearTimeout(globalTimer)
  globalTimer = setTimeout(() => {
    globalTimer = null
    persistGlobalNow()
  }, delay)
}

export function persistGlobalNow() {
  const snapshot = clone(store.global)
  globalChain = globalChain
    .catch(() => {})
    .then(async () => {
      await api('/api/global', { method: 'PUT', body: JSON.stringify(snapshot) })
    })
    .catch((err) => setError(err))
  return globalChain
}

export async function flushGlobal() {
  if (globalTimer) {
    clearTimeout(globalTimer)
    globalTimer = null
  }
  await persistGlobalNow()
}

// ---------------------------------------------------------------------------
// Scene CRUD

export async function createScene(name) {
  try {
    const data = await api('/api/scenes', { method: 'POST', body: { name } })
    await refreshScenes()
    await openScene(data.scene.id)
    setStatus(`Created scene "${data.scene.name || 'Scene'}"`)
    return data.scene
  } catch (err) {
    setError(err)
    return null
  }
}

export function renameScene(name) {
  if (!store.activeScene) return
  const next = String(name || '').trim()
  if (!next) return
  store.activeScene.name = next
  scheduleSave()
}

export async function setSceneDisabled(idOrDisabled, maybeDisabled) {
  const byId = typeof idOrDisabled === 'string'
  const id = byId ? idOrDisabled : store.activeScene?.id
  const disabled = byId ? Boolean(maybeDisabled) : Boolean(idOrDisabled)
  if (!id) return

  if (store.activeScene?.id === id) {
    store.activeScene.disabled = disabled
    const summary = store.scenes.find((scene) => scene.id === id)
    if (summary) summary.disabled = disabled
    scheduleSave()
    return
  }

  try {
    const raw = await api(`/api/scenes/${encodeURIComponent(id)}`)
    const scene = normalizeScene(raw)
    scene.disabled = disabled
    await api(`/api/scenes/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body: JSON.stringify(scene),
    })
    const summary = store.scenes.find((item) => item.id === id)
    if (summary) summary.disabled = disabled
  } catch (err) {
    setError(err)
  }
}

export async function deleteScene(id) {
  if (!id) return
  try {
    if (store.activeScene?.id === id) {
      if (sceneTimer) {
        clearTimeout(sceneTimer)
        sceneTimer = null
      }
      await sceneChain.catch(() => {})
    } else {
      await flushSave()
    }
    await api(`/api/scenes/${encodeURIComponent(id)}`, { method: 'DELETE' })
    if (store.activeScene?.id === id) {
      engine.stopScene()
      store.transportRunning = false
      store.activeScene = null
      store.selectedMoodId = null
      store.selectedTrackId = null
      store.selectedTrackIds = []
    }
    await refreshScenes()
    setStatus('Scene deleted')
  } catch (err) {
    setError(err)
  }
}

// ---------------------------------------------------------------------------
// Moods

export function selectMood(id) {
  const scene = store.activeScene
  if (!scene) return
  if (!scene.moods.some((mood) => mood.id === id)) return
  if (id === store.selectedMoodId) return

  const previous = buildPlan(store.selectedMoodId)
  store.selectedMoodId = id
  const next = buildPlan(id)

  if (store.transportRunning) {
    const change = moodChangePlan(
      previous,
      next,
      engine.activeTrackIds('loop'),
      engine.activeTrackIds('random')
    )
    for (const track of change.stopLoops) engine.stopTrack(track.trackId)
    for (const track of change.stopRandoms) engine.stopTrack(track.trackId)
    for (const track of change.startLoops) engine.startTrack(track)
    for (const track of change.startRandoms) engine.startTrack(track)
    for (const track of change.apply) engine.applyTrackParams(track)
  }
}

export function createMood() {
  const scene = store.activeScene
  if (!scene) return null
  const mood = normalizeMood(
    { id: uid(), name: `Mood ${scene.moods.length + 1}` },
    scene.tracks.map((track) => track.id)
  )
  scene.moods.push(mood)
  selectMood(mood.id)
  scheduleSave()
  return mood
}

export function duplicateMood(id = store.selectedMoodId) {
  const scene = store.activeScene
  if (!scene) return null
  const source = scene.moods.find((mood) => mood.id === id)
  if (!source) return null
  const mood = normalizeMood(
    {
      id: uid(),
      name: `${source.name} copy`,
      params: clone(source.params),
    },
    scene.tracks.map((track) => track.id)
  )
  scene.moods.push(mood)
  selectMood(mood.id)
  scheduleSave()
  return mood
}

export function renameMood(id, name) {
  const scene = store.activeScene
  if (!scene) return
  const mood = scene.moods.find((item) => item.id === id)
  if (!mood) return
  const next = String(name || '').trim()
  if (next) mood.name = next
  scheduleSave()
}

export function deleteMood(id) {
  const scene = store.activeScene
  if (!scene) return
  if (scene.moods.length <= 1) {
    setStatus('A scene must keep at least one mood', 'error')
    return
  }
  const index = scene.moods.findIndex((mood) => mood.id === id)
  if (index < 0) return
  const wasSelected = store.selectedMoodId === id
  const previous = wasSelected && store.transportRunning ? buildPlan(store.selectedMoodId) : null
  scene.moods.splice(index, 1)
  scene.midi = removeBindingsForTargets(scene.midi, 'local', [
    { type: 'moodSelect', moodId: id },
  ])
  if (scene.defaultMoodId === id) scene.defaultMoodId = scene.moods[0].id
  if (wasSelected) store.selectedMoodId = scene.defaultMoodId
  scheduleSave()

  if (previous) {
    const next = buildPlan(store.selectedMoodId)
    const change = moodChangePlan(
      previous,
      next,
      engine.activeTrackIds('loop'),
      engine.activeTrackIds('random')
    )
    for (const track of change.stopLoops) engine.stopTrack(track.trackId)
    for (const track of change.stopRandoms) engine.stopTrack(track.trackId)
    for (const track of change.startLoops) engine.startTrack(track)
    for (const track of change.startRandoms) engine.startTrack(track)
    for (const track of change.apply) engine.applyTrackParams(track)
  }
}

export function setDefaultMood(id) {
  const scene = store.activeScene
  if (!scene) return
  if (!scene.moods.some((mood) => mood.id === id)) return
  scene.defaultMoodId = id
  scheduleSave()
}

// ---------------------------------------------------------------------------
// Tracks

export function trackById(trackId) {
  return store.activeScene?.tracks.find((track) => track.id === trackId) || null
}

export function selectTrack(id, additive = false) {
  if (!id) {
    store.selectedTrackId = null
    store.selectedTrackIds = []
    return
  }
  if (additive) {
    const index = store.selectedTrackIds.indexOf(id)
    if (index >= 0) store.selectedTrackIds.splice(index, 1)
    else store.selectedTrackIds.push(id)
  } else {
    store.selectedTrackIds = [id]
  }
  store.selectedTrackId = id
  const track = trackById(id)
  if (track) ensureGroupSounds(track.groupId)
}

function moodRaw(id = store.selectedMoodId) {
  return store.activeScene?.moods.find((mood) => mood.id === id) || null
}

function findResolved(trackId) {
  return buildPlan(store.selectedMoodId).all.find((track) => track.trackId === trackId) || null
}

function updateMoodParam(trackId, patch, removeKeys = []) {
  const mood = moodRaw()
  if (!mood) return null
  const current = { ...(mood.params[trackId] || {}) }
  for (const key of removeKeys) delete current[key]
  Object.assign(current, patch)
  for (const key of Object.keys(current)) {
    if (current[key] === undefined) delete current[key]
  }
  if (Object.keys(current).length) mood.params[trackId] = current
  else delete mood.params[trackId]
  scheduleSave()
  return current
}

export async function addGroupsToScene(groupIds, kind, index) {
  const scene = store.activeScene
  if (!scene) return
  const ids = Array.isArray(groupIds) ? groupIds : [groupIds]
  const groups = []
  const seen = new Set()
  for (const id of ids) {
    if (!id || seen.has(id)) continue
    const group = groupById(id)
    if (!group) continue
    seen.add(id)
    groups.push(group)
  }
  if (!groups.length) return

  const override = KINDS.includes(kind) ? kind : undefined
  const before = new Set(scene.tracks.map((track) => track.id))
  let tracks = addTracksForGroups(scene.tracks, groups, override)
  const added = tracks.filter((track) => !before.has(track.id))
  if (override && Number.isInteger(index) && added.length) {
    tracks = moveTracks(
      tracks,
      added.map((track) => track.id),
      override,
      index
    )
  }
  scene.tracks = tracks
  await ensureSounds(groups.flatMap((group) => group.sounds))
  refreshWarnings()
  scheduleSave()
  setStatus(`Added ${groups.length} group(s) to the scene`)
}

export function removeTrack(trackId) {
  const scene = store.activeScene
  if (!scene) return
  const track = scene.tracks.find((item) => item.id === trackId)
  if (!track) return
  engine.stopTrack(trackId)
  scene.tracks = scene.tracks.filter((item) => item.id !== trackId)
  for (const mood of scene.moods) delete mood.params[trackId]
  scene.midi = removeBindingsForTargets(scene.midi, 'local', [
    { type: 'trackTrigger', trackId },
    { type: 'trackVolume', trackId },
  ])
  store.selectedTrackIds = store.selectedTrackIds.filter((id) => id !== trackId)
  if (store.selectedTrackId === trackId) store.selectedTrackId = null
  scheduleSave()
}

export function removeMissingTracks() {
  const scene = store.activeScene
  if (!scene) return 0
  const groups = groupsByIdMap()
  const missing = scene.tracks.filter((track) => !groups.has(track.groupId))
  if (!missing.length) return 0
  const ids = new Set(missing.map((track) => track.id))
  for (const id of ids) engine.stopTrack(id)
  scene.tracks = scene.tracks.filter((track) => !ids.has(track.id))
  for (const mood of scene.moods) {
    for (const id of ids) delete mood.params[id]
  }
  scene.midi = removeBindingsForTargets(
    scene.midi,
    'local',
    missing.flatMap((track) => [
      { type: 'trackTrigger', trackId: track.id },
      { type: 'trackVolume', trackId: track.id },
    ])
  )
  store.selectedTrackIds = store.selectedTrackIds.filter((id) => !ids.has(id))
  if (ids.has(store.selectedTrackId)) store.selectedTrackId = null
  scheduleSave()
  refreshWarnings()
  setStatus(`Removed ${ids.size} missing track(s)`)
  return ids.size
}

export function reorderTracks(movingIds, targetKind, targetIndex) {
  const scene = store.activeScene
  if (!scene || !KINDS.includes(targetKind)) return
  const ids = (Array.isArray(movingIds) ? movingIds : [movingIds]).filter(Boolean)
  if (!ids.length) return
  const current = scene.tracks
    .filter((track) => track.kind === targetKind)
    .sort((a, b) => a.order - b.order)
    .map((track) => track.id)
  const insertion = dropInsertionIndex(current, ids, targetIndex)
  scene.tracks = moveTracks(scene.tracks, ids, targetKind, insertion)
  if (store.transportRunning) {
    for (const id of ids) {
      const track = findResolved(id)
      if (!track) continue
      if (engine.isTrackActive(id)) engine.stopTrack(id)
      if (track.enabled && track.kind !== 'oneshot') engine.startTrack(track)
    }
  }
  scheduleSave()
}

export async function toggleTrack(trackId) {
  const scene = store.activeScene
  const track = scene?.tracks.find((item) => item.id === trackId)
  if (!track) return
  const group = groupById(track.groupId)
  if (group) await ensureSounds(group.sounds)
  const plan = buildPlan(store.selectedMoodId)
  const result = applyManualToggle(plan, trackId, engine.activeTrackIds())
  if (!result.track) return
  if (result.action === 'stop') engine.stopTrack(trackId)
  else engine.startTrack(result.track)
}

export function setTrackMoodEnabled(trackId, enabled) {
  updateMoodParam(trackId, { enabled: Boolean(enabled) })
  if (store.transportRunning) {
    const track = findResolved(trackId)
    if (track) {
      if (!enabled) engine.stopTrack(trackId)
      else if (track.kind !== 'oneshot' && !engine.isTrackActive(trackId)) {
        engine.startTrack(track)
      }
    }
  }
}

export function setTrackMoodGain(trackId, value) {
  updateMoodParam(trackId, { gain: clamp01(value) })
  const track = findResolved(trackId)
  if (track) engine.applyTrackParams(track)
}

export function setTrackMoodReverb(trackId, value) {
  updateMoodParam(trackId, { reverb: coerceReverb(value) })
  const track = findResolved(trackId)
  if (track) engine.applyTrackParams(track)
}

export function setTrackMoodPan(trackId, value) {
  updateMoodParam(trackId, { pan: clampPan(value) })
  const track = findResolved(trackId)
  if (track) engine.applyTrackParams(track)
}

export function setTrackMoodTrigger(trackId, value) {
  updateMoodParam(trackId, { trigger: triggerCopy(value) })
  const track = findResolved(trackId)
  if (track) engine.applyTrackParams(track)
}

export function resetTrackMoodOverride(trackId) {
  const mood = moodRaw()
  if (!mood) return
  delete mood.params[trackId]
  scheduleSave()
  const track = findResolved(trackId)
  if (track) engine.applyTrackParams(track)
}

export function clearTrackMoodField(trackId, field) {
  const mood = moodRaw()
  if (!mood) return
  const param = mood.params[trackId]
  if (!param) return
  delete param[field]
  if (!Object.keys(param).length) delete mood.params[trackId]
  scheduleSave()
  const track = findResolved(trackId)
  if (track) engine.applyTrackParams(track)
}

export function setTrackDefaultTrigger(trackId, value) {
  const track = trackById(trackId)
  if (!track) return
  track.trigger = track.kind === 'random' ? triggerCopy(value) : { ...ZERO_TRIGGER }
  scheduleSave()
  const resolved = findResolved(trackId)
  if (resolved) engine.applyTrackParams(resolved)
}

// ---------------------------------------------------------------------------
// Library groups

function applyLibrary(library) {
  if (!library) return
  store.library = library
  refreshWarnings()
}

function syncGroupVoices(groupId) {
  if (!store.transportRunning) return
  const plan = buildPlan(store.selectedMoodId)
  for (const track of plan.all) {
    if (track.groupId !== groupId) continue
    if (engine.isTrackActive(track.trackId)) engine.applyTrackParams(track)
  }
}

export async function createGroup(payload) {
  clearError()
  try {
    const data = await api('/api/groups', { method: 'POST', body: payload || {} })
    applyLibrary(data.library)
    await ensureSounds(data.group?.sounds || [])
    refreshWarnings()
    refreshStats()
    setStatus(`Created group "${data.group?.name || 'Group'}"`)
    return data.group
  } catch (err) {
    setError(err)
    return null
  }
}

export async function updateGroup(id, patch) {
  clearError()
  try {
    const data = await api(`/api/groups/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: patch || {},
    })
    applyLibrary(data.library)
    await ensureSounds(data.group?.sounds || [])
    refreshWarnings()
    syncGroupVoices(id)
    refreshStats()
    return data.group
  } catch (err) {
    setError(err)
    return null
  }
}

export async function deleteGroup(id) {
  clearError()
  try {
    const data = await api(`/api/groups/${encodeURIComponent(id)}`, { method: 'DELETE' })
    applyLibrary(data.library)
    if (data.global) applyGlobal(data.global)
    const scene = store.activeScene
    if (scene) {
      const removed = scene.tracks.filter((track) => track.groupId === id)
      if (removed.length) {
        for (const track of removed) engine.stopTrack(track.id)
        scene.tracks = scene.tracks.filter((track) => track.groupId !== id)
        for (const track of removed) {
          for (const mood of scene.moods) delete mood.params[track.id]
        }
        scene.midi = removeBindingsForTargets(
          scene.midi,
          'local',
          removed.flatMap((track) => [
            { type: 'trackTrigger', trackId: track.id },
            { type: 'trackVolume', trackId: track.id },
          ])
        )
        store.selectedTrackId = null
        store.selectedTrackIds = []
        scheduleSave()
      }
    }
    store.librarySelection = store.librarySelection.filter((groupId) => groupId !== id)
    refreshStats()
    refreshWarnings()
    setStatus('Group deleted')
  } catch (err) {
    setError(err)
  }
}

export async function mergeGroups(input) {
  clearError()
  try {
    const data = await api('/api/groups/merge', { method: 'POST', body: input || {} })
    applyLibrary(data.library)
    if (data.global) applyGlobal(data.global)
    const removed = new Set(data.removedIds || [])
    const scene = store.activeScene
    if (scene && removed.size && data.group) {
      let changed = false
      for (const track of scene.tracks) {
        if (!removed.has(track.groupId)) continue
        track.groupId = data.group.id
        changed = true
      }
      if (changed) {
        scheduleSave()
        syncGroupVoices(data.group.id)
      }
    }
    store.librarySelection = store.librarySelection.filter((id) => !removed.has(id))
    refreshStats()
    refreshWarnings()
    setStatus('Groups merged')
    return data.group
  } catch (err) {
    setError(err)
    return null
  }
}

export async function splitGroup(input) {
  clearError()
  try {
    const data = await api('/api/groups/split', { method: 'POST', body: input || {} })
    applyLibrary(data.library)
    await ensureSounds(data.group?.sounds || [])
    refreshWarnings()
    refreshStats()
    setStatus('Group split')
    return data.group
  } catch (err) {
    setError(err)
    return null
  }
}

export async function bulkUpdateGroups(ids, patch) {
  clearError()
  try {
    const data = await api('/api/groups/bulk', {
      method: 'POST',
      body: { ids, patch: patch || {} },
    })
    applyLibrary(data.library)
    for (const group of data.groups || []) syncGroupVoices(group.id)
    refreshStats()
    refreshWarnings()
    setStatus(`Updated ${data.groups?.length || 0} group(s)`)
    return data.groups || []
  } catch (err) {
    setError(err)
    return []
  }
}

export async function addGroupSounds(id, soundIds) {
  clearError()
  try {
    const data = await api(`/api/groups/${encodeURIComponent(id)}/sounds`, {
      method: 'POST',
      body: { soundIds },
    })
    applyLibrary(data.library)
    await ensureSounds(soundIds || [])
    refreshWarnings()
    syncGroupVoices(id)
    refreshStats()
    return data.group
  } catch (err) {
    setError(err)
    return null
  }
}

export async function removeGroupSounds(id, soundIds) {
  clearError()
  try {
    const data = await api(`/api/groups/${encodeURIComponent(id)}/sounds/remove`, {
      method: 'POST',
      body: { soundIds },
    })
    applyLibrary(data.library)
    syncGroupVoices(id)
    refreshWarnings()
    refreshStats()
    return data.group
  } catch (err) {
    setError(err)
    return null
  }
}

export async function createGroupsFromSelectedSounds(payload) {
  clearError()
  try {
    const data = await api('/api/groups/from-sounds', { method: 'POST', body: payload || {} })
    applyLibrary(data.library)
    await ensureSounds(data.group?.sounds || [])
    refreshWarnings()
    refreshStats()
    setStatus(`Created group "${data.group?.name || 'Group'}"`)
    return data.group
  } catch (err) {
    setError(err)
    return null
  }
}

export function openGroupEditor(id) {
  store.editingGroupId = id || null
}

export function closeGroupEditor() {
  store.editingGroupId = null
}

// ---------------------------------------------------------------------------
// Palette

export function addToPalette(groupId, label = '') {
  const group = groupById(groupId)
  if (!group) return null
  if (store.global.palette.some((entry) => entry.groupId === groupId)) {
    setStatus(`"${group.name}" is already in the palette`, 'error')
    return null
  }
  const entry = {
    id: uid(),
    groupId,
    label: String(label || ''),
    gain: null,
    order: store.global.palette.length,
  }
  store.global.palette.push(entry)
  persistGlobalNow()
  ensureSounds(group.sounds).then(refreshWarnings)
  setStatus(`Added "${group.name}" to the palette`)
  return entry
}

export function removeFromPalette(paletteId) {
  const index = store.global.palette.findIndex((entry) => entry.id === paletteId)
  if (index < 0) return
  engine.stopPalette(paletteId)
  store.global.palette.splice(index, 1)
  store.global.palette.forEach((entry, order) => {
    entry.order = order
  })
  store.global.midi = removeBindingsForTargets(store.global.midi, 'global', [
    { type: 'paletteTrigger', paletteId },
    { type: 'paletteVolume', paletteId },
  ])
  persistGlobalNow()
}

export function setPaletteGain(paletteId, value) {
  const entry = store.global.palette.find((item) => item.id === paletteId)
  if (!entry) return
  entry.gain = clamp01(value)
  engine.setPaletteGain(paletteId, entry.gain)
  scheduleGlobalSave()
}

export function setPaletteLabel(paletteId, label) {
  const entry = store.global.palette.find((item) => item.id === paletteId)
  if (!entry) return
  entry.label = String(label || '')
  scheduleGlobalSave()
}

export function reorderPalette(orderedIds) {
  const ids = Array.isArray(orderedIds) ? orderedIds : []
  const byId = new Map(store.global.palette.map((entry) => [entry.id, entry]))
  const next = []
  for (const id of ids) {
    const entry = byId.get(id)
    if (entry) {
      next.push(entry)
      byId.delete(id)
    }
  }
  next.push(...byId.values())
  next.forEach((entry, index) => {
    entry.order = index
  })
  store.global.palette = next
  scheduleGlobalSave()
}

export function movePalette(paletteId, delta) {
  const sorted = [...store.global.palette].sort(
    (a, b) => (a.order ?? 0) - (b.order ?? 0)
  )
  const index = sorted.findIndex((entry) => entry.id === paletteId)
  if (index < 0) return
  const target = Math.min(sorted.length - 1, Math.max(0, index + delta))
  if (target === index) return
  const [entry] = sorted.splice(index, 1)
  sorted.splice(target, 0, entry)
  reorderPalette(sorted.map((item) => item.id))
}

export async function triggerPalette(paletteId) {
  const entry = paletteEntries.value.find((item) => item.id === paletteId)
  if (!entry) return
  if (!entry.valid) {
    setStatus(`Palette item "${entry.label || entry.groupName || paletteId}" is missing its group`, 'error')
    return
  }
  if (engine.isPaletteActive(paletteId)) {
    engine.stopPalette(paletteId)
    return
  }
  await ensureSounds(entry.sounds)
  const fresh = paletteEntries.value.find((item) => item.id === paletteId)
  if (!fresh) return
  engine.triggerPalette({
    paletteId,
    kind: nextPaletteKind(fresh.group),
    label: fresh.label || fresh.groupName,
    groupName: fresh.groupName,
    soundData: fresh.soundData,
    sounds: fresh.sounds,
    selection: fresh.selection,
    gain: fresh.gain,
    reverb: fresh.reverb,
    pan: fresh.pan,
    trigger: fresh.trigger,
  })
}

// ---------------------------------------------------------------------------
// Transport / volumes

let transportGeneration = 0

export async function play() {
  const scene = store.activeScene
  if (!scene) return
  const generation = ++transportGeneration
  store.transportRunning = true
  engine.unlock()
  await ensureSceneSounds(scene)
  if (generation !== transportGeneration || store.activeScene?.id !== scene.id) return
  const plan = buildPlan(store.selectedMoodId)
  const initial = initialTransportPlan(plan)
  engine.stopScene()
  let started = 0
  for (const track of initial.startLoops) if (engine.startTrack(track)) started += 1
  for (const track of initial.startRandoms) if (engine.startTrack(track)) started += 1
  if (started === 0) {
    store.transportRunning = false
    if (initial.startLoops.length + initial.startRandoms.length === 0) {
      setStatus('This mood has no enabled loops or random tracks', 'error')
    }
  }
}

export function stop() {
  transportGeneration += 1
  engine.stopScene()
  store.transportRunning = false
}

export function toggleTransport() {
  if (store.transportRunning) stop()
  else play()
}

export function stopAll() {
  transportGeneration += 1
  engine.stopAll()
  store.transportRunning = false
  setStatus('Stopped all playback')
}

export function setMaster(value) {
  store.master = clamp01(value)
  store.global.master = store.master
  engine.setMaster(store.master)
  scheduleGlobalSave()
}

export function setBus(bus, value) {
  if (!KINDS.includes(bus)) return
  const next = clamp01(value)
  store.buses = { ...store.buses, [bus]: next }
  store.global.buses = { ...store.global.buses, [bus]: next }
  engine.setBus(bus, next)
  scheduleGlobalSave()
}

export function setMode(mode) {
  store.mode = mode === 'perform' ? 'perform' : 'edit'
  if (store.mode === 'perform') store.view = 'editor'
}

// ---------------------------------------------------------------------------
// MIDI bindings

function keyAction(midi, key) {
  const parsed = parseBindingKey(key)
  if (!parsed) return null
  const canonical = bindingKey(parsed.channel, parsed.type, parsed.number)
  const mapName = parsed.type === 'note' ? 'notes' : 'ccs'
  return midi?.[mapName]?.[canonical] || null
}

function withoutKey(midi, key) {
  const parsed = parseBindingKey(key)
  if (!parsed) return midi
  const canonical = bindingKey(parsed.channel, parsed.type, parsed.number)
  const notes = { ...(midi?.notes || {}) }
  const ccs = { ...(midi?.ccs || {}) }
  delete notes[canonical]
  delete ccs[canonical]
  return { notes, ccs }
}

export function beginLearn(scope, action) {
  const normalized = normalizeMidiAction(action, scope)
  if (!normalized) {
    setStatus('That control cannot be bound', 'error')
    return
  }
  if (scope === 'local' && !store.activeScene) {
    setStatus('Open a scene before learning a local binding', 'error')
    return
  }
  store.learning = { scope, action: normalized }
  setStatus(`Learning ${actionLabel(normalized)} — move a note or knob (Escape to cancel)`)
}

export function cancelLearn() {
  store.learning = null
  store.collision = null
}

export function isLearning(scope, action) {
  if (!store.learning) return false
  return store.learning.scope === scope && sameTarget(store.learning.action, action)
}

export async function receiveLearnedKey(scope, action, key) {
  const normalized = normalizeMidiAction(action, scope)
  if (!normalized) return
  const parsed = parseBindingKey(key)
  if (!parsed) return
  const expected = actionChannelType(normalized)
  if (parsed.type !== expected) {
    setStatus(
      `${normalized.type} needs a ${expected === 'cc' ? 'CC knob' : 'note key'}, got a ${parsed.type === 'cc' ? 'CC' : 'note'}`,
      'error'
    )
    return
  }
  const canonical = bindingKey(parsed.channel, parsed.type, parsed.number)

  if (scope === 'local') {
    if (!store.activeScene) return
    const existing = keyAction(store.global.midi, canonical)
    if (existing) {
      store.collision = {
        scope: 'local',
        key: canonical,
        action: normalized,
        globalAction: existing,
        scenes: [],
      }
      return
    }
  } else {
    let overview = null
    try {
      overview = await api('/api/bindings')
      store.bindingsOverview = overview
    } catch (err) {
      setError(err)
      return
    }
    const scenes = []
    for (const scene of overview?.scenes || []) {
      const action = keyAction(scene.midi, canonical)
      if (action) scenes.push({ sceneId: scene.sceneId, name: scene.name, action })
    }
    if (scenes.length) {
      store.collision = {
        scope: 'global',
        key: canonical,
        action: normalized,
        globalAction: null,
        scenes,
      }
      return
    }
  }

  await applyBinding(scope, normalized, canonical)
}

async function applyBinding(scope, action, key) {
  if (scope === 'local') {
    if (!store.activeScene) return
    store.activeScene.midi = setBinding(store.activeScene.midi, 'local', key, action)
    store.learning = null
    await flushSave()
    setStatus(`Bound ${actionLabel(action)} locally`)
  } else {
    store.global.midi = setBinding(store.global.midi, 'global', key, action)
    store.learning = null
    await persistGlobalNow()
    setStatus(`Bound ${actionLabel(action)} globally`)
  }
  refreshWarnings()
}

export async function confirmCollision() {
  const collision = store.collision
  if (!collision) return
  store.collision = null

  if (collision.scope === 'local') {
    store.global.midi = withoutKey(store.global.midi, collision.key)
    await persistGlobalNow()
    await applyBinding('local', collision.action, collision.key)
    return
  }

  for (const item of collision.scenes || []) {
    if (store.activeScene?.id === item.sceneId) {
      store.activeScene.midi = withoutKey(store.activeScene.midi, collision.key)
      await flushSave()
      continue
    }
    try {
      const scene = await api(`/api/scenes/${encodeURIComponent(item.sceneId)}`)
      scene.midi = withoutKey(scene.midi, collision.key)
      await api(`/api/scenes/${encodeURIComponent(item.sceneId)}`, {
        method: 'PUT',
        body: JSON.stringify(scene),
      })
    } catch (err) {
      setError(err)
    }
  }
  await applyBinding('global', collision.action, collision.key)
}

export function cancelCollision() {
  store.collision = null
  setStatus('Binding replacement cancelled')
}

export async function removeBinding(scope, key) {
  if (scope === 'local') {
    if (!store.activeScene) return
    store.activeScene.midi = withoutKey(store.activeScene.midi, key)
    await flushSave()
  } else {
    store.global.midi = withoutKey(store.global.midi, key)
    await persistGlobalNow()
  }
  setStatus('Binding removed')
}

export function bindingRows(scope) {
  const midi = scope === 'local' ? store.activeScene?.midi : store.global.midi
  const rows = []
  for (const mapName of ['notes', 'ccs']) {
    for (const [key, action] of Object.entries(midi?.[mapName] || {})) {
      rows.push({ scope, key, action, map: mapName, label: actionLabel(action) })
    }
  }
  return rows.sort((a, b) => a.key.localeCompare(b.key))
}

export function trackHasMidi(trackId) {
  if (!store.activeScene) return false
  return bindingRows('local').some(
    (row) => row.action.type === 'trackTrigger' && row.action.trackId === trackId
  )
}

export function trackVolumeHasMidi(trackId) {
  if (!store.activeScene) return false
  return bindingRows('local').some(
    (row) => row.action.type === 'trackVolume' && row.action.trackId === trackId
  )
}

export function bindingKeyFor(scope, action) {
  const row = bindingRows(scope).find((item) => sameTarget(item.action, action))
  return row?.key || ''
}

export function trackBindingKey(trackId, type = 'trigger') {
  const action =
    type === 'volume'
      ? { type: 'trackVolume', trackId }
      : { type: 'trackTrigger', trackId }
  return bindingKeyFor('local', action)
}

export function moodBindingKey(moodId) {
  return bindingKeyFor('local', { type: 'moodSelect', moodId })
}

export function openMidiPanel() {
  store.showMidiPanel = true
}

export function closeMidiPanel() {
  store.showMidiPanel = false
}

export function toggleMidiPanel() {
  store.showMidiPanel = !store.showMidiPanel
}

export function keyLabel(key) {
  const parsed = parseBindingKey(key)
  if (!parsed) return key
  const channel = parsed.channel + 1
  return parsed.type === 'cc'
    ? `Ch ${channel} · CC ${parsed.number}`
    : `Ch ${channel} · Note ${parsed.number}`
}

export function actionLabel(action) {
  if (!action) return 'Nothing'
  switch (action.type) {
    case 'stopAll':
      return 'Stop all'
    case 'masterVolume':
      return 'Master volume'
    case 'busVolume':
      return `Bus volume: ${action.bus === 'loop' ? 'Loops' : action.bus === 'random' ? 'Random' : 'One-shots'}`
    case 'paletteTrigger': {
      const entry = store.global.palette.find((item) => item.id === action.paletteId)
      const group = entry ? groupById(entry.groupId) : null
      return `Palette trigger: ${entry?.label || group?.name || action.paletteId}`
    }
    case 'paletteVolume': {
      const entry = store.global.palette.find((item) => item.id === action.paletteId)
      const group = entry ? groupById(entry.groupId) : null
      return `Palette volume: ${entry?.label || group?.name || action.paletteId}`
    }
    case 'openScene': {
      const scene = store.scenes.find((item) => item.id === action.sceneId)
      return `Open scene: ${scene?.name || action.sceneId}`
    }
    case 'trackTrigger': {
      const track = trackById(action.trackId)
      const group = track ? groupById(track.groupId) : null
      return `Track trigger: ${group?.name || action.trackId}`
    }
    case 'trackVolume': {
      const track = trackById(action.trackId)
      const group = track ? groupById(track.groupId) : null
      return `Track volume: ${group?.name || action.trackId}`
    }
    case 'moodSelect': {
      const mood = store.activeScene?.moods.find((item) => item.id === action.moodId)
      return `Mood: ${mood?.name || action.moodId}`
    }
    case 'sceneToggle':
      return 'Play/stop active scene'
    default:
      return action.type
  }
}

export function actionTargetKey(action) {
  return targetKey(action)
}

// ---------------------------------------------------------------------------
// Import / curation

export async function refreshStats() {
  try {
    const data = await api('/api/catalog/stats')
    store.stats = data || store.stats
    store.catalogCount = data?.total ?? store.catalogCount
    store.importDone = Boolean(data?.importDone)
  } catch (err) {
    setError(err)
  }
}

export async function loadStats() {
  return refreshStats()
}

export function openImport() {
  store.view = 'import'
  store.browserTab = 'import'
  refreshStats()
}

export function closeImport() {
  store.view = 'editor'
  store.browserTab = 'scenes'
}

export async function searchCatalogPage(patch = {}) {
  const imp = store.import
  if (patch && typeof patch === 'object') {
    if (patch.query !== undefined) imp.query = patch.query
    if (patch.unassigned !== undefined) imp.unassigned = Boolean(patch.unassigned)
    if (patch.kind !== undefined) imp.kind = patch.kind
    if (patch.category !== undefined) imp.category = patch.category
    if (patch.tag !== undefined) imp.tag = patch.tag
    if (patch.offset !== undefined) imp.offset = Math.max(0, Number(patch.offset) || 0)
    if (patch.limit !== undefined) imp.limit = Math.max(1, Math.min(200, Number(patch.limit) || 50))
  }
  const params = new URLSearchParams()
  if (imp.query) params.set('query', imp.query)
  if (imp.unassigned) params.set('unassigned', 'true')
  if (imp.kind) params.set('kind', imp.kind)
  if (imp.category) params.set('category', imp.category)
  if (imp.tag) params.set('tag', imp.tag)
  params.set('offset', String(imp.offset))
  params.set('limit', String(imp.limit))
  imp.loading = true
  imp.error = ''
  try {
    const data = await api(`/api/catalog?${params.toString()}`)
    imp.sounds = Array.isArray(data?.sounds) ? data.sounds : []
    imp.total = Number(data?.total) || 0
  } catch (err) {
    imp.error = messageFor(err)
    setError(err)
  } finally {
    imp.loading = false
  }
}

export function setImportFilters(patch) {
  store.import.offset = 0
  return searchCatalogPage(patch)
}

export function importPage(delta) {
  const imp = store.import
  const next = Math.max(0, imp.offset + delta * imp.limit)
  return searchCatalogPage({ offset: next })
}

export function toggleImportSound(id) {
  const list = store.import.selectedSoundIds
  const index = list.indexOf(id)
  if (index >= 0) list.splice(index, 1)
  else list.push(id)
}

export function clearImportSoundSelection() {
  store.import.selectedSoundIds = []
}

export function toggleImportGroup(id) {
  const list = store.import.selectedGroupIds
  const index = list.indexOf(id)
  if (index >= 0) list.splice(index, 1)
  else list.push(id)
}

export function clearImportGroupSelection() {
  store.import.selectedGroupIds = []
}

export function setSplitGroup(groupId) {
  store.import.splitGroupId = groupId || ''
  store.import.splitSoundIds = []
}

export function toggleSplitSound(id) {
  const list = store.import.splitSoundIds
  const index = list.indexOf(id)
  if (index >= 0) list.splice(index, 1)
  else list.push(id)
}

export async function createGroupFromSelection(form = {}) {
  const soundIds = [...store.import.selectedSoundIds]
  if (!soundIds.length) {
    setStatus('Select at least one sound first', 'error')
    return null
  }
  const group = await createGroupsFromSelectedSounds({
    soundIds,
    name: form.name,
    category: form.category,
    tags: form.tags,
    selection: form.selection,
    defaultKind: form.defaultKind,
    defaults: form.defaults,
  })
  if (group) {
    clearImportSoundSelection()
    await searchCatalogPage()
  }
  return group
}

export async function addSelectedSoundsToGroup(groupId) {
  const soundIds = [...store.import.selectedSoundIds]
  if (!soundIds.length) {
    setStatus('Select at least one sound first', 'error')
    return null
  }
  const group = await addGroupSounds(groupId, soundIds)
  if (group) {
    clearImportSoundSelection()
    await searchCatalogPage()
  }
  return group
}

export async function bulkEditSelectedGroups(patch) {
  const ids = [...store.import.selectedGroupIds]
  if (!ids.length) {
    setStatus('Select at least one group first', 'error')
    return []
  }
  return bulkUpdateGroups(ids, patch)
}

export async function mergeSelectedGroups(extra = {}) {
  const ids = [...store.import.selectedGroupIds]
  if (ids.length < 2) {
    setStatus('Select at least two groups to merge', 'error')
    return null
  }
  const group = await mergeGroups({ groupIds: ids, ...extra })
  if (group) clearImportGroupSelection()
  return group
}

export async function splitSelectedGroupSounds(name) {
  const groupId = store.import.splitGroupId
  const soundIds = [...store.import.splitSoundIds]
  if (!groupId || !soundIds.length) {
    setStatus('Pick a group and at least one of its sounds to split', 'error')
    return null
  }
  const group = await splitGroup({ groupId, soundIds, name })
  if (group) {
    store.import.splitSoundIds = []
    await searchCatalogPage()
  }
  return group
}

export async function finishImport(done = true) {
  try {
    const data = await api('/api/import/done', { method: 'POST', body: { done } })
    store.importDone = Boolean(data?.done)
    store.stats = { ...store.stats, importDone: store.importDone }
    if (store.importDone) {
      store.view = 'editor'
      store.browserTab = 'scenes'
    }
    setStatus(store.importDone ? 'Migration marked complete' : 'Migration reopened')
  } catch (err) {
    setError(err)
  }
}

export function previewSound(sound) {
  if (!sound) return
  engine.preview(soundUrl(sound), sound.id)
}

export function stopPreview() {
  engine.stopPreview()
}

// Engine callbacks -----------------------------------------------------------

async function persistDuration(soundId, duration) {
  if (!soundId || !Number.isFinite(duration) || duration <= 0) return
  const existing = store.soundsById[soundId]
  if (existing) existing.duration = duration
  try {
    const data = await api(`/api/sounds/${encodeURIComponent(soundId)}/duration`, {
      method: 'POST',
      body: { duration },
    })
    if (data?.sound) {
      store.soundsById[soundId] = {
        ...store.soundsById[soundId],
        ...data.sound,
        url: soundUrl(data.sound),
      }
    }
  } catch {
    /* duration persistence is best-effort */
  }
}

engine.configure({
  onDuration: persistDuration,
  onError: (message) => setStatus(message, 'error'),
})

// Input adapters (Web MIDI and touch/keyboard controls) dispatch actions against
// this facade so every input path shares the same store methods.
Object.assign(store, {
  stopAll,
  setMaster,
  setBus,
  triggerPalette,
  setPaletteGain,
  openScene,
  toggleTrack,
  setTrackMoodGain,
  selectMood,
  toggleTransport,
  receiveLearnedKey,
})

export { engine, REVERB_PRESETS, KINDS }
