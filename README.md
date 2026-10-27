# Olea

Two small, local-only tools for running a TTRPG campaign (DnD, Numenera, Call of Cthulhu, …):

1. **Equipment & money manager** — PocketBase + Vue 3, port **8090** (`equipment/`).
2. **Soundboard** — Express + Vue 3, port **8091** (`soundboard/`). Plays Syrinscape-style
   soundscapes (looping ambience + one-shot effects) and can be driven by a MIDI controller
   (e.g. AKAI MPK Mini: pads/keys → triggers, knobs → volume).

## Browser and MIDI setup (read this first)

The soundboard uses the browser **Web MIDI** API. The controller must be connected to the **same
device that is running the browser**, not to the server if you open the app from another machine.

Web MIDI also requires a **secure browser context**:

- `http://localhost:8091` and `http://127.0.0.1:8091` work normally.
- `http://<LAN-IP>:8091` is **not** a secure context. Chrome/Edge will not expose MIDI there unless
  you explicitly mark the origin as trustworthy for testing:

  ```bash
  # Chromium
  chromium --unsafely-treat-insecure-origin-as-secure=http://192.168.1.50:8091 \
           --user-data-dir=/tmp/olea-chromium

  # Google Chrome
  google-chrome --unsafely-treat-insecure-origin-as-secure=http://192.168.1.50:8091 \
                --user-data-dir=/tmp/olea-chrome
  ```

  Replace the IP with the machine running the app. For regular use on a tablet/another computer,
  prefer HTTPS (reverse proxy or a trusted local certificate) instead of the flag.

- Firefox: open `about:config` and set:

  | Setting | Value |
  |---|---|
  | `dom.webmidi.enabled` | `true` |
  | `dom.webmidi.gated` | `false` (if present) |

  Restart Firefox, open the soundboard, and allow the MIDI permission prompt. `localhost` works
  over HTTP; if a remote `http://<LAN-IP>` exposes no devices, use HTTPS.

Seeing **two MIDI inputs** is normal: the AKAI often exposes more than one port, and Linux/ALSA may
also show `Midi Through`. The app listens to all inputs, so if one physical pad triggers twice,
you have two ports delivering the same event; use the controller port and remove/disable the
virtual one. In the app, click **Connect MIDI**, then **Learn** next to an action and press the pad
or turn the knob. Note actions accept notes; volume actions accept CC only.

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

Express + Vue 3 on port **8091**. V3 is a clean rewrite: all audio lives in a content-addressed
store, and all state is JSON — see `soundboard/SCHEMA.md`.

- **Library** — reusable **groups** of one or more sounds, with a category, tags, playback
  selection, defaults, and an optional kind hint. Audio is stored once by content hash under
  `soundboard/sounds/<2>/<hash>.<ext>`; metadata lives in `soundboard/data/catalog.json` and
  `soundboard/data/library.json`.
- **Scenes** — a scene is a set of **tracks** that reference library groups, plus moods and local
  MIDI bindings. Each track owns its authoritative kind (`loop`, `random`, or `oneshot`) and its
  scene-wide order. Scene files live in `soundboard/data/scenes/`; there is no scene-local audio.
- **Moods** — sparse per-track performance presets for enabled state, gain, reverb, pan, and random
  trigger interval. Selecting a mood never starts or stops transport. Every scene has a default
  mood; a new mood starts from group defaults, while **Duplicate mood** copies an existing preset.
- **Palette** — globally pinned library groups for quick access, with optional per-entry gain.
  Palette items never auto-start; they always require an explicit trigger.
- **Edit vs perform** — edit mode is desktop/mouse-oriented for browsing, drag-and-drop, grouping,
  moods, and bindings. Perform mode is touch/MIDI-first and exposes scene/mood selection, transport,
  master and bus volumes, and trigger/palette pads.
- **Import and curation** — the one-off importer hashes and imports the source tree, writes the
  catalog, and proposes library groups. The curation view supports search, preview, categories,
  tags, merge/split, and bulk edit; mark import done when the library is verified.
- **MIDI** — explicit global (stop, master/bus/palette volume, palette trigger, open scene) and
  scene-local (track trigger/volume, mood select, scene transport) actions. Local bindings do not
  silently shadow global ones; collisions require explicit confirmation.

On first run, import existing audio into the v3 store:

```bash
cd soundboard
npm run import-v3 -- --dry-run   # scan and preview; writes nothing
npm run import-v3                # copy/link blobs, write catalog, propose groups
```

The default source is `soundboard/syrinscape/`, with data in `soundboard/data/` and blobs in
`soundboard/sounds/`. Use `--source <dir>` for another tree and `--no-duration` to skip `ffprobe`.
`--no-groups` imports blobs/catalog only and `--limit <n>` caps files; `--help` lists everything.
Re-running the importer is safe and idempotent. It never deletes or modifies source audio: verify
the catalog and library, then remove the old audio tree yourself. Old v2 `config.json`/`library.json`
data is deprecated and is not read or migrated.

When the audio catalog is ready, recreate the legacy scenes as a one-off conversion:

```bash
npm run import-scenes -- --dry-run
npm run import-scenes
```

This reads every old `config.json`, recreates each scene (name, disabled state, element
kinds/order/triggers, moods, and local MIDI), and adds only the library groups needed to preserve
each element's sound set. It is idempotent: re-running skips scenes that already exist, and
`--force` updates them. It does not migrate the old global palette or global MIDI. Use
`--limit <n>` for a small test run, and `--source`, `--data`, or `--sounds` to override paths.

- Override paths with `OLEA_DATA_DIR` / `OLEA_SOUNDS_DIR`, and the port with `PORT`.
- MIDI learn is available in the UI. Local scene bindings are checked against global bindings and
  cannot silently override them.
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
cd soundboard && npm run import-v3 -- --help         # one-off content-addressed importer
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
  src/           #   Vue 3 source (edit mode, perform mode, import/curation)
  lib/v3/        #   schema, resolution, ordering, bindings, catalog, storage, store, import
  tools/         #   import-v3.js (one-off content-addressed importer)
  test/          #   node --test suites
  data/          #   runtime JSON: catalog, library, global, scenes/ (gitignored)
  sounds/        #   content-addressed audio blobs (gitignored)
  syrinscape/    #   old source audio tree (gitignored, user-provided; import source)
  SCHEMA.md      #   v3 catalog/library/scene/global schema and workflow
  server.js      #   Express API + /audio/<hash>
  start.sh       #   start the soundboard server
start.sh         # starts both apps
```

## Re-downloading PocketBase

```bash
./equipment/download-pocketbase.sh
```
