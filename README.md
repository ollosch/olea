# Olea

A local-network TTRPG companion for preparing games and managing the details at the table. Games, characters, catalog browsing, inventories, spellbooks and encounter tools are under active development; remaining features are tracked in [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md).

## Architecture

- Vue 3, Vue Router, TypeScript, Vite, Tailwind CSS and Reka UI for a responsive web interface.
- PocketBase embedded in a Go application for SQLite storage, the API and realtime subscriptions.
- The production frontend is embedded in the Go executable. Players connect through a browser on the same network; no internet access is required at runtime.
- Appearance defaults to green on dark. Before a profile is active, the accent is stored in the browser; once a character owner or game GM is active, it is saved to that local profile and follows it across devices.

This is a trusted-LAN application. Profiles are lightweight local labels for character ownership and GM assignment, not login accounts. The current app does not implement authentication or game-level access controls; profile and UI restrictions do not secure data from other devices on the network.

## Develop

Requirements: Node.js 20.19+ or 22.12+ (a current LTS is recommended), npm, and Go 1.27 or newer. These are development tools, not prerequisites for running a built binary.

```sh
npm ci
npm run build
```

In one terminal, start the backend from the repository root:

```sh
go -C server run . serve --http=127.0.0.1:8090 --dir=../pb_data
```

In another terminal, run the frontend development server:

```sh
npm run dev
```

To start the backend directly in the foreground with a chosen data directory, use `scripts/start-server.sh /path/to/data`. For a fresh migration check, choose a new empty directory, stop the server with Ctrl+C, and run the same command again with that directory to verify restart behavior.

Open the Vite URL shown in the terminal. Vite proxies `/api` to PocketBase. `npm run build` is needed once before starting the Go server; frontend edits then update through Vite. Run `npm run typecheck` to check TypeScript.

## Build and run

```sh
npm ci
npm run build
go -C server build -o ../bin/olea .
./bin/olea serve --http=0.0.0.0:8090 --dir=./pb_data
```

On Windows, build to `../bin/olea.exe` and run `bin\olea.exe` with the same arguments. Visit `http://localhost:8090` on the host or `http://<host-lan-ip>:8090` from another device on the same Wi-Fi. Allow the port through the host firewall if needed. PocketBase's admin UI is at `/_/`.

The binary also defaults to `serve --http=0.0.0.0:8090` if started with no arguments. PocketBase then uses its default `pb_data/` directory in the current working directory. Prefer an explicit `--dir` so the location remains predictable: the development command above uses `../pb_data` from `server/`, and the built command uses `./pb_data` from the repository root. This directory contains the SQLite database and other runtime files; it is local campaign data and must not be committed.

On upgrade, stop the running server, replace it with the newly built version, and start it again with the same `--dir`. Version-controlled Go migrations in `server/migrations/` are applied automatically on startup and record their applied versions in the database. Keep the data directory when upgrading. Back it up only while the server is stopped; do not copy only the live SQLite database. To initialize a fresh install, start the server with an empty data directory and PocketBase will create the schema and seed the `dnd5e` system identifier.

## Local catalog imports

Catalog imports are explicitly invoked on the host; the application does not fetch or bundle reference data. `go -C server run . --dir=/path/to/pb_data catalog-import <system-key> <json-file>` accepts the source-neutral JSON interchange format below. Omit `--dir` to use PocketBase's default directory relative to the server working directory. The importer updates records with the same system/type/source/source_id and leaves alternate descriptions and notes intact.

```json
{
  "records": [
    {
      "type": "spell",
      "source": "SYNTHETIC",
      "source_id": "sample-spark",
      "name": "Sample Spark",
      "level": "0",
      "school": "V",
      "original": { "entries": ["A brief invented description."] }
    }
  ]
}
```

Supported record types are `item`, `spell`, and `creature`. Each record requires a source, stable source ID, name, and original JSON; creature type and challenge rating fields are available for later importers. The command prints created/updated totals and fails on invalid or duplicate identities. Use invented fixtures for development; do not commit personal reference files.

For the supplied 5etools-style D&D 5e sources, use `go -C server run . --dir=/path/to/pb_data dnd5e-import spells ../data/dnd5e_spells_phb.json`, `go -C server run . --dir=/path/to/pb_data dnd5e-import bestiary ../data/dnd5e_bestiary-mm.json` or `go -C server run . --dir=/path/to/pb_data dnd5e-import items ../data/dnd5e_items.json`. Paths are relative to `server/` because of `go -C server`. These importers retain complete source objects, including fields not yet modeled, and report skipped records or warnings. Spell schools are normalized to names; monster imports support string/object creature type and CR, fractional CR, HP average/formula, Dexterity and actions. Item imports retain type, weight, value, rarity and resolve available `_copy` inheritance with append/insert/replace entry modifications while preserving the original `_copy` definition in source JSON. Unresolved bases and unsupported modifications are skipped with warnings. `itemGroup` bundle definitions are counted and deliberately not imported as standalone items. Missing stats are preserved in original JSON and are not invented. Source JSON remains local and is not included in the repository.

For D&D 5e carrying weight, coins use the standard 50 coins per pound; each denomination is stored and displayed as a separate nonnegative whole-number balance. This is a fixed 5e convention in Olea, not a configurable variant rule.

## Encounters and player display

Encounters are reusable preparation groups; starting combat creates independent live participants whose HP, initiative, conditions and notes are separate from preparation. The GM can optionally show the active encounter, initiative, enemy names, enemy HP and conditions in the player-facing encounter view. These settings are all off by default and only hide details in the UI. This is a trusted-LAN application: they are not access controls, and connected devices can still query local records through the API.

## Random tables

Open a game's **Random tables** to create and edit tables with inclusive integer ranges and optional `NdM` dice expressions (with an optional signed constant). Ranges cannot overlap; gaps are allowed and produce no match. Enter a manual result to use physical dice or a table with no expression. Results may include text and an item, spell, creature or encounter reference. Catalog references must match the game's system; encounters must belong to the game. A result whose reference was subsequently removed is shown as missing. Creature results can be added to a game encounter.

Optional system templates are locally imported, read-only, and copied into games as independent editable tables. No templates or reference content are bundled. On the host, run `go -C server run . --dir=/path/to/pb_data table-template-import dnd5e /path/to/templates.json`. Template identity is system/source/source_id; importing again updates the template without changing copies. The import is atomic and fails if a catalog reference is missing; import catalog content first. Templates may reference system catalog entries by stable identity, but not game-specific encounters. For example, with an invented creature already imported as `SYNTHETIC` / `sample-ooze`:

```json
{
  "templates": [{
    "source": "SYNTHETIC", "source_id": "sample-table", "name": "A chance meeting", "dice": "1d6",
    "entries": [
      { "min": 1, "max": 3, "text": "A quiet road" },
      { "min": 4, "max": 6, "text": "An unexpected visitor", "type": "creature", "source": "SYNTHETIC", "source_id": "sample-ooze" }
    ]
  }]
}
```

## Planned paper cards

Printing is planned, not yet available. Spell and monster cards are intended to print four per A4 sheet, each slightly smaller than A6 to leave room for margins and cut guides. Monster cards should be printable from a single encounter or a selection of encounters, with repeated creature types deduplicated. Item cards are also planned; approximately A7 and eight per A4 sheet is the current preference, while their layout, especially for weapons, remains undecided. See [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md) for the planned preview, duplex and overflow requirements.

## Local data

`data/` contains user-provided reference material and is deliberately Git-ignored. Runtime PocketBase data, dependencies, generated frontend assets and binaries are ignored too. Never commit personal source material or campaign databases.
