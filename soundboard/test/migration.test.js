import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { migrate } from '../tools/migrate-v2.js'

function tempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'olea-migrate-'))
}

function writeFile(filePath, content = '') {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, content)
}

function writeJson(filePath, value) {
  writeFile(filePath, JSON.stringify(value, null, 2) + '\n')
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'))
}

function allFiles(root) {
  const out = []
  function walk(dir) {
    let entries = []
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      const abs = path.join(dir, entry.name)
      if (entry.isDirectory()) walk(abs)
      else out.push(abs)
    }
  }
  walk(root)
  return out
}

function v1(id, sampleId) {
  return {
    version: 1,
    id,
    name: id,
    disabled: false,
    elements: [
      {
        id: sampleId,
        name: 'Noises',
        kind: 'random',
        gain: 2,
        randomise: 'random',
        reverb: null,
        position: null,
        files: ['noise.ogg'],
        trigger: { min: 10, max: 30, startMin: 2, startMax: 10 },
      },
    ],
    hidden: ['hidden-id'],
    moods: [
      {
        id: 'mood-' + id,
        name: 'Combat',
        params: { [sampleId]: { plays: true, volume: 3 } },
      },
    ],
    midi: {
      notes: { '1:2': { type: 'random', elementId: sampleId } },
      ccs: { '2:4': { type: 'element', elementId: sampleId } },
    },
  }
}

test('migrate writes v2 data, backups JSON only, and preserves IDs', () => {
  const root = tempRoot()
  const audioDir = path.join(root, 'audio')
  const globalFile = path.join(root, 'global.json')
  const libraryFile = path.join(root, 'library.json')
  const backupRoot = path.join(root, 'backup')

  writeJson(path.join(audioDir, 'Real Pack', 'config.json'), v1('scene-real', 'el-real'))
  writeFile(path.join(audioDir, 'Real Pack', 'Real.xml'), '<Chapter/>')
  writeFile(path.join(audioDir, 'Real Pack', 'noise.ogg'), 'audio')

  writeJson(path.join(audioDir, 'Generated Pack', 'config.json'), v1('scene-gen', 'el-gen'))
  writeFile(path.join(audioDir, 'Generated Pack', 'Only.generated.xml'), '<Chapter/>')

  writeJson(
    path.join(audioDir, 'Explicit Pack', 'config.json'),
    { ...v1('scene-explicit', 'el-explicit'), reviewed: false }
  )
  writeFile(path.join(audioDir, 'Explicit Pack', 'Real.xml'), '<Chapter/>')

  writeJson(globalFile, {
    version: 1,
    buses: { loop: 0, random: 2, effects: 0.5 },
    midi: {
      notes: { '9:40': { type: 'palette', paletteId: 'p1' } },
      ccs: { '0:8': { type: 'master' } },
    },
  })

  const summary = migrate({ audioDir, globalFile, libraryFile, backupRoot })
  assert.equal(summary.ok, true)
  assert.equal(summary.migrated, 3)
  assert.equal(summary.errors.length, 0)
  assert.equal(summary.backups, 4) // global + three configs; no library yet
  assert.ok(summary.backupDir)

  const real = readJson(path.join(audioDir, 'Real Pack', 'config.json'))
  assert.equal(real.version, 2)
  assert.equal(real.id, 'scene-real')
  assert.equal(real.elements[0].id, 'el-real')
  assert.equal(real.elements[0].gain, 1)
  assert.equal(real.moods[0].params['el-real'].volume, 1)
  assert.deepEqual(real.includes, [])
  assert.equal(real.reviewed, true)
  assert.deepEqual(real.hidden, ['hidden-id'])
  assert.deepEqual(real.midi.notes, { '1:2': { type: 'random', elementId: 'el-real' } })
  assert.deepEqual(real.midi.ccs, { '2:4': { type: 'element', elementId: 'el-real' } })

  const generated = readJson(path.join(audioDir, 'Generated Pack', 'config.json'))
  assert.equal(generated.version, 2)
  assert.equal(generated.id, 'scene-gen')
  assert.equal(generated.elements[0].id, 'el-gen')
  assert.equal(generated.elements[0].gain, 1)
  assert.equal(generated.reviewed, false)
  assert.deepEqual(generated.includes, [])

  const explicit = readJson(path.join(audioDir, 'Explicit Pack', 'config.json'))
  assert.equal(explicit.reviewed, false, 'an explicit reviewed flag must win over real XML')

  const global = readJson(globalFile)
  assert.equal(global.version, 2)
  assert.deepEqual(global.buses, { loop: 0, random: 1, effects: 0.5 })
  assert.deepEqual(global.palette, [])
  assert.deepEqual(global.midi.notes, { '9:40': { type: 'palette', paletteId: 'p1' } })
  assert.deepEqual(global.midi.ccs, { '0:8': { type: 'master' } })

  const library = readJson(libraryFile)
  assert.deepEqual(library, { version: 2, groups: [] })
  assert.equal(fs.existsSync(path.join(audioDir, '_library')), true)

  const backupFiles = allFiles(summary.backupDir)
  const configBackups = backupFiles.filter(
    (file) => path.basename(file) === 'config.json' && file.includes(`${path.sep}configs${path.sep}`)
  )
  assert.equal(configBackups.length, 3)
  assert.ok(backupFiles.includes(path.join(summary.backupDir, 'global.json')))
  assert.equal(backupFiles.some((file) => /\.(ogg|mp3|wav)$/i.test(file)), false)

  const rawBackup = configBackups
    .map((file) => readJson(file))
    .find((config) => config.id === 'scene-real')
  assert.equal(rawBackup.version, 1)
  assert.equal(rawBackup.elements[0].gain, 2)
})

test('--dry-run reports changes without writing anything', () => {
  const root = tempRoot()
  const audioDir = path.join(root, 'audio')
  const globalFile = path.join(root, 'global.json')
  const libraryFile = path.join(root, 'library.json')
  const backupRoot = path.join(root, 'backup')
  const configPath = path.join(audioDir, 'Pack', 'config.json')

  writeJson(configPath, v1('scene-dry', 'el-dry'))
  writeFile(path.join(audioDir, 'Pack', 'noise.ogg'), 'audio')
  const before = fs.readFileSync(configPath, 'utf8')

  const summary = migrate({
    dryRun: true,
    audioDir,
    globalFile,
    libraryFile,
    backupRoot,
  })

  assert.equal(summary.dryRun, true)
  assert.equal(summary.migrated, 1)
  assert.equal(summary.backupDir, null)
  assert.equal(summary.backups, 0)
  assert.equal(fs.existsSync(backupRoot), false)
  assert.equal(fs.existsSync(globalFile), false)
  assert.equal(fs.existsSync(libraryFile), false)
  assert.equal(fs.existsSync(path.join(audioDir, '_library')), false)
  assert.equal(fs.readFileSync(configPath, 'utf8'), before)
})
