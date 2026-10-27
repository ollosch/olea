// v3 import pipeline: scan, hash, content-addressed copy, duration probe, and
// group proposals. Importing never deletes or modifies source files.
//
// The module is filesystem-aware but knows nothing about the store. Pass a raw
// catalog in and get an updated raw catalog (plus per-file metadata) back.

import { spawn, spawnSync } from 'node:child_process'
import { constants as FS_CONSTANTS } from 'node:fs'
import fs from 'node:fs/promises'
import path from 'node:path'

import { addSoundToCatalog, hashIndex, setSoundDuration } from './catalog.js'
import { newGroup, newSound, normalizeCatalog } from './schema.js'
import {
  ensureDirs,
  extensionOf,
  fileInfo,
  hashFile,
  soundPath,
} from './storage.js'

export const SUPPORTED_EXTS = Object.freeze(['ogg', 'mp3', 'wav'])

const SUPPORTED_SET = new Set(SUPPORTED_EXTS)
const DEFAULT_SKIP_DIRS = Object.freeze([
  'node_modules',
  '.git',
  'dist',
  'data',
  'sounds',
  '.migration-backup',
])

const isObj = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)

function byRel(a, b) {
  return a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0
}

function relPath(dirRel, name) {
  return dirRel ? `${dirRel}/${name}` : name
}

// Recursively scan `root` for supported audio files. Symlinks and hidden dirs
// are ignored so a scan can never escape the given root.
export async function scanSource(root, options = {}) {
  const rootAbs = path.resolve(root)
  const opts = isObj(options) ? options : {}
  const skipDirs = new Set(
    [
      ...DEFAULT_SKIP_DIRS,
      ...(Array.isArray(opts.skipDirs) ? opts.skipDirs : []),
    ]
      .filter((name) => typeof name === 'string' && name.trim())
      .map((name) => name.trim().toLowerCase())
  )

  const entries = []

  async function walk(dirAbs, dirRel) {
    let children
    try {
      children = await fs.readdir(dirAbs, { withFileTypes: true })
    } catch {
      return
    }

    for (const child of children) {
      if (child.isSymbolicLink()) continue
      const name = child.name
      const abs = path.join(dirAbs, name)

      if (child.isDirectory()) {
        if (name.startsWith('.')) continue
        if (skipDirs.has(name.toLowerCase())) continue
        await walk(abs, relPath(dirRel, name))
        continue
      }

      if (!child.isFile()) continue
      const ext = extensionOf(name)
      if (!ext || !SUPPORTED_SET.has(ext)) continue

      let stat
      try {
        stat = await fs.stat(abs)
      } catch {
        continue
      }

      entries.push({ abs, rel: relPath(dirRel, name), dirRel, name, ext, size: stat.size })
    }
  }

  await walk(rootAbs, '')
  entries.sort(byRel)
  return entries
}

// True when `file` is inside (or equal to) `dir`.
export function isWithin(file, dir) {
  if (typeof file !== 'string' || typeof dir !== 'string') return false
  const relative = path.relative(path.resolve(dir), path.resolve(file))
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))
}

// Remove scanned files that live inside a target directory (sounds/data). This
// protects an in-place/renamed target layout that the name-based scan skip
// cannot detect.
export function excludeTargetDirs(files, dirs) {
  const list = Array.isArray(files) ? files : []
  const roots = (Array.isArray(dirs) ? dirs : [dirs])
    .filter((dir) => typeof dir === 'string' && dir)
    .map((dir) => path.resolve(dir))
  if (!roots.length) return list.slice()
  return list.filter((file) => !roots.some((root) => isWithin(file?.abs, root)))
}

// Alias kept for callers that describe the operation as "same content dirs".
export const sameContentDirs = excludeTargetDirs

async function verifyExistingTarget(target, size) {
  const info = await fileInfo(target)
  if (!info.exists) return null
  return { ok: info.size === size, exists: true, size: info.size }
}

async function materializeBlob(source, target, size) {
  const existing = await verifyExistingTarget(target, size)
  if (existing) return existing

  await ensureDirs(path.dirname(target))

  try {
    await fs.link(source, target)
    return { ok: true, copied: true, method: 'link' }
  } catch (err) {
    if (err?.code === 'EEXIST') {
      const race = await verifyExistingTarget(target, size)
      if (race) return race
      return { ok: false, exists: true, size: 0, reason: 'target-size-mismatch' }
    }
    // Cross-device links and restricted filesystems fall back to a copy. Other
    // errors surface through copyFile below.
  }

  try {
    await fs.copyFile(source, target, FS_CONSTANTS.COPYFILE_EXCL)
    return { ok: true, copied: true, method: 'copy' }
  } catch (err) {
    if (err?.code === 'EEXIST') {
      const race = await verifyExistingTarget(target, size)
      if (race) return race
      return { ok: false, exists: true, size: 0, reason: 'target-size-mismatch' }
    }
    throw err
  }
}

let ffprobeCache

export function ffprobeAvailable() {
  if (ffprobeCache !== undefined) return ffprobeCache
  try {
    const result = spawnSync('ffprobe', ['-version'], { stdio: 'ignore', timeout: 2000 })
    ffprobeCache = !result.error && result.status === 0
  } catch {
    ffprobeCache = false
  }
  return ffprobeCache
}

// Probe an audio file's duration. Missing/failing ffprobe or an invalid file
// resolves to null; this function never rejects.
export function probeDuration(abs) {
  return new Promise((resolve) => {
    if (typeof abs !== 'string' || !abs) {
      resolve(null)
      return
    }

    let settled = false
    let child
    let timer

    const done = (value) => {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      resolve(value)
    }

    try {
      child = spawn(
        'ffprobe',
        ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', abs],
        { stdio: ['ignore', 'pipe', 'ignore'] }
      )
    } catch {
      resolve(null)
      return
    }

    timer = setTimeout(() => {
      try {
        child.kill('SIGKILL')
      } catch {
        // Ignore kill failures; the promise still resolves null.
      }
      done(null)
    }, 30000)

    let stdout = ''
    child.stdout.on('data', (chunk) => {
      stdout += String(chunk)
    })
    child.on('error', () => done(null))
    child.on('close', (code) => {
      if (code !== 0) {
        done(null)
        return
      }
      const value = Number.parseFloat(stdout.trim())
      done(Number.isFinite(value) && value > 0 ? value : null)
    })
  })
}

async function probeWithConcurrency(items, concurrency, onResult) {
  let index = 0
  const limit = Math.max(1, Math.trunc(Number(concurrency) || 1))
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const current = index
      index += 1
      if (current >= items.length) return
      const [soundId, abs] = items[current]
      const duration = await probeDuration(abs)
      if (duration != null) onResult(soundId, duration)
    }
  })
  await Promise.all(workers)
}

// Import every supported file under `sourceDir` (or a pre-scanned `files` list).
// Existing catalog hashes are treated as duplicates; blobs are never overwritten.
export async function importAudio(options = {}) {
  const opts = isObj(options) ? options : {}
  const { sourceDir, soundsDir, onProgress } = opts

  if (typeof soundsDir !== 'string' || !soundsDir) {
    throw new Error('importAudio requires soundsDir')
  }

  let catalog = opts.catalog == null ? { version: 3, sounds: [] } : normalizeCatalog(opts.catalog)
  let scanned = Array.isArray(opts.files)
    ? opts.files.filter(isObj).map((file) => ({ ...file }))
    : await scanSource(sourceDir)

  scanned = excludeTargetDirs(scanned, [soundsDir, opts.dataDir])
  scanned.sort(byRel)

  let skipped = 0
  const files = []
  const errors = []
  const pendingProbe = new Map()
  const byHash = hashIndex(catalog)
  let added = 0
  let duplicates = 0

  const report = (processed, total, current) => {
    if (typeof onProgress !== 'function') return
    onProgress({
      processed,
      total,
      added,
      duplicates,
      skipped,
      errors: errors.length,
      current,
    })
  }

  const total = scanned.length
  const shouldProbe = Boolean(opts.probeDuration)

  for (let index = 0; index < scanned.length; index += 1) {
    const entry = scanned[index]
    if (typeof entry.abs !== 'string' || typeof entry.rel !== 'string') {
      skipped += 1
      errors.push({ rel: String(entry.rel ?? ''), abs: String(entry.abs ?? ''), reason: 'invalid-entry', message: 'Invalid scan entry' })
      report(index + 1, total, entry)
      continue
    }

    let hash
    try {
      hash = await hashFile(entry.abs)
    } catch (err) {
      skipped += 1
      errors.push({ rel: entry.rel, abs: entry.abs, reason: 'hash-failed', message: err?.message ?? String(err) })
      report(index + 1, total, entry)
      continue
    }

    const existing = byHash.get(hash)
    let sound

    if (existing) {
      duplicates += 1
      sound = existing
      if (shouldProbe && !(sound.duration > 0) && !pendingProbe.has(sound.id)) {
        pendingProbe.set(sound.id, entry.abs)
      }
    } else {
      const ext = entry.ext || extensionOf(entry.name)
      let target
      try {
        target = soundPath(soundsDir, hash, ext)
      } catch (err) {
        skipped += 1
        errors.push({ rel: entry.rel, abs: entry.abs, reason: 'invalid-extension', message: err?.message ?? String(err) })
        report(index + 1, total, entry)
        continue
      }

      let materialized
      try {
        materialized = await materializeBlob(entry.abs, target, entry.size)
      } catch (err) {
        skipped += 1
        errors.push({ rel: entry.rel, abs: entry.abs, reason: 'copy-failed', message: err?.message ?? String(err) })
        report(index + 1, total, entry)
        continue
      }

      if (!materialized.ok) {
        skipped += 1
        errors.push({
          rel: entry.rel,
          abs: entry.abs,
          reason: 'target-size-mismatch',
          message: `Existing target has a different size: ${target}`,
        })
        report(index + 1, total, entry)
        continue
      }

      const record = newSound({
        hash,
        ext,
        size: entry.size,
        duration: null,
        originalName: entry.name,
        addedAt: new Date().toISOString(),
      })
      const result = addSoundToCatalog(catalog, record)
      catalog = result.catalog
      sound = result.sound
      byHash.set(hash, sound)
      added += 1
      if (shouldProbe) pendingProbe.set(sound.id, entry.abs)
    }

    files.push({
      ...entry,
      hash,
      soundId: sound.id,
      duration: sound.duration ?? null,
      sound,
    })
    report(index + 1, total, entry)
  }

  if (shouldProbe && pendingProbe.size) {
    const durations = new Map()
    await probeWithConcurrency(
      Array.from(pendingProbe.entries()),
      opts.durationConcurrency ?? 2,
      (soundId, duration) => durations.set(soundId, duration)
    )
    for (const [soundId, duration] of durations) {
      catalog = setSoundDuration(catalog, soundId, duration)
    }
    for (const file of files) {
      const duration = durations.get(file.soundId)
      if (duration == null) continue
      file.duration = duration
      if (file.sound) file.sound = { ...file.sound, duration }
    }
  }

  return { catalog, added, duplicates, skipped, errors, files }
}

function cleanDirName(dirRel) {
  if (!dirRel) return 'Imported'
  const base = String(dirRel).split('/').filter(Boolean).pop() || ''
  let name = base.replace(/^syrinscape\s*[-_]\s*(?:d&d\s*[-_]\s*)?/i, '')
  name = name.replace(/[_\-]+/g, ' ')
  name = name.replace(/\s+/g, ' ').trim()
  name = name.replace(/^[\s\-_]+|[\s\-_]+$/g, '')
  return name || 'Imported'
}

function stripExtension(name) {
  const base = String(name ?? '').split(/[\\/]/).pop() || ''
  const index = base.lastIndexOf('.')
  return index > 0 ? base.slice(0, index) : base
}

export function familyKey(name) {
  let key = stripExtension(name).toLowerCase()
  key = key.replace(/\[[^\]]*\]|\([^)]*\)|\{[^}]*\}/g, ' ')
  key = key.replace(/\d+/g, '#')
  key = key.replace(/\s+/g, ' ').trim()
  return key
}

function titleCase(key) {
  const words = String(key ?? '')
    .replace(/_+/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
  if (!words.length) return 'Imported'
  return words.map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(' ')
}

const LOOP_WORDS = ['loop', 'music', 'theme', 'score', 'soundtrack', 'ambience', 'bed', 'background']
const RANDOM_WORDS = ['random', 'ambient', 'noise', 'rustle', 'growl', 'breath', 'crowd', 'wind', 'forest', 'rain']
const ONESHOT_WORDS = ['action', 'impact', 'hit', 'explosion', 'spell', 'door', 'click', 'effect']

function tokensOf(values) {
  const tokens = []
  for (const value of values) {
    if (typeof value !== 'string') continue
    const text = value
      .replace(/\.[^.]+$/, '')
      .toLowerCase()
      .replace(/[^a-z0-9&]+/g, ' ')
    for (const token of text.split(/\s+/)) if (token) tokens.push(token)
  }
  return tokens
}

function hasKeyword(tokens, words) {
  return words.some((word) => tokens.some((token) => token === word || token.startsWith(word)))
}

function hintKind(dirRel, names, soundCount) {
  const tokens = tokensOf([dirRel, ...names])
  if (hasKeyword(tokens, LOOP_WORDS)) return 'loop'
  if (soundCount > 1 && hasKeyword(tokens, RANDOM_WORDS)) return 'random'
  if (hasKeyword(tokens, ONESHOT_WORDS)) return 'oneshot'
  return soundCount > 1 ? 'random' : 'oneshot'
}

function buildProposal(name, entries, dirRel) {
  const sounds = []
  const seen = new Set()
  for (const entry of entries) {
    if (typeof entry.soundId !== 'string' || !entry.soundId) continue
    if (seen.has(entry.soundId)) continue
    seen.add(entry.soundId)
    sounds.push(entry.soundId)
  }
  if (!sounds.length) return null

  return newGroup({
    name,
    category: '',
    tags: [],
    sounds,
    selection: sounds.length > 1 ? 'random' : 'ordered',
    defaultKind: hintKind(
      dirRel,
      entries.map((entry) => entry.name),
      sounds.length
    ),
    defaults: {},
  })
}

// Propose library groups from imported file entries (each needs `soundId`).
// Small source directories become one group; large ones split into filename
// families so a 1000-file ambience folder does not become a single group.
export function proposeGroups(files, options = {}) {
  const opts = isObj(options) ? options : {}
  const filesList = Array.isArray(files) ? files.filter(isObj) : []
  const threshold =
    Number.isFinite(opts.splitThreshold) && opts.splitThreshold > 0
      ? Math.trunc(opts.splitThreshold)
      : 40

  const byDir = new Map()
  for (const file of filesList) {
    if (typeof file.soundId !== 'string' || !file.soundId) continue
    const dirRel = typeof file.dirRel === 'string' ? file.dirRel : ''
    if (!byDir.has(dirRel)) byDir.set(dirRel, [])
    byDir.get(dirRel).push(file)
  }

  const groups = []
  for (const [dirRel, entries] of Array.from(byDir.entries()).sort(([a], [b]) =>
    a < b ? -1 : a > b ? 1 : 0
  )) {
    entries.sort(byRel)
    if (entries.length <= threshold) {
      const group = buildProposal(cleanDirName(dirRel), entries, dirRel)
      if (group) groups.push(group)
      continue
    }

    const families = new Map()
    for (const entry of entries) {
      const key = familyKey(entry.name)
      if (!families.has(key)) families.set(key, [])
      families.get(key).push(entry)
    }
    for (const [key, familyEntries] of Array.from(families.entries()).sort(([a], [b]) =>
      a < b ? -1 : a > b ? 1 : 0
    )) {
      const group = buildProposal(titleCase(key), familyEntries, dirRel)
      if (group) groups.push(group)
    }
  }

  groups.sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id))
  return groups
}

// Pure merge of proposals into a library. Existing groups are matched by name;
// only sounds are unioned, never category/tags/defaults. Returns new objects.
export function mergeProposals(library, proposal) {
  const base = isObj(library)
    ? library
    : { version: 3, groups: [] }
  const groups = (Array.isArray(base.groups) ? base.groups : []).map((group) => ({
    ...group,
    sounds: Array.isArray(group.sounds) ? group.sounds.slice() : [],
  }))
  const byName = new Map()
  for (const group of groups) if (!byName.has(group.name)) byName.set(group.name, group)

  let created = 0
  let updated = 0

  for (const item of Array.isArray(proposal) ? proposal : []) {
    if (!isObj(item) || typeof item.name !== 'string') continue
    const existing = byName.get(item.name)
    if (existing) {
      const seen = new Set(existing.sounds)
      let changed = false
      for (const soundId of Array.isArray(item.sounds) ? item.sounds : []) {
        if (typeof soundId !== 'string' || !soundId || seen.has(soundId)) continue
        seen.add(soundId)
        existing.sounds.push(soundId)
        changed = true
      }
      if (changed) updated += 1
      continue
    }

    const group = newGroup(item)
    groups.push(group)
    byName.set(group.name, group)
    created += 1
  }

  return {
    library: { ...base, version: base.version ?? 3, groups },
    created,
    updated,
  }
}

// Merge proposals and persist the library once. Call after sounds are added to
// the catalog. No write is performed when nothing changed.
export async function applyProposal({ store, proposal } = {}) {
  if (
    !store ||
    typeof store.library !== 'function' ||
    typeof store.saveLibrary !== 'function'
  ) {
    throw new Error('applyProposal requires a store with library() and saveLibrary()')
  }
  const result = mergeProposals(store.library(), proposal)
  if (result.created || result.updated) await store.saveLibrary(result.library)
  return result
}
