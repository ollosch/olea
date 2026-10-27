// Framework-free playback/transport model for the v3 browser engine.
//
// Pure helpers only: no Vue, no DOM, no I/O, no timers. Callers own the audio
// graph and scheduling. Trigger delays are returned in **seconds** to match the
// engine/Web Audio clock.

import {
  DEFAULT_RANDOM_TRIGGER,
  KINDS,
  isZeroTrigger,
  sanitizeTrigger,
} from '../lib/v3/schema.js'
import { resolveScene } from '../lib/v3/resolve.js'
import { groupTracks } from '../lib/v3/order.js'

const isObj = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)
const asList = (value) => (Array.isArray(value) ? value : [])

function finiteNumber(value, fallback = 0) {
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) ? n : fallback
}

function randomValue(random) {
  const fn = typeof random === 'function' ? random : Math.random
  const value = Number(fn())
  if (!Number.isFinite(value)) return 0
  return Math.min(1, Math.max(0, value))
}

function idSet(ids) {
  if (ids instanceof Set) return ids
  return new Set(asList(ids))
}

function sameTrigger(a, b) {
  const left = sanitizeTrigger(a)
  const right = sanitizeTrigger(b)
  return (
    left.min === right.min &&
    left.max === right.max &&
    left.startMin === right.startMin &&
    left.startMax === right.startMax
  )
}

function sameTrackParams(a, b) {
  return (
    a.gain === b.gain &&
    a.reverb === b.reverb &&
    a.pan === b.pan &&
    sameTrigger(a.trigger, b.trigger)
  )
}

function groupLookup(groupsById, fallbackGroups = []) {
  if (groupsById instanceof Map) return (id) => groupsById.get(id) || null
  if (Array.isArray(groupsById)) {
    const index = new Map(groupsById.map((group) => [group?.id, group]))
    return (id) => index.get(id) || null
  }
  if (isObj(groupsById)) return (id) => groupsById[id] || null
  const index = new Map(
    asList(fallbackGroups).map((group) => [group?.id, group]).filter(([id]) => Boolean(id))
  )
  return (id) => index.get(id) || null
}

function libraryGroups(library) {
  if (Array.isArray(library)) return library
  if (isObj(library) && Array.isArray(library.groups)) return library.groups
  return []
}

/**
 * Pick a sound index from a group's selection mode.
 *
 * `ordered` advances from `lastIndex` and wraps. `random` avoids repeating the
 * immediately previous index when there is more than one sound. The injected
 * `random` is called at most once, so results are deterministic.
 */
export function pickSoundIndex(selection, count, lastIndex = -1, random = Math.random) {
  const total = Math.trunc(finiteNumber(count, 0))
  if (!Number.isFinite(total) || total <= 0) return -1
  if (total === 1) return 0

  const previous = Number.isInteger(lastIndex) ? lastIndex : -1
  if (selection === 'ordered') {
    const last = previous >= 0 ? previous : -1
    return (last + 1) % total
  }

  let index = Math.floor(randomValue(random) * total)
  index = Math.min(total - 1, Math.max(0, index))
  if (previous >= 0 && previous < total && index === previous) {
    index = (index + 1) % total
  }
  return index
}

/**
 * Continuous random value between two finite, ordered bounds. The result may
 * equal `min` and approaches `max` (inclusive-ish), matching `Math.random()`.
 */
export function randomBetween(min, max, random = Math.random) {
  let lo = finiteNumber(min, 0)
  let hi = finiteNumber(max, 0)
  if (lo > hi) [lo, hi] = [hi, lo]
  return lo + (hi - lo) * randomValue(random)
}

/**
 * Delay before the next trigger, in **seconds**.
 *
 * `initial: true` uses `startMin`/`startMax` (missing values fall back to 0);
 * later triggers use `min`/`max`. Values are sanitized through the v3 schema and
 * an all-zero random trigger falls back to `DEFAULT_RANDOM_TRIGGER`.
 */
export function triggerDelay(trigger, random = Math.random, options = {}) {
  const opts = isObj(options) ? options : {}
  const sanitized = sanitizeTrigger(trigger)
  const effective = isZeroTrigger(sanitized)
    ? sanitizeTrigger(DEFAULT_RANDOM_TRIGGER)
    : sanitized
  const initial = opts.initial === true
  return randomBetween(
    initial ? effective.startMin : effective.min,
    initial ? effective.startMax : effective.max,
    random
  )
}

/**
 * Resolve a scene/mood into transport sections. Does not start anything.
 * `loops`/`randoms`/`oneshots` are ordered by the scene-wide track order;
 * `all` is the concatenation in display order (loop, random, oneshot).
 */
export function resolveScenePlan(scene, groupsById, moodId) {
  const { mood, tracks } = resolveScene(scene, groupsById, moodId)
  const sections = groupTracks(tracks)
  const byKind = Object.fromEntries(sections.map((section) => [section.kind, section.tracks]))
  const loops = byKind.loop || []
  const randoms = byKind.random || []
  const oneshots = byKind.oneshot || []
  return { mood, loops, randoms, oneshots, all: [...loops, ...randoms, ...oneshots] }
}

function enabledOnly(tracks) {
  return asList(tracks).filter((track) => track && track.enabled === true)
}

/**
 * Plan the first Play: start enabled loops/randoms, leave one-shots silent.
 * Disabled tracks are excluded from every section.
 */
export function initialTransportPlan(plan) {
  const p = isObj(plan) ? plan : {}
  return {
    startLoops: enabledOnly(p.loops),
    startRandoms: enabledOnly(p.randoms),
    silentOneshots: enabledOnly(p.oneshots),
  }
}

function trackIdOf(track) {
  return track?.trackId ?? track?.id ?? null
}

function findTrackById(plan, trackId) {
  for (const track of asList(plan?.all)) {
    if (trackIdOf(track) === trackId) return track
  }
  for (const listName of ['loops', 'randoms', 'oneshots']) {
    for (const track of asList(plan?.[listName])) {
      if (trackIdOf(track) === trackId) return track
    }
  }
  return null
}

function stopList(previous, nextEnabledIds, activeIds, kind) {
  const out = []
  const seen = new Set()
  for (const id of activeIds) {
    if (nextEnabledIds.has(id) || seen.has(id)) continue
    seen.add(id)
    out.push(findTrackById(previous, id) || { trackId: id, kind, enabled: false })
  }
  return out
}

function startList(nextTracks, previousEnabledIds, activeIds) {
  return nextTracks.filter((track) => {
    const id = trackIdOf(track)
    return !activeIds.has(id) && !previousEnabledIds.has(id)
  })
}

function changedParams(previousPlan, nextPlan) {
  const previousById = new Map(
    asList(previousPlan?.all)
      .map((track) => [trackIdOf(track), track])
      .filter(([id]) => id != null)
  )
  return asList(nextPlan?.all).filter((track) => {
    const previous = previousById.get(trackIdOf(track))
    return !previous || !sameTrackParams(previous, track)
  })
}

/**
 * Plan a live mood change while transport is running.
 *
 * - Active loops/randoms that are no longer enabled are stopped.
 * - Newly enabled loops/randoms that are not already active are started.
 * - One-shots are never started or stopped by a mood change.
 * - `apply` contains resolved tracks whose gain/reverb/pan/trigger changed.
 */
export function moodChangePlan(
  previousPlan,
  nextPlan,
  activeLoopIds = [],
  activeRandomIds = []
) {
  const previous = isObj(previousPlan) ? previousPlan : {}
  const next = isObj(nextPlan) ? nextPlan : {}
  const activeLoops = idSet(activeLoopIds)
  const activeRandoms = idSet(activeRandomIds)

  const nextLoops = enabledOnly(next.loops)
  const nextRandoms = enabledOnly(next.randoms)
  const nextLoopIds = new Set(nextLoops.map(trackIdOf))
  const nextRandomIds = new Set(nextRandoms.map(trackIdOf))
  const previousLoopIds = new Set(enabledOnly(previous.loops).map(trackIdOf))
  const previousRandomIds = new Set(enabledOnly(previous.randoms).map(trackIdOf))

  return {
    stopLoops: stopList(previous, nextLoopIds, activeLoops, 'loop'),
    startLoops: startList(nextLoops, previousLoopIds, activeLoops),
    stopRandoms: stopList(previous, nextRandomIds, activeRandoms, 'random'),
    startRandoms: startList(nextRandoms, previousRandomIds, activeRandoms),
    apply: changedParams(previous, next),
  }
}

/** Every kind toggles: stop when active, start otherwise. */
export function toggleDecision(kind, isActive) {
  return isActive ? 'stop' : 'start'
}

/** Resolve a manual track toggle against a plan and the current active ids. */
export function applyManualToggle(plan, trackId, activeIds = []) {
  const track = findTrackById(plan, trackId)
  if (!track) return { action: null, track: null }
  const active = idSet(activeIds)
  return { action: toggleDecision(track.kind, active.has(trackId)), track }
}

/** Palette kind fallback: group defaultKind when valid, otherwise one-shot. */
export function nextPaletteKind(group) {
  const kind = group?.defaultKind
  return KINDS.includes(kind) ? kind : 'oneshot'
}

/**
 * Resolve palette entries to group information. Palette entries never start
 * anything by themselves; the UI/MIDI dispatch decides when to trigger.
 */
export function palettePlan(library, palette, groupsById) {
  const lookup = groupLookup(groupsById, libraryGroups(library))
  return asList(palette)
    .filter((entry) => isObj(entry))
    .map((entry) => {
      const group = lookup(entry.groupId)
      const order = Number.isFinite(entry.order) ? entry.order : 0
      return {
        id: entry.id,
        paletteId: entry.id,
        groupId: entry.groupId,
        label: entry.label,
        gain: entry.gain ?? null,
        order,
        group,
        kind: nextPaletteKind(group),
        valid: Boolean(group),
      }
    })
    .sort((a, b) => a.order - b.order || String(a.id).localeCompare(String(b.id)))
}
