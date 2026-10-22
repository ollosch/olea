// Library persistence, scanning, and promotion.
//
// The service is deliberately Express-free so the CLI tools and the tests can
// use the exact same promotion code as the server.

import fs from 'node:fs'
import path from 'node:path'

import {
  newId,
  normalizeConfig,
  normalizeGlobal,
  normalizeInclude,
  normalizeLibrary,
  normalizeLibraryGroup,
} from './schema.js'
import {
  isInside,
  listAudioFiles,
  relativePosix,
  resolveInside,
  slugify,
  toPosixPath,
  uniquePath,
  walkDirs,
} from './path-utils.js'

function serviceError(code, message) {
  const err = new Error(message)
  err.code = code
  return err
}

function isObj(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v)
}

function parseCategoryInput(category) {
  const raw = typeof category === 'string' ? category.replace(/\\/g, '/') : ''
  const segments = raw
    .split('/')
    .map((segment) => segment.trim())
    .filter(Boolean)

  const pathSegments = []
  for (const segment of segments) {
    if (segment.includes('\0') || segment === '.' || segment === '..') return null
    const slug = slugify(segment)
    if (!slug) return null
    pathSegments.push(slug)
  }

  return {
    label: segments.join('/'),
    path: pathSegments.join('/'),
  }
}

export function createLibraryService({
  audioDir,
  libraryDir,
  libraryFile,
  globalFile = null,
  fs: fsImpl = fs,
} = {}) {
  if (!audioDir) throw new Error('audioDir is required')
  if (!libraryFile) throw new Error('libraryFile is required')

  const io = fsImpl
  const audioRoot = path.resolve(audioDir)
  const libDir = path.resolve(libraryDir || path.join(audioRoot, '_library'))
  const libFile = path.resolve(libraryFile)
  const globalFilePath = globalFile ? path.resolve(globalFile) : null

  function isLibraryPath(absPath) {
    if (typeof absPath !== 'string') return false
    return absPath === libDir || isInside(libDir, absPath)
  }

  function resolveSoundsetDir(relDir) {
    const abs = resolveInside(audioRoot, relDir)
    if (!abs) return null
    if (isLibraryPath(abs)) return null
    return abs
  }

  function resolveLibraryTarget(relPath) {
    const abs = resolveInside(libDir, relPath)
    if (!abs) return null
    if (isInside(audioRoot, libDir) && !isInside(audioRoot, abs)) return null
    return abs
  }

  // ---- library -----------------------------------------------------------

  function readLibrary() {
    try {
      return normalizeLibrary(JSON.parse(io.readFileSync(libFile, 'utf8')))
    } catch {
      return normalizeLibrary({})
    }
  }

  function writeLibrary(lib) {
    const normalized = normalizeLibrary(lib)
    io.mkdirSync(path.dirname(libFile), { recursive: true })
    io.writeFileSync(libFile, JSON.stringify(normalized, null, 2) + '\n')
    return normalized
  }

  // ---- global ------------------------------------------------------------

  function readGlobal() {
    if (!globalFilePath) return normalizeGlobal({})
    try {
      return normalizeGlobal(JSON.parse(io.readFileSync(globalFilePath, 'utf8')))
    } catch {
      return normalizeGlobal({})
    }
  }

  function writeGlobal(global) {
    if (!globalFilePath) throw serviceError('no-global-file', 'globalFile is not configured')
    const normalized = normalizeGlobal(global)
    io.mkdirSync(path.dirname(globalFilePath), { recursive: true })
    io.writeFileSync(globalFilePath, JSON.stringify(normalized, null, 2) + '\n')
    return normalized
  }

  // ---- scenes ------------------------------------------------------------

  function scanSoundsets() {
    const soundsets = []

    for (const entry of walkDirs(audioRoot, { skipDirNames: ['_library'] })) {
      if (isLibraryPath(entry.abs)) continue
      const configPath = path.join(entry.abs, 'config.json')
      if (!io.existsSync(configPath)) continue

      try {
        const raw = JSON.parse(io.readFileSync(configPath, 'utf8'))
        soundsets.push({ ...normalizeConfig(raw), dir: entry.rel })
      } catch {
        // Ignore unreadable/invalid configs so one bad pack cannot hide the rest.
      }
    }

    soundsets.sort((a, b) => a.name.localeCompare(b.name))
    return soundsets
  }

  function readSoundset(relDir) {
    const abs = resolveSoundsetDir(relDir)
    if (!abs) throw serviceError('unsafe-path', 'Unsafe soundset path')

    const configPath = path.join(abs, 'config.json')
    if (!io.existsSync(configPath)) throw serviceError('not-found', 'Soundset not found')

    try {
      const raw = JSON.parse(io.readFileSync(configPath, 'utf8'))
      return { ...normalizeConfig(raw), dir: toPosixPath(relDir) }
    } catch {
      throw serviceError('read-error', 'Could not read soundset')
    }
  }

  function writeSoundset(relDir, body) {
    const abs = resolveSoundsetDir(relDir)
    if (!abs) throw serviceError('unsafe-path', 'Unsafe soundset path')

    const config = normalizeConfig(body)
    io.mkdirSync(abs, { recursive: true })
    io.writeFileSync(path.join(abs, 'config.json'), JSON.stringify(config, null, 2) + '\n')
    return { ...config, dir: toPosixPath(relDir) }
  }

  function deleteSoundset(relDir) {
    const abs = resolveSoundsetDir(relDir)
    if (!abs) throw serviceError('unsafe-path', 'Unsafe soundset path')
    if (!io.existsSync(abs)) throw serviceError('not-found', 'Soundset not found')
    io.rmSync(abs, { recursive: true, force: true })
  }

  // Every config.json under the audio root, including configs inside the
  // library directory. Used by promotion and reference checks.
  function listConfigs() {
    const out = []

    const rootConfig = path.join(audioRoot, 'config.json')
    if (io.existsSync(rootConfig)) {
      out.push({ abs: rootConfig, dirAbs: audioRoot, rel: '' })
    }

    for (const entry of walkDirs(audioRoot)) {
      const configPath = path.join(entry.abs, 'config.json')
      if (!io.existsSync(configPath)) continue
      out.push({ abs: configPath, dirAbs: entry.abs, rel: entry.rel })
    }

    out.sort((a, b) => a.rel.localeCompare(b.rel))
    return out
  }

  // ---- promotion ---------------------------------------------------------

  function rewriteConfigFiles(config, baseDir, mapping) {
    let changed = false
    const elements = Array.isArray(config?.elements) ? config.elements : []

    for (const element of elements) {
      if (!isObj(element) || !Array.isArray(element.files)) continue
      element.files = element.files.map((file) => {
        if (typeof file !== 'string') return file
        const oldAbs = path.resolve(baseDir, file)
        const newAbs = mapping.get(oldAbs)
        if (!newAbs) return file
        changed = true
        return relativePosix(baseDir, newAbs)
      })
    }

    return changed
  }

  function rewriteLibraryFiles(groups, mapping) {
    for (const group of groups) {
      if (!Array.isArray(group.files)) continue
      group.files = group.files.map((file) => {
        if (typeof file !== 'string') return file
        const oldAbs = path.resolve(libDir, file)
        const newAbs = mapping.get(oldAbs)
        return newAbs ? relativePosix(libDir, newAbs) : file
      })
    }
  }

  function collectReferenced(updates, library) {
    const referenced = new Set()

    for (const [configPath, config] of updates) {
      const baseDir = path.dirname(configPath)
      for (const element of Array.isArray(config?.elements) ? config.elements : []) {
        if (!isObj(element) || !Array.isArray(element.files)) continue
        for (const file of element.files) {
          if (typeof file !== 'string') continue
          referenced.add(path.resolve(baseDir, file))
        }
      }
    }

    for (const group of library.groups) {
      for (const file of group.files) {
        if (typeof file !== 'string') continue
        referenced.add(path.resolve(libDir, file))
      }
    }

    return referenced
  }

  function snapshotFile(filePath) {
    if (!io.existsSync(filePath)) return null
    return io.readFileSync(filePath, 'utf8')
  }

  function pruneEmptyDirs(startDir, stopDir) {
    let dir = path.resolve(startDir)
    const stop = path.resolve(stopDir)
    while (dir !== stop && isInside(stop, dir)) {
      let entries
      try {
        entries = io.readdirSync(dir)
      } catch {
        break
      }
      if (entries.length) break
      try {
        io.rmdirSync(dir)
      } catch {
        break
      }
      dir = path.dirname(dir)
    }
  }

  function promote({ soundsetDir, elementId, category } = {}) {
    const copiedFiles = []
    const writtenFiles = []
    let destAbs = null

    try {
      if (typeof elementId !== 'string' || !elementId) {
        return { ok: false, code: 'invalid-element', error: 'Invalid element id' }
      }

      const sceneAbs = resolveSoundsetDir(soundsetDir)
      if (!sceneAbs) {
        return { ok: false, code: 'unsafe-path', error: 'Unsafe soundset path' }
      }
      if (isLibraryPath(sceneAbs)) {
        return { ok: false, code: 'unsafe-path', error: 'Cannot promote from the library' }
      }

      const sceneConfigPath = path.join(sceneAbs, 'config.json')
      if (!io.existsSync(sceneConfigPath)) {
        return { ok: false, code: 'not-found', error: 'Soundset not found' }
      }

      let rawScene
      try {
        rawScene = JSON.parse(io.readFileSync(sceneConfigPath, 'utf8'))
      } catch {
        return { ok: false, code: 'not-found', error: 'Could not read soundset' }
      }

      const scene = normalizeConfig(rawScene)
      const elementIndex = scene.elements.findIndex((element) => element.id === elementId)
      if (elementIndex === -1) {
        if (scene.includes.some((include) => include.id === elementId)) {
          return {
            ok: false,
            code: 'already-library',
            error: 'Element is already a library include',
          }
        }
        return { ok: false, code: 'not-found', error: 'Element not found in scene' }
      }

      const element = scene.elements[elementIndex]
      const parsedCategory = parseCategoryInput(category)
      if (!parsedCategory) {
        return { ok: false, code: 'invalid-category', error: 'Invalid library category' }
      }

      // Validate and deduplicate source files before copying anything.
      const sourceFiles = []
      const seenSources = new Set()
      for (const file of element.files) {
        if (typeof file !== 'string' || !file) {
          return { ok: false, code: 'invalid-file', error: 'Element contains an invalid file path' }
        }
        const sourceAbs = path.resolve(sceneAbs, file)
        if (!isInside(audioRoot, sourceAbs) || sourceAbs === audioRoot) {
          return { ok: false, code: 'unsafe-path', error: `Unsafe file path: ${file}` }
        }
        if (!io.existsSync(sourceAbs)) {
          return { ok: false, code: 'missing-file', error: `Missing file: ${file}` }
        }
        if (seenSources.has(sourceAbs)) continue
        seenSources.add(sourceAbs)
        sourceFiles.push(sourceAbs)
      }

      if (!sourceFiles.length) {
        return { ok: false, code: 'missing-file', error: 'Element has no files to promote' }
      }

      const groupSlug = slugify(element.name) || 'sound'
      const destRel = [parsedCategory.path, groupSlug].filter(Boolean).join('/')
      destAbs = resolveLibraryTarget(destRel)
      if (!destAbs) {
        return { ok: false, code: 'invalid-category', error: 'Invalid library destination' }
      }

      io.mkdirSync(destAbs, { recursive: true })

      const mapping = new Map()
      const groupFiles = []
      for (const sourceAbs of sourceFiles) {
        const targetAbs = uniquePath(destAbs, path.basename(sourceAbs))
        io.copyFileSync(sourceAbs, targetAbs)
        copiedFiles.push(targetAbs)
        mapping.set(sourceAbs, targetAbs)
        groupFiles.push(relativePosix(libDir, targetAbs))
      }

      const group = normalizeLibraryGroup({
        id: newId(),
        name: element.name,
        kind: element.kind,
        category: parsedCategory.label,
        tags: [],
        gain: element.gain,
        randomise: element.randomise,
        reverb: element.reverb,
        position: element.position,
        trigger: element.trigger,
        files: groupFiles,
      })

      const include = normalizeInclude({
        id: element.id,
        libraryId: group.id,
        overrides: {},
      })

      const nextScene = {
        ...scene,
        elements: scene.elements.filter((_, index) => index !== elementIndex),
        includes: [...scene.includes, include],
      }

      const originalLibrary = readLibrary()
      const nextLibrary = normalizeLibrary({
        version: originalLibrary.version,
        groups: [...originalLibrary.groups, group],
      })

      // Existing library groups may point at one of the source files too.
      rewriteLibraryFiles(nextLibrary.groups, mapping)

      const updates = new Map()
      for (const entry of listConfigs()) {
        let config
        if (entry.abs === sceneConfigPath) {
          config = nextScene
        } else {
          try {
            config = JSON.parse(io.readFileSync(entry.abs, 'utf8'))
          } catch {
            continue
          }
        }

        const changed = rewriteConfigFiles(config, entry.dirAbs, mapping)
        if (entry.abs === sceneConfigPath || changed) updates.set(entry.abs, config)
      }
      if (!updates.has(sceneConfigPath)) updates.set(sceneConfigPath, nextScene)

      const stillReferenced = collectReferenced(updates, nextLibrary)

      const writes = [{ path: libFile, value: nextLibrary }]
      for (const [configPath, config] of updates) {
        writes.push({ path: configPath, value: config })
      }

      for (const write of writes) {
        const original = snapshotFile(write.path)
        writtenFiles.push({ path: write.path, original })
        io.mkdirSync(path.dirname(write.path), { recursive: true })
        io.writeFileSync(write.path, JSON.stringify(write.value, null, 2) + '\n')
      }

      // Only now remove the originals. Anything still referenced stays.
      for (const sourceAbs of sourceFiles) {
        if (stillReferenced.has(sourceAbs)) continue
        try {
          io.unlinkSync(sourceAbs)
        } catch {
          // A failed cleanup leaves a harmless duplicate; never fail the move.
        }
        pruneEmptyDirs(path.dirname(sourceAbs), sceneAbs)
      }

      return {
        ok: true,
        library: nextLibrary,
        soundset: { ...nextScene, dir: toPosixPath(soundsetDir) },
        soundsetDir: toPosixPath(soundsetDir),
        group,
        warnings: [],
      }
    } catch (err) {
      // Restore every file we touched, newest first, then remove the copies.
      for (const write of writtenFiles.reverse()) {
        try {
          if (write.original === null) {
            if (io.existsSync(write.path)) io.unlinkSync(write.path)
          } else {
            io.mkdirSync(path.dirname(write.path), { recursive: true })
            io.writeFileSync(write.path, write.original)
          }
        } catch {
          // Keep trying the remaining rollback steps.
        }
      }

      for (const file of copiedFiles) {
        try {
          if (io.existsSync(file)) io.unlinkSync(file)
        } catch {
          // Best effort cleanup.
        }
      }

      if (destAbs) {
        try {
          pruneEmptyDirs(destAbs, libDir)
        } catch {
          // Best effort cleanup.
        }
      }

      return { ok: false, code: 'promote-failed', error: err.message || 'Promotion failed' }
    }
  }

  // ---- reference check ---------------------------------------------------

  function checkRefs() {
    const broken = []

    for (const entry of listConfigs()) {
      let config
      try {
        config = JSON.parse(io.readFileSync(entry.abs, 'utf8'))
      } catch {
        broken.push({ type: 'config', soundset: entry.rel, file: 'config.json' })
        continue
      }

      for (const element of Array.isArray(config?.elements) ? config.elements : []) {
        if (!isObj(element) || !Array.isArray(element.files)) continue
        for (const file of element.files) {
          if (typeof file !== 'string') continue
          const abs = path.resolve(entry.dirAbs, file)
          if (!isInside(audioRoot, abs) || !io.existsSync(abs)) {
            broken.push({
              type: 'scene',
              soundset: entry.rel,
              elementId: element.id,
              file,
            })
          }
        }
      }
    }

    const library = readLibrary()
    for (const group of library.groups) {
      for (const file of group.files) {
        if (typeof file !== 'string') continue
        const abs = path.resolve(libDir, file)
        if (!isInside(audioRoot, abs) || !io.existsSync(abs)) {
          broken.push({ type: 'library', groupId: group.id, group: group.name, file })
        }
      }
    }

    return broken
  }

  return {
    audioDir: audioRoot,
    libraryDir: libDir,
    libraryFile: libFile,
    globalFile: globalFilePath,
    isLibraryPath,
    resolveSoundsetDir,
    readLibrary,
    writeLibrary,
    readGlobal,
    writeGlobal,
    scanSoundsets,
    readSoundset,
    writeSoundset,
    deleteSoundset,
    listConfigs,
    listAudioFiles,
    promote,
    checkRefs,
  }
}
