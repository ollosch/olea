// import.js — one-shot importer that turns a Syrinscape pack folder (XML + audio)
// into the soundboard's own config.json schema (see lib/schema.js).
//
// Usage:
//   node soundboard/import.js <folder>   import a single folder (absolute, or relative
//                                        to OLEA_AUDIO_DIR)
//   node soundboard/import.js            import every folder lacking a config.json
//
// Never overwrites an existing config.json. Re-running is idempotent.

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { parseSoundsetXml, elementsFromFiles } from './xml.js'
import { normalizeConfig, newId, REVERB_PRESETS } from './lib/schema.js'
import { suggestTrigger } from './lib/heuristics.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const AUDIO_DIR = process.env.OLEA_AUDIO_DIR || path.join(__dirname, 'syrinscape')

const AUDIO_RE = /\.(ogg|mp3|wav)$/i
const XML_RE = /\.xml$/i
const GENERATED_XML_RE = /\.generated\.xml$/i

// --- reverb normalization ---

const REVERB_ALIASES = {
  'stone corridor': 'Stone Dungeon',
  'carpetted hallway': 'Hallway',
  'carpeted hallway': 'Hallway',
  'concert hall': 'Auditorium',
  'metal room': 'Stone room',
  'flooded cavern': 'Cave',
  'sewer pipe': 'Cave',
  'vanilla room': 'Soft furnished room',
  'parking lot': 'City',
  underwater: 'Cave',
  hangar: 'Arena',
  quarry: 'Mountains',
  'padded cell': 'Soft furnished room',
  bathroom: 'Stone room',
}

function normalizeReverbName(raw) {
  if (typeof raw !== 'string') return null
  const name = raw.trim()
  if (!name || name.toLowerCase() === 'off') return null
  const alias = REVERB_ALIASES[name.toLowerCase()]
  if (alias) return alias
  const found = REVERB_PRESETS.find((p) => p.toLowerCase() === name.toLowerCase())
  return found || null
}

// --- naming helpers ---

function stripPrefix(name) {
  return String(name).replace(/^Syrinscape\s*-\s*/i, '').trim()
}

function safeFolderName(name) {
  const cleaned = String(name)
    .replace(/[/\\:*?"<>|]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\.+$/, '')
  return cleaned || 'chapter'
}

// Resolve a subfolder path under `parent` for a given base name. If a sibling
// already holds a config.json for this name, return it (done=true); otherwise
// return the next free name (appending -2, -3, ... on collision).
function resolveSubDir(parent, base) {
  const candidate = path.join(parent, base)
  if (fs.existsSync(path.join(candidate, 'config.json'))) return { path: candidate, done: true }
  if (!fs.existsSync(candidate)) return { path: candidate, done: false }
  let i = 2
  for (;;) {
    const c = path.join(parent, `${base}-${i}`)
    if (fs.existsSync(path.join(c, 'config.json'))) return { path: c, done: true }
    if (!fs.existsSync(c)) return { path: c, done: false }
    i++
  }
}

// --- element / mood mapping ---

function ensureTrigger(el) {
  const t = el.trigger || {}
  if (el.kind === 'random') {
    const values = [t.min, t.max, t.startMin, t.startMax].map(Number)
    if (!values.some((v) => Number.isFinite(v) && v > 0)) return suggestTrigger('random')
  }
  return t
}

function buildElements(parsed, prefix) {
  const slugToUuid = new Map()
  const elements = (parsed.elements || []).map((el) => {
    const uuid = newId()
    if (el.id) slugToUuid.set(el.id, uuid)
    return {
      id: uuid,
      name: el.name,
      kind: el.kind,
      gain: el.gain,
      randomise: el.randomise,
      reverb: normalizeReverbName(el.reverb),
      position: el.position || null,
      files: (el.files || []).map((f) => prefix + f.file),
      trigger: ensureTrigger(el),
    }
  })
  return { elements, slugToUuid }
}

function buildMoods(parsed, slugToUuid) {
  return (parsed.moods || []).map((mood) => {
    const params = {}
    for (const [slug, p] of Object.entries(mood.params || {})) {
      const uuid = slugToUuid.get(slug)
      if (!uuid) continue
      params[uuid] = { plays: p.plays, volume: p.volume }
    }
    return { id: newId(), name: mood.name, params }
  })
}

function readXml(dir, name) {
  return fs.readFileSync(path.join(dir, name), 'utf8')
}

function writeConfig(configPath, cfg) {
  fs.writeFileSync(configPath, JSON.stringify(normalizeConfig(cfg), null, 2) + '\n')
}

// --- import a single folder (absolute path) ---

function importFolder(dir, stats) {
  const configPath = path.join(dir, 'config.json')
  if (fs.existsSync(configPath)) {
    stats.skipped++
    console.log(`skipped ${dir} (config.json already exists)`)
    return
  }

  let entries
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch (err) {
    stats.skipped++
    console.log(`skipped ${dir} (unreadable: ${err.message})`)
    return
  }

  const audioFiles = entries
    .filter((e) => e.isFile() && AUDIO_RE.test(e.name))
    .map((e) => e.name)
  const fileSizes = {}
  for (const name of audioFiles) {
    try {
      fileSizes[name] = fs.statSync(path.join(dir, name)).size
    } catch {
      fileSizes[name] = undefined
    }
  }
  const xmlNames = entries
    .filter((e) => e.isFile() && XML_RE.test(e.name) && !GENERATED_XML_RE.test(e.name))
    .map((e) => e.name)

  if (!audioFiles.length && !xmlNames.length) {
    stats.skipped++
    console.log(`skipped ${dir} (no audio or xml)`)
    return
  }

  const basename = path.basename(dir)
  const fallbackName = stripPrefix(basename)

  // No XML: build elements from filename heuristics.
  if (xmlNames.length === 0) {
    const raw = elementsFromFiles(audioFiles, fileSizes)
    const { elements } = buildElements({ elements: raw, moods: [] }, '')
    writeConfig(configPath, { name: fallbackName, elements, moods: [], reviewed: false })
    stats.imported++
    console.log(`imported ${configPath}`)
    return
  }

  // Single XML: one soundscape written straight into the folder.
  if (xmlNames.length === 1) {
    const xmlString = readXml(dir, xmlNames[0])
    const parsed = parseSoundsetXml(xmlString, audioFiles)
    if (!parsed) {
      stats.skipped++
      console.log(`skipped ${dir} (unparseable xml: ${xmlNames[0]})`)
      return
    }
    const { elements, slugToUuid } = buildElements(parsed, '')
    const moods = buildMoods(parsed, slugToUuid)
    const name = parsed.title || fallbackName
    writeConfig(configPath, { name, elements, moods, reviewed: true })
    stats.imported++
    console.log(`imported ${configPath}`)
    return
  }

  // Multiple XMLs: a campaign container. Each XML becomes a subfolder; audio
  // lives in the parent, so element files get a "../" prefix.
  for (const xmlName of xmlNames) {
    const xmlString = readXml(dir, xmlName)
    const parsed = parseSoundsetXml(xmlString, audioFiles)
    if (!parsed) {
      stats.skipped++
      console.log(`skipped ${path.join(dir, xmlName)} (unparseable xml)`)
      continue
    }
    const name = parsed.title || stripPrefix(xmlName.replace(/\.xml$/i, ''))
    const { path: subDir, done } = resolveSubDir(dir, safeFolderName(name))
    if (done) {
      stats.skipped++
      console.log(`skipped ${subDir} (config.json already exists)`)
      continue
    }
    fs.mkdirSync(subDir, { recursive: true })
    const { elements, slugToUuid } = buildElements(parsed, '../')
    const moods = buildMoods(parsed, slugToUuid)
    writeConfig(path.join(subDir, 'config.json'), { name, elements, moods, reviewed: true })
    stats.imported++
    console.log(`imported ${path.join(subDir, 'config.json')}`)
  }
}

// --- walk mode ---

function walk() {
  let entries
  try {
    entries = fs.readdirSync(AUDIO_DIR, { withFileTypes: true })
  } catch {
    console.error(`Audio directory not found: ${AUDIO_DIR}`)
    process.exit(1)
  }
  const dirs = entries
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort()
  const stats = { imported: 0, skipped: 0 }
  for (const name of dirs) importFolder(path.join(AUDIO_DIR, name), stats)
  return stats
}

function main() {
  const args = process.argv.slice(2)
  const stats = { imported: 0, skipped: 0 }

  if (args.length === 0) {
    Object.assign(stats, walk())
  } else {
    const target = path.isAbsolute(args[0]) ? args[0] : path.join(AUDIO_DIR, args[0])
    let st = null
    try {
      st = fs.statSync(target)
    } catch {
      st = null
    }
    if (!st || !st.isDirectory()) {
      console.error(`Folder not found: ${target}`)
      process.exit(1)
    }
    importFolder(target, stats)
  }

  console.log(`\nDone — imported ${stats.imported}, skipped ${stats.skipped}.`)
}

main()
