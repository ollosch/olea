# Soundboard data schema (v3)

This is the runtime data model for the v3 soundboard. Syrinscape XML is an **import format only**;
the server never reads or writes XML. All runtime data is normalized by `lib/v3/schema.js`,
resolved by `lib/v3/resolve.js`, and persisted by `lib/v3/store.js`.

V3 is a clean rewrite. Old v2 `config.json`, `library.json`, v2 `global.json`, scene-local
`elements`/`includes`, and v2 MIDI bindings are **deprecated and not read or migrated**. Old audio is
imported into the content-addressed store described below.

---

## 1. Storage layout

```text
soundboard/
  sounds/
    a3/
      a3f9c1...e2.ogg
    b7/
      b7d2a4...91.mp3
  data/
    catalog.json
    library.json
    global.json
    scenes/
      <scene-id>.json
    import-done
```

- `sounds/` is content-addressed: `<sha256[0:2]>/<sha256>.<ext>`. Hashes are lowercase 64-character
  hex; extensions are `ogg`, `mp3`, or `wav`.
- `data/catalog.json`, `data/library.json`, and `data/global.json` are the three master files.
- Each scene is one file, `data/scenes/<scene-id>.json`.
- `data/import-done` is a marker whose presence means curation is complete. It is written by
  `POST /api/import/done`, not by the import CLI.
- Missing master files are created with default contents on startup. Corrupt master JSON falls back
  to defaults in memory and is **not** overwritten; corrupt scene files are skipped with a warning.
- JSON writes are atomic (temp file in the same directory, then rename) and serialized per target
  file. Path builders reject absolute paths, `..`, and NUL bytes.

---

## 2. Common rules

### IDs and versioning

- Each top-level JSON document (catalog, library, scene, global) carries `"version": 3`;
  normalization forces it.
- IDs are strings generated with `crypto.randomUUID()` when absent, with a fallback for contexts
  without `crypto.randomUUID`.
- IDs are stable. Renaming, reordering, enabling/disabling, or re-tagging never changes an ID.
- A scene ID is also its filename. `saveScene` rejects empty IDs, `.`, `..`, `/`, `\`, and NUL.
- Hash lookups require exactly 64 lowercase hex characters. Audio extensions are the only path
  extensions accepted.

### Categories, tags, and values

- `category` is one exclusive hierarchical path such as `Creatures/Dogs`. Backslashes are converted
  to `/`; empty and `.` segments are dropped; a `..` segment is rejected. Default is `''`.
- `tags` are free-form strings. Empty/non-string entries are dropped and duplicates are removed
  case-insensitively while preserving the first spelling. Default is `[]`.
- Gains and bus/master/palette volumes clamp to `0..1`. Pan clamps to `-1..1`.
- Reverb is one of `City`, `Cave`, `Stone Dungeon`, `Soft furnished room`, `Stone room`, `Forest`,
  `Mountains`, `Plain`, `Alley`, `Hallway`, `Auditorium`, `Arena`, or `null` (dry). `"Off"` and
  unknown names normalize to `null`; matching is case-insensitive.

### Triggers

Trigger objects are `{ min, max, startMin, startMax }` in seconds.

- Non-finite and negative values become `0`. The legacy `-15` "never auto-trigger" sentinel is
  therefore just `0`.
- Reversed bounds are swapped so `min <= max` and `startMin <= startMax`.
- Non-random tracks normalize all four values to `0`.
- A random track whose trigger is all zeros resolves to the app default `10–30s`, with a first
  trigger of `2–10s`.
- Group `defaults.trigger` is sanitized but not zeroed; track triggers are zeroed for non-random
  kinds.

### Durations and content addressing

- `duration` is seconds and is either `null` or a finite positive number. Import probes it with
  `ffprobe` when available; `--no-duration` disables probing. If it is still unknown, the client
  may decode once and persist it with `POST /api/sounds/:id/duration`.
- The SHA-256 hash identifies the blob. The same bytes are stored once even if they appeared in
  several source folders. The same bytes with different extensions are one sound; the first file in
  sorted source-path order keeps its extension and blob path.
- An existing blob is trusted when its size matches; a size mismatch is reported and never
  overwritten. Import never deletes or modifies source audio.

---

## 3. `catalog.json`

```jsonc
{
  "version": 3,
  "sounds": [
    {
      "id": "sound-uuid",
      "hash": "sha256-hex",
      "ext": "ogg",
      "size": 123456,
      "duration": 12.345,
      "originalName": "ASS Loop 0 Mixed Ambience.ogg",
      "addedAt": "2026-10-27T12:00:00.000Z"
    }
  ]
}
```

- `id` is the stable sound ID referenced by groups. `hash` identifies the blob.
- `duration` is `null` until known, otherwise a finite positive number.
- `size` is a non-negative number; `ext` is a normalized lowercase extension.
- `originalName` is kept for import/curation and as a fallback label; it is not the primary UI name.
- There is no provenance/origin field. Normalization keeps one sound per `id`; the importer and
  `addSounds` dedupe by non-empty hash before ID.

---

## 4. `library.json`

```jsonc
{
  "version": 3,
  "groups": [
    {
      "id": "group-uuid",
      "name": "Barking Dogs",
      "category": "Creatures/Dogs",
      "tags": ["animal", "bark", "night"],
      "sounds": ["sound-uuid", "sound-uuid"],
      "selection": "random",
      "defaultKind": "random",
      "defaults": {
        "gain": 0.8,
        "reverb": null,
        "pan": 0,
        "trigger": { "min": 10, "max": 30, "startMin": 2, "startMax": 10 }
      },
      "notes": ""
    }
  ]
}
```

A group is the reusable library item: one or more sounds plus all browseable metadata and defaults.
Metadata belongs to the group, not to individual sound blobs.

- `selection` is `"random"` (default) or `"ordered"`. Random avoids an immediate repeat when more
  than one sound is available; ordered advances and wraps.
- `defaultKind` is `"loop"`, `"random"`, `"oneshot"`, or `null`. It is only a hint used when adding
  the group to a scene; it never controls playback. Invalid values normalize to `null`.
- `sounds` is a list of unique sound IDs. Only one sound from a group plays at a time.
- `defaults` always has `gain` (default `0.8`), `reverb` (default `null`), `pan` (default `0`), and
  a sanitized `trigger` (default all zeros). The trigger is only used for random tracks.
- `notes` is free text, default `''`.

Changing a group affects every scene track that references it, except where a mood overrides a
value. Deleting a group leaves existing scene tracks in place but invalid; the palette entry and
related global palette bindings are removed.

---

## 5. Scene files

```jsonc
{
  "version": 3,
  "id": "scene-uuid",
  "name": "Abandoned Space Station",
  "disabled": false,
  "defaultMoodId": "mood-uuid",
  "tracks": [
    {
      "id": "track-uuid",
      "groupId": "group-uuid",
      "kind": "loop",
      "order": 0,
      "trigger": { "min": 0, "max": 0, "startMin": 0, "startMax": 0 }
    }
  ],
  "moods": [
    {
      "id": "mood-uuid",
      "name": "Inside",
      "params": {
        "track-uuid": {
          "enabled": true,
          "gain": 0.4,
          "reverb": "Soft furnished room",
          "pan": 0,
          "trigger": { "min": 5, "max": 10, "startMin": 0, "startMax": 0 }
        }
      }
    }
  ],
  "midi": { "notes": {}, "ccs": {} }
}
```

- There is no scene-local audio, `elements[]`, `includes[]`, `hidden[]`, or `reviewed` field. Every
  track references a library group.
- `kind` is authoritative per track: `"loop"`, `"random"`, or `"oneshot"`. Invalid/missing values
  normalize to `"oneshot"`. It is never inherited from the group.
- `order` is scene-wide. Normalization sorts tracks by `(order, id)` and renumbers `order` to
  `0..n-1`. The UI displays tracks grouped by kind (`loop`, `random`, `oneshot`), then by order.
  Moods never reorder tracks.
- A scene always has at least one mood. A missing/empty mood list becomes one `Default` mood.
  `defaultMoodId` must reference a mood; if missing or invalid it falls back to the first mood.
- `moods[].params` is sparse and keyed by track ID. Missing track IDs or fields inherit from the
  group defaults. Missing `enabled` means `true`.
- Mood param fields:
  - `enabled` is optional and only stored when it is a boolean.
  - `gain`/`pan` are optional; present numeric values are clamped.
  - `reverb` is optional. A present key means an explicit value, so `null`/`"Off"`/an invalid name
    means explicit dry; an absent key inherits the group default.
  - `trigger` is optional and sanitized; it only matters for random tracks.
- A **new mood** has empty `params`, so every track inherits its group defaults and is enabled.
  The edit UI's **Duplicate mood** action copies an existing mood's name and params; that is the
  only snapshot behavior.
- `disabled: true` hides a scene from the normal scene list. `name` may be empty.
- `midi` holds scene-local bindings only.

Saving a scene validates it: every track group must exist, every group sound must exist in the
catalog, and an explicitly provided `defaultMoodId` must match one of the submitted moods. Local
`trackTrigger`/`trackVolume` bindings whose track no longer exists, and `moodSelect` bindings whose
mood no longer exists, are removed on save.

---

## 6. `global.json`

```jsonc
{
  "version": 3,
  "master": 0.8,
  "buses": { "loop": 1, "random": 1, "oneshot": 1 },
  "palette": [
    {
      "id": "palette-uuid",
      "groupId": "group-uuid",
      "label": "",
      "gain": null,
      "order": 0
    }
  ],
  "midi": { "notes": {}, "ccs": {} }
}
```

- `master` persists across reloads; the default is `0.8`.
- `buses` are the three bus gains `loop`, `random`, and `oneshot`, each default `1`. The UI labels
  them **Loops**, **Random**, and **One-shots**; "effects" is reserved for audio processing such as
  reverb, gain, and pan.
- Palette entries reference groups only and never duplicate audio. `label` defaults to `''` (use the
  group name); `gain` is `null` (inherit the group/default) or `0..1`; `order` defaults to `0`.
  Playback sorts entries by `order`, then ID.
- Palette items never auto-start on scene open, mood change, Play, or reload. They always require an
  explicit trigger.
- Global MIDI bindings live here; scene-local bindings live in the scene file.

---

## 7. MIDI actions

Binding maps are `{ "notes": { "<key>": action }, "ccs": { "<key>": action } }`. Keys are canonical
`"<channel>:<type>:<number>"` strings, for example `0:note:60` or `0:cc:7`; channel is `0..15`,
type is `note` or `cc`, and number is `0..127`. Parsing requires exactly three parts. A target may
have at most one binding, and re-learning a target removes its previous key. Keys are stored sorted.

Actions are explicit; scope is not inferred from the key type.

**Global** (`global.json.midi`):

| Action | Key type | Shape |
|---|---|---|
| Stop all | note | `{ "type": "stopAll" }` |
| Master volume | CC | `{ "type": "masterVolume" }` |
| Bus volume | CC | `{ "type": "busVolume", "bus": "loop" \| "random" \| "oneshot" }` |
| Palette trigger | note | `{ "type": "paletteTrigger", "paletteId": "..." }` |
| Palette volume | CC | `{ "type": "paletteVolume", "paletteId": "..." }` |
| Open scene | note | `{ "type": "openScene", "sceneId": "..." }` |

**Scene-local** (`scene.midi`):

| Action | Key type | Shape |
|---|---|---|
| Track trigger (toggle) | note | `{ "type": "trackTrigger", "trackId": "..." }` |
| Track volume | CC | `{ "type": "trackVolume", "trackId": "..." }` |
| Mood select | note | `{ "type": "moodSelect", "moodId": "..." }` |
| Scene transport toggle | note | `{ "type": "sceneToggle" }` |

- Normalization drops wrong-scope actions, unknown actions, note/CC type mismatches, and missing
  target IDs. CC values `0..127` map to `0..1`.
- Trigger actions **toggle**: loop/random start or stop; a one-shot stops if already playing and
  otherwise plays. Different tracks may overlap, but at most one sound per track is active.
- **Shadowing is forbidden.** The same physical key may not be bound globally and locally without
  explicit resolution. Learning a local action on a globally bound key warns and asks whether to
  replace the global binding; confirming removes the global binding, cancelling changes nothing.
  Learning a global action on a key used by scenes reports the affected scene bindings the same way.
  `GET /api/bindings` lists global bindings, per-scene bindings, and conflicts.
- Saving a scene cleans local bindings for deleted tracks/moods. Deleting a group prunes its palette
  entries and global palette bindings. Deleting a scene removes its file but does not automatically
  remove global `openScene` bindings that point at it.

---

## 8. Resolution and inheritance

For a scene track, resolve in this order:

1. **Sounds and selection mode** — from the group.
2. **Kind** — from the track, never from the group.
3. **Trigger** — mood override → track trigger → group `defaults.trigger` → kind default.
4. **Gain, reverb, pan** — mood override → group `defaults`.
5. **Enabled** — mood param → `true`.

Random triggers fall back to `10–30s` (first `2–10s`) when every candidate is all zeros. Non-random
tracks always resolve zero triggers. `defaultKind` is used only while adding a group to a scene.

Selecting a mood changes the held configuration; it never starts or stops the whole scene and never
auto-starts one-shots. If transport is running, enabled/gain/reverb/pan changes apply live. Play
starts only enabled loop/random tracks from the selected mood; one-shots stay silent until
triggered. Stop stops loops, random schedulers, and running one-shots, but leaves the selected mood
intact. Manual per-track toggles are temporary performance state and are discarded when Play
re-applies the mood.

---

## 9. HTTP API

All API responses are JSON. Errors are `{ "error": "..." }`, usually with `errors[]` for validation
failures. Status codes: `400` validation/bad path, `404` missing, `409` conflict, `500` other.

Read:

- `GET /api/bootstrap` — `{ catalog: { version, count }, library, global, scenes, stats }`
- `GET /api/library`, `GET /api/global`
- `GET /api/scenes` — summaries `{ id, name, disabled, trackCount, moodCount, defaultMoodId }`
- `GET /api/scenes/:id` — full scene (`404` if absent)
- `GET /api/bindings` — `{ global, scenes: [{ sceneId, name, midi }], conflicts }`
- `GET /api/catalog?query|q&offset&limit&unassigned&kind&category&tag&groupId` — paged
  `{ sounds, total, offset, limit }`; limit clamps to `1..200`, default `50`
- `GET /api/catalog/stats` — catalog/library counts and import-done state
- `GET /api/sounds?ids=<comma-separated>` — up to 1000 sound records
- `GET /api/sounds/:id` — one sound record (`404` if absent)

Write (JSON body):

- `PUT /api/global` → `{ global }`
- `POST /api/groups` → `{ group, library }`
- `PATCH /api/groups/:id` → `{ group, library }`
- `DELETE /api/groups/:id` → delete result with `paletteRemoved`, `bindingsRemoved`
- `POST /api/groups/:id/sounds` `{ soundIds }` → `{ group, library }`
- `POST /api/groups/:id/sounds/remove` `{ soundIds }` → `{ group, library }`
- `POST /api/groups/merge` → `{ group, library, global, removedIds, paletteRemoved, bindingsRemoved }`
- `POST /api/groups/split` → `{ group, source, library }`
- `POST /api/groups/bulk` `{ ids|groupIds, patch }` → `{ groups, library }`
- `POST /api/groups/from-sounds` → `{ group, library }`
- `POST /api/scenes` `{ name }` → `{ scene }` (creates one `Default` mood)
- `PUT /api/scenes/:id` → `{ scene }` (`400` with `errors` when invalid)
- `DELETE /api/scenes/:id` → `{ ok: true, scene }`
- `POST /api/sounds/:id/duration` `{ duration }` → `{ sound }`; finite `> 0` only
- `POST /api/import/done` `{ done }` → `{ done }`; missing `done` means `true`

Audio:

- `GET /audio/:hash` serves the content-addressed blob. The hash must be lowercase 64-hex.
  Responses use `Cache-Control: public, max-age=31536000, immutable` and support range requests
  because content never changes for a given hash. An invalid hash is `400`; an unknown sound or
  missing blob is `404`.
- `/api` and `/audio` never fall through to the SPA. Other GET requests serve `dist/` with an SPA
  index fallback.

Server environment: `OLEA_DATA_DIR` (default `soundboard/data`), `OLEA_SOUNDS_DIR` (default
`soundboard/sounds`), and `PORT` (default `8091`).

---

## 10. Import CLI

The one-off importer builds the content-addressed store, catalog, and initial library groups. It
never deletes or modifies source audio.

```bash
cd soundboard
npm run import-v3 -- --dry-run     # scan and preview; writes nothing
npm run import-v3                  # copy/link blobs, write catalog, propose groups
```

Options:

```text
node tools/import-v3.js [--source DIR] [--data DIR] [--sounds DIR]
  [--dry-run] [--no-duration] [--no-groups] [--limit N] [--help]
```

- Defaults: `--source soundboard/syrinscape`, `--data soundboard/data`, `--sounds soundboard/sounds`.
- Scans `.ogg`, `.mp3`, and `.wav`. Symlinks, hidden directories, and standard build/runtime
  directories (`node_modules`, `.git`, `dist`, `data`, `sounds`, `.migration-backup`) are skipped;
  files inside the target data/sounds directories are always excluded.
- For each unique hash it links or copies one blob to `sounds/<2>/<hash>.<ext>`, records size and
  original name, and probes duration with `ffprobe` unless `--no-duration` is used.
- It then proposes groups from source directories (splitting large directories into filename
  families) and merges them into `library.json`, matching existing groups by exact name and only
  unioning sound IDs. Category/tags/defaults are not changed by re-import.
- A real run initializes the store and persists the catalog/library once each when changed. It is
  idempotent: a second run reports no new blobs and no new or updated groups.
- `--no-groups` imports blobs/catalog only; `--limit N` caps files after scanning.
- The importer does not create scenes or write `data/import-done`. Mark curation complete through
  the UI/API after verifying the catalog and library.
- Old audio removal is manual. Verify the new catalog and library first, then delete the old tree
  yourself.
