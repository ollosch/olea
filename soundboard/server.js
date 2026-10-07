import express from 'express'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { parseSoundsetXml, generateSoundsetXml } from './xml.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const AUDIO_DIR = process.env.OLEA_AUDIO_DIR || path.join(__dirname, 'syrinscape')
const MAPPING_FILE = process.env.OLEA_MAPPING_FILE || path.join(__dirname, 'midi-mapping.json')
const LIBRARY_FILE = process.env.OLEA_LIBRARY_FILE || path.join(__dirname, 'library.json')
const DIST = path.join(__dirname, 'dist')
const PORT = Number(process.env.PORT) || 8091

const AUDIO_RE = /\.(ogg|mp3|wav)$/i

let cache = { at: 0, data: { soundsets: [] } }

function listFiles(dir) {
  try {
    return fs.readdirSync(path.join(AUDIO_DIR, dir)).filter((f) => AUDIO_RE.test(f))
  } catch {
    return []
  }
}

function listXml(dir) {
  try {
    return fs.readdirSync(path.join(AUDIO_DIR, dir)).filter((f) => f.toLowerCase().endsWith('.xml'))
  } catch {
    return []
  }
}

function uniqueIds(elements) {
  const seen = new Set()
  for (const el of elements) {
    let id = el.id || 'group'
    let n = 2
    while (seen.has(id)) id = `${el.id || 'group'}-${n++}`
    seen.add(id)
    el.id = id
  }
  return elements
}

function soundsetFromXml(dir, xmlFile, files) {
  const full = path.join(AUDIO_DIR, dir, xmlFile)
  let xml
  try {
    xml = fs.readFileSync(full, 'utf8')
  } catch {
    return null
  }
  const parsed = parseSoundsetXml(xml, files)
  if (!parsed || !parsed.elements.length) return null
  return {
    id: `${dir}::${path.basename(xmlFile, path.extname(xmlFile))}`,
    dir,
    name: parsed.title || xmlFile.replace(/\.xml$/i, ''),
    gain: parsed.gain || 1,
    hasXml: true,
    elements: uniqueIds(parsed.elements),
    moods: parsed.moods || [],
  }
}

function soundsetFromFiles(dir, files) {
  // Auto-generate an XML file on disk when the soundset is missing one, and
  // fall back to in-memory generation if the file can't be written.
  let xml = null
  let written = false
  try {
    xml = generateSoundsetXml(dir, files)
    const target = path.join(AUDIO_DIR, dir, `${dir}.generated.xml`)
    if (!fs.existsSync(target)) {
      fs.writeFileSync(target, xml)
      written = true
    }
  } catch {
    xml = null
  }
  const parsed = parseSoundsetXml(xml, files)
  if (!parsed || !parsed.elements.length) return null
  return {
    id: dir,
    dir,
    name: dir.replace(/^Syrinscape\s*-\s*/i, '').trim(),
    gain: 1,
    hasXml: written,
    elements: uniqueIds(parsed.elements),
    moods: parsed.moods || [],
  }
}

function scanLibrary() {
  const soundsets = []
  let dirs = []
  try {
    dirs = fs.readdirSync(AUDIO_DIR, { withFileTypes: true }).filter((e) => e.isDirectory())
  } catch {
    return { soundsets }
  }

  for (const e of dirs) {
    const files = listFiles(e.name)
    const xmls = listXml(e.name).filter((f) => !/\.generated\.xml$/i.test(f))

    if (xmls.length) {
      let made = false
      for (const x of xmls) {
        const ss = soundsetFromXml(e.name, x, files)
        if (ss) {
          soundsets.push(ss)
          made = true
        }
      }
      // XMLs exist but none resolved against the folder's audio (e.g. a
      // partial download) — fall back to filename heuristics.
      if (!made && files.length) {
        const ss = soundsetFromFiles(e.name, files)
        if (ss) soundsets.push(ss)
      }
    } else if (files.length) {
      const ss = soundsetFromFiles(e.name, files)
      if (ss) soundsets.push(ss)
    }
  }

  soundsets.sort((a, b) => a.name.localeCompare(b.name))
  return { soundsets }
}

function getLibrary() {
  const now = Date.now()
  if (now - cache.at < 5000) return cache.data
  cache = { at: now, data: scanLibrary() }
  return cache.data
}

// ---- user overlay (renames / hidden / added groups / custom soundsets) ----

function emptyOverlay() {
  return { renames: {}, hidden: {}, addedElements: {}, customSoundsets: [] }
}

function readOverlay() {
  try {
    const data = JSON.parse(fs.readFileSync(LIBRARY_FILE, 'utf8'))
    return Object.assign(emptyOverlay(), data)
  } catch {
    return emptyOverlay()
  }
}

function writeOverlay(overlay) {
  const clean = {
    renames: overlay?.renames || {},
    hidden: overlay?.hidden || {},
    addedElements: overlay?.addedElements || {},
    customSoundsets: overlay?.customSoundsets || [],
  }
  fs.writeFileSync(LIBRARY_FILE, JSON.stringify(clean, null, 2))
}

// Full file index used by the group editor's file picker.
function scanFiles() {
  const folders = []
  let dirs = []
  try {
    dirs = fs.readdirSync(AUDIO_DIR, { withFileTypes: true }).filter((e) => e.isDirectory())
  } catch {
    return { folders }
  }
  for (const d of dirs) {
    const files = listFiles(d.name).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
    if (!files.length) continue
    folders.push({
      dir: d.name,
      name: d.name.replace(/^Syrinscape\s*-\s*/i, '').trim(),
      files: files.map((f) => ({ name: f.replace(/\.(ogg|mp3|wav)$/i, ''), file: f })),
    })
  }
  folders.sort((a, b) => a.name.localeCompare(b.name))
  return { folders }
}

function readMapping() {
  try {
    return JSON.parse(fs.readFileSync(MAPPING_FILE, 'utf8'))
  } catch {
    return { notes: {}, ccs: {} }
  }
}

function writeMapping(mapping) {
  fs.writeFileSync(MAPPING_FILE, JSON.stringify(mapping ?? { notes: {}, ccs: {} }, null, 2))
}

const app = express()
app.use(express.json({ limit: '4mb' }))

app.get('/api/library', (req, res) => res.json({ ...getLibrary(), overlay: readOverlay() }))
app.post('/api/library', (req, res) => {
  try {
    writeOverlay(req.body)
    res.json({ ok: true })
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message })
  }
})
app.get('/api/files', (req, res) => res.json(scanFiles()))
app.get('/api/mapping', (req, res) => res.json(readMapping()))
app.post('/api/mapping', (req, res) => {
  writeMapping(req.body)
  res.json({ ok: true })
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
