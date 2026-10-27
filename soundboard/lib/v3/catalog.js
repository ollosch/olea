// Pure catalog helpers: indexes, paged search/filtering, dedupe, and stats.
//
// `searchCatalog` accepts an optional `assignedIds` map. Its values may be
// group ids, group objects, or arrays of either. When group objects are supplied
// the `groupId`, `kind`, `category`, and `tag` filters can be applied.

import { normalizeSound } from './schema.js'

const isObj = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)

function soundList(catalog) {
  return Array.isArray(catalog?.sounds) ? catalog.sounds : []
}

function clampInt(value, fallback, min, max) {
  const n = typeof value === 'number' ? value : typeof value === 'string' && value.trim() !== '' ? Number(value) : NaN
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, Math.trunc(n)))
}

export function soundIndex(catalog) {
  return new Map(soundList(catalog).filter(Boolean).map((sound) => [sound.id, sound]))
}

export function hashIndex(catalog) {
  const index = new Map()
  for (const sound of soundList(catalog)) {
    if (sound?.hash) index.set(sound.hash, sound)
  }
  return index
}

export function findSound(catalog, id) {
  if (typeof id !== 'string' || !id) return null
  return soundList(catalog).find((sound) => sound?.id === id) || null
}

export function findByHash(catalog, hash) {
  if (typeof hash !== 'string' || !hash) return null
  const normalized = hash.toLowerCase()
  return soundList(catalog).find((sound) => sound?.hash === normalized) || null
}

function groupRef(value) {
  if (typeof value === 'string') return value ? { id: value } : null
  if (!isObj(value) || typeof value.id !== 'string' || !value.id) return null
  return {
    id: value.id,
    category: typeof value.category === 'string' ? value.category : '',
    tags: Array.isArray(value.tags) ? value.tags : [],
    defaultKind: typeof value.defaultKind === 'string' ? value.defaultKind : null,
  }
}

function groupRefs(value) {
  if (value == null) return []
  const list = value instanceof Set ? Array.from(value) : Array.isArray(value) ? value : [value]
  return list.map(groupRef).filter(Boolean)
}

function assignmentIndex(assignedIds) {
  if (assignedIds == null) return null
  const map = new Map()
  if (assignedIds instanceof Map) {
    for (const [id, value] of assignedIds) map.set(id, groupRefs(value))
  } else if (assignedIds instanceof Set || Array.isArray(assignedIds)) {
    for (const id of assignedIds) {
      if (typeof id === 'string' && id) map.set(id, [])
    }
  } else if (isObj(assignedIds)) {
    for (const [id, value] of Object.entries(assignedIds)) map.set(id, groupRefs(value))
  }
  return map
}

function categoryMatches(category, filter) {
  const value = typeof category === 'string' ? category : ''
  const wanted = filter.trim()
  if (!wanted) return true
  return value === wanted || value.startsWith(`${wanted}/`)
}

export function searchCatalog(catalog, options = {}) {
  const opts = isObj(options) ? options : {}
  const query = typeof opts.query === 'string' ? opts.query.trim().toLowerCase() : ''
  const assignments = assignmentIndex(opts.assignedIds)
  const unassigned = Boolean(opts.unassigned)
  const groupId = typeof opts.groupId === 'string' ? opts.groupId.trim() : ''
  const kind = typeof opts.kind === 'string' ? opts.kind.trim() : ''
  const category = typeof opts.category === 'string' ? opts.category.trim() : ''
  const tag = typeof opts.tag === 'string' ? opts.tag.trim().toLowerCase() : ''
  const offset = clampInt(opts.offset, 0, 0, Number.MAX_SAFE_INTEGER)
  const limit = clampInt(opts.limit, 50, 1, 200)

  const matches = []
  for (const sound of soundList(catalog)) {
    if (!sound) continue

    if (query) {
      const haystack = `${sound.originalName ?? ''}\n${sound.id ?? ''}\n${sound.hash ?? ''}`.toLowerCase()
      if (!haystack.includes(query)) continue
    }

    const assigned = assignments ? assignments.has(sound.id) : false
    if (unassigned && assigned) continue

    if (groupId || kind || category || tag) {
      const groups = assignments?.get(sound.id) || []
      if (groupId && !groups.some((group) => group.id === groupId)) continue
      if (kind && !groups.some((group) => group.defaultKind === kind)) continue
      if (category && !groups.some((group) => categoryMatches(group.category, category))) continue
      if (
        tag &&
        !groups.some((group) =>
          group.tags.some((candidate) => String(candidate).trim().toLowerCase() === tag)
        )
      ) {
        continue
      }
    }

    matches.push(sound)
  }

  return {
    sounds: matches.slice(offset, offset + limit),
    total: matches.length,
    offset,
    limit,
  }
}

export function stats(catalog, library, importDone) {
  const sounds = soundList(catalog)
  const groups = Array.isArray(library?.groups) ? library.groups : []
  const catalogIds = new Set(sounds.map((sound) => sound?.id).filter(Boolean))

  const assignedIds = new Set()
  for (const group of groups) {
    for (const soundId of Array.isArray(group?.sounds) ? group.sounds : []) {
      if (catalogIds.has(soundId)) assignedIds.add(soundId)
    }
  }

  const result = {
    total: sounds.length,
    assigned: assignedIds.size,
    unassigned: sounds.length - assignedIds.size,
    groups: groups.length,
    uncategorized: groups.filter((group) => !group?.category).length,
  }
  if (importDone !== undefined) result.importDone = Boolean(importDone)
  return result
}

export function addSoundToCatalog(catalog, rawSound) {
  const base = isObj(catalog) ? catalog : { version: 3, sounds: [] }
  const sounds = soundList(base)
  const sound = normalizeSound(rawSound)

  if (sound.hash) {
    const byHash = sounds.find((candidate) => candidate?.hash && candidate.hash === sound.hash)
    if (byHash) return { catalog: base, sound: byHash, added: false }
  }

  const byId = sounds.find((candidate) => candidate?.id === sound.id)
  if (byId) return { catalog: base, sound: byId, added: false }

  return {
    catalog: { ...base, version: base.version ?? 3, sounds: [...sounds, sound] },
    sound,
    added: true,
  }
}

export function setSoundDuration(catalog, id, duration) {
  const base = isObj(catalog) ? catalog : { version: 3, sounds: [] }
  const sounds = soundList(base)
  const numeric = typeof duration === 'number' ? duration : Number(duration)
  const value = Number.isFinite(numeric) && numeric > 0 ? numeric : null

  let changed = false
  const next = sounds.map((sound) => {
    if (sound?.id !== id) return sound
    changed = true
    return { ...sound, duration: value }
  })

  if (!changed) return base
  return { ...base, version: base.version ?? 3, sounds: next }
}
