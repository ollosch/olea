import assert from 'node:assert/strict'
import test from 'node:test'

import { createStore } from '../../lib/v3/store.js'
import { catalogPath, readJson } from '../../lib/v3/storage.js'
import { makeStoreDirs, soundFixture } from './helpers.js'

test('store.addSounds normalizes, dedupes by hash/id, persists, and is idempotent', async (t) => {
  const dirs = await makeStoreDirs(t)
  const store = createStore({ dataDir: dirs.dataDir, soundsDir: dirs.soundsDir })
  await store.init()

  const first = soundFixture('s1', 'one.ogg')
  const second = soundFixture('s2', 'two.mp3', 'mp3')

  const result = await store.addSounds([first, second])
  assert.equal(result.added, 2)
  assert.equal(result.existing, 0)
  assert.equal(result.catalog.sounds.length, 2)
  assert.equal(store.catalog().sounds.length, 2)

  const persisted = await readJson(catalogPath(dirs.dataDir), null)
  assert.equal(persisted.version, 3)
  assert.equal(persisted.sounds.length, 2)
  assert.deepEqual(
    persisted.sounds.map((sound) => sound.id).sort(),
    ['s1', 's2']
  )
  for (const sound of persisted.sounds) {
    assert.match(sound.hash, /^[a-f0-9]{64}$/)
    assert.match(sound.addedAt, /^\d{4}-/)
  }

  const duplicates = await store.addSounds([
    { ...first, id: 's1-other-id' },
    { ...second, hash: 'f'.repeat(64) },
    { ...first },
  ])
  assert.equal(duplicates.added, 0)
  assert.equal(duplicates.existing, 3)
  assert.equal(store.catalog().sounds.length, 2)
  assert.equal((await readJson(catalogPath(dirs.dataDir), null)).sounds.length, 2)

  const mixed = await store.addSounds([first, soundFixture('s3', 'three.wav', 'wav')])
  assert.equal(mixed.added, 1)
  assert.equal(mixed.existing, 1)
  assert.equal(store.catalog().sounds.length, 3)
  assert.equal((await readJson(catalogPath(dirs.dataDir), null)).sounds.length, 3)
})

test('store.saveCatalog normalizes and replaces the catalog', async (t) => {
  const dirs = await makeStoreDirs(t)
  const store = createStore({ dataDir: dirs.dataDir, soundsDir: dirs.soundsDir })
  await store.init()

  const saved = await store.saveCatalog({ sounds: [soundFixture('only', 'only.ogg')] })
  assert.equal(saved.version, 3)
  assert.equal(saved.sounds.length, 1)
  assert.equal(store.catalog().sounds.length, 1)

  const fromDisk = await readJson(catalogPath(dirs.dataDir), null)
  assert.equal(fromDisk.version, 3)
  assert.equal(fromDisk.sounds.length, 1)
  assert.equal(fromDisk.sounds[0].id, 'only')
})
