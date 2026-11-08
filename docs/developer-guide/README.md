# Olea — Go and server learning guide

This is a human learning guide for an experienced programmer who knows Vue, Java, C/C++ and SML but is new to Go. It is inspired by the structure of the Olgur developer guide: read the explanation, open the real code, trace a journey, then try the checkpoint. This is a snapshot of the working tree reviewed on 2026-11-08, including local changes. If this guide and the code disagree, the code wins.

The goal is to make you productive reading and changing Olea's server, not to replace the Go language specification or PocketBase documentation. Olea evolves, and PocketBase is still pre-1.0; check the versions in `server/go.mod` and `package.json` when consulting external documentation.

## The one-minute picture

Olea is a local-network TTRPG companion. A Vue app runs in a browser. A Go executable embeds PocketBase, which uses SQLite for persistent data, exposes collection APIs and realtime subscriptions, and serves the built Vue app. Olea adds Go code for imports and operations that need transactional validation. Browsers talk to that one local server; no internet is required at runtime.

```text
Host machine                       Other devices on trusted LAN
┌─────────────────────────────┐    ┌──────────────────────────┐
│ Olea Go executable          │    │ Browser: Vue app         │
│  PocketBase API + realtime  │◄───┤ HTTP + subscriptions     │
│  custom /api/olea/* routes  │    └──────────────────────────┘
│  embedded frontend assets   │
│  imports / migrations       │
└──────────────┬──────────────┘
               │
     PocketBase data directory
     SQLite + files + metadata
```

The server does not bundle reference content. The host can import local material. `profiles` are local labels, not authenticated users. The app is designed for a trusted LAN: collection rules are publicly accessible and player-display settings are UI presentation, not security boundaries.

## Reading paths

| Your goal | Read |
|---|---|
| One-hour orientation | This page, [02 — Domain and storage](02-domain-and-storage.md), then the journeys in [05](05-journeys-and-recipes.md) |
| Learn Go from the code | [01 — Go for experienced programmers](01-go-for-experienced-programmers.md), then open the code examples it names |
| Change an API operation | [02](02-domain-and-storage.md), [03 — Boot and requests](03-boot-and-requests.md), [05](05-journeys-and-recipes.md) |
| Understand reference content | [04 — Imports and migrations](04-imports-and-migrations.md), then the import journey in [05](05-journeys-and-recipes.md) |
| Consider online access | [06 — Online deployment](06-online-deployment.md) |
| Full course | Read chapters 01–06 in order |

## Repository map

```text
server/
  main.go              entry point; PocketBase setup, hooks, CLI commands, HTTP routes
  go.mod, go.sum       Go module, versions and integrity records
  migrations/          versioned schema/data changes and upgrade tests
  catalogimport/       neutral catalog format, validation, transactional upsert
  dnd5eimport/         5e spell, creature and item source adapters
  adnd2eimport/        2e spell and creature source adapters
  randomtables/        validation, table operations, template import
  transfers/           transactional item and currency movement
  currency/            server-side denomination and balance rules
  recordupdate/        guarded compare-and-update implementation
  encounters/          encounter integration tests
  spellbooks/          spellbook integration tests
  ui/                  embedded frontend placeholder and generated ui/dist
src/
  views/               screens, currently also much of the client orchestration
  components/          shared controls and print components
  lib/                 PocketBase client, system rules, guarded updates and helpers
  router.ts            client-side routes
e2e/                   disposable-database Playwright tests and fixtures
```

`server/encounters/` and `server/spellbooks/` currently contain tests, not separate production services; much encounter logic is in `src/views/GameEncountersView.vue`. Do not assume a server package exists just because a feature does.

## Five ideas to retain

1. **PocketBase provides ordinary collection CRUD.** There is no Laravel-style controller per collection in this repository. Schemas and access rules are created by Go migrations; the Vue client calls the PocketBase SDK.
2. **Olea adds custom endpoints for some invariants.** `server/main.go` binds a request and delegates to packages such as `transfers` and `recordupdate`. Not every write goes through these endpoints.
3. **A transaction belongs around a multi-record invariant.** In `transfers.Item`, source and destination are validated and changed using the transaction's `tx`, not the original `app`.
4. **Imported content has two identities.** Stable source identity (`system`, `type`, `source`, `source_id`) finds an existing catalog record on reimport; the PocketBase `id` is the record relation used by other collections.
5. **UI restrictions aren't authorization.** The server currently assumes trusted LAN participants. A screen that hides a button or enemy name does not prevent an API client from reading or writing records.

## Study routine

For each chapter, read the short version, follow the named files in an editor, and answer the checkpoint before reading the suggested answer. Experiment with synthetic data in a disposable directory; do not experiment with your real `pb_data/`. Commands in this guide are run from the repository root unless stated otherwise.

Next: [01 — Go for experienced programmers](01-go-for-experienced-programmers.md).
