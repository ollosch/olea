# 03 — Boot, HTTP and realtime

## Learning goals

Trace server startup, a normal PocketBase collection call, a custom transaction, and realtime updates. Understand which constraints come from schema, request hooks, frontend logic or Go domain functions.

## The short version

`server/main.go` creates an embedded PocketBase app, registers a balance-protection request hook, migration support, CLI commands and custom routes, configures embedded frontend serving and starts the app. A browser can call normal `/api/collections/...` endpoints through the PocketBase SDK; custom `/api/olea/...` endpoints bind JSON and call Go packages. The current deployment is trusted-LAN and does not add game authorization to these operations.

## Startup

1. `main` finds `os.UserConfigDir()` and uses its `Olea` child as the default data directory. With no arguments, it appends `serve --http=0.0.0.0:8090`; explicit flags/commands are handled by PocketBase/Cobra.
2. `pocketbase.NewWithConfig` constructs the app. `_ "olea/migrations"` causes migration registration during package initialization. `migratecmd.MustRegister` adds migration commands.
3. Hooks and Cobra commands are registered before `app.Start()`. Imports explicitly call `RunAppMigrations()` before operating; normal serving applies registered migrations at startup as described in the project README.
4. `//go:embed all:ui` embeds the `server/ui` tree at compile time. `vite.config.ts` builds the frontend into `server/ui/dist`. The `OnServe` callback requires `ui/dist/index.html`, serves embedded files, and routes `/` to `/games`; SPA fallback is enabled by `apis.Static(public, true)`.
5. A separate `OnServe` hook binds the listener, prints the data directory and detected addresses, and calls `e.Next()`. Explicit HTTP address/port can override the default.

The source contains a placeholder to make a Go build possible before building the frontend, but the server reports an error on serve if `ui/dist/index.html` is missing. Build assets **before** building the production Go executable; embedding is compile-time. In development Vite proxies `/api` and `/_/` to the server (`vite.config.ts`).

## Ordinary collection request

Example: the game list in `src/views/GamesView.vue` calls:

```ts
pb.collection('games').getFullList({ sort: 'name', expand: 'system' })
```

`src/lib/pocketbase.ts` constructs the SDK client. PocketBase handles its collection endpoint, rule evaluation, filtering/expansion, schema validation and persistence. The `games` schema comes from migrations; many collections call `setPublicRules`, which sets empty public rules. The client receives records and expanded relations. These records are not Laravel models with project-owned controllers or resource classes.

There is a request hook specifically for `inventories` and `stashes`: `protectBalances` checks the request body and rejects direct create/update of `balances` and legacy denomination fields. It calls `e.Next()` to continue the framework hook chain. Internal Go saves performed through domain functions are a different path from those client record requests; the guarded and transfer endpoints enforce their own rules.

## Custom request: guarded update

`src/lib/records.ts` supplies `guardedUpdate(collection, snapshot, fields)`:

1. It checks frontend field allowlists and constructs `expected` from the saved snapshot. For inventory items it also includes inventory and stash, to detect movement.
2. It sends `POST /api/olea/records/{collection}/{id}/update` with `{ expected, fields }`.
3. The handler in `server/main.go` binds JSON and calls `recordupdate.Update(re.App, ...)`. It returns 409 for `ErrConflict`, 400 for other errors, and 204 for success.
4. `server/recordupdate/update.go` independently validates collection/field allowlists and required expected fields. Inside a transaction it loads the record, compares all supplied expected fields, checks currency constraints if relevant, then saves.
5. The view handles a conflict by refreshing authoritative values and notifying the user. Different views currently have different draft behavior; inspect the caller before assuming drafts survive.

This is compare-and-update, not a universal version check. `VersionedRecord` includes `updated`, but this implementation compares an explicit set of fields; `updated` is not used as a revision token. The frontend helper sends all configured conflict fields, while the backend checks the expected keys it is given and requires an expected value for each field being written. Protecting a new field requires coordinating **both** allowlists and deciding what must be compared.

## Custom request: transfer

`InventoryView.vue` posts an item ID, quantity and destination to `/api/olea/transfers/item`. The handler binds `transfers.ItemRequest`, calls `transfers.Item`, returns 204 on success and a bad-request response on error. In one transaction `Item` loads the item and both stores, verifies same-game ownership and quantity/containment constraints, then moves or splits the item. For a container, `moveContents` recursively updates descendants. Currency uses a separate atomic transfer endpoint. See the complete flow in [05](05-journeys-and-recipes.md).

These are domain consistency checks, not caller authorization. The current route handlers do not verify a user or game membership. If online access is added, a custom route must check the caller and every affected source/destination even if collection API rules are also tightened.

## Realtime and reconnection

`InventoryView.vue`, `GameEncountersView.vue` and `PlayerEncounterView.vue` subscribe to relevant collections using `pb.collection(...).subscribe('*', callback)`. The callbacks reload affected data; they are not client-side transactions and can receive multiple events. Views unsubscribe on unmount and re-subscribe on reconnect/focus. `App.vue` checks health on startup, online, focus and visibility changes and emits `olea-reconnected` after a successful check.

Current behavior is not a full offline-first app: no queued writes or local database sync is described. A disconnected browser can display old information until it refreshes; a failed write should not be assumed committed. Inventory preserves certain active edit snapshots. Combat has its own draft-refresh logic. The player view calls its full `load()` on every event, setting `loading` and potentially changing the layout. These differences matter for UX work.

## Status and errors

The custom endpoints use JSON or 204 on success. Examples: table save/copy returns 200 with `{ id }`, update and transfers return 204, invalid input returns 400, stale guarded update returns 409. This is the current Olea implementation, not a promise that every PocketBase endpoint uses identical statuses. Errors can be translated by the frontend (`isConflict`, `transferError`). Never rely solely on a screen message as proof of which server check ran.

## Checkpoint

You hide the “Transfer coins” button for a player. Can that player still invoke the endpoint directly?

**Suggested answer:** On the current trusted-LAN system, yes: the hidden button does not authenticate or authorize an HTTP request, and the custom handler does not check membership. Its same-game and balance checks protect consistency, not access.

Next: [04 — Imports and migrations](04-imports-and-migrations.md).
