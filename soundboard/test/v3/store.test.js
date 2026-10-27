import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'

import { createStore } from '../../lib/v3/store.js'
import {
  catalogPath,
  globalPath,
  libraryPath,
  readJson,
  scenePath,
} from '../../lib/v3/storage.js'
import { makeStoreDirs, seedCatalog, soundFixture } from './helpers.js'

async function setup(t, ids = ['s1', 's2', 's3', 's4', 's5']) {
  const dirs = await makeStoreDirs(t)
  const sounds = ids.map((id) => soundFixture(id))
  await seedCatalog(dirs.dataDir, sounds)
  const store = createStore({ dataDir: dirs.dataDir, soundsDir: dirs.soundsDir })
  await store.init()
  return { ...dirs, store, sounds }
}

test('init creates default files and the scenes directory', async (t) => {
  const { dataDir, soundsDir } = await makeStoreDirs(t)
  const store = createStore({ dataDir, soundsDir })
  await store.init()

  assert.equal(store.catalog().version, 3)
  assert.deepEqual(store.catalog().sounds, [])
  assert.deepEqual(store.library().groups, [])
  assert.equal(store.global().master, 0.8)
  assert.deepEqual(store.listScenes(), [])
  assert.equal((await fs.stat(path.join(dataDir, 'scenes'))).isDirectory(), true)
  assert.deepEqual(await readJson(catalogPath(dataDir), null), { version: 3, sounds: [] })
  assert.deepEqual(await readJson(libraryPath(dataDir), null), { version: 3, groups: [] })
  assert.equal((await readJson(globalPath(dataDir), null)).master, 0.8)
})

test('group CRUD validates sounds, persists, and prunes the palette on delete', async (t) => {
  const { store, dataDir } = await setup(t)

  const group = await store.createGroup({
    name: 'Dogs',
    category: 'Creatures/Dogs',
    tags: ['animal'],
    sounds: ['s1', 's2'],
    selection: 'ordered',
    defaultKind: 'random',
    defaults: { gain: 0.4, reverb: 'Cave', pan: -0.2, trigger: { min: 5, max: 10, startMin: 1, startMax: 2 } },
  })
  assert.equal(group.sounds.length, 2)
  assert.equal((await readJson(libraryPath(dataDir), null)).groups.length, 1)

  await assert.rejects(
    () => store.createGroup({ name: 'Bad', sounds: ['missing'] }),
    (err) => {
      assert.equal(err.code, 'validation')
      assert.equal(err.errors[0].type, 'missing-sound')
      return true
    }
  )
  await assert.rejects(
    () => store.createGroup({ id: group.id, name: 'Duplicate', sounds: ['s1'] }),
    (err) => err.code === 'conflict'
  )

  const updated = await store.updateGroup(group.id, { name: 'Canines', defaults: { gain: 0.5 } })
  assert.equal(updated.name, 'Canines')
  assert.equal(updated.defaults.gain, 0.5)
  assert.equal(updated.defaults.reverb, 'Cave')
  assert.deepEqual(updated.defaults.trigger, { min: 5, max: 10, startMin: 1, startMax: 2 })
  assert.deepEqual(updated.tags, ['animal'])

  const added = await store.addGroupSounds(group.id, ['s3', 's2'])
  assert.deepEqual(added.sounds, ['s1', 's2', 's3'])
  const removed = await store.removeGroupSounds(group.id, ['s2'])
  assert.deepEqual(removed.sounds, ['s1', 's3'])

  await store.saveGlobal({
    master: 0.5,
    palette: [{ id: 'p1', groupId: group.id, label: 'Pads', gain: null, order: 0 }],
  })
  const deleted = await store.deleteGroup(group.id)
  assert.equal(deleted.paletteRemoved, 1)
  assert.equal(deleted.group.id, group.id)
  assert.deepEqual(store.library().groups, [])
  assert.deepEqual(store.global().palette, [])
  assert.equal((await readJson(globalPath(dataDir), null)).palette.length, 0)
})

test('merge, split, bulk update, and create-from-sounds', async (t) => {
  const { store } = await setup(t)

  const first = await store.createGroup({
    name: 'A',
    category: 'Cat/A',
    tags: ['one'],
    sounds: ['s1', 's2'],
    selection: 'ordered',
    defaultKind: 'loop',
    defaults: { gain: 0.3, reverb: 'Cave' },
  })
  const second = await store.createGroup({
    name: 'B',
    category: 'Cat/B',
    tags: ['two', 'ONE'],
    sounds: ['s2', 's3'],
    defaults: { gain: 0.9 },
  })
  await store.saveGlobal({ palette: [{ id: 'p1', groupId: second.id }] })

  const merged = await store.mergeGroups({ groupIds: [first.id, second.id], name: 'Merged' })
  assert.equal(merged.group.name, 'Merged')
  assert.equal(merged.group.category, 'Cat/A')
  assert.deepEqual(merged.group.sounds, ['s1', 's2', 's3'])
  assert.deepEqual(merged.group.tags, ['one', 'two'])
  assert.deepEqual(merged.removedIds, [second.id])
  assert.equal(merged.paletteRemoved, 1)
  assert.equal(store.library().groups.length, 1)

  const split = await store.splitGroup({
    groupId: merged.group.id,
    soundIds: ['s2'],
    name: 'Split',
    tags: ['new'],
  })
  assert.deepEqual(split.group.sounds, ['s2'])
  assert.deepEqual(split.source.sounds, ['s1', 's3'])
  assert.equal(split.group.selection, merged.group.selection)
  assert.equal(split.group.defaultKind, merged.group.defaultKind)
  assert.equal(split.group.defaults.gain, merged.group.defaults.gain)
  assert.equal(split.group.defaults.reverb, merged.group.defaults.reverb)
  assert.deepEqual(split.group.tags, ['new'])
  assert.equal(store.library().groups.length, 2)

  const bulk = await store.bulkUpdateGroups([split.source.id, split.group.id], {
    category: 'Cat/Bulk',
    addTags: ['added'],
    removeTags: ['ONE'],
    selection: 'random',
    defaultKind: 'oneshot',
    defaults: { gain: 0.7, trigger: { min: 2, max: 4 } },
  })
  assert.equal(bulk.groups.length, 2)
  for (const group of bulk.groups) {
    assert.equal(group.category, 'Cat/Bulk')
    assert.ok(group.tags.includes('added'))
    assert.ok(!group.tags.some((tag) => tag.toLowerCase() === 'one'))
    assert.equal(group.selection, 'random')
    assert.equal(group.defaultKind, 'oneshot')
    assert.equal(group.defaults.gain, 0.7)
    assert.equal(group.defaults.reverb, 'Cave')
    assert.deepEqual(group.defaults.trigger, { min: 2, max: 4, startMin: 0, startMax: 0 })
  }

  const fromSounds = await store.createGroupsFromSounds({
    soundIds: ['s4', 's5'],
    name: 'From sounds',
    category: 'Cat/From',
    tags: ['x'],
  })
  assert.deepEqual(fromSounds.sounds, ['s4', 's5'])
  assert.equal(store.library().groups.length, 3)

  await assert.rejects(
    () => store.splitGroup({ groupId: split.source.id, soundIds: ['s5'] }),
    (err) => err.code === 'validation' && err.errors[0].type === 'sound-not-in-group'
  )
  await assert.rejects(
    () => store.createGroupsFromSounds({ soundIds: ['missing'], name: 'Bad' }),
    (err) => err.code === 'validation'
  )
  await assert.rejects(
    () => store.bulkUpdateGroups(['missing'], { category: 'X' }),
    (err) => err.code === 'not-found'
  )
})

test('scene create/save validates references and default mood', async (t) => {
  const { store, dataDir } = await setup(t, ['s1', 's2'])
  const group = await store.createGroup({ name: 'Dogs', sounds: ['s1'] })

  const scene = await store.createScene({ name: 'Station' })
  assert.equal(scene.name, 'Station')
  assert.equal(scene.moods.length, 1)
  assert.equal(scene.moods[0].name, 'Default')
  assert.equal(scene.defaultMoodId, scene.moods[0].id)
  assert.deepEqual(scene.tracks, [])
  assert.deepEqual(await readJson(scenePath(dataDir, scene.id), null), scene)

  const track = { id: 't1', groupId: group.id, kind: 'loop', order: 0 }
  const saved = await store.saveScene(scene.id, {
    ...scene,
    tracks: [track],
    moods: [{ ...scene.moods[0], params: { t1: { gain: 0.4 } } }],
  })
  assert.equal(saved.tracks.length, 1)
  assert.equal(saved.tracks[0].groupId, group.id)
  assert.equal(saved.moods[0].params.t1.gain, 0.4)

  await assert.rejects(
    () =>
      store.saveScene(scene.id, {
        ...saved,
        tracks: [{ id: 't2', groupId: 'missing', kind: 'loop', order: 0 }],
      }),
    (err) => {
      assert.equal(err.code, 'validation')
      assert.ok(err.errors.some((error) => error.type === 'missing-group'))
      return true
    }
  )

  await store.saveLibrary({
    groups: [...store.library().groups, { id: 'gbad', name: 'Bad', sounds: ['missing-sound'] }],
  })
  await assert.rejects(
    () =>
      store.saveScene(scene.id, {
        ...saved,
        tracks: [{ id: 't3', groupId: 'gbad', kind: 'loop', order: 0 }],
      }),
    (err) => err.errors.some((error) => error.type === 'missing-sound')
  )

  await assert.rejects(
    () => store.saveScene(scene.id, { ...saved, defaultMoodId: 'nope' }),
    (err) => err.errors.some((error) => error.type === 'invalid-default-mood')
  )
  await assert.rejects(
    () => store.saveScene('../escape', saved),
    (err) => err.code === 'invalid-path'
  )

  const deleted = await store.deleteScene(scene.id)
  assert.equal(deleted.id, scene.id)
  assert.equal(store.scene(scene.id), null)
  assert.equal(await readJson(scenePath(dataDir, scene.id), null), null)
})

test('master volume and the import marker persist across store instances', async (t) => {
  const { store, dataDir, soundsDir } = await setup(t, [])

  await store.saveGlobal({ master: 0.25, buses: { loop: 0.5 } })
  assert.equal(store.global().master, 0.25)
  assert.equal(store.global().buses.loop, 0.5)
  assert.equal(store.global().buses.random, 1)
  assert.equal((await readJson(globalPath(dataDir), null)).master, 0.25)

  const reloaded = createStore({ dataDir, soundsDir })
  await reloaded.init()
  assert.equal(reloaded.global().master, 0.25)
  assert.equal(reloaded.importDone(), false)

  assert.equal(await store.markImportDone(true), true)
  assert.equal(store.importDone(), true)
  await fs.access(path.join(dataDir, 'import-done'))

  const marked = createStore({ dataDir, soundsDir })
  await marked.init()
  assert.equal(marked.importDone(), true)

  assert.equal(await marked.markImportDone(false), false)
  assert.equal(marked.importDone(), false)
  await assert.rejects(() => fs.access(path.join(dataDir, 'import-done')))

  const unmarked = createStore({ dataDir, soundsDir })
  await unmarked.init()
  assert.equal(unmarked.importDone(), false)
})

test('corrupt scene files are skipped with a warning', async (t) => {
  const { dataDir, soundsDir } = await makeStoreDirs(t)
  await seedCatalog(dataDir, [])
  const scenesDir = path.join(dataDir, 'scenes')
  await fs.mkdir(scenesDir, { recursive: true })
  await fs.writeFile(path.join(scenesDir, 'bad.json'), '{ not json')
  await fs.writeFile(
    path.join(scenesDir, 'good.json'),
    JSON.stringify({
      version: 3,
      id: 'good',
      name: 'Good',
      disabled: false,
      defaultMoodId: 'm1',
      tracks: [],
      moods: [{ id: 'm1', name: 'Default', params: {} }],
      midi: { notes: {}, ccs: {} },
    })
  )

  const store = createStore({ dataDir, soundsDir })
  await store.init()

  assert.deepEqual(
    store.listScenes().map((scene) => scene.id),
    ['good']
  )
  assert.ok(store.warnings().some((warning) => warning.type === 'corrupt-scene'))
  assert.equal(store.scene('good').moods.length, 1)
  assert.equal(store.scene('bad'), null)
})

test('validateAll reports missing groups, sounds, and palette references without writing', async (t) => {
  const { store } = await setup(t, ['s1'])
  const group = await store.createGroup({ name: 'Dogs', sounds: ['s1'] })
  const scene = await store.createScene({ name: 'Station' })
  await store.saveScene(scene.id, {
    ...scene,
    tracks: [{ id: 't1', groupId: group.id, kind: 'loop', order: 0 }],
  })
  await store.saveGlobal({
    palette: [
      { id: 'p1', groupId: 'missing-group' },
      { id: 'p2', groupId: group.id },
    ],
  })

  await store.deleteGroup(group.id)
  assert.notEqual(store.scene(scene.id), null)
  assert.deepEqual(
    store.global().palette.map((entry) => entry.id),
    ['p1']
  )

  await store.saveLibrary({ groups: [{ id: 'gbad', name: 'Bad', sounds: ['missing-sound'] }] })
  const report = store.validateAll()

  assert.deepEqual(report.missingGroups, [
    { sceneId: scene.id, trackId: 't1', groupId: group.id },
  ])
  assert.deepEqual(report.missingSounds, [{ groupId: 'gbad', soundId: 'missing-sound' }])
  assert.deepEqual(report.palette, [{ paletteId: 'p1', groupId: 'missing-group' }])
  assert.equal(report.scenes.length, 1)
  assert.equal(report.scenes[0].ok, false)
})
