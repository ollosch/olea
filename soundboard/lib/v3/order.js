// Pure ordering helpers for scene tracks.
//
// Scene order is scene-wide (`order` 0..n-1). The UI displays tracks grouped by
// kind in GROUP_ORDER, then sorted by `order` (ties broken by id). Drag/drop
// across sections changes `kind` and renumbers the whole scene.

import { KINDS, normalizeTrack } from './schema.js'

export const GROUP_ORDER = ['loop', 'random', 'oneshot']

function orderOf(track) {
  const n = Number(track?.order)
  return Number.isFinite(n) ? n : 0
}

function compareTracks(a, b) {
  const diff = orderOf(a) - orderOf(b)
  if (diff !== 0) return diff
  const aid = String(a?.id ?? '')
  const bid = String(b?.id ?? '')
  return aid < bid ? -1 : aid > bid ? 1 : 0
}

export function groupTracks(tracks) {
  const list = Array.isArray(tracks) ? tracks.filter((track) => track && typeof track === 'object') : []
  return GROUP_ORDER.map((kind) => ({
    kind,
    tracks: list.filter((track) => track.kind === kind).slice().sort(compareTracks),
  }))
}

export function orderedTracks(tracks) {
  return groupTracks(tracks).flatMap((section) => section.tracks)
}

export function renumber(tracks) {
  return (Array.isArray(tracks) ? tracks : []).map((track, index) => ({ ...track, order: index }))
}

function clampIndex(value, min, max) {
  const n = Number(value)
  if (!Number.isFinite(n)) return min
  return Math.min(max, Math.max(min, Math.trunc(n)))
}

export function dropInsertionIndex(currentIds, movingIds, targetIndex) {
  const ids = Array.isArray(currentIds) ? currentIds : []
  const moving = new Set(Array.isArray(movingIds) ? movingIds : [movingIds])
  const original = clampIndex(targetIndex, 0, ids.length)
  let before = 0
  for (let i = 0; i < original; i += 1) {
    if (moving.has(ids[i])) before += 1
  }
  return Math.max(0, original - before)
}

export function moveTracks(tracks, movingIds, targetKind, targetIndexWithinKind = 0) {
  if (!KINDS.includes(targetKind)) throw new Error(`Invalid target kind: ${targetKind}`)

  const ids = new Set(Array.isArray(movingIds) ? movingIds : [movingIds])
  const sections = groupTracks(tracks).map((section) => ({
    kind: section.kind,
    tracks: [...section.tracks],
  }))

  const moving = []
  for (const section of sections) {
    section.tracks = section.tracks.filter((track) => {
      if (!ids.has(track.id)) return true
      moving.push(track)
      return false
    })
  }

  const target = sections.find((section) => section.kind === targetKind)
  const moved = moving.map((track) => ({ ...track, kind: targetKind }))
  const index = clampIndex(targetIndexWithinKind, 0, target.tracks.length)
  target.tracks.splice(index, 0, ...moved)

  return renumber(sections.flatMap((section) => section.tracks))
}

export function nextOrder(tracks) {
  let max = -1
  for (const track of Array.isArray(tracks) ? tracks : []) {
    const n = Number(track?.order)
    if (Number.isFinite(n) && n > max) max = n
  }
  return max + 1
}

export function addTracksForGroups(tracks, groups, kindOverride) {
  const out = Array.isArray(tracks) ? [...tracks] : []
  const list = Array.isArray(groups) ? groups : []
  let order = nextOrder(out)

  for (const group of list) {
    if (!group || typeof group !== 'object') continue
    const kind = KINDS.includes(kindOverride)
      ? kindOverride
      : KINDS.includes(group.defaultKind)
        ? group.defaultKind
        : 'oneshot'
    const trigger = kind === 'random' ? group.defaults?.trigger : undefined
    out.push(
      normalizeTrack(
        {
          groupId: group.id,
          kind,
          order,
          trigger,
        },
        order
      )
    )
    order += 1
  }

  return out
}
