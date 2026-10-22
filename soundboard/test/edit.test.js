import test from 'node:test'
import assert from 'node:assert/strict'

import { commonPrefixName, mergeElements } from '../lib/edit.js'

function zeros() {
  return { min: 0, max: 0, startMin: 0, startMax: 0 }
}

function makeScene() {
  return {
    version: 2,
    id: 'scene-1',
    name: 'Scene',
    elements: [
      {
        id: 'a',
        name: 'Battle music - One',
        kind: 'oneshot',
        gain: 0.5,
        randomise: 'shuffle',
        reverb: 'Cave',
        files: ['a1.ogg', 'shared.ogg'],
        trigger: zeros(),
      },
      {
        id: 'b',
        name: 'Battle music - Two',
        kind: 'oneshot',
        gain: 0.9,
        randomise: null,
        reverb: 'Forest',
        files: ['shared.ogg', 'b1.ogg'],
        trigger: zeros(),
      },
      {
        id: 'c',
        name: 'Other',
        kind: 'oneshot',
        gain: 1,
        randomise: null,
        reverb: null,
        files: ['c.ogg'],
        trigger: zeros(),
      },
    ],
    includes: [{ id: 'inc-1', libraryId: 'lib-1', overrides: {} }],
    hidden: ['b', 'c'],
    moods: [
      {
        id: 'm1',
        name: 'Combat',
        params: {
          a: { plays: true, volume: 0.4 },
          b: { plays: false, volume: 0.8 },
          c: { plays: true, volume: 1 },
        },
      },
      {
        id: 'm2',
        name: 'Quiet',
        params: {
          a: { plays: true, volume: 0.2 },
          c: { plays: false, volume: 0.5 },
        },
      },
      {
        id: 'm3',
        name: 'Untouched',
        params: { c: { plays: true, volume: 0.7 } },
      },
    ],
    midi: {
      notes: {
        '1:2': { type: 'oneshot', elementId: 'a' },
        '1:3': { type: 'oneshot', elementId: 'c' },
      },
      ccs: {
        '2:4': { type: 'element', elementId: 'b' },
        '2:5': { type: 'element', elementId: 'c' },
      },
    },
  }
}

test('commonPrefixName only returns a shared separator prefix', () => {
  assert.equal(
    commonPrefixName(['Battle music - One', 'Battle music - Two']),
    'Battle music'
  )
  assert.equal(commonPrefixName(['Battle music – One', 'Battle music – Two']), 'Battle music')
  assert.equal(commonPrefixName(['A - 1', 'B - 2']), '')
  assert.equal(commonPrefixName([]), '')
})

test('mergeElements combines files in soundset order and removes the old elements', () => {
  const scene = makeScene()
  const result = mergeElements(scene, ['b', 'a', 'nope', 'inc-1'], 'loop')

  assert.equal(result.warnings.length, 1)
  assert.match(result.warnings[0], /Combat/)
  assert.match(result.warnings[0], /merged elements/)

  const merged = result.element
  assert.ok(merged)
  assert.ok(!['a', 'b'].includes(merged.id))
  assert.equal(merged.kind, 'loop')
  assert.equal(merged.name, 'Battle music')
  assert.deepEqual(merged.files, ['a1.ogg', 'shared.ogg', 'b1.ogg'])
  assert.equal(merged.gain, 0.5)
  assert.equal(merged.reverb, 'Cave')
  assert.equal(merged.randomise, 'shuffle')
  assert.deepEqual(merged.trigger, zeros())

  const ids = result.soundset.elements.map((el) => el.id)
  assert.ok(!ids.includes('a'))
  assert.ok(!ids.includes('b'))
  assert.ok(ids.includes('c'))
  assert.ok(ids.includes(merged.id))
  assert.equal(result.soundset.elements.length, 2)
})

test('mergeElements remaps moods deterministically and keeps the first param', () => {
  const scene = makeScene()
  const { soundset, element } = mergeElements(scene, ['a', 'b'], 'loop')

  const combat = soundset.moods.find((mood) => mood.id === 'm1')
  assert.equal(combat.params.a, undefined)
  assert.equal(combat.params.b, undefined)
  assert.deepEqual(combat.params[element.id], { plays: true, volume: 0.4 })
  assert.deepEqual(combat.params.c, { plays: true, volume: 1 })

  const quiet = soundset.moods.find((mood) => mood.id === 'm2')
  assert.equal(quiet.params.a, undefined)
  assert.deepEqual(quiet.params[element.id], { plays: true, volume: 0.2 })
  assert.deepEqual(quiet.params.c, { plays: false, volume: 0.5 })

  const untouched = soundset.moods.find((mood) => mood.id === 'm3')
  assert.deepEqual(untouched.params, { c: { plays: true, volume: 0.7 } })
})

test('mergeElements remaps local MIDI notes and CCs', () => {
  const scene = makeScene()
  const { soundset, element } = mergeElements(scene, ['a', 'b'], 'loop')

  assert.deepEqual(soundset.midi.notes, {
    '1:2': { type: 'oneshot', elementId: element.id },
    '1:3': { type: 'oneshot', elementId: 'c' },
  })
  assert.deepEqual(soundset.midi.ccs, {
    '2:4': { type: 'element', elementId: element.id },
    '2:5': { type: 'element', elementId: 'c' },
  })
})

test('mergeElements cleans hidden and hides the new id only when an old id was hidden', () => {
  const scene = makeScene()
  const { soundset, element } = mergeElements(scene, ['a', 'b'], 'loop')
  assert.deepEqual(soundset.hidden, ['c', element.id])

  const secondScene = makeScene()
  const second = mergeElements(secondScene, ['c'], 'oneshot')
  assert.deepEqual(second.soundset.hidden, ['b', second.element.id])

  const thirdScene = makeScene()
  thirdScene.hidden = ['c']
  const third = mergeElements(thirdScene, ['a', 'b'], 'loop')
  assert.deepEqual(third.soundset.hidden, ['c'])
})

test('mergeElements defaults random triggers and does not mutate the input', () => {
  const scene = makeScene()
  const snapshot = JSON.stringify(scene)

  const { soundset, element } = mergeElements(scene, ['a', 'b'], 'random')
  assert.deepEqual(element.trigger, { min: 10, max: 30, startMin: 2, startMax: 10 })

  assert.equal(JSON.stringify(scene), snapshot)
  assert.equal(soundset !== scene, true)
})

test('mergeElements ignores unknown/include ids and is defensive', () => {
  const result = mergeElements(makeScene(), ['inc-1', 'missing'], 'loop')
  assert.equal(result.element, null)
  assert.match(result.warnings[0], /No matching/)

  assert.equal(mergeElements(null, ['x'], 'loop').element, null)
})
