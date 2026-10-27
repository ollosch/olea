# Inventory app — implementation plan / handoff

> Use this file to resume work. The backend schema/hooks were rewritten for the new model, but the
> frontend has **not** been updated yet and the dev database has **not** been reset. The app is not
> usable in its current intermediate state.

IMPORTANT: USE SUBAGENTS TO IMPLEMENT FEATURES OR GATHER INFORMATION. KEEP THIS MAIN CONTEXT WINDOW SMALL. WE ONLY HAVE 100k tokens!!!!

Also do NOT migrate any data. The app is NOT live yet. All data can be deleted.

## Status right now

- Branch: `redesign`
- Work already changed:
  - `inventory/pb_migrations/1791200000_init.js` — rewritten for systems, shared catalogs and stash.
  - `inventory/pb_hooks/utils.js` — rewritten helpers (roles, wallets by location, system import).
  - `inventory/pb_hooks/main.pb.js` — rewritten routes/hooks (game delete, systems, stash, roles).
  - The temporary `1793099500_created_updated_wallet_game.js` migration was deleted.
- Migration was tested on an empty temp DB (`/tmp/opencode/olea-new`) and applied cleanly.
- The rewritten API endpoints have **not** been fully end-to-end tested yet. The interrupted test
  script was going to cover: create game with inline system, add players, give/take items, stash
  moves, money transfers, permissions, cascade delete, JSON import.
- `inventory/pb_data/` still contains the old schema/data and migration history. It must be reset.
- A PocketBase dev server may still be running on port `8090` against that stale DB. Stop it before
  resetting. (It was PID 606127 at the time of writing.)
- Frontend is still the old code: game-scoped items/currencies, no systems, no stash, GM treated as
  a member with inventory/wallet.
- `inventory/CONTRACT.md` is now outdated. Update or delete it when the frontend is done.

## Decisions confirmed by the user

1. **GM-only role per game.** An account is GM or player per game. A GM in a game has no inventory
   and no wallet. The same account can be a player in another game.
2. **Live shared system catalog.** Systems own currencies and items. Games reference a system. All
   games using a system share its catalog; editing the system changes every one of those games.
3. **Systems are shared by all GMs.** Any account that is a GM in at least one game can create/edit
   any system.
4. **No per-game extra items.** All items belong to the system catalog.
5. **New Game creates a system inline** for bootstrap. A brand-new account has no GM role yet, so
   the New Game flow must be able to create the first system + game and make that account the GM.
6. **JSON import** is the bulk-loading mechanism for large system item lists.
7. **One stash per player.** Items and money have a `location`: `person` or `stash`.
8. **GM “take” deletes the instance.** There is no GM inventory/stash. Quest items are tracked in
   Obsidian and can be recreated.
9. **Weight:** per-system unit (`lb` or `kg`). Total = sum of item weight, multiplied by quantity
   for stacks. Singles/charges count once. Show total carried (on person) and stash total.
10. **Players can transfer money and any equipment to other players.** Transfers always arrive in
    the recipient’s **on-person** inventory/wallet; they can move it to their stash themselves.
11. **Deleting a game is destructive:** delete the game, memberships, wallets, inventory instances.
    Do **not** delete the system, its currencies or its items.
12. No existing database data needs to be preserved. Reset is allowed.

## Implemented schema (new)

Collections:

- `players` (auth): `name`.
- `systems`: `name` (unique), `description`, `weight_unit` (`lb|kg`).
- `games`: `system` (relation), `name`, `description`.
- `currencies`: `system` (relation), `name`, `symbol`, `base_value`, `sort`.
  Unique `(system, name)`.
- `memberships`: `game`, `player` (account), `role` (`gm|player`). Unique `(game, player)`.
- `wallets`: `game`, `membership`, `currency`, `amount`, `location` (`person|stash`).
  Unique `(membership, currency, location)`.
- `items`: `system`, `name`, `category`, `kind` (`single|stack|charges`), `max_charges`,
  `weight`, `value`, `value_currency`, `description`, `image`.
- `inventory`: `game`, `item`, `owner` (account), `quantity`, `charges_current`,
  `location` (`person|stash`).

All collections have explicit `created`/`updated` autodate fields.

Cascade behavior:
- Delete game → cascades memberships, wallets, inventory via `game`; wallets also cascade via
  membership.
- Delete system → blocked if any game uses it.
- Delete currency → blocked if wallets or catalog items reference it.
- Delete item → blocked if any inventory instance holds it.
- Items/currencies are never game-owned, so deleting a game leaves the system catalog intact.

## Implemented backend API/hooks

Routes in `inventory/pb_hooks/main.pb.js`:

- `POST /api/login` — unchanged, name-only login.
- `POST /api/games` — body either `{ name, description?, systemId }` or
  `{ name, description?, newSystem: { name, description?, weight_unit?, currencies: [], items: [] } }`.
  Creates the game + GM membership. Inline system creation bypasses the “global GM” requirement so
  a first-time account can bootstrap itself.
- `DELETE /api/games/{id}` — GM-only hard delete.
- `POST /api/members`, `DELETE /api/members/{id}`, `POST /api/members/{id}/role` — GM-only.
  - Cannot remove/demote the last GM.
  - Cannot promote a player to GM while they still hold items or money in that game.
- `POST /api/inventory/give` — GM grants a catalog item, or owner/GM transfers an existing entry.
  Recipients must be players; transfers always land on person.
- `POST /api/inventory/use` — owner only, charges only.
- `POST /api/inventory/drop` — owner or GM; this is also the GM “take” action (deletes instance).
- `POST /api/inventory/move` — owner only; `{ inventoryId, location }`.
- `POST /api/money/give` — player-to-player; optional source `location`, destination is person.
- `POST /api/money/gm` — GM adjusts a player’s money; `location` can be person/stash.
- `POST /api/money/move` — player moves own money between person/stash.
- `POST /api/systems/{id}/import` — global-GM JSON import of `{ currencies?, items? }`.

Record hooks:
- Systems/currencies/items create/update/delete require a global GM.
- System delete blocked while games use it.
- Currency delete blocked when wallets or items reference it.
- Item delete blocked while inventory holds it.
- Standard collection CRUD is used for systems/currencies/items; custom routes are used for
  games/members/inventory/money because of permission logic.

Helpers in `inventory/pb_hooks/utils.js`:
- `requireMember`, `requireGM`, `requirePlayer`, `requireGlobalGM`, `isGlobalGM`
- `findWallet` / `ensureWallet` / `adjustWallet` with `location`
- `createInventoryEntry` with `location`
- `currencyLookup`, `importSystemData`, `createSystem`
- `playerByName` still auto-creates an auth account on first login.

## Known backend TODOs / risks

- Add validation that an item’s `value_currency` belongs to the item’s `system` on
  create/update (`main.pb.js` item hooks).
- Verify `findRecordsByFilter(..., limit=0, ...)` returns all rows in this PocketBase version;
  existing code assumes it does.
- End-to-end test the API list above. Do not assume the rewritten hooks work just because the
  migration applied.
- Decide whether a game needs an edit route (name/description); only delete exists now.
- Decide whether `GET /api/collections/games` should be restricted to members. Current list/view
  rules are any authenticated account (which also leaks games the user is not in).
- System JSON import currently upserts currencies by name and items by `(system, name)`; it matches
  `value_currency` by currency id, name or symbol (case-insensitive).
- Importing a system twice is intended to be idempotent-ish, but this needs testing.

## Frontend TODO

### API / store

- `src/api.js`: add `deleteGame(id)`, `moveItem(inventoryId, location)`,
  `moveMoney({ game, currencyId, amount, from, to })`, `importSystem(systemId, data)`.
  `createGame` must accept `systemId` or `newSystem`.
- `src/stores/game.js`:
  - State: add `system`, `systems`; keep `activeGame`; `games` entries need role/membership.
  - `loadGames()`: fetch current account’s memberships with `expand: 'game.system'`, map to
    game objects with `role` and `membershipId`.
  - Getters: `players` (members where role=`player`), `gms`, `isGlobalGM`, `inventoryFor(playerId,
    location)`, `walletFor(playerId)` returning person + stash breakdowns.
  - `loadSystems()`, `openSystem(systemId)`, `closeSystem()`, currency CRUD, system CRUD.
  - `openGame()` must load the game’s system, then currencies/items filtered by `system`, and
    memberships/inventory/wallets filtered by `game`.
  - Realtime subscriptions: currencies/items by `system`, memberships/inventory/wallets by `game`.
  - `createItem`/`updateItem`/`deleteItem` must use `system`, not `game`.
  - Add stash actions: `moveItem`, `moveMoney`.
  - Add `deleteGame`.
- Add `src/utils/weight.js`:
  - entry weight = `item.weight * quantity` for stack, else `item.weight`
  - total weight for a list of entries
  - format with system unit (`lb`/`kg`)

### Views/components

- New `SystemsView` (`/systems`): list systems, create system, delete system, open system.
- New `SystemView` (`/systems/:id`): system metadata, tabs for Currencies and Items, JSON import.
  Reuse `ItemsPanel` in catalog-only mode (no Give).
- Add routes and navigation. Show “Systems” only to global GMs.
- `GamesView`:
  - Split into “Games I run” and “Games I play”.
  - Show system name and role on each card.
  - New Game modal: choose existing system or create a new one inline (name, weight unit,
    currency preset/editor, optional items JSON file). The backend requires at least one currency
    for an inline new system.
- `GameView`:
  - GM: player selector contains **players only**; tabs Inventory / Money / Members / Catalog.
    No GM inventory or wallet. Add “Delete game” with confirmation.
  - Player: Inventory / Money / Members only; selected player is self.
  - Handle no players gracefully.
- `InventoryPanel`:
  - Split into On person / Stash sections with weight totals.
  - Player actions: Use (charges, person only), Give, Move to stash/pocket, Drop.
  - GM actions: Take (delete) only; no Give here (catalog Give is used instead).
  - Recipients only include players, never GMs.
- `WalletPanel`:
  - Split into On person / Stash balances and optimized totals.
  - Player: Give money from a chosen location; move money between person/stash.
  - GM: Adjust money with a location selector.
- `MembersPanel`:
  - Separate GMs and players; show role.
  - Promotion to GM can fail if the player still holds items/money; surface that error.
- `ItemsPanel`:
  - Catalog comes from the game’s system; show a notice that edits affect every game using it.
  - Hide Give outside a game context (SystemView).
  - Give recipients are players only.
- `ItemEditorModal`: use system currencies/catalog, not game currencies.
- `PrintView`: update to new wallet shape, person/stash sections, weight totals, system unit.

## Reset and test procedure (after frontend is updated)

1. Stop the old server on `8090`.
2. Wipe the stale database (allowed; no data to preserve):
   ```bash
   rm -rf inventory/pb_data
   ```
3. Start PocketBase so the new init migration runs:
   ```bash
   ./inventory/start.sh
   ```
4. Rebuild the frontend:
   ```bash
   cd inventory && npm run build
   ```
   `pb_public/` is served by PocketBase, so the build must happen before/while the server serves it.
5. But the dev DB can instead be reset with the built-in migration check:
   ```bash
   ./inventory/pocketbase migrate up
   ```
6. End-to-end test:
   - Login as a brand-new name.
   - Create a game with an inline new system (currencies + a few items).
   - Confirm the creator is listed as GM, not as a player.
   - Create a second fresh name as a player by adding them to the game.
   - GM gives an item and money.
   - Player moves item and money to stash and back.
   - Player gives an item and money to another player; both arrive on person.
   - Player cannot create catalog items or edit systems.
   - Weight totals match item weights × quantities.
   - Delete the game; confirm memberships/wallets/inventory are gone and the system/items remain.
   - Delete the now-unused system; confirm its currencies/items are gone.
   - Import a JSON system/item list.

## Rename / restructure plan

Recommended final layout (agreed direction, confirm exact names in the new prompt):

```text
olea/
  inventory/            # renamed from inventory/
    src/                # Vue source, promoted from inventory/src
    public/
    index.html
    package.json
    package-lock.json
    vite.config.js
    pb_hooks/
    pb_migrations/
    pb_public/
    pb_data/
    pocketbase
    download-pocketbase.sh
    start.sh
  soundboard/
  start.sh
  README.md
  INVENTORY_IMPLEMENTATION_PLAN.md
```

Why: it keeps the inventory app fully self-contained next to the soundboard app, removes the
meaningless `frontend` name, and puts the PocketBase folders where they belong.

Rename steps (do this **before** frontend edits to avoid updating paths twice):
- `git mv equipment inventory` (then promote `inventory/frontend/*` into `inventory/`).
- Update `inventory/vite.config.js` `build.outDir` from `../pb_public` to `./pb_public`.
- Update `inventory/start.sh`, `inventory/download-pocketbase.sh`, root `start.sh`.
- Update `.gitignore` paths.
- Update `README.md` layout and commands.
- Update this plan’s paths.
- Update/replace `inventory/CONTRACT.md` (currently `inventory/CONTRACT.md`), which
  describes the old data model. Either delete it or rewrite it for systems/shared catalogs, GM vs
  player roles, stash locations, and the new store/actions.

## Quick reference for the next prompt

Start with something like:

> Read `INVENTORY_IMPLEMENTATION_PLAN.md`. The backend schema/hooks are already rewritten but not
> fully tested. Do the folder rename first, then update the frontend, reset the DB, rebuild, and
> test end-to-end. The old `inventory/CONTRACT.md` is obsolete.
