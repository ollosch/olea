# 04 — Imports, migrations and data preservation

## Learning goals

Follow content from a host file into the catalog, explain why reimport works, and understand how schema upgrades differ from recreating a database.

## The short version

An import is an explicit host command, not a server-side download. Source-specific parsers produce a neutral `catalogimport.Document`; the neutral importer writes it transactionally by stable source identity. Original content is retained alongside normalized columns and user edits. Versioned Go migrations create and upgrade PocketBase collections, and PocketBase records which migrations ran. The real data directory is separate from the executable.

## The import pipeline

```text
local source file(s)
    │
    ├─ neutral JSON ───────────────> catalogimport.Parse
    ├─ 5e JSON ───────────────────> dnd5eimport.ParseSpells/Bestiary/Items
    └─ 2e JSON or saved directory ─> adnd2eimport.ParseSpells/Creatures
                                      │
                           catalogimport.Document + warnings
                                      │
                         catalogimport.Import (transaction)
                                      │
                       catalog rows + original source JSON
```

In `server/main.go`, the CLI commands run migrations, open files, defer their close, call a parser and then `catalogimport.Import`; they print counts/warnings as JSON. The neutral `catalog-import` command uses `catalogimport.Parse` with `DisallowUnknownFields`, required fields, valid original JSON and duplicate-in-document identity checks. Source adapters produce the same document shape from their own formats; do not assume every validation done by `Parse` is automatically rerun by `Import` on documents built by adapters. Read the relevant adapter and its tests.

### A 5e spell example

`dnd5eimport.ParseSpells` expects a JSON root containing a `spell` array. For each raw spell it decodes selected fields, requires a name, source, level and school, converts known school codes to names and preserves the raw JSON in `Original`. Invalid records are skipped with warnings; if no valid spells remain the parser returns an error. It uses the spell name as `SourceID` for this format. See `server/dnd5eimport/spells.go` and its test for actual edge cases.

### A 2e example

`adnd2eimport.ParseSpells` joins a spell index and pages by page ID, detects duplicates/missing pages, extracts available wiki infobox fields and keeps wikitext in the original JSON. The creature adapter reads saved local site material. Parsing incomplete or complicated source data can leave warnings or require consulting the source; it does not invent missing stats. No personal source data is in the repository.

### Upsert and transaction

`catalogimport.Import` opens `RunInTransaction` and delegates to `importRecords`. It looks up the system by stable key and searches for `(system,type,source,source_id)`. New identities make new records; existing records keep their PocketBase ID. It stores normalized fields and original JSON, and explicitly carries forward `alternate_description` and `notes`. Any error returns from the transaction callback, rolling the import back. The unique catalog index protects the identity in the database.

`randomtables.Import` is a related but distinct pipeline: it imports system templates identified by system/source/source_id and resolves catalog references by their stable source identity. It validates all templates inside a transaction. A copied game table is independent of its template; updating the template does not update copies.

## Migrations: what's really running

Every migration file is in `package migrations`, defines `init()`, and calls `m.Register(up, down)`. The import in `main.go` initializes the package and registers these functions. PocketBase maintains applied migration history in the data directory. A fresh directory runs all migrations; an existing one runs only pending migrations. Inspect the complete sequence: `20261031000012_combat_upgrade.go`, for example, accounts for databases where an earlier encounter migration had already run without the later live-combat collections.

An applied migration is not automatically replayed just because its file is edited. Add a new migration for a schema or data change, then test a fresh install **and** an upgrade from populated older data plus restart. Down functions exist, but do not assume every downgrade recovers information lost by an upgrade. `20261031000016_currency_balances.go` is a deliberate one-way data migration: old balance columns remain as a snapshot while the JSON balances become authoritative.

Useful tests include `server/migrations/upgrade_integration_test.go`, `backup_restore_test.go`, `currency_balances_test.go`, and `combat_active_participant_test.go`. `go -C server test ./migrations` exercises this package; `go -C server test ./...` covers all backend packages. Read test setup to understand exactly which old state is simulated.

## Build, data and backup

`npm run build` emits `server/ui/dist`, then `go -C server build` embeds those files in the executable. The database is **not** embedded. `pb_data/`, `data/`, generated assets and binaries are Git-ignored. Default runtime data is in the OS user configuration `Olea` directory unless `--dir` overrides it. The complete PocketBase data directory contains the SQLite database and other files/metadata; use the README's stop-server, copy-whole-directory and restore-to-a-new-location procedure.

A server rebuild does not itself delete the database. A new empty `--dir` is a fresh database, not an upgrade. For experiments, choose a disposable path and inspect it before running anything; never point tests/import experiments at the owner's `pb_data/`.

## Checkpoint

Why is deleting the importer after a one-time import not obviously simplification?

**Suggested answer:** It would remove working format parsing, diagnostics and the ability to add or refresh source data without destroying IDs or user edits. It would not remove the need for backups or migrations. A future simplification should be based on actual maintenance and tested against existing catalog relations and identities.

Next: [05 — Journeys and recipes](05-journeys-and-recipes.md).
