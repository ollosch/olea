import assert from 'node:assert/strict'
import test from 'node:test'

import {
  addSoundToCatalog,
  findByHash,
  findSound,
  hashIndex,
  searchCatalog,
  setSoundDuration,
  soundIndex,
  stats,
} from '../../lib/v3/catalog.js'
import { normalizeCatalog, normalizeLibrary } from '../../lib/v3/schema.js'
import { soundFixture } from './helpers.js'

function fixture() {
  const sounds = [
    soundFixture('s1', 'Barking Dog.ogg'),
    soundFixture('s2', 'City Rain.mp3', 'mp3'),
    soundFixture('s3', 'Thunder.wav', 'wav'),
    soundFixture('s4', 'Forest Birds.ogg'),
  ]
  const catalog = normalizeCatalog({ sounds })
  const library = normalizeLibrary({
    groups: [
      {
        id: 'g1',
        name: 'Dogs',
        category: 'Creatures/Dogs',
        tags: ['animal', 'bark'],
        sounds: ['s1'],
        defaultKind: 'random',
      },
      {
        id: 'g2',
        name: 'Weather',
        category: 'Nature/Weather',
        tags: ['rain', 'night'],
        sounds: ['s2', 's3'],
        defaultKind: 'loop',
      },
    ],
  })
  const assignments = new Map([
    ['s1', [library.groups[0]]],
    ['s2', [library.groups[1]]],
    ['s3', [library.groups[1]]],
  ])
  return { catalog, library, assignments, sounds }
}

test('sound/hash indexes and lookups', () => {
  const { catalog, sounds } = fixture()
  const byId = soundIndex(catalog)
  const byHash = hashIndex(catalog)

  assert.equal(byId.size, 4)
  assert.equal(byHash.size, 4)
  assert.equal(findSound(catalog, 's2').originalName, 'City Rain.mp3')
  assert.equal(findSound(catalog, 'missing'), null)
  assert.equal(findByHash(catalog, sounds[0].hash).id, 's1')
  assert.equal(findByHash(catalog, sounds[0].hash.toUpperCase()).id, 's1')
  assert.equal(findByHash(catalog, 'f'.repeat(64)), null)
})

test('search is case-insensitive across originalName, id, and hash', () => {
  const { catalog, sounds } = fixture()

  assert.deepEqual(
    searchCatalog(catalog, { query: 'BARKING' }).sounds.map((sound) => sound.id),
    ['s1']
  )
  assert.deepEqual(
    searchCatalog(catalog, { query: 's3' }).sounds.map((sound) => sound.id),
    ['s3']
  )
  assert.deepEqual(
    searchCatalog(catalog, { query: sounds[1].hash.slice(0, 12) }).sounds.map((sound) => sound.id),
    ['s2']
  )
  assert.equal(searchCatalog(catalog, { query: 'nothing-matches' }).total, 0)
})

test('search paginates and clamps offset/limit', () => {
  const { catalog } = fixture()

  const page = searchCatalog(catalog, { offset: 1, limit: 2 })
  assert.equal(page.total, 4)
  assert.equal(page.offset, 1)
  assert.equal(page.limit, 2)
  assert.deepEqual(page.sounds.map((sound) => sound.id), ['s2', 's3'])

  assert.equal(searchCatalog(catalog, { limit: 0 }).limit, 1)
  assert.equal(searchCatalog(catalog, { limit: 999 }).limit, 200)
  assert.equal(searchCatalog(catalog, { offset: -5 }).offset, 0)
})

test('search filters assigned, unassigned, group, kind, category, and tag', () => {
  const { catalog, assignments } = fixture()

  assert.deepEqual(
    searchCatalog(catalog, { assignedIds: assignments, unassigned: true }).sounds.map((s) => s.id),
    ['s4']
  )
  assert.deepEqual(
    searchCatalog(catalog, { assignedIds: assignments, groupId: 'g2' }).sounds.map((s) => s.id),
    ['s2', 's3']
  )
  assert.deepEqual(
    searchCatalog(catalog, { assignedIds: assignments, kind: 'random' }).sounds.map((s) => s.id),
    ['s1']
  )
  assert.deepEqual(
    searchCatalog(catalog, { assignedIds: assignments, category: 'Creatures' }).sounds.map((s) => s.id),
    ['s1']
  )
  assert.deepEqual(
    searchCatalog(catalog, { assignedIds: assignments, tag: 'NIGHT' }).sounds.map((s) => s.id),
    ['s2', 's3']
  )
  assert.deepEqual(
    searchCatalog(catalog, {
      assignedIds: assignments,
      category: 'Nature/Weather',
      tag: 'rain',
      query: 'city',
    }).sounds.map((s) => s.id),
    ['s2']
  )
})

test('addSoundToCatalog dedupes by hash and id', () => {
  const { catalog } = fixture()
  const newSound = soundFixture('s5', 'New.ogg')

  const first = addSoundToCatalog(catalog, newSound)
  assert.equal(first.added, true)
  assert.equal(first.catalog.sounds.length, 5)

  const sameHash = addSoundToCatalog(first.catalog, { ...newSound, id: 'other-id' })
  assert.equal(sameHash.added, false)
  assert.equal(sameHash.sound.id, 's5')
  assert.equal(sameHash.catalog.sounds.length, 5)

  const sameId = addSoundToCatalog(first.catalog, {
    ...soundFixture('s5', 'Different.ogg'),
    hash: 'f'.repeat(64),
  })
  assert.equal(sameId.added, false)
  assert.equal(sameId.sound.id, 's5')
  assert.equal(sameId.catalog.sounds.length, 5)
})

test('stats counts assigned, unassigned, groups, and uncategorized', () => {
  const { catalog, library } = fixture()
  const result = stats(catalog, library, true)

  assert.deepEqual(result, {
    total: 4,
    assigned: 3,
    unassigned: 1,
    groups: 2,
    uncategorized: 0,
    importDone: true,
  })

  const uncategorized = normalizeLibrary({
    groups: [{ id: 'g3', sounds: ['s4'] }],
  })
  assert.equal(stats(catalog, uncategorized).uncategorized, 1)
  assert.equal('importDone' in stats(catalog, uncategorized), false)
})

test('setSoundDuration updates a sound and leaves others untouched', () => {
  const { catalog } = fixture()
  const updated = setSoundDuration(catalog, 's1', 12.5)

  assert.equal(findSound(updated, 's1').duration, 12.5)
  assert.equal(findSound(catalog, 's1').duration, null)
  assert.equal(setSoundDuration(catalog, 'missing', 5), catalog)
  assert.equal(findSound(setSoundDuration(catalog, 's1', -1), 's1').duration, null)
})
