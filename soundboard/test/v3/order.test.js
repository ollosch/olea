import test from 'node:test'
import assert from 'node:assert/strict'

import {
  GROUP_ORDER,
  addTracksForGroups,
  dropInsertionIndex,
  groupTracks,
  moveTracks,
  nextOrder,
  orderedTracks,
  renumber,
} from '../../lib/v3/order.js'

function track(id, kind, order) {
  return { id, groupId: `g-${id}`, kind, order, trigger: { min: 0, max: 0, startMin: 0, startMax: 0 } }
}

test('GROUP_ORDER and groupTracks sort sections and tracks deterministically', () => {
  assert.deepEqual(GROUP_ORDER, ['loop', 'random', 'oneshot'])

  const tracks = [
    track('l2', 'loop', 4),
    track('o1', 'oneshot', 2),
    track('l1', 'loop', 1),
    track('r1', 'random', 3),
    track('l3', 'loop', 1),
  ]
  const sections = groupTracks(tracks)

  assert.deepEqual(sections.map((section) => section.kind), GROUP_ORDER)
  assert.deepEqual(sections[0].tracks.map((t) => t.id), ['l1', 'l3', 'l2'])
  assert.deepEqual(sections[1].tracks.map((t) => t.id), ['r1'])
  assert.deepEqual(sections[2].tracks.map((t) => t.id), ['o1'])
  assert.deepEqual(orderedTracks(tracks).map((t) => t.id), ['l1', 'l3', 'l2', 'r1', 'o1'])
})

test('renumber returns clones with sequential scene-wide order', () => {
  const input = [track('a', 'loop', 9), track('b', 'random', 2)]
  const output = renumber(input)

  assert.deepEqual(output.map((t) => t.order), [0, 1])
  assert.notEqual(output, input)
  assert.notEqual(output[0], input[0])
  assert.deepEqual(input.map((t) => t.order), [9, 2])
})

test('moveTracks reorders within a kind using insertion index after removal', () => {
  const tracks = [track('a', 'loop', 0), track('b', 'loop', 1), track('c', 'loop', 2)]
  const moved = moveTracks(tracks, ['a'], 'loop', 2)

  assert.deepEqual(moved.map((t) => t.id), ['b', 'c', 'a'])
  assert.deepEqual(moved.map((t) => t.order), [0, 1, 2])
})

test('moveTracks supports bulk moves and preserves their relative order', () => {
  const tracks = [
    track('a', 'loop', 0),
    track('b', 'loop', 1),
    track('c', 'loop', 2),
    track('d', 'loop', 3),
  ]
  const moved = moveTracks(tracks, ['a', 'c'], 'loop', 2)

  assert.deepEqual(moved.map((t) => t.id), ['b', 'd', 'a', 'c'])
  assert.deepEqual(moved.map((t) => t.order), [0, 1, 2, 3])
})

test('moveTracks changes kind across sections and renumbers scene-wide', () => {
  const tracks = [
    track('l1', 'loop', 0),
    track('l2', 'loop', 1),
    track('r1', 'random', 2),
    track('o1', 'oneshot', 3),
  ]
  const moved = moveTracks(tracks, ['l1', 'l2'], 'oneshot', 0)

  assert.deepEqual(moved.map((t) => t.id), ['r1', 'l1', 'l2', 'o1'])
  assert.deepEqual(moved.map((t) => t.kind), ['random', 'oneshot', 'oneshot', 'oneshot'])
  assert.deepEqual(moved.map((t) => t.order), [0, 1, 2, 3])
})

test('moveTracks clamps out-of-range target indices and ignores unknown ids', () => {
  const tracks = [track('a', 'loop', 0), track('b', 'loop', 1)]
  const moved = moveTracks(tracks, ['a', 'missing'], 'loop', 99)

  assert.deepEqual(moved.map((t) => t.id), ['b', 'a'])
  assert.throws(() => moveTracks(tracks, ['a'], 'bogus', 0), /Invalid target kind/)
})

test('nextOrder and addTracksForGroups append new tracks', () => {
  assert.equal(nextOrder([]), 0)
  assert.equal(nextOrder([track('a', 'loop', 4), track('b', 'loop', 1)]), 5)

  const groups = [
    { id: 'g1', defaultKind: 'loop', defaults: { trigger: { min: 1, max: 2 } } },
    { id: 'g2', defaultKind: 'random', defaults: { trigger: { min: 3, max: 4 } } },
    { id: 'g3', defaultKind: null },
  ]
  const base = [track('a', 'loop', 0)]
  const added = addTracksForGroups(base, groups)

  assert.equal(added.length, 4)
  assert.deepEqual(added.map((t) => t.groupId), ['g-a', 'g1', 'g2', 'g3'])
  assert.deepEqual(added.map((t) => t.kind), ['loop', 'loop', 'random', 'oneshot'])
  assert.deepEqual(added.map((t) => t.order), [0, 1, 2, 3])
  assert.deepEqual(added[2].trigger, { min: 3, max: 4, startMin: 0, startMax: 0 })
  assert.deepEqual(added[3].trigger, { min: 0, max: 0, startMin: 0, startMax: 0 })
  assert.equal(base.length, 1)
})

test('addTracksForGroups honours an explicit kind override', () => {
  const added = addTracksForGroups([], [{ id: 'g1', defaultKind: 'loop' }], 'oneshot')
  assert.equal(added[0].kind, 'oneshot')
})


test('dropInsertionIndex compensates for moving items before the drop target', () => {
  const current = ['a', 'b', 'c', 'd']

  assert.equal(dropInsertionIndex(current, ['a', 'b'], 2), 0)
  assert.equal(dropInsertionIndex(current, ['c'], 1), 1)
  assert.equal(dropInsertionIndex(current, ['a'], 3), 2)
  assert.equal(dropInsertionIndex(current, ['b', 'd'], 3), 2)
  assert.equal(dropInsertionIndex(current, [], 2), 2)
  assert.equal(dropInsertionIndex(current, ['a'], 99), 3)
  assert.equal(dropInsertionIndex(current, ['a'], -5), 0)
})
