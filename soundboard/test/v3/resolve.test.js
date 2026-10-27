import test from 'node:test'
import assert from 'node:assert/strict'

import { defaultMood, resolveScene, resolveTrack } from '../../lib/v3/resolve.js'

function group(overrides = {}) {
  return {
    id: 'g1',
    sounds: ['s1', 's2'],
    selection: 'ordered',
    defaultKind: 'loop',
    defaults: {
      gain: 0.8,
      reverb: 'Cave',
      pan: -0.5,
      trigger: { min: 4, max: 8, startMin: 1, startMax: 2 },
    },
    ...overrides,
  }
}

test('resolveTrack takes sounds/selection from the group and kind from the track', () => {
  const track = {
    id: 't1',
    groupId: 'g1',
    kind: 'oneshot',
    order: 3,
    trigger: { min: 0, max: 0, startMin: 0, startMax: 0 },
  }
  const result = resolveTrack(track, group())

  assert.equal(result.trackId, 't1')
  assert.equal(result.groupId, 'g1')
  assert.equal(result.kind, 'oneshot')
  assert.equal(result.kind, track.kind)
  assert.deepEqual(result.sounds, ['s1', 's2'])
  assert.equal(result.selection, 'ordered')
  assert.equal(result.order, 3)
  assert.equal(result.valid, true)
  assert.deepEqual(result.warnings, [])
})

test('gain, reverb, and pan inherit group defaults and are overridden by the mood', () => {
  const track = { id: 't1', groupId: 'g1', kind: 'loop', order: 0 }

  const inherited = resolveTrack(track, group())
  assert.equal(inherited.gain, 0.8)
  assert.equal(inherited.reverb, 'Cave')
  assert.equal(inherited.pan, -0.5)

  const overridden = resolveTrack(track, group(), { gain: 0.25, reverb: 'Forest', pan: 0.75 })
  assert.equal(overridden.gain, 0.25)
  assert.equal(overridden.reverb, 'Forest')
  assert.equal(overridden.pan, 0.75)
})

test('explicit null reverb in a mood overrides to dry', () => {
  const track = { id: 't1', groupId: 'g1', kind: 'loop', order: 0 }
  const result = resolveTrack(track, group(), { reverb: null })
  assert.equal(result.reverb, null)
})

test('enabled defaults to true and follows a boolean mood override', () => {
  const track = { id: 't1', groupId: 'g1', kind: 'loop', order: 0 }
  assert.equal(resolveTrack(track, group()).enabled, true)
  assert.equal(resolveTrack(track, group(), { enabled: false }).enabled, false)
  assert.equal(resolveTrack(track, group(), { enabled: 'no' }).enabled, true)
})

test('trigger resolves mood -> track -> group defaults -> kind default', () => {
  const track = {
    id: 't1',
    groupId: 'g1',
    kind: 'random',
    order: 0,
    trigger: { min: 5, max: 6, startMin: 1, startMax: 2 },
  }

  assert.deepEqual(resolveTrack(track, group(), { trigger: { min: 1, max: 2 } }).trigger, {
    min: 1,
    max: 2,
    startMin: 0,
    startMax: 0,
  })
  assert.deepEqual(resolveTrack(track, group()).trigger, {
    min: 5,
    max: 6,
    startMin: 1,
    startMax: 2,
  })

  const zeroTrack = { ...track, trigger: { min: 0, max: 0, startMin: 0, startMax: 0 } }
  assert.deepEqual(resolveTrack(zeroTrack, group()).trigger, {
    min: 4,
    max: 8,
    startMin: 1,
    startMax: 2,
  })

  const noGroupDefaults = group({ defaults: {} })
  assert.deepEqual(resolveTrack(zeroTrack, noGroupDefaults).trigger, {
    min: 10,
    max: 30,
    startMin: 2,
    startMax: 10,
  })
})

test('non-random tracks always resolve a zero trigger', () => {
  const track = {
    id: 't1',
    groupId: 'g1',
    kind: 'loop',
    order: 0,
    trigger: { min: 5, max: 6, startMin: 1, startMax: 2 },
  }
  const result = resolveTrack(track, group(), { trigger: { min: 1, max: 2 } })
  assert.deepEqual(result.trigger, { min: 0, max: 0, startMin: 0, startMax: 0 })
})

test('kind is never inherited from the group defaultKind', () => {
  const track = { id: 't1', groupId: 'g1', kind: 'random', order: 0 }
  const result = resolveTrack(track, group({ defaultKind: 'loop' }))
  assert.equal(result.kind, 'random')
})

test('missing group returns an invalid result with no sounds instead of throwing', () => {
  const track = { id: 't1', groupId: 'missing', kind: 'oneshot', order: 2 }
  const result = resolveTrack(track, null)

  assert.equal(result.valid, false)
  assert.deepEqual(result.sounds, [])
  assert.equal(result.kind, 'oneshot')
  assert.equal(result.order, 2)
  assert.equal(result.warnings[0].type, 'missing-group')
  assert.equal(result.warnings[0].trackId, 't1')
  assert.equal(result.warnings[0].groupId, 'missing')
  assert.equal(result.warning, result.warnings[0])
})

test('defaultMood prefers defaultMoodId and falls back to the first mood', () => {
  const scene = {
    defaultMoodId: 'm2',
    moods: [
      { id: 'm1', name: 'One', params: {} },
      { id: 'm2', name: 'Two', params: {} },
    ],
  }
  assert.equal(defaultMood(scene).id, 'm2')
  assert.equal(defaultMood({ defaultMoodId: 'missing', moods: scene.moods }).id, 'm1')
  assert.equal(defaultMood({ moods: [] }), null)
})

test('resolveScene uses the selected mood or the default mood', () => {
  const scene = {
    defaultMoodId: 'm1',
    tracks: [
      { id: 't1', groupId: 'g1', kind: 'loop', order: 0 },
      { id: 't2', groupId: 'g1', kind: 'oneshot', order: 1 },
    ],
    moods: [
      { id: 'm1', name: 'One', params: { t1: { gain: 0.1 } } },
      { id: 'm2', name: 'Two', params: { t1: { gain: 0.9 }, t2: { enabled: false } } },
    ],
  }
  const groups = new Map([['g1', group()]])

  const byDefault = resolveScene(scene, groups)
  assert.equal(byDefault.mood.id, 'm1')
  assert.equal(byDefault.tracks[0].gain, 0.1)
  assert.equal(byDefault.tracks[1].enabled, true)

  const byId = resolveScene(scene, groups, 'm2')
  assert.equal(byId.mood.id, 'm2')
  assert.equal(byId.tracks[0].gain, 0.9)
  assert.equal(byId.tracks[1].enabled, false)

  const missingMood = resolveScene(scene, groups, 'nope')
  assert.equal(missingMood.mood.id, 'm1')
})
