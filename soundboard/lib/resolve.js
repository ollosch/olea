// Scene resolution for the v2 model.
//
// IMPORTANT: `library.groups` is an **array** of library groups (not an object
// keyed by id). Lookups are always performed by each group's stable `id`.
//
// Resolution happens on every load/state change so library edits are reflected
// immediately. The module is dependency-free (except for local schema helpers)
// and browser-safe.

import { newId, normalizeElement, normalizeInclude } from './schema.js'

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)

const OVERRIDE_KEYS = ['gain', 'kind', 'trigger', 'reverb', 'randomise']

function str(v, def = '') {
  return typeof v === 'string' ? v : def
}

function filesOf(el) {
  return Array.isArray(el?.files) ? el.files.filter((f) => typeof f === 'string') : []
}

function libraryIndex(library) {
  const index = new Map()
  const groups = Array.isArray(library?.groups) ? library.groups : []
  for (const group of groups) {
    if (!isObj(group)) continue
    const id = str(group.id)
    if (id && !index.has(id)) index.set(id, group)
  }
  return index
}

// Resolve one scene element from an inline element definition.
function resolveInline(element, soundset) {
  if (!isObj(element)) return null
  return {
    ...element,
    id: str(element.id) || newId(),
    libraryId: null,
    source: 'scene',
    baseDir: str(soundset?.dir),
    files: filesOf(element),
  }
}

// Resolve one include instance against the library.
function resolveInclude(include, groups) {
  if (!isObj(include)) return null
  const inc = normalizeInclude(include)
  const group = groups.get(inc.libraryId)
  if (!group) {
    const name = str(include.name) || str(include.label)
    return {
      warning: {
        type: 'missing-library',
        includeId: inc.id,
        libraryId: inc.libraryId,
        name,
      },
    }
  }

  const merged = { ...group }
  for (const key of OVERRIDE_KEYS) {
    if (inc.overrides[key] != null) merged[key] = inc.overrides[key]
  }

  const element = normalizeElement(merged)
  return {
    element: {
      ...element,
      id: inc.id,
      libraryId: inc.libraryId,
      source: 'library',
      baseDir: '_library',
      files: filesOf(group),
    },
  }
}

export function resolveScene(soundset, library) {
  const scene = isObj(soundset) ? soundset : {}
  const warnings = []
  const groups = libraryIndex(library)

  const hidden = new Set(
    Array.isArray(scene.hidden) ? scene.hidden.filter((id) => typeof id === 'string') : []
  )

  const elements = []

  const inline = Array.isArray(scene.elements) ? scene.elements : []
  for (const raw of inline) {
    const element = resolveInline(raw, scene)
    if (element && !hidden.has(element.id)) elements.push(element)
  }

  const includes = Array.isArray(scene.includes) ? scene.includes : []
  for (const raw of includes) {
    const result = resolveInclude(raw, groups)
    if (!result) continue
    if (result.warning) {
      warnings.push(result.warning)
      continue
    }
    if (!hidden.has(result.element.id)) elements.push(result.element)
  }

  return { elements, warnings }
}

export function resolveSceneElements(soundset, library) {
  return resolveScene(soundset, library).elements
}

export function resolveElement(soundset, library, instanceId) {
  if (typeof instanceId !== 'string' || !instanceId) return null
  const { elements } = resolveScene(soundset, library)
  return elements.find((el) => el.id === instanceId) || null
}
