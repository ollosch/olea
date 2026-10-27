import assert from 'node:assert/strict'
import test from 'node:test'

import { createStore } from '../../lib/v3/store.js'
import { globalPath, readJson, scenePath } from '../../lib/v3/storage.js'
import { makeStoreDirs, seedCatalog, soundFixture } from './helpers.js'

const note = (number) => `0:note:${number}`
const cc = (number) => `0:cc:${number}`

async function setup(t, ids = ['s1', 's2', 's3']) {
  const dirs = await makeStoreDirs(t)
  await seedCatalog(
    dirs.dataDir,
    ids.map((id) => soundFixture(id))
  )
  const store = createStore({ dataDir: dirs.dataDir, soundsDir: dirs.soundsDir })
  await store.init()
  return { ...dirs, store }
}

test('deleting a group prunes palette entries and their global MIDI bindings', async (t) => {
  const { store, dataDir } = await setup(t)
  const removed = await store.createGroup({ name: 'Removed', sounds: ['s1'] })
  const kept = await store.createGroup({ name: 'Kept', sounds: ['s2'] })

  await store.saveGlobal({
    palette: [
      { id: 'p1', groupId: removed.id },
      { id: 'p2', groupId: kept.id },
    ],
    midi: {
      notes: {
        [note(60)]: { type: 'paletteTrigger', paletteId: 'p1' },
        [note(61)]: { type: 'stopAll' },
        [note(62)]: { type: 'paletteTrigger', paletteId: 'p2' },
      },
      ccs: {
        [cc(7)]: { type: 'paletteVolume', paletteId: 'p1' },
        [cc(8)]: { type: 'paletteVolume', paletteId: 'p2' },
      },
    },
  })

  const deleted = await store.deleteGroup(removed.id)
  assert.equal(deleted.paletteRemoved, 1)
  assert.equal(deleted.bindingsRemoved, 2)
  assert.deepEqual(
    store.global().palette.map((entry) => entry.id),
    ['p2']
  )
  assert.deepEqual(Object.keys(store.global().midi.notes), [note(61), note(62)])
  assert.deepEqual(Object.keys(store.global().midi.ccs), [cc(8)])

  const persisted = await readJson(globalPath(dataDir), null)
  assert.deepEqual(persisted.midi, store.global().midi)
  assert.deepEqual(
    persisted.palette.map((entry) => entry.id),
    ['p2']
  )
})

test('merging groups prunes bindings for the merged-away groups', async (t) => {
  const { store, dataDir } = await setup(t)
  const first = await store.createGroup({ name: 'First', sounds: ['s1'] })
  const second = await store.createGroup({ name: 'Second', sounds: ['s2'] })

  await store.saveGlobal({
    palette: [
      { id: 'p1', groupId: first.id },
      { id: 'p2', groupId: second.id },
    ],
    midi: {
      notes: {
        [note(60)]: { type: 'paletteTrigger', paletteId: 'p1' },
        [note(61)]: { type: 'paletteTrigger', paletteId: 'p2' },
      },
      ccs: { [cc(7)]: { type: 'paletteVolume', paletteId: 'p2' } },
    },
  })

  const merged = await store.mergeGroups({ groupIds: [first.id, second.id] })
  assert.deepEqual(merged.removedIds, [second.id])
  assert.equal(merged.paletteRemoved, 1)
  assert.equal(merged.bindingsRemoved, 2)
  assert.deepEqual(
    store.global().palette.map((entry) => entry.id),
    ['p1']
  )
  assert.deepEqual(Object.keys(store.global().midi.notes), [note(60)])
  assert.deepEqual(store.global().midi.ccs, {})

  const persisted = await readJson(globalPath(dataDir), null)
  assert.deepEqual(persisted.midi, store.global().midi)
})

test('saving global drops palette bindings for missing palette ids', async (t) => {
  const { store, dataDir } = await setup(t)
  const group = await store.createGroup({ name: 'Group', sounds: ['s1'] })

  await store.saveGlobal({
    palette: [{ id: 'p1', groupId: group.id }],
    midi: {
      notes: {
        [note(60)]: { type: 'paletteTrigger', paletteId: 'p1' },
        [note(61)]: { type: 'paletteTrigger', paletteId: 'missing' },
      },
      ccs: {
        [cc(7)]: { type: 'paletteVolume', paletteId: 'missing' },
        [cc(8)]: { type: 'masterVolume' },
      },
    },
  })

  assert.deepEqual(Object.keys(store.global().midi.notes), [note(60)])
  assert.deepEqual(Object.keys(store.global().midi.ccs), [cc(8)])
  const persisted = await readJson(globalPath(dataDir), null)
  assert.deepEqual(persisted.midi, store.global().midi)
})

test('saving global drops future actions whose group target is missing', async (t) => {
  const { store } = await setup(t)
  const group = await store.createGroup({ name: 'Group', sounds: ['s1'] })

  await store.saveGlobal({
    palette: [{ id: 'p1', groupId: group.id }],
    midi: {
      notes: {
        [note(60)]: {
          type: 'paletteTrigger',
          paletteId: 'p1',
          groupId: 'missing-group',
        },
        [note(61)]: {
          type: 'paletteTrigger',
          paletteId: 'p1',
          groupId: group.id,
        },
      },
    },
  })

  assert.deepEqual(Object.keys(store.global().midi.notes), [note(61)])
})

test('saving a scene removes local bindings for missing tracks and moods', async (t) => {
  const { store, dataDir } = await setup(t)
  const group = await store.createGroup({ name: 'Group', sounds: ['s1'] })
  const scene = await store.createScene({ name: 'Station' })

  const saved = await store.saveScene(scene.id, {
    ...scene,
    tracks: [
      { id: 't1', groupId: group.id, kind: 'loop', order: 0 },
      { id: 't2', groupId: group.id, kind: 'oneshot', order: 1 },
    ],
    moods: [
      { id: 'm1', name: 'One', params: {} },
      { id: 'm2', name: 'Two', params: {} },
    ],
    defaultMoodId: 'm1',
    midi: {
      notes: {
        [note(60)]: { type: 'trackTrigger', trackId: 't1' },
        [note(61)]: { type: 'trackTrigger', trackId: 't2' },
        [note(62)]: { type: 'moodSelect', moodId: 'm1' },
        [note(63)]: { type: 'moodSelect', moodId: 'm2' },
        [note(64)]: { type: 'sceneToggle' },
      },
      ccs: { [cc(7)]: { type: 'trackVolume', trackId: 't2' } },
    },
  })

  assert.deepEqual(Object.keys(saved.midi.notes), [note(60), note(61), note(62), note(63), note(64)])
  assert.deepEqual(Object.keys(saved.midi.ccs), [cc(7)])

  const pruned = await store.saveScene(scene.id, {
    ...saved,
    tracks: [{ id: 't1', groupId: group.id, kind: 'loop', order: 0 }],
    moods: [{ id: 'm1', name: 'One', params: {} }],
    defaultMoodId: 'm1',
  })

  assert.deepEqual(Object.keys(pruned.midi.notes), [note(60), note(62), note(64)])
  assert.deepEqual(pruned.midi.ccs, {})
  assert.deepEqual(store.scene(scene.id).midi, pruned.midi)
  assert.deepEqual((await readJson(scenePath(dataDir, scene.id), null)).midi, pruned.midi)
})

test('allScenes returns full scene objects and bindingsOverview reports conflicts', async (t) => {
  const { store } = await setup(t)
  const group = await store.createGroup({ name: 'Group', sounds: ['s1'] })
  const first = await store.createScene({ name: 'Alpha' })
  const second = await store.createScene({ name: 'Beta' })

  await store.saveScene(first.id, {
    ...first,
    tracks: [{ id: 't1', groupId: group.id, kind: 'loop', order: 0 }],
    midi: { notes: { [note(60)]: { type: 'trackTrigger', trackId: 't1' } }, ccs: {} },
  })
  await store.saveScene(second.id, {
    ...second,
    midi: { notes: { [note(70)]: { type: 'sceneToggle' } }, ccs: {} },
  })
  await store.saveGlobal({
    palette: [{ id: 'p1', groupId: group.id }],
    midi: {
      notes: {
        [note(60)]: { type: 'paletteTrigger', paletteId: 'p1' },
        [note(70)]: { type: 'stopAll' },
      },
    },
  })

  const scenes = store.allScenes()
  assert.deepEqual(
    scenes.map((scene) => scene.id),
    [first.id, second.id]
  )
  assert.equal(scenes[0].tracks.length, 1)
  assert.deepEqual(scenes[0].tracks[0], { id: 't1', groupId: group.id, kind: 'loop', order: 0, trigger: { min: 0, max: 0, startMin: 0, startMax: 0 } })
  assert.ok(Array.isArray(scenes[0].moods))
  assert.ok(scenes[0].midi.notes)

  const overview = store.bindingsOverview()
  assert.deepEqual(overview.global, store.global().midi)
  assert.deepEqual(
    overview.scenes.map((scene) => scene.sceneId),
    [first.id, second.id]
  )
  assert.equal(overview.conflicts.length, 2)
  assert.deepEqual(
    overview.conflicts.map((conflict) => conflict.key),
    [note(60), note(70)]
  )
  assert.deepEqual(
    overview.conflicts.map((conflict) => conflict.sceneId),
    [first.id, second.id]
  )
})
