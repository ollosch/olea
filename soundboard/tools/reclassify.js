#!/usr/bin/env node
// Optional bulk reclassification of scene-local elements.
//
// Usage:
//   node soundboard/tools/reclassify.js [--apply] [--soundset <dir>]
//
// Dry-run is the default. Library includes are never touched.

import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import { ELEMENT_KINDS, normalizeConfig } from '../lib/schema.js'
import { suggestKind, suggestTrigger } from '../lib/heuristics.js'
import { isInside, toPosixPath } from '../lib/path-utils.js'
import { findConfigs, defaultPaths } from './migrate-v2.js'

function triggerIsZero(trigger) {
  if (!trigger || typeof trigger !== 'object') return true
  return ['min', 'max', 'startMin', 'startMax'].every((key) => !Number(trigger[key]))
}

function totalSize(dirAbs, files, root) {
  let size = 0
  for (const file of files) {
    if (typeof file !== 'string') continue
    const abs = path.resolve(dirAbs, file)
    if (!isInside(root, abs)) continue
    try {
      const stat = fs.statSync(abs)
      if (stat.isFile()) size += stat.size
    } catch {
      // Missing files contribute nothing, matching a heuristic scan.
    }
  }
  return size
}

export function reclassify({
  apply = false,
  soundset = null,
  audioDir,
  libraryDir,
} = {}) {
  const root = path.resolve(audioDir || defaultPaths().audioDir)
  const libDir = path.resolve(libraryDir || path.join(root, '_library'))
  const filter = soundset ? toPosixPath(String(soundset)).replace(/^\.\//, '').replace(/\/+$/, '') : null

  const configs = findConfigs(root).filter(
    (entry) => !(entry.dirAbs === libDir || isInside(libDir, entry.dirAbs))
  )

  const selected = filter ? configs.filter((entry) => entry.rel === filter) : configs
  const errors = []
  const changes = []
  let applied = 0

  if (filter && !selected.length) {
    return {
      ok: false,
      changes,
      applied,
      errors: [{ rel: filter, error: 'Soundset not found' }],
    }
  }

  for (const entry of selected) {
    let raw
    try {
      raw = JSON.parse(fs.readFileSync(entry.abs, 'utf8'))
    } catch (err) {
      errors.push({ rel: entry.rel, error: err.message })
      continue
    }

    const config = normalizeConfig(raw)
    const configChanges = []

    for (const element of config.elements) {
      const currentKind = ELEMENT_KINDS.includes(element.kind) ? element.kind : 'oneshot'
      const size = totalSize(entry.dirAbs, element.files, root)
      const suggested = suggestKind({
        name: element.name,
        fileCount: element.files.length,
        size,
        xmlKind: null,
      })

      if (suggested === currentKind) continue

      const change = {
        rel: entry.rel,
        elementId: element.id,
        name: element.name,
        from: currentKind,
        to: suggested,
        trigger: null,
      }

      if (suggested === 'random' && triggerIsZero(element.trigger)) {
        change.trigger = suggestTrigger('random')
      }

      configChanges.push(change)

      element.kind = suggested
      if (change.trigger) element.trigger = change.trigger
    }

    if (!configChanges.length) continue
    changes.push(...configChanges)

    if (apply) {
      try {
        fs.writeFileSync(entry.abs, JSON.stringify(config, null, 2) + '\n')
        applied += 1
      } catch (err) {
        errors.push({ rel: entry.rel, error: err.message })
      }
    }
  }

  return { ok: errors.length === 0, changes, applied, errors }
}

function parseArgs(argv) {
  const options = { apply: false, soundset: null, help: false }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--apply') options.apply = true
    else if (arg === '--soundset') {
      options.soundset = argv[i + 1] || null
      i += 1
    } else if (arg.startsWith('--soundset=')) {
      options.soundset = arg.slice('--soundset='.length)
    } else if (arg === '-h' || arg === '--help') {
      options.help = true
    } else {
      throw new Error(`Unknown argument: ${arg}`)
    }
  }
  return options
}

function main() {
  let options
  try {
    options = parseArgs(process.argv.slice(2))
  } catch (err) {
    console.error(err.message)
    console.error('Usage: node soundboard/tools/reclassify.js [--apply] [--soundset <dir>]')
    process.exitCode = 1
    return
  }

  if (options.help) {
    console.log('Usage: node soundboard/tools/reclassify.js [--apply] [--soundset <dir>]')
    console.log('  --apply             write the proposed changes (default: dry run)')
    console.log('  --soundset <dir>    only inspect one soundset directory')
    return
  }

  const summary = reclassify(options)
  for (const change of summary.changes) {
    const trigger = change.trigger
      ? ` trigger ${change.trigger.min}-${change.trigger.max}s / start ${change.trigger.startMin}-${change.trigger.startMax}s`
      : ''
    console.log(`${change.rel}: ${change.name} [${change.from} -> ${change.to}]${trigger}`)
  }

  if (!summary.changes.length) console.log('No reclassification changes.')
  console.log(
    `${options.apply ? 'Applied' : 'Would apply'} ${summary.changes.length} change(s) in ${summary.applied} config(s).`
  )

  for (const error of summary.errors) {
    console.error(`  ! ${error.rel || '(root)'}: ${error.error}`)
  }
  if (summary.errors.length) process.exitCode = 1
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
}
