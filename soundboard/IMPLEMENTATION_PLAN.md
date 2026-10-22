# Olea Soundboard v2 — Implementation Plan

**Status:** ready for a fresh implementation session  
**Workspace:** `/home/ollo/Code/olea` only. Never read/write outside this folder unless the user explicitly asks.  
**Primary area:** `soundboard/`. Do not modify `equipment/` unless explicitly required.  
**Commits:** Make granular, atomic git commits on the current branch (NOT MAIN) so YOU YOURSELF can easily find sources of changes later.

---

## 0. How to use this plan

1. Read this whole file first.
2. Inspect the current code before editing. Use the `explore` subagent for reconnaissance to keep the main context lean.
3. Run the read-only **Phase 0 audit** before implementing the importer changes.
4. Follow the phases in order. Use subagents for isolated tasks. Never let two agents edit the same file.
5. After every phase, run the project checks:
   - `cd soundboard && npm test`
   - `cd soundboard && npm run build`
6. Keep the main agent focused on integration, review, and QA. Delegate file-heavy reading and isolated implementation to subagents.
7. The user has hourly Btrfs snapshots, but the migration script must still create its own config-only backup before rewriting data.
8. The user has given full freedom inside `olea/`: renaming/moving files is allowed, but only inside the project. Audio files are user data and gitignored.

---

## 1. Goals

- Fix sound classification so imported packs are not “all effects”.
- Add a **reusable library** of sound groups and a **global palette** that is always available and MIDI-mappable regardless of the active scene.
- Support scenes composed from library groups (e.g. goblins + carrion crawlers).
- Make moods authoritative: selecting a mood and pressing Stop/Start must restore exactly that mood’s loops/randoms.
- Standardize volume to `0..1` (`0%..100%`) across UI, MIDI, buses, moods, and persisted data.
- Fix bus volume so `0` is truly silent, including reverb tails.
- Add LEARN buttons for loop/random/effects buses.
- Improve import heuristics and add a review UI for bulk reclassification and merging tracks into playlist loops.
- Make the UI noticeably easier to use: search, clear labels, bulk actions, palette, origin tags, and learn-state feedback.

## 2. Non-goals (defer)

- Full Syrinscape fidelity (intensity, 3D positioning, every proprietary field).
- A complete effects editor (advanced reverb/FX racks). Preserve schema fields so it can be added later.
- Rewriting the app from scratch. Evolve the existing engine/server/UI.
- Multi-active scenes/layering. The global palette solves cross-scene availability first.
- Committing changes without explicit user approval.

---

## 3. Locked decisions (from user)

1. **Model:** Library → Palette → Scene.
   - Library = reusable sound groups (effects, randoms, loops), files can be moved into a shared library folder.
   - Palette = pinned library items that are always visible and MIDI-available, regardless of active scene.
   - Scene/Soundset = its loops, scene-specific randoms/effects, plus included library groups. It also shows the global palette.
2. **File layout:** move reusable SFX only. Keep scene/pack audio in place unless an element is promoted to the library.
3. **Existing data:** migrate in place. Preserve IDs, MIDI mappings, moods, and manual edits. Reclassify with review.
4. **Palette playback:** pinned loops/randoms are manual until toggled. They do not auto-start with every scene.
5. **Syrinscape scope:** run a read-only audit, implement core support (loops/randoms/effects/moods/reverb/triggers), defer intensity/3D/full FX editor.
6. **Volume:** all sliders and knobs are `0..1`; MIDI `0..127` maps to `0..1`.
7. **Moods:** authoritative for loops/randoms while active.
8. Keep the three buses (`loop`, `random`, `effects`) for separate volume control.
9. Do not touch anything outside `/home/ollo/Code/olea`.

---

## 4. Current architecture (orientation)

### Key files

| File | Responsibility |
|---|---|
| `soundboard/server.js` | Express on 8091; scans `AUDIO_DIR` for configs; `/api/library`, `/api/files`, `/api/soundset/:id`, `/api/global`; serves `/audio` and built frontend. |
| `soundboard/lib/schema.js` | Canonical JSON normalizers; `VERSION = 1`; kinds `loop/random/oneshot`; buses; reverb presets. |
| `soundboard/src/store.js` | Reactive state, element lookup, playback actions, moods, MIDI learn/dispatch, persistence. |
| `soundboard/src/engine.js` | Web Audio: loops, one-shots, three buses, master, shared reverb return. |
| `soundboard/src/components/*.vue` | Library, soundset, element row, group editor, mood editor. |
| `soundboard/import.js` | Syrinscape XML → `config.json` importer; weak filename fallback for packs without XML. |
| `soundboard/xml.js` | Minimal XML parser; `parseSoundsetXml`; `elementsFromFiles` heuristics. |
| `soundboard/global.json` | Runtime app state: buses + global MIDI. Gitignored. |
| `soundboard/midi-mapping.json` | Stale legacy file, not read by current code. Can be removed/ignored. |
| `soundboard/syrinscape/` | Audio root; contains pack folders and per-soundscape `config.json`. Gitignored. |

### Current behavior that must change

- **All-effect imports:** packs with only `.generated.xml` fall back to `elementsFromFiles()` (`import.js:162`), whose only heuristic is a loop keyword regex (`xml.js:270`). 62/317 soundsets are all `oneshot`.
- **MIDI is scene-scoped:** local notes only fire when the owning soundset is active (`store.js:681-689`). Global notes support only `stop` and `soundset` (`store.js:691-695`).
- **Starting a scene stops the previous one** (`store.js:197-207`).
- **Mood transport bug:** `applyMood()` only touches elements present in `mood.params` (`store.js:448-462`); `startLoops()`/`startRandoms()` ignore the active mood and start everything (`store.js:225-257`). Stop leaves the mood selected, so Stop → Start starts all.
- **50% knob bug:** element CC uses `value / 127` → `0..1` (`store.js:699`) while sliders are `0..2` (`ElementRow.vue:149`, `SoundsetPanel.vue:214`). Buses have the same mismatch.
- **Bus 0 is not silent:** reverb wet paths go to a shared `reverbReturn` that bypasses bus gains (`engine.js:66-68`, `153-160`, `315-321`).
- **Live element volume only updates loops** (`store.js:387-393`).
- **No bus LEARN UI:** schema/store already support `{ type: 'bus', bus }` (`store.js:702-711`), but the UI only has “learn master” (`SoundsetPanel.vue:308-321`).
- **Re-learning an action adds another binding:** `saveLearned()` (`store.js:665-679`) writes the new key but never removes existing keys that point at the same action. So assigning knob A, then re-learning the same action to knob B leaves both A and B assigned.

---

## 5. Target data model

### 5.1 Library

A reusable group is the same shape as an element, plus library metadata:

```jsonc
{
  "id": "uuid",
  "name": "Carrion Crawler noises",
  "kind": "random",                 // loop | random | oneshot
  "category": "Monsters/Carrion Crawler",
  "tags": ["monster", "carrion-crawler"],
  "gain": 1,                        // 0..1
  "randomise": "random",            // playlist cycling for loops
  "reverb": null,
  "position": null,
  "files": ["monsters/carrion-crawler/noises/01.ogg", "..."], // relative to LIBRARY_DIR
  "trigger": { "min": 10, "max": 30, "startMin": 2, "startMax": 10 }
}
```

- Stored in `soundboard/library.json` (app-level, gitignored).
- Audio files live under `soundboard/syrinscape/_library/...`.
- Library groups have stable UUIDs.
- Editing a library group propagates to every scene that includes it.

### 5.2 Scene / Soundset

```jsonc
{
  "version": 2,
  "id": "uuid",
  "name": "Goblins + Carrion Crawlers",
  "disabled": false,
  "elements": [ /* scene-local elements, same schema as v1 */ ],
  "includes": [
    {
      "id": "uuid",                 // include-instance ID (stable, used by moods/MIDI)
      "libraryId": "uuid",
      "overrides": {
        "gain": 0.8,
        "kind": null,               // null/undefined = inherit library kind
        "trigger": null,
        "reverb": null,
        "randomise": null
      }
    }
  ],
  "hidden": ["uuid"],               // instance IDs (local or include)
  "moods": [
    {
      "id": "uuid",
      "name": "Combat",
      "params": {
        "<instanceId>": { "plays": true, "volume": 0.8 }
      }
    }
  ],
  "midi": { "notes": {}, "ccs": {} },
  "reviewed": true
}
```

- Scene-local `files[]` remain relative to the scene’s own folder.
- Included library group `files[]` are relative to `LIBRARY_DIR`.
- `overrides` are partial element fields; merge over the library group. `null` means inherit.
- Moods and local MIDI target **instance IDs**, not library IDs, so the same library group can appear twice with different settings.

### 5.3 Global palette

```jsonc
{
  "version": 2,
  "buses": { "loop": 1, "random": 1, "effects": 1 },
  "palette": [
    {
      "id": "uuid",                 // palette-entry ID (used by global MIDI)
      "libraryId": "uuid",
      "label": "Crawler noises",    // optional display override
      "gain": 1,                    // optional volume override
      "order": 0
    }
  ],
  "midi": {
    "notes": {
      "9:40": { "type": "palette", "paletteId": "uuid" },
      "9:41": { "type": "soundset", "soundsetId": "uuid" },
      "9:42": { "type": "stop" }
    },
    "ccs": {
      "0:8": { "type": "master" },
      "0:1": { "type": "bus", "bus": "loop" },
      "0:2": { "type": "bus", "bus": "random" },
      "0:3": { "type": "bus", "bus": "effects" },
      "0:4": { "type": "paletteVolume", "paletteId": "uuid" }
    }
  }
}
```

- Palette loops/randoms are silent until toggled.
- Palette one-shots trigger on note.
- Palette volume CC controls that palette entry’s gain.
- Pinned item playback uses engine keys `palette:<paletteId>` to avoid collisions with scene elements.

### 5.4 Resolution rules

Add `lib/resolve.js`:

```js
resolveSceneElements(soundset, library) -> ResolvedElement[]
```

Resolved element:

```js
{
  ...effectiveElement,
  id,                 // instance ID (scene element ID or include.id)
  libraryId: string|null,
  source: 'scene'|'library',
  baseDir: string,    // relative to AUDIO_DIR; scene.dir or '_library'
  files: string[],    // relative to baseDir
}
```

- Inline scene element: `id = element.id`, `source = 'scene'`, `baseDir = soundset.dir`, `libraryId = null`.
- Include: find `library.groups[libraryId]`, merge `include.overrides`, `id = include.id`, `source = 'library'`, `baseDir = '_library'`.
- Missing library group: skip it and expose a warning in the UI; do not crash.
- `hidden` filters by instance ID.
- Library group edits automatically reflect because resolution happens on every load/state change.

`lib/schema.js` must export `normalizeLibrary`, `normalizeLibraryGroup`, `normalizeInclude`, `normalizePaletteEntry`, and keep backward-compatible `normalizeConfig`/`normalizeGlobal` for v1 input.

### 5.5 IDs

- Continue using UUIDs from `crypto.randomUUID()`.
- Never reuse IDs across library groups and scene elements.
- Include-instance IDs are stable and independent of `libraryId`.
- Merging elements must preserve or remap IDs carefully (see §8.3).

---

## 6. File layout and physical moves

```
soundboard/
  library.json                         # app-level library catalog (gitignored)
  global.json                          # buses, palette, global MIDI (gitignored)
  syrinscape/
    _library/                          # moved reusable SFX (inside audio root)
      monsters/carrion-crawler/noises/01.ogg
      spells/bard/...
    Syrinscape - .../config.json       # existing scenes/packs
```

- `LIBRARY_DIR = path.join(AUDIO_DIR, '_library')`.
- `LIBRARY_FILE = path.join(__dirname, 'library.json')`.
- Library files are addressed by `baseDir = '_library'`.
- Scan must exclude `_library` from the scenes list (it should not appear as a soundset).
- `/api/files` must include library folders recursively and include file sizes for heuristics.
- Promotion moves files; it must rewrite every config that referenced those files, not just the source scene.

---

## 7. API contracts

Expand existing endpoints; keep old response fields for compatibility where practical.

### `GET /api/library`

```json
{
  "soundsets": [ /* normalized v2 scenes */ ],
  "library": { "version": 2, "groups": [] },
  "global": { "version": 2, "buses": {}, "palette": [], "midi": {} }
}
```

### `POST /api/soundset/:dir`

Unchanged semantics: normalize and write the full config. Must support v2 `includes`.

### `POST /api/global`

Normalize and write `global.json` (buses, palette, MIDI).

### `POST /api/library`

Write `library.json` from a normalized body.

### `POST /api/library/promote`

Request:

```json
{ "soundsetDir": "Syrinscape - D&D - Carrion Crawler Battle", "elementId": "uuid", "category": "Monsters/Carrion Crawler" }
```

Behavior:

1. Validate paths stay inside `AUDIO_DIR`.
2. Resolve the scene element. If it already comes from the library, return an error/no-op.
3. Copy files to `_library/<category>/<slug>/` (copy first, then delete originals after configs are written — safer than move).
4. Create a library group with a new UUID and normalized element fields.
5. Replace the scene element with an include instance that preserves the old element ID:
   `{ id: oldId, libraryId: newGroupId, overrides: {} }`.
6. Scan all configs and rewrite file references that pointed at the moved files.
7. Write `library.json` and affected configs; on failure clean up copied files.
8. Return `{ ok, library, soundsets, global }` or at least enough for the client to reload.

### `GET /api/files`

Include file sizes:

```json
{
  "folders": [
    {
      "dir": "Syrinscape - ...",
      "name": "...",
      "files": [{ "name": "Foo", "file": "Foo.ogg", "size": 123456 }]
    },
    {
      "dir": "_library/monsters/carrion-crawler/noises",
      "name": "Carrion Crawler noises",
      "files": [{ "name": "01", "file": "01.ogg", "size": 98765 }]
    }
  ]
}
```

---

## 8. Engine changes (`src/engine.js`)

### 8.1 Volume is 0..1

- No engine change required for the scale itself; ensure callers pass `0..1`.
- Add a helper if useful: `clamp01(v)`.

### 8.2 Per-bus reverb returns (fixes bus 0 ≠ silent)

- Create `reverbReturns = { loop, random, effects }` in `ensureCtx()`.
- Each return gain = `busVolumes[bus] * REVERB_RETURN_LEVEL`.
- Change `getReverb(preset)` to `getReverb(bus, preset)` and cache convolvers per `${bus}::${preset}`.
- Connect each convolver to its bus’s reverb return.
- `setBusGain(bus, v)` updates both the dry bus node and the corresponding reverb return gain.
- Loop and one-shot wet sends connect to `getReverb(entry.bus, entry.reverb)`.

### 8.3 Live element volume for all playback

Add:

```js
setOneShotGain(id, v)
```

- Iterate `oneshots.get(id)` instances.
- Ramp dry gain to `v`, wet gain to `v * WET_RATIO`.
- Store the wet node on each instance.

`setElementVolume()` in the store must call this for random/one-shot elements, not only loops.

### 8.4 Gain ramps

Use short `linearRampToValueAtTime`/`setTargetAtTime` for volume updates to avoid clicks. Keep existing fade behavior for loops and stop actions.

---

## 9. Store changes (`src/store.js`, `src/midi.js`)

### 9.1 State

```js
store = reactive({
  soundsets: [],
  library: { version: 2, groups: [] },
  files: [],
  global: { version: 2, buses: { loop: 1, random: 1, effects: 1 }, palette: [], midi: { notes: {}, ccs: {} } },
  activeId: null,
  activeMoodId: null,
  masterVolume: 0.8,
  volumeOverrides: {},        // keyed by instanceId or `palette:<id>`
  learning: null,
  loaded: false,
  loopsPlaying: false,
  randomsPlaying: false,
  midiConnected: false,
  midiError: '',
})
```

### 9.2 Loaders

- `loadLibrary()` fetches `/api/library` and sets `soundsets`, `library`, `global`.
- Set bus gains for all three buses.
- `loadFiles()` handles `size`.

### 9.3 Element access

Replace `soundsetElements(ss)` internals with resolution:

- `resolvedSceneElements(ss)` → `resolveSceneElements(ss, store.library)`.
- `soundsetElements(ss)` groups them into loops/randoms/oneshots.
- `findElement(ssId, instanceId)` searches resolved elements.
- `findLibraryGroup(id)`.
- `paletteElements()` resolves palette entries against the library.
- `audioUrl` must accept a resolved element with `baseDir`; add `audioUrlFor(baseDir, file)`.

### 9.4 Mood transport fix

Make the active mood authoritative:

- Add `desiredMoodElements(ss)` returning loops/randoms with `plays !== false` when a mood is active.
- `applyMood(ssId, moodId)`:
  - Set `activeMoodId`.
  - Stop all loops/randoms that are not in the desired set.
  - Start desired loops/randoms that are not already playing.
  - Apply mood volumes.
  - Elements missing from `mood.params` must be treated as **not playing** while that mood is active.
- `startLoops()` / `startRandoms()`:
  - If an active mood exists, start only desired elements.
  - Otherwise start all.
- `stopLoops()` / `stopRandoms()`:
  - Stop all loops/randoms in the scene and set flags false.
  - Keep `activeMoodId` selected so Start restores the mood.
- `MoodEditor` must save params for **all** loops/randoms explicitly.
- Ensure `store.loopsPlaying`/`randomsPlaying` reflect actual playing state.

### 9.5 Volume

- Clamp every setter to `0..1`.
- `setElementVolume` updates loops, randoms, and one-shots live.
- `setPaletteVolume(paletteId, v)`.
- `setLoopsVolume` / `setRandomsVolume` / `setEffectsVolume` update engine + persist global.
- `resetElementVolume` / `resetSectionVolume` remain.
- Master remains 0..1.

### 9.6 Palette actions

- `pinToPalette(libraryId)` / `unpinFromPalette(paletteId)`.
- `playPaletteItem(paletteId)`:
  - one-shot → play once.
  - loop → toggle.
  - random → toggle auto-trigger.
  - Use engine key `palette:<paletteId>`.
  - Gain = palette override or library group gain.
  - Bus = kind mapping (`loop` → loop bus, `random` → random bus, `oneshot` → effects bus).
- `stopPaletteItem(paletteId)`.
- Palette loops/randoms are manual; do not auto-start on `startSoundset`.
- `stopEverything()` must stop palette playback too.

### 9.7 Library actions

- `addLibraryGroup(def)` / `updateLibraryGroup(id, patch)` / `deleteLibraryGroup(id)`.
- `addIncludeToScene(ssId, libraryId)` creates a new include instance with a UUID.
- `removeIncludeFromScene(ssId, includeId)` cleans moods and local MIDI references.
- `promoteToLibrary(ssId, elementId, category)` calls `/api/library/promote`, then reloads state.
- Stop playback before promotion.

### 9.8 MIDI

Extend action dispatch:

- Local notes: `{ type: 'oneshot'|'loop'|'random', elementId }`, `{ type: 'mood', moodId }`, `{ type: 'soundset' }`.
  - Resolve the instance element; use its current kind (do not trust stored type if it changed).
- Local CCs: `{ type: 'element', elementId }` → instance volume.
- Global notes: `{ type: 'palette', paletteId }`, `{ type: 'soundset', soundsetId }`, `{ type: 'stop' }`.
- Global CCs: `{ type: 'master' }`, `{ type: 'bus', bus }`, `{ type: 'paletteVolume', paletteId }`.
- `actionScope`: palette/paletteVolume/bus/master/stop → global; scene element/mood/soundset → local.
- `saveLearned` writes global actions to `global.json` and local actions to the active scene config.
- **Replacing bindings:** learning an action must first remove every existing mapping in the target map (`notes` or `ccs`) that refers to the **same action**, then write the new key. This applies to notes and CCs, local and global/palette actions. Re-learning must never leave the same action bound to multiple keys.
  - Add a pure helper (e.g. `bindAction(map, key, action)` in `lib/midi.js` or a new `lib/bindings.js`) that removes same-action entries and any previous entry for `key`, then sets the new binding.
  - If the captured key is already bound to a different action, replace that binding (standard learn behavior).
  - Clean up orphaned bindings when an element/mood/soundset/palette entry is deleted.
- Add `learnPaletteNote(paletteId)`, `learnPaletteCC(paletteId)`.
- Show assigned note/CC in the UI learn buttons (e.g. “learn” → “C#4” / “CC 8”).
- Local overrides global on the same key, but warn in the UI when a global palette mapping is shadowed by the active scene.

---

## 10. UI changes

### 10.1 App shell

- Add top-level navigation/tabs: **Scenes**, **Library**, **Review**.
- Keep the topbar: app title, main volume, STOP, MIDI status/connect.
- Add a persistent **Palette** panel (collapsible) visible on scenes and library views.
- Palette rows: name, kind tag, play/toggle, volume slider, learn note, learn knob, unpin, open library item.
- Empty states with clear calls to action.

### 10.2 Scenes list (`LibraryPanel.vue` or renamed `ScenesPanel.vue`)

- Search/filter.
- Card shows loops/randoms/effects counts and a “needs review” badge.
- Actions: start, edit, disable, delete.
- Separate “Disabled” section.

### 10.3 Library browser (new `LibraryBrowser.vue`)

- Search by name/tag/category.
- Filter by kind.
- Preview/play a group.
- Add to active scene (creates include).
- Pin to palette.
- Edit/delete group.
- Show file count, reverb, category, tags.

### 10.4 Scene view (`SoundsetPanel.vue`)

- Header: name, rename, transport (Start/Stop loops, Start/Stop random, Stop effects), edit, back.
- Moods.
- Palette panel (global) visible alongside scene content.
- Loops section:
  - Bus volume slider (0..1) + LEARN button.
  - Rows show playlist track count and randomization mode.
- Random section:
  - Bus volume + LEARN.
  - Rows show interval.
- Effects section:
  - Bus volume + LEARN.
  - Stop effects.
- Included library rows labeled “Library”.
- Edit mode:
  - Add from library.
  - Add new group.
  - Merge selected.
  - Reclassify selected.
  - Promote to library.
  - Hide/delete.
- Bus volume values display as percentages.

### 10.5 Element row (`ElementRow.vue`)

- Volume slider 0..1, reset button.
- Learn note / learn knob.
- Show origin tag (`Scene` / `Library`) and kind tag (`Loop` / `Random` / `Effect`).
- Show reverb preset if set.
- For random: interval and “once”.
- For loop: track count and randomization mode.
- For one-shot: playing/stop.
- Edit mode: rename, edit, hide, delete, promote to library.
- “Pin” action (if library-origin or after promotion).

### 10.6 Group editor (`GroupEditor.vue`)

- Volume 0..1.
- Kind selector with clear explanations.
- Random interval.
- Reverb.
- File picker with search, folder expand, select-all, sizes.
- For loops: explain playlist behavior (“one track at a time, crossfaded”).
- Optional tags/category for library groups.
- New-group default trigger for random: 10–30s, start 2–10s.

### 10.7 Mood editor (`MoodEditor.vue`)

- List all resolved loops/randoms (including library includes).
- Save params for all.
- Volume 0..1.
- Note that missing elements are treated as not playing.

### 10.8 Review UI (new `ReviewPanel.vue` / `ReviewDialog.vue`)

- Lists soundsets flagged `reviewed: false` or with no loops/randoms.
- Shows each element with proposed kind, file count, size, interval.
- Bulk select:
  - Set kind (Loop / Random / Effect).
  - Set random interval.
  - Set reverb.
  - Merge selected into a loop playlist.
  - Promote selected to library.
- “Apply” writes configs via store actions.
- “Mark reviewed”.
- Show a warning for packs with no real XML (heuristic import).

### 10.9 Styling

- Keep the existing dark theme.
- Add styles for palette, library browser, review table, badges, learn-assigned state.
- Ensure responsive layout for laptop widths.
- Make destructive actions visually distinct and confirmed.

---

## 11. Import, audit, and heuristics

### 11.1 Phase 0 audit (read-only)

Create `soundboard/tools/audit-syrinscape.js`:

- Walk `AUDIO_DIR` for `.xml` files, excluding `.generated.xml`.
- Parse with `xml.js` `parseXml`.
- Collect node paths/fields and counts across packs (e.g. `Chapter/MusicElements/MusicElement/Title`).
- Report:
  - packs with real XML,
  - packs with only `.generated.xml`,
  - packs with no XML,
  - element kinds found in XML,
  - fields present (trigger waits, randomise, reverb, position, intensity, moods, etc.).
- Scan existing `config.json` files for classification stats and all-oneshot packs.
- Write `soundboard/SYRINSCAPE_AUDIT.md` (committed docs) and optionally a JSON report.
- Do not modify configs.

The implementation may adjust based on audit findings, but do not expand scope beyond core support.

### 11.2 Shared heuristics (`lib/heuristics.js`)

Browser-safe, dependency-free. Export:

```js
suggestKind({ name, fileCount, size, xmlKind })
suggestTrigger(kind, fileCount)
suggestPlaylistMerges(elements, fileSizes)
```

Rules (initial):

- If `xmlKind` is present, use it.
- Loop keywords: `loop`, `ambience`, `ambient`, `atmos`, `drone`, `music`, `theme`, `score`, `soundtrack`, `bed`, `tavern`, `battle music`, `fadeloop`.
- Random/ambient keywords: `noise`, `noises`, `movement`, `rustle`, `squeak`, `growl`, `breath`, `breathing`, `critter`, `rat`, `rats`, `crowd`, `chatter`, `insect`, `bird`, `wind`, `rain`, `thunder`, `creak`, `drip`, `footsteps`, `running`.
- Effect/action keywords: `swing`, `slash`, `stab`, `hit`, `impact`, `punch`, `kick`, `bite`, `tear`, `rend`, `slam`, `shot`, `spell`, `cast`, `explosion`, `hammer`, `metal`, `wood`, `stone`, `glass`, `door`, `click`, `beep`, `alarm`.
- If any effect keyword matches, prefer `oneshot` unless a loop keyword also matches.
- If a loop keyword matches, prefer `loop`.
- If random keyword matches and not effect:
  - `fileCount > 1` → `random`.
  - single file with `size < 500 KB` → `random`.
- Large single files (> 1.5 MB) with no effect keyword → `loop` candidate.
- Otherwise `oneshot`.
- Heuristic random default trigger: `{ min: 10, max: 30, startMin: 2, startMax: 10 }`.
- Suggest merging single-file loop candidates that share a common prefix before ` - ` and are all large. This handles “D&D Dragon Heist Battle music - …”.

### 11.3 Importer (`import.js`, `xml.js`)

- Keep real XML as the highest-fidelity source.
- For XML-less packs, pass file sizes to `elementsFromFiles()` and use `lib/heuristics.js`.
- Group files as now (strip trailing counters).
- Mark heuristic-imported soundsets `reviewed: false`.
- Ensure random elements get a nonzero trigger.
- Do not overwrite existing configs.

### 11.4 Migration/reclassify tools

- `tools/migrate-v2.js`: v1 → v2, backups, clamps, `includes: []`, `reviewed` flags, library/global scaffolding.
- `tools/reclassify.js`: optional CLI for bulk reclassification; same pure helpers as the UI. Dry-run by default; `--apply` to write.
- Merging elements (pure helper in `lib/edit.js`):
  - Input: soundset, element IDs, target kind.
  - Combine files in stable order, pick name from the first or common prefix.
  - Choose gain/reverb/trigger from the first, or sensible defaults.
  - Create a new element/loop playlist.
  - Remove old elements.
  - Remap mood params and local MIDI actions from old IDs to the new ID when unambiguous; otherwise drop and report.
  - Clean hidden entries.
  - Test thoroughly.

---

## 12. Migration and promotion details

### 12.1 Backup

`tools/migrate-v2.js` must create:

```
soundboard/.migration-backup/<timestamp>/
  global.json
  library.json            (if present)
  configs/<hash-or-path>.json
```

Do not copy audio files into the backup.

### 12.2 v2 migration

For each config:

- Normalize with v2 schema.
- Clamp `gain` and mood `volume` to `0..1`.
- Add `includes: []`.
- Add `reviewed: true` for packs with real XML; `false` for generated-only/heuristic packs.
- Preserve IDs, MIDI, moods, hidden.
- Write pretty JSON.

For `global.json`:

- Clamp buses to `0..1`.
- Add `palette: []`.
- Preserve MIDI.
- Version 2.

Create empty `library.json` if missing.

### 12.3 Promotion

- Copy files first, write configs/library, then delete originals. On error, delete copies.
- Handle filename collisions with `-2`, `-3`.
- Rewrite references in all configs.
- Convert the source scene element to an include preserving its ID.
- Reject promotion for elements already from the library.
- Stop client playback before promotion (UI action).
- Add `tools/promote-library.js` for a manifest-driven bulk promotion.

### 12.4 Missing files / relink

Add a lightweight check:

- On scene resolution, if a file is missing (or at least if a library group is missing), show a warning badge/row.
- Optional CLI `tools/check-refs.js` that reports broken file paths.
- Do not implement a full relink UI unless time allows; document the limitation.

---

## 13. Testing and verification

### 13.1 Automated tests

Add `soundboard/test/` and `npm test` using Node’s built-in test runner (`node --test`). No new dependencies.

Tests:

- `schema.test.js`: v1/v2 normalization, volume clamping, includes, palette, MIDI normalization.
- `resolve.test.js`: inline + includes + overrides + hidden + missing library + baseDir.
- `heuristics.test.js`: D&D_Rats, Tumbling Stones, Dragon Heist music, ASS MUSIC, Axe swing, Carrion noises.
- `edit.test.js`: merge elements, ID remap, mood/MIDI cleanup.
- `bindings.test.js`: re-learning the same action replaces the old note/CC; the same key bound to a different action is replaced; local/global target maps are handled correctly.
- `library-service.test.js`: temp-dir promotion, path rewrite, collision, rollback.
- `migration.test.js`: v1 config to v2, backup creation, global/library scaffolding.

### 13.2 Build/check

- `cd soundboard && npm test`
- `cd soundboard && npm run build`
- Optionally `node --check server.js import.js xml.js lib/*.js tools/*.js` (run via a small script if globbing is awkward).

### 13.3 Manual QA checklist

- Open `D&D - Carrion Crawler Battle`: review shows proposed loops/randoms/effects; merging the three Dragon Heist tracks creates one loop playlist.
- Mood selected → Stop Random → Start Random: only the mood’s randoms play. Same for loops.
- Selecting a mood stops loops/randoms not in the mood.
- Element volume knob: 0 → silent, 127 → 100%.
- Loop/random/effects bus knob: same; bus 0 is fully silent including reverb tails.
- LEARN buttons for all three buses work and persist.
- Re-learn an element volume knob: assigning knob A, then the same action to knob B, leaves only B assigned. Same for notes and palette/bus mappings.
- Pin a library effect to the palette; start another scene; the palette trigger still works.
- Promote a scene effect to the library: files move to `_library`, scene still plays, other references still work.
- Add the same library group twice to a scene; both instances have independent volume/MIDI.
- Edit a library group; all scenes using it reflect the change.
- Palette loops/randoms do not auto-start with scenes.
- Disable/delete scene still works; library references are not silently broken.
- `npm run build` produces a working `dist`.

---

## 14. Subagent task breakdown

Run these in order. Dependencies are explicit. Never assign the same file to two agents at the same time. Ask each agent for a concise summary and a list of changed files; do not paste full diffs into the main context.

### T0 — Syrinscape audit (read-only)

**Type:** general/explore  
**Files:** create `soundboard/tools/audit-syrinscape.js`, `soundboard/SYRINSCAPE_AUDIT.md`  
**Depends on:** none  
**Deliverable:** audit report + stats; no config changes.  
**Acceptance:** script runs, report lists XML variants/fields and pack counts.

### T1 — Schema, resolution, heuristics, edit helpers

**Type:** general  
**Files:** `lib/schema.js`, new `lib/resolve.js`, new `lib/heuristics.js`, new `lib/edit.js`, `test/*.test.js`  
**Depends on:** T0 (for audit-informed field decisions, optional)  
**Deliverable:** v2 normalizers, resolution, heuristics, merge helper, tests.  
**Acceptance:** `npm test` passes for these units.  
**Notes:** Do not edit store/UI.

### T2 — Server, library service, migration, promotion tools

**Type:** general  
**Files:** `server.js`, new `lib/library-service.js`, new `lib/path-utils.js`, new `tools/migrate-v2.js`, new `tools/promote-library.js`, `tools/reclassify.js`, `test/library-service.test.js`, `test/migration.test.js`  
**Depends on:** T1  
**Deliverable:** expanded API, library persistence, v2 migration, promotion with reference rewrite, tests.  
**Acceptance:** temp-dir promotion/migration tests pass; server starts.  
**Notes:** Do not edit frontend files.

### T3 — Audio engine

**Type:** general  
**Files:** `src/engine.js` only  
**Depends on:** none (contract: 0..1 gains, per-bus reverb, `setOneShotGain`)  
**Deliverable:** per-bus reverb returns, live one-shot gain, ramps.  
**Acceptance:** build passes; manual audio check later.

### T4 — Store and MIDI

**Type:** general  
**Files:** `src/store.js`, `src/midi.js`  
**Depends on:** T1, T2, T3  
**Deliverable:** library/palette state, resolved elements, mood fix, volume 0..1, MIDI palette actions, bus learn, promotion actions.  
**Acceptance:** store imports resolve/schema helpers; build passes; no UI edits. Re-learning an action replaces its old note/CC binding (use the tested binding helper).

### T5 — UI shell, scenes, library, palette, review

**Type:** general  
**Files:** `src/App.vue`, `src/components/LibraryPanel.vue` (or rename to `ScenesPanel.vue`), new `src/components/LibraryBrowser.vue`, new `src/components/PalettePanel.vue`, new `src/components/ReviewPanel.vue`, `src/styles.css`  
**Depends on:** T4  
**Deliverable:** navigation, library browser, palette, review UI, styles.  
**Acceptance:** build passes; no edits to T6-owned components.

### T6 — Scene, element row, group editor, mood editor

**Type:** general  
**Files:** `src/components/SoundsetPanel.vue`, `src/components/ElementRow.vue`, `src/components/GroupEditor.vue`, `src/components/MoodEditor.vue`  
**Depends on:** T4  
**Deliverable:** scene UI using resolved elements, bus learn buttons, volume 0..1, palette/includes, review actions, mood-authoritative UI.  
**Acceptance:** build passes; no edits to T5-owned files (use scoped styles).

### T7 — Importer and heuristics integration

**Type:** general  
**Files:** `import.js`, `xml.js`  
**Depends on:** T1  
**Deliverable:** XML fidelity retained, XML-less packs use heuristics + sizes, random defaults, `reviewed` flags.  
**Acceptance:** import a test folder; heuristics tests pass.

### T8 — Docs and cleanup

**Type:** general  
**Files:** `README.md`, `REFERENCE.md`, `SCHEMA.md`, delete `REWRITE_PLAN.md`, update `package.json` scripts if needed  
**Depends on:** T1–T7  
**Deliverable:** docs match v2; stale plan removed; scripts documented.  
**Acceptance:** docs reviewed; no broken references to deleted files.

### T9 — Integration and QA (main agent)

**Type:** main agent  
**Depends on:** all  
**Deliverable:** run tests/build, fix integration issues, manual QA checklist, final summary.  
**Acceptance:** `npm test` and `npm run build` pass; major flows verified.

### Parallelization guidance

- T0 can run first.
- T1 and T3 can run in parallel (different files).
- T2 depends on T1.
- T7 depends on T1 and can run in parallel with T2.
- T4 depends on T1/T2/T3.
- T5 and T6 can run in parallel after T4 if file ownership is strict.
- T8 after implementation is stable.
- T9 last.

---

## 15. Definition of done

- [ ] All 317 existing configs migrated to v2 with IDs/MIDI/moods preserved and volumes clamped.
- [ ] `library.json` and `_library/` exist and are used by the UI.
- [ ] User can browse the library, add groups to scenes, pin to palette, and promote scene effects.
- [ ] Palette items work regardless of active scene and do not auto-start.
- [ ] Mood Stop/Start behavior is fixed for loops and randoms.
- [ ] Volume is 0..1 everywhere; MIDI 127 = 100%.
- [ ] Bus 0 is silent including reverb.
- [ ] Bus LEARN buttons exist and persist.
- [ ] Import review UI can bulk reclassify and merge tracks into playlist loops.
- [ ] Carrion Crawler pack can be corrected in the UI (music → playlist loop, rats/noises → random, actions → effect).
- [ ] `npm test` and `npm run build` pass.
- [ ] Docs updated; `REWRITE_PLAN.md` removed.
- [ ] No changes outside `/home/ollo/Code/olea`.

---

## 16. Risks and guardrails

- **Path safety:** every server-side file operation must resolve inside `AUDIO_DIR`/`LIBRARY_DIR`. Reuse the existing `resolveSoundsetDir` pattern.
- **Data loss:** copy → write configs → delete originals on promotion. Backup configs before migration. Roll back on error.
- **ID preservation:** never change scene IDs or element IDs during migration. Promotion must preserve the source element’s instance ID when converting to an include.
- **Reference rewriting:** moving files can break other scenes that referenced them via relative paths. Scan all configs, not just the source.
- **MIDI cleanup:** deleting elements/groups must remove or remap mood params and local MIDI actions. Re-learning an action must replace, not accumulate, its bindings.
- **Reverb bus fix:** ensure convolvers are cached per bus+preset; sharing a convolver across buses would reintroduce the bypass bug.
- **Performance:** resolution on every computed access could be wasteful. Cache per soundset/library version if needed, but correctness first.
- **UI complexity:** keep the main scene view simple; move library/review into separate tabs.
- **No new dependencies:** prefer Node/browser built-ins. If a dependency seems necessary, stop and ask the user.

---

## 17. Open assumptions

- The user will review and adjust classification via the UI; heuristics are only suggestions.
- `_library` is acceptable as the physical shared folder inside `AUDIO_DIR`.
- `library.json` may remain gitignored (user data), consistent with `global.json`.
- The existing three buses and moods remain the core playback model.
- Full Syrinscape intensity/3D/FX-editor work is out of scope for this pass.
