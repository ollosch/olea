#!/usr/bin/env node

// One-off legacy v2 scene converter. Recreates every old `config.json` scene as
// a v3 scene and adds only the library groups needed for its element sounds.
//
// The converter is idempotent and never deletes source audio, scenes, or groups.

import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { importLegacyScenes } from '../lib/v3/scene-import.js'
import {
  defaultCatalog,
  defaultLibrary,
  normalizeCatalog,
  normalizeLibrary,
  normalizeScene,
} from '../lib/v3/schema.js'
import { createStore } from '../lib/v3/store.js'
import { catalogPath, libraryPath, readJson } from '../lib/v3/storage.js'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const HELP = `Usage: node tools/import-scenes-v2.js [options]

Options:
  --source <dir>       Legacy v2 source tree (default: <soundboard>/syrinscape)
  --data <dir>         v3 data directory (default: <soundboard>/data)
  --sounds <dir>       v3 content-addressed sounds directory (default: <soundboard>/sounds)
  --dry-run            Convert and report without writing anything
  --force              Update scenes that already exist
  --limit <n>          Convert at most n legacy scenes
  --concurrency <n>    File-hash concurrency (default: 8)
  --help, -h           Show this help

The converter reads legacy config.json files, recreates their scenes, and adds
only the library groups needed to preserve each element's sound set. Local MIDI
bindings are preserved. Re-running is safe and skips existing scenes unless
--force is used. The old global palette and global MIDI are not migrated.`

function fail(message) {
  console.error(`error: ${message}`)
  process.exitCode = 1
}

function parseArgs(argv) {
  const options = {
    source: path.join(ROOT, 'syrinscape'),
    data: path.join(ROOT, 'data'),
    sounds: path.join(ROOT, 'sounds'),
    dryRun: false,
    force: false,
    limit: 0,
    concurrency: 8,
    help: false,
  }

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    const equals = arg.startsWith('--') ? arg.indexOf('=') : -1
    const flag = equals >= 0 ? arg.slice(0, equals) : arg
    const inline = equals >= 0 ? arg.slice(equals + 1) : undefined
    const value = () => {
      if (inline !== undefined) return inline
      const next = argv[index + 1]
      if (next === undefined || (next.startsWith('--') && next !== '--')) return undefined
      index += 1
      return next
    }

    switch (flag) {
      case '--source': {
        const dir = value()
        if (!dir) return { error: '--source requires a directory' }
        options.source = dir
        break
      }
      case '--data': {
        const dir = value()
        if (!dir) return { error: '--data requires a directory' }
        options.data = dir
        break
      }
      case '--sounds': {
        const dir = value()
        if (!dir) return { error: '--sounds requires a directory' }
        options.sounds = dir
        break
      }
      case '--limit': {
        const raw = value()
        const limit = Number(raw)
        if (!Number.isFinite(limit) || limit <= 0) {
          return { error: '--limit requires a positive number' }
        }
        options.limit = Math.trunc(limit)
        break
      }
      case '--concurrency': {
        const raw = value()
        const concurrency = Number(raw)
        if (!Number.isFinite(concurrency) || concurrency <= 0) {
          return { error: '--concurrency requires a positive number' }
        }
        options.concurrency = Math.trunc(concurrency)
        break
      }
      case '--dry-run':
        options.dryRun = true
        break
      case '--force':
        options.force = true
        break
      case '--help':
      case '-h':
        options.help = true
        break
      default:
        return { error: `unknown option: ${arg}` }
    }
  }

  return { options }
}

// Read-only store facade used by --dry-run so previews never create default
// files or directories. Missing/corrupt JSON falls back to empty defaults.
async function openReadOnlyStore({ dataDir, soundsDir }) {
  const catalog = normalizeCatalog(await readJson(catalogPath(dataDir), defaultCatalog()))
  const library = normalizeLibrary(await readJson(libraryPath(dataDir), defaultLibrary()))
  const scenes = new Map()

  let entries = []
  try {
    entries = await fs.readdir(path.join(dataDir, 'scenes'), { withFileTypes: true })
  } catch {
    entries = []
  }

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) continue
    const id = entry.name.slice(0, -'.json'.length)
    const raw = await readJson(path.join(dataDir, 'scenes', entry.name), null)
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
      try {
        scenes.set(id, normalizeScene({ ...raw, id }))
      } catch {
        // Ignore corrupt scene files in a dry run.
      }
    }
  }

  const dryRunOnly = async () => {
    throw new Error('dry run cannot write')
  }

  return {
    catalog: () => catalog,
    library: () => library,
    scene: (id) => scenes.get(id) || null,
    saveLibrary: dryRunOnly,
    saveScene: dryRunOnly,
    dataDir,
    soundsDir,
  }
}

async function main() {
  const parsed = parseArgs(process.argv.slice(2))
  if (parsed.error) {
    fail(parsed.error)
    console.error(HELP)
    return
  }

  const options = parsed.options
  if (options.help) {
    console.log(HELP)
    return
  }

  const sourceDir = path.resolve(options.source)
  const dataDir = path.resolve(options.data)
  const soundsDir = path.resolve(options.sounds)

  let store
  if (options.dryRun) {
    store = await openReadOnlyStore({ dataDir, soundsDir })
  } else {
    store = createStore({ dataDir, soundsDir })
    await store.init()
  }

  console.log(`Source:      ${sourceDir}`)
  console.log(`Data:        ${dataDir}`)
  console.log(`Sounds:      ${soundsDir}`)

  const result = await importLegacyScenes({
    store,
    sourceDir,
    dryRun: options.dryRun,
    force: options.force,
    limit: options.limit,
    concurrency: options.concurrency,
    onProgress: ({ phase, processed, total }) => {
      if (!total || processed !== total) return
      if (phase === 'hash') console.error(`  hashed ${processed}/${total} unique files`)
      if (phase === 'scene') console.error(`  prepared ${processed}/${total} scenes`)
    },
  })

  console.log('')
  console.log(`Configs:         ${result.configs}`)
  console.log(`Scenes created:  ${result.scenesCreated}`)
  console.log(`Scenes updated:  ${result.scenesUpdated}`)
  console.log(`Scenes skipped:  ${result.scenesSkipped}`)
  console.log(`Groups created:  ${result.groupsCreated}`)
  console.log(`Tracks:          ${result.tracks}`)
  console.log(`Missing files:   ${result.missingFiles}`)
  console.log(`Warnings:        ${result.warnings}`)
  console.log(`Elapsed:         ${result.elapsed}s`)

  const details = Array.isArray(result.warningDetails) ? result.warningDetails : []
  for (const warning of details.slice(0, 10)) {
    const where = warning.scene ? `${warning.scene}: ` : ''
    console.error(`  warning: ${where}${warning.message || warning.type}`)
  }
  if (details.length > 10) {
    console.error(`  ... ${details.length - 10} more warnings`)
  }

  if (options.dryRun) console.log('Dry run: no files written.')
}

main().catch((err) => {
  console.error(err?.stack || String(err))
  process.exitCode = 1
})
