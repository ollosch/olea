import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { createLibraryService } from '../lib/library-service.js'
import { normalizeConfig } from '../lib/schema.js'

function tempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'olea-'))
}

function writeFile(filePath, content = 'audio') {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, content)
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2) + '\n')
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'))
}

function element(id, name, files, extra = {}) {
  return {
    id,
    name,
    kind: 'oneshot',
    gain: 1,
    randomise: null,
    reverb: null,
    position: null,
    files,
    trigger: { min: 0, max: 0, startMin: 0, startMax: 0 },
    ...extra,
  }
}

function setup() {
  const root = tempRoot()
  const audioDir = path.join(root, 'audio')
  const libraryDir = path.join(audioDir, '_library')
  const libraryFile = path.join(root, 'library.json')

  writeFile(path.join(audioDir, 'Scene A', 'sounds', 'a.ogg'), 'original-a')
  writeFile(path.join(audioDir, 'Scene A', 'sounds', 'b.ogg'), 'original-b')
  writeFile(path.join(audioDir, 'Scene A', 'shared', 'x.ogg'), 'original-x')

  writeJson(path.join(audioDir, 'Scene A', 'config.json'), {
    version: 2,
    id: 'scene-a',
    name: 'Scene A',
    disabled: false,
    elements: [
      element('el-1', 'Carrion Crawler noises', ['sounds/a.ogg', 'sounds/b.ogg'], {
        kind: 'random',
        gain: 0.7,
        randomise: 'random',
        reverb: 'Cave',
        trigger: { min: 10, max: 30, startMin: 2, startMax: 10 },
      }),
      element('el-2', 'Shared sound', ['shared/x.ogg']),
    ],
    includes: [],
    hidden: [],
    moods: [
      { id: 'mood-1', name: 'Combat', params: { 'el-1': { plays: true, volume: 0.5 } } },
    ],
    midi: {
      notes: { '1:2': { type: 'random', elementId: 'el-1' } },
      ccs: {},
    },
    reviewed: true,
  })

  writeJson(path.join(audioDir, 'Scene B', 'config.json'), {
    version: 2,
    id: 'scene-b',
    name: 'Scene B',
    disabled: false,
    elements: [
      element('el-b1', 'Borrowed sounds', [
        '../Scene A/sounds/a.ogg',
        '../Scene A/shared/x.ogg',
      ]),
    ],
    includes: [],
    hidden: [],
    moods: [],
    midi: { notes: {}, ccs: {} },
    reviewed: true,
  })

  return { root, audioDir, libraryDir, libraryFile }
}

function makeService(paths) {
  return createLibraryService({
    audioDir: paths.audioDir,
    libraryDir: paths.libraryDir,
    libraryFile: paths.libraryFile,
  })
}

test('promote copies files, creates a group, preserves the instance id, and rewrites references', () => {
  const paths = setup()

  // Force a collision on the first destination file.
  writeFile(
    path.join(
      paths.libraryDir,
      'monsters',
      'carrion-crawler',
      'carrion-crawler-noises',
      'a.ogg'
    ),
    'already-here'
  )

  const service = makeService(paths)
  const result = service.promote({
    soundsetDir: 'Scene A',
    elementId: 'el-1',
    category: 'Monsters/Carrion Crawler',
  })

  assert.equal(result.ok, true, result.error)
  assert.equal(result.group.name, 'Carrion Crawler noises')
  assert.equal(result.group.kind, 'random')
  assert.equal(result.group.gain, 0.7)
  assert.equal(result.group.randomise, 'random')
  assert.equal(result.group.reverb, 'Cave')
  assert.equal(result.group.category, 'Monsters/Carrion Crawler')
  assert.deepEqual(result.group.tags, [])
  assert.notEqual(result.group.id, 'el-1')

  const dest = path.join(
    paths.libraryDir,
    'monsters',
    'carrion-crawler',
    'carrion-crawler-noises'
  )
  assert.equal(fs.readFileSync(path.join(dest, 'a-2.ogg'), 'utf8'), 'original-a')
  assert.equal(fs.readFileSync(path.join(dest, 'b.ogg'), 'utf8'), 'original-b')
  assert.equal(fs.readFileSync(path.join(dest, 'a.ogg'), 'utf8'), 'already-here')

  assert.deepEqual(result.group.files, [
    'monsters/carrion-crawler/carrion-crawler-noises/a-2.ogg',
    'monsters/carrion-crawler/carrion-crawler-noises/b.ogg',
  ])

  const library = readJson(paths.libraryFile)
  assert.equal(library.version, 2)
  assert.equal(library.groups.length, 1)
  assert.equal(library.groups[0].id, result.group.id)

  const sceneA = readJson(path.join(paths.audioDir, 'Scene A', 'config.json'))
  assert.equal(sceneA.elements.some((entry) => entry.id === 'el-1'), false)
  const include = sceneA.includes.find((entry) => entry.id === 'el-1')
  assert.ok(include)
  assert.equal(include.libraryId, result.group.id)
  assert.deepEqual(include.overrides, {
    gain: null,
    kind: null,
    trigger: null,
    reverb: null,
    randomise: null,
  })

  // The source files moved, but the unrelated shared file stayed in place.
  assert.equal(fs.existsSync(path.join(paths.audioDir, 'Scene A', 'sounds', 'a.ogg')), false)
  assert.equal(fs.existsSync(path.join(paths.audioDir, 'Scene A', 'sounds', 'b.ogg')), false)
  assert.equal(
    fs.readFileSync(path.join(paths.audioDir, 'Scene A', 'shared', 'x.ogg'), 'utf8'),
    'original-x'
  )

  const sceneB = readJson(path.join(paths.audioDir, 'Scene B', 'config.json'))
  assert.deepEqual(sceneB.elements[0].files, [
    '../_library/monsters/carrion-crawler/carrion-crawler-noises/a-2.ogg',
    '../Scene A/shared/x.ogg',
  ])

  assert.deepEqual(service.checkRefs(), [])
})

test('promotion rejects include instances and missing elements', () => {
  const paths = setup()
  const service = makeService(paths)

  assert.equal(
    service.promote({
      soundsetDir: 'Scene A',
      elementId: 'el-1',
      category: 'Monsters',
    }).ok,
    true
  )

  const again = service.promote({
    soundsetDir: 'Scene A',
    elementId: 'el-1',
    category: 'Monsters',
  })
  assert.equal(again.ok, false)
  assert.equal(again.code, 'already-library')

  const missing = service.promote({
    soundsetDir: 'Scene A',
    elementId: 'nope',
    category: 'Monsters',
  })
  assert.equal(missing.ok, false)
  assert.equal(missing.code, 'not-found')

  const unsafe = service.promote({
    soundsetDir: '../outside',
    elementId: 'el-1',
    category: 'Monsters',
  })
  assert.equal(unsafe.ok, false)
  assert.equal(unsafe.code, 'unsafe-path')
})

test('a failed config write rolls back copies, configs, and the library entry', () => {
  const paths = setup()
  const sceneConfig = path.join(paths.audioDir, 'Scene A', 'config.json')
  const originalScene = fs.readFileSync(sceneConfig, 'utf8')

  const failingFs = {
    ...fs,
    writeFileSync(filePath, ...args) {
      if (filePath === sceneConfig) throw new Error('simulated write failure')
      return fs.writeFileSync(filePath, ...args)
    },
  }

  const service = createLibraryService({
    audioDir: paths.audioDir,
    libraryDir: paths.libraryDir,
    libraryFile: paths.libraryFile,
    fs: failingFs,
  })

  const result = service.promote({
    soundsetDir: 'Scene A',
    elementId: 'el-1',
    category: 'Monsters/Carrion Crawler',
  })

  assert.equal(result.ok, false)
  assert.equal(result.code, 'promote-failed')
  assert.match(result.error, /simulated write failure/)

  assert.equal(fs.existsSync(paths.libraryFile), false)
  assert.equal(fs.readFileSync(sceneConfig, 'utf8'), originalScene)
  assert.equal(
    fs.readFileSync(path.join(paths.audioDir, 'Scene A', 'sounds', 'a.ogg'), 'utf8'),
    'original-a'
  )
  assert.equal(
    fs.readFileSync(path.join(paths.audioDir, 'Scene A', 'sounds', 'b.ogg'), 'utf8'),
    'original-b'
  )
  assert.equal(
    fs.existsSync(
      path.join(
        paths.libraryDir,
        'monsters',
        'carrion-crawler',
        'carrion-crawler-noises',
        'a.ogg'
      )
    ),
    false
  )

  const scene = readJson(sceneConfig)
  assert.equal(normalizeConfig(scene).elements.some((entry) => entry.id === 'el-1'), true)
})
