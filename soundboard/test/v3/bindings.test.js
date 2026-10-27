import test from 'node:test'
import assert from 'node:assert/strict'

import {
  ACTION,
  bindingKey,
  cleanupBindings,
  findConflicts,
  findTargetBinding,
  localShadowing,
  normalizeMidiAction,
  parseBindingKey,
  removeBindingsForTargets,
  removeTargetBindings,
  sameTarget,
  setBinding,
} from '../../lib/v3/bindings.js'

test('bindingKey and parseBindingKey round-trip canonical keys', () => {
  assert.equal(bindingKey(0, 'note', 60), '0:note:60')
  assert.equal(bindingKey('1', 'cc', 7), '1:cc:7')
  assert.deepEqual(parseBindingKey('0:note:60'), { channel: 0, type: 'note', number: 60 })
  assert.deepEqual(parseBindingKey('15:cc:127'), { channel: 15, type: 'cc', number: 127 })

  assert.equal(parseBindingKey('0:60'), null)
  assert.equal(parseBindingKey('16:note:60'), null)
  assert.equal(parseBindingKey('0:note:128'), null)
  assert.equal(parseBindingKey('0:pad:60'), null)
  assert.equal(parseBindingKey(null), null)
  assert.throws(() => bindingKey(16, 'note', 60), /Invalid MIDI binding/)
})

test('normalizeMidiAction enforces scope, action shape, and ids', () => {
  assert.deepEqual(normalizeMidiAction(ACTION.stopAll(), 'global'), { type: 'stopAll' })
  assert.deepEqual(normalizeMidiAction(ACTION.busVolume('random'), 'global'), {
    type: 'busVolume',
    bus: 'random',
  })
  assert.equal(normalizeMidiAction(ACTION.busVolume('effects'), 'global'), null)
  assert.deepEqual(normalizeMidiAction(ACTION.trackTrigger('t1'), 'local'), {
    type: 'trackTrigger',
    trackId: 't1',
  })

  assert.equal(normalizeMidiAction(ACTION.trackTrigger('t1'), 'global'), null)
  assert.equal(normalizeMidiAction(ACTION.stopAll(), 'local'), null)
  assert.equal(normalizeMidiAction(ACTION.trackTrigger(''), 'local'), null)
  assert.equal(normalizeMidiAction({ type: 'bogus' }, 'local'), null)
  assert.equal(normalizeMidiAction(null, 'local'), null)
  assert.equal(normalizeMidiAction(ACTION.moodSelect('m1'), 'scene').moodId, 'm1')
})

test('sameTarget compares action identity and ignores extra fields', () => {
  assert.equal(sameTarget(ACTION.trackTrigger('t1'), { type: 'trackTrigger', trackId: 't1' }), true)
  assert.equal(sameTarget(ACTION.trackTrigger('t1'), ACTION.trackTrigger('t2')), false)
  assert.equal(sameTarget(ACTION.busVolume('loop'), ACTION.busVolume('loop')), true)
  assert.equal(sameTarget(ACTION.stopAll(), ACTION.stopAll()), true)
  assert.equal(sameTarget(ACTION.stopAll(), ACTION.masterVolume()), false)
})

test('setBinding replaces the same target and the same key, returning a new object', () => {
  let midi = setBinding({ notes: {}, ccs: {} }, 'local', '0:note:60', ACTION.trackTrigger('t1'))
  midi = setBinding(midi, 'local', '0:note:61', ACTION.trackTrigger('t1'))
  assert.deepEqual(midi, {
    notes: { '0:note:61': { type: 'trackTrigger', trackId: 't1' } },
    ccs: {},
  })

  midi = setBinding(midi, 'local', '0:note:61', ACTION.trackTrigger('t2'))
  assert.deepEqual(midi.notes, { '0:note:61': { type: 'trackTrigger', trackId: 't2' } })

  midi = setBinding(midi, 'global', '0:cc:7', ACTION.masterVolume())
  assert.deepEqual(midi.ccs, { '0:cc:7': { type: 'masterVolume' } })
})

test('setBinding rejects invalid keys, wrong scope, and mismatched key types', () => {
  assert.throws(() => setBinding({}, 'local', 'bad', ACTION.trackTrigger('t1')), /Invalid MIDI key/)
  assert.throws(() => setBinding({}, 'local', '0:note:60', ACTION.stopAll()), /Invalid MIDI action/)
  assert.throws(
    () => setBinding({}, 'global', '0:note:60', ACTION.masterVolume()),
    /cannot be bound/
  )
})

test('findTargetBinding and removeTargetBindings work across notes and ccs', () => {
  const midi = {
    notes: { '0:note:60': { type: 'trackTrigger', trackId: 't1' } },
    ccs: { '0:cc:7': { type: 'trackVolume', trackId: 't1' } },
  }
  assert.equal(findTargetBinding(midi, 'local', ACTION.trackTrigger('t1')), '0:note:60')
  assert.equal(findTargetBinding(midi, 'local', ACTION.trackVolume('t1')), '0:cc:7')
  assert.equal(findTargetBinding(midi, 'local', ACTION.trackTrigger('t2')), null)

  const removed = removeTargetBindings(midi, 'local', ACTION.trackTrigger('t1'))
  assert.deepEqual(removed.notes, {})
  assert.deepEqual(removed.ccs, midi.ccs)
  assert.deepEqual(midi.notes, { '0:note:60': { type: 'trackTrigger', trackId: 't1' } })
})

test('findConflicts and localShadowing detect overlapping keys', () => {
  const globalMidi = {
    notes: { '0:note:60': { type: 'stopAll' } },
    ccs: { '0:cc:7': { type: 'masterVolume' } },
  }
  const sceneMidi = {
    notes: { '0:note:60': { type: 'trackTrigger', trackId: 't1' } },
    ccs: {},
  }

  assert.deepEqual(findConflicts(globalMidi, sceneMidi), [
    {
      key: '0:note:60',
      globalAction: { type: 'stopAll' },
      localAction: { type: 'trackTrigger', trackId: 't1' },
    },
  ])
  assert.deepEqual(localShadowing(globalMidi, sceneMidi, '0:note:60'), {
    type: 'trackTrigger',
    trackId: 't1',
  })
  assert.equal(localShadowing(globalMidi, sceneMidi, '0:cc:7'), null)
  assert.equal(localShadowing(globalMidi, sceneMidi, 'bad'), null)
})

test('cleanupBindings drops invalid-scope bindings and supports predicates', () => {
  const midi = {
    notes: {
      '0:note:60': { type: 'trackTrigger', trackId: 't1' },
      '0:note:61': { type: 'stopAll' },
    },
    ccs: { '0:cc:7': { type: 'masterVolume' } },
  }

  const localOnly = cleanupBindings(midi, 'local')
  assert.deepEqual(localOnly, {
    notes: { '0:note:60': { type: 'trackTrigger', trackId: 't1' } },
    ccs: {},
  })

  const filtered = cleanupBindings(midi, 'local', (action) => action.trackId === 't1')
  assert.deepEqual(filtered, { notes: {}, ccs: {} })
})

test('removeBindingsForTargets drops deleted track/mood/palette bindings', () => {
  const midi = {
    notes: {
      '0:note:60': { type: 'trackTrigger', trackId: 't1' },
      '0:note:61': { type: 'moodSelect', moodId: 'm1' },
      '0:note:62': { type: 'trackTrigger', trackId: 't2' },
    },
    ccs: { '0:cc:7': { type: 'trackVolume', trackId: 't1' } },
  }

  const cleaned = removeBindingsForTargets(midi, 'local', [
    ACTION.trackTrigger('t1'),
    ACTION.trackVolume('t1'),
    ACTION.moodSelect('m1'),
  ])

  assert.deepEqual(cleaned, {
    notes: { '0:note:62': { type: 'trackTrigger', trackId: 't2' } },
    ccs: {},
  })
})
