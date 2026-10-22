import test from 'node:test'
import assert from 'node:assert/strict'

import {
  suggestKind,
  suggestPlaylistMerges,
  suggestTrigger,
} from '../lib/heuristics.js'

const MB = 1024 * 1024

test('classifies the documented examples', () => {
  assert.equal(suggestKind({ name: 'D&D_Rats', fileCount: 5, size: 1000 }), 'random')
  assert.equal(suggestKind({ name: 'Tumbling Stones', fileCount: 1, size: 5000 }), 'oneshot')
  assert.equal(suggestKind({ name: 'Dragon Heist music', fileCount: 1, size: 1000 }), 'loop')
  assert.equal(suggestKind({ name: 'ASS MUSIC', fileCount: 10, size: 1000 }), 'loop')
  assert.equal(suggestKind({ name: 'Axe swing', fileCount: 3, size: 1000 }), 'oneshot')
  assert.equal(suggestKind({ name: 'Carrion noises', fileCount: 5, size: 1000 }), 'random')
})

test('valid xmlKind wins and invalid xmlKind is ignored', () => {
  assert.equal(suggestKind({ name: 'Axe swing', xmlKind: 'loop' }), 'loop')
  assert.equal(suggestKind({ name: 'Carrion noises', xmlKind: 'oneshot' }), 'oneshot')
  assert.equal(
    suggestKind({ name: 'Carrion noises', fileCount: 4, xmlKind: 'bogus' }),
    'random'
  )
})

test('loop keywords win over effect keywords', () => {
  assert.equal(suggestKind({ name: 'battle music hit', fileCount: 4 }), 'loop')
  assert.equal(suggestKind({ name: 'Tavern brawl punch', fileCount: 1, size: 100 }), 'loop')
})

test('single-file random size rule and large loop fallback', () => {
  assert.equal(suggestKind({ name: 'wind', fileCount: 1, size: 100 * 1024 }), 'random')
  assert.equal(suggestKind({ name: 'wind', fileCount: 1, size: 2 * MB }), 'loop')
  assert.equal(suggestKind({ name: 'Long track', fileCount: 1, size: 2 * MB }), 'loop')
  assert.equal(suggestKind({ name: 'Long track', fileCount: 1, size: 1 * MB }), 'oneshot')
})

test('keyword matching uses word boundaries', () => {
  assert.equal(suggestKind({ name: 'hotshot noises', fileCount: 4, size: 100 }), 'random')
  assert.equal(suggestKind({ name: 'shotgun blast', fileCount: 1, size: 100 }), 'oneshot')
  assert.equal(suggestKind({ name: 'stonework', fileCount: 1, size: 100 }), 'oneshot')
})

test('suggestTrigger returns the random default and zeros otherwise', () => {
  assert.deepEqual(suggestTrigger('random'), { min: 10, max: 30, startMin: 2, startMax: 10 })
  assert.deepEqual(suggestTrigger('loop'), { min: 0, max: 0, startMin: 0, startMax: 0 })
  assert.deepEqual(suggestTrigger('oneshot'), { min: 0, max: 0, startMin: 0, startMax: 0 })
})

test('suggestPlaylistMerges groups large single-file loops by prefix', () => {
  const elements = [
    { id: 'a', name: 'D&D Dragon Heist Battle music - Part 1', kind: 'loop', files: ['a.ogg'] },
    { id: 'b', name: 'D&D Dragon Heist Battle music - Part 2', kind: 'loop', files: ['b.ogg'] },
    { id: 'c', name: 'D&D Dragon Heist Battle music - Part 3', kind: 'loop', files: ['c.ogg'] },
    { id: 'small', name: 'D&D Dragon Heist Battle music - Short', kind: 'loop', files: ['s.ogg'] },
    { id: 'notloop', name: 'D&D Dragon Heist Battle music - Hit', kind: 'oneshot', files: ['h.ogg'] },
    { id: 'multi', name: 'D&D Dragon Heist Battle music - Multi', kind: 'loop', files: ['m1.ogg', 'm2.ogg'] },
    { id: 'other', name: 'Other theme - One', kind: 'loop', files: ['o1.ogg'] },
  ]

  const sizes = new Map([
    ['a.ogg', 2 * MB],
    ['b.ogg', 2.1 * MB],
    ['c.ogg', 2.2 * MB],
    ['s.ogg', 1 * MB],
    ['h.ogg', 3 * MB],
    ['m1.ogg', 3 * MB],
    ['m2.ogg', 3 * MB],
    ['o1.ogg', 3 * MB],
  ])

  assert.deepEqual(suggestPlaylistMerges(elements, sizes), [
    {
      elementIds: ['a', 'b', 'c'],
      name: 'D&D Dragon Heist Battle music',
      files: ['a.ogg', 'b.ogg', 'c.ogg'],
    },
  ])
})

test('suggestPlaylistMerges accepts an object size map and is defensive', () => {
  const elements = [
    { id: 'a', name: 'Theme - 1', kind: 'loop', files: ['a.ogg'] },
    { id: 'b', name: 'Theme - 2', kind: 'loop', files: ['b.ogg'] },
  ]
  const sizes = { 'a.ogg': 2 * MB, 'b.ogg': 2 * MB }
  assert.deepEqual(suggestPlaylistMerges(elements, sizes), [
    { elementIds: ['a', 'b'], name: 'Theme', files: ['a.ogg', 'b.ogg'] },
  ])

  assert.deepEqual(suggestPlaylistMerges(null, null), [])
  assert.deepEqual(suggestPlaylistMerges([], {}), [])
  assert.deepEqual(
    suggestPlaylistMerges([{ id: 'x', name: 'A - 1', kind: 'loop', files: [] }], {}),
    []
  )
})
