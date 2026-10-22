import test from 'node:test'
import assert from 'node:assert/strict'

import { resolveElement, resolveScene, resolveSceneElements } from '../lib/resolve.js'

const scene = {
  id: 'scene-1',
  dir: 'Syrinscape - Scene',
  elements: [
    {
      id: 'inline-1',
      name: 'Inline loop',
      kind: 'loop',
      gain: 0.6,
      files: ['inline.ogg'],
      trigger: { min: 0, max: 0, startMin: 0, startMax: 0 },
    },
  ],
  includes: [
    {
      id: 'inc-1',
      libraryId: 'group-1',
      overrides: {
        gain: 0.8,
        kind: 'random',
        trigger: { min: 5, max: 15, startMin: 1, startMax: 3 },
        reverb: 'Cave',
        randomise: 'shuffle',
      },
    },
    {
      id: 'inc-2',
      libraryId: 'group-1',
      overrides: { gain: null, kind: null, trigger: null, reverb: null, randomise: null },
    },
  ],
  hidden: [],
}

const library = {
  groups: [
    {
      id: 'group-1',
      name: 'Library group',
      kind: 'loop',
      gain: 0.4,
      reverb: 'Forest',
      randomise: 'random',
      files: ['group/file.ogg'],
      trigger: { min: 0, max: 0, startMin: 0, startMax: 0 },
    },
  ],
}

test('resolves inline elements with scene baseDir', () => {
  const elements = resolveSceneElements(scene, library)
  const inline = elements.find((el) => el.id === 'inline-1')
  assert.ok(inline)
  assert.equal(inline.source, 'scene')
  assert.equal(inline.libraryId, null)
  assert.equal(inline.baseDir, 'Syrinscape - Scene')
  assert.deepEqual(inline.files, ['inline.ogg'])
  assert.equal(inline.gain, 0.6)
})

test('resolves includes, applies non-null overrides, and inherits the rest', () => {
  const elements = resolveSceneElements(scene, library)
  const overridden = elements.find((el) => el.id === 'inc-1')
  assert.ok(overridden)
  assert.equal(overridden.source, 'library')
  assert.equal(overridden.libraryId, 'group-1')
  assert.equal(overridden.baseDir, '_library')
  assert.equal(overridden.name, 'Library group')
  assert.equal(overridden.gain, 0.8)
  assert.equal(overridden.kind, 'random')
  assert.equal(overridden.reverb, 'Cave')
  assert.equal(overridden.randomise, 'shuffle')
  assert.deepEqual(overridden.trigger, { min: 5, max: 15, startMin: 1, startMax: 3 })
  assert.deepEqual(overridden.files, ['group/file.ogg'])

  const inherited = elements.find((el) => el.id === 'inc-2')
  assert.ok(inherited)
  assert.equal(inherited.gain, 0.4)
  assert.equal(inherited.kind, 'loop')
  assert.equal(inherited.reverb, 'Forest')
  assert.equal(inherited.randomise, 'random')
})

test('hidden filters by instance id, including include ids', () => {
  const elements = resolveSceneElements(
    { ...scene, hidden: ['inline-1', 'inc-1'] },
    library
  )
  assert.deepEqual(
    elements.map((el) => el.id),
    ['inc-2']
  )
})

test('missing library groups are skipped and reported as warnings', () => {
  const result = resolveScene(
    {
      elements: [],
      includes: [{ id: 'inc-missing', libraryId: 'nope', name: 'Missing group' }],
    },
    { groups: [] }
  )
  assert.deepEqual(result.elements, [])
  assert.deepEqual(result.warnings, [
    {
      type: 'missing-library',
      includeId: 'inc-missing',
      libraryId: 'nope',
      name: 'Missing group',
    },
  ])
})

test('malformed input never throws', () => {
  assert.deepEqual(resolveSceneElements(null, null), [])
  assert.deepEqual(resolveSceneElements({ elements: 'bad', includes: 'bad' }, { groups: {} }), [])
  assert.deepEqual(resolveScene('bad', 'bad').elements, [])
})

test('resolveElement finds a resolved instance or returns null', () => {
  assert.equal(resolveElement(scene, library, 'inline-1').name, 'Inline loop')
  assert.equal(resolveElement(scene, library, 'inc-1').source, 'library')
  assert.equal(resolveElement(scene, library, 'unknown'), null)
  assert.equal(resolveElement(scene, library, ''), null)
})
