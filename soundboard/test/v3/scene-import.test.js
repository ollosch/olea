import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'

import { importAudio } from '../../lib/v3/import.js'
import {
  buildFileHashMap,
  importLegacyScenes,
  readLegacyConfigs,
  resolveLegacyFile,
  uuidFromString,
} from '../../lib/v3/scene-import.js'
import { newGroup } from '../../lib/v3/schema.js'
import { hashFile } from '../../lib/v3/storage.js'
import { createStore } from '../../lib/v3/store.js'
import { cleanup, makeStoreDirs } from './helpers.js'

const BIRDS = '11111111-1111-4111-8111-111111111111'
const SHARED = '22222222-2222-4222-8222-222222222222'
const HIDDEN = '33333333-3333-4333-8333-333333333333'
const MISSING = '44444444-4444-4444-8444-444444444444'
const BETA_BIRDS = '55555555-5555-4555-8555-555555555555'
const BETA_SHARED = '66666666-6666-4666-8666-666666666666'
const RAIN = '77777777-7777-4777-8777-777777777777'
const DUP_A = '88888888-8888-4888-8888-888888888888'
const DUP_B = '99999999-9999-4999-8999-999999999999'
const CALM = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const INTENSE = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const BETA_ID = '12121212-1212-4212-8212-121212121212'
const BIRDS_GROUP_ID = '99999999-0000-4000-8000-000000000001'

async function writeFile(file, content) {
  await fs.mkdir(path.dirname(file), { recursive: true })
  await fs.writeFile(file, content)
}

async function writeJson(file, value) {
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`)
}

async function buildFixture(t) {
  const dirs = await makeStoreDirs(t)
  const source = path.join(dirs.dir, 'source')

  for (const name of ['birds1', 'birds2', 'shared', 'rain', 'dup-a', 'dup-b', 'hidden']) {
    await writeFile(path.join(source, 'audio', `${name}.ogg`), `${name} bytes`)
  }

  await writeJson(path.join(source, 'alpha', 'config.json'), {
    version: 2,
    id: 'legacy-alpha',
    name: 'Alpha Scene',
    disabled: true,
    elements: [
      {
        id: BIRDS,
        name: 'Birds',
        kind: 'loop',
        gain: 0.8,
        randomise: 'shuffle',
        reverb: 'Cave',
        files: ['../audio/birds1.ogg', '../audio/birds2.ogg'],
        trigger: { min: 0, max: 0, startMin: 0, startMax: 0 },
      },
      {
        id: SHARED,
        name: 'Shared',
        kind: 'oneshot',
        gain: 0.5,
        randomise: 'inorder',
        reverb: 'Off',
        files: ['../audio/shared.ogg'],
        trigger: { min: 5, max: 10, startMin: 1, startMax: 2 },
      },
      {
        id: HIDDEN,
        name: 'Hidden',
        kind: 'loop',
        gain: 1,
        randomise: null,
        reverb: 'Cave',
        files: ['../audio/hidden.ogg'],
        trigger: { min: 0, max: 0, startMin: 0, startMax: 0 },
      },
      {
        id: MISSING,
        name: 'Missing',
        kind: 'oneshot',
        gain: 0.7,
        randomise: 'shuffle',
        reverb: null,
        files: ['../audio/nope.ogg'],
        trigger: { min: 0, max: 0, startMin: 0, startMax: 0 },
      },
    ],
    hidden: [HIDDEN],
    moods: [
      {
        id: CALM,
        name: 'Calm',
        params: {
          [BIRDS]: { plays: false, volume: 0.25 },
          [HIDDEN]: { plays: false, volume: 0.1 },
        },
      },
      {
        id: INTENSE,
        name: 'Intense',
        params: {
          [BIRDS]: { plays: true, volume: 0.5 },
          [SHARED]: { plays: true, volume: 0.8 },
        },
      },
    ],
    midi: {
      notes: {
        '9:40': { type: 'oneshot', elementId: SHARED, scope: 'local' },
        '9:41': { type: 'loop', elementId: BIRDS, scope: 'local' },
        '0:60': { type: 'mood', moodId: CALM, scope: 'local' },
        '0:61': { type: 'soundset', scope: 'local' },
        '0:62': { type: 'oneshot', elementId: HIDDEN, scope: 'local' },
      },
      ccs: {
        '9:7': { type: 'element', elementId: BIRDS, scope: 'local' },
        '9:8': { type: 'element', elementId: HIDDEN, scope: 'local' },
      },
    },
  })

  await writeJson(path.join(source, 'beta', 'config.json'), {
    version: 2,
    id: BETA_ID,
    name: 'Beta Scene',
    disabled: false,
    elements: [
      {
        id: BETA_BIRDS,
        name: 'birds',
        kind: 'random',
        gain: 1,
        randomise: 'shuffle',
        reverb: 'Forest',
        files: ['../audio/birds1.ogg', '../audio/birds2.ogg'],
        trigger: { min: 4, max: 8, startMin: 1, startMax: 2 },
      },
      {
        id: BETA_SHARED,
        name: 'Shared',
        kind: 'oneshot',
        gain: 0.5,
        randomise: 'inorder',
        reverb: 'Off',
        files: ['../audio/shared.ogg'],
        trigger: { min: 5, max: 10, startMin: 1, startMax: 2 },
      },
      {
        id: RAIN,
        name: 'Rain',
        kind: 'random',
        gain: 0.4,
        randomise: 'random',
        reverb: null,
        files: ['../audio/rain.ogg'],
        trigger: { min: 3, max: 9, startMin: 1, startMax: 2 },
      },
    ],
    moods: [],
    midi: { notes: {}, ccs: {} },
  })

  await writeJson(path.join(source, 'dup-a', 'config.json'), {
    version: 2,
    id: 'legacy-dup-a',
    name: 'Same Name',
    elements: [
      {
        id: DUP_A,
        name: 'Dup A',
        kind: 'oneshot',
        gain: 0.8,
        randomise: null,
        reverb: null,
        files: ['../audio/dup-a.ogg'],
        trigger: { min: 0, max: 0, startMin: 0, startMax: 0 },
      },
    ],
    hidden: [],
    moods: [],
    midi: {},
  })

  await writeJson(path.join(source, 'dup-b', 'config.json'), {
    version: 2,
    id: 'legacy-dup-b',
    name: 'Same Name',
    elements: [
      {
        id: DUP_B,
        name: 'Dup B',
        kind: 'loop',
        gain: 0.8,
        randomise: 'shuffle',
        reverb: 'Cave',
        files: ['../audio/dup-b.ogg'],
        trigger: { min: 0, max: 0, startMin: 0, startMax: 0 },
      },
    ],
    hidden: [],
    moods: [],
    midi: {},
  })

  // A directory without an elements array is ignored.
  await writeJson(path.join(source, 'not-a-scene', 'config.json'), { version: 2, name: 'Nope' })

  return { ...dirs, source }
}

async function seedStore(t, dirs, source) {
  const store = createStore({ dataDir: dirs.dataDir, soundsDir: dirs.soundsDir })
  await store.init()

  const imported = await importAudio({
    sourceDir: source,
    soundsDir: dirs.soundsDir,
    catalog: store.catalog(),
  })
  await store.addSounds(imported.files.map((file) => file.sound).filter(Boolean))

  const soundIdByName = new Map(imported.files.map((file) => [file.name, file.soundId]))
  const birds = newGroup({
    id: BIRDS_GROUP_ID,
    name: 'Birds',
    category: 'Existing',
    tags: ['keep'],
    sounds: [soundIdByName.get('birds2.ogg'), soundIdByName.get('birds1.ogg')],
    selection: 'random',
    defaultKind: 'loop',
    defaults: { gain: 0.9, reverb: 'Cave' },
    notes: 'keep',
  })
  await store.saveLibrary({ version: 3, groups: [birds] })

  return { store, imported, soundIdByName, birds }
}

test('legacy config discovery, path resolution, and hashing', async (t) => {
  const dirs = await buildFixture(t)
  t.after(() => cleanup(dirs.dir))

  assert.match(
    uuidFromString('same input'),
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
  )
  assert.equal(uuidFromString('same input'), uuidFromString('same input'))
  assert.notEqual(uuidFromString('a'), uuidFromString('b'))

  const configs = await readLegacyConfigs(dirs.source)
  assert.deepEqual(
    configs.map((item) => item.rel),
    ['alpha/config.json', 'beta/config.json', 'dup-a/config.json', 'dup-b/config.json']
  )

  const birdsAbs = path.join(dirs.source, 'audio', 'birds1.ogg')
  assert.equal(
    resolveLegacyFile(dirs.source, path.join(dirs.source, 'alpha'), '../audio/birds1.ogg'),
    birdsAbs
  )
  assert.equal(
    resolveLegacyFile(dirs.source, path.join(dirs.source, 'alpha'), '../../outside.ogg'),
    null
  )

  const result = await buildFileHashMap({ sourceDir: dirs.source, configs, concurrency: 2 })
  assert.equal(result.hashes.get(birdsAbs), await hashFile(birdsAbs))
  assert.equal(result.hashes.has(path.join(dirs.source, 'audio', 'hidden.ogg')), false)
  assert.equal(result.hashes.size, 6)
  assert.deepEqual(
    result.warnings.map((warning) => warning.type),
    ['missing-file']
  )
})

test('converts legacy scenes, reuses groups, preserves moods/MIDI, and is idempotent', async (t) => {
  const dirs = await buildFixture(t)
  t.after(() => cleanup(dirs.dir))
  const { store, soundIdByName, birds } = await seedStore(t, dirs, dirs.source)

  // Dry run must not write scenes or groups.
  const dry = await importLegacyScenes({ store, sourceDir: dirs.source, dryRun: true })
  assert.equal(dry.configs, 4)
  assert.equal(dry.scenesCreated, 4)
  assert.equal(dry.scenesUpdated, 0)
  assert.equal(dry.groupsCreated, 4)
  assert.equal(dry.tracks, 7)
  assert.equal(dry.missingFiles, 1)
  assert.equal(store.listScenes().length, 0)
  assert.equal(store.library().groups.length, 1)

  const first = await importLegacyScenes({ store, sourceDir: dirs.source, concurrency: 2 })
  assert.equal(first.configs, 4)
  assert.equal(first.scenesCreated, 4)
  assert.equal(first.scenesUpdated, 0)
  assert.equal(first.scenesSkipped, 0)
  assert.equal(first.groupsCreated, 4)
  assert.equal(first.tracks, 7)
  assert.equal(first.missingFiles, 1)
  assert.ok(first.warnings >= 1)

  const scenes = store.allScenes()
  assert.equal(scenes.length, 4)
  const byName = new Map(scenes.map((scene) => [scene.name, scene]))
  assert.deepEqual(
    scenes.map((scene) => scene.name).sort(),
    ['Alpha Scene', 'Beta Scene', 'Same Name (dup-a)', 'Same Name (dup-b)']
  )

  const alpha = byName.get('Alpha Scene')
  const beta = byName.get('Beta Scene')
  assert.ok(alpha)
  assert.ok(beta)
  assert.equal(alpha.disabled, true)
  assert.equal(beta.disabled, false)
  assert.equal(beta.id, BETA_ID)
  assert.match(alpha.id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)

  // Tracks keep array order and kinds; hidden/missing elements are skipped.
  assert.deepEqual(alpha.tracks.map((track) => track.kind), ['loop', 'oneshot'])
  assert.deepEqual(alpha.tracks.map((track) => track.order), [0, 1])
  assert.deepEqual(beta.tracks.map((track) => track.kind), ['random', 'oneshot', 'random'])
  assert.deepEqual(beta.tracks.map((track) => track.order), [0, 1, 2])

  // Existing group reuse is case-insensitive and mutates nothing. New groups are
  // reused across scenes by name + selection + sorted sound set.
  const birdsGroup = store.library().groups.find((group) => group.id === BIRDS_GROUP_ID)
  assert.ok(birdsGroup)
  assert.equal(birdsGroup.category, 'Existing')
  assert.deepEqual(birdsGroup.tags, ['keep'])
  assert.equal(birdsGroup.defaults.gain, 0.9)
  assert.equal(birdsGroup.notes, 'keep')
  assert.deepEqual(birdsGroup.sounds, birds.sounds)

  assert.equal(alpha.tracks[0].groupId, BIRDS_GROUP_ID)
  assert.equal(beta.tracks[0].groupId, BIRDS_GROUP_ID)
  const sharedGroups = store.library().groups.filter((group) => group.name === 'Shared')
  assert.equal(sharedGroups.length, 1)
  assert.equal(alpha.tracks[1].groupId, sharedGroups[0].id)
  assert.equal(beta.tracks[1].groupId, sharedGroups[0].id)
  assert.ok(!store.library().groups.some((group) => group.name === 'Hidden'))
  assert.ok(!store.library().groups.some((group) => group.name === 'Missing'))

  // Moods: ids/names preserved, plays/volume mapped, default falls back to the
  // first mood; no-mood scenes get a populated Default mood.
  assert.equal(alpha.moods.length, 2)
  assert.deepEqual(alpha.moods.map((mood) => mood.id), [CALM, INTENSE])
  assert.deepEqual(alpha.moods.map((mood) => mood.name), ['Calm', 'Intense'])
  assert.equal(alpha.defaultMoodId, CALM)

  const birdsTrackId = alpha.tracks[0].id
  const sharedTrackId = alpha.tracks[1].id
  const calm = alpha.moods[0].params
  const intense = alpha.moods[1].params
  assert.equal(calm[birdsTrackId].enabled, false)
  assert.equal(calm[birdsTrackId].gain, 0.25)
  assert.equal(calm[birdsTrackId].reverb, 'Cave')
  assert.equal(calm[sharedTrackId].enabled, true)
  assert.equal(calm[sharedTrackId].gain, 0.5)
  assert.deepEqual(calm[sharedTrackId].trigger, { min: 5, max: 10, startMin: 1, startMax: 2 })
  assert.equal(intense[birdsTrackId].enabled, true)
  assert.equal(intense[birdsTrackId].gain, 0.5)
  assert.equal(intense[sharedTrackId].enabled, true)
  assert.equal(intense[sharedTrackId].gain, 0.8)
  assert.equal(Object.keys(calm).length, 2)
  assert.equal(Object.keys(intense).length, 2)

  assert.equal(beta.moods.length, 1)
  assert.equal(beta.moods[0].name, 'Default')
  assert.equal(beta.defaultMoodId, beta.moods[0].id)
  assert.equal(Object.keys(beta.moods[0].params).length, 3)
  for (const track of beta.tracks) {
    assert.equal(beta.moods[0].params[track.id].enabled, true)
  }
  assert.equal(beta.moods[0].params[beta.tracks[1].id].gain, 0.5)
  assert.equal(beta.moods[0].params[beta.tracks[2].id].gain, 0.4)
  assert.deepEqual(beta.tracks[0].trigger, { min: 4, max: 8, startMin: 1, startMax: 2 })
  assert.deepEqual(beta.moods[0].params[beta.tracks[0].id].trigger, {
    min: 4,
    max: 8,
    startMin: 1,
    startMax: 2,
  })

  // Local MIDI keys/actions are converted; hidden/missing targets are dropped.
  assert.deepEqual(alpha.midi.notes['9:note:40'], {
    type: 'trackTrigger',
    trackId: sharedTrackId,
  })
  assert.deepEqual(alpha.midi.notes['9:note:41'], {
    type: 'trackTrigger',
    trackId: birdsTrackId,
  })
  assert.deepEqual(alpha.midi.notes['0:note:60'], { type: 'moodSelect', moodId: CALM })
  assert.deepEqual(alpha.midi.notes['0:note:61'], { type: 'sceneToggle' })
  assert.equal(alpha.midi.notes['0:note:62'], undefined)
  assert.deepEqual(alpha.midi.ccs['9:cc:7'], {
    type: 'trackVolume',
    trackId: birdsTrackId,
  })
  assert.equal(alpha.midi.ccs['9:cc:8'], undefined)

  // Rerunning without --force changes nothing.
  const libraryCount = store.library().groups.length
  const second = await importLegacyScenes({ store, sourceDir: dirs.source, concurrency: 2 })
  assert.equal(second.scenesCreated, 0)
  assert.equal(second.scenesUpdated, 0)
  assert.equal(second.scenesSkipped, 4)
  assert.equal(second.groupsCreated, 0)
  assert.equal(store.library().groups.length, libraryCount)
  assert.equal(store.scene(alpha.id).tracks[0].groupId, BIRDS_GROUP_ID)

  // --force updates existing scenes without duplicating groups.
  await store.saveScene(alpha.id, { ...store.scene(alpha.id), name: 'Changed' })
  const forced = await importLegacyScenes({
    store,
    sourceDir: dirs.source,
    force: true,
    concurrency: 2,
  })
  assert.equal(forced.scenesCreated, 0)
  assert.equal(forced.scenesUpdated, 4)
  assert.equal(forced.scenesSkipped, 0)
  assert.equal(forced.groupsCreated, 0)
  assert.equal(store.library().groups.length, libraryCount)
  assert.equal(store.scene(alpha.id).name, 'Alpha Scene')

  assert.ok(soundIdByName.get('hidden.ogg'))
})
