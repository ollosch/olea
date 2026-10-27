// Web MIDI access and input dispatch for the v3 soundboard.
//
// Incoming notes/CCs are turned into canonical v3 keys and either routed to
// learn mode or resolved against the active scene (local first) and global
// bindings. Playback always goes through `dispatchAction`, the same layer used
// by touch controls.

import { reactive } from 'vue'
import { bindingKey } from '../lib/v3/bindings.js'
import { dispatchAction } from './actions.js'

export const midi = reactive({
  supported: typeof navigator !== 'undefined' && 'requestMIDIAccess' in navigator,
  connected: false,
  inputs: [],
  error: '',
  lastKey: '',
})

let access = null
let storeRef = null

function canonicalKey(key) {
  const parts = typeof key === 'string' ? key.split(':') : []
  if (parts.length !== 3) return null
  try {
    return bindingKey(parts[0], parts[1], parts[2])
  } catch {
    return null
  }
}

function lookupBinding(midiMap, key) {
  if (!midiMap || !key) return null
  const parsed = key.split(':')
  const mapName = parsed[1] === 'cc' ? 'ccs' : 'notes'
  return midiMap[mapName]?.[key] || null
}

function handleMessage(event) {
  const data = event?.data
  if (!data || data.length < 2) return
  const status = data[0]
  if (status < 0x80) return

  const type = status & 0xf0
  const channel = status & 0x0f
  const d1 = data[1]
  const d2 = data.length > 2 ? data[2] : 0

  let key = null
  let value = 0

  if (type === 0x90 && d2 > 0) {
    key = bindingKey(channel, 'note', d1)
    value = d2 / 127
  } else if (type === 0xb0) {
    key = bindingKey(channel, 'cc', d1)
    value = d2 / 127
  } else {
    return
  }

  midi.lastKey = key
  const store = storeRef
  if (!store) return

  if (store.learning) {
    store.receiveLearnedKey(store.learning.scope, store.learning.action, key)
    return
  }

  const localAction = lookupBinding(store.activeScene?.midi, key)
  const action = localAction || lookupBinding(store.global?.midi, key)
  if (action) dispatchAction(action, value, store)
}

function refreshInputs() {
  if (!access) return
  const inputs = []
  for (const input of access.inputs.values()) {
    inputs.push({ id: input.id, name: input.name || 'MIDI device' })
    input.onmidimessage = handleMessage
  }
  midi.inputs = inputs
  midi.connected = inputs.length > 0
  if (!inputs.length) midi.error = 'No MIDI inputs detected'
  else if (midi.connected) midi.error = ''
}

export async function connectMidi(store) {
  if (store) storeRef = store
  if (!midi.supported) {
    midi.error =
      'Web MIDI is not supported. Use Chrome/Edge, or enable dom.webmidi.enabled in Firefox.'
    return false
  }
  if (typeof window !== 'undefined' && !window.isSecureContext) {
    midi.error =
      'Web MIDI needs a secure context — open the app via http://localhost:8091, not the LAN IP.'
    return false
  }
  try {
    access = await navigator.requestMIDIAccess({ sysex: false })
    midi.connected = true
    midi.error = ''
    access.onstatechange = refreshInputs
    refreshInputs()
    return true
  } catch (err) {
    midi.connected = false
    midi.error = `MIDI access denied or unavailable${err?.message ? `: ${err.message}` : ''}`
    return false
  }
}

export function disconnectMidi() {
  if (access) {
    for (const input of access.inputs.values()) input.onmidimessage = null
    access.onstatechange = null
  }
  access = null
  midi.connected = false
  midi.inputs = []
}

export function setMidiStore(store) {
  storeRef = store
}

export { canonicalKey }
