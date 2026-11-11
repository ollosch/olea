# Olea reference

> Read this before exploring the repository. It exists so subagents do not re-analyse the whole app for every task. Verify specific files when a task depends on them, but start here.

## Current state

- Backend and domain logic are implemented and tested.
- Campaign-manager Batches 1–4 are implemented and tested: schema migrations, the vault importer, asset/map handling, closure paths, FTS, search, rebuild hooks and the world snapshot route.
- The previous Vue UI and its browser tests were deliberately removed in commit `dbe7c65` at the owner's request. Do **not** restore them. A clean UI is being built.
- `src/App.vue` is currently a placeholder. Batch 5 will hydrate `GET /api/olea/world` into a Pinia world store and browse/search in memory; the backend remains the source of truth.
- `poc_data/` contains the imported real vault for the PoC (529 entities, 98 copied assets) and is disposable; regenerate it with `import-vault`. `pb_data/` is untouched by the campaign-manager work.
- `Timeline/` notes are disposable examples; the importer skips them.
- The campaign-manager design is in `docs/campaign-manager-plan.md`. That file is authoritative for the new work.

## Runtime and layout

- Go executable embeds PocketBase and the built frontend.
- PocketBase provides SQLite storage, file storage, realtime subscriptions, admin UI and migrations.
- Trusted-LAN app: collection rules are public; there is no authentication and no game-level authorization. Do not treat UI hiding as security.
- Default data directory is the OS user config folder; `--dir` overrides it.

Repository layout:

```text
server/
  main.go                 PocketBase bootstrap, CLI commands, custom routes
  migrations/             Versioned PocketBase and raw SQL migrations
  world/                  Entity normalization/resolution, relations/mentions, assets, paths, FTS, search, hooks, snapshot
  vaultimport/            Obsidian vault importer (frontmatter, relations, assets, maps, report)
  catalogimport/          Source-neutral catalog import
  dnd5eimport/            5e bestiary/spell/item parsers
  adnd2eimport/           AD&D 2e spell/creature parsers
  randomtables/           Table validation, save/copy, creature add
  transfers/              Atomic item and coin transfers
  recordupdate/           Guarded/optimistic record updates
  currency/               Denomination registry and validation
  ui/                     Embedded frontend build output
src/
  App.vue                 Placeholder
  lib/                    Reusable frontend domain helpers
  main.ts                 Vue bootstrap
data/                     User-supplied source JSON; Git-ignored
pb_data/                  Test/runtime data; Git-ignored
docs/                     Design and developer documentation
scripts/                  Development, release and start helpers
```

## Commands

```sh
bun ci
bun run build             # vue-tsc + vite build into server/ui/dist
bun run typecheck
bun run dev               # Vite only
bun run dev:all [DATA]    # Go backend + Vite, default pb_data
go -C server test ./...
go -C server run . serve --http=127.0.0.1:8090 --dir=../pb_data
go -C server run . --dir=<data> catalog-import <system-key> <json>
go -C server run . --dir=<data> dnd5e-import <spells|bestiary|items> <json>
go -C server run . --dir=<data> adnd2e-import <spells|bestiary> <path> [pages]
go -C server run . --dir=<data> table-template-import <system-key> <json>
go -C server run . --dir=<data> import-vault <vault-path>
```

## Existing collections

Migrations live in `server/migrations/`; read the relevant migration for exact fields.

| Collection | Purpose |
|---|---|
| `systems` | Rulesets (`dnd5e`, `adnd2e`). |
| `profiles` | Local display labels and accent; not accounts. |
| `games` | Mechanics container: name, system, GM profile, encounter visibility. |
| `characters` | Character name, game, owner profile. |
| `catalog` | Imported items, spells, creatures; `original_json` preserves source data. |
| `inventories` | Character-carried inventory, capacity, currency balances. |
| `inventory_items` | Items with quantity, weight, notes, containers, optional catalog reference. |
| `stashes` | Party/personal/location stores with currency balances. |
| `spellbooks` / `spellbook_spells` | Character spellbooks and catalog spell references. |
| `encounters` / `encounter_creatures` | Reusable preparation groups. |
| `combats` / `combatants` | Live combat state, initiative, HP, conditions, ordering, player display flags. |
| `random_tables` | Game-owned tables with JSON entries and dice expression. |
| `table_templates` | System-scoped read-only templates, copied into games. |

Campaign-manager collections and raw tables (migrations `20261111000000`/`20261111000001`):

| Collection/table | Purpose |
|---|---|
| `campaigns` | Narrative/world continuity; `key`, `name`, description and color. |
| `entities` | World/rules/notes content: normalized `type_class`, raw `source_type`/`template`, folder, event date, JSON data/links/meta/aliases, body, campaign relations, scope and system. |
| `relation_types` | Relation key/labels/inverse labels and hierarchy flag; seeded, unknown keys auto-created by the importer. |
| `relations` | Directed entity relations; unresolved targets keep `unresolved_name`. |
| `mentions` | Body wikilinks with optional resolved target. |
| `maps` / `map_markers` | Leaflet map config/image and normalized marker coordinates. |
| `entity_paths` (raw) | Closure table for hierarchical relations; rebuilt after import/saves. |
| `entity_fts` (raw) | FTS5 index of plain-text entity name/body/type/template/folder; rebuilt after import/saves. |

Do not create one collection per world template.

## Key backend behavior

- `server/main.go`: embeds `ui`, registers migrations, adds CLI importers, custom routes:
  - `GET /api/olea/world` — one-shot snapshot of campaigns, entities, relation types, relations, mentions, maps and map markers, plus a SHA-256 revision digest; used by the frontend memory cache.
  - `GET /api/olea/search?q=&type=&campaign=&exclude=&limit=` — FTS5 server-side search fallback.
  - `GET /olea/assets/{path...}` — serve files from `<dataDir>/olea-assets/`.
  - `POST /api/olea/admin/rebuild` — rebuild `entity_paths` and `entity_fts`.
  - `/api/olea/tables/add-creature`
  - `/api/olea/tables/save`
  - `/api/olea/tables/copy`
  - `/api/olea/tables/delete`
  - `/api/olea/transfers/item`
  - `/api/olea/transfers/coins`
  - `/api/olea/records/{collection}/{id}/update`
- `vaultimport.Import`: walks the vault (skips `.obsidian`, `.trash`, `Timeline/`), parses frontmatter, normalizes types/campaigns, upserts entities by `source_path`, syncs relations/mentions, copies assets, extracts leaflet maps, rebuilds paths/FTS and prints a JSON report. Malformed frontmatter is reported and imported with folder inference.
- `world`: normalization/slugify/folder inference, name/alias resolver, relation/mention sync, asset path helpers, `RebuildPaths`, `RebuildFTS`, `Search`, `Snapshot`, and `RegisterHooks`.
- `world.RegisterHooks(app)`: entity saves sync relations/mentions and rebuild paths/FTS; entity deletes rebuild paths and remove the FTS row; relation and relation-type changes rebuild paths. Importer writes use `UnsafeWithoutHooks`.
- `catalogimport.Import`: upserts by `system/type/source/source_id`, preserves record IDs, alternate descriptions and notes on reimport.
- `randomtables`: validates dice/range overlap/references; saves and copies transactionally.
- `transfers`: atomic item/coin moves; guards containers against cycles and cross-game transfers.
- `recordupdate.Update`: guarded field updates with conflict detection; currency balances are special.
- `currency`: server-side denomination registry; the frontend `src/lib/systems.ts` registry must agree.

## Key frontend helpers

| File | Use |
|---|---|
| `src/lib/systems.ts` | Typed built-in system capability registry. |
| `src/lib/catalogFilters.ts` | Shared catalog filter definitions/matching. |
| `src/lib/catalog.ts` | Catalog types/helpers. |
| `src/lib/combatSetup.ts` | Pre-combat participant/HP resolution. |
| `src/lib/liveCombat.ts` | Live HP/initiative/damage validation. |
| `src/lib/playerEncounter.ts` | Player-view visibility/selection helpers. |
| `src/lib/encounterOrder.ts` | Initiative/manual ordering. |
| `src/lib/inventory.ts` | Inventory/container helpers. |
| `src/lib/currency.ts` | Currency types/formatting. |
| `src/lib/dice.ts` | Dice evaluation. |
| `src/lib/randomTables.ts` | Table types/validation/matching. |
| `src/lib/cardPrint*.ts`, `printCards.ts` | A4/card layout and print helpers. |

The frontend framework is Vue 3 + TypeScript + Vite + Tailwind CSS 4. The old views/components are gone; the helpers remain. No world store/UI exists yet: Batch 5 adds a Pinia world store hydrated from `GET /api/olea/world`, with in-memory indexes for browse, detail, backlinks and search; `/api/olea/search` stays as the server-side fallback.

## Conventions

- Versioned migrations; never mutate an applied migration.
- PocketBase collection rules are public for the trusted LAN.
- Keep stable record IDs; imports preserve them.
- Use transactions for multi-record operations.
- Do not commit `data/`, `pb_data/`, `poc_data/`, generated frontend output, binaries or personal content.
- Do not restore the removed frontend.
- The database/backend remains the source of truth; the PoC frontend memory cache is a frontend concern. Do not remove backend GET routes, FTS or closure tables while the UI is being built.
- Imported assets live in `<dataDir>/olea-assets/` and are served under `/olea/assets/`; images are not embedded in the snapshot.
- Use conventional commits and atomic changes; work on the implementation branch specified in the plan.
- Use Context7 for current library docs when a task depends on a library API.
- QMD MCP is available. Use it for fast semantic lookup of code/docs when it saves broad exploration; verify results in source.

## Orientation reading order

For most tasks:

1. `docs/campaign-manager-plan.md`
2. `server/main.go`
3. the migration for the collection you are touching
4. `server/world/` or `server/vaultimport/` for campaign-manager work
5. the package/helper named in the task
6. `src/lib/systems.ts` when system-specific behavior matters

Do not re-read the whole repository unless the task is genuinely cross-cutting.
