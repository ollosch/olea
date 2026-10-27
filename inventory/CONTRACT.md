# Olea inventory — component contract

Read this file plus the actual source files in `src/` before writing code. The source files are the
source of truth.

## Stack

Vue 3 (Composition API, `<script setup>`), Pinia, Vue Router, the `pocketbase` JS SDK.
**Plain JavaScript only — NO TypeScript, NO `lang="ts"`.** No external UI libraries; use the CSS
utility classes in `src/styles/base.css`.

## Concepts

- **System** — a shared catalog of currencies and items (e.g. D&D 5e). Systems are global: every
  game references one system and all games using it share the catalog.
- **Global GM** — any account that is a GM in at least one game. Global GMs can create/edit any
  system, currency or catalog item.
- **Game role** — an account is `gm` or `player` per game. A GM has **no inventory and no wallet**
  in that game. The same account can be a player in another game.
- **Location** — items and money are either `person` (pocket/carried) or `stash`. Transfers always
  arrive on `person`.

## Data model (PocketBase collections)

All records are plain objects. Relation fields hold the related record's id string. With `expand`,
the related record is under `record.expand.<field>`.

- `players` (auth): `id`, `name`
- `systems`: `id`, `name`, `description`, `weight_unit` (`lb | kg`)
- `games`: `id`, `system` (→systems), `name`, `description`
- `currencies`: `id`, `system` (→systems), `name`, `symbol`, `base_value` (int, smallest unit = 1),
  `sort`
- `memberships`: `id`, `game`, `player` (→players), `role` (`gm | player`)
  - fetched with `expand: "player"` → `m.expand.player.name`
- `wallets`: `id`, `game`, `membership`, `currency` (→currencies), `amount` (int),
  `location` (`person | stash`)
  - fetched with `expand: "currency"`
- `items` (system catalog): `id`, `system`, `name`, `category`, `kind`
  (`single | stack | charges`), `max_charges`, `weight`, `value`, `value_currency`, `description`,
  `image` (file)
- `inventory`: `id`, `game`, `item` (→items), `owner` (→players), `quantity` (stack kind),
  `charges_current` (charges kind), `location` (`person | stash`)
  - fetched with `expand: "item"`

Number fields default to `0` when unset — treat `0` as "not filled in" for weight/value.

## Pinia stores

### `useAuthStore()` (`src/stores/auth.js`)

- `player` (auth record or null), `ready`, getter `isAuthed`
- actions: `init()`, `login(name)`, `logout()`

### `useGameStore()` (`src/stores/game.js`) — use this, do not fetch data yourself

State: `games`, `activeGame`, `system`, `systems`, `currencies`, `members`, `items`, `inventory`,
`wallets`, `loading`.

- `games` entries are game records plus `role`, `membershipId`, `system`.
- `system` is the active system (from a game or opened directly); `systems` is the systems list.
- `currencies` / `items` belong to the active system.
- `members` / `inventory` / `wallets` belong to the active game.

Getters:

- `myPlayerId`, `myMembership`, `role` (`"gm" | "player" | null`), `isGM`
- `isGlobalGM` — true when the account is GM in at least one loaded game
- `currencyMap` (id → currency), `itemMap` (id → item), `categories` (sorted unique names)
- `players` / `gms` — memberships filtered by role
- `inventoryFor(playerId, location?)` → inventory entries (each has `expand.item`); omit
  `location` for both
- `walletFor(playerId)` → `{ person, stash }` where each part is
  `{ raw, amounts, total, optimized }`
  - `amounts` = `{ currencyId: integer }`
  - `total` = value in base units
  - `optimized` = `[{ currency, amount }]` fewest-coins breakdown

Actions (all handle API + realtime refetch):

Game flows:

- `loadGames()`, `openGame(gameId)`, `closeGame()`
- `createGame({ name, description?, systemId })` **or**
  `createGame({ name, description?, newSystem: { name, description?, weight_unit?, currencies, items? } })`
- `deleteGame(gameId)` — GM only; cascades memberships/wallets/inventory, keeps the system

Systems (global GM):

- `loadSystems()`, `openSystem(systemId)`, `closeSystem()`
- `createSystem({ name, description?, weight_unit? })`, `updateSystem(id, data)`,
  `deleteSystem(id)` (blocked while a game uses it)
- `createCurrency(data)`, `updateCurrency(id, data)`, `deleteCurrency(id)`
- `importSystem(systemId, { currencies?, items? })` — JSON upsert by currency name and item name

Catalog items (global GM; `system` is added automatically):

- `createItem(data)`, `updateItem(id, data)`, `deleteItem(id)`
- For images pass a `FormData` with the field `image`.

Members (GM):

- `addMember(playerName, role)`, `removeMember(membershipId)`, `setRole(membershipId, role)`

Inventory:

- `giveItem({ itemId, toPlayerId, quantity? })` — GM grants a catalog item
- `giveItem({ inventoryId, toPlayerId, quantity? })` — owner/GM transfers an existing entry;
  `quantity` only for stacks
- `useItem(inventoryId)`, `dropItem(inventoryId)` — drop is also the GM "take" action
- `moveItem(inventoryId, location)` — owner only; `location` is `"person" | "stash"`

Money:

- `giveMoney(toPlayerId, currencyId, amount, location = 'person')` — player transfer; source
  location optional, destination is always person
- `gmMoney(playerId, currencyId, amount, location = 'person')` — amount may be negative
- `moveMoney(currencyId, amount, from, to)` — player moves own money between person/stash

All mutations are reflected via realtime subscriptions — no need to refetch after an action, but
you may `await` the action then close a dialog.

## Custom API module (`src/api.js`)

Not needed directly — prefer the store actions above.

## Shared helpers

- `src/utils/money.js`: `walletTotal(amounts, currencies)`, `optimizeAmounts(amounts, currencies)`,
  `currencyLabel(c)` (returns `symbol || name`), `formatAmount(amount, currency)`
- `src/utils/weight.js`: `entryWeight(entry)` (weight × quantity for stacks), `totalWeight(entries)`,
  `formatWeight(value, unit)`
- `src/utils/errors.js`: `errorMessage(err)` — human-readable string from any error
- `src/composables/useToast.js`: `const { show } = useToast()` then `show("message")`. A global
  `<Toast />` is mounted in `App.vue`.

## Display rules

- `single`: show no quantity/charges, just the name.
- `stack`: show `quantity` (e.g. "×5"); weight is `item.weight * quantity`.
- `charges`: show `charges_current / max_charges` (e.g. "4/5 charges"); weight counts once.
- Show weight with `system.weight_unit` (`lb` or `kg`).
- GMs have no inventory/wallet: never show a GM's own inventory or wallet.
- Give recipients are **players only**, never GMs.
- Editing a catalog item or currency affects every game using the system — show a notice.

## CSS conventions (`src/styles/base.css`)

Available classes: `.page`, `.page.wide`, `.card`, `.row`, `.grow`, `.field`, `.list`,
`.list-item`, `.muted`, `.small`, `.error`, `.tabs`, `.tab`, `.tab.active`, `.modal-backdrop`,
`.modal`, `.toast`, `.no-print`, `.print-sheet`. Buttons: default, `.primary`, `.danger`, `.ghost`.
Use these; do not invent a new CSS framework. Layout is mobile-first; `.page.wide` (1100px) handles
desktop. Scoped `<style>` is fine for component-specific tweaks.

## Conventions

- One `.vue` file per component in `src/components/` (or `src/views/` for route views).
- `<script setup>` with imports; no TypeScript; no comments unless genuinely necessary.
- Handle errors: wrap action calls in `try/catch`, show `errorMessage(err)` (inline `.error` text or
  a toast).
- Use `v-model` for forms; disable buttons while an async action is in flight.
- Never hard-code a player id; always derive from the stores.
- Mobile: actions should be thumb-friendly; the GM's laptop view should use more horizontal space.
