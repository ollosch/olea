import test from 'node:test'
import assert from 'node:assert/strict'

import {
  VERSION,
  newConfig,
  newGlobal,
  newInclude,
  newLibrary,
  newLibraryGroup,
  newPaletteEntry,
  normalizeConfig,
  normalizeElement,
  normalizeGlobal,
  normalizeInclude,
  normalizeLibrary,
  normalizeLibraryGroup,
  normalizeMidi,
  normalizeMood,
  normalizePaletteEntry,
} from '../lib/schema.js'

test('v1 config normalizes to v2 with defaults', () => {
  const cfg = normalizeConfig({
    version: 1,
    id: 'scene-1',
    name: 'Old scene',
    disabled: false,
    elements: [{ id: 'el-1', name: 'Loop', kind: 'loop', gain: 3 }],
    hidden: ['el-2'],
    moods: [
      { id: 'mood-1', name: 'Combat', params: { 'el-1': { plays: true, volume: 1.8 } } },
    ],
    midi: {
      notes: { '1:2': { type: 'oneshot', elementId: 'el-1' } },
      ccs: { '2:3': { type: 'element', elementId: 'el-1' } },
    },
  })

  assert.equal(cfg.version, VERSION)
  assert.equal(cfg.version, 2)
  assert.equal(cfg.id, 'scene-1')
  assert.deepEqual(cfg.includes, [])
  assert.equal(cfg.reviewed, true)
  assert.equal(cfg.elements[0].gain, 1)
  assert.equal(cfg.moods[0].params['el-1'].volume, 1)
  assert.deepEqual(cfg.hidden, ['el-2'])
  assert.deepEqual(cfg.midi.notes, { '1:2': { type: 'oneshot', elementId: 'el-1' } })
  assert.deepEqual(cfg.midi.ccs, { '2:3': { type: 'element', elementId: 'el-1' } })
})

test('reviewed is preserved when boolean and defaults to true otherwise', () => {
  assert.equal(normalizeConfig({ reviewed: false }).reviewed, false)
  assert.equal(normalizeConfig({ reviewed: true }).reviewed, true)
  assert.equal(normalizeConfig({ reviewed: 'no' }).reviewed, true)
  assert.equal(normalizeConfig({}).reviewed, true)
})

test('element gain and mood volume are clamped to 0..1', () => {
  for (const [input, expected] of [
    [-2, 0],
    [0, 0],
    [0.4, 0.4],
    [1, 1],
    [4, 1],
  ]) {
    const el = normalizeElement({ gain: input })
    assert.equal(el.gain, expected)
    const mood = normalizeMood({ params: { e: { volume: input } } })
    assert.equal(mood.params.e.volume, expected)
  }
})

test('includes normalize overrides and use null for inherit', () => {
  const inc = normalizeInclude({
    id: 'inc-1',
    libraryId: 'lib-1',
    overrides: {
      gain: 2,
      kind: 'random',
      trigger: { min: 1, max: 2, startMin: 3, startMax: 4 },
      reverb: 'cave',
      randomise: 'shuffle',
    },
  })

  assert.equal(inc.id, 'inc-1')
  assert.equal(inc.libraryId, 'lib-1')
  assert.equal(inc.overrides.gain, 1)
  assert.equal(inc.overrides.kind, 'random')
  assert.deepEqual(inc.overrides.trigger, { min: 1, max: 2, startMin: 3, startMax: 4 })
  assert.equal(inc.overrides.reverb, 'Cave')
  assert.equal(inc.overrides.randomise, 'shuffle')

  const inherit = normalizeInclude({ libraryId: 'lib-2' })
  assert.match(inherit.id, /./)
  assert.deepEqual(inherit.overrides, {
    gain: null,
    kind: null,
    trigger: null,
    reverb: null,
    randomise: null,
  })

  const invalid = normalizeInclude({
    libraryId: 'lib-3',
    overrides: { gain: 'nope', kind: 'bogus', reverb: 'Nope', randomise: 'bogus' },
  })
  assert.equal(invalid.overrides.gain, null)
  assert.equal(invalid.overrides.kind, null)
  assert.equal(invalid.overrides.reverb, null)
  assert.equal(invalid.overrides.randomise, null)
})

test('library groups are normalized as an array with element fields plus metadata', () => {
  const library = normalizeLibrary({
    groups: [
      {
        id: 'group-1',
        name: 'Carrion Crawler noises',
        kind: 'random',
        gain: 2,
        category: 'Monsters/Carrion Crawler',
        tags: ['monster', 'carrion-crawler'],
        files: ['noises/01.ogg'],
      },
    ],
  })

  assert.equal(library.version, 2)
  assert.ok(Array.isArray(library.groups))
  assert.equal(library.groups.length, 1)
  assert.equal(library.groups[0].id, 'group-1')
  assert.equal(library.groups[0].gain, 1)
  assert.equal(library.groups[0].category, 'Monsters/Carrion Crawler')
  assert.deepEqual(library.groups[0].tags, ['monster', 'carrion-crawler'])

  assert.deepEqual(normalizeLibrary(null).groups, [])
  assert.deepEqual(normalizeLibrary({ groups: 'legacy-object' }).groups, [])
  assert.deepEqual(normalizeLibrary({ 'group-1': { name: 'legacy' } }).groups, [])
})

test('library group defaults are safe', () => {
  const group = normalizeLibraryGroup({ name: 'G' })
  assert.equal(group.category, '')
  assert.deepEqual(group.tags, [])
  assert.equal(group.kind, 'oneshot')
})

test('palette entries normalize gain and order', () => {
  const entry = normalizePaletteEntry({
    id: 'palette-1',
    libraryId: 'group-1',
    label: 'Crawler noises',
    gain: 3,
    order: 4,
  })
  assert.deepEqual(entry, {
    id: 'palette-1',
    libraryId: 'group-1',
    label: 'Crawler noises',
    gain: 1,
    order: 4,
  })

  const inherit = normalizePaletteEntry({ libraryId: 'group-2', gain: 'nope' })
  assert.equal(inherit.gain, null)
  assert.equal(inherit.order, 0)
})

test('global normalizes buses, palette, and MIDI', () => {
  const global = normalizeGlobal({
    version: 1,
    buses: { loop: 2, random: -1, effects: 0.5 },
    palette: [{ id: 'p1', libraryId: 'g1', gain: 9, order: 1 }],
    midi: {
      notes: { '9:40': { type: 'palette', paletteId: 'p1' } },
      ccs: { '0:8': { type: 'master' } },
    },
  })

  assert.equal(global.version, 2)
  assert.deepEqual(global.buses, { loop: 1, random: 0, effects: 0.5 })
  assert.equal(global.palette.length, 1)
  assert.equal(global.palette[0].gain, 1)
  assert.deepEqual(global.midi.notes, { '9:40': { type: 'palette', paletteId: 'p1' } })
  assert.deepEqual(global.midi.ccs, { '0:8': { type: 'master' } })
})

test('constructors produce v2 defaults', () => {
  const cfg = newConfig('New')
  assert.equal(cfg.version, 2)
  assert.deepEqual(cfg.includes, [])
  assert.equal(cfg.reviewed, true)

  const global = newGlobal()
  assert.equal(global.version, 2)
  assert.deepEqual(global.palette, [])

  assert.deepEqual(newLibrary().groups, [])
  assert.equal(newLibraryGroup('loop').kind, 'loop')
  assert.equal(newInclude('lib-1').libraryId, 'lib-1')
  assert.equal(newPaletteEntry('lib-1', 3).order, 3)
})

test('normalizeMidi keeps notes and ccs objects', () => {
  assert.deepEqual(normalizeMidi(null), { notes: {}, ccs: {} })
  assert.deepEqual(normalizeMidi({ notes: 'x', ccs: { a: 1 } }), { notes: {}, ccs: { a: 1 } })
})
