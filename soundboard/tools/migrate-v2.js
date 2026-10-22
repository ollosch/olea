#!/usr/bin/env node
// Migrate v1 soundboard data to v2.
//
// Usage:
//   node soundboard/tools/migrate-v2.js [--dry-run]
//
// The tool copies JSON-only backups into soundboard/.migration-backup/<stamp>/
// before writing. `--dry-run` writes nothing at all, not even the backup.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import {
  normalizeConfig,
  normalizeGlobal,
  normalizeLibrary,
} from '../lib/schema.js'
import { isInside, walkDirs } from '../lib/path-utils.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
export const SOUNDBOARD_DIR = path.resolve(__dirname, '..')

function envPath(name, fallback) {
  const value = process.env[`OLEA_${name}`] || process.env[name]
  if (!value) return fallback
  return path.isAbsolute(value) ? value : path.resolve(value)
}

export function defaultPaths() {
  return {
    audioDir: envPath('AUDIO_DIR', path.join(SOUNDBOARD_DIR, 'syrinscape')),
    globalFile: envPath('GLOBAL_FILE', path.join(SOUNDBOARD_DIR, 'global.json')),
    libraryFile: envPath('LIBRARY_FILE', path.join(SOUNDBOARD_DIR, 'library.json')),
    backupRoot: path.join(SOUNDBOARD_DIR, '.migration-backup'),
  }
}

export function findConfigs(audioDir) {
  const root = path.resolve(audioDir)
  const configs = []

  const rootConfig = path.join(root, 'config.json')
  if (fs.existsSync(rootConfig)) {
    configs.push({ abs: rootConfig, dirAbs: root, rel: '' })
  }

  for (const entry of walkDirs(root)) {
    const configPath = path.join(entry.abs, 'config.json')
    if (!fs.existsSync(configPath)) continue
    configs.push({ abs: configPath, dirAbs: entry.abs, rel: entry.rel })
  }

  configs.sort((a, b) => a.rel.localeCompare(b.rel))
  return configs
}

// Real XML lives in the config's own folder or any ancestor up to AUDIO_DIR.
// Generated XML never counts as authoritative.
export function hasRealXml(dirAbs, audioDir) {
  const root = path.resolve(audioDir)
  let dir = path.resolve(dirAbs)

  while (true) {
    let names = []
    try {
      names = fs.readdirSync(dir)
    } catch {
      names = []
    }

    if (names.some((name) => /\.xml$/i.test(name) && !/\.generated\.xml$/i.test(name))) {
      return true
    }

    if (dir === root) break
    const parent = path.dirname(dir)
    if (parent === dir || !isInside(root, parent)) break
    dir = parent
  }

  return false
}

function safeSegment(segment) {
  const safe = String(segment)
    .replace(/[^a-zA-Z0-9._-]+/g, '_')
    .replace(/^[._-]+|[._-]+$/g, '')
  return safe || '_'
}

function backupConfigPath(backupDir, rel) {
  const parts = rel ? rel.split('/').map(safeSegment) : ['_root']
  return path.join(backupDir, 'configs', ...parts, 'config.json')
}

export function createBackup({ globalFile, libraryFile, configs, backupRoot }) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  let backupDir = path.join(backupRoot, stamp)
  let n = 1
  while (fs.existsSync(backupDir)) {
    backupDir = path.join(backupRoot, `${stamp}-${n}`)
    n += 1
  }
  fs.mkdirSync(backupDir, { recursive: true })

  const files = []
  for (const [source, name] of [
    [globalFile, 'global.json'],
    [libraryFile, 'library.json'],
  ]) {
    if (!source || !fs.existsSync(source)) continue
    const target = path.join(backupDir, name)
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.copyFileSync(source, target)
    files.push(target)
  }

  for (const config of configs) {
    const target = backupConfigPath(backupDir, config.rel)
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.copyFileSync(config.abs, target)
    files.push(target)
  }

  return { backupDir, files }
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2) + '\n')
}

export function migrate({
  dryRun = false,
  audioDir,
  globalFile,
  libraryFile,
  backupRoot,
} = {}) {
  const defaults = defaultPaths()
  const root = path.resolve(audioDir || defaults.audioDir)
  const globalPath = path.resolve(globalFile || defaults.globalFile)
  const libraryPath = path.resolve(libraryFile || defaults.libraryFile)
  const backupPath = path.resolve(backupRoot || defaults.backupRoot)

  const configs = findConfigs(root)
  const errors = []

  // Back up before parsing or writing anything. Dry-run never writes.
  let backup = null
  if (!dryRun) {
    backup = createBackup({
      globalFile: globalPath,
      libraryFile: libraryPath,
      configs,
      backupRoot: backupPath,
    })
  }

  const outputs = []
  let reviewedFalse = 0

  for (const config of configs) {
    let raw
    try {
      raw = JSON.parse(fs.readFileSync(config.abs, 'utf8'))
    } catch (err) {
      errors.push({ rel: config.rel, error: err.message })
      continue
    }

    const explicitReviewed = typeof raw.reviewed === 'boolean'
    const next = normalizeConfig(raw)
    next.reviewed = explicitReviewed ? raw.reviewed : hasRealXml(config.dirAbs, root)
    if (!next.reviewed) reviewedFalse += 1

    outputs.push({ abs: config.abs, rel: config.rel, value: next })
  }

  let global = normalizeGlobal({})
  try {
    if (fs.existsSync(globalPath)) {
      global = normalizeGlobal(JSON.parse(fs.readFileSync(globalPath, 'utf8')))
    }
  } catch (err) {
    errors.push({ rel: 'global.json', error: err.message })
  }

  let library = normalizeLibrary({})
  try {
    if (fs.existsSync(libraryPath)) {
      library = normalizeLibrary(JSON.parse(fs.readFileSync(libraryPath, 'utf8')))
    }
  } catch (err) {
    errors.push({ rel: 'library.json', error: err.message })
  }

  if (!dryRun) {
    for (const output of outputs) writeJson(output.abs, output.value)
    writeJson(globalPath, global)
    writeJson(libraryPath, library)
    fs.mkdirSync(path.join(root, '_library'), { recursive: true })
  }

  return {
    ok: errors.length === 0,
    dryRun,
    configs: configs.length,
    migrated: outputs.length,
    reviewedFalse,
    errors,
    backupDir: backup ? backup.backupDir : null,
    backups: backup ? backup.files.length : 0,
    global,
    library,
  }
}

function parseArgs(argv) {
  const options = { dryRun: false, help: false }
  for (const arg of argv) {
    if (arg === '--dry-run') options.dryRun = true
    else if (arg === '-h' || arg === '--help') options.help = true
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
    console.error('Usage: node soundboard/tools/migrate-v2.js [--dry-run]')
    process.exitCode = 1
    return
  }

  if (options.help) {
    console.log('Usage: node soundboard/tools/migrate-v2.js [--dry-run]')
    console.log('  --dry-run   report what would change without writing anything')
    return
  }

  const summary = migrate({ dryRun: options.dryRun })
  console.log(
    `${options.dryRun ? 'Would migrate' : 'Migrated'} ${summary.migrated}/${summary.configs} configs` +
      ` (${summary.reviewedFalse} marked for review)`
  )
  if (summary.backupDir) {
    console.log(`Backup: ${summary.backupDir} (${summary.backups} files)`)
  } else {
    console.log('Dry run: no files written')
  }
  if (summary.errors.length) {
    for (const error of summary.errors) {
      console.error(`  ! ${error.rel || '(root)'}: ${error.error}`)
    }
    process.exitCode = 1
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
}
