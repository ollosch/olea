#!/usr/bin/env node
// Manifest-driven bulk promotion into the shared library.
//
// Usage:
//   node soundboard/tools/promote-library.js <manifest.json> [--apply]
//
// The manifest is either an array or `{ "items": [...] }` of
// `{ soundsetDir, elementId, category }` entries. Dry-run is the default.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { createLibraryService } from '../lib/library-service.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const SOUNDBOARD_DIR = path.resolve(__dirname, '..')

function envPath(name, fallback) {
  const value = process.env[`OLEA_${name}`] || process.env[name]
  if (!value) return fallback
  return path.isAbsolute(value) ? value : path.resolve(value)
}

export function defaultServiceOptions() {
  const audioDir = envPath('AUDIO_DIR', path.join(SOUNDBOARD_DIR, 'syrinscape'))
  return {
    audioDir,
    libraryDir: envPath('LIBRARY_DIR', path.join(audioDir, '_library')),
    libraryFile: envPath('LIBRARY_FILE', path.join(SOUNDBOARD_DIR, 'library.json')),
    globalFile: envPath('GLOBAL_FILE', path.join(SOUNDBOARD_DIR, 'global.json')),
  }
}

export function loadManifest(manifestPath) {
  const raw = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
  const items = Array.isArray(raw) ? raw : Array.isArray(raw?.items) ? raw.items : null
  if (!items) throw new Error('Manifest must be an array or { "items": [...] }')
  return items
}

export function runPromotions({
  items,
  apply = false,
  serviceOptions = defaultServiceOptions(),
  log = console.log,
  errorLog = console.error,
} = {}) {
  const service = createLibraryService(serviceOptions)
  const results = []
  let failures = 0

  for (const item of items) {
    const label = `${item?.soundsetDir || '?'} / ${item?.elementId || '?'}`

    if (!item || typeof item.soundsetDir !== 'string' || typeof item.elementId !== 'string') {
      failures += 1
      const result = { item, ok: false, code: 'invalid-item', error: 'Invalid manifest item' }
      results.push(result)
      errorLog(`  ! ${label}: ${result.error}`)
      continue
    }

    if (!apply) {
      try {
        const soundset = service.readSoundset(item.soundsetDir)
        const element = soundset.elements.find((entry) => entry.id === item.elementId)
        if (!element) {
          failures += 1
          const result = {
            item,
            ok: false,
            code: 'not-found',
            error: 'Scene-local element not found',
          }
          results.push(result)
          errorLog(`  ! ${label}: ${result.error}`)
        } else {
          const result = { item, ok: true, dryRun: true, name: element.name }
          results.push(result)
          log(`Would promote ${label} (${element.name})`)
        }
      } catch (err) {
        failures += 1
        const result = { item, ok: false, code: err.code || 'error', error: err.message }
        results.push(result)
        errorLog(`  ! ${label}: ${result.error}`)
      }
      continue
    }

    const result = service.promote(item)
    results.push({ item, ...result })
    if (result.ok) {
      log(`Promoted ${label} -> ${result.group.category || '(uncategorised)'}/${result.group.name}`)
    } else {
      failures += 1
      errorLog(`  ! ${label}: ${result.error}`)
    }
  }

  return { ok: failures === 0, apply, promoted: results.filter((r) => r.ok).length, failures, results }
}

function parseArgs(argv) {
  const options = { manifest: null, apply: false, help: false }
  for (const arg of argv) {
    if (arg === '--apply') options.apply = true
    else if (arg === '-h' || arg === '--help') options.help = true
    else if (!options.manifest && !arg.startsWith('-')) options.manifest = arg
    else throw new Error(`Unknown argument: ${arg}`)
  }
  return options
}

function main() {
  let options
  try {
    options = parseArgs(process.argv.slice(2))
  } catch (err) {
    console.error(err.message)
    console.error('Usage: node soundboard/tools/promote-library.js <manifest.json> [--apply]')
    process.exitCode = 1
    return
  }

  if (options.help || !options.manifest) {
    console.log('Usage: node soundboard/tools/promote-library.js <manifest.json> [--apply]')
    console.log('  --apply   actually copy files and rewrite configs (default: dry run)')
    if (!options.manifest && !options.help) process.exitCode = 1
    return
  }

  let items
  try {
    items = loadManifest(path.resolve(options.manifest))
  } catch (err) {
    console.error(err.message)
    process.exitCode = 1
    return
  }

  const summary = runPromotions({ items, apply: options.apply })
  console.log(
    `${options.apply ? 'Promoted' : 'Would promote'} ${summary.promoted}/${items.length} item(s)` +
      (summary.failures ? `, ${summary.failures} failure(s)` : '')
  )
  if (summary.failures) process.exitCode = 1
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
}
