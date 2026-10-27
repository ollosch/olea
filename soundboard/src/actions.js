// Pure MIDI/touch action dispatcher for the v3 soundboard.
//
// All input paths (Web MIDI, keyboard pads, touch buttons) funnel through the
// same action objects so behaviour cannot diverge. `store` is passed in rather
// than imported so this module stays testable in Node and free of Vue.

function clampVolume(value) {
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n)) return 0
  return Math.min(1, Math.max(0, n))
}

function call(store, name, ...args) {
  if (!store || typeof store[name] !== 'function') return false
  store[name](...args)
  return true
}

export function dispatchAction(action, value, store) {
  if (!action || typeof action !== 'object' || typeof action.type !== 'string') return false
  const volume = clampVolume(value)

  switch (action.type) {
    case 'stopAll':
      return call(store, 'stopAll')

    case 'masterVolume':
      return call(store, 'setMaster', volume)

    case 'busVolume':
      return call(store, 'setBus', action.bus, volume)

    case 'paletteTrigger':
      return call(store, 'triggerPalette', action.paletteId)

    case 'paletteVolume':
      return call(store, 'setPaletteGain', action.paletteId, volume)

    case 'openScene':
      return call(store, 'openScene', action.sceneId)

    case 'trackTrigger':
      return call(store, 'toggleTrack', action.trackId)

    case 'trackVolume':
      return call(store, 'setTrackMoodGain', action.trackId, volume)

    case 'moodSelect':
      return call(store, 'selectMood', action.moodId)

    case 'sceneToggle':
      return call(store, 'toggleTransport')

    default:
      return false
  }
}

export { clampVolume }
