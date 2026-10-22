// Pure edit helpers for v2 scenes. No mutation of the input objects.

import { ELEMENT_KINDS, normalizeElement } from './schema.js'

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)

function str(v, def = '') {
  return typeof v === 'string' ? v : def
}

function triggerIsZero(trigger) {
  if (!isObj(trigger)) return true
  return ['min', 'max', 'startMin', 'startMax'].every((key) => !Number(trigger[key]))
}

function fileOf(entry) {
  if (typeof entry === 'string') return entry
  if (isObj(entry) && typeof entry.file === 'string') return entry.file
  return null
}

// Return the shared prefix of names before " - " / " – ", or '' when the names
// do not all share one.
export function commonPrefixName(names) {
  if (!Array.isArray(names)) return ''
  const prefixes = names
    .filter((name) => typeof name === 'string' && name.trim())
    .map((name) => name.split(/\s+[–-]\s+/)[0].trim())
  if (!prefixes.length) return ''
  const first = prefixes[0]
  return prefixes.every((prefix) => prefix === first) ? first : ''
}

function remapBindings(map, oldIds, newId) {
  if (!isObj(map)) return {}
  const out = {}
  for (const [key, binding] of Object.entries(map)) {
    if (isObj(binding) && typeof binding.elementId === 'string' && oldIds.has(binding.elementId)) {
      out[key] = { ...binding, elementId: newId }
    } else {
      out[key] = binding
    }
  }
  return out
}

export function mergeElements(soundset, elementIds, targetKind) {
  const scene = isObj(soundset) ? soundset : {}
  const warnings = []

  const ids = new Set(
    Array.isArray(elementIds) ? elementIds.filter((id) => typeof id === 'string') : []
  )
  const elements = Array.isArray(scene.elements) ? scene.elements : []
  const selected = elements.filter((el) => isObj(el) && ids.has(el.id))

  if (!selected.length) {
    return {
      soundset: { ...scene },
      element: null,
      warnings: ['No matching scene elements to merge'],
    }
  }

  const first = selected[0]
  const kind = ELEMENT_KINDS.includes(targetKind)
    ? targetKind
    : ELEMENT_KINDS.includes(first.kind)
      ? first.kind
      : 'oneshot'

  const files = []
  const seenFiles = new Set()
  for (const element of selected) {
    const list = Array.isArray(element.files) ? element.files : []
    for (const entry of list) {
      const file = fileOf(entry)
      if (!file || seenFiles.has(file)) continue
      seenFiles.add(file)
      files.push(file)
    }
  }

  const name = commonPrefixName(selected.map((el) => el.name)) || str(first.name) || 'Merged'

  let trigger = isObj(first.trigger) ? { ...first.trigger } : {}
  if (kind === 'random' && triggerIsZero(trigger)) {
    trigger = { min: 10, max: 30, startMin: 2, startMax: 10 }
  }

  const element = normalizeElement({
    kind,
    name,
    gain: first.gain,
    randomise: first.randomise,
    reverb: first.reverb,
    position: first.position,
    files,
    trigger,
  })
  const newId = element.id

  const oldIds = new Set(selected.map((el) => el.id))

  const moods = (Array.isArray(scene.moods) ? scene.moods : []).map((mood) => {
    if (!isObj(mood)) return mood
    const params = isObj(mood.params) ? { ...mood.params } : {}
    const present = selected
      .map((el) => el.id)
      .filter((id) => Object.prototype.hasOwnProperty.call(params, id))

    if (!present.length) return { ...mood, params }

    const chosen = params[present[0]]
    for (const id of present) delete params[id]
    params[newId] = isObj(chosen) ? { ...chosen } : chosen

    if (present.length > 1) {
      warnings.push(
        `Mood "${str(mood.name) || mood.id || 'unnamed'}" referenced ${present.length} merged elements; kept the first parameter set`
      )
    }

    return { ...mood, params }
  })

  const midiIn = isObj(scene.midi) ? scene.midi : {}
  const midi = {
    notes: remapBindings(midiIn.notes, oldIds, newId),
    ccs: remapBindings(midiIn.ccs, oldIds, newId),
  }

  const hiddenIn = Array.isArray(scene.hidden)
    ? scene.hidden.filter((id) => typeof id === 'string')
    : []
  const anyHidden = hiddenIn.some((id) => oldIds.has(id))
  const hidden = hiddenIn.filter((id) => !oldIds.has(id))
  if (anyHidden) hidden.push(newId)

  const selectedSet = new Set(selected.map((el) => el.id))
  const remaining = elements.filter((el) => !selectedSet.has(el.id))
  remaining.push(element)

  const next = {
    ...scene,
    elements: remaining,
    moods,
    midi,
    hidden,
  }

  return { soundset: next, element, warnings }
}
