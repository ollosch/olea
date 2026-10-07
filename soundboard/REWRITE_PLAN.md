# Soundboard Rewrite — Implementation Plan

Scope: rewrite only the **soundboard** (`soundboard/`). The equipment manager (`equipment/`,
PocketBase + Vue) is untouched. The goal is to drop Syrinscape XML as the storage format and replace
it with our own per-soundscape JSON schema, turning the soundboard into a small, self-owned
"mini-DAW".

This file is the shared contract. Pass it to every subagent along with their step brief.

---

## 0. Locked decisions (do not revisit)

- **Own schema.** Syrinscape XML is an *import* format only. Runtime reads our JSON.
- **Storage.** One `config.json` per soundscape folder + a single `global.json` for app-level state.
  Scan all folders once at startup.
- **No migration.** Existing `library.json` / generated XML are test data — discard them.
- **Rewrite** the soundboard cleanly; reuse the Web Audio engine concepts and UI patterns as reference.
- **Reverb: yes** (per-element preset, `ConvolverNode`).
- **Intensity: no.**
- **3D: no.** Stereo panning only, and that is a *future* feature. Preserve `position` data in the
  config now, render nothing position-wise yet. No 5.1, no subwoofer/LFE.
- **Moods:** first-class editable presets (create/edit/delete), same as soundsets.
- **Volume baseline:** `active mood's volume` → else `element.gain`. "Reset" clears a session override
  back to that baseline.
- **MIDI:** global (in `global.json`) + local (per-soundscape, in `config.json`).
- **Stable IDs:** UUIDs for soundsets and elements. Renames never change IDs.
- **JSON, versioned** (`"version": 1`).
- **Git:** baseline commit on `main`, then a feature branch, one atomic commit per step below.

---

## 0.1 Repo layout (already restructured — do not re-create)

```
olea/
  start.sh              # starts BOTH apps
  equipment/            # PocketBase + Vue (untouched by this rewrite)
    start.sh
    download-pocketbase.sh
    pocketbase          # binary (gitignored)
    pb_data/            # runtime (gitignored)
    pb_hooks/  pb_migrations/  pb_public/  frontend/
  soundboard/           # Express + Vue — THIS rewrite
    start.sh
    server.js
    src/  dist/  node_modules/  package.json  vite.config.js  index.html  public/
    xml.js              # existing Syrinscape XML parser (kept, used by importer)
    generate-xml.js     # DELETE in Step 2 (superseded by importer)
    REWRITE_PLAN.md     # this file
    syrinscape/         # audio library (gitignored); contains one folder per soundscape
  README.md  REFERENCE.md  .gitignore
```

- Root `start.sh` launches `equipment/start.sh` and `soundboard/start.sh` in the background.
- `soundboard/start.sh` runs `node server.js`; `OLEA_AUDIO_DIR` defaults to `soundboard/syrinscape`.

---

## 1. Data schema (the contract)

### 1.1 Per-soundscape `config.json` (lives in each soundset folder under `soundboard/syrinscape/`)

```jsonc
{
  "version": 1,
  "id": "3f0a5b2e-...",        // UUID, stable
  "name": "Car Chase 2017",
  "elements": [
    {
      "id": "7c1d...",           // UUID, stable
      "name": "2017 Small Arms",
      "kind": "loop",            // "loop" | "random" | "oneshot"
      "gain": 0.8,               // imported default volume
      "randomise": "shuffle",    // "shuffle" | "random" | null (loop playlist cycling)
      "reverb": "City",          // reverb preset name, or null
      "position": null,          // optional: { minAngle, maxAngle, minDistance, maxDistance } (future pan)
      "files": [ "GSW SFX Pistol1.ogg" ],
      "trigger": { "min": 0, "max": 3, "startMin": 1, "startMax": 3 }  // "random" kind only
    }
  ],
  "moods": [
    { "id": "uuid", "name": "Quiet", "params": { "<elementId>": { "plays": true, "volume": 0.4 } } }
  ],
  "midi": { "notes": {}, "ccs": {} }
}
```

- `files[]` are **relative to the `config.json`'s own folder**. Own files are bare names
  (`"Foo.ogg"`); files pulled from another pack are `"../OtherFolder/Foo.ogg"`.
- `kind` semantics: `loop` = continuous; `random` = auto-triggered one-shot at `trigger` interval;
  `oneshot` = manually triggered.
- `trigger` only meaningful for `kind === "random"`.

### 1.2 App-level `global.json` (at `soundboard/global.json`, gitignored)

```jsonc
{
  "version": 1,
  "buses": { "loop": 1, "random": 1, "effects": 1 },
  "midi": { "notes": {}, "ccs": {} }
}
```

- `master` volume is **session-only** (in-memory, default 0.8) — not persisted.

### 1.3 MIDI actions

- **Local note** (`config.json.midi.notes`): `{ type: "oneshot"|"loop"|"random", elementId }`,
  `{ type: "mood", moodId }`, `{ type: "soundset" }` (toggle this soundset).
- **Local CC** (`config.json.midi.ccs`): `{ type: "element", elementId }` (element volume).
- **Global note** (`global.json.midi.notes`): `{ type: "stop" }`, `{ type: "soundset", soundsetId }`.
- **Global CC** (`global.json.midi.ccs`): `{ type: "master" }`, `{ type: "bus", bus: "loop"|"random"|"effects" }`.
- **Precedence:** local overrides global when both bind the same `channel:note` / `channel:cc`.

### 1.4 IDs

Generate with `crypto.randomUUID()` (available in Node ≥ 16 and modern browsers). Renames, hiding,
and re-sorting never change an ID. A custom soundscape is just a new folder + `config.json`.

---

## 2. Git workflow

1. `git init` (default branch `main`), relying on the existing `.gitignore`
   (already excludes `equipment/...`, `soundboard/syrinscape/`, `soundboard/dist/`,
   `soundboard/node_modules/`, etc.).
2. Baseline commit of the current state on `main`.
3. Branch `feature/soundboard-rewrite`.
4. One commit per step below. Commit message convention: `soundboard: <step summary>`.

Do not commit generated `config.json` files — they live inside `soundboard/syrinscape/` (gitignored).

---

## 3. Steps (each = one subagent, one commit)

### Step 0 — Git baseline (coordinator, not a subagent)
- `git init`, ensure `main`, initial commit of current state, create the feature branch.

### Step 1 — Schema doc + validation helper
- **Files:** `soundboard/SCHEMA.md` (copy the contract above, expanded with field notes),
  `soundboard/lib/schema.js`.
- **Brief:** Implement `normalizeConfig(obj)`, `normalizeGlobal(obj)`, `newId()`, `newElement(kind)`,
  `newMood()`, and constants for `ELEMENT_KINDS`, `REVERB_PRESETS`, `BUSES`. No behavior, just
  validate/fill defaults (missing fields → defaults; unknown kinds → reject or coerce). Add a
  tiny self-test via `node --input-type=module` smoke run.
- **Accept:** `node --check soundboard/lib/schema.js` passes; normalize of a sample config round-trips.
- **Commit:** `soundboard: schema contract + validation helpers`

### Step 2 — Importer
- **Files:** `soundboard/import.js` (CLI). Reuse `soundboard/xml.js` (parser stays as-is). Delete
  `soundboard/generate-xml.js` (superseded).
- **Brief:** `node soundboard/import.js <folder>` reads a Syrinscape pack folder (XML + audio), builds
  `config.json` in that folder. `node soundboard/import.js` (no arg) walks `soundboard/syrinscape/`
  and imports every folder lacking a `config.json`. Mapping: XML elements → elements with UUIDs;
  capture `name`, `gain` (InitialGain), `kind` (classification rule: Oneshot→`oneshot`, Loop→`loop`,
  else `maxTriggerWait > 0 ? random : loop`), `randomise` (RandomisePlaylist), `reverb` (ReverbPreset),
  `position` (Min/MaxAngle, Min/MaxDistance), `trigger` (Min/MaxTriggerWait + Min/MaxStartDelay).
  For folders with no XML, build elements from filename heuristics (group versioned files
  `Foo 01..15` into one element; "loop"/"fadeloop" in name → loop; else oneshot). Never overwrite an
  existing `config.json`.
- **Accept:** importing a real pack folder produces a valid `config.json`; re-running is idempotent.
- **Commit:** `soundboard: syrinscape importer`

### Step 3 — Server rewrite
- **Files:** `soundboard/server.js`.
- **Brief:** Replace XML parse/generate with config loading. Endpoints:
  - `GET /api/library` → `{ soundsets: [...], global }` (read all `config.json` + `global.json`).
  - `GET /api/files` → `{ folders: [{ dir, name, files: [{name,file}] }] }` (audio scan for picker).
  - `GET /api/soundset/:id`, `POST /api/soundset/:id`, `DELETE /api/soundset/:id`
    (read/write/delete one `config.json`; `:id` = folder name).
  - `GET /api/global`, `POST /api/global`.
  - `GET /audio/*` static (unchanged); serve `soundboard/dist` + SPA fallback (unchanged).
  Cache the library scan in-process (invalidate on write). Keep `OLEA_AUDIO_DIR` (default
  `soundboard/syrinscape`), `PORT` envs.
- **Accept:** server starts; `/api/library` returns parsed configs; a POST round-trips to disk.
- **Commit:** `soundboard: config-based server`

### Step 4 — Engine rewrite (add reverb)
- **Files:** `soundboard/src/engine.js`.
- **Brief:** Keep loop crossfade cycling, one-shot instance tracking, three bus gains + master.
  Add a **reverb send**: maintain a small map of `ConvolverNode`s (one per preset name seen), a
  shared reverb return gain, and a per-element dry/wet. Generate impulse responses programmatically
  (exponentially-decaying noise) for the presets in `REVERB_PRESETS`. `playLoopElement`/`playOneShot`
  take an optional `reverb` preset + `bus`. Position/pan is NOT implemented (future).
- **Accept:** build passes; a loop and a one-shot play through the correct bus with reverb applied.
- **Commit:** `soundboard: reverb in audio engine`

### Step 5 — Store rewrite
- **Files:** `soundboard/src/store.js`.
- **Brief:** Replace the overlay/merge model with the single-doc model. State: `soundsets`, `global`
  (buses + global midi), `activeId`, `activeMoodId`, `masterVolume`, in-memory `volumeOverrides`
  (keyed `soundsetId::elementId`), `learning`. Loaders hit the Step 3 API. Actions: transport
  (`startLoops/stopLoops/startRandoms/stopRandoms/stopEffects/stopEverything`), element
  (`toggleLoopElement/playOneshotElement/stopOneshotElement/toggleRandomElement/playRandomOnce`),
  volume (`setElementVolume` → override; `resetElementVolume` → clear override; baseline =
  `activeMood.params[el].volume ?? el.gain`; `resetSectionVolume`), buses (`setLoopsVolume` etc.),
  moods (`applyMood`, CRUD), editor (`renameElement/hideElement` (via a `hidden[]` list in config),
  `addElement/updateElement/deleteElement`, `createSoundset/renameSoundset/deleteSoundset`), MIDI
  dispatch with global+local precedence. Persist via `POST /api/soundset/:id` and `/api/global`.
- **Accept:** build passes; actions persist and reload correctly; reset returns to active mood baseline.
- **Commit:** `soundboard: store rewrite`

### Step 6 — UI rewrite
- **Files:** `soundboard/src/App.vue`, `soundboard/src/components/{LibraryPanel,SoundsetPanel,ElementRow,GroupEditor,MoodEditor}.vue`, `soundboard/src/styles.css`.
- **Brief:** Rebuild to the new store API. App header: `Main` slider + `STOP` button + MIDI status.
  SoundsetPanel: transport (start/stop loops, start/stop random, stop effects), **bus sliders above
  each block** (Loops/Random/Effects), Moods section with create/edit/delete, Loops/Random/Effects
  element lists. ElementRow: play/stop (loop), on/off + `once` (random), play/stop (oneshot),
  volume slider + `reset` (left of slider, `visibility`-reserved), learn note/vol, edit/hide/delete.
  GroupEditor: name/kind/interval/volume/reverb + file picker. MoodEditor: name + per-element
  plays/volume. Show a "custom" tag and delete on custom soundsets.
- **Accept:** `npm run build` passes; all editor actions work end-to-end against the API.
- **Commit:** `soundboard: UI rewrite`

### Step 7 — Bootstrap + build + smoke test
- **Files:** docs update (`README.md`, `REFERENCE.md`), `soundboard/import.js` run.
- **Brief:** Update docs to the new model. Run `node soundboard/import.js` against
  `soundboard/syrinscape/` to generate `config.json` files. `cd soundboard && npm run build`.
  Smoke test: start `soundboard/start.sh` against a temp audio dir, `curl /api/library`,
  `POST /api/soundset/:id`, verify `/api/files`.
- **Accept:** build green; server smoke test green; docs no longer reference the XML/overlay model.
- **Commit:** `soundboard: docs + bootstrap`

---

## 4. Hand-off protocol (for the coordinator)

For each step in order:
1. Launch a **general** subagent with: this `REWRITE_PLAN.md` (read-only context) + the step's
   `Brief` + the current file tree/state.
2. After the subagent returns, verify its `Accept` criteria (build / `node --check` / smoke test).
3. Commit only that step's changes (`soundboard: <summary>`).
4. Move to the next step.

Steps are strictly sequential (each depends on the previous one's files). Do not run steps in
parallel.
