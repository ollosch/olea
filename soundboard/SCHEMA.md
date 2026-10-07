# Soundboard data schema

The soundboard stores its state in its own JSON format. Syrinscape XML is an **import
format only** — the runtime never reads or writes XML. Everything the app uses at runtime
is described here.

Two kinds of files:

- **Per-soundscape `config.json`** — one per soundscape folder under `soundboard/syrinscape/`.
- **App-level `global.json`** — one file at `soundboard/global.json` (gitignored, runtime-created).

Both are versioned (`"version": 1`). See `lib/schema.js` for the canonical normalizers.

---

## 1. `config.json` (per soundscape)

```jsonc
{
  "version": 1,
  "id": "3f0a5b2e-8c1d-4a2f-b9e0-1a2b3c4d5e6f",   // UUID, stable; renames never change it
  "name": "Car Chase 2017",
  "disabled": false,                              // hidden from the main library list
  "elements": [
    {
      "id": "7c1d9f2a-…",                          // UUID, stable
      "name": "2017 Small Arms",
      "kind": "loop",                              // "loop" | "random" | "oneshot"
      "gain": 0.8,                                 // imported/edited default volume (0..~2)
      "randomise": "shuffle",                      // "shuffle" | "random" | null
      "reverb": "City",                            // preset name from REVERB_PRESETS, or null
      "position": null,                            // { minAngle, maxAngle, minDistance, maxDistance } (future pan)
      "files": [ "GSW SFX Pistol1.ogg" ],          // relative to this config.json's folder
      "trigger": { "min": 0, "max": 3, "startMin": 1, "startMax": 3 }  // "random" kind only
    }
  ],
  "hidden": [ "7c1d9f2a-…" ],                      // element ids hidden from this soundscape
  "moods": [
    {
      "id": "uuid",
      "name": "Quiet",
      "params": { "<elementId>": { "plays": true, "volume": 0.4 } }
    }
  ],
  "midi": { "notes": {}, "ccs": {} }
}
```

### Element field notes

- `files[]` are **relative to the `config.json`'s own folder**. Own files are bare names
  (`"Foo.ogg"`); files pulled from another pack are `"../OtherFolder/Foo.ogg"`.
- `kind` semantics:
  - `loop` — continuous ambience/music; started with the soundset.
  - `random` — auto-triggered one-shot at the `trigger` interval.
  - `oneshot` — manually triggered.
- `trigger` is only meaningful for `kind === "random"`; it is still always present with
  zero defaults for the other kinds.
- `randomise` controls playlist cycling for multi-file elements (`"shuffle"`, `"random"`,
  or `null` for in-order).
- `reverb` is a curated preset name; `null`/`"Off"` means dry. Unknown names are dropped
  during normalization (coerced to `null`).
- `position` is **stored but not rendered** (stereo panning is a future feature). Keep the
  imported values so nothing is lost.

### Soundsets are uniform

There is no "custom" vs "imported" distinction in the schema. A user-created soundscape is
just a new folder + `config.json` (its elements usually reference files from other packs via
`../`). Every soundscape can be:

- **Disabled** — set `"disabled": true`; it disappears from the main library list and is
  listed under "Disabled" where it can be re-enabled.
- **Deleted** — removed entirely (folder, `config.json` and any sound files).

---

## 2. `global.json` (app-level)

```jsonc
{
  "version": 1,
  "buses": { "loop": 1, "random": 1, "effects": 1 },
  "midi": { "notes": {}, "ccs": {} }
}
```

- `buses` are the persistent bus gains (loop / random / effects).
- `master` volume is **session-only** (in-memory, default 0.8) — never persisted.

---

## 3. MIDI actions

Keys are `"channel:note"` / `"channel:cc"` strings.

- **Local note** (`config.json.midi.notes`):
  - `{ "type": "oneshot" | "loop" | "random", "elementId": "<uuid>" }`
  - `{ "type": "mood", "moodId": "<uuid>" }`
  - `{ "type": "soundset" }` (toggle this soundscape)
- **Local CC** (`config.json.midi.ccs`): `{ "type": "element", "elementId": "<uuid>" }`
  (element volume).
- **Global note** (`global.json.midi.notes`):
  - `{ "type": "stop" }`
  - `{ "type": "soundset", "soundsetId": "<uuid>" }`
- **Global CC** (`global.json.midi.ccs`):
  - `{ "type": "master" }`
  - `{ "type": "bus", "bus": "loop" | "random" | "effects" }`

**Precedence:** local overrides global when both bind the same `channel:note` / `channel:cc`.

---

## 4. IDs

Generated with `crypto.randomUUID()` (Node ≥ 16 and modern browsers). Renames, hiding,
re-sorting, and disabling never change an ID. `soundsetId`/`elementId`/`moodId` in MIDI
bindings and mood params always refer to these UUIDs.
