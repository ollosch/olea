import test from 'node:test'
import assert from 'node:assert/strict'

import {
  DEFAULT_RANDOM_TRIGGER,
  KINDS,
  REVERB_PRESETS,
  SELECTIONS,
  VERSION,
  clamp01,
  clampPan,
  defaultCatalog,
  defaultGlobal,
  defaultLibrary,
  defaultMidi,
  isZeroTrigger,
  normalizeCatalog,
  normalizeCategory,
  normalizeGlobal,
  normalizeGroup,
  normalizeLibrary,
  normalizeMidi,
  normalizeScene,
  normalizeTags,
  normalizeTrack,
  normalizeTriggerForKind,
  resolveTriggerValue,
  sanitizeTrigger,
  uid,
} from '../../lib/v3/schema.js'

test('exports v3 constants and presets', () => {
  assert.equal(VERSION, 3)
  assert.deepEqual(KINDS, ['loop', 'random', 'oneshot'])
  assert.deepEqual(SELECTIONS, ['random', 'ordered'])
  assert.deepEqual(DEFAULT_RANDOM_TRIGGER, { min: 10, max: 30, startMin: 2, startMax: 10 })
  assert.ok(REVERB_PRESETS.includes('Soft furnished room'))
  assert.match(uid(), /^[0-9a-f-]{36}$/)
})

test('clamp helpers coerce and clamp', () => {
  assert.equal(clamp01(2), 1)
  assert.equal(clamp01(-2), 0)
  assert.equal(clamp01('0.25'), 0.25)
  assert.equal(clamp01('nope'), 0)
  assert.equal(clampPan(4), 1)
  assert.equal(clampPan(-4), -1)
  assert.equal(clampPan('0.5'), 0.5)
  assert.equal(clampPan(Number.NaN), 0)
})

test('sanitizeTrigger handles sentinel, negatives, non-finite, and swaps', () => {
  assert.deepEqual(sanitizeTrigger({ min: -15, max: -15, startMin: -15, startMax: -15 }), {
    min: 0,
    max: 0,
    startMin: 0,
    startMax: 0,
  })
  assert.deepEqual(sanitizeTrigger({ min: -1, max: 4, startMin: 'x', startMax: 3 }), {
    min: 0,
    max: 4,
    startMin: 0,
    startMax: 3,
  })
  assert.deepEqual(sanitizeTrigger({ min: 30, max: 10, startMin: 10, startMax: 2 }), {
    min: 10,
    max: 30,
    startMin: 2,
    startMax: 10,
  })
  assert.deepEqual(sanitizeTrigger(null), { min: 0, max: 0, startMin: 0, startMax: 0 })
})

test('trigger helpers zero non-random kinds and fall back for random', () => {
  const nonzero = { min: 5, max: 10, startMin: 1, startMax: 2 }
  assert.deepEqual(normalizeTriggerForKind('loop', nonzero), {
    min: 0,
    max: 0,
    startMin: 0,
    startMax: 0,
  })
  assert.deepEqual(normalizeTriggerForKind('oneshot', nonzero), {
    min: 0,
    max: 0,
    startMin: 0,
    startMax: 0,
  })
  assert.deepEqual(normalizeTriggerForKind('random', nonzero), nonzero)

  const zeros = { min: 0, max: 0, startMin: 0, startMax: 0 }
  assert.equal(isZeroTrigger(zeros), true)
  assert.equal(isZeroTrigger(nonzero), false)
  assert.deepEqual(resolveTriggerValue('random', zeros, { min: 0, max: 0 }), DEFAULT_RANDOM_TRIGGER)
  assert.deepEqual(resolveTriggerValue('random', zeros, nonzero), nonzero)
  assert.deepEqual(resolveTriggerValue('loop', nonzero), zeros)
  assert.deepEqual(resolveTriggerValue('oneshot', nonzero), zeros)
})

test('normalizeCategory normalizes slashes and rejects ..', () => {
  assert.equal(normalizeCategory(' Creatures\\Dogs//Night/ '), 'Creatures/Dogs/Night')
  assert.equal(normalizeCategory('a/./b'), 'a/b')
  assert.equal(normalizeCategory(''), '')
  assert.equal(normalizeCategory(null), '')
  assert.throws(() => normalizeCategory('a/../b'), /\.\./)
})

test('normalizeTags trims, drops empties, dedupes case-insensitively', () => {
  assert.deepEqual(normalizeTags(['Bark', ' bark ', 'night', 'NIGHT', '', 3]), ['Bark', 'night'])
  assert.deepEqual(normalizeTags('nope'), [])
})

test('normalizeTrack repairs kind, order, and kind-specific triggers', () => {
  const loop = normalizeTrack({ id: 't1', groupId: 'g1', kind: 'loop', order: '4', trigger: { min: 5 } })
  assert.deepEqual(loop, {
    id: 't1',
    groupId: 'g1',
    kind: 'loop',
    order: 4,
    trigger: { min: 0, max: 0, startMin: 0, startMax: 0 },
  })

  const random = normalizeTrack({ id: 't2', kind: 'random', trigger: { min: 3, max: 2 } }, 7)
  assert.equal(random.kind, 'random')
  assert.equal(random.order, 7)
  assert.deepEqual(random.trigger, { min: 2, max: 3, startMin: 0, startMax: 0 })

  const invalid = normalizeTrack({ kind: 'bogus', order: 'x' }, 9)
  assert.equal(invalid.kind, 'oneshot')
  assert.equal(invalid.order, 9)
})

test('normalizeScene sorts and renumbers scene-wide order deterministically', () => {
  const scene = normalizeScene({
    id: 'scene',
    tracks: [
      { id: 't1', groupId: 'g', kind: 'loop', order: 5 },
      { id: 't2', groupId: 'g', kind: 'oneshot', order: 1 },
      { id: 't3', groupId: 'g', kind: 'random', order: 3 },
    ],
    moods: [{ id: 'm1', name: 'A' }],
    defaultMoodId: 'm1',
  })

  assert.deepEqual(scene.tracks.map((track) => track.id), ['t2', 't3', 't1'])
  assert.deepEqual(scene.tracks.map((track) => track.order), [0, 1, 2])
})

test('normalizeScene ensures a mood and repairs defaultMoodId', () => {
  const empty = normalizeScene({})
  assert.equal(empty.moods.length, 1)
  assert.equal(empty.defaultMoodId, empty.moods[0].id)

  const fallback = normalizeScene({
    moods: [
      { id: 'm1', name: 'A' },
      { id: 'm2', name: 'B' },
    ],
    defaultMoodId: 'missing',
  })
  assert.equal(fallback.defaultMoodId, 'm1')
})

test('normalizeScene drops mood params for unknown tracks', () => {
  const scene = normalizeScene({
    tracks: [{ id: 't1', groupId: 'g', kind: 'loop', order: 0 }],
    moods: [
      {
        id: 'm1',
        name: 'A',
        params: {
          t1: { enabled: false, gain: 2 },
          gone: { gain: 0.1 },
        },
      },
    ],
  })
  assert.deepEqual(scene.moods[0].params, { t1: { enabled: false, gain: 1 } })
})

test('normalizers dedupe ids', () => {
  const catalog = normalizeCatalog({
    sounds: [
      { id: 's1', hash: 'a', ext: 'ogg' },
      { id: 's1', hash: 'b', ext: 'ogg' },
    ],
  })
  assert.equal(catalog.sounds.length, 1)

  const library = normalizeLibrary({
    groups: [
      { id: 'g1', name: 'A' },
      { id: 'g1', name: 'B' },
    ],
  })
  assert.equal(library.groups.length, 1)

  const global = normalizeGlobal({
    palette: [
      { id: 'p1', groupId: 'g1' },
      { id: 'p1', groupId: 'g2' },
    ],
  })
  assert.equal(global.palette.length, 1)
})

test('default constructors produce the v3 shapes', () => {
  assert.deepEqual(defaultCatalog(), { version: 3, sounds: [] })
  assert.deepEqual(defaultLibrary(), { version: 3, groups: [] })
  assert.deepEqual(defaultMidi(), { notes: {}, ccs: {} })

  const global = defaultGlobal()
  assert.equal(global.version, 3)
  assert.equal(global.master, 0.8)
  assert.deepEqual(global.buses, { loop: 1, random: 1, oneshot: 1 })
  assert.deepEqual(global.palette, [])
  assert.deepEqual(global.midi, { notes: {}, ccs: {} })
})

test('normalizers are idempotent', () => {
  const catalog = normalizeCatalog({
    sounds: [
      {
        id: 's1',
        hash: 'ABCDEF',
        ext: '.OGG',
        size: 12,
        duration: '3.5',
        originalName: 'a.ogg',
        addedAt: '2026-01-01T00:00:00.000Z',
      },
    ],
  })
  assert.deepEqual(normalizeCatalog(catalog), catalog)

  const group = normalizeGroup({
    id: 'g1',
    name: 'Dogs',
    category: 'Creatures\\Dogs',
    tags: ['bark', 'BARK', 'night'],
    sounds: ['s1', 's1'],
    selection: 'ordered',
    defaultKind: 'random',
    defaults: { gain: 1.5, reverb: 'soft furnished room', pan: -3, trigger: { min: 30, max: 10 } },
  })
  assert.deepEqual(normalizeGroup(group), group)

  const scene = normalizeScene({
    id: 'sc1',
    name: 'Station',
    tracks: [
      { id: 't1', groupId: 'g1', kind: 'loop', order: 3 },
      { id: 't2', groupId: 'g1', kind: 'random', order: 1, trigger: { min: 5, max: 2 } },
    ],
    moods: [{ id: 'm1', name: 'Inside', params: { t2: { gain: 0.4, reverb: 'Off' } } }],
    defaultMoodId: 'm1',
    midi: { notes: { '0:note:60': { type: 'moodSelect', moodId: 'm1' } }, ccs: {} },
  })
  assert.deepEqual(normalizeScene(scene), scene)

  const global = normalizeGlobal({
    master: 2,
    buses: { loop: -1, random: '0.5', oneshot: 3 },
    palette: [{ id: 'p1', groupId: 'g1', gain: 2, order: '1' }],
    midi: { notes: {}, ccs: { '0:cc:7': { type: 'masterVolume' } } },
  })
  assert.deepEqual(normalizeGlobal(global), global)
})

test('invalid inputs normalize to safe defaults', () => {
  assert.deepEqual(normalizeCatalog(null), { version: 3, sounds: [] })
  assert.deepEqual(normalizeLibrary(undefined), { version: 3, groups: [] })
  assert.equal(normalizeGlobal(null).master, 0.8)
  assert.equal(normalizeScene(null).moods.length, 1)
  assert.equal(normalizeTrack(null).kind, 'oneshot')
})

test('normalizeMidi drops invalid keys, wrong-scope actions, and wrong key types', () => {
  const midi = normalizeMidi(
    {
      notes: {
        '0:note:60': { type: 'trackTrigger', trackId: 't1' },
        '0:note:61': { type: 'bogus' },
        bad: { type: 'stopAll' },
      },
      ccs: {
        '0:cc:7': { type: 'masterVolume' },
        '1:cc:7': { type: 'trackTrigger', trackId: 't1' },
      },
    },
    'local'
  )

  assert.deepEqual(midi, {
    notes: { '0:note:60': { type: 'trackTrigger', trackId: 't1' } },
    ccs: {},
  })
})
