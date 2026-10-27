// v3 store: owns the in-memory catalog/library/global/scenes and persists them.
//
// Construction performs no I/O. Call `await store.init()` before using getters.
// All writes are atomic and serialized per target file.

import fs from 'node:fs/promises'
import path from 'node:path'

import {
  VERSION,
  defaultCatalog,
  defaultGlobal,
  defaultLibrary,
  newScene,
  normalizeCatalog,
  normalizeGlobal,
  normalizeGroup,
  normalizeLibrary,
  normalizeScene,
  normalizeTags,
  uid,
} from './schema.js'
import {
  addSoundToCatalog,
  findSound,
  searchCatalog,
  setSoundDuration as setCatalogSoundDuration,
  stats as catalogStats,
} from './catalog.js'
import { cleanupBindings, findConflicts } from './bindings.js'
import {
  catalogPath,
  ensureDirs,
  globalPath,
  importDonePath,
  libraryPath,
  scenePath,
  writeJsonAtomic,
} from './storage.js'

const isObj = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)
const hasOwn = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key)

export class StoreError extends Error {
  constructor(code, message, extra = {}) {
    super(message)
    this.name = 'StoreError'
    this.code = code
    Object.assign(this, extra)
  }
}

export class ValidationError extends StoreError {
  constructor(message = 'Validation failed', errors = [], extra = {}) {
    super('validation', message, { errors, ...extra })
    this.name = 'ValidationError'
  }
}

export class NotFoundError extends StoreError {
  constructor(message = 'Not found', extra = {}) {
    super('not-found', message, extra)
    this.name = 'NotFoundError'
  }
}

export class ConflictError extends StoreError {
  constructor(message = 'Conflict', extra = {}) {
    super('conflict', message, extra)
    this.name = 'ConflictError'
  }
}

export function createError(code, message, extra = {}) {
  return new StoreError(code, message, extra)
}

function idList(value) {
  if (!Array.isArray(value)) return []
  const out = []
  const seen = new Set()
  for (const raw of value) {
    if (typeof raw !== 'string') continue
    const id = raw.trim()
    if (!id || seen.has(id)) continue
    seen.add(id)
    out.push(id)
  }
  return out
}

function requireIdArray(value, field) {
  if (!Array.isArray(value)) {
    throw new ValidationError(`${field} must be an array`, [{ type: 'invalid-input', field }])
  }
  return idList(value)
}

function sceneIdError(id) {
  return createError('invalid-path', `Invalid scene id: ${id}`)
}

function assertSceneId(id) {
  if (
    typeof id !== 'string' ||
    !id.trim() ||
    id === '.' ||
    id === '..' ||
    id.includes('/') ||
    id.includes('\\') ||
    id.includes('\0')
  ) {
    throw sceneIdError(id)
  }
}

export function createStore({ dataDir, soundsDir } = {}) {
  if (!dataDir || !soundsDir) throw new Error('createStore requires dataDir and soundsDir')

  const rootDataDir = path.resolve(dataDir)
  const rootSoundsDir = path.resolve(soundsDir)
  const scenesDir = path.join(rootDataDir, 'scenes')
  const markerPath = importDonePath(rootDataDir)

  const state = {
    catalog: null,
    library: null,
    global: null,
    scenes: new Map(),
    importDone: false,
    warnings: [],
    initialized: false,
  }

  const writeQueues = new Map()

  function enqueue(file, task) {
    const previous = writeQueues.get(file) || Promise.resolve()
    const next = previous.catch(() => {}).then(task)
    writeQueues.set(file, next)
    next
      .finally(() => {
        if (writeQueues.get(file) === next) writeQueues.delete(file)
      })
      .catch(() => {})
    return next
  }

  function persist(file, value) {
    return enqueue(file, () => writeJsonAtomic(file, value))
  }

  async function loadJsonFile(file) {
    try {
      const text = await fs.readFile(file, 'utf8')
      return { exists: true, value: JSON.parse(text) }
    } catch (err) {
      if (err?.code === 'ENOENT') return { exists: false, value: undefined }
      return { exists: true, value: undefined, corrupt: true, error: err }
    }
  }

  function normalizeMaster(raw, normalizer, fallback, file, label) {
    try {
      return normalizer(raw)
    } catch (err) {
      state.warnings.push({ type: 'invalid-json', file, label, message: err.message })
      return fallback()
    }
  }

  async function init() {
    if (state.initialized) return store
    await ensureDirs(rootDataDir, scenesDir, rootSoundsDir)

    const catalogFile = catalogPath(rootDataDir)
    const catalogLoaded = await loadJsonFile(catalogFile)
    if (!catalogLoaded.exists) {
      state.catalog = defaultCatalog()
      await writeJsonAtomic(catalogFile, state.catalog)
    } else if (catalogLoaded.corrupt) {
      state.catalog = defaultCatalog()
      state.warnings.push({
        type: 'corrupt-json',
        file: catalogFile,
        label: 'catalog',
        message: catalogLoaded.error?.message,
      })
    } else {
      state.catalog = normalizeMaster(
        catalogLoaded.value,
        normalizeCatalog,
        defaultCatalog,
        catalogFile,
        'catalog'
      )
    }

    const libraryFile = libraryPath(rootDataDir)
    const libraryLoaded = await loadJsonFile(libraryFile)
    if (!libraryLoaded.exists) {
      state.library = defaultLibrary()
      await writeJsonAtomic(libraryFile, state.library)
    } else if (libraryLoaded.corrupt) {
      state.library = defaultLibrary()
      state.warnings.push({
        type: 'corrupt-json',
        file: libraryFile,
        label: 'library',
        message: libraryLoaded.error?.message,
      })
    } else {
      state.library = normalizeMaster(
        libraryLoaded.value,
        normalizeLibrary,
        defaultLibrary,
        libraryFile,
        'library'
      )
    }

    const globalFile = globalPath(rootDataDir)
    const globalLoaded = await loadJsonFile(globalFile)
    if (!globalLoaded.exists) {
      state.global = defaultGlobal()
      await writeJsonAtomic(globalFile, state.global)
    } else if (globalLoaded.corrupt) {
      state.global = defaultGlobal()
      state.warnings.push({
        type: 'corrupt-json',
        file: globalFile,
        label: 'global',
        message: globalLoaded.error?.message,
      })
    } else {
      state.global = normalizeMaster(
        globalLoaded.value,
        normalizeGlobal,
        defaultGlobal,
        globalFile,
        'global'
      )
    }

    try {
      await fs.access(markerPath)
      state.importDone = true
    } catch {
      state.importDone = false
    }

    state.scenes.clear()
    let entries = []
    try {
      entries = await fs.readdir(scenesDir, { withFileTypes: true })
    } catch (err) {
      state.warnings.push({ type: 'scenes-read-error', file: scenesDir, message: err.message })
    }

    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.json')) continue
      const id = entry.name.slice(0, -'.json'.length)
      const file = path.join(scenesDir, entry.name)
      const loaded = await loadJsonFile(file)
      if (loaded.corrupt || !isObj(loaded.value)) {
        state.warnings.push({
          type: 'corrupt-scene',
          id,
          file,
          message: loaded.error?.message,
        })
        continue
      }
      try {
        const scene = normalizeScene({ ...loaded.value, id })
        state.scenes.set(id, scene)
      } catch (err) {
        state.warnings.push({ type: 'invalid-scene', id, file, message: err.message })
      }
    }

    state.initialized = true
    return store
  }

  function catalog() {
    return state.catalog
  }

  function library() {
    return state.library
  }

  function global() {
    return state.global
  }

  function scene(id) {
    if (typeof id !== 'string') return null
    return state.scenes.get(id) || null
  }

  function sortScenes(scenes) {
    return scenes.slice().sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id))
  }

  function allScenes() {
    return sortScenes(Array.from(state.scenes.values()))
  }

  function listScenes() {
    return allScenes().map((item) => ({
      id: item.id,
      name: item.name,
      disabled: item.disabled,
      trackCount: item.tracks.length,
      moodCount: item.moods.length,
      defaultMoodId: item.defaultMoodId,
    }))
  }

  function bindingsOverview() {
    const scenes = allScenes()
    const conflicts = []
    for (const scene of scenes) {
      for (const conflict of findConflicts(state.global.midi, scene.midi)) {
        conflicts.push({ sceneId: scene.id, ...conflict })
      }
    }
    conflicts.sort(
      (a, b) =>
        (a.key < b.key ? -1 : a.key > b.key ? 1 : 0) ||
        a.sceneId.localeCompare(b.sceneId)
    )
    return {
      global: state.global.midi,
      scenes: scenes.map((scene) => ({
        sceneId: scene.id,
        name: scene.name,
        midi: scene.midi,
      })),
      conflicts,
    }
  }

  function importDone() {
    return state.importDone
  }

  function warnings() {
    return state.warnings.slice()
  }

  function stats() {
    return catalogStats(state.catalog, state.library, state.importDone)
  }

  function assignmentsForLibrary() {
    const map = new Map()
    for (const group of state.library.groups) {
      for (const soundId of group.sounds) {
        if (!map.has(soundId)) map.set(soundId, [])
        map.get(soundId).push(group)
      }
    }
    return map
  }

  function lookupSounds(ids) {
    if (!Array.isArray(ids)) return []
    const seen = new Set()
    const out = []
    for (const id of ids) {
      if (typeof id !== 'string' || seen.has(id)) continue
      seen.add(id)
      const sound = findSound(state.catalog, id)
      if (sound) out.push(sound)
    }
    return out
  }

  function searchSounds(options = {}) {
    const opts = isObj(options) ? options : {}
    return searchCatalog(state.catalog, {
      ...opts,
      assignedIds: opts.assignedIds ?? assignmentsForLibrary(),
    })
  }

  async function setSoundDuration(soundId, duration) {
    const numeric = typeof duration === 'number' ? duration : Number(duration)
    if (!Number.isFinite(numeric) || numeric <= 0) {
      throw new ValidationError('Duration must be a finite number greater than 0', [
        { type: 'invalid-duration', duration },
      ])
    }
    if (!findSound(state.catalog, soundId)) return null
    state.catalog = setCatalogSoundDuration(state.catalog, soundId, numeric)
    await persist(catalogPath(rootDataDir), state.catalog)
    return findSound(state.catalog, soundId)
  }

  async function addSounds(soundRecords) {
    const list = Array.isArray(soundRecords) ? soundRecords : []
    let catalog = state.catalog
    let added = 0
    let existing = 0

    for (const record of list) {
      const result = addSoundToCatalog(catalog, record)
      catalog = result.catalog
      if (result.added) added += 1
      else existing += 1
    }

    if (added > 0) {
      state.catalog = normalizeCatalog(catalog)
      await persist(catalogPath(rootDataDir), state.catalog)
    }
    return { catalog: state.catalog, added, existing }
  }

  async function saveCatalog(raw) {
    state.catalog = normalizeCatalog(raw)
    await persist(catalogPath(rootDataDir), state.catalog)
    return state.catalog
  }

  async function saveGlobal(raw) {
    state.global = normalizeGlobal(cleanRawGlobalMidi(raw))
    pruneGlobalBindings()
    await persist(globalPath(rootDataDir), state.global)
    return state.global
  }

  async function saveLibrary(raw) {
    let normalized
    try {
      normalized = normalizeLibrary(raw)
    } catch (err) {
      throw new ValidationError(err.message, [{ type: 'invalid-library' }])
    }
    state.library = normalized
    await persist(libraryPath(rootDataDir), state.library)
    return state.library
  }

  function findGroup(id) {
    return state.library.groups.find((group) => group.id === id) || null
  }

  function requireGroup(id) {
    const group = findGroup(id)
    if (!group) throw new NotFoundError(`Group not found: ${id}`, { groupId: id })
    return group
  }

  function validateSoundIds(ids) {
    const list = idList(ids)
    const missing = list.filter((id) => !findSound(state.catalog, id))
    if (missing.length) {
      throw new ValidationError(`Unknown sound ids: ${missing.join(', ')}`, [
        ...missing.map((soundId) => ({ type: 'missing-sound', soundId })),
      ])
    }
    return list
  }

  function replaceGroup(group) {
    state.library = {
      ...state.library,
      version: VERSION,
      groups: state.library.groups.map((candidate) =>
        candidate.id === group.id ? group : candidate
      ),
    }
  }

  function persistLibrary() {
    return persist(libraryPath(rootDataDir), state.library)
  }

  function persistGlobal() {
    return persist(globalPath(rootDataDir), state.global)
  }

  function prunePaletteForGroups(groupIds) {
    const removed = new Set(groupIds)
    if (!removed.size) return 0
    const before = state.global.palette.length
    const palette = state.global.palette.filter((entry) => !removed.has(entry.groupId))
    if (palette.length === before) return 0
    state.global = { ...state.global, palette }
    return before - palette.length
  }

  function midiBindingCount(midi) {
    return (
      Object.keys(isObj(midi?.notes) ? midi.notes : {}).length +
      Object.keys(isObj(midi?.ccs) ? midi.ccs : {}).length
    )
  }

  function cleanGlobalMidi(midi) {
    const paletteIds = new Set(state.global.palette.map((entry) => entry.id))
    const groupIds = new Set(state.library.groups.map((group) => group.id))
    return cleanupBindings(midi, 'global', (action) => {
      if (action.type === 'paletteTrigger' || action.type === 'paletteVolume') {
        return !paletteIds.has(action.paletteId)
      }
      if (action.groupId && !groupIds.has(action.groupId)) return true
      return false
    })
  }

  function pruneGlobalBindings() {
    const before = midiBindingCount(state.global.midi)
    const midi = cleanGlobalMidi(state.global.midi)
    const after = midiBindingCount(midi)
    if (after === before) return 0
    state.global = { ...state.global, midi }
    return before - after
  }

  function cleanRawGlobalMidi(raw) {
    const source = isObj(raw) ? raw : {}
    const rawPalette = Array.isArray(source.palette) ? source.palette : []
    const paletteIds = new Set(
      rawPalette
        .filter((entry) => isObj(entry) && typeof entry.id === 'string' && entry.id)
        .map((entry) => entry.id)
    )
    const groupIds = new Set(state.library.groups.map((group) => group.id))
    const midi = isObj(source.midi) ? source.midi : {}
    const out = { notes: {}, ccs: {} }

    for (const mapName of ['notes', 'ccs']) {
      const bindings = isObj(midi[mapName]) ? midi[mapName] : {}
      for (const [key, action] of Object.entries(bindings)) {
        if (isObj(action)) {
          if (
            (action.type === 'paletteTrigger' || action.type === 'paletteVolume') &&
            !paletteIds.has(action.paletteId)
          ) {
            continue
          }
          if (action.groupId && !groupIds.has(action.groupId)) continue
        }
        out[mapName][key] = action
      }
    }

    return { ...source, midi: out }
  }

  function cleanSceneMidi(scene) {
    const trackIds = new Set(scene.tracks.map((track) => track.id))
    const moodIds = new Set(scene.moods.map((mood) => mood.id))
    return cleanupBindings(scene.midi, 'local', (action) => {
      if (action.type === 'trackTrigger' || action.type === 'trackVolume') {
        return !trackIds.has(action.trackId)
      }
      if (action.type === 'moodSelect') return !moodIds.has(action.moodId)
      return false
    })
  }

  async function createGroup(raw) {
    let group
    try {
      group = normalizeGroup({ ...(isObj(raw) ? raw : {}), id: isObj(raw) ? raw.id : undefined })
    } catch (err) {
      throw new ValidationError(err.message, [{ type: 'invalid-group' }])
    }
    if (findGroup(group.id)) {
      throw new ConflictError(`Group already exists: ${group.id}`, { groupId: group.id })
    }
    group.sounds = validateSoundIds(group.sounds)
    state.library = { ...state.library, version: VERSION, groups: [...state.library.groups, group] }
    await persistLibrary()
    return group
  }

  async function updateGroup(id, patch) {
    const existing = requireGroup(id)
    const p = isObj(patch) ? patch : {}
    const raw = { ...existing, ...p, id }
    if (isObj(p.defaults)) {
      raw.defaults = { ...existing.defaults, ...p.defaults }
      if (isObj(p.defaults.trigger)) {
        raw.defaults.trigger = { ...existing.defaults.trigger, ...p.defaults.trigger }
      }
    }

    let group
    try {
      group = normalizeGroup(raw)
    } catch (err) {
      throw new ValidationError(err.message, [{ type: 'invalid-group' }])
    }
    group.sounds = validateSoundIds(group.sounds)
    replaceGroup(group)
    await persistLibrary()
    return group
  }

  async function deleteGroup(id) {
    const group = requireGroup(id)
    state.library = {
      ...state.library,
      version: VERSION,
      groups: state.library.groups.filter((candidate) => candidate.id !== id),
    }
    const paletteRemoved = prunePaletteForGroups([id])
    const bindingsRemoved = pruneGlobalBindings()
    await persistLibrary()
    if (paletteRemoved || bindingsRemoved) await persistGlobal()
    return {
      group,
      library: state.library,
      global: state.global,
      paletteRemoved,
      bindingsRemoved,
    }
  }

  async function addGroupSounds(id, soundIds) {
    const group = requireGroup(id)
    const ids = validateSoundIds(requireIdArray(soundIds, 'soundIds'))
    const sounds = [...group.sounds]
    for (const soundId of ids) if (!sounds.includes(soundId)) sounds.push(soundId)
    const updated = { ...group, sounds }
    replaceGroup(updated)
    await persistLibrary()
    return updated
  }

  async function removeGroupSounds(id, soundIds) {
    const group = requireGroup(id)
    const ids = requireIdArray(soundIds, 'soundIds')
    const unknown = ids.filter(
      (soundId) => !findSound(state.catalog, soundId) && !group.sounds.includes(soundId)
    )
    if (unknown.length) {
      throw new ValidationError(`Unknown sound ids: ${unknown.join(', ')}`, [
        ...unknown.map((soundId) => ({ type: 'missing-sound', soundId })),
      ])
    }
    const removed = new Set(ids)
    const updated = { ...group, sounds: group.sounds.filter((soundId) => !removed.has(soundId)) }
    replaceGroup(updated)
    await persistLibrary()
    return updated
  }

  async function mergeGroups(input = {}) {
    const data = isObj(input) ? input : {}
    const ids = requireIdArray(data.groupIds, 'groupIds')
    if (ids.length < 2) {
      throw new ValidationError('mergeGroups requires at least two groups', [
        { type: 'invalid-input', field: 'groupIds' },
      ])
    }

    const groups = ids.map((id) => requireGroup(id))
    const target = data.targetId ? groups.find((group) => group.id === data.targetId) : groups[0]
    if (!target) {
      throw new ValidationError('targetId must be one of groupIds', [
        { type: 'invalid-target', targetId: data.targetId },
      ])
    }

    const sounds = []
    const seenSounds = new Set()
    for (const group of groups) {
      for (const soundId of group.sounds) {
        if (seenSounds.has(soundId)) continue
        seenSounds.add(soundId)
        sounds.push(soundId)
      }
    }

    let tags = []
    for (const group of groups) tags = normalizeTags([...tags, ...group.tags])
    if (data.tags !== undefined) tags = normalizeTags([...tags, ...(Array.isArray(data.tags) ? data.tags : [])])

    let merged
    try {
      merged = normalizeGroup({
        ...target,
        id: target.id,
        name: typeof data.name === 'string' ? data.name : target.name,
        category: data.category !== undefined ? data.category : target.category,
        tags,
        sounds,
      })
    } catch (err) {
      throw new ValidationError(err.message, [{ type: 'invalid-group' }])
    }

    const removedIds = ids.filter((id) => id !== target.id)
    const removed = new Set(removedIds)
    state.library = {
      ...state.library,
      version: VERSION,
      groups: state.library.groups
        .filter((group) => !removed.has(group.id))
        .map((group) => (group.id === target.id ? merged : group)),
    }

    const paletteRemoved = prunePaletteForGroups(removedIds)
    const bindingsRemoved = pruneGlobalBindings()
    await persistLibrary()
    if (paletteRemoved || bindingsRemoved) await persistGlobal()
    return {
      group: merged,
      library: state.library,
      global: state.global,
      removedIds,
      paletteRemoved,
      bindingsRemoved,
    }
  }

  async function splitGroup(input = {}) {
    const data = isObj(input) ? input : {}
    const source = requireGroup(data.groupId)
    const ids = requireIdArray(data.soundIds, 'soundIds')
    if (!ids.length) {
      throw new ValidationError('splitGroup requires at least one sound', [
        { type: 'invalid-input', field: 'soundIds' },
      ])
    }

    const sourceSounds = new Set(source.sounds)
    const notInGroup = ids.filter((soundId) => !sourceSounds.has(soundId))
    if (notInGroup.length) {
      throw new ValidationError('Selected sounds are not in the source group', [
        ...notInGroup.map((soundId) => ({ type: 'sound-not-in-group', soundId, groupId: source.id })),
      ])
    }
    validateSoundIds(ids)

    let group
    try {
      group = normalizeGroup({
        ...source,
        id: uid(),
        name:
          typeof data.name === 'string' && data.name.trim()
            ? data.name
            : `${source.name} (split)`,
        category: data.category !== undefined ? data.category : source.category,
        tags: data.tags !== undefined ? data.tags : source.tags,
        sounds: ids,
      })
    } catch (err) {
      throw new ValidationError(err.message, [{ type: 'invalid-group' }])
    }

    const selected = new Set(ids)
    const updatedSource = {
      ...source,
      sounds: source.sounds.filter((soundId) => !selected.has(soundId)),
    }

    state.library = {
      ...state.library,
      version: VERSION,
      groups: state.library.groups
        .map((candidate) => (candidate.id === source.id ? updatedSource : candidate))
        .concat(group),
    }
    await persistLibrary()
    return { group, source: updatedSource, library: state.library }
  }

  async function bulkUpdateGroups(ids, patch) {
    const list = requireIdArray(ids, 'ids')
    for (const id of list) requireGroup(id)
    const p = isObj(patch) ? patch : {}
    const updated = []

    const groups = state.library.groups.map((group) => {
      if (!list.includes(group.id)) return group

      const raw = { ...group }
      if (hasOwn(p, 'category')) raw.category = p.category
      if (hasOwn(p, 'selection')) raw.selection = p.selection
      if (hasOwn(p, 'defaultKind')) raw.defaultKind = p.defaultKind
      if (hasOwn(p, 'tags')) raw.tags = p.tags

      let tags = normalizeTags(raw.tags)
      if (Array.isArray(p.addTags)) tags = normalizeTags([...tags, ...p.addTags])
      if (Array.isArray(p.removeTags)) {
        const remove = new Set(
          p.removeTags
            .filter((tag) => typeof tag === 'string')
            .map((tag) => tag.trim().toLowerCase())
            .filter(Boolean)
        )
        tags = tags.filter((tag) => !remove.has(tag.toLowerCase()))
      }
      raw.tags = tags

      if (isObj(p.defaults)) {
        raw.defaults = { ...group.defaults, ...p.defaults }
        if (isObj(p.defaults.trigger)) {
          raw.defaults.trigger = { ...group.defaults.trigger, ...p.defaults.trigger }
        }
      }

      let next
      try {
        next = normalizeGroup({ ...raw, id: group.id })
      } catch (err) {
        throw new ValidationError(err.message, [{ type: 'invalid-group', groupId: group.id }])
      }
      updated.push(next)
      return next
    })

    if (!updated.length) return { groups: [], library: state.library }
    state.library = { ...state.library, version: VERSION, groups }
    await persistLibrary()
    return { groups: updated, library: state.library }
  }

  async function createGroupsFromSounds(input = {}) {
    const data = isObj(input) ? input : {}
    const ids = validateSoundIds(requireIdArray(data.soundIds, 'soundIds'))
    if (!ids.length) {
      throw new ValidationError('At least one sound is required', [
        { type: 'invalid-input', field: 'soundIds' },
      ])
    }
    return createGroup({
      name: data.name,
      category: data.category,
      tags: data.tags,
      sounds: ids,
      selection: data.selection,
      defaultKind: data.defaultKind,
      defaults: data.defaults,
    })
  }

  function validateScene(rawScene) {
    const scene = isObj(rawScene) ? rawScene : {}
    const errors = []
    const groups = new Map(state.library.groups.map((group) => [group.id, group]))
    const sounds = new Set(state.catalog.sounds.map((sound) => sound.id))
    const moods = Array.isArray(scene.moods) ? scene.moods : []
    const moodIds = new Set(moods.map((mood) => mood?.id).filter(Boolean))

    if (!moods.length) errors.push({ type: 'missing-mood' })
    if (!moodIds.has(scene.defaultMoodId)) {
      errors.push({ type: 'invalid-default-mood', defaultMoodId: scene.defaultMoodId ?? null })
    }

    const seenMissingSounds = new Set()
    for (const track of Array.isArray(scene.tracks) ? scene.tracks : []) {
      const group = groups.get(track.groupId)
      if (!group) {
        errors.push({
          type: 'missing-group',
          trackId: track.id ?? null,
          groupId: track.groupId ?? null,
        })
        continue
      }
      for (const soundId of Array.isArray(group.sounds) ? group.sounds : []) {
        if (sounds.has(soundId)) continue
        const key = `${group.id}\u0000${soundId}`
        if (seenMissingSounds.has(key)) continue
        seenMissingSounds.add(key)
        errors.push({
          type: 'missing-sound',
          trackId: track.id ?? null,
          groupId: group.id,
          soundId,
        })
      }
    }

    return { ok: errors.length === 0, errors }
  }

  async function saveScene(id, rawScene) {
    assertSceneId(id)
    const raw = isObj(rawScene) ? rawScene : {}

    if (raw.defaultMoodId !== undefined && raw.defaultMoodId !== null && raw.defaultMoodId !== '') {
      const rawMoods = Array.isArray(raw.moods) ? raw.moods : []
      const rawMoodIds = new Set(rawMoods.map((mood) => (isObj(mood) ? mood.id : null)).filter(Boolean))
      if (typeof raw.defaultMoodId !== 'string' || !rawMoodIds.has(raw.defaultMoodId)) {
        throw new ValidationError('defaultMoodId does not reference a mood', [
          { type: 'invalid-default-mood', defaultMoodId: raw.defaultMoodId },
        ])
      }
    }

    const normalized = normalizeScene({ ...raw, id })
    const result = validateScene(normalized)
    if (!result.ok) throw new ValidationError('Invalid scene', result.errors)

    const scene = { ...normalized, midi: cleanSceneMidi(normalized) }
    state.scenes.set(id, scene)
    await persist(scenePath(rootDataDir, id), scene)
    return scene
  }

  async function createScene(input = {}) {
    const data = isObj(input) ? input : {}
    const scene = newScene({ name: data.name })
    return saveScene(scene.id, scene)
  }

  async function deleteScene(id) {
    assertSceneId(id)
    const existing = state.scenes.get(id)
    if (!existing) throw new NotFoundError(`Scene not found: ${id}`, { sceneId: id })
    state.scenes.delete(id)
    const file = scenePath(rootDataDir, id)
    await enqueue(file, () =>
      fs.unlink(file).catch((err) => {
        if (err?.code !== 'ENOENT') throw err
      })
    )
    return existing
  }

  function validateAll() {
    const groups = new Map(state.library.groups.map((group) => [group.id, group]))
    const sounds = new Set(state.catalog.sounds.map((sound) => sound.id))

    const missingGroups = []
    const scenes = []
    for (const item of state.scenes.values()) {
      const result = validateScene(item)
      scenes.push({ sceneId: item.id, ok: result.ok, errors: result.errors })
      for (const error of result.errors) {
        if (error.type === 'missing-group') {
          missingGroups.push({
            sceneId: item.id,
            trackId: error.trackId,
            groupId: error.groupId,
          })
        }
      }
    }

    const missingSounds = []
    const seenSounds = new Set()
    for (const group of state.library.groups) {
      for (const soundId of Array.isArray(group.sounds) ? group.sounds : []) {
        if (sounds.has(soundId)) continue
        const key = `${group.id}\u0000${soundId}`
        if (seenSounds.has(key)) continue
        seenSounds.add(key)
        missingSounds.push({ groupId: group.id, soundId })
      }
    }

    const palette = []
    for (const entry of state.global.palette) {
      if (!groups.has(entry.groupId)) palette.push({ paletteId: entry.id, groupId: entry.groupId })
    }

    return { missingGroups, missingSounds, scenes, palette }
  }

  async function markImportDone(value = true) {
    const done = Boolean(value)
    if (done) {
      await enqueue(markerPath, async () => {
        await ensureDirs(rootDataDir)
        await fs.writeFile(markerPath, `${new Date().toISOString()}\n`, 'utf8')
      })
    } else {
      await enqueue(markerPath, () =>
        fs.unlink(markerPath).catch((err) => {
          if (err?.code !== 'ENOENT') throw err
        })
      )
    }
    state.importDone = done
    return done
  }

  const store = {
    init,
    catalog,
    library,
    global,
    scene,
    allScenes,
    listScenes,
    bindingsOverview,
    importDone,
    warnings,
    stats,
    searchSounds,
    lookupSounds,
    setSoundDuration,
    addSounds,
    saveCatalog,
    saveGlobal,
    saveLibrary,
    createGroup,
    updateGroup,
    deleteGroup,
    addGroupSounds,
    removeGroupSounds,
    mergeGroups,
    splitGroup,
    bulkUpdateGroups,
    createGroupsFromSounds,
    createScene,
    saveScene,
    deleteScene,
    validateScene,
    validateAll,
    markImportDone,
    dataDir: rootDataDir,
    soundsDir: rootSoundsDir,
    scenesDir,
  }

  return store
}
