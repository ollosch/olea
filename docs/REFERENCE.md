# Olea reference

> Read this before exploring the repository. It exists so subagents do not re-analyse the whole app for every task. Verify specific files when a task depends on them, but start here.

## Current state

- Backend and domain logic are implemented and tested.
- The previous Vue UI and its browser tests were deliberately removed in commit `dbe7c65` at the owner's request. Do **not** restore them. A clean UI is being built.
- `src/App.vue` is currently a placeholder.
- `pb_data/` contains disposable test data. Do not build on it. Use a separate `poc_data/` for new work.
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

The campaign-manager plan adds generic world collections (`campaigns`, `entities`, `relation_types`, `relations`, `mentions`, `maps`, `map_markers`) and raw tables (`entity_paths`, `entity_fts`). Do not create one collection per world template.

## Key backend behavior

- `server/main.go`: embeds `ui`, registers migrations, adds CLI importers, custom routes:
  - `/api/olea/tables/add-creature`
  - `/api/olea/tables/save`
  - `/api/olea/tables/copy`
  - `/api/olea/tables/delete`
  - `/api/olea/transfers/item`
  - `/api/olea/transfers/coins`
  - `/api/olea/records/{collection}/{id}/update`
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

The frontend framework is Vue 3 + TypeScript + Vite + Tailwind CSS 4. The old views/components are gone; the helpers remain.

## Conventions

- Versioned migrations; never mutate an applied migration.
- PocketBase collection rules are public for the trusted LAN.
- Keep stable record IDs; imports preserve them.
- Use transactions for multi-record operations.
- Do not commit `data/`, `pb_data/`, `poc_data/`, generated frontend output, binaries or personal content.
- Do not restore the removed frontend.
- Use conventional commits and atomic changes; work on the implementation branch specified in the plan.
- Use Context7 for current library docs when a task depends on a library API.
- QMD MCP is available. Use it for fast semantic lookup of code/docs when it saves broad exploration; verify results in source.

## Orientation reading order

For most tasks:

1. `docs/campaign-manager-plan.md`
2. `server/main.go`
3. the migration for the collection you are touching
4. the package/helper named in the task
5. `src/lib/systems.ts` when system-specific behavior matters

Do not re-read the whole repository unless the task is genuinely cross-cutting.
