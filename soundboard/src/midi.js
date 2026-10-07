// Web MIDI wrapper. Uses the standard Web MIDI API (Chrome/Edge out of the box;
// Firefox needs dom.webmidi.enabled=true or a Web MIDI add-on).
import { reactive } from 'vue'

export const midi = reactive({
  supported: typeof navigator !== 'undefined' && 'requestMIDIAccess' in navigator,
  connected: false,
  inputs: [],
  error: '',
})

let access = null
let handler = null

export function onMidiMessage(cb) {
  handler = cb
}

function dispatch(msg) {
  const data = msg.data
  const status = data[0]
  const type = status & 0xf0
  const channel = status & 0x0f
  const d1 = data[1]
  const d2 = data[2]

  if (!handler) return

  if (type === 0x90 && d2 > 0) {
    handler({ type: 'note', channel, note: d1, velocity: d2, on: true })
  } else if (type === 0x80 || (type === 0x90 && d2 === 0)) {
    handler({ type: 'note', channel, note: d1, velocity: 0, on: false })
  } else if (type === 0xb0) {
    handler({ type: 'cc', channel, cc: d1, value: d2 })
  }
}

export async function connectMidi() {
  if (!midi.supported) {
    midi.error = 'Web MIDI is not supported in this browser'
    return false
  }
  if (typeof window !== 'undefined' && !window.isSecureContext) {
    midi.error = 'Web MIDI needs a secure context — open the app via http://localhost:8091, not the LAN IP'
    return false
  }
  try {
    access = await navigator.requestMIDIAccess({ sysex: false })
    midi.connected = true
    midi.error = ''
    midi.inputs = Array.from(access.inputs.values()).map((i) => ({ id: i.id, name: i.name || 'MIDI device' }))
    for (const input of access.inputs.values()) {
      input.onmidimessage = dispatch
    }
    return true
  } catch (e) {
    midi.connected = false
    midi.error = 'MIDI access denied or unavailable'
    return false
  }
}
