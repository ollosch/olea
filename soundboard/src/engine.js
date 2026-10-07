// Web Audio engine. Two kinds of playback:
//   - loop elements: one or more samples cycled continuously (crossfaded when
//     the element has a playlist with several samples).
//   - one-shot elements: play a single sample; instances are tracked so they
//     can be stopped individually or all at once.
import { reactive } from 'vue'

const CROSSFADE = 2.0

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
const busVolumes = { loop: 1, random: 1, effects: 1 }
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
  }
  if (ctx.state === 'suspended') ctx.resume()
  return ctx
}

function setBusGain(bus, v) {
  busVolumes[bus] = v
  const node = bus === 'loop' ? loopsBus : bus === 'random' ? randomsBus : effectsBus
  if (node) node.gain.value = v
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
      g.connect(loopsBus)
      src.start()
      entry.src = src
      entry.gainNode = g
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
  entry.src = null
  entry.gainNode = null
  startLoopSample(entry).then(() => {
    if (prevSrc && prevGain) {
      const t = ctx.currentTime
      prevGain.gain.cancelScheduledValues(t)
      prevGain.gain.setValueAtTime(prevGain.gain.value, t)
      prevGain.gain.linearRampToValueAtTime(0.0001, t + CROSSFADE)
      try {
        prevSrc.stop(t + CROSSFADE + 0.1)
      } catch {
        /* already stopped */
      }
    }
  })
}

async function playLoopElement(id, { files, gain = 0.8, randomise = false } = {}) {
  ensureCtx()
  if (loops.has(id)) return
  if (!files || !files.length) return
  const entry = {
    id,
    files,
    gain,
    randomise,
    idx: randomise ? Math.floor(Math.random() * files.length) : 0,
    src: null,
    gainNode: null,
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
}

function isLoopPlaying(id) {
  return state.activeLoops.has(id)
}

async function playOneShot(id, url, { gain = 1, bus = 'effects' } = {}) {
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
  g.connect(bus === 'random' ? randomsBus : effectsBus)

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
