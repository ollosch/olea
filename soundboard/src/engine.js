// Web Audio engine. Two kinds of playback:
//   - loop elements: one or more samples cycled continuously (crossfaded when
//     the element has a playlist with several samples).
//   - one-shot elements: play a single sample; instances are tracked so they
//     can be stopped individually or all at once.
import { reactive } from 'vue'
import { REVERB_PRESETS, BUSES } from '../lib/schema.js'

const CROSSFADE = 2.0
const WET_RATIO = 0.4
const REVERB_RETURN_LEVEL = 0.5

// Per-preset reverb parameters: `decay` is the impulse length in seconds,
// `damping` acts as a lowpass cutoff (Hz-ish, higher = brighter) so darker
// presets roll off the high frequencies faster.
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

const state = reactive({
  activeLoops: new Set(), // loop element ids currently playing
  loading: new Set(), // urls currently being fetched/decoded
  activeOneshots: new Set(), // oneshot element ids with >= 1 live instance
})

let ctx = null
let masterGain = null
let loopsBus = null
let randomsBus = null
let effectsBus = null
let reverbReturn = null
const busVolumes = { loop: 1, random: 1, effects: 1 }
const convolvers = new Map() // preset name -> ConvolverNode (created lazily)
const buffers = new Map() // url -> AudioBuffer
const loops = new Map() // elementId -> loop entry
const oneshots = new Map() // elementId -> Set<instance>
const pending = new Map() // url -> Promise<AudioBuffer>

function ensureCtx() {
  if (!ctx) {
    ctx = new (window.AudioContext || window.webkitAudioContext)()
    masterGain = ctx.createGain()
    masterGain.connect(ctx.destination)
    loopsBus = ctx.createGain()
    loopsBus.gain.value = busVolumes.loop
    loopsBus.connect(masterGain)
    randomsBus = ctx.createGain()
    randomsBus.gain.value = busVolumes.random
    randomsBus.connect(masterGain)
    effectsBus = ctx.createGain()
    effectsBus.gain.value = busVolumes.effects
    effectsBus.connect(masterGain)
    reverbReturn = ctx.createGain()
    reverbReturn.gain.value = REVERB_RETURN_LEVEL
    reverbReturn.connect(masterGain)
  }
  if (ctx.state === 'suspended') ctx.resume()
  return ctx
}

function getBusNode(bus) {
  if (bus === BUSES[0]) return loopsBus // 'loop'
  if (bus === BUSES[1]) return randomsBus // 'random'
  return effectsBus // BUSES[2] === 'effects'
}

function setBusGain(bus, v) {
  busVolumes[bus] = v
  const node = getBusNode(bus)
  if (node) node.gain.value = v
}

function createImpulseResponse(decay, damping) {
  const sampleRate = ctx.sampleRate
  const len = Math.max(1, Math.floor(decay * sampleRate))
  const buffer = ctx.createBuffer(2, len, sampleRate)
  const cutoff = Math.max(20, damping)
  const alpha = Math.exp((-2 * Math.PI * cutoff) / sampleRate)
  for (let ch = 0; ch < 2; ch++) {
    const data = buffer.getChannelData(ch)
    let lp = 0
    for (let i = 0; i < len; i++) {
      const noise = Math.random() * 2 - 1
      lp = lp * alpha + noise * (1 - alpha)
      data[i] = lp * Math.pow(1 - i / len, 2)
    }
  }
  return buffer
}

function getReverb(preset) {
  if (!preset) return null
  let name = String(preset)
  const known = REVERB_PRESETS.find((p) => p.toLowerCase() === name.toLowerCase())
  if (known) name = known
  if (!convolvers.has(name)) {
    const params = REVERB_PARAMS[name] || FALLBACK_REVERB
    const conv = ctx.createConvolver()
    conv.buffer = createImpulseResponse(params.decay, params.damping)
    conv.connect(reverbReturn)
    convolvers.set(name, conv)
  }
  return convolvers.get(name)
}

function loadBuffer(url) {
  if (buffers.has(url)) return Promise.resolve(buffers.get(url))
  if (pending.has(url)) return pending.get(url)
  state.loading.add(url)
  const p = (async () => {
    try {
      const res = await fetch(url)
      if (!res.ok) throw new Error(`Failed to load audio (${res.status})`)
      const audio = await ctx.decodeAudioData(await res.arrayBuffer())
      buffers.set(url, audio)
      return audio
    } finally {
      state.loading.delete(url)
      pending.delete(url)
    }
  })()
  pending.set(url, p)
  return p
}

function startLoopSample(entry) {
  const url = entry.files[entry.idx % entry.files.length]
  return loadBuffer(url)
    .then((audio) => {
      if (!loops.has(entry.id)) return // stopped while loading
      const src = ctx.createBufferSource()
      src.buffer = audio
      src.loop = true
      const g = ctx.createGain()
      g.gain.setValueAtTime(0.0001, ctx.currentTime)
      g.gain.linearRampToValueAtTime(entry.gain, ctx.currentTime + CROSSFADE)
      src.connect(g)
      g.connect(getBusNode(entry.bus))
      let wet = null
      const conv = getReverb(entry.reverb)
      if (conv) {
        wet = ctx.createGain()
        wet.gain.setValueAtTime(0.0001, ctx.currentTime)
        wet.gain.linearRampToValueAtTime(entry.gain * WET_RATIO, ctx.currentTime + CROSSFADE)
        src.connect(wet)
        wet.connect(conv)
      }
      src.start()
      entry.src = src
      entry.gainNode = g
      entry.wetGainNode = wet
      entry.url = url
      scheduleAdvance(entry)
    })
    .catch((e) => {
      console.error('Failed to load loop', url, e)
      if (loops.has(entry.id)) {
        entry.idx += 1
        startLoopSample(entry)
      }
    })
}

function scheduleAdvance(entry) {
  if (entry.timer) clearTimeout(entry.timer)
  entry.timer = null
  if (entry.files.length < 2) return
  const url = entry.files[entry.idx % entry.files.length]
  const buffer = buffers.get(url)
  if (!buffer) return
  const dur = buffer.duration || 1
  // Crossfade into the next sample before this one loops; for very short
  // samples, advance after one full play so we never get stuck repeating it.
  const wait = dur > CROSSFADE ? dur - CROSSFADE : Math.max(dur, 0.1)
  entry.timer = setTimeout(() => advanceLoop(entry), wait * 1000)
}

function advanceLoop(entry) {
  if (!loops.has(entry.id)) return
  if (entry.files.length > 1) {
    if (entry.randomise) {
      const n = entry.files.length
      const i = Math.floor(Math.random() * (n - 1))
      entry.idx = i >= entry.idx ? i + 1 : i
    } else {
      entry.idx = (entry.idx + 1) % entry.files.length
    }
  }
  const prevSrc = entry.src
  const prevGain = entry.gainNode
  const prevWet = entry.wetGainNode
  entry.src = null
  entry.gainNode = null
  entry.wetGainNode = null
  startLoopSample(entry).then(() => {
    if (prevSrc && prevGain) {
      const t = ctx.currentTime
      prevGain.gain.cancelScheduledValues(t)
      prevGain.gain.setValueAtTime(prevGain.gain.value, t)
      prevGain.gain.linearRampToValueAtTime(0.0001, t + CROSSFADE)
      if (prevWet) {
        prevWet.gain.cancelScheduledValues(t)
        prevWet.gain.setValueAtTime(prevWet.gain.value, t)
        prevWet.gain.linearRampToValueAtTime(0.0001, t + CROSSFADE)
      }
      try {
        prevSrc.stop(t + CROSSFADE + 0.1)
      } catch {
        /* already stopped */
      }
    }
  })
}

async function playLoopElement(id, { files, gain = 0.8, randomise = false, reverb = null, bus = 'loop' } = {}) {
  ensureCtx()
  if (loops.has(id)) return
  if (!files || !files.length) return
  const entry = {
    id,
    files,
    gain,
    randomise,
    reverb,
    bus,
    idx: randomise ? Math.floor(Math.random() * files.length) : 0,
    src: null,
    gainNode: null,
    wetGainNode: null,
    url: null,
    timer: null,
  }
  loops.set(id, entry)
  state.activeLoops.add(id)
  await startLoopSample(entry)
}

function stopLoopElement(id, { fadeOut = 1.0 } = {}) {
  const entry = loops.get(id)
  if (!entry) return
  if (entry.timer) clearTimeout(entry.timer)
  const t = ctx.currentTime
  if (entry.gainNode) {
    entry.gainNode.gain.cancelScheduledValues(t)
    entry.gainNode.gain.setValueAtTime(entry.gainNode.gain.value, t)
    entry.gainNode.gain.linearRampToValueAtTime(0.0001, t + fadeOut)
  }
  if (entry.wetGainNode) {
    entry.wetGainNode.gain.cancelScheduledValues(t)
    entry.wetGainNode.gain.setValueAtTime(entry.wetGainNode.gain.value, t)
    entry.wetGainNode.gain.linearRampToValueAtTime(0.0001, t + fadeOut)
  }
  if (entry.src) {
    try {
      entry.src.stop(t + fadeOut + 0.1)
    } catch {
      /* already stopped */
    }
  }
  loops.delete(id)
  state.activeLoops.delete(id)
}

function setLoopGain(id, v) {
  const entry = loops.get(id)
  if (!entry) return
  entry.gain = v
  if (entry.gainNode) {
    const t = ctx.currentTime
    entry.gainNode.gain.cancelScheduledValues(t)
    entry.gainNode.gain.setValueAtTime(entry.gainNode.gain.value, t)
    entry.gainNode.gain.linearRampToValueAtTime(v, t + 0.05)
  }
  if (entry.wetGainNode) {
    const t = ctx.currentTime
    entry.wetGainNode.gain.cancelScheduledValues(t)
    entry.wetGainNode.gain.setValueAtTime(entry.wetGainNode.gain.value, t)
    entry.wetGainNode.gain.linearRampToValueAtTime(v * WET_RATIO, t + 0.05)
  }
}

function isLoopPlaying(id) {
  return state.activeLoops.has(id)
}

async function playOneShot(id, url, { gain = 1, bus = 'effects', reverb = null } = {}) {
  ensureCtx()
  let audio
  try {
    audio = await loadBuffer(url)
  } catch (e) {
    console.error('Failed to load effect', url, e)
    return
  }
  const src = ctx.createBufferSource()
  src.buffer = audio
  const g = ctx.createGain()
  g.gain.value = gain
  src.connect(g)
  g.connect(getBusNode(bus))

  const conv = getReverb(reverb)
  if (conv) {
    const wet = ctx.createGain()
    wet.gain.value = gain * WET_RATIO
    src.connect(wet)
    wet.connect(conv)
  }

  const inst = { src, gain: g }
  if (!oneshots.has(id)) oneshots.set(id, new Set())
  oneshots.get(id).add(inst)
  state.activeOneshots.add(id)

  src.onended = () => {
    const set = oneshots.get(id)
    if (set) {
      set.delete(inst)
      if (set.size === 0) {
        oneshots.delete(id)
        state.activeOneshots.delete(id)
      }
    }
  }
  src.start()
}

function stopOneShot(id) {
  const set = oneshots.get(id)
  if (!set) return
  for (const inst of Array.from(set)) {
    try {
      inst.src.stop()
    } catch {
      /* already stopped */
    }
  }
  oneshots.delete(id)
  state.activeOneshots.delete(id)
}

function stopAllOneshots() {
  for (const id of Array.from(oneshots.keys())) stopOneShot(id)
}

function stopAllLoops() {
  for (const id of Array.from(loops.keys())) stopLoopElement(id)
}

function stopAll() {
  stopAllLoops()
  stopAllOneshots()
}

function setMasterGain(v) {
  if (masterGain) masterGain.gain.value = v
}

function isOneShotPlaying(id) {
  return state.activeOneshots.has(id)
}

export const engine = {
  state,
  ensureCtx,
  playLoopElement,
  stopLoopElement,
  setLoopGain,
  isLoopPlaying,
  playOneShot,
  stopOneShot,
  stopAllOneshots,
  stopAllLoops,
  isOneShotPlaying,
  setMasterGain,
  setBusGain,
  stopAll,
}
