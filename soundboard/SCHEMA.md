# Soundboard data schema (v2)

The soundboard stores state in its own JSON format. Syrinscape XML is an **import format only** —
the runtime never reads or writes XML. All runtime data is normalized by `lib/schema.js`; scene
includes are resolved by `lib/resolve.js`.

Three kinds of files:

- **Per-scene `config.json`** — one per scene folder under `soundboard/syrinscape/`.
- **App-level `library.json`** — one file at `soundboard/library.json` (gitignored, runtime-created).
- **App-level `global.json`** — one file at `soundboard/global.json` (gitignored, runtime-created).

All three carry `"version": 2`. Audio for library groups lives under `syrinscape/_library/`; that
directory is reserved and cannot be treated as a scene.

---

## 1. Scene `config.json`

```jsonc
{
  "version": 2,
  "id": "3f0a5b2e-8c1d-4a2f-b9e0-1a2b3c4d5e6f",   // stable; renames never change it
  "name": "Car Chase 2017",
  "disabled": false,                              // hidden from the main scene list
  "elements": [
    {
      "id": "7c1d9f2a-…",                          // stable instance id
      "name": "2017 Small Arms",
      "kind": "loop",                              // "loop" | "random" | "oneshot"
      "gain": 0.8,                                 // 0..1 (clamped)
      "randomise": "shuffle",                      // "shuffle" | "random" | null
      "reverb": "City",                            // preset from REVERB_PRESETS, or null
      "position": null,                            // stored, not rendered (future panning)
      "files": [ "GSW SFX Pistol1.ogg" ],          // relative to this config's folder
      "trigger": { "min": 0, "max": 3, "startMin": 1, "startMax": 3 }
    }
  ],
  "includes": [
    {
      "id": "b91e…",                               // per-scene instance id (used by moods/MIDI)
      "libraryId": "library-group-uuid",
      "overrides": {
        "gain": null,                              // null = inherit from the library group
        "kind": null,
        "trigger": null,
        "reverb": null,
        "randomise": null
      }
    }
  ],
  "hidden": [ "7c1d9f2a-…" ],                      // element/include instance ids hidden here
  "moods": [
    {
      "id": "uuid",
      "name": "Quiet",
      "params": { "<instanceId>": { "plays": true, "volume": 0.4 } }
    }
  ],
  "midi": { "notes": {}, "ccs": {} },
  "reviewed": true                                 // false = heuristic import, needs review
}
```

### Scene field notes

- `elements[]` are scene-local. `includes[]` reference reusable groups in `library.json` by
  `libraryId`. Every include has its own `id`; moods, hidden entries, and MIDI bindings refer to that
  instance id, not the library group id.
- Include `overrides` are partial element fields. A `null` override inherits the library value.
  Supported override keys: `gain`, `kind`, `trigger`, `reverb`, `randomise`.
- Resolution creates runtime-only fields on instances: `source` (`"scene"` or `"library"`),
  `baseDir` (scene folder or `"_library"`), and `libraryId` for includes. These are not persisted in
  `config.json`.
- Missing library groups are skipped and reported as warnings; they are not fatal.
- `files[]` in scene elements are relative to the scene's own folder. Own files are bare names
  (`"Foo.ogg"`); files from another pack may be `"../OtherFolder/Foo.ogg"`.
- `kind` semantics:
  - `loop` — continuous playlist; one track at a time, crossfaded.
  - `random` — auto-triggered one-shot at the `trigger` interval.
  - `oneshot` — manually triggered effect.
- `trigger` is only meaningful for `random`, but is always present (zero defaults otherwise). Random
  elements with an all-zero trigger fall back to `{ min: 10, max: 30, startMin: 2, startMax: 10 }`.
- `randomise` controls playlist cycling for multi-file loops: `"shuffle"`, `"random"`, or `null`
  (in order).
- `reverb` is a curated preset name; `null` means dry. Unknown names are dropped during
  normalization.
- `position` is stored but not rendered.
- `hidden` contains resolved instance ids; an included group with a hidden instance id is skipped.
- `reviewed` is `false` only for heuristic imports without authoritative XML. It defaults to `true`.
- Gains, bus volumes, mood volumes, and palette gains all clamp to `0..1`.

---

## 2. `library.json`

```jsonc
{
  "version": 2,
  "groups": [
    {
      "id": "library-group-uuid",
      "name": "Dogs",
      "kind": "random",
      "gain": 0.8,
      "randomise": null,
      "reverb": null,
      "position": null,
      "files": [ "monsters/dogs/1.ogg" ],          // relative to _library
      "trigger": { "min": 10, "max": 30, "startMin": 2, "startMax": 10 },
      "category": "Monsters/Dogs",
      "tags": [ "dog", "bark" ]
    }
  ]
}
```

- `library.groups` is an **array**, not an object keyed by id. Lookups are always by `id`.
- A library group is an element plus catalog metadata (`category`, `tags`).
- Group files are relative to the library root (`syrinscape/_library/`).
- Scenes reference groups through includes. Editing a group changes every scene that includes it
  (unless an include overrides that field).
- Promotion from a scene copies files into `_library/<category>/<slug>/`, creates a group, preserves
  the scene instance id, rewrites the scene's file references, and replaces the element with an
  include.

---

## 3. `global.json`

```jsonc
{
  "version": 2,
  "buses": { "loop": 1, "random": 1, "effects": 1 },   // 0..1
  "palette": [
    {
      "id": "palette-entry-uuid",
      "libraryId": "library-group-uuid",
      "label": "",                                     // display override; "" = group name
      "gain": null,                                    // null = inherit group gain
      "order": 0
    }
  ],
  "midi": { "notes": {}, "ccs": {} }
}
```

- `buses` are the persistent bus gains (loop / random / effects).
- `palette` holds pinned library groups, sorted by `order`. Palette entries do not duplicate audio;
  they resolve against `library.json`.
- Master volume is **session-only** (in-memory, default 0.8) and is never persisted.

---

## 4. MIDI actions

Keys are `"channel:note"` / `"channel:cc"` strings. Local bindings live in a scene's
`config.json.midi`; global bindings live in `global.json.midi`.

- **Local note** (`config.json.midi.notes`):
  - `{ "type": "oneshot" | "loop" | "random", "elementId": "<instance-uuid>" }`
  - `{ "type": "mood", "moodId": "<uuid>" }`
  - `{ "type": "soundset" }` (toggle this scene)
  - The element `type` is informational; dispatch uses the element's current kind.
- **Local CC** (`config.json.midi.ccs`): `{ "type": "element", "elementId": "<uuid>" }`
  (element volume).
- **Global note** (`global.json.midi.notes`):
  - `{ "type": "stop" }`
  - `{ "type": "soundset", "soundsetId": "<uuid>" }`
  - `{ "type": "palette", "paletteId": "<uuid>" }`
- **Global CC** (`global.json.midi.ccs`):
  - `{ "type": "master" }`
  - `{ "type": "bus", "bus": "loop" | "random" | "effects" }`
  - `{ "type": "paletteVolume", "paletteId": "<uuid>" }`

**Precedence:** local overrides global when both bind the same key. The UI warns when an active
scene shadows a global palette mapping. Re-learning an action removes its previous binding; palette
and element bindings are cleaned up when their target is deleted.

---

## 5. IDs, paths, and versioning

- IDs are generated with `crypto.randomUUID()` (with a fallback for non-secure contexts). Renames,
  hiding, re-ordering, and disabling never change an id.
- All stored file paths use POSIX separators. Scene files resolve against the scene folder; library
  files resolve against `_library`.
- Missing audio files are not rewritten automatically; use `GET /api/refs` or the review/promotion
  tools to detect broken references.
- v1 data must be migrated with `node soundboard/tools/migrate-v2.js`, which writes a JSON-only
  backup under `soundboard/.migration-backup/<timestamp>/` before changing configs.
- Migration adds `version: 2`, `includes: []`, `reviewed` flags, library/global scaffolding, and
  clamps gains/volumes to `0..1`. It preserves ids, moods, hidden entries, and MIDI bindings.
