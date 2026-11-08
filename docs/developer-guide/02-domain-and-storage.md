# 02 — Domain and storage

## Learning goals

Understand the entities, why catalog identity matters, how preparation differs from combat, and where database guarantees stop. Be able to predict what data a screen needs and what a deletion or reimport can affect.

## The short version

PocketBase collections act like typed tables with built-in IDs, CRUD and relation fields. Versioned migrations define the schema. `systems` identify rulesets; `games` select a system and have `characters`; catalog records contain imported system reference content. Character inventories, stashes, spellbooks, prepared encounters, live combats and random tables refer to those entities. The browser handles much of the presentation and game-system interpretation; server transactions protect selected multi-record operations.

```text
systems ──< catalog (system, type, source, source_id)
   │              ▲       ▲                 ▲
   └──< games      │       │                 │
         ├──< characters  │                 │
         │      ├── inventories ──< inventory_items
         │      └── spellbooks ──< spellbook_spells
         ├──< stashes ──< inventory_items
         ├──< encounters ──< encounter_creatures
         │        └──< combats ──< combatants
         └──< random_tables (entries can refer to catalog or encounters)
```

Arrows are conceptual, not a complete schema diagram. Relations live on the child, and later migrations modify earlier definitions. Inspect all relevant migrations before concluding how the current schema behaves.

## Main entities

| Entity | Meaning and important distinction | Where to read |
|---|---|---|
| `systems` | Stable `key` identifies built-in rules; a game has one system. | `20261031000000_initial_schema.go`, `20261031000014_adnd2e.go`, `src/lib/systems.ts` |
| `profiles` | Name and accent, used for GM assignment or character ownership. **Not a login.** | initial schema, `20261031000001_profile_accent.go` |
| `games`, `characters` | A game groups a party and chooses a system; characters can have a profile owner. | initial schema, `src/views/GameCharactersView.vue` |
| `catalog` | Imported spell/item/creature, normalized fields plus original JSON, alternate description and notes. | `20261031000002_catalog.go` and later catalog migrations |
| `inventories`, `stashes`, `inventory_items` | Character-carried inventory and party/personal/location stores; items may have containers, quantities, weight and catalog references. | `20261031000005_inventory.go`–`20261031000008_stashes.go`, `20261031000016_currency_balances.go` |
| `spellbooks`, `spellbook_spells` | Named character collections; join record links a book to a catalog spell. | `20261031000009_spellbooks.go` |
| `encounters`, `encounter_creatures` | Reusable preparation group and creature/custom entries with quantity and notes. | `20261031000011_encounters.go` |
| `combats`, `combatants` | Live instances with independently stored HP, initiative, conditions, turn and active participant. | encounter migrations 11, 12 and 15; `src/views/GameEncountersView.vue` |
| `random_tables`, `table_templates` | Game-specific editable tables and imported system templates that can be copied into games. | `20261031000013_random_tables.go`, `server/randomtables/tables.go` |

## Source identity versus record identity

The catalog has a unique index on `(system,type,source,source_id)` in `server/migrations/20261031000002_catalog.go`. This tuple is the import identity. On reimport `server/catalogimport/import.go` finds the existing row and updates imported fields while retaining its PocketBase ID, `alternate_description` and `notes`. Those existing IDs are used by relationships, e.g. `spellbook_spells.spell` and `inventory_items.catalog_item`.

Same names are not reliable IDs. Two sources can contain the same name; the AD&D spell importer uses page IDs, whereas `dnd5eimport.ParseSpells` currently uses the source spell name as `SourceID`. A rename of a source-derived identifier can therefore produce a new identity unless the adapter has a migration strategy. Keep the whole backed-up data directory to retain IDs and user edits: reimporting into a fresh database will create fresh PocketBase IDs and will not reconstruct the campaign.

`original_json` preserves source data beyond normalized fields. It is not necessarily a simple uniform schema: 5e JSON and AD&D wikitext/HTML are different shapes. `src/lib/systems.ts` and related helpers interpret it for catalog display, encounters and cards. Unknown systems deliberately fall back to neutral/manual behavior.

## Inventory, balances and containment

`inventory_items` can refer to an inventory or stash; container relationships were added after the initial migration. `server/transfers/transfers.go` resolves both stores, checks that they belong to the same game, handles split quantities, and moves a container's contents when moving the whole container. Parent/descendant checks prevent cycles. Some validation also exists in the frontend; do not assume every client-only rule is automatically server-enforced.

The current authoritative balances are denomination-keyed JSON in `balances` on inventories and stashes. Migration `20261031000016_currency_balances.go` copies legacy columns; those columns are historical snapshots, not the live source. `currency.Decode` validates safe nonnegative integer balances; the registry in `server/currency/currency.go` says which denominations can change for a game system. UI labels/weight live in `src/lib/systems.ts` and `src/lib/currency.ts`, so the two registries must agree. AD&D/unknown systems have no verified currency rules; unknown is not the same as zero.

## Preparation is not live combat

An `encounter_creatures` record says, for example, “three of this creature with these notes.” Starting combat in `GameEncountersView.vue` creates a `combats` record and individual `combatants`, copying names and initial notes. Live changes do not modify the preparation entry. Character participants are added separately. Current start is a series of client requests with attempted cleanup on failure, not a single server transaction.

Order uses `src/lib/encounterOrder.ts` and capabilities in `src/lib/systems.ts`: 5e sorts initiative descending, while AD&D/unknown systems have manual ordering. `active_participant` is stored independently of the visible index so reordering does not automatically change whose turn it is. Player display settings are on `games` and used by `PlayerEncounterView.vue`; these are UI filtering, not server-enforced confidentiality.

## Schema and lifecycle caveats

`server/migrations/20261031000010_owned_records.go` enables cascade deletion for several owned relations; encounter cascade behavior is adjusted by later migrations. Follow the migrations through the latest one and read upgrade tests before relying on an old definition. `setPublicRules` in the initial migration gives public CRUD rules to many collections: that is an intentional trusted-LAN assumption, not user authorization.

An index can enforce uniqueness or speed lookup, but the schema does not necessarily enforce every business rule. For example, UI code checks for an active combat in the game before starting; the separate check and create are not an atomic global uniqueness guarantee. Likewise, don't assume form validation protects a custom endpoint or direct collection API.

## Checkpoint

You import a spell, add it to a spellbook, edit its alternate description, then reimport the same source identity. What must remain stable?

**Suggested answer:** The existing catalog row's PocketBase ID, the `spellbook_spells` reference, and the alternate description; imported source fields can be updated. This follows the identity lookup and explicit preservation in `catalogimport.Import`. A backup of the full database remains essential.

Next: [03 — Boot and requests](03-boot-and-requests.md).
