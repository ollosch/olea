// Web Audio engine for the v3 soundboard.
//
// - One sound at a time per scene track and per palette entry.
// - Loop tracks crossfade to the next group sound near the end.
// - Random tracks run a scheduler using the resolved trigger interval.
// - One-shots toggle: a second trigger stops the current instance.
// - Three kind buses (loop/random/oneshot), master gain, per-track gain/pan and
//   a shared per-preset reverb convolver per bus.
//
// The engine owns all timers and audio nodes. It never reads the store; callers
// pass resolved tracks that already include sound metadata.

import { reactive } from 'vue'
import {
  BUSES,
  REVERB_PRESETS,
  clamp01,
  clampPan,
  coerceReverb,
} from '../lib/v3/schema.js'
import {
  pickSoundIndex,
  triggerDelay,
} from './playback-model.js'

const CROSSFADE = 1.8
const WET_RATIO = 0.4
const REVERB_RETURN_LEVEL = 0.5
const START_FADE = 0.35
const STOP_FADE = 0.25

const REVERB_PARAMS = {
  City: { decay: 1.2, damping: 6000 },
  Cave: { decay: 3.5, damping: 1500 },
  'Stone Dungeon': { decay: 3.0, damping: 1800 },
  'Soft furnished room': { decay: 1.0, damping: 4000 },
  'Stone room': { decay: 1.8, damping: 2500 },
  Forest: { decay: 1.6, damping: 3000 },
  Mountains: { decay: 2.5, damping: 2200 },
  Plain: { decay: 0.9, damping: 5000 },
  Alley: { decay: 1.3, damping: 3500 },
  Hallway: { decay: 1.9, damping: 2000 },
  Auditorium: { decay: 3.2, damping: 1600 },
  Arena: { decay: 4.0, damping: 1200 },
}

const FALLBACK_REVERB = { decay: 2.0, damping: 3000 }

export const state = reactive({
  ready: false,
  unlocked: false,
  suspended: false,
  tracks: {},
  palettes: {},
  preview: null,
  activeTrackCount: 0,
  activePaletteCount: 0,
})

let ctx = null
let masterGain = null
let busNodes = null
let reverbReturns = null
let progressTimer = null
let masterVolume = 0.8
const busVolumes = { loop: 1, random: 1, oneshot: 1 }

const buffers = new Map()
const pending = new Map()
const convolvers = new Map()
const trackVoices = new Map()
const paletteVoices = new Map()
let previewVoice = null
let previewToken = 0
let options = {}

function configure(next = {}) {
  options = { ...options, ...next }
}

function soundUrl(meta) {
  if (!meta) return ''
  return meta.url || `/audio/${meta.hash}`
}

function ensureCtx() {
  if (!ctx) {
    const Ctx = window.AudioContext || window.webkitAudioContext
    ctx = new Ctx()
    masterGain = ctx.createGain()
    masterGain.gain.value = masterVolume
    masterGain.connect(ctx.destination)

    busNodes = {}
    reverbReturns = {}
    for (const bus of BUSES) {
      const node = ctx.createGain()
      node.gain.value = busVolumes[bus]
      node.connect(masterGain)
      busNodes[bus] = node

      const ret = ctx.createGain()
      ret.gain.value = busVolumes[bus] * REVERB_RETURN_LEVEL
      ret.connect(masterGain)
      reverbReturns[bus] = ret
    }

    ctx.onstatechange = () => {
      state.suspended = ctx.state === 'suspended'
      state.unlocked = ctx.state === 'running'
    }
    state.ready = true
    progressTimer = setInterval(tick, 200)
  }
  if (ctx.state === 'suspended') ctx.resume().catch(() => {})
  state.suspended = ctx.state === 'suspended'
  state.unlocked = ctx.state === 'running'
  return ctx
}

async function unlock() {
  ensureCtx()
  if (ctx && ctx.state === 'suspended') {
    try {
      await ctx.resume()
    } catch {
      /* needs a real user gesture */
    }
  }
  state.suspended = ctx ? ctx.state === 'suspended' : false
  state.unlocked = ctx ? ctx.state === 'running' : false
  return state.unlocked
}

function rampTo(param, value, seconds = 0.08) {
  if (!ctx || !param) return
  const t = ctx.currentTime
  param.cancelScheduledValues(t)
  param.setValueAtTime(param.value, t)
  param.linearRampToValueAtTime(Number.isFinite(value) ? value : 0, t + seconds)
}

function ramp(param, value, seconds = 0.08) {
  rampTo(param, clamp01(value), seconds)
}

function getBus(kind) {
  return busNodes?.[kind] || busNodes?.oneshot || masterGain
}

function setMaster(value) {
  masterVolume = clamp01(value)
  ramp(masterGain?.gain, masterVolume)
}

function setBus(bus, value) {
  if (!BUSES.includes(bus)) return
  busVolumes[bus] = clamp01(value)
  ramp(busNodes?.[bus]?.gain, busVolumes[bus])
  if (reverbReturns?.[bus]) {
    ramp(reverbReturns[bus].gain, busVolumes[bus] * REVERB_RETURN_LEVEL)
  }
}

function createImpulseResponse(decay, damping) {
  const sampleRate = ctx.sampleRate
  const len = Math.max(1, Math.floor(decay * sampleRate))
  const buffer = ctx.createBuffer(2, len, sampleRate)
  const cutoff = Math.max(20, damping)
  const alpha = Math.exp((-2 * Math.PI * cutoff) / sampleRate)
  for (let ch = 0; ch < 2; ch += 1) {
    const data = buffer.getChannelData(ch)
    let lp = 0
    for (let i = 0; i < len; i += 1) {
      const noise = Math.random() * 2 - 1
      lp = lp * alpha + noise * (1 - alpha)
      data[i] = lp * Math.pow(1 - i / len, 2)
    }
  }
  return buffer
}

function getReverb(bus, preset) {
  const name = coerceReverb(preset)
  if (!name) return null
  const known = REVERB_PRESETS.includes(name) ? name : null
  if (!known) return null
  const key = `${bus}::${known}`
  if (!convolvers.has(key)) {
    const params = REVERB_PARAMS[known] || FALLBACK_REVERB
    const conv = ctx.createConvolver()
    conv.buffer = createImpulseResponse(params.decay, params.damping)
    conv.connect(reverbReturns[bus] || masterGain)
    convolvers.set(key, conv)
  }
  return convolvers.get(key)
}

function loadBuffer(meta) {
  const url = typeof meta === 'string' ? meta : soundUrl(meta)
  if (!url) return Promise.reject(new Error('Missing audio url'))
  if (buffers.has(url)) return Promise.resolve(buffers.get(url))
  if (pending.has(url)) return pending.get(url)
  const promise = (async () => {
    try {
      const res = await fetch(url)
      if (!res.ok) throw new Error(`Failed to load audio (${res.status})`)
      const audio = await ctx.decodeAudioData(await res.arrayBuffer())
      buffers.set(url, audio)
      return audio
    } finally {
      pending.delete(url)
    }
  })()
  pending.set(url, promise)
  return promise
}

function persistDuration(meta, duration) {
  if (!meta) return
  const known = Number(meta.duration)
  if (Number.isFinite(known) && known > 0) return
  if (!Number.isFinite(duration) || duration <= 0) return
  meta.duration = duration
  if (typeof options.onDuration === 'function') {
    options.onDuration(meta.id, duration)
  }
}

function voiceRecord(voice) {
  const target = voice.type === 'track' ? state.tracks : state.palettes
  const existing = target[voice.key]
  const record = existing || {}
  record.active = true
  record.kind = voice.kind
  record.playing = Boolean(voice.nodes)
  record.position = record.position || 0
  record.duration = record.duration || 0
  record.soundId = record.soundId || null
  record.soundName = record.soundName || ''
  record.selection = voice.selection
  record.label = voice.label || ''
  target[voice.key] = record
}

function updateCounts() {
  state.activeTrackCount = trackVoices.size
  state.activePaletteCount = paletteVoices.size
}

function allVoices() {
  return [...trackVoices.values(), ...paletteVoices.values()]
}

function removeVoiceState(voice) {
  if (voice.type === 'track') delete state.tracks[voice.key]
  else delete state.palettes[voice.key]
  updateCounts()
}

function clearTimer(voice) {
  if (voice.timer) {
    clearTimeout(voice.timer)
    voice.timer = null
  }
}

function fadeOutNodes(nodes, seconds = STOP_FADE) {
  if (!ctx || !nodes) return
  const t = ctx.currentTime
  for (const param of [nodes.gain?.gain, nodes.wet?.gain]) {
    if (!param) continue
    param.cancelScheduledValues(t)
    param.setValueAtTime(param.value, t)
    param.linearRampToValueAtTime(0.0001, t + Math.max(0.01, seconds))
  }
  try {
    nodes.src.stop(t + Math.max(0.01, seconds) + 0.06)
  } catch {
    /* already stopped */
  }
}

function applyVoiceReverb(voice, preset) {
  voice.reverb = coerceReverb(preset)
  const nodes = voice.nodes
  if (!nodes || !ctx) return
  if (nodes.wet) {
    try {
      nodes.wet.disconnect()
    } catch {
      /* already disconnected */
    }
    nodes.wet = null
  }
  const conv = getReverb(voice.bus, voice.reverb)
  if (conv) {
    const wet = ctx.createGain()
    wet.gain.value = voice.gain * WET_RATIO
    nodes.src.connect(wet)
    wet.connect(conv)
    nodes.wet = wet
  }
}

function createSegment(voice, buffer, { loop, meta }) {
  const src = ctx.createBufferSource()
  src.buffer = buffer
  src.loop = loop

  const gain = ctx.createGain()
  const now = ctx.currentTime
  gain.gain.setValueAtTime(0.0001, now)
  gain.gain.linearRampToValueAtTime(voice.gain, now + START_FADE)

  let pan = null
  if (typeof ctx.createStereoPanner === 'function') {
    pan = ctx.createStereoPanner()
    pan.pan.value = voice.pan
    src.connect(gain)
    gain.connect(pan)
    pan.connect(getBus(voice.bus))
  } else {
    src.connect(gain)
    gain.connect(getBus(voice.bus))
  }

  let wet = null
  const conv = getReverb(voice.bus, voice.reverb)
  if (conv) {
    wet = ctx.createGain()
    wet.gain.setValueAtTime(0.0001, now)
    wet.gain.linearRampToValueAtTime(voice.gain * WET_RATIO, now + START_FADE)
    src.connect(wet)
    wet.connect(conv)
  }

  voice.nodes = { src, gain, pan, wet }
  voice.segmentStartedAt = now
  voice.segmentDuration = buffer.duration || 0
  voice.soundId = meta?.id || null
  voice.soundName = meta?.originalName || meta?.id || ''
  voice.generation = (voice.generation || 0) + 1

  const record = (voice.type === 'track' ? state.tracks : state.palettes)[voice.key]
  if (record) {
    record.playing = true
    record.duration = voice.segmentDuration
    record.soundId = voice.soundId
    record.soundName = voice.soundName
    record.position = 0
  }

  src.start()
  persistDuration(meta, buffer.duration)
  return voice.nodes
}

function chooseSound(voice) {
  const count = Array.isArray(voice.soundData) ? voice.soundData.length : 0
  const index = pickSoundIndex(voice.selection, count, voice.lastIndex)
  if (index < 0) return null
  const meta = voice.soundData[index]
  return { index, meta }
}

function scheduleLoopAdvance(voice, duration) {
  clearTimer(voice)
  if (!Array.isArray(voice.soundData) || voice.soundData.length < 2) return
  const wait = duration > CROSSFADE ? duration - CROSSFADE : duration
  voice.timer = setTimeout(
    () => {
      voice.timer = null
      playLoopSegment(voice)
    },
    Math.max(50, wait * 1000)
  )
}

async function playLoopSegment(voice) {
  if (!voice.active) return
  const pick = chooseSound(voice)
  if (!pick) {
    stopVoice(voice, 0)
    return
  }
  voice.lastIndex = pick.index

  let audio
  try {
    audio = await loadBuffer(pick.meta)
  } catch (err) {
    if (typeof options.onError === 'function') {
      options.onError(`Could not load "${pick.meta?.originalName || 'audio'}": ${err.message}`)
    }
    stopVoice(voice, 0.05)
    return
  }
  if (!voice.active) return

  const previous = voice.nodes
  if (previous) fadeOutNodes(previous, CROSSFADE)
  createSegment(voice, audio, { loop: true, meta: pick.meta })
  scheduleLoopAdvance(voice, audio.duration)
}

function scheduleRandomNext(voice) {
  if (!voice.active) return
  clearTimer(voice)
  const delay = triggerDelay(voice.trigger, Math.random)
  voice.timer = setTimeout(
    () => {
      voice.timer = null
      fireRandom(voice)
    },
    Math.max(0, delay) * 1000
  )
}

async function fireRandom(voice) {
  if (!voice.active) return
  const pick = chooseSound(voice)
  if (!pick) {
    stopVoice(voice, 0)
    return
  }
  voice.lastIndex = pick.index

  let audio
  try {
    audio = await loadBuffer(pick.meta)
  } catch (err) {
    if (typeof options.onError === 'function') {
      options.onError(`Could not load "${pick.meta?.originalName || 'audio'}": ${err.message}`)
    }
    scheduleRandomNext(voice)
    return
  }
  if (!voice.active) return

  const previous = voice.nodes
  if (previous) fadeOutNodes(previous, 0.08)
  const nodes = createSegment(voice, audio, { loop: false, meta: pick.meta })
  const generation = voice.generation
  nodes.src.onended = () => {
    if (!voice.active || voice.generation !== generation || voice.nodes !== nodes) return
    voice.nodes = null
    const record = state.tracks[voice.key] || state.palettes[voice.key]
    if (record) record.playing = false
    scheduleRandomNext(voice)
  }
}

async function playOneShot(voice) {
  if (!voice.active) return
  const pick = chooseSound(voice)
  if (!pick) {
    stopVoice(voice, 0)
    return
  }
  voice.lastIndex = pick.index

  let audio
  try {
    audio = await loadBuffer(pick.meta)
  } catch (err) {
    if (typeof options.onError === 'function') {
      options.onError(`Could not load "${pick.meta?.originalName || 'audio'}": ${err.message}`)
    }
    stopVoice(voice, 0.05)
    return
  }
  if (!voice.active) return

  const previous = voice.nodes
  if (previous) fadeOutNodes(previous, 0.08)
  const nodes = createSegment(voice, audio, { loop: false, meta: pick.meta })
  const generation = voice.generation
  nodes.src.onended = () => {
    if (!voice.active || voice.generation !== generation || voice.nodes !== nodes) return
    voice.nodes = null
    stopVoice(voice, 0)
  }
}

function startVoice(voice) {
  const sounds = Array.isArray(voice.soundData) ? voice.soundData : []
  if (!sounds.length) {
    if (typeof options.onError === 'function') {
      options.onError(`Group for "${voice.label || voice.key}" has no playable sounds`)
    }
    return false
  }
  voice.active = true
  voice.lastIndex = -1
  voiceRecord(voice)
  const map = voice.type === 'track' ? trackVoices : paletteVoices
  map.set(voice.key, voice)
  updateCounts()

  if (voice.kind === 'loop') playLoopSegment(voice)
  else if (voice.kind === 'random') {
    const delay = triggerDelay(voice.trigger, Math.random, { initial: true })
    voice.timer = setTimeout(
      () => {
        voice.timer = null
        fireRandom(voice)
      },
      Math.max(0, delay) * 1000
    )
  } else playOneShot(voice)

  return true
}

function stopVoice(voice, fade = STOP_FADE) {
  if (!voice) return
  voice.active = false
  clearTimer(voice)
  const nodes = voice.nodes
  voice.nodes = null
  if (nodes) fadeOutNodes(nodes, fade)
  const map = voice.type === 'track' ? trackVoices : paletteVoices
  if (map.get(voice.key) === voice) map.delete(voice.key)
  removeVoiceState(voice)
}

function makeTrackVoice(track) {
  return {
    type: 'track',
    key: track.trackId,
    kind: track.kind,
    bus: track.kind,
    label: track.groupName || '',
    soundData: track.soundData || [],
    sounds: track.sounds || [],
    selection: track.selection || 'random',
    gain: clamp01(track.gain ?? 0.8),
    reverb: coerceReverb(track.reverb),
    pan: clampPan(track.pan ?? 0),
    trigger: track.trigger,
    lastIndex: -1,
    timer: null,
    nodes: null,
    active: false,
    generation: 0,
    segmentStartedAt: 0,
    segmentDuration: 0,
    soundId: null,
    soundName: '',
  }
}

function startTrack(track) {
  if (!track || !track.trackId) return false
  ensureCtx()
  if (trackVoices.has(track.trackId)) return false
  return startVoice(makeTrackVoice(track))
}

function stopTrack(trackId, fade = STOP_FADE) {
  const voice = trackVoices.get(trackId)
  if (voice) stopVoice(voice, fade)
}

function isTrackActive(trackId) {
  return trackVoices.has(trackId)
}

function activeTrackIds(kind) {
  const ids = []
  for (const voice of trackVoices.values()) {
    if (kind && voice.kind !== kind) continue
    ids.push(voice.key)
  }
  return ids
}

function applyTrackParams(track) {
  if (!track || !track.trackId) return
  const voice = trackVoices.get(track.trackId)
  if (!voice) return
  voice.gain = clamp01(track.gain ?? voice.gain)
  voice.pan = clampPan(track.pan ?? voice.pan)
  voice.selection = track.selection || voice.selection
  voice.soundData = Array.isArray(track.soundData) ? track.soundData : voice.soundData
  voice.sounds = Array.isArray(track.sounds) ? track.sounds : voice.sounds
  voice.trigger = track.trigger ?? voice.trigger
  voice.label = track.groupName || voice.label

  const record = state.tracks[voice.key]
  if (record) {
    record.kind = voice.kind
    record.selection = voice.selection
    record.label = voice.label
  }

  if (voice.nodes) {
    ramp(voice.nodes.gain?.gain, voice.gain)
    if (voice.nodes.pan) rampTo(voice.nodes.pan.pan, voice.pan)
    if (voice.nodes.wet) ramp(voice.nodes.wet.gain, voice.gain * WET_RATIO)
  }
  if (coerceReverb(track.reverb) !== voice.reverb) applyVoiceReverb(voice, track.reverb)
}

function stopScene() {
  for (const voice of [...trackVoices.values()]) stopVoice(voice)
}

function makePaletteVoice(entry) {
  return {
    type: 'palette',
    key: entry.paletteId,
    kind: entry.kind,
    bus: entry.kind,
    label: entry.label || entry.groupName || '',
    soundData: entry.soundData || [],
    sounds: entry.sounds || [],
    selection: entry.selection || 'random',
    gain: clamp01(entry.gain ?? 0.8),
    reverb: coerceReverb(entry.reverb),
    pan: clampPan(entry.pan ?? 0),
    trigger: entry.trigger,
    lastIndex: -1,
    timer: null,
    nodes: null,
    active: false,
    generation: 0,
    segmentStartedAt: 0,
    segmentDuration: 0,
    soundId: null,
    soundName: '',
  }
}

function triggerPalette(entry) {
  if (!entry || !entry.paletteId) return false
  ensureCtx()
  if (paletteVoices.has(entry.paletteId)) {
    stopPalette(entry.paletteId)
    return false
  }
  return startVoice(makePaletteVoice(entry))
}

function stopPalette(paletteId, fade = STOP_FADE) {
  const voice = paletteVoices.get(paletteId)
  if (voice) stopVoice(voice, fade)
}

function stopPaletteAll() {
  for (const voice of [...paletteVoices.values()]) stopVoice(voice)
}

function isPaletteActive(paletteId) {
  return paletteVoices.has(paletteId)
}

function setPaletteGain(paletteId, value) {
  const voice = paletteVoices.get(paletteId)
  if (!voice) return
  voice.gain = clamp01(value)
  if (voice.nodes) {
    ramp(voice.nodes.gain?.gain, voice.gain)
    if (voice.nodes.wet) ramp(voice.nodes.wet.gain, voice.gain * WET_RATIO)
  }
}

function stopPreview() {
  previewToken += 1
  if (previewVoice) {
    const { src } = previewVoice
    previewVoice = null
    try {
      src.stop()
    } catch {
      /* already stopped */
    }
  }
  state.preview = null
}

async function preview(url, id) {
  ensureCtx()
  stopPreview()
  if (!url) return false
  const token = ++previewToken

  let audio
  try {
    audio = await loadBuffer(url)
  } catch (err) {
    if (typeof options.onError === 'function') options.onError(`Preview failed: ${err.message}`)
    return false
  }
  if (token !== previewToken) return false

  const src = ctx.createBufferSource()
  src.buffer = audio
  const gain = ctx.createGain()
  gain.gain.value = 0.9
  src.connect(gain)
  gain.connect(masterGain)
  previewVoice = { src, gain, startedAt: ctx.currentTime, duration: audio.duration, id }
  state.preview = {
    playing: true,
    position: 0,
    duration: audio.duration,
    id: id || null,
    url,
  }
  src.onended = () => {
    if (previewVoice?.src === src) {
      previewVoice = null
      if (state.preview) state.preview.playing = false
    }
  }
  src.start()
  persistDuration(id ? { id } : null, audio.duration)
  return true
}

function stopAll() {
  stopScene()
  stopPaletteAll()
  stopPreview()
}

function tick() {
  if (!ctx) return
  const now = ctx.currentTime
  for (const voice of allVoices()) {
    if (!voice.nodes) continue
    const elapsed = Math.max(0, now - voice.segmentStartedAt)
    const duration = voice.segmentDuration || 0
    let position = elapsed
    if (voice.kind === 'loop' && duration > 0) position = elapsed % duration
    else if (duration > 0) position = Math.min(elapsed, duration)

    const record = (voice.type === 'track' ? state.tracks : state.palettes)[voice.key]
    if (!record) continue
    record.playing = true
    record.position = position
    record.duration = duration
    record.soundId = voice.soundId
    record.soundName = voice.soundName
  }

  if (previewVoice && state.preview) {
    state.preview.position = Math.min(
      Math.max(0, now - previewVoice.startedAt),
      previewVoice.duration || 0
    )
  }
}

export const engine = {
  state,
  configure,
  unlock,
  ensureCtx,
  setMaster,
  setBus,
  startTrack,
  stopTrack,
  stopScene,
  isTrackActive,
  activeTrackIds,
  applyTrackParams,
  triggerPalette,
  stopPalette,
  stopPaletteAll,
  isPaletteActive,
  setPaletteGain,
  preview,
  stopPreview,
  stopAll,
}

export default engine
