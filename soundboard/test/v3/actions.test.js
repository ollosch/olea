import assert from 'node:assert/strict'
import test from 'node:test'

import { clampVolume, dispatchAction } from '../../src/actions.js'

function recorder() {
  const calls = []
  const store = new Proxy(
    {},
    {
      get(_, name) {
        if (typeof name !== 'string') return undefined
        return (...args) => {
          calls.push([name, ...args])
          return true
        }
      },
    }
  )
  return { calls, store }
}

test('clampVolume clamps and defaults bad values', () => {
  assert.equal(clampVolume(0.4), 0.4)
  assert.equal(clampVolume(2), 1)
  assert.equal(clampVolume(-1), 0)
  assert.equal(clampVolume('0.25'), 0.25)
  assert.equal(clampVolume('nope'), 0)
  assert.equal(clampVolume(undefined), 0)
})

test('dispatchAction routes every action type', () => {
  const { calls, store } = recorder()
  const cases = [
    [{ type: 'stopAll' }, 0, ['stopAll']],
    [{ type: 'masterVolume' }, 0.7, ['setMaster', 0.7]],
    [{ type: 'busVolume', bus: 'music' }, 0.3, ['setBus', 'music', 0.3]],
    [{ type: 'paletteTrigger', paletteId: 'p1' }, 0, ['triggerPalette', 'p1']],
    [{ type: 'paletteVolume', paletteId: 'p1' }, 1, ['setPaletteGain', 'p1', 1]],
    [{ type: 'openScene', sceneId: 's1' }, 0, ['openScene', 's1']],
    [{ type: 'trackTrigger', trackId: 't1' }, 0, ['toggleTrack', 't1']],
    [{ type: 'trackVolume', trackId: 't1' }, 0.5, ['setTrackMoodGain', 't1', 0.5]],
    [{ type: 'moodSelect', moodId: 'm1' }, 0, ['selectMood', 'm1']],
    [{ type: 'sceneToggle' }, 0, ['toggleTransport']],
  ]

  for (const [action, value, expected] of cases) {
    assert.equal(dispatchAction(action, value, store), true)
    assert.deepEqual(calls.at(-1), expected)
  }
  assert.equal(calls.length, cases.length)
})

test('dispatchAction ignores malformed actions and missing methods', () => {
  const { calls, store } = recorder()
  assert.equal(dispatchAction(null, 0, store), false)
  assert.equal(dispatchAction({}, 0, store), false)
  assert.equal(dispatchAction({ type: 'nope' }, 0, store), false)
  assert.equal(dispatchAction({ type: 'stopAll' }, 0, null), false)
  assert.equal(calls.length, 0)
})

test('dispatchAction clamps continuous values', () => {
  const { calls, store } = recorder()
  dispatchAction({ type: 'masterVolume' }, 9, store)
  dispatchAction({ type: 'busVolume', bus: 'sfx' }, -2, store)
  assert.deepEqual(calls, [
    ['setMaster', 1],
    ['setBus', 'sfx', 0],
  ])
})

test('the reactive store exposes every dispatcher target as a method', async () => {
  const { store } = await import('../../src/store.js')
  const names = [
    'stopAll',
    'setMaster',
    'setBus',
    'triggerPalette',
    'setPaletteGain',
    'openScene',
    'toggleTrack',
    'setTrackMoodGain',
    'selectMood',
    'toggleTransport',
    'receiveLearnedKey',
  ]
  for (const name of names) assert.equal(typeof store[name], 'function', name)
})
