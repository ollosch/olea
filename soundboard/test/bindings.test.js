import test from 'node:test'
import assert from 'node:assert/strict'

import {
  bindAction,
  findBindingKey,
  removeActionBindings,
  removeBindings,
  sameAction,
} from '../lib/bindings.js'

test('sameAction ignores scope and element-note kind, but respects ids and other types', () => {
  assert.equal(
    sameAction(
      { type: 'element', elementId: 'a', scope: 'local' },
      { type: 'element', elementId: 'a', scope: 'global' }
    ),
    true
  )
  assert.equal(sameAction({ type: 'element', elementId: 'a' }, { type: 'element', elementId: 'b' }), false)
  assert.equal(
    sameAction({ type: 'oneshot', elementId: 'a' }, { type: 'loop', elementId: 'a' }),
    true
  )
  assert.equal(
    sameAction({ type: 'oneshot', elementId: 'a' }, { type: 'element', elementId: 'a' }),
    false
  )
  assert.equal(sameAction({ type: 'bus', bus: 'loop' }, { type: 'bus', bus: 'random' }), false)
  assert.equal(sameAction({ type: 'bus', bus: 'loop' }, { type: 'bus' }), false)
  assert.equal(sameAction({ type: 'soundset' }, { type: 'soundset', soundsetId: 's' }), false)
  assert.equal(
    sameAction({ type: 'soundset', soundsetId: 's' }, { type: 'soundset', soundsetId: 's' }),
    true
  )
  assert.equal(
    sameAction({ type: 'palette', paletteId: 'p' }, { type: 'palette', paletteId: 'p' }),
    true
  )
  assert.equal(sameAction({ type: 'stop' }, { type: 'stop' }), true)
  assert.equal(sameAction(null, { type: 'stop' }), false)
})

test('re-learning the same note action on a new key replaces the old binding', () => {
  const action = { type: 'oneshot', elementId: 'el-1' }
  let notes = bindAction({}, '0:60', action)
  notes = bindAction(notes, '0:64', action)

  assert.deepEqual(Object.keys(notes), ['0:64'])
  assert.equal(findBindingKey(notes, action), '0:64')
})

test('re-learning an element after its kind changes replaces the old note binding', () => {
  let notes = bindAction({}, '0:60', { type: 'oneshot', elementId: 'el-1' })
  notes = bindAction(notes, '0:64', { type: 'loop', elementId: 'el-1' })

  assert.deepEqual(Object.keys(notes), ['0:64'])
  assert.equal(findBindingKey(notes, { type: 'random', elementId: 'el-1' }), '0:64')
})

test('re-learning the same CC action replaces the old binding', () => {
  const action = { type: 'element', elementId: 'el-1' }
  let ccs = bindAction({}, '0:8', action)
  ccs = bindAction(ccs, '0:9', { ...action, scope: 'local' })

  assert.deepEqual(Object.keys(ccs), ['0:9'])
})

test('binding a key to a different action replaces the previous binding', () => {
  let notes = bindAction({}, '0:60', { type: 'oneshot', elementId: 'a' })
  notes = bindAction(notes, '0:60', { type: 'oneshot', elementId: 'b' })

  assert.deepEqual(notes['0:60'], { type: 'oneshot', elementId: 'b' })
  assert.equal(Object.keys(notes).length, 1)
})

test('notes and CCs are independent maps and both replace same-action entries', () => {
  const noteAction = { type: 'loop', elementId: 'a' }
  let notes = bindAction({}, '0:60', noteAction)
  notes = bindAction(notes, '0:61', { type: 'loop', elementId: 'b' })

  const ccAction = { type: 'element', elementId: 'a' }
  let ccs = bindAction({}, '0:8', ccAction)
  ccs = bindAction(ccs, '0:9', { type: 'element', elementId: 'b' })

  assert.deepEqual(Object.keys(notes).sort(), ['0:60', '0:61'])
  assert.deepEqual(Object.keys(ccs).sort(), ['0:8', '0:9'])
})

test('bindAction returns a new map and leaves the input untouched', () => {
  const input = { '0:60': { type: 'stop' } }
  const out = bindAction(input, '0:61', { type: 'master' })

  assert.deepEqual(input, { '0:60': { type: 'stop' } })
  assert.deepEqual(Object.keys(out).sort(), ['0:60', '0:61'])
  assert.notEqual(out, input)
})

test('removeActionBindings removes only matching actions', () => {
  const map = {
    '0:60': { type: 'element', elementId: 'a' },
    '0:61': { type: 'element', elementId: 'b' },
    '0:62': { type: 'element', elementId: 'a' },
  }
  const out = removeActionBindings(map, { type: 'element', elementId: 'a' })

  assert.deepEqual(out, { '0:61': { type: 'element', elementId: 'b' } })
  assert.equal(Object.keys(map).length, 3)
})

test('removeBindings removes using a predicate and supports orphans cleanup', () => {
  const map = {
    '0:60': { type: 'palette', paletteId: 'p1' },
    '0:61': { type: 'palette', paletteId: 'p2' },
    '0:62': { type: 'stop' },
  }
  const out = removeBindings(map, (binding) => binding.paletteId === 'p2')

  assert.deepEqual(out, {
    '0:60': { type: 'palette', paletteId: 'p1' },
    '0:62': { type: 'stop' },
  })
  assert.deepEqual(removeBindings({}, () => true), {})
  assert.deepEqual(removeBindings(null, () => true), {})
})
