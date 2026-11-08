# 05 — End-to-end journeys and safe changes

## Learning goals

Read the code as a connected system instead of isolated packages. Trace real requests, understand testing boundaries and know where to make a focused change.

## Journey 1: change a combatant's HP

1. The GM opens `/games/:gameId/encounters`. `GameEncountersView.vue` loads game, encounter, active combat and combatants. It computes ordering from system capabilities and the active participant via `src/lib/encounterOrder.ts`.
2. The GM edits a draft in `combatDrafts`. `saveCombatant` validates values and builds a field object including HP, initiative, conditions and notes.
3. `guardedUpdate` in `src/lib/records.ts` builds `expected` from the saved snapshot and posts to the custom record-update endpoint.
4. `main.go` binds the body and invokes `recordupdate.Update`. Inside its transaction, the server checks the expected fields, then saves the requested fields. A mismatch becomes 409; a successful update is 204.
5. A PocketBase realtime event causes subscribed views to reload. `PlayerEncounterView.vue` uses game visibility flags and `src/lib/playerEncounter.ts` to decide what to render. Those flags are not server-side secrecy.

The current UI sends several combatant fields together, so a change elsewhere to one of the compared fields may reject an apparently unrelated edit. Guarded updates avoid silent overwrites, but do not provide automatic merge. `GameEncountersView.vue` tries to preserve live drafts on refresh; inspect conflict/error paths before changing this behavior.

## Journey 2: move a stack of items

1. `InventoryView.vue` loads a character, game, inventory, stashes and items. `ensureInventory` finds or creates an inventory. It computes allowed UI targets, but a client can send a request independently of the UI.
2. On move, `transferItem` validates the entered positive whole quantity and posts `{ itemId, quantity, destination }` to `/api/olea/transfers/item`.
3. `main.go` calls `transfers.Item`. The transaction resolves source and destination and checks same game, quantity and container constraints. When the entire stack moves, it updates the same item; for a partial stack it reduces the original and creates a new item with copied relevant fields. A whole container's descendants move with it.
4. On success the view reloads items. On failure it presents a server error where available. Other browser contexts receive updates and refresh their state.

The exact transfer rules live on the server, not just in the disabled buttons. Coin transfers separately debit and credit in a single transaction with denomination and overflow checks. See `server/transfers/transfers.go` and `transfers_test.go`.

## Journey 3: import and use a creature

1. The host chooses a data directory and runs an import command documented in `README.md`. `main.go` opens the local source and runs the proper adapter.
2. The adapter returns neutral input records and warnings. `catalogimport.Import` upserts by system/type/source/source_id while preserving user notes/alternate descriptions.
3. `CatalogView.vue` or `CatalogPicker.vue` loads catalog records for a selected system/type. `systems.ts` defines filter and display behavior; `catalogFilters.ts` matches locally.
4. An encounter entry stores the catalog record's PocketBase ID and a name/quantity. Starting combat creates live participants, interpreting supported HP/initiative data from the preserved source. Print builders use system-specific presentation, and same-name records from different sources remain distinguishable.

## Journey 4: roll a random table

1. `GameTablesView.vue` reads the game's tables/templates and can submit a table to `/api/olea/tables/save`.
2. `randomtables.Validate` checks dice syntax, limits, entries, non-overlapping inclusive ranges and reference shape. `Save` then checks game and references within a transaction: catalog references must match system/type, encounters must match game.
3. Rolling itself is currently frontend work (`src/lib/dice.ts` and `src/lib/randomTables.ts`). A user may enter a physical die result instead. No matching range is a legitimate result.
4. A creature result can be added to an encounter through `/api/olea/tables/add-creature`; `randomtables.AddCreature` checks the game, encounter and catalog creature inside a transaction.

## Recipe: add an ordinary persisted field

1. Decide ownership, default, validation, visibility, and whether current data needs a backfill.
2. Add a new registered migration under `server/migrations/`; don't edit an already-applied migration as the only upgrade mechanism. Follow the collection's existing fields and rules.
3. If the field participates in a guarded update, update both `server/recordupdate/update.go` and `src/lib/records.ts`, including comparable fields and conflict behavior. Direct SDK CRUD and guarded routes have different paths.
4. Update frontend record types, forms, display and loading/serialization as appropriate. Decide whether imports own the new field or user edits do.
5. Test fresh migration and populated upgrade/restart, write/read behavior, and meaningful stale/conflict cases. Run focused Go and UI tests, then `go -C server test ./...` and `npm run typecheck`.

## Recipe: add a multi-record operation

1. Define the invariant and validation, including missing records, same-game/system checks, concurrent changes and retries.
2. Put domain behavior in a Go package, accept `core.App`, and use `app.RunInTransaction` with **only `tx` for related reads and writes**. Return errors, don't perform HTTP response construction there.
3. Register a small `OnServe` handler in `server/main.go` to bind a request, call the domain operation and translate success/errors. Current app assumes trusted LAN; this is not a pattern for internet authorization without additional checks.
4. Call it from the Vue view; keep pending/error state and do not replay uncertain operations. Verify rollback and concurrent/stale behavior with Go tests and add an end-to-end test where the browser flow is important.

## Recipe: add or adjust an importer

1. Specify source identity and what changes when source content changes. Decide how names/renames are handled and which fields are user-owned.
2. Parse into `catalogimport.Document`; retain enough original material to support the UI and cards. Give explicit skip/warning counts; never fabricate missing values.
3. Add invented fixtures and parser tests. Test same-identity reimport, existing ID and user-edit preservation, duplicate identities and transaction rollback. Check the actual command arguments in `main.go`.
4. If new normalized fields are required, add an upgrade migration and coordinate `InputRecord`, import assignment, frontend types, system presentation and print behavior. Keep the system registry and currency registry aligned if system rules change.

## Recipe: add a built-in system capability

The complete project checklist is in the README's “Built-in system capabilities.” Briefly: add the typed frontend capability in `src/lib/systems.ts`, seed the stable system key via a new migration, register server denominations in `server/currency/currency.go`, use neutral/manual fallbacks for unverified rules, and add synthetic tests. The server registry enforces currency edits while the frontend decides display, weight and encounter behavior; changing only one causes a mismatch.

## Traps worth remembering

- **There is no general login or tenant policy.** `setPublicRules`, direct collection CRUD and custom endpoints are trusted-LAN choices.
- **A green UI test isn't a data-integrity proof.** Backend Go tests exercise transactions and upgrades; Playwright covers browser paths with disposable data. Neither proves physical devices or printer alignment.
- **Don't mutate a shared list inadvertently.** `randomtables.Validate` copies before sorting; ranges can be in the user's entered order.
- **The browser owns some domain behavior.** Combat creation, ordering and dice are not all on the server. A new client would need to respect those contracts or the logic must be moved intentionally.
- **Existing `updated` is not the guarded-update comparison.** See `src/lib/records.ts` and `server/recordupdate/update.go`.
- **Imports are not backups.** They can recover reference entries, not reconstruct campaign relations and edits.
- **A generated frontend must be built before embedding.** A stale executable can serve old assets even after editing Vue source.

## Practical checks

From the repository root:

```sh
npm run typecheck
npm run build
go -C server test ./...
npm run test:e2e
```

Use focused package/browser tests during development; the full browser suite starts disposable servers as described in `README.md`. It does not use `pb_data/`. These commands do different work; one is not a substitute for another.

## Checkpoint

You add a field to an inventory item and want a safe concurrent edit. Which parts need to agree?

**Suggested answer:** A new migration and upgrade test; `InventoryView.vue`'s type, editor and payload; frontend `conflictFields`; server `allowedFields`/`comparableFields` and any related validation; tests demonstrating successful save and stale conflict. Consider transfer splitting: `transfers.Item` copies a specific set of fields into a new stack, so decide whether the new field must be copied there too.

Next: [06 — Online deployment](06-online-deployment.md).
