# Olea frontend — component contract

Read this file plus the actual source files in `src/` before writing code. Verify against the
real files (they are the source of truth) rather than trusting this summary blindly.

## Stack
Vue 3 (Composition API, `<script setup>`), Pinia, Vue Router, the `pocketbase` JS SDK.
**Plain JavaScript only — NO TypeScript, NO `lang="ts"`.** No external UI libraries; use the CSS
utility classes in `src/styles/base.css`.

## Data model (PocketBase collections)
All records are plain objects. Relation fields hold the related record's **id string**. When we
request with `expand`, the related record is available under `record.expand.<field>`.

- `players` (auth): `id`, `name`
- `games`: `id`, `name`, `description`
- `currencies`: `id`, `game`, `name`, `symbol`, `base_value` (int, smallest unit = 1), `sort`
- `memberships`: `id`, `game`, `player` (→players), `role` (`"gm" | "player"`)
  - fetched with `expand: "player"` → `m.expand.player.name`
- `wallets`: `id`, `membership`, `currency` (→currencies), `amount` (int)
  - fetched with `expand: "currency"`
- `items` (catalog): `id`, `game`, `name` (required), `category`, `kind`
  (`"single" | "stack" | "charges"`), `max_charges`, `weight`, `value`, `value_currency`,
  `description`, `image` (file)
- `inventory`: `id`, `game`, `item` (→items), `owner` (→players), `quantity` (int, stack kind),
  `charges_current` (int, charges kind)
  - fetched with `expand: "item"` → `e.expand.item` gives name/kind/weight/value etc.

Number fields default to `0` when unset — treat `0` as "not filled in" for weight/value.

## Pinia stores

### `useAuthStore()` (`src/stores/auth.js`)
- `player` (the auth record, or null), `ready`, getter `isAuthed`
- actions: `init()`, `login(name)`, `logout()`

### `useGameStore()` (`src/stores/game.js`) — the main store. USE THIS, do not fetch data yourself.
State: `games`, `activeGame` (full game record), `currencies`, `members`, `items`, `inventory`,
`wallets`, `loading`.

Getters:
- `myPlayerId`, `myMembership`, `role` (`"gm"|"player"|null`), `isGM`
- `currencyMap` (id → currency), `itemMap` (id → item), `categories` (sorted unique names)
- `inventoryFor(playerId)` → array of inventory entries (each has `expand.item`)
- `walletFor(playerId)` → `{ raw, amounts, total, optimized }`
  - `amounts` = `{ currencyId: integer }`
  - `total` = value in base units
  - `optimized` = `[{ currency, amount }]` fewest-coins breakdown (use for the "optimized total")

Actions (all already exist — call them, they handle API + realtime refetch):
- `loadGames()`, `createGame({ name, description?, currencies: [...] })`
- `addMember(playerName, role)`, `removeMember(membershipId)`, `setRole(membershipId, role)`
- `createItem(data)`, `updateItem(id, data)`, `deleteItem(id)` — `data` is an object of item
  fields (exclude `game`; it is added automatically). For images, `data` should be a `FormData`
  with the field `image` (see ItemsPanel note below).
- `giveItem({ itemId?, toPlayerId, quantity? })` OR `giveItem({ inventoryId?, toPlayerId, quantity? })`
  - GM grants a catalog item: `{ itemId, toPlayerId, quantity? }` (quantity only for stack items)
  - transfer an existing entry: `{ inventoryId, toPlayerId, quantity? }` (quantity only for stacks)
- `useItem(inventoryId)`, `dropItem(inventoryId)`
- `giveMoney(toPlayerId, currencyId, amount)`, `gmMoney(playerId, currencyId, amount)`
  (amount may be negative for GM taking money)

All mutations are reflected automatically via realtime subscriptions — no need to refetch after
an action, but you may `await` the action then close a dialog.

## Custom API module (`src/api.js`)
Not needed directly — prefer the store actions above.

## Shared helpers
- `src/utils/money.js`: `walletTotal(amounts, currencies)`, `optimizeAmounts(amounts, currencies)`,
  `currencyLabel(c)` (returns `symbol || name`), `formatAmount(amount, currency)`
- `src/utils/errors.js`: `errorMessage(err)` — returns a human-readable string from any error.
- `src/composables/useToast.js`: `const { show } = useToast()` then `show("message")`. A global
  `<Toast />` is already mounted in `App.vue`.

## Item kinds (display rules)
- `single`: show no quantity/charges, just the name.
- `stack`: show `quantity` (e.g. "×5").
- `charges`: show `charges_current` / `max_charges` (e.g. "4/5 charges").

## CSS conventions (`src/styles/base.css`)
Available classes: `.page`, `.page.wide`, `.card`, `.row`, `.grow`, `.field`, `.list`,
`.list-item`, `.muted`, `.small`, `.error`, `.tabs`, `.tab`, `.tab.active`, `.modal-backdrop`,
`.modal`, `.toast`, `.no-print`, `.print-sheet`. Buttons: default, `.primary`, `.danger`,
`.ghost`. Use these; do not invent a new CSS framework. Layout is mobile-first; the `.page.wide`
max-width (1100px) handles desktop. Scoped `<style>` is fine for component-specific tweaks.

## Conventions
- One `.vue` file per component in `src/components/` (or `src/views/` for route views).
- `<script setup>` with imports; no TypeScript; no comments unless genuinely necessary.
- Handle errors: wrap action calls in `try/catch`, show `errorMessage(err)` (inline `.error`
  text or a toast).
- Use `v-model` for forms; disable buttons while an async action is in flight.
- Never hard-code a player id; always derive from the stores.
- Mobile: actions should be thumb-friendly (big buttons); the GM's laptop view should use more
  horizontal space (the `.page.wide` container already does this).
