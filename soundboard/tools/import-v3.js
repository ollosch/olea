#!/usr/bin/env node

// One-off v3 importer. Scans an audio tree, copies content-addressed blobs,
// persists the catalog, and merges proposed groups into the library.
//
// The importer is idempotent and never deletes or modifies source audio.

import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  applyProposal,
  excludeTargetDirs,
  ffprobeAvailable,
  importAudio,
  proposeGroups,
  scanSource,
} from '../lib/v3/import.js'
import { createStore } from '../lib/v3/store.js'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const HELP = `Usage: node tools/import-v3.js [options]

Options:
  --source <dir>   Source audio tree (default: <soundboard>/syrinscape)
  --data <dir>     Data directory (default: <soundboard>/data)
  --sounds <dir>   Content-addressed sounds directory (default: <soundboard>/sounds)
  --dry-run        Scan and print a preview without writing anything
  --no-duration    Do not run ffprobe even when it is available
  --no-groups      Import blobs/catalog only; do not propose or merge groups
  --limit <n>      Import at most n files (after scanning)
  --help, -h       Show this help

Source files are never deleted or modified. Re-running the importer is safe.`

function fail(message) {
  console.error(`error: ${message}`)
  process.exitCode = 1
}

function formatBytes(bytes) {
  const value = Number(bytes) || 0
  if (value < 1024) return `${value} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let size = value / 1024
  let unit = 0
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024
    unit += 1
  }
  return `${size.toFixed(1)} ${units[unit]}`
}

function parseArgs(argv) {
  const options = {
    source: path.join(ROOT, 'syrinscape'),
    data: path.join(ROOT, 'data'),
    sounds: path.join(ROOT, 'sounds'),
    dryRun: false,
    duration: true,
    groups: true,
    limit: Infinity,
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
        if (!Number.isFinite(limit) || limit <= 0) return { error: '--limit requires a positive number' }
        options.limit = Math.trunc(limit)
        break
      }
      case '--dry-run':
        options.dryRun = true
        break
      case '--no-duration':
        options.duration = false
        break
      case '--no-groups':
        options.groups = false
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

  const started = Date.now()
  const sourceDir = path.resolve(options.source)
  const dataDir = path.resolve(options.data)
  const soundsDir = path.resolve(options.sounds)

  let files
  try {
    files = await scanSource(sourceDir)
  } catch (err) {
    fail(`cannot scan ${sourceDir}: ${err?.message ?? err}`)
    return
  }

  files = excludeTargetDirs(files, [soundsDir, dataDir])
  if (Number.isFinite(options.limit)) files = files.slice(0, options.limit)
  const totalSize = files.reduce((sum, file) => sum + (Number(file.size) || 0), 0)

  console.log(`Source:  ${sourceDir}`)
  console.log(`Sounds:  ${soundsDir}`)
  console.log(`Data:    ${dataDir}`)
  console.log(`Found ${files.length} audio file(s), ${formatBytes(totalSize)}`)

  if (options.dryRun) {
    for (const file of files.slice(0, 10)) {
      console.log(`  ${file.rel} (${formatBytes(file.size)})`)
    }
    if (files.length > 10) console.log(`  ... and ${files.length - 10} more`)
    console.log('Dry run: no files written.')
    return
  }

  if (!files.length) {
    console.log('Nothing to import.')
    return
  }

  const store = createStore({ dataDir, soundsDir })
  await store.init()

  const probe = options.duration && ffprobeAvailable()
  let lastReported = 0

  const result = await importAudio({
    sourceDir,
    soundsDir,
    dataDir,
    catalog: store.catalog(),
    files,
    probeDuration: probe,
    durationConcurrency: 2,
    onProgress: ({ processed, total, added, duplicates, errors }) => {
      if (processed === total || processed - lastReported >= 250) {
        lastReported = processed
        console.error(
          `  ${processed}/${total} files (${added} new, ${duplicates} duplicates, ${errors} errors)`
        )
      }
    },
  })

  const soundRecords = result.files.map((file) => file.sound).filter(Boolean)
  const catalogResult = await store.addSounds(soundRecords)

  let groupResult = { created: 0, updated: 0 }
  if (options.groups) {
    const proposal = proposeGroups(result.files)
    groupResult = await applyProposal({ store, proposal })
  }

  const elapsed = ((Date.now() - started) / 1000).toFixed(1)
  console.log('')
  console.log(`Files processed: ${result.files.length}`)
  console.log(`New blobs:       ${catalogResult.added}`)
  console.log(`Duplicates:      ${result.duplicates}`)
  console.log(`Skipped:         ${result.skipped}`)
  console.log(`Errors:          ${result.errors.length}`)
  if (options.groups) {
    console.log(`Groups:          ${groupResult.created} created, ${groupResult.updated} updated`)
  }
  console.log(`Duration probe:  ${probe ? 'on' : 'off'}`)
  console.log(`Elapsed:         ${elapsed}s`)

  for (const error of result.errors.slice(0, 10)) {
    console.error(`  error: ${error.rel}: ${error.message || error.reason}`)
  }
  if (result.errors.length > 10) {
    console.error(`  ... ${result.errors.length - 10} more errors`)
  }
}

main().catch((err) => {
  console.error(err?.stack || String(err))
  process.exitCode = 1
})
