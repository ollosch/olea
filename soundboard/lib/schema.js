// Soundboard data schema + normalization helpers.
//
// This is the single source of truth for the soundboard's own JSON format
// (one `config.json` per soundscape folder, one app-level `global.json`, and
// one `library.json`). Syrinscape XML is an *import* format only — the runtime
// reads this schema.
//
// The module is dependency-free and browser-safe so it can be imported by both
// the Node server/importer and the Vue frontend.

export const VERSION = 2

export const ELEMENT_KINDS = ['loop', 'random', 'oneshot']
export const BUSES = ['loop', 'random', 'effects']

// Curated reverb presets. `null` (or "Off") means no reverb send.
export const REVERB_PRESETS = [
  'City',
  'Cave',
  'Stone Dungeon',
  'Soft furnished room',
  'Stone room',
  'Forest',
  'Mountains',
  'Plain',
  'Alley',
  'Hallway',
  'Auditorium',
  'Arena',
]

export function newId() {
  const c = globalThis.crypto
  if (c && typeof c.randomUUID === 'function') return c.randomUUID()
  // Fallback for non-secure contexts where crypto.randomUUID is unavailable.
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (ch) => {
    const r = (Math.random() * 16) | 0
    const v = ch === 'x' ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)

function num(v, def) {
  const n = typeof v === 'number' ? v : parseFloat(v)
  return Number.isFinite(n) ? n : def
}

function str(v, def = '') {
  return typeof v === 'string' ? v : def
}

function clamp01(v) {
  return Math.min(1, Math.max(0, v))
}

function nullableGain(v) {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v) : NaN
  return Number.isFinite(n) ? clamp01(n) : null
}

function coerceKind(v) {
  return ELEMENT_KINDS.includes(v) ? v : 'oneshot'
}

function nullableKind(v) {
  return ELEMENT_KINDS.includes(v) ? v : null
}

function coerceRandomise(v) {
  if (v === 'shuffle' || v === 'random') return v
  return null
}

function coerceReverb(v) {
  if (typeof v !== 'string') return null
  const name = v.trim()
  if (!name || name.toLowerCase() === 'off') return null
  const found = REVERB_PRESETS.find((p) => p.toLowerCase() === name.toLowerCase())
  return found || null
}

export function normalizePosition(input) {
  if (!isObj(input)) return null
  const pos = {
    minAngle: num(input.minAngle, -180),
    maxAngle: num(input.maxAngle, 180),
    minDistance: num(input.minDistance, 0),
    maxDistance: num(input.maxDistance, 0),
  }
  return pos
}

export function normalizeTrigger(input) {
  const t = isObj(input) ? input : {}
  return {
    min: num(t.min, 0),
    max: num(t.max, 0),
    startMin: num(t.startMin, 0),
    startMax: num(t.startMax, 0),
  }
}

export function normalizeElement(input) {
  const el = isObj(input) ? input : {}
  const kind = coerceKind(el.kind)
  return {
    id: str(el.id) || newId(),
    name: str(el.name),
    kind,
    gain: clamp01(num(el.gain, 0.8)),
    randomise: coerceRandomise(el.randomise),
    reverb: coerceReverb(el.reverb),
    position: el.position != null ? normalizePosition(el.position) : null,
    files: Array.isArray(el.files) ? el.files.map((f) => str(f)).filter(Boolean) : [],
    trigger: normalizeTrigger(el.trigger),
  }
}

// A library group is an element plus catalog metadata.
export function normalizeLibraryGroup(input) {
  const group = isObj(input) ? input : {}
  return {
    ...normalizeElement(group),
    category: str(group.category),
    tags: Array.isArray(group.tags) ? group.tags.map((t) => str(t)).filter(Boolean) : [],
  }
}

// Include overrides use `null` to mean "inherit from the library group".
export function normalizeInclude(input) {
  const inc = isObj(input) ? input : {}
  const overrides = isObj(inc.overrides) ? inc.overrides : {}
  return {
    id: str(inc.id) || newId(),
    libraryId: str(inc.libraryId),
    overrides: {
      gain: nullableGain(overrides.gain),
      kind: nullableKind(overrides.kind),
      trigger: isObj(overrides.trigger) ? normalizeTrigger(overrides.trigger) : null,
      reverb: overrides.reverb == null ? null : coerceReverb(overrides.reverb),
      randomise: overrides.randomise == null ? null : coerceRandomise(overrides.randomise),
    },
  }
}

export function normalizePaletteEntry(input) {
  const entry = isObj(input) ? input : {}
  return {
    id: str(entry.id) || newId(),
    libraryId: str(entry.libraryId),
    label: str(entry.label),
    gain: nullableGain(entry.gain),
    order: num(entry.order, 0),
  }
}

// `library.groups` is an array; consumers look groups up by their `id`.
export function normalizeLibrary(input) {
  const lib = Array.isArray(input) ? { groups: input } : isObj(input) ? input : {}
  const groups = Array.isArray(lib.groups) ? lib.groups : []
  return {
    version: VERSION,
    groups: groups.map(normalizeLibraryGroup),
  }
}

export function normalizeMood(input) {
  const mood = isObj(input) ? input : {}
  const params = {}
  if (isObj(mood.params)) {
    for (const [id, p] of Object.entries(mood.params)) {
      if (!isObj(p)) continue
      params[id] = { plays: p.plays !== false, volume: clamp01(num(p.volume, 1)) }
    }
  }
  return { id: str(mood.id) || newId(), name: str(mood.name, 'New mood'), params }
}

export function normalizeMidi(input) {
  const midi = isObj(input) ? input : {}
  return {
    notes: isObj(midi.notes) ? midi.notes : {},
    ccs: isObj(midi.ccs) ? midi.ccs : {},
  }
}

export function newElement(kind = 'oneshot') {
  return normalizeElement({ kind })
}

export function newMood(name = 'New mood') {
  return { id: newId(), name, params: {} }
}

export function newLibraryGroup(kind = 'oneshot') {
  return normalizeLibraryGroup({ kind })
}

export function newInclude(libraryId = '') {
  return normalizeInclude({ libraryId })
}

export function newPaletteEntry(libraryId = '', order = 0) {
  return normalizePaletteEntry({ libraryId, order })
}

export function newLibrary() {
  return normalizeLibrary({})
}

export function normalizeConfig(input) {
  const cfg = isObj(input) ? input : {}
  return {
    version: VERSION,
    id: str(cfg.id) || newId(),
    name: str(cfg.name),
    disabled: cfg.disabled === true,
    elements: Array.isArray(cfg.elements) ? cfg.elements.map(normalizeElement) : [],
    includes: Array.isArray(cfg.includes) ? cfg.includes.map(normalizeInclude) : [],
    hidden: Array.isArray(cfg.hidden) ? cfg.hidden.map((id) => str(id)).filter(Boolean) : [],
    moods: Array.isArray(cfg.moods) ? cfg.moods.map(normalizeMood) : [],
    midi: normalizeMidi(cfg.midi),
    reviewed: typeof cfg.reviewed === 'boolean' ? cfg.reviewed : true,
  }
}

export function newConfig(name = 'New soundscape') {
  return normalizeConfig({ id: newId(), name, includes: [], reviewed: true })
}

export function normalizeGlobal(input) {
  const g = isObj(input) ? input : {}
  const buses = isObj(g.buses) ? g.buses : {}
  return {
    version: VERSION,
    buses: {
      loop: clamp01(num(buses.loop, 1)),
      random: clamp01(num(buses.random, 1)),
      effects: clamp01(num(buses.effects, 1)),
    },
    palette: Array.isArray(g.palette) ? g.palette.map(normalizePaletteEntry) : [],
    midi: normalizeMidi(g.midi),
  }
}

export function newGlobal() {
  return normalizeGlobal({})
}
