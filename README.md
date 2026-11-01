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

## Browser tests

Playwright runs end-to-end tests in Chromium. After installing npm dependencies, install the browser once:

```sh
npx playwright install chromium
npm run test:e2e
```

The test command starts Vite and a disposable Go/PocketBase server automatically, seeds invented records for each test, and removes its temporary database when the server exits. The backend always starts in a fresh temporary directory and will not reuse a server on the E2E port. Tests run on desktop Chromium with mouse input and Pixel 8 touch emulation. Use `npm run test:e2e:desktop` or `npm run test:e2e:mobile` to run one project. Browser E2E tests do not use or modify `pb_data/`.

Current E2E coverage includes two-context inventory and player encounter updates, stale quantity/container/coin conflicts, inventory and coin transfers, offline/reconnect refresh, player encounter visibility, app-shell loading, mobile touch target sizing and overflow, and desktop workspace overflow. Device coverage is browser emulation; physical phones and laptops still need hands-on verification.

The default per-test timeout is **10 seconds**, configured by `timeout` in `playwright.config.ts`. For a test or group that legitimately needs longer, set `test.setTimeout(milliseconds)` inside the test or `test.describe.configure({ timeout: milliseconds })` inside its describe block. Keep those overrides local instead of increasing the suite-wide limit.

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

AD&D 2e is available as a system after migration. Import the supplied local spell index and pages together using `go -C server run . --dev=false --dir=/path/to/pb_data adnd2e-import spells ../data/adnd_spell_list.json ../data/adnd_spell_pages.json`; import the saved creature site with `go -C server run . --dev=false --dir=/path/to/pb_data adnd2e-import bestiary ../data/adnd_monstrous_compendium`. Import counts and warnings include duplicate or missing spell pages, unrecognized infoboxes, missing creature pages and multi-column/absent stat tables. Spell page IDs and creature appendix paths are stable import identities; reimport preserves alternate descriptions and notes. Full spell wikitext and the original creature content HTML are retained locally and rendered as text and tables rather than executed. The source-book filter uses the first recognizable cited book. Complex wiki syntax and creature variants may require consulting original source data; source files can be incomplete. For simple single-column whole-number hit dice with an optional positive bonus, encounter HP can be rolled using d8s; ambiguous, fractional or variable hit dice remain manual. No reference material is bundled.

For D&D 5e carrying weight, coins use the standard 50 coins per pound; each denomination is stored and displayed as a separate nonnegative whole-number balance. This is a fixed 5e convention in Olea, not a configurable variant rule.

Currency balances are stored as a denomination-keyed JSON object on each inventory or stash. A one-way migration copies every legacy balance, including zeroes; the old columns remain as a historical snapshot and are no longer authoritative. Unsupported balances are retained and cannot be silently removed or changed. Guarded balance edits and transfers check the game's registered denomination set; the server's `server/currency` registry must be updated alongside the frontend capability definition for each built-in system.

AD&D 2e and unknown systems currently have no verified denomination or coin-weight rules configured. Legacy nonzero balances remain visible as unsupported, and their coin weight and carried total are unknown. Item weights and capacity can still be entered in manual units. Party totals include character inventories and the party stash only.

## Encounters and player display

Encounters are reusable preparation groups; starting combat creates independent live participants whose HP, initiative, conditions and notes are separate from preparation. The GM can optionally show the active encounter, initiative, enemy names, enemy HP and conditions in the player-facing encounter view. These settings are all off by default and only hide details in the UI. This is a trusted-LAN application: they are not access controls, and connected devices can still query local records through the API.

D&D 5e uses highest initiative first and supports d20 initiative and Dexterity-derived modifiers. AD&D 2e and unregistered systems use manual turn order and initiative; arrows arrange participants. The active participant remains selected when ordering changes. Existing active combats retain their previously selected participant during migration. AD&D creature HP rolls are available only for the simple hit-dice notation described above.

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

## Paper cards

The shared print preview and A4 print foundation are available, including duplex pairing, long-/short-edge flips, cut guides, local system fonts, a calibration page (open **Print calibration** at `/print/calibration`), and visible overflow warnings. The calibration page includes a 50 mm square and a ruler; print at 100% / Actual size with “Fit to page” disabled. Browser print-to-PDF was verified in Chromium. Actual printer scaling, duplex registration and cut alignment still need hands-on verification for each printer.

Spell cards can be selected and printed from a character's spellbook, four per A4 sheet. Fronts include available system-specific fields and the preferred alternate description, falling back to original spell content; backs contain only the spell name. Long content and missing fields are called out in the preview. Monster cards can be selected from one or more encounters in a game; catalog records are deduplicated by identity, while same-name creatures from different sources remain separate. Creature stats, actions, preferred at-table text, available flavour and encounter notes are included. Custom participants and missing records receive clearly labeled manual cards. Item cards can be printed from a character inventory in A7 landscape, eight per A4 sheet. Weapon cards emphasize available damage, range and properties; descriptions appear on the front and item notes on the back. Card layout dimensions are data-driven to allow additional formats such as A8. See [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md) for card content and verification requirements.

## Local data

`data/` contains user-provided reference material and is deliberately Git-ignored. Runtime PocketBase data, dependencies, generated frontend assets and binaries are ignored too. Never commit personal source material or campaign databases.

## Built-in system capabilities

`src/lib/systems.ts` defines the typed built-in capability registry. A game resolves its stable system key through its expanded `system` relation; missing, mismatched and unregistered references use the neutral manual fallback. The contracts describe encounter ordering and optional initiative rolls, creature HP interpretation, catalog filters, and denominations and weight. Generic dice evaluation remains in `src/lib/dice.ts`.

To add a built-in system:

1. Implement `SystemCapabilities` in a built-in frontend module and register it in `src/lib/systems.ts` with a stable key. Define ordering, optional initiative and HP rules, catalog filters and presentation, currency, weight units and catalog item-weight interpretation. Supply `cards` presentation functions for system-specific spell fields, creature stats/actions/flavour and item fields, or use `neutralCardPresentation` for unsupported formats. Shared card builders handle layout, notes and warnings without parsing system source formats. Use manual or unknown fallbacks for unverified rules.
2. Register the same stable key and denomination keys in `server/currency/currency.go`; seed the system record with a versioned migration, and add an importer if local source data is available. The frontend registry controls presentation; the server registry enforces currency edits and transfers.
3. Add invented fixtures and tests covering the capability module, persistence, conflicts and transfers. `src/lib/inventedSystem.test.ts` and the invented server currency tests demonstrate different rules without runtime plugins or reference content.

Shared collections own game data, transactions and user edits. Catalog originals remain in `original_json`, and reimports preserve alternate descriptions and notes. Currency balances retain unsupported keys; combat records store the active participant independently of display order. The registry does not load runtime plugins or reference content.

Catalog filters use the same definitions and matching helpers in browsing and pickers. Common imported attributes remain queryable columns; additional system-specific attributes can be read from paths under the preserved `original_json` object without adding shared schema columns. The catalog currently loads the selected system and type into the browser for filtering and pagination, so very large catalogs may need a server-side query strategy later.

Frontend helper checks can be run with `node --experimental-strip-types src/lib/inventedSystem.test.ts` and the other `src/lib/*.test.ts` files. The Go suite includes fresh schema and populated pre-milestone upgrade/restart coverage. Browser and device testing was not performed for the system architecture milestone; verify desktop and phone layouts and real-time updates separately. Actual printer alignment also requires testing.
