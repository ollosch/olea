# Olea implementation plan

This plan is intended for a sequence of small, independent LLM sessions. Ask for **one numbered step per prompt**, for example: “Implement step 01 of `IMPLEMENTATION_PLAN.md`.” Complete steps in order unless a dependency is explicitly noted. Each step should leave the application usable and end in its own Conventional Commit.

## Instructions for each session

1. Read this plan, `README.md`, relevant code, and `git status`. Preserve unrelated work. Check current documentation when working with framework or library APIs.
2. Implement only the requested step and the smallest supporting changes it needs. Keep architecture simple; use PocketBase collections, the Vue SDK and Vue components rather than adding a second server or a generic plugin framework.
3. Use migrations for schema changes. Never edit or commit the user's `data/`, `pb_data/`, generated assets, or personal content. Use small invented fixtures for automated tests.
4. Verify the step's acceptance criteria. Run `npm run build` for frontend changes and `go -C server test ./...` for backend changes, plus targeted tests and smoke checks where appropriate. Report anything that could not be verified.
5. Review `git status`, `git diff`, and the recent commit log. Commit only the step's intended files with a concise Conventional Commit. Don't amend or force-push. If a necessary prerequisite is missing, explain the blocker rather than quietly implementing multiple steps.
6. Update the step's checkbox in this file in the same commit when its acceptance criteria are met.

## Product constraints

- The GM hosts a private instance on their computer; phones connect over the same Wi-Fi. Internet access may be used for installation and development but is not needed to run or edit the app after setup. Server availability over Wi-Fi is required for edits: disconnected client editing and sync are not in scope.
- This is a trusted table. Character selection and GM mode are convenience/UI concepts, not authentication. Players do not join games independently; characters belong to games. Don't add accounts, invitations, access-control infrastructure, or protected-item workflows. If internet hosting is ever considered, security and secret visibility must be redesigned first.
- The GM creates characters; a phone selects a character. A game has one system; a character belongs to exactly one game. The GM can also own characters. One person can have multiple characters; a character has one owner at a time and ownership is transferable.
- People/owners are lightweight local profile records for ownership, GM reassignment, and preferences, not login accounts. Player use starts with character selection, not profile selection. A GM can create profiles as needed and assign them to characters; do not make an owner profile mandatory for basic play. No game membership table is needed. A game stores its GM profile when assigned; reassignment changes that reference. Profiles and UI restrictions are not a security boundary.
- Inventories have items, nested containers, quantities, weight, and currency. Players can drop, give, or move items/coins to their personal stashes or the shared party stash. A dropped item is removed; location stashes are explicitly GM-managed and persistent. No quest-item protection. The party total includes character purses and the party stash, not personal/location stashes. Display denominations separately.
- Encounter templates can be used as disposable print groupings and for combat. Live combat tracks each participant independently. Manual initiative, HP and conditions are always available; implement system-supported rolls as conveniences. Player encounter visibility defaults to hidden and is configurable per game.
- D&D 5e is first, followed by AD&D 2e, Dolmenwood, and Land of Eem. System-specific filters and displays are required. Preserve user-written alternate descriptions across reimports. Do not distribute copyrighted reference data.
- Screens should be comfortable with desktop mouse, laptop touch, and phone touch: semantic controls, visible focus, adequate contrast, approximately 44px touch targets, responsive layouts, no hover-only critical actions. Default to dark with green accents; primary color is configurable per local profile, with a browser-local fallback before profile selection.
- The printed spell-card back contains only the large spell name. Monster printing deduplicates by creature identity and prints one card per monster type across all selected encounters. Four cards per A4 page, double-sided, with preview and legible overflow handling. Printing should also work for a single encounter.
- Random tables remain part of the product: game-created free-form tables and optional system-supplied templates, with results capable of referencing items, spells, creatures or encounters.

## Foundation and first usable game

- [x] **01 — Navigation and screen shell**
  Add Vue Router and responsive GM/player navigation. Replace the placeholder workspace with meaningful empty screens for games and character selection, leaving unavailable features clearly marked. Preserve the existing appearance dialog and connection status. Verify keyboard and touch navigation at phone and desktop widths; existing build passes.

- [x] **02 — Persistence and initial schema**
  Introduce version-controlled PocketBase Go migrations for `systems`, `games`, local `profiles`, and `characters`, including a game's system and optional GM profile and a character's required game plus optional single owner. Seed a D&D 5e system identifier only, without copyrighted content. Verify migrations on an empty data directory and on restart; describe the data directory and upgrade procedure in the README.

- [x] **03 — Game management**
  Give the GM a game list and creation/edit/delete UI with system selection. Show useful empty and error states; prevent deleting a populated game without explicit confirmation. Verify games persist after restart and remain associated with their chosen system.

- [x] **04 — GM-created characters and selection**
  Add GM character creation, rename and deletion within a game, plus a phone-friendly selection screen and character overview. Persist the selected character on the device and provide an obvious switch action. Verify a game can contain multiple characters and that selecting one does not create a user account.

- [x] **05 — Local profiles, ownership and GM reassignment**
  Add minimal GM-facing profile creation and ownership assignment/transfer, including multiple characters per profile and assigning a character to the GM. Allow changing a game's GM profile. Selecting a character on a phone must not require a separate profile login. Verify ownership and GM changes persist; explain that profiles do not secure access.

- [x] **06 — Per-person accent preferences**
  Extend the existing green-on-dark theme to save the selected accent on the active character owner's or GM's profile, with the current browser-local choice as fallback for unassigned characters. Apply the profile preference on another device after selecting that character; handle invalid values and profile changes. Verify two profiles can use different accents, including after reload. Keep the controls accessible and usable on touch.

## Catalog and system data

- [x] **07 — Catalog storage and local import plumbing**
  Add migrations and a simple import path for item, spell and creature records: stable system/type/source identity, useful query fields and original JSON. Imports are local and explicitly invoked; no network or bundled source content. Re-imports update matching records rather than duplicating them and don't delete user data. Provide an import summary and small synthetic fixtures. Verify import/reimport and offline operation.

- [x] **08 — D&D 5e spells importer**
  Import the `spell` array in `data/dnd5e_spells_phb.json`, preserving source/page, name, level, school, original entries and higher-level entries. Normalize school codes and keep unknown fields. Verify synthetic examples including cantrips and higher-level entries; manually report imported and skipped counts for the supplied file without committing its contents.

- [x] **09 — D&D 5e bestiary importer**
  Import the `monster` array from `data/dnd5e_bestiary-mm.json`, handling string/object creature type, fractional CR, source/page, HP average/formula, Dexterity, actions and original JSON. Preserve special or missing fields instead of inventing values. Verify representative synthetic cases and report actual import warnings/counts.

- [x] **10 — D&D 5e items importer**
  Import `item` records from `data/dnd5e_items.json`, retaining type, weight, value, rarity, source and entries. Resolve supported `_copy` inheritance/modifications when the base is available; report unsupported or missing references clearly and do not silently claim a complete import. Handle item groups deliberately. Verify synthetic inheritance and missing-reference cases; report actual import counts/warnings.

- [x] **11 — Readable content rendering**
  Render imported descriptions and nested entries safely, including common 5e inline tags for dice, damage, links and references. Unsupported tags should remain readable rather than disappearing; never render arbitrary source HTML unsafely. Share presentation helpers with later print layouts. Verify nested synthetic content, plain text, unknown tags and common links.

- [ ] **12 — System-specific browsing and filters**
  Add a catalog UI with search, pagination and configurable filter definitions by system and content type. Implement 5e spell level/school/source, monster type/CR/source and useful item filters; use primary source for the initial source-book filter. Sort fractional CR correctly. Ensure controls work in desktop and mobile layouts; verify combinations, empty results and filtering against synthetic records.

- [ ] **13 — Catalog detail and custom descriptions**
  Provide detail screens and editable alternate descriptions for items, spells and monsters. Keep source text accessible; prefer the alternate where present and fall back to the original. For monsters support separate at-table notes alongside structured stats. Store edits independently of imported records and verify they survive re-import and server restart.

## Inventory, stashes and spellbooks

- [ ] **14 — Inventory and catalog picker**
  Add character inventories, item instances and quantities, plus a reusable context-aware catalog picker with name search and the appropriate system filters. Allow adding, editing quantities and dropping items; dropping removes them. Preserve item-specific notes and custom items. Verify no negative quantities and that multiple characters have separate inventories.

- [ ] **15 — Containers and weight**
  Support moving items into and out of nested containers with an understandable touch UI. Prevent cycles; count container and contained-item weight exactly once. Add a manually entered carrying capacity per character and show total carried weight and whether capacity is exceeded. Handle unknown weight visibly rather than treating it as known. Verify nested containers, quantity changes and capacity boundaries.

- [ ] **16 — Currency and party totals**
  Define 5e CP, SP, EP, GP and PP and store nonnegative integer balances per inventory. Display and edit denominations individually. Count coin weight according to a documented 5e setting, and recalculate encumbrance. Show party totals from character purses plus the party stash only; don't include personal or location stashes. Verify denomination totals and coin-weight calculations.

- [ ] **17 — Stashes**
  Create one shared party stash per game, player-created personal stashes, and GM-created location stashes. Each has a name, optional location/notes, contents and coins. Ensure party stash is open to all characters; personal stashes remain distinct and location stashes are managed through the GM interface. Verify persistence and that stash contents aren't counted as carried weight.

- [ ] **18 — Atomic item and coin transfers**
  Add small PocketBase Go routes using transactions for transfers between character inventories and eligible stashes, including partial stacks, nested contents where supported, and coins. Restrict destinations to the same game as a domain invariant; check quantities and report errors. Verify a failed or concurrent transfer cannot duplicate or lose items/coins; all balances remain nonnegative. This is data integrity, not authentication.

- [ ] **19 — Spellbooks**
  Allow a character to have multiple named spellbooks. Add/remove spells via the shared filtered picker and view system-specific details and alternate descriptions. GM can manage every character's spellbooks. Avoid rules-heavy known/prepared/slot automation for now. Verify one character's changes do not affect another's collection.

## Encounters and live play

- [ ] **20 — Encounter preparation**
  Add GM create, rename, duplicate and delete operations for game encounters. Add monster types through the catalog picker, with quantity, optional notes and manual/custom participant entries. An encounter can be just a print grouping and can be deleted after printing. Verify encounters remain independent and carry their game's system.

- [ ] **21 — Individual combatants and manual tracker**
  Start an encounter with independently editable participants and per-creature current/max HP, initiative, conditions and notes. Include game characters and custom participants when the GM chooses. Implement stable order, manual tie handling, round/active turn, next/previous, reset and end. Keep preparation separate from live state so an encounter can be reused. Verify repeated creatures have independent HP and condition state.

- [ ] **22 — Dice and 5e monster HP**
  Add a bounded dice-expression evaluator sufficient for `NdM`, optional signed constant and clear invalid-input handling; no arbitrary code evaluation. For encounter monsters, offer average, individual rolls and manual HP, displaying each result before confirming. Test with deterministic injected rolls, invalid formulas and representative 5e data. Leave unsupported formulas editable manually.

- [ ] **23 — 5e initiative rolls**
  Compute a default initiative modifier from a 5e monster's Dexterity where available, allow an override, and roll individually or once for a selected group. Manual results and manual player-character initiative remain available. Verify negative modifiers, missing Dexterity, ties, group rolls and rerolls without overwriting unrelated combatants.

- [ ] **24 — Realtime and reconnect**
  Subscribe to relevant PocketBase records for the active screen, update views after GM/player edits and clean up subscriptions. On reconnect/refocus, refetch authoritative state so missed events are not mistaken for current data. Show connection state and reject/clearly surface failed writes. Verify with two browser contexts, including a deliberate disconnect/reconnect.

- [ ] **25 — Optional player encounter view**
  Add per-game settings for whether players see the active encounter, initiative, enemy names, HP and conditions; all default off. Provide an optional player-facing display that respects those settings in the normal UI. Explicitly document that these settings hide UI details but are not security controls on a trusted LAN. Verify hidden and visible combinations.

## Paper cards

- [ ] **26 — A4 card print foundation**
  Build an on-screen print preview and browser print stylesheet for exactly four card positions per A4 sheet, with front/back pages, clear cut guides, modest margins, deterministic ordering, and duplex flip options. Use local assets/fonts only. Implement a calibration/test page and visible overflow warnings rather than clipping or shrinking text to unreadable sizes. Verify single/multiple pages and browser print-to-PDF; document actual-printer alignment testing.

- [ ] **27 — Spellbook cards**
  Add selection and printing from a character's spellbook. The front contains at-table spell fields and the preferred alternate description with original fallback; the back contains only the large spell name. Reuse the print foundation and test incomplete final pages, long text and front/back correspondence.

- [ ] **28 — Multi-encounter monster cards**
  Let the GM select one or several encounters from the same game and print the union of their catalog-backed creatures, deduplicated by stable creature identity, not display name or combatant count. Print exactly one card per monster type with stats/actions and preferred short text on the front and large name plus available flavour/notes on the back. Clearly handle custom participants and missing fluff. Verify repeated monsters across encounters, same-name different-source creatures, partial pages and double-sided pairing.

## Tables, systems and distribution

- [ ] **29 — Free-form random tables**
  Add GM-created game tables with a name, dice expression or numeric ranges, text entries and a roll result. Validate overlapping/empty ranges and allow manual rolls. Keep the UI simple and usable at the table. Verify boundary rolls and editable entries.

- [ ] **30 — Typed random table results**
  Extend table entries to reference system items, spells, creatures or game encounters while retaining free-form text. Show the resolved result and provide an appropriate follow-up action, such as opening the catalog entry or adding a creature to an encounter. Verify missing references and system/game boundaries.

- [ ] **31 — System table templates**
  Support optional system-supplied random tables as read-only templates and copying one to a game for editing. No external package service; imports remain local. Verify two games can modify their copies independently.

- [ ] **32 — AD&D 2e import and views**
  Import the supplied spell index/pages and available creature material with a source-specific parser; preserve raw markup, report unsupported/missing content and expose spell school, sphere, level and source filters where data supports them. Add safe readable rendering and system-specific monster HP roll support only where notation can be interpreted confidently. Use invented fixtures and manually validate examples; don't assume all source pages are complete.

- [ ] **33 — Simple backup and restore**
  Provide a clear local backup/restore workflow using PocketBase's supported backup mechanism or a documented stopped-server copy. Include game data, imported content and alternate descriptions; never rely on copying only a live SQLite database. Verify restore into a separate data directory and include operational instructions.

- [ ] **34 — Cross-platform release and LAN startup**
  Build and package self-contained executables for Linux, Windows and macOS with the Vue frontend embedded and clear start instructions; persist data at a predictable writable path that survives upgrades. Display usable LAN address/port and optionally a QR code. Check firewall and offline guidance. Cross-compilation is useful but does not replace testing on each OS; report actual platform test coverage. Docker can be offered as an optional convenience, not a prerequisite.

---

STOP IMPLEMENTATION HERE. THE DATA FOR LAND OF EEM AND DOLMENWOOD IS NOT YET AVAILABLE

---

- [ ] **35 — Land of Eem system support**
  Follow the same data-first approach as step 33 for Land of Eem, including appropriate system-specific filters and manual fallbacks. If data is unavailable, document the blocker. Verify with synthetic fixtures and available local examples.

- [ ] **36 — Dolmenwood system support**
  Inspect user-provided data before choosing an importer. Add local import, relevant catalog fields, filters, readable views, currency/encumbrance configuration and roll behavior only where source data supports them; preserve manual fallback. If data is unavailable, document what is needed and stop instead of inventing rules. Verify with synthetic fixtures and available local examples.

## Verification milestones

After steps 01–06, a GM can create a game and characters and a phone can select a character. After steps 07–19, a table can import 5e data and use inventories, stashes, currency and spellbooks. After steps 20–28, a GM can run encounters and print spell/monster cards. Later steps complete tables, additional systems and easy distribution. Adjust order only when the user explicitly changes priorities.
