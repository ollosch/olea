// Generate a minimal Syrinscape-style XML for every soundset folder that
// doesn't have one yet. Run manually with:
//   node sound/generate-xml.js
// (the server also auto-generates these on demand). Safe to re-run — existing
// XML files (including generated ones) are left untouched.
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { generateSoundsetXml } from './xml.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const AUDIO_DIR = process.env.OLEA_AUDIO_DIR || path.join(__dirname, '..', 'syrinscape')
const AUDIO_RE = /\.(ogg|mp3|wav)$/i

let dirs = []
try {
  dirs = fs.readdirSync(AUDIO_DIR, { withFileTypes: true }).filter((e) => e.isDirectory())
} catch {
  console.error(`Audio directory not found: ${AUDIO_DIR}`)
  process.exit(1)
}

let generated = 0
let skipped = 0
for (const d of dirs) {
  const dir = path.join(AUDIO_DIR, d.name)
  const files = fs.readdirSync(dir).filter((f) => AUDIO_RE.test(f))
  if (!files.length) continue
  const hasXml = fs.readdirSync(dir).some((f) => f.toLowerCase().endsWith('.xml'))
  if (hasXml) {
    skipped++
    continue
  }
  const target = path.join(dir, `${d.name}.generated.xml`)
  fs.writeFileSync(target, generateSoundsetXml(d.name, files))
  generated++
  console.log(`generated ${target}`)
}

console.log(`\nDone — generated ${generated}, skipped ${skipped} (already had an XML).`)
