// One-off legacy v2 scene converter.
//
// Reads old `config.json` scene files, maps their element audio onto the v3
// content-addressed catalog, adds the minimum library groups needed to keep
// each element's sound set, and produces canonical v3 scenes (tracks, moods,
// local MIDI). Source audio and existing v3 data are never deleted or modified.
//
// This module is intentionally separate from the runtime v3 modules: it is only
// used by `tools/import-scenes-v2.js` and its tests.

import { createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'

import { bindingKey } from './bindings.js'
import {
  VERSION,
  clamp01,
  coerceReverb,
  newGroup,
  normalizeScene,
  sanitizeTrigger,
} from './schema.js'
import { hashFile } from './storage.js'

const KINDS = new Set(['loop', 'random', 'oneshot'])
const SKIP_DIRS = new Set(['_library', 'data', 'sounds'])
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const isObj = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)
const hasOwn = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key)

function byRel(a, b) {
  return a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0
}

function isUuid(value) {
  return typeof value === 'string' && UUID_RE.test(value)
}

// Deterministic UUID-shaped identifier (SHA-256, version 4 + RFC 4122 variant).
export function uuidFromString(input) {
  const digest = createHash('sha256').update(String(input)).digest()
  const bytes = Buffer.from(digest.subarray(0, 16))
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = bytes.toString('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

function cleanSceneName(dirAbs) {
  const base = path.basename(dirAbs)
  let name = base.replace(/^syrinscape\s*[-_]\s*(?:d&d\s*[-_]\s*)?/i, '')
  name = name.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim()
  return name || base
}

function sceneBaseName(item) {
  const name = item?.config?.name
  if (typeof name === 'string' && name.trim()) return name.trim()
  return cleanSceneName(item.dir)
}

function sceneIdFor(config, rel) {
  return isUuid(config?.id) ? config.id : uuidFromString(`scene:${rel}`)
}

function sceneSourceDir(dir, rel, explicit) {
  if (typeof explicit === 'string' && explicit) return path.resolve(explicit)
  const relDir = path.posix.dirname(String(rel || '').replace(/\\/g, '/'))
  const depth = relDir === '.' || !relDir ? 0 : relDir.split('/').filter(Boolean).length
  return path.resolve(dir, ...Array(depth).fill('..'))
}

// Recursively find legacy scene configs. Symlinks, hidden directories, and the
// old runtime directories are skipped. Only objects with an `elements` array
// are returned.
export async function readLegacyConfigs(sourceDir) {
  const rootAbs = path.resolve(sourceDir)
  const out = []

  async function walk(dirAbs, dirRel) {
    let entries
    try {
      entries = await fs.readdir(dirAbs, { withFileTypes: true })
    } catch {
      return
    }
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))

    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue
      const abs = path.join(dirAbs, entry.name)

      if (entry.isDirectory()) {
        if (entry.name.startsWith('.')) continue
        if (SKIP_DIRS.has(entry.name.toLowerCase())) continue
        await walk(abs, dirRel ? `${dirRel}/${entry.name}` : entry.name)
        continue
      }

      if (!entry.isFile() || entry.name !== 'config.json') continue

      let config
      try {
        config = JSON.parse(await fs.readFile(abs, 'utf8'))
      } catch {
        continue
      }
      if (!isObj(config) || !Array.isArray(config.elements)) continue

      out.push({
        config,
        dir: dirAbs,
        rel: dirRel ? `${dirRel}/${entry.name}` : entry.name,
      })
    }
  }

  await walk(rootAbs, '')
  out.sort(byRel)
  return out
}

// Resolve a legacy file reference below the source tree. Returns an absolute
// path, or null when the reference escapes the source tree.
export function resolveLegacyFile(sourceDir, sceneDir, rel) {
  if (typeof rel !== 'string' || !rel.trim() || rel.includes('\0')) return null
  const sourceAbs = path.resolve(sourceDir)
  const sceneAbs = path.resolve(sceneDir)
  const normalized = rel.replace(/\\/g, '/')
  const abs = path.resolve(sceneAbs, normalized)
  const relative = path.relative(sourceAbs, abs)
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    return null
  }
  return abs
}

function warningKey(warning) {
  return [
    warning.type,
    warning.scene ?? '',
    warning.abs ?? '',
    warning.file ?? '',
    warning.elementId ?? '',
  ].join('|')
}

// Hash every unique audio file referenced by the given configs. Missing,
// unreadable, and out-of-tree files become warnings instead of failures.
export async function buildFileHashMap({
  sourceDir,
  configs,
  concurrency = 8,
  onProgress,
} = {}) {
  const hashes = new Map()
  const warnings = []
  const entries = []
  const seen = new Set()

  for (const item of Array.isArray(configs) ? configs : []) {
    const config = item?.config
    const hidden = new Set(Array.isArray(config?.hidden) ? config.hidden.map(String) : [])
    const elements = Array.isArray(config?.elements) ? config.elements : []

    for (const element of elements) {
      if (!isObj(element)) continue
      if (element.id != null && hidden.has(String(element.id))) continue
      const files = Array.isArray(element.files) ? element.files : []
      for (const file of files) {
        const abs = resolveLegacyFile(sourceDir, item.dir, file)
        if (!abs) {
          warnings.push({
            type: 'outside-source',
            scene: item.rel,
            file,
            elementId: element.id ?? null,
            message: `File escapes the source tree: ${file}`,
          })
          continue
        }
        if (seen.has(abs)) continue
        seen.add(abs)
        entries.push({ abs, file, scene: item.rel, elementId: element.id ?? null })
      }
    }
  }

  let processed = 0
  let index = 0
  const total = entries.length
  const limit = Math.max(1, Math.trunc(Number(concurrency) || 1))

  async function worker() {
    for (;;) {
      const current = index
      index += 1
      if (current >= entries.length) return
      const entry = entries[current]
      try {
        const hash = await hashFile(entry.abs)
        hashes.set(entry.abs, hash)
      } catch (err) {
        warnings.push({
          type: err?.code === 'ENOENT' ? 'missing-file' : 'hash-failed',
          scene: entry.scene,
          file: entry.file,
          abs: entry.abs,
          elementId: entry.elementId,
          message: err?.message ?? String(err),
        })
      }
      processed += 1
      if (typeof onProgress === 'function') {
        onProgress({
          phase: 'hash',
          processed,
          total,
          current: entry,
          hashed: hashes.size,
          warnings: warnings.length,
        })
      }
    }
  }

  const workers = Array.from({ length: Math.min(limit, entries.length) }, () => worker())
  await Promise.all(workers)

  warnings.sort((a, b) => {
    const ak = `${a.scene ?? ''}\u0000${a.abs ?? a.file ?? ''}`
    const bk = `${b.scene ?? ''}\u0000${b.abs ?? b.file ?? ''}`
    return ak < bk ? -1 : ak > bk ? 1 : 0
  })

  return { hashes, warnings }
}

// Canonical reuse key: case-insensitive name, selection, and exact sorted sound
// set. Groups are only reused when all three match.
export function groupReuseKey(name, selection, soundIds) {
  const sounds = Array.isArray(soundIds) ? Array.from(new Set(soundIds)).sort() : []
  return `${String(name ?? '').toLowerCase()}\u0000${selection}\u0000${sounds.join(',')}`
}

export function buildLibraryIndex(groups) {
  const byKey = new Map()
  const byId = new Map()
  const usedIds = new Set()
  const list = (Array.isArray(groups) ? groups : []).filter(isObj)

  for (const group of list) {
    const key = groupReuseKey(group.name, group.selection, group.sounds)
    if (!byKey.has(key)) byKey.set(key, group)
    byId.set(group.id, group)
    usedIds.add(group.id)
  }

  return { groups: list.slice(), byKey, byId, usedIds }
}

function asLibraryIndex(value) {
  if (value && value.byKey instanceof Map) return value
  if (Array.isArray(value)) return buildLibraryIndex(value)
  if (isObj(value) && Array.isArray(value.groups)) return buildLibraryIndex(value.groups)
  return buildLibraryIndex([])
}

function uniqueId(candidate, seen, namespace, seed) {
  let id = candidate
  let suffix = 0
  while (seen.has(id)) {
    suffix += 1
    id = uuidFromString(`${namespace}:${seed}:${suffix}`)
  }
  seen.add(id)
  return id
}

function getOrCreateGroup({
  name,
  selection,
  soundIds,
  kind,
  defaults,
  libraryIndex,
  newGroups,
}) {
  const key = groupReuseKey(name, selection, soundIds)
  const existing = libraryIndex.byKey.get(key)
  if (existing) return existing.id

  let id = uuidFromString(`group:${key}`)
  let suffix = 0
  while (libraryIndex.usedIds.has(id)) {
    const conflict = libraryIndex.byId.get(id)
    if (conflict && groupReuseKey(conflict.name, conflict.selection, conflict.sounds) === key) {
      return id
    }
    suffix += 1
    id = uuidFromString(`group:${key}:${suffix}`)
  }

  const group = newGroup({
    id,
    name,
    category: '',
    tags: [],
    sounds: soundIds,
    selection,
    defaultKind: kind,
    defaults,
    notes: '',
  })
  newGroups.push(group)
  libraryIndex.byKey.set(key, group)
  libraryIndex.byId.set(id, group)
  libraryIndex.usedIds.add(id)
  return id
}

function parseLegacyMidiKey(rawKey, expectedType) {
  const parts = String(rawKey ?? '').split(':')
  let channel
  let number
  if (parts.length === 2) {
    channel = parts[0]
    number = parts[1]
  } else if (parts.length === 3) {
    if (parts[1].trim().toLowerCase() !== expectedType) return null
    channel = parts[0]
    number = parts[2]
  } else {
    return null
  }
  const ch = Number(channel)
  const num = Number(number)
  if (!Number.isInteger(ch) || ch < 0 || ch > 15) return null
  if (!Number.isInteger(num) || num < 0 || num > 127) return null
  return bindingKey(ch, expectedType, num)
}

function convertMidiAction(action, type, elementTrackIds, moodIdMap) {
  if (!isObj(action)) return null

  if (type === 'note') {
    switch (action.type) {
      case 'loop':
      case 'random':
      case 'oneshot': {
        const trackId = elementTrackIds.get(action.elementId)
        return trackId ? { type: 'trackTrigger', trackId } : null
      }
      case 'mood': {
        const moodId = moodIdMap.get(action.moodId)
        return moodId ? { type: 'moodSelect', moodId } : null
      }
      case 'soundset':
        return { type: 'sceneToggle' }
      default:
        return null
    }
  }

  if (type === 'cc') {
    if (action.type === 'element') {
      const trackId = elementTrackIds.get(action.elementId)
      return trackId ? { type: 'trackVolume', trackId } : null
    }
  }

  return null
}

function convertLocalMidi(midi, elementTrackIds, moodIdMap) {
  const source = isObj(midi) ? midi : {}
  const out = { notes: {}, ccs: {} }
  const maps = [
    ['notes', source.notes, 'note'],
    ['ccs', source.ccs, 'cc'],
  ]

  for (const [mapName, bindings, type] of maps) {
    if (!isObj(bindings)) continue
    for (const [rawKey, action] of Object.entries(bindings)) {
      const key = parseLegacyMidiKey(rawKey, type)
      if (!key) continue
      const converted = convertMidiAction(action, type, elementTrackIds, moodIdMap)
      if (converted) out[mapName][key] = converted
    }
  }

  return out
}

function rawMoods(config) {
  if (Array.isArray(config?.moods)) return config.moods.filter(isObj)
  if (isObj(config?.moods)) return Object.values(config.moods).filter(isObj)
  return []
}

function moodParamsFor(records, oldParams) {
  const source = isObj(oldParams) ? oldParams : {}
  const params = {}

  for (const record of records) {
    const elementId = record.element.id
    const present = elementId != null && hasOwn(source, String(elementId))
    const old = present && isObj(source[String(elementId)]) ? source[String(elementId)] : {}
    const gain =
      present && typeof old.volume === 'number' && Number.isFinite(old.volume)
        ? clamp01(old.volume)
        : record.fidelityGain

    const param = {
      enabled: present ? Boolean(old.plays) : true,
      reverb: record.fidelityReverb,
      pan: 0,
      trigger: record.fidelityTrigger,
    }
    if (gain != null) param.gain = gain
    params[record.trackId] = param
  }

  return params
}

// Convert one legacy config. Returns a normalized v3 scene plus any new groups
// it needed. Existing groups are never mutated.
export function convertLegacyScene({
  config,
  dir,
  rel,
  hashes,
  catalog,
  libraryIndex,
  duplicateName = false,
  sourceDir,
} = {}) {
  const rawConfig = isObj(config) ? config : {}
  const index = asLibraryIndex(libraryIndex)
  const hashMap = hashes instanceof Map ? hashes : new Map()
  const catalogByHash = new Map()
  for (const sound of Array.isArray(catalog?.sounds) ? catalog.sounds : []) {
    if (!isObj(sound) || typeof sound.hash !== 'string' || !sound.hash) continue
    if (!catalogByHash.has(sound.hash)) catalogByHash.set(sound.hash, sound.id)
  }

  const sourceAbs = sceneSourceDir(dir, rel, sourceDir)
  const sceneId = sceneIdFor(rawConfig, rel)
  let sceneName = sceneBaseName({ config: rawConfig, dir })
  if (duplicateName) sceneName = `${sceneName} (${path.basename(dir)})`

  const hidden = new Set(Array.isArray(rawConfig.hidden) ? rawConfig.hidden.map(String) : [])
  const elements = Array.isArray(rawConfig.elements) ? rawConfig.elements : []
  const newGroups = []
  const warnings = []
  const tracks = []
  const records = []
  const elementTrackIds = new Map()
  const usedTrackIds = new Set()
  let hiddenCount = 0
  let skippedCount = 0
  let missingFiles = 0
  let visibleIndex = 0

  elements.forEach((element, elementIndex) => {
    if (!isObj(element)) {
      skippedCount += 1
      return
    }
    if (element.id != null && hidden.has(String(element.id))) {
      hiddenCount += 1
      return
    }

    const soundIds = []
    const seenSounds = new Set()
    const files = Array.isArray(element.files) ? element.files : []

    for (const file of files) {
      const abs = resolveLegacyFile(sourceAbs, dir, file)
      if (!abs) {
        missingFiles += 1
        warnings.push({
          type: 'outside-source',
          scene: rel,
          file,
          elementId: element.id ?? null,
          message: `File escapes the source tree: ${file}`,
        })
        continue
      }
      const hash = hashMap.get(abs)
      if (!hash) {
        missingFiles += 1
        warnings.push({
          type: 'missing-file',
          scene: rel,
          file,
          abs,
          elementId: element.id ?? null,
          message: `No content hash available for ${file}`,
        })
        continue
      }
      const soundId = catalogByHash.get(hash)
      if (!soundId) {
        warnings.push({
          type: 'unknown-sound',
          scene: rel,
          file,
          abs,
          hash,
          elementId: element.id ?? null,
          message: `No catalog sound for hash ${hash}`,
        })
        continue
      }
      if (!seenSounds.has(soundId)) {
        seenSounds.add(soundId)
        soundIds.push(soundId)
      }
    }

    if (!soundIds.length) {
      skippedCount += 1
      warnings.push({
        type: 'no-sounds',
        scene: rel,
        elementId: element.id ?? null,
        elementName: element.name ?? null,
        message: `Skipped element with no catalogued sounds: ${element.name ?? element.id ?? elementIndex}`,
      })
      return
    }

    const kind = KINDS.has(element.kind) ? element.kind : 'oneshot'
    const selection =
      element.randomise === 'inorder' || element.randomise == null ? 'ordered' : 'random'
    const trigger = sanitizeTrigger(element.trigger)
    const reverb = coerceReverb(element.reverb)
    const groupName =
      typeof element.name === 'string' && element.name.trim()
        ? element.name.trim()
        : `Group ${elementIndex + 1}`

    const groupId = getOrCreateGroup({
      name: groupName,
      selection,
      soundIds,
      kind,
      defaults: {
        gain: clamp01(element.gain ?? 0.8),
        reverb,
        pan: 0,
        trigger,
      },
      libraryIndex: index,
      newGroups,
    })

    const trackId = uniqueId(
      isUuid(element.id)
        ? element.id
        : uuidFromString(`track:${sceneId}:${element.id ?? ''}:${elementIndex}`),
      usedTrackIds,
      'track',
      `${sceneId}:${elementIndex}`
    )

    tracks.push({ id: trackId, groupId, kind, order: visibleIndex, trigger })
    if (element.id != null) elementTrackIds.set(String(element.id), trackId)

    const gainNumber = Number(element.gain)
    records.push({
      trackId,
      element,
      fidelityGain:
        element.gain != null && Number.isFinite(gainNumber) ? gainNumber : null,
      fidelityReverb: reverb,
      fidelityTrigger: trigger,
    })
    visibleIndex += 1
  })

  const legacyMoods = rawMoods(rawConfig)
  const moods = []
  const usedMoodIds = new Set()
  const moodIdMap = new Map()

  if (legacyMoods.length) {
    legacyMoods.forEach((mood, moodIndex) => {
      const candidate = isUuid(mood.id)
        ? mood.id
        : uuidFromString(`mood:${sceneId}:${mood.id ?? ''}:${moodIndex}`)
      const id = uniqueId(candidate, usedMoodIds, 'mood', `${sceneId}:${moodIndex}`)
      const name =
        typeof mood.name === 'string' && mood.name.trim() ? mood.name.trim() : `Mood ${moodIndex + 1}`
      moods.push({ id, name, params: moodParamsFor(records, mood.params) })
      if (mood.id != null) moodIdMap.set(String(mood.id), id)
    })
  } else {
    const id = uuidFromString(`mood:${sceneId}:default`)
    moods.push({ id, name: 'Default', params: moodParamsFor(records, {}) })
  }

  const defaultMoodId =
    (moods.find((mood) => mood.name === 'Default') || moods[0] || {}).id ?? ''

  const midi = convertLocalMidi(rawConfig.midi, elementTrackIds, moodIdMap)

  const scene = normalizeScene({
    version: VERSION,
    id: sceneId,
    name: sceneName,
    disabled: Boolean(rawConfig.disabled),
    defaultMoodId,
    tracks,
    moods,
    midi,
  })

  return {
    scene,
    newGroups,
    warnings,
    stats: {
      tracks: scene.tracks.length,
      moods: scene.moods.length,
      groups: newGroups.length,
      hiddenElements: hiddenCount,
      skippedElements: skippedCount,
      missingFiles,
    },
  }
}

function uniqueWarnings(warnings) {
  const seen = new Set()
  const out = []
  for (const warning of warnings) {
    const key = warningKey(warning)
    if (seen.has(key)) continue
    seen.add(key)
    out.push(warning)
  }
  return out
}

function missingFileCount(warnings) {
  const missing = new Set()
  for (const warning of warnings) {
    if (!['missing-file', 'outside-source', 'hash-failed'].includes(warning.type)) continue
    missing.add(warning.abs || `${warning.scene ?? ''}\u0000${warning.file ?? ''}`)
  }
  return missing.size
}

// Orchestrate a full v2 scene import. `dryRun` converts in memory only. A real
// run saves the library once (only when new groups exist) and then each scene.
export async function importLegacyScenes({
  store,
  sourceDir,
  dryRun = false,
  force = false,
  limit = 0,
  concurrency = 8,
  onProgress,
} = {}) {
  if (!store || typeof store.catalog !== 'function' || typeof store.library !== 'function') {
    throw new Error('importLegacyScenes requires an initialized store')
  }

  const started = Date.now()
  const allConfigs = await readLegacyConfigs(sourceDir)
  const nameCounts = new Map()
  for (const item of allConfigs) {
    const name = sceneBaseName(item)
    nameCounts.set(name, (nameCounts.get(name) || 0) + 1)
  }

  const selected = limit > 0 ? allConfigs.slice(0, limit) : allConfigs
  const hashResult = await buildFileHashMap({
    sourceDir,
    configs: selected,
    concurrency,
    onProgress,
  })

  const catalog = store.catalog()
  const libraryIndex = buildLibraryIndex(store.library().groups)
  const warnings = hashResult.warnings.slice()
  const prepared = []
  const newGroups = []
  let scenesCreated = 0
  let scenesUpdated = 0
  let scenesSkipped = 0
  let tracks = 0

  selected.forEach((item, index) => {
    const id = sceneIdFor(item.config, item.rel)
    const existing = store.scene(id)

    if (typeof onProgress === 'function') {
      onProgress({
        phase: 'scene',
        processed: index + 1,
        total: selected.length,
        scene: item.rel,
        sceneId: id,
      })
    }

    if (existing && !force) {
      scenesSkipped += 1
      return
    }

    const duplicateName = (nameCounts.get(sceneBaseName(item)) || 0) > 1
    const result = convertLegacyScene({
      config: item.config,
      dir: item.dir,
      rel: item.rel,
      hashes: hashResult.hashes,
      catalog,
      libraryIndex,
      duplicateName,
      sourceDir,
    })

    newGroups.push(...result.newGroups)
    warnings.push(...result.warnings)
    tracks += result.stats.tracks
    prepared.push({ scene: result.scene, existing: Boolean(existing) })
  })

  if (dryRun) {
    for (const item of prepared) {
      if (item.existing) scenesUpdated += 1
      else scenesCreated += 1
    }
  } else {
    if (newGroups.length) {
      await store.saveLibrary({
        version: VERSION,
        groups: [...store.library().groups, ...newGroups],
      })
    }

    for (const item of prepared) {
      try {
        await store.saveScene(item.scene.id, item.scene)
        if (item.existing) scenesUpdated += 1
        else scenesCreated += 1
      } catch (err) {
        warnings.push({
          type: 'save-failed',
          sceneId: item.scene.id,
          scene: item.scene.name,
          message: err?.message ?? String(err),
          errors: Array.isArray(err?.errors) ? err.errors : undefined,
        })
      }
    }
  }

  const unique = uniqueWarnings(warnings)
  const elapsed = Number(((Date.now() - started) / 1000).toFixed(2))

  return {
    configs: selected.length,
    scenesCreated,
    scenesUpdated,
    scenesSkipped,
    groupsCreated: newGroups.length,
    tracks,
    missingFiles: missingFileCount(unique),
    warnings: unique.length,
    elapsed,
    dryRun: Boolean(dryRun),
    warningDetails: unique,
  }
}
