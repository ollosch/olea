import assert from 'node:assert/strict'
import test from 'node:test'

import {
  applyManualToggle,
  initialTransportPlan,
  moodChangePlan,
  nextPaletteKind,
  palettePlan,
  pickSoundIndex,
  randomBetween,
  resolveScenePlan,
  toggleDecision,
  triggerDelay,
} from '../../src/playback-model.js'

function group(id, defaultKind, overrides = {}) {
  return {
    id,
    name: id,
    sounds: [`sound-${id}`],
    selection: 'random',
    defaultKind,
    defaults: {
      gain: 0.5,
      reverb: null,
      pan: 0,
      trigger: { min: 0, max: 0, startMin: 0, startMax: 0 },
    },
    ...overrides,
  }
}

function sceneFixture() {
  const groups = [
    group('gA', 'loop'),
    group('gB', 'loop'),
    group('gC', 'loop'),
    group('gR', 'random'),
    group('gR2', 'random'),
    group('gO', 'oneshot'),
  ]
  const groupsById = new Map(groups.map((item) => [item.id, item]))
  const scene = {
    id: 'scene-1',
    name: 'Station',
    defaultMoodId: 'm1',
    tracks: [
      { id: 'tC', groupId: 'gC', kind: 'loop', order: 2 },
      { id: 'tA', groupId: 'gA', kind: 'loop', order: 0 },
      { id: 'tR', groupId: 'gR', kind: 'random', order: 3 },
      { id: 'tB', groupId: 'gB', kind: 'loop', order: 1 },
      { id: 'tR2', groupId: 'gR2', kind: 'random', order: 4 },
      { id: 'tO', groupId: 'gO', kind: 'oneshot', order: 5 },
    ],
    moods: [
      {
        id: 'm1',
        name: 'Calm',
        params: {
          tA: { enabled: true },
          tB: { enabled: true },
          tC: { enabled: false },
          tR: { enabled: true },
          tR2: { enabled: false },
          tO: { enabled: true },
        },
      },
      {
        id: 'm2',
        name: 'Storm',
        params: {
          tA: { enabled: false },
          tB: { enabled: true, gain: 0.9 },
          tC: { enabled: true },
          tR: { enabled: false },
          tR2: { enabled: true },
          tO: { enabled: false },
        },
      },
    ],
    midi: { notes: {}, ccs: {} },
  }
  return { groups, groupsById, scene }
}

function ids(tracks) {
  return tracks.map((track) => track.trackId)
}

test('pickSoundIndex handles empty, ordered, and random selections', () => {
  assert.equal(pickSoundIndex('ordered', 0, -1), -1)
  assert.equal(pickSoundIndex('random', -2, -1), -1)
  assert.equal(pickSoundIndex('random', 1, 0), 0)
  assert.equal(pickSoundIndex('ordered', 1, -1), 0)

  assert.equal(pickSoundIndex('ordered', 3, -1), 0)
  assert.equal(pickSoundIndex('ordered', 3, 0), 1)
  assert.equal(pickSoundIndex('ordered', 3, 2), 0)
  assert.equal(pickSoundIndex('ordered', 3, 8), 0)
  assert.equal(pickSoundIndex('ordered', 3, 1.5), 0)

  assert.equal(pickSoundIndex('random', 3, 1, () => 0.5), 2)
  assert.equal(pickSoundIndex('random', 3, 2, () => 0.5), 1)
  assert.equal(pickSoundIndex('random', 3, 1, () => 0.9), 2)
  assert.equal(pickSoundIndex('random', 3, 1, () => 0.2), 0)
  assert.equal(pickSoundIndex('random', 3, 0, () => 0), 1)
  assert.equal(pickSoundIndex('random', 3, -1, () => 0), 0)
  assert.equal(pickSoundIndex('random', 3, 1, () => 1), 2)

  const random = () => 0.37
  assert.equal(pickSoundIndex('random', 10, -1, random), pickSoundIndex('random', 10, -1, random))
})

test('randomBetween orders finite bounds and clamps random output', () => {
  assert.equal(randomBetween(0, 10, () => 0.5), 5)
  assert.equal(randomBetween(5, 2, () => 0.5), 3.5)
  assert.equal(randomBetween(2, 2, () => 0.75), 2)
  assert.equal(randomBetween(0, 10, () => 1), 10)
  assert.equal(randomBetween(0, 10, () => -1), 0)
  assert.equal(randomBetween(0, 10, () => NaN), 0)
  assert.equal(randomBetween(NaN, 5, () => 0.5), 2.5)
  assert.equal(randomBetween('3', '7', () => 0.5), 5)
})

test('triggerDelay uses start bounds initially, later bounds afterwards, and falls back', () => {
  const trigger = { min: 10, max: 20, startMin: 2, startMax: 4 }
  assert.equal(triggerDelay(trigger, () => 0.5, { initial: true }), 3)
  assert.equal(triggerDelay(trigger, () => 0.5), 15)
  assert.equal(triggerDelay(trigger, () => 0.5, { initial: false }), 15)

  assert.equal(triggerDelay({}, () => 0.5, { initial: true }), 6)
  assert.equal(triggerDelay({}, () => 0.5), 20)
  assert.equal(
    triggerDelay({ min: 0, max: 0, startMin: 0, startMax: 0 }, () => 0.5, { initial: true }),
    6
  )

  assert.equal(
    triggerDelay({ min: -5, max: 'nope', startMin: -1, startMax: 3 }, () => 0.5, {
      initial: true,
    }),
    1.5
  )
  assert.equal(
    triggerDelay({ min: -5, max: 'nope', startMin: -1, startMax: 3 }, () => 0.5),
    0
  )

  assert.equal(triggerDelay({ min: 5, max: 10 }, () => 0.5, { initial: true }), 0)
  assert.equal(triggerDelay({ min: 5, max: 10 }, () => 0.5), 7.5)
})

test('resolveScenePlan resolves a mood and orders sections without starting', () => {
  const { groupsById, scene } = sceneFixture()
  const plan = resolveScenePlan(scene, groupsById, 'm2')

  assert.equal(plan.mood.id, 'm2')
  assert.deepEqual(ids(plan.loops), ['tA', 'tB', 'tC'])
  assert.deepEqual(ids(plan.randoms), ['tR', 'tR2'])
  assert.deepEqual(ids(plan.oneshots), ['tO'])
  assert.deepEqual(ids(plan.all), ['tA', 'tB', 'tC', 'tR', 'tR2', 'tO'])
  assert.equal(plan.loops[1].gain, 0.9)

  const fallback = resolveScenePlan(scene, groupsById)
  assert.equal(fallback.mood.id, 'm1')
})

test('initialTransportPlan starts only enabled loops/randoms and silences one-shots', () => {
  const { groupsById, scene } = sceneFixture()
  const plan = resolveScenePlan(scene, groupsById, 'm1')
  const initial = initialTransportPlan(plan)

  assert.deepEqual(ids(initial.startLoops), ['tA', 'tB'])
  assert.deepEqual(ids(initial.startRandoms), ['tR'])
  assert.deepEqual(ids(initial.silentOneshots), ['tO'])
  assert.equal('startOneshots' in initial, false)
})

test('moodChangePlan applies enabled changes live and never touches one-shots', () => {
  const { groupsById, scene } = sceneFixture()
  const previous = resolveScenePlan(scene, groupsById, 'm1')
  const next = resolveScenePlan(scene, groupsById, 'm2')

  const change = moodChangePlan(previous, next, ['tA', 'tB'], ['tR'])

  assert.deepEqual(ids(change.stopLoops), ['tA'])
  assert.deepEqual(ids(change.startLoops), ['tC'])
  assert.deepEqual(ids(change.stopRandoms), ['tR'])
  assert.deepEqual(ids(change.startRandoms), ['tR2'])
  assert.deepEqual(ids(change.apply), ['tB'])
  assert.equal('stopOneshots' in change, false)
  assert.equal('startOneshots' in change, false)
  assert.equal(change.apply[0].trackId, 'tB')
  assert.equal(change.apply[0].gain, 0.9)
})

test('moodChangePlan stops active tracks that become disabled and keeps unchanged loops', () => {
  const { groupsById, scene } = sceneFixture()
  const previous = resolveScenePlan(scene, groupsById, 'm1')
  const next = resolveScenePlan(scene, groupsById, 'm2')

  const change = moodChangePlan(previous, next, ['tA', 'tB'], ['tR'])
  assert.ok(!ids(change.stopLoops).includes('tB'))
  assert.ok(!ids(change.startLoops).includes('tB'))

  const noChange = moodChangePlan(previous, previous, ['tA', 'tB'], ['tR'])
  assert.deepEqual(noChange.stopLoops, [])
  assert.deepEqual(noChange.startLoops, [])
  assert.deepEqual(noChange.stopRandoms, [])
  assert.deepEqual(noChange.startRandoms, [])
  assert.deepEqual(noChange.apply, [])
})

test('toggleDecision and applyManualToggle work for every kind', () => {
  for (const kind of ['loop', 'random', 'oneshot']) {
    assert.equal(toggleDecision(kind, false), 'start')
    assert.equal(toggleDecision(kind, true), 'stop')
  }

  const { groupsById, scene } = sceneFixture()
  const plan = resolveScenePlan(scene, groupsById, 'm1')
  for (const trackId of ['tA', 'tR', 'tO']) {
    const started = applyManualToggle(plan, trackId, [])
    assert.equal(started.action, 'start')
    assert.equal(started.track.trackId, trackId)

    const stopped = applyManualToggle(plan, trackId, [trackId])
    assert.equal(stopped.action, 'stop')
    assert.equal(stopped.track.trackId, trackId)
  }

  assert.deepEqual(applyManualToggle(plan, 'missing', []), { action: null, track: null })
})

test('palettePlan uses defaultKind, sorts entries, and never autostarts', () => {
  const library = {
    groups: [
      { id: 'g1', defaultKind: 'loop' },
      { id: 'g2', defaultKind: null },
      { id: 'g3', defaultKind: 'bogus' },
    ],
  }
  const palette = [
    { id: 'p3', groupId: 'missing', order: 3 },
    { id: 'p1', groupId: 'g1', order: 1, label: 'Pads' },
    { id: 'p2', groupId: 'g2', order: 2 },
  ]

  const plan = palettePlan(library, palette)
  assert.deepEqual(
    plan.map((entry) => entry.paletteId),
    ['p1', 'p2', 'p3']
  )
  assert.deepEqual(
    plan.map((entry) => entry.kind),
    ['loop', 'oneshot', 'oneshot']
  )
  assert.deepEqual(
    plan.map((entry) => entry.valid),
    [true, true, false]
  )
  assert.equal(plan[0].group.id, 'g1')
  assert.equal(plan[2].group, null)
  for (const entry of plan) {
    assert.equal('action' in entry, false)
    assert.equal('start' in entry, false)
  }

  const withMap = palettePlan(library, palette, new Map(library.groups.map((g) => [g.id, g])))
  assert.deepEqual(withMap, plan)
})

test('nextPaletteKind accepts only valid kinds', () => {
  assert.equal(nextPaletteKind({ defaultKind: 'loop' }), 'loop')
  assert.equal(nextPaletteKind({ defaultKind: 'random' }), 'random')
  assert.equal(nextPaletteKind({ defaultKind: 'oneshot' }), 'oneshot')
  assert.equal(nextPaletteKind({ defaultKind: null }), 'oneshot')
  assert.equal(nextPaletteKind({ defaultKind: 'effects' }), 'oneshot')
  assert.equal(nextPaletteKind(null), 'oneshot')
})
