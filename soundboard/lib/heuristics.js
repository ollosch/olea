// Filename/size based classification helpers shared by the importer, migration
// tools, and the review UI. Browser-safe and dependency-free.

import { ELEMENT_KINDS } from './schema.js'

export const LOOP_KEYWORDS = [
  'loop',
  'ambience',
  'ambient',
  'atmos',
  'drone',
  'music',
  'theme',
  'score',
  'soundtrack',
  'bed',
  'tavern',
  'battle music',
  'fadeloop',
]

export const RANDOM_KEYWORDS = [
  'noise',
  'noises',
  'movement',
  'rustle',
  'squeak',
  'growl',
  'breath',
  'breathing',
  'critter',
  'rat',
  'rats',
  'crowd',
  'chatter',
  'insect',
  'bird',
  'wind',
  'rain',
  'thunder',
  'creak',
  'drip',
  'footsteps',
  'running',
]

export const EFFECT_KEYWORDS = [
  'swing',
  'slash',
  'stab',
  'hit',
  'impact',
  'punch',
  'kick',
  'bite',
  'tear',
  'rend',
  'slam',
  'shot',
  'spell',
  'cast',
  'explosion',
  'hammer',
  'metal',
  'wood',
  'stone',
  'glass',
  'door',
  'click',
  'beep',
  'alarm',
]

const KB = 1024
const SMALL_RANDOM_SIZE = 500 * KB
const LARGE_LOOP_SIZE = 1.5 * 1024 * 1024

const regexCache = new Map()

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// Case-insensitive, token-boundary matching. Supports multi-word keywords and
// simple plurals so "noises", "rats", "stones", and "footsteps" all match while
// "shotgun" does not match "shot".
function matchesKeyword(name, keyword) {
  const haystack = String(name || '').toLowerCase()
  const kw = String(keyword || '').toLowerCase().trim()
  if (!haystack || !kw) return false

  const cacheKey = `${kw}\u0000`
  let re = regexCache.get(cacheKey)
  if (!re) {
    const body = kw.split(/\s+/).map(escapeRegExp).join('[\\s_-]+')
    const suffix = /s$/.test(kw) ? '' : '(?:s|es)?'
    re = new RegExp(`(?:^|[^a-z0-9])${body}${suffix}(?=[^a-z0-9]|$)`, 'i')
    regexCache.set(cacheKey, re)
  }
  return re.test(haystack)
}

function hasAny(name, keywords) {
  return keywords.some((keyword) => matchesKeyword(name, keyword))
}

export function suggestKind({ name, fileCount, size, xmlKind } = {}) {
  if (ELEMENT_KINDS.includes(xmlKind)) return xmlKind

  const count = Number(fileCount) || 0
  const bytes = Number(size)
  const hasSize = Number.isFinite(bytes) && bytes >= 0

  // Loop/music keywords are the strongest signal and win over effects.
  if (hasAny(name, LOOP_KEYWORDS)) return 'loop'

  if (hasAny(name, EFFECT_KEYWORDS)) return 'oneshot'

  if (hasAny(name, RANDOM_KEYWORDS)) {
    if (count > 1) return 'random'
    if (count === 1 && hasSize && bytes < SMALL_RANDOM_SIZE) return 'random'
  }

  if (count === 1 && hasSize && bytes > LARGE_LOOP_SIZE) return 'loop'

  return 'oneshot'
}

export function suggestTrigger(kind) {
  if (kind === 'random') {
    return { min: 10, max: 30, startMin: 2, startMax: 10 }
  }
  return { min: 0, max: 0, startMin: 0, startMax: 0 }
}

function fileOf(entry) {
  if (typeof entry === 'string') return entry
  if (entry && typeof entry === 'object' && typeof entry.file === 'string') return entry.file
  return null
}

function sizeOf(fileSizes, file) {
  if (fileSizes instanceof Map) return fileSizes.get(file)
  if (fileSizes && typeof fileSizes === 'object') return fileSizes[file]
  return undefined
}

function prefixOf(name) {
  const match = String(name || '').match(/^(.*?)\s+[–-]\s+/)
  return match ? match[1].trim() : ''
}

export function suggestPlaylistMerges(elements, fileSizes) {
  if (!Array.isArray(elements)) return []

  const groups = new Map()

  for (const element of elements) {
    if (!element || typeof element !== 'object') continue
    if (element.kind !== 'loop') continue
    if (!Array.isArray(element.files) || element.files.length !== 1) continue

    const file = fileOf(element.files[0])
    if (!file) continue

    const size = Number(sizeOf(fileSizes, file))
    if (!Number.isFinite(size) || size <= LARGE_LOOP_SIZE) continue

    const prefix = prefixOf(element.name)
    if (!prefix) continue

    const key = prefix.toLowerCase()
    if (!groups.has(key)) {
      groups.set(key, { elementIds: [], name: prefix, files: [] })
    }
    const group = groups.get(key)
    if (typeof element.id === 'string') group.elementIds.push(element.id)
    group.files.push(file)
  }

  return [...groups.values()].filter((group) => group.elementIds.length >= 2)
}
