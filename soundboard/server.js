import express from 'express'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { normalizeConfig, normalizeGlobal } from './lib/schema.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const AUDIO_DIR = process.env.OLEA_AUDIO_DIR || path.join(__dirname, 'syrinscape')
const GLOBAL_FILE = process.env.OLEA_GLOBAL_FILE || path.join(__dirname, 'global.json')
const DIST = path.join(__dirname, 'dist')
const PORT = Number(process.env.PORT) || 8091

const AUDIO_RE = /\.(ogg|mp3|wav)$/i

// ---- path safety ----

function resolveSoundsetDir(id) {
  if (typeof id !== 'string' || !id) return null
  if (id.includes('\0')) return null
  if (path.isAbsolute(id)) return null
  const target = path.normalize(path.join(AUDIO_DIR, id))
  const base = AUDIO_DIR.endsWith(path.sep) ? AUDIO_DIR : AUDIO_DIR + path.sep
  if (target === AUDIO_DIR) return null
  if (!target.startsWith(base)) return null
  return target
}

// ---- library scan (recursive) ----

function readConfig(configPath, dir) {
  try {
    const raw = JSON.parse(fs.readFileSync(configPath, 'utf8'))
    return { ...normalizeConfig(raw), dir }
  } catch {
    return null
  }
}

function walkSoundsets(dirAbs, rel, out) {
  let entries
  try {
    entries = fs.readdirSync(dirAbs, { withFileTypes: true })
  } catch {
    return
  }
  for (const e of entries) {
    if (!e.isDirectory()) continue
    const abs = path.join(dirAbs, e.name)
    const childRel = rel ? `${rel}/${e.name}` : e.name
    const configPath = path.join(abs, 'config.json')
    if (fs.existsSync(configPath)) {
      const ss = readConfig(configPath, childRel)
      if (ss) out.push(ss)
    }
    walkSoundsets(abs, childRel, out)
  }
}

function scanSoundsets() {
  const soundsets = []
  if (!fs.existsSync(AUDIO_DIR)) return soundsets
  walkSoundsets(AUDIO_DIR, '', soundsets)
  soundsets.sort((a, b) => a.name.localeCompare(b.name))
  return soundsets
}

function readGlobal() {
  try {
    const raw = JSON.parse(fs.readFileSync(GLOBAL_FILE, 'utf8'))
    return normalizeGlobal(raw)
  } catch {
    return normalizeGlobal({})
  }
}

// ---- in-process cache ----

let cache = null

function invalidateCache() {
  cache = null
}

function getLibrary() {
  if (!cache) {
    cache = { at: Date.now(), soundsets: scanSoundsets(), global: readGlobal() }
  }
  return cache
}

// ---- file picker scan (top-level only) ----

function listAudio(dir) {
  try {
    return fs.readdirSync(path.join(AUDIO_DIR, dir)).filter((f) => AUDIO_RE.test(f))
  } catch {
    return []
  }
}

function scanFiles() {
  const folders = []
  let dirs = []
  try {
    dirs = fs.readdirSync(AUDIO_DIR, { withFileTypes: true }).filter((e) => e.isDirectory())
  } catch {
    return folders
  }
  for (const d of dirs) {
    const files = listAudio(d.name).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
    if (!files.length) continue
    folders.push({
      dir: d.name,
      name: d.name.replace(/^Syrinscape\s*-\s*/i, '').trim(),
      files: files.map((f) => ({ name: f.replace(AUDIO_RE, ''), file: f })),
    })
  }
  folders.sort((a, b) => a.name.localeCompare(b.name))
  return folders
}

const app = express()
app.use(express.json({ limit: '4mb' }))

app.get('/api/library', (req, res) => {
  const lib = getLibrary()
  res.json({ soundsets: lib.soundsets, global: lib.global })
})

app.get('/api/files', (req, res) => res.json({ folders: scanFiles() }))

app.get('/api/soundset/:id', (req, res) => {
  const dir = resolveSoundsetDir(req.params.id)
  if (!dir) return res.status(400).json({ error: 'not found' })
  const configPath = path.join(dir, 'config.json')
  if (!fs.existsSync(configPath)) return res.status(404).json({ error: 'not found' })
  const ss = readConfig(configPath, req.params.id)
  if (!ss) return res.status(500).json({ error: 'read error' })
  res.json(ss)
})

app.post('/api/soundset/:id', (req, res) => {
  const dir = resolveSoundsetDir(req.params.id)
  if (!dir) return res.status(400).json({ ok: false, error: 'unsafe path' })
  try {
    fs.mkdirSync(dir, { recursive: true })
    const cfg = normalizeConfig(req.body)
    fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify(cfg, null, 2) + '\n')
    invalidateCache()
    res.json({ ok: true, soundset: { ...cfg, dir: req.params.id } })
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message })
  }
})

app.delete('/api/soundset/:id', (req, res) => {
  const dir = resolveSoundsetDir(req.params.id)
  if (!dir) return res.status(400).json({ error: 'not found' })
  if (!fs.existsSync(dir)) return res.status(404).json({ error: 'not found' })
  try {
    fs.rmSync(dir, { recursive: true, force: true })
    invalidateCache()
    res.json({ ok: true })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

app.get('/api/global', (req, res) => res.json(readGlobal()))

app.post('/api/global', (req, res) => {
  try {
    const g = normalizeGlobal(req.body)
    fs.mkdirSync(path.dirname(GLOBAL_FILE), { recursive: true })
    fs.writeFileSync(GLOBAL_FILE, JSON.stringify(g, null, 2) + '\n')
    invalidateCache()
    res.json({ ok: true, global: g })
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message })
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
