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
- Spell and monster cards use four positions per A4 page: each card is slightly smaller than A6 to allow margins and cut guides. Print double-sided with preview and legible overflow handling. The spell-card back contains only the large spell name. Monster printing works for one encounter or several and deduplicates by creature identity across the selection.
- Item cards are also planned. The tentative format is approximately A7, eight per A4 page; the card design and weapon-specific layout are undecided and must be settled before implementation.
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

- [x] **12 — System-specific browsing and filters**
  Add a catalog UI with search, pagination and configurable filter definitions by system and content type. Implement 5e spell level/school/source, monster type/CR/source and useful item filters; use primary source for the initial source-book filter. Sort fractional CR correctly. Ensure controls work in desktop and mobile layouts; verify combinations, empty results and filtering against synthetic records.

- [x] **13 — Catalog detail and custom descriptions**
  Provide detail screens and editable alternate descriptions for items, spells and monsters. Keep source text accessible; prefer the alternate where present and fall back to the original. For monsters support separate at-table notes alongside structured stats. Store edits independently of imported records and verify they survive re-import and server restart.

## Inventory, stashes and spellbooks

- [x] **14 — Inventory and catalog picker**
  Add character inventories, item instances and quantities, plus a reusable context-aware catalog picker with name search and the appropriate system filters. Allow adding, editing quantities and dropping items; dropping removes them. Preserve item-specific notes and custom items. Verify no negative quantities and that multiple characters have separate inventories.

- [x] **15 — Containers and weight**
  Support moving items into and out of nested containers with an understandable touch UI. Prevent cycles; count container and contained-item weight exactly once. Add a manually entered carrying capacity per character and show total carried weight and whether capacity is exceeded. Handle unknown weight visibly rather than treating it as known. Verify nested containers, quantity changes and capacity boundaries.

- [x] **16 — Currency and party totals**
  Define 5e CP, SP, EP, GP and PP and store nonnegative integer balances per inventory. Display and edit denominations individually. Count coin weight according to a documented 5e setting, and recalculate encumbrance. Show party totals from character purses plus the party stash only; don't include personal or location stashes. Verify denomination totals and coin-weight calculations.

- [x] **17 — Stashes**
  Create one shared party stash per game, player-created personal stashes, and GM-created location stashes. Each has a name, optional location/notes, contents and coins. Ensure party stash is open to all characters; personal stashes remain distinct and location stashes are managed through the GM interface. Verify persistence and that stash contents aren't counted as carried weight.

- [x] **18 — Atomic item and coin transfers**
  Add small PocketBase Go routes using transactions for transfers between character inventories and eligible stashes, including partial stacks, nested contents where supported, and coins. Restrict destinations to the same game as a domain invariant; check quantities and report errors. Verify a failed or concurrent transfer cannot duplicate or lose items/coins; all balances remain nonnegative. This is data integrity, not authentication.

- [x] **19 — Spellbooks**
  Allow a character to have multiple named spellbooks. Add/remove spells via the shared filtered picker and view system-specific details and alternate descriptions. GM can manage every character's spellbooks. Avoid rules-heavy known/prepared/slot automation for now. Verify one character's changes do not affect another's collection.

## Encounters and live play

- [x] **20 — Encounter preparation**
  Add GM create, rename, duplicate and delete operations for game encounters. Extend the catalog picker to support creatures and their system-specific filters. Add monster types through the picker, with quantity, optional notes and manual/custom participant entries. An encounter can be just a print grouping and can be deleted after printing. Ensure owned encounter records are deleted with their game; verify encounters remain independent and carry their game's system.

- [x] **21 — Individual combatants and manual tracker**
  Start an encounter with independently editable participants and per-creature current/max HP, initiative, conditions and notes. Include game characters and custom participants when the GM chooses. Implement stable order, manual tie handling, round/active turn, next/previous, reset and end. Keep preparation separate from live state so an encounter can be reused. Verify repeated creatures have independent HP and condition state.

- [x] **22 — Dice and 5e monster HP**
  Add a bounded dice-expression evaluator sufficient for `NdM`, optional signed constant and clear invalid-input handling; no arbitrary code evaluation. For encounter monsters, offer average, individual rolls and manual HP, displaying each result before confirming. PocketBase number fields default missing values to zero: distinguish an absent imported HP average from zero using source data or explicit presence metadata. Test with deterministic injected rolls, invalid formulas and representative 5e data. Leave unsupported formulas editable manually.

- [x] **23 — 5e initiative rolls**
  Compute a default initiative modifier from a 5e monster's Dexterity where available, allow an override, and roll individually or once for a selected group. Distinguish missing Dexterity from PocketBase's default numeric zero using source data or explicit presence metadata. Manual results and manual player-character initiative remain available. Verify negative modifiers, missing Dexterity, ties, group rolls and rerolls without overwriting unrelated combatants.

- [x] **24 — Realtime and reconnect**
  Subscribe to relevant PocketBase records for the active screen, update views after GM/player edits and clean up subscriptions. On reconnect/refocus, refetch authoritative state so missed events are not mistaken for current data. Prevent stale direct quantity, container and coin edits from overwriting concurrent changes or transfers; surface conflicts and refresh rather than silently losing changes. Show connection state and reject/clearly surface failed writes. Verify with two browser contexts, concurrent edits/transfers, and a deliberate disconnect/reconnect.

- [x] **25 — Optional player encounter view**
  Add per-game settings for whether players see the active encounter, initiative, enemy names, HP and conditions; all default off. Provide an optional player-facing display that respects those settings in the normal UI. Explicitly document that these settings hide UI details but are not security controls on a trusted LAN. Verify hidden and visible combinations.

## Paper cards

- [x] **26 — A4 card print foundation**
  Build an on-screen print preview and browser print stylesheet for exactly four slightly-smaller-than-A6 card positions per A4 sheet, with front/back pages, clear cut guides, modest margins, deterministic ordering, and duplex flip options. Use local assets/fonts only. Implement a calibration/test page and visible overflow warnings rather than clipping or shrinking text to unreadable sizes. Verified four positions and partial sheets, both duplex mappings, overflow notice, and five-page A4 browser PDF in desktop/mobile Chromium. Physical printer alignment still requires hands-on testing.

- [x] **27 — Spellbook cards**
  Add selection and printing from a character's spellbook. Use four slightly-smaller-than-A6 cards per A4 page. The front contains at-table spell fields and the preferred alternate description with original fallback; the back contains only the large spell name. Reuse the print foundation. Verified selection, partial sheets, long-text warnings, preferred/original description behavior and front/back pairing with invented fixtures in desktop and mobile Chromium.

- [x] **28 — Single- and multi-encounter monster cards**
  Let the GM print creatures directly from a single encounter or select several encounters from the same game and print their union. Deduplicate catalog-backed creatures by stable creature identity, not display name or combatant count. Use four slightly-smaller-than-A6 cards per A4 page; print exactly one card per monster type with stats/actions and preferred short text on the front and large name plus available flavour/notes on the back. Clearly handle custom participants and missing fluff. Verified single/multi-encounter selection, repeated creature deduplication with notes retained, distinct same-name catalog identities, custom entries, partial pages and paired backs with invented fixtures in desktop and mobile Chromium. Physical printing still requires alignment testing.

- [x] **28a — Item cards**
  Design and implement printable item cards, including appropriate weapon presentation. Use the confirmed flexible A7 landscape format with eight cards per A4 sheet; dimensions and grid remain data-driven for future sizes such as A8. Fronts show item type, available rarity/value/weight, description and weapon damage/range/properties; backs contain item notes. Print from character inventory, including custom items. Verified ordinary items, weapons, custom items and incomplete sheets with invented fixtures in desktop and mobile Chromium. Actual printer alignment remains a hands-on check.

## Tables, systems and distribution

- [x] **29 — Free-form random tables**
  Add GM-created game tables with a name, dice expression or numeric ranges, text entries and a roll result. Validate overlapping/empty ranges and allow manual rolls. Keep the UI simple and usable at the table. Verify boundary rolls and editable entries.

- [x] **30 — Typed random table results**
  Extend table entries to reference system items, spells, creatures or game encounters while retaining free-form text. Show the resolved result and provide an appropriate follow-up action, such as opening the catalog entry or adding a creature to an encounter. Verify missing references and system/game boundaries.

- [x] **31 — System table templates**
  Support optional system-supplied random tables as read-only templates and copying one to a game for editing. No external package service; imports remain local. Verify two games can modify their copies independently.

- [x] **32 — AD&D 2e import and views**
  Import the supplied spell index/pages and available creature material with a source-specific parser; preserve raw markup, report unsupported/missing content and expose spell school, sphere, level and source filters where data supports them. Add safe readable rendering and system-specific monster HP roll support only where notation can be interpreted confidently. Use invented fixtures and manually validate examples; don't assume all source pages are complete.

### System architecture milestone — next priority

Complete steps **32a–32f before any further ruleset implementation**. This milestone also takes priority over the deferred paper-card steps 26–28a; return to those later. Step 32 delivered the AD&D imports and views, but its shared combat and inventory behavior still contains 5e assumptions and needs the corrections below. Review the existing work and preserve unrelated changes before beginning; do not rewrite history or quietly attribute unrelated changes to a new step.

Keep the design practical: use small, built-in system modules and explicit capability contracts, not an external plugin system or a second backend. A game selects its system by stable key. Shared features own persistence, transactions and UI orchestration; system modules supply only the rules, formats and presentation definitions that vary. Unsupported or unknown capabilities must have an explicit neutral/manual fallback rather than silently using 5e rules. Keep each step independently usable, migrate existing data safely, and document any supported-rule assumptions.

- [x] **32a — Built-in system capabilities and neutral fallback**
  Define a small typed system registry and capability contracts for the behavior needed by the next steps: encounter order and optional rolls, creature HP interpretation, catalog display/filter definitions, and currency/weight rules. Register 5e and AD&D 2e using their existing stable keys; provide an unknown-system fallback with no invented rule automation. Keep generic dice expression evaluation separate from system-specific rules. Establish how the active game system is resolved, including missing or invalid references, without forcing a large rewrite. Test lookup, unsupported capabilities and fallback behavior with an invented system. Document how to add a built-in system; do not introduce runtime plugins or bundled reference content.

- [x] **32b — System-aware encounter rules**
  Move 5e Dexterity-derived modifiers, d20 initiative and creature HP interpretation behind the relevant system capabilities. The shared GM and player trackers must use one authoritative ordering policy and agree on the active turn, including ties, reconnects and hidden initiative. Do not offer 5e rolls or modifiers for AD&D 2e or unknown systems. Provide a usable manual order and manual HP/initiative for systems without supported rules; implement AD&D-specific initiative only if supported by verified source rules, otherwise leave it manual. Preserve existing 5e combatants and 5e behavior, and handle active combats across migration/reload without changing the active participant unexpectedly. Test 5e rolls and ordering, AD&D/unknown manual behavior, ties, turn navigation, GM/player agreement and existing combat reloads.

- [x] **32c — System-aware catalog presentation**
  Extract duplicated system-specific filters, result labels, detail fields, source rendering and creature/spell presentation from the shared catalog, picker and spellbook views into the system modules or small shared helpers. Reuse the same filter definitions and matching semantics in browsing and pickers; retain safe rendering and the preferred alternate-description fallback. Preserve 5e and AD&D import identities, original source data and user edits. Keep queryable common fields where useful, but avoid adding a new shared column or shared-view branch for every system-specific attribute; use a documented system-specific representation when needed. Test both systems' filter combinations, readable details and reimports, plus a synthetic system with different fields and a neutral fallback.

- [x] **32d — Flexible currency storage and transfers**
  Introduce system-aware denominations and balances through a versioned migration, using a representation that can support different denomination sets without schema columns for each new system. Migrate existing character and stash balances exactly, including zero and nonzero denominations; preserve game ownership, party totals, references and restart behavior. Adapt server-side validation, guarded edits and atomic transfers to the game's supported denominations while retaining same-game checks, nonnegative integer balances and concurrency/conflict protection. Preserve 5e behavior and prevent unsupported denominations from being silently converted or discarded. Test migration from populated old data, restart, transfers, concurrent/stale edits, failures, party totals and a synthetic system with a different denomination set. Keep the application usable throughout the transition.

- [x] **32e — System-aware currency and encumbrance UI**
  Drive denomination labels, editable balances, transfer options, weight units and coin-weight calculations from system capabilities across character inventories and stashes. Retain the documented 5e 50-coins-per-pound convention for 5e only. Configure AD&D 2e only from verified source rules; where a rule is unavailable, clearly show an unknown/manual weight instead of applying 5e assumptions. Preserve separate denominations, unknown item weights, capacity calculations, nested containers and the defined party-total scope. Verify 5e regressions, AD&D or manual fallback, a synthetic system with different currency and weight behavior, and phone/desktop use.

- [x] **32f — Extension and integration verification**
  Add an invented test-only system with meaningfully different initiative ordering, currency and catalog fields to exercise the complete built-in extension path without copyrighted data. Verify that adding it requires registration and system-specific modules, not edits to shared encounter, inventory or catalog screens; verify unsupported capabilities remain manual and no 5e defaults leak into it. Run frontend and backend suites and migration/restart checks against both fresh and populated data; verify 5e, AD&D and unknown-system behavior, and report browser/device coverage. Update the developer documentation with the actual extension steps, persistence boundaries and known limitations.

- [x] **33 — Simple backup and restore**
  Documented a stopped-server copy of the complete PocketBase data directory and restore into a separate directory, including replacement precautions. A Go integration test copies an isolated fixture directory, opens the restored copy, and verifies campaign, imported catalog source, alternate description and notes. `go -C server test ./...` passes. The live server workflow is intentionally manual; no OS-specific backup utility or live-database copy is used.

- [ ] **34 — Cross-platform release and LAN startup**
  Build and package self-contained executables for Linux, Windows and macOS with the Vue frontend embedded and clear start instructions; persist data at a predictable writable path that survives upgrades. Display usable LAN address/port and optionally a QR code. Check firewall and offline guidance. Cross-compilation is useful but does not replace testing on each OS; report actual platform test coverage. Docker can be offered as an optional convenience, not a prerequisite.

- [x] **35 — Two-browser realtime and reconnect verification**
  Using two browser contexts against the same running instance, verify live encounter and inventory changes appear on both clients. Exercise concurrent quantity/container/coin edits and item or coin transfers; confirm stale edits surface a conflict and refresh authoritative values without losing or duplicating data. Disconnect one client, make changes in the other, then reconnect/refocus and confirm the disconnected client refetches current state. Verify player encounter visibility settings update as expected. Automated coverage passes on desktop Chromium with mouse input and Pixel 8 Chromium touch emulation; physical devices are not covered. The tests use isolated invented data and a disposable PocketBase data directory (`npm run test:e2e`).

- [ ] **36 — Land of Eem system support**
  Follow the same data-first approach as step 32 for Land of Eem, including appropriate system-specific filters and manual fallbacks. If data is unavailable, document the blocker. Verify with synthetic fixtures and available local examples.

- [ ] **37 — Dolmenwood system support**
  Inspect user-provided data before choosing an importer. Add local import, relevant catalog fields, filters, readable views, currency/encumbrance configuration and roll behavior only where source data supports them; preserve manual fallback. If data is unavailable, document what is needed and stop instead of inventing rules. Verify with synthetic fixtures and available local examples.

## Verification milestones

After steps 01–06, a GM can create a game and characters and a phone can select a character. After steps 07–19, a table can import 5e data and use inventories, stashes, currency and spellbooks. After steps 20–28, a GM can run encounters and print spell/monster cards. Later steps complete tables, additional systems and easy distribution. Adjust order only when the user explicitly changes priorities.
