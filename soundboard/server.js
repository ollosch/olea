import express from 'express'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { createLibraryService } from './lib/library-service.js'
import {
  AUDIO_RE,
  isInside,
  listAudioFiles,
  toPosixPath,
  walkDirs,
} from './lib/path-utils.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

function envPath(...names) {
  for (const name of names) {
    const value = process.env[name]
    if (value) return path.resolve(value)
  }
  return null
}

const AUDIO_DIR =
  envPath('OLEA_AUDIO_DIR', 'AUDIO_DIR') || path.join(__dirname, 'syrinscape')
const GLOBAL_FILE =
  envPath('OLEA_GLOBAL_FILE', 'GLOBAL_FILE') || path.join(__dirname, 'global.json')
const LIBRARY_FILE =
  envPath('OLEA_LIBRARY_FILE', 'LIBRARY_FILE') || path.join(__dirname, 'library.json')
const LIBRARY_DIR =
  envPath('OLEA_LIBRARY_DIR', 'LIBRARY_DIR') || path.join(AUDIO_DIR, '_library')
const DIST = path.join(__dirname, 'dist')
const PORT = Number(process.env.PORT) || 8091

const service = createLibraryService({
  audioDir: AUDIO_DIR,
  libraryDir: LIBRARY_DIR,
  libraryFile: LIBRARY_FILE,
  globalFile: GLOBAL_FILE,
})

// ---- in-process cache ---------------------------------------------------

let cache = null

function invalidateCache() {
  cache = null
}

function getData() {
  if (!cache) {
    cache = {
      soundsets: service.scanSoundsets(),
      library: service.readLibrary(),
      global: service.readGlobal(),
    }
  }
  return cache
}

// ---- file picker --------------------------------------------------------

function sceneName(dirName) {
  return dirName.replace(/^Syrinscape\s*-\s*/i, '').trim()
}

function filesWithSizes(dirAbs) {
  return listAudioFiles(dirAbs).map(({ file, size }) => ({
    name: file.replace(AUDIO_RE, ''),
    file,
    size,
  }))
}

function scanFiles() {
  const folders = []

  let dirs = []
  try {
    dirs = fs
      .readdirSync(AUDIO_DIR, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
  } catch {
    return folders
  }

  for (const entry of dirs) {
    const abs = path.join(AUDIO_DIR, entry.name)
    if (service.isLibraryPath(abs)) continue

    const files = filesWithSizes(abs)
    if (!files.length) continue
    folders.push({ dir: entry.name, name: sceneName(entry.name), files })
  }

  // Library folders are listed recursively below the library root.
  if (fs.existsSync(LIBRARY_DIR)) {
    const libraryDirs = [{ abs: LIBRARY_DIR, rel: '' }]
    for (const dir of walkDirs(LIBRARY_DIR)) libraryDirs.push(dir)

    for (const dir of libraryDirs) {
      if (!fs.existsSync(dir.abs) || !isInside(LIBRARY_DIR, dir.abs)) continue
      const files = filesWithSizes(dir.abs)
      if (!files.length) continue

      const rel = dir.rel
        ? `${path.basename(LIBRARY_DIR)}/${dir.rel}`
        : path.basename(LIBRARY_DIR)
      folders.push({
        dir: toPosixPath(rel),
        name: path.basename(dir.abs).replace(/-/g, ' '),
        files,
      })
    }
  }

  folders.sort((a, b) => a.name.localeCompare(b.name) || a.dir.localeCompare(b.dir))
  return folders
}

function statusFor(code) {
  if (code === 'already-library') return 409
  if (code === 'promote-failed') return 500
  return 400
}

const app = express()
app.use(express.json({ limit: '4mb' }))

app.get('/api/library', (req, res) => {
  const data = getData()
  res.json({ soundsets: data.soundsets, library: data.library, global: data.global })
})

app.get('/api/files', (req, res) => res.json({ folders: scanFiles() }))

app.get('/api/soundset/:id', (req, res) => {
  try {
    res.json(service.readSoundset(req.params.id))
  } catch (err) {
    const status = err.code === 'not-found' ? 404 : err.code === 'read-error' ? 500 : 400
    res.status(status).json({ error: err.message })
  }
})

app.post('/api/soundset/:id', (req, res) => {
  try {
    const soundset = service.writeSoundset(req.params.id, req.body)
    invalidateCache()
    res.json({ ok: true, soundset })
  } catch (err) {
    const status = err.code === 'unsafe-path' ? 400 : 500
    res.status(status).json({ ok: false, error: err.message })
  }
})

app.delete('/api/soundset/:id', (req, res) => {
  try {
    service.deleteSoundset(req.params.id)
    invalidateCache()
    res.json({ ok: true })
  } catch (err) {
    const status =
      err.code === 'not-found' ? 404 : err.code === 'unsafe-path' ? 400 : 500
    res.status(status).json({ error: err.message })
  }
})

app.get('/api/global', (req, res) => res.json(service.readGlobal()))

app.post('/api/global', (req, res) => {
  try {
    const global = service.writeGlobal(req.body)
    invalidateCache()
    res.json({ ok: true, global })
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message })
  }
})

app.post('/api/library', (req, res) => {
  try {
    const library = service.writeLibrary(req.body)
    invalidateCache()
    res.json({ ok: true, library })
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message })
  }
})

app.post('/api/library/promote', (req, res) => {
  try {
    const result = service.promote(req.body || {})
    if (!result.ok) {
      return res.status(statusFor(result.code)).json(result)
    }

    invalidateCache()
    const data = getData()
    res.json({
      ok: true,
      ...data,
      soundset: result.soundset,
      soundsetDir: result.soundsetDir,
      group: result.group,
      warnings: result.warnings,
    })
  } catch (err) {
    invalidateCache()
    res.status(500).json({ ok: false, error: err.message })
  }
})

app.get('/api/refs', (req, res) => {
  try {
    res.json({ ok: true, broken: service.checkRefs() })
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message })
  }
})

// Audio files — express.static streams with Range support (seeking).
app.use('/audio', express.static(AUDIO_DIR, { maxAge: '1h' }))

// Built frontend.
app.use(express.static(DIST))

// SPA fallback: any non-API/audio GET returns index.html.
app.use((req, res, next) => {
  if (req.method !== 'GET' || req.path.startsWith('/api/') || req.path.startsWith('/audio/')) {
    return next()
  }
  res.sendFile(path.join(DIST, 'index.html'), (err) => {
    if (err) res.status(404).end()
  })
})

app.listen(PORT, () => {
  console.log(`Olea soundboard listening on http://localhost:${PORT}`)
})
