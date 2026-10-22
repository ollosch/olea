# Olea

Two small, local-only tools for running a TTRPG campaign (DnD, Numenera, Call of Cthulhu, …):

1. **Equipment & money manager** — PocketBase + Vue 3, port **8090** (`equipment/`).
2. **Soundboard** — Express + Vue 3, port **8091** (`soundboard/`). Plays Syrinscape-style
   soundscapes (looping ambience + one-shot effects) and can be driven by a MIDI controller
   (e.g. AKAI MPK Mini: pads/keys → triggers, knobs → volume).

## Equipment & money manager

- **Roles:** GM and Player. Roles are per-game — you can be GM in one game and a Player in another.
- **Games:** support multiple independent groups. Each game defines its own currencies
  (e.g. DnD's cp/sp/gp/pp, Numenera's shin, CoC's cents/dollars).
- **Items:** the GM maintains a shared catalog. Players hold *instances* of those items, which can
  be a single item, a stack (quantity), or a charge-based item (uses).
- **Money:** each player has a wallet per game; transfers work between players, and the GM can
  give or take money from anyone. Totals are shown raw **and** as an optimized "fewest coins" value.
- **Real-time:** changes appear on every connected device instantly.
- **Print:** a player's inventory + cash can be printed as a clean sheet (items with weight/value,
  no descriptions or images).

## How it works

The equipment app is a single **PocketBase** binary (embedded SQLite, real-time subscriptions, file
storage) that also serves the built **Vue 3** frontend (in `equipment/pb_public/`). Identity is
name-only ("pick a name"), which is fine for a trusted home network — there is no password system.

## Running it

```bash
./start.sh                    # starts BOTH apps
./equipment/start.sh          # equipment manager → http://0.0.0.0:8090
./soundboard/start.sh         # soundboard       → http://0.0.0.0:8091
```

Open `http://localhost:8090` / `http://localhost:8091` on the host, or
`http://<host-ip>:<port>` from another device on the same network. Find the host IP with
`ip addr` / `ipconfig`.

- Equipment data (SQLite + uploaded images) lives in `equipment/pb_data/` — back it up to back up
  everything.
- First run: the PocketBase admin dashboard is optional. To create an admin account run
  `./equipment/pocketbase superuser upsert EMAIL PASSWORD` and open `http://localhost:8090/_/`.

## Soundboard

Serves the `soundboard/syrinscape/` audio tree. State is JSON only — see `soundboard/SCHEMA.md`:

- **Scenes** — one folder + `config.json` per soundscape. Audio is grouped into **elements**: loop
  (continuous ambience), random (auto-triggered at bounded intervals), or one-shot (manual effect).
- **Library** — reusable groups in `soundboard/library.json`, with audio under
  `syrinscape/_library/`. Scenes add library groups as **includes**, so editing a group updates every
  scene that uses it.
- **Palette** — pin library groups for always-available playback and MIDI control.
- **Review** — imported packs without authoritative XML are marked `reviewed: false`; use this tab to
  bulk reclassify, set random intervals/reverb, merge tracks, or promote groups to the library.

On first run, import existing Syrinscape packs with `node soundboard/import.js` (it reads each pack's
`.xml` and writes a `config.json`; campaign packs with multiple chapters are split into a subfolder
per chapter). Packs without real XML use size/name heuristics and are flagged for review.

If you are upgrading existing v1 data, run the migration **once** before starting the v2 server:

```bash
node soundboard/tools/migrate-v2.js --dry-run   # inspect
node soundboard/tools/migrate-v2.js             # JSON backup, then write v2 files
```

- Set the audio folder with `OLEA_AUDIO_DIR=/path/to/folder ./soundboard/start.sh`.
- MIDI mappings live in each scene's `config.json` (local), `soundboard/global.json` (app-level), and
  palette entries. Assign them in the UI via "learn" mode. Local scene bindings win over global ones.
- **Edit** (scene header): add from the library, create custom groups, merge/reclassify selected
  elements, promote to the library, hide/delete, and edit moods.
- Any scene can be **disabled**, **renamed**, or **deleted** (removes the folder and its files).
- **Web MIDI** works in Chrome/Edge out of the box. In Firefox, enable `dom.webmidi.enabled` in
  `about:config` or install a Web MIDI add-on.

## Development

Equipment manager:

```bash
cd equipment/frontend && npm install && npm run dev  # frontend dev (Vite proxies /api)
cd equipment/frontend && npm run build               # rebuild into equipment/pb_public/
./equipment/pocketbase serve --http=127.0.0.1:8090 --dev   # backend (terminal 2)
```

Soundboard:

```bash
cd soundboard && npm install && npm run dev          # frontend dev (Vite proxies /api, /audio)
cd soundboard && npm run build                       # rebuild into soundboard/dist/
cd soundboard && npm test                            # Node test runner
node soundboard/server.js                            # or ./soundboard/start.sh
node soundboard/tools/audit-syrinscape.js            # read-only pack/config audit
node soundboard/tools/reclassify.js                  # dry-run heuristic reclassification
node soundboard/tools/promote-library.js manifest.json [--apply]
```

## Layout

```
equipment/       # equipment manager (PocketBase + Vue 3)
  frontend/      #   Vue 3 source (Vite + Pinia + Vue Router, plain JS)
  pb_hooks/      #   backend routes + logic (PocketBase JS hooks)
  pb_migrations/ #   database schema + access rules
  pb_public/     #   built frontend (generated by `npm run build`)
  pocketbase     #   the PocketBase binary (downloaded by download-pocketbase.sh)
  pb_data/       #   runtime database + storage (gitignored)
soundboard/      # soundboard (Express server.js + Vue 3 frontend)
  src/           #   Vue 3 source (scenes, library, palette, review)
  lib/           #   schema, resolution, heuristics, edit, library service
  tools/         #   audit, migrate-v2, reclassify, promote-library
  test/          #   node --test suites
  import.js      #   Syrinscape XML -> config.json importer
  SCHEMA.md      #   the config.json / library.json / global.json schema
  syrinscape/    #   audio library (gitignored, user-provided)
  library.json   #   shared library groups (gitignored, runtime-created)
  global.json    #   buses, palette, global MIDI (gitignored, runtime-created)
  server.js      #   Express backend
start.sh         # starts both apps
```

## Re-downloading PocketBase

```bash
./equipment/download-pocketbase.sh
```
