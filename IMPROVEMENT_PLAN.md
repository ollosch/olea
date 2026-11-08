# Olea: usability improvement plan

This is an implementation plan, not a claim that the redesigned interface exists. It is based on the working tree reviewed on 2026-11-08, including local changes. Each numbered step is intended for a **fresh, focused coding prompt**. Work in order unless a step states otherwise; re-read the current code and this plan before starting because earlier work may move files.

## Current handoff

- **Steps 1 and 2 complete; step 3 is next.** The workspace shell now has global, game and character context navigation, a persistent selected-character shortcut and a responsive mobile layout. See `docs/usability-baseline.md` for the measured pre-redesign journeys and `e2e/shell.spec.ts` for shell regression coverage.
- The baseline reproduced lost catalog search/filter/page state on return, scroll movement as results shrink, and a player-encounter scroll jump during a delayed live refresh. The user reports jumping in catalog browsing, pickers, live encounters and other screens; their exact real-world sequences remain unspecified.
- The baseline script asserts some **current** behavior, including the player loading state. Update or retire those assertions as redesign steps change it; replace them with tests for the desired behavior rather than preserving the problems.
- Use **Bun**, e.g. `bun run typecheck` and `bun run test:e2e -- e2e/shell.spec.ts --workers=1`. Step 2 verification passed on desktop and mobile emulation; no physical-device or printer testing was performed. The exploratory baseline spec still passes unchanged and continues to assert pre-step-4 catalog, picker and player-loading behavior.
- The user has explicitly requested sequential subagents, Bun, a dedicated branch and one commit per step.
- Inspect the working tree before editing; do not overwrite or revert user changes. Use disposable databases, never `pb_data/` or personal source data.

## Decision: improve in place

**Keep Vue 3, TypeScript, Go, PocketBase and the local-network deployment. Do not rewrite the app or the entire frontend.** Rebuild individual screens and extract components as their workflows are improved. This obtains most of the benefit of a frontend rewrite without a long period in which existing features, print layouts, data and realtime behavior have to be recreated.

Why:

- The main problems are composition and interaction choices, not a framework ceiling. Vue supports smaller components and composables; the current large views combine data loading, editing, realtime state and all interaction modes in one place. `GameEncountersView.vue` and `InventoryView.vue` are prime candidates for incremental decomposition.
- The server already contains versioned migrations, data-preserving imports, atomic transfers, guarded updates, system-specific rules, and upgrade tests. Replacing it would mean rebuilding and migrating all of that, including existing databases.
- A whole new frontend would still need to solve the same navigation, draft, conflict and table-workflow questions, and risks losing the existing two-browser and print coverage. Replacing one surface at a time gives feedback sooner.
- The current stack fits a single executable on a trusted LAN with browser clients and no runtime internet dependency. PocketBase is pre-1.0; its maintainers do not guarantee full backward compatibility. Keep versions pinned, exercise populated upgrades, and back up the entire stopped data directory before upgrades.
- Laravel is a sound option for a future hosted service with established account, authorization and operations requirements, but it does not automatically improve usability and can also use Vue. Replacing Go/PocketBase would add data and behavior migration, deployment and realtime work. Do not change stack without discussing it with the owner.

### Import complexity and stable identity

Imports are host-side setup, not an everyday UI. Keep them out of the main workflow. Do not delete the importers merely because the owner expects a single initial import: they encode nontrivial source parsing and allow recovery, additions and reimport. `server/catalogimport/import.go` upserts by **system/type/source/source_id**, retains the existing database record ID and preserves alternate descriptions and notes; inventory items, spellbooks, encounters and templates can refer to those records. Names alone are not unique and can change. Backups preserve the whole database and its IDs; reimport into a new empty database is not a substitute for restoring it. Defer parser simplification until an actual maintenance cost is identified and retention/migration behavior has been tested.

### Possible online future

Remote use is feasible on this stack, but is a separate project, not a switch. A private VPN to a self-hosted instance is operationally simpler than a public multi-user service, but still depends on trust in VPN members. A public or multi-tenant deployment needs real authentication, per-game and per-catalog authorization on **every** collection, custom route, file and realtime subscription; an ownership model; a migration for existing local data; HTTPS, backups, recovery, rate limits and operations. Current `profiles` are labels, not accounts; current collection rules are public and custom routes operate on the app directly. UI-only encounter visibility is not secrecy. Do not expose this instance publicly on the assumption that a login screen makes it safe.

Copyright: user-supplied content and a login gate do **not** by themselves establish permission to copy, store, host or share material. Rights and exceptions vary with source, use, jurisdiction and who can access it. If hosted use is pursued, review actual licenses and sharing/hosting terms with appropriate legal advice. This plan neither distributes nor imports copyrighted content.

## What users need

| Situation | Primary task | Keep immediately available | Move to a secondary action |
|---|---|---|---|
| GM before a session | Find a creature; assemble and reuse an encounter | Search, source disambiguation, quantities, encounter notes, start | Rename, duplicate, delete, print, full source |
| GM during combat | See whose turn, initiative, HP and conditions; apply a change | Current turn, next/previous, compact ordered roster, damage/healing entry, contextual creature details | Setup, bulk rolls, reordering, reset/end, visibility settings |
| Player at table | Find spell/item, check description, use or move a resource | Character context, search, item quantity, spell details, shared encounter | Create/rename/delete books and stashes, print, rare configuration |
| GM improvising | Roll or manually resolve a table; follow result | Selected table, roll/manual input, result, relevant follow-up | Template import and table editing |
| Host/setup | Create games, characters and local profiles | Clear next action and current context | Destructive management and optional settings |
| Any user | Return to exactly where they were | Back/forward, state, focus and scroll, stable live updates | Reinitialization and unrelated notices |

These are hypotheses to validate with the owner, not evidence from observed table sessions. Preserve physical dice/manual workflows, unknown values and both 5e and AD&D 2e/manual rules. A quick `+`/`−` is appropriate for common one-at-a-time expendable quantities; for damage, offer an explicit entered amount and damage/heal actions, with direct set for corrections. Do not put steppers on every numerical field: initiative, max HP, capacities and large currency amounts are usually better entered directly. Never invent automatic rules or hide what an action changes.

## Evidence and concrete problems

- `src/style.css`: `.app-layout` caps at 1280px, `.screen` at 820px, and the 238px navigation plus large page padding consume workspace. Encounters then put another sidebar inside the narrow screen; many controls wrap even on a large monitor. Huge headers and inline forms push useful work below the fold.
- `src/views/CatalogView.vue`, `CatalogDetailView.vue`, `router.ts`, `App.vue`: search, selected filters, page and result scroll are component state; opening a result destroys the view (`RouterView` keyed by path), and the explicit back link targets `/catalog` without its context. Filtering to a short list can shrink the document and force the browser to clamp scroll. These are concrete mechanisms; which one caused the user's exact jump needs reproduction, not assumption. `CatalogPicker` similarly inserts/removes results inline and caps a nested scroll area.
- `GameEncountersView.vue`: preparation, settings, adding, bulk rolls, turn controls, all editable fields and actions for every combatant share one screen. Full reloads, real-time refresh and draft rebuilding can disrupt context; `PlayerEncounterView.vue` sets its full loading state on every update. Start combat creates combatants sequentially in the browser and attempts cleanup on failure; do not imply this is atomic.
- `InventoryView.vue`: currency editing and transfer form, capacity, stash creation, item add forms and per-row actions compete before the item list. Containers are indicated by an arrow in a name-sorted flat list, not a navigable hierarchy. `SpellbooksView.vue` renders every full spell description and per-row remove button. `GameTablesView.vue` makes the result follow a potentially long table.
- The home/character views emphasize management and large presentation panels over returning to the active character or game. Character selection requires selecting, then opening. Some copy says features are coming soon despite their presence. Print selection uses a native multi-select for encounters (`PrintMonstersView.vue`); printing items reads root carried items only, even when inventory currently displays a stash or nested content (`PrintItemsView.vue`). Do not imply those are already printable.
- Catalog filtering currently loads all records of one system/type, including preserved source JSON, and filters on the client; filters include system-defined JSON paths and nontrivial matching/sort. Performance may become a problem, but a server query redesign is conditional on measurement and must preserve these semantics.
- Browser E2E tests cover important behavior but mostly not usability: no measured search-state/scroll restoration or focused combat task. Existing checks use desktop Chromium and Pixel 8 emulation, not real devices.

## Cross-cutting interaction contract

1. **Context first.** Always identify active game/character and selected encounter/book/store; keep current task reachable without repeatedly returning home. Preserve direct links and browser history, including existing routes and `?encounter=` links.
2. **Stable geometry.** Search input, filters and active item should not jump when results, loading, errors, realtime events or panels change. Use appropriately bounded areas and reserved space where useful; do not create competing nested scroll regions by default. Page scroll remains natural on phones.
3. **Restore deliberately.** Define state ownership for search, filters, selected record, page, scroll and focus. Browser Back/Forward, explicit back, reload and returning from details must have specified behavior; distinguish shareable URL state from transient session scroll. Avoid focus theft and stale results after async requests.
4. **Progressive disclosure.** One prominent action per context; expose common actions directly and group infrequent/destructive controls behind clearly labelled menus or details. Revealed actions remain keyboard- and touch-accessible. Never hide an existing capability without a discoverable replacement.
5. **Safe feedback.** Explain saving, failure, conflicts and recovery near the affected control. Preserve in-progress input across unrelated realtime refreshes. Do not silently overwrite a second client's changes or replay an uncertain write after reconnect.
6. **Responsive and accessible.** Use wide desktops for useful columns, not stretched prose; collapse to one natural scroll on mobile. Preserve legible text, visible focus, labels, contrast, keyboard use, semantic structure and practical touch targets. Verify 320px, 390px, 768px, 1280px and a large desktop, including browser zoom and long names.
7. **Existing semantics first.** Preserve data IDs, physical dice, supported/unknown system behavior, player-display rules, transaction semantics, preferred descriptions, printing and existing routes. No schema/API change unless a step justifies and tests it.

## Execution and verification convention

For every step: inspect the existing implementation and user changes, keep the patch scoped, run `bun run typecheck` and the relevant focused Playwright tests for UI work, and add or update meaningful regression tests for the behavior changed. Run `bun run build` at integration points. For backend changes use focused Go tests plus `go -C server test ./...`; use a disposable database, never `pb_data/`. Adapt existing tests to new UI semantics rather than merely deleting coverage. Record actual verification and any limitations in the step's completion notes. Playwright has separate desktop/mobile projects; prefer both when interaction/layout changes affect both. Don't claim physical-device or printer validation from emulation or PDF.

### 1. Baseline the actual user journeys

**Scope:** Create a compact reproducible usability baseline using invented, disposable fixture data. Exercise catalog search at a scrolled position, result/detail/back, picker filtering and selection, combat with 10–20 participants, a long spellbook and inventory with nested containers. Capture viewport sizes, steps, screen recordings/screenshots or notes and relevant scroll/focus positions. Include large desktop and phone emulation; ask the owner to describe their real search-jump sequence and which actions they use often.

**Done when:** `e2e/` has only the fixture support needed for later regression tests and a short baseline notes file identifies observed versus inferred behavior, with exact reproducible steps. Include initial loading, live updates and page shortening as possible jump causes. No styling redesign in this step.

### 2. Establish workspace shell and navigation

**Scope:** Refactor `App.vue`, `router.ts`, and shell CSS for a wide, compact desktop workspace and mobile navigation. Keep game/character context obvious, expose return to selected character, and provide context navigation for game tools and character tools. Retain all existing deep links and appearance/connection behavior. Remove obsolete placeholder copy.

**Done when:** At 1280px and large desktop the workspace uses available width without excessive line lengths; 320–768px has no horizontal page overflow and all destinations are reachable by touch/keyboard. Route/back/forward and existing print styles still work; a bookmarked player view remains a player view, and GM-labeled navigation is not mistaken for access control. Verify initial shell, active links, selected character, responsive navigation and print smoke.

**Completion notes (2026-11-08):** `App.vue` now derives game or character context from the route, loads the stored selected character as a persistent shortcut, and keeps the player encounter route in a player-only shell with no GM tools. `router.ts` records `area`, `context` and `playerView` metadata while preserving every existing path. Shell CSS widens the desktop workspace to a 1680px frame with a 1120px content column, adds wrapping mobile navigation from 860px down, and keeps all controls at least 44px. The obsolete “more tools coming soon” navigation note and character-selection placeholder panel were removed; the navigation now states that GM/player labels are views, not access control. Shell lookups use PocketBase `requestKey: null` so a view’s matching request cannot auto-cancel the context.

Verified with `bun run typecheck`, `bun run build`, `bun run test:e2e -- e2e/shell.spec.ts` (10 passed, 2 project skips across desktop and Pixel 8 emulation, including keyboard and touch navigation), `bun run test:e2e -- e2e/app.spec.ts e2e/print-foundation.spec.ts` (22 passed, 2 project skips) and `bun run test:e2e -- e2e/usability-baseline.spec.ts` (2 passed). Limitations: browser emulation only, no physical touch device or printer; the 768px shell is the mobile layout; catalog search/history and combat/player loading remain later steps.

### 3. Shared UI primitives and density rules

**Scope:** Introduce only the small primitives needed by subsequent steps: compact page header/toolbar, accessible action menu or disclosure, feedback/loading region and consistent field/button styles. Use the existing Reka UI dependency when suitable. Define touch targets, focus, reduced-motion and dense desktop row behavior in `src/style.css` or scoped styles. Avoid a new design-system framework.

**Done when:** Existing representative screen uses these primitives; menus and dialogs have accessible labels, keyboard navigation, close/focus return, and long text wraps. Loading/error space does not unnecessarily move controls. Document when each primitive is appropriate; check desktop/mobile and zoom.

### 4. Search state and history foundation

**Scope:** Define and implement catalog navigation state: system, type, query, filters and page in a recoverable URL or equivalent explicit route contract; preserve the current `defaultSystemId` behavior and saved system preference when no explicit system is present. Retain scroll/focus per history entry in session memory, including async load and result disappearance; sanitize invalid/stale state. Browser Back/Forward and explicit return from `CatalogDetailView.vue` must restore the same context; direct details have a sensible fallback.

**Done when:** A test searches and filters, moves to a later page/scroll position, opens a result and returns via both browser and UI; context and focus/scroll recover within a reasonable tolerance without overwriting user scroll after restoration. Reload/direct URL work; search reducing results does not strand focus or cause unexplained jumps. A user who starts typing before a delayed response must not have their query or filters silently reset.

### 5. Catalog browsing and details workspace

**Scope:** Redesign `CatalogView.vue`, `CatalogFilters.vue`, and `CatalogDetailView.vue` around fast lookup. Show search and relevant filters prominently, collapse advanced filters, show applied filters and clear action, and preserve source disambiguation. On wide screens use a stable list/detail arrangement if practical; on narrow screens retain navigable detail and restoration from step 4. Present preferred at-table text first with original and edits clearly accessible.

**Done when:** Search stays visible and focused while results change; selection does not cause the workspace to jump, and empty/loading/error states give a useful next action. Both systems' filter/sort/default semantics and editing notes/alternate descriptions still work, including same-name records from different sources. Check result-to-detail-to-back and keyboard/mobile workflows.

### 6. Reusable catalog picker

**Scope:** Refactor `CatalogPicker.vue` and its inventory, spellbook, encounter and table callers into a consistent contextual picker. Use a dialog/drawer or stable panel appropriate to viewport, with search, optional filters, source labels, accessible focus and explicit selection feedback. Permit repeat adds where the caller supports them, without losing search or accidentally duplicating entries; caller decides whether selection closes the picker.

**Done when:** Opening, filtering, choosing, retrying and closing restores the invoking control and underlying position. Repeated selections are visibly acknowledged; duplicate spellbook behavior is clear. Multiple instances do not share duplicate input IDs. Test one item, spell, creature and table-reference flow on desktop and phone.

### 7. Game and character entry points

**Scope:** Improve `GamesView.vue`, `GameCharactersView.vue`, `CharacterSelectionView.vue` and `CharacterOverviewView.vue` around resuming a game or character. Make game tools and character tools findable; one deliberate character selection should lead to its useful workspace. Put profile assignments, renames and deletion in management contexts; retain create/edit/delete and exact ownership semantics.

**Done when:** A player can resume/switch character and reach inventory, spellbook and shared encounter quickly; a GM can enter a game and find encounters, tables and characters. No false promises about character-sheet features. Test empty and populated states, direct links and back navigation.

### 8. Encounter preparation

**Scope:** Separate preparation presentation from live play within `GameEncountersView.vue`, extracting focused components/composables without changing persistence. Provide encounter switching, fast add of catalog/custom creatures, quantity and notes editing, start and print; tuck rename/duplicate/delete into a management menu. Clearly distinguish changes to reusable preparation from changes to active combat.

**Done when:** GM can build a multi-creature encounter, adjust counts, duplicate, print and start without unrelated live controls dominating. Switching encounter and returning from print preserves the selected encounter and position, including existing query links. Cover custom/missing records, no entries, errors and existing active combat.

### 9. Combat setup and transition

**Scope:** Introduce a compact setup phase for character/custom participants, initiative and initial HP. Keep 5e roll-one/group, average/roll/manual HP and manual-order systems available only when supported; show what is unset. Preserve current start/end and active-participant behavior. Assess the existing non-atomic client-side creation and partial-failure message; do not claim atomic creation or silently change its contract.

**Done when:** Setup can be completed using physical dice or supported automatic rolls and enters the live tracker without displaying every setup control on every row thereafter. 5e, AD&D 2e and unknown-system tests cover available/unavailable actions, missing HP data, partial failures and active combat recovery. Any atomic server-start change is a separately justified, tested backend task, not a hidden UI refactor.

### 10. Live combat tracker

**Scope:** Replace always-expanded combatant forms with a compact, stable ordered roster: active participant, next/previous, initiative, HP/unknown and conditions at a glance. A selected participant reveals details and frequently used actions; damage/heal use an entered amount and clear labels, direct-set remains available. Make secondary controls discoverable without repeating all of them on every row. Do not assume PCs expose a character-sheet HP model that doesn't exist.

**Done when:** With 10–20 participants a GM can identify turn, apply damage/healing and add a condition without scrolling past a full form per participant; changing initiative preserves the correct active participant and meaningful ordering. Saves are guarded, repeated clicks cannot duplicate writes, errors/conflicts retain or clearly reconcile drafts, and values never silently clamp. Test desktop/mobile, unknown HP, zero, round wrap, tie/manual ordering and two-client stale edits.

### 11. Combat realtime and player view

**Scope:** Make `GameEncountersView.vue` and `PlayerEncounterView.vue` update in place rather than replacing the entire visible workspace with a loading state. Preserve selected participant, open controls, scroll and unsaved drafts across unrelated events; reconcile the authoritative state and show actionable conflict/offline/reconnect feedback. Retain each game visibility setting and avoid displaying hidden fields in the player UI.

**Done when:** Two browser contexts can edit/view updates while neither view jumps or loses a draft; stale edits are not silently applied. Visibility changes, active-turn reorder, disconnect and reconnect are covered. Test that hidden initiative also does not leak through ordering or labels, consistent with current `visibleParticipants` behavior. Settings remain explicitly UI-only privacy, not security.

### 12. Inventory and containers

**Scope:** Reorganize `InventoryView.vue` around items first and the selected store. Present nested containers as an intelligible hierarchy with location and search; keep add, edit, move and drop accessible. Use contextual one-step quantity controls only for ordinary stacks where meaningful; provide direct entry, enforce minimum and container constraints, and use guarded updates.

**Done when:** A player can find a nested item, change an expendable stack and move items/stores without losing context. Transfer quantities, descendants, unknown weight, container restrictions, custom items and second-client conflicts retain their existing semantics. Test hierarchy, move/split, stale updates and mobile touch.

### 13. Currency, weight and stash management

**Scope:** Condense currency, weight/capacity and stash controls into readable summaries with on-demand edit and transfer workflows. Direct numerical input is primary for balances and capacities; avoid per-denomination plus/minus clutter. Preserve party totals, unsupported balances, unknown weights and system-dependent denominations.

**Done when:** A user can see current store/balances, edit a supported denomination and transfer currency without the transfer form occupying permanent space; no unsupported value is lost or silently converted. Verify 5e and AD&D/unknown systems, capacity, atomic coin transfer, stale edit and reconnect with two contexts.

### 14. Spellbooks

**Scope:** Make `SpellbooksView.vue` a searchable, compact spell list with readable selected/expanded details and source; retain multiple named books, preferred descriptions, add/remove and print. Put book administration behind a menu; preserve selected book when navigating to print and back.

**Done when:** A player finds and reads a spell without scrolling through every complete description, and adds multiple spells with the shared picker. Missing catalog references remain understandable. Test long text, duplicate add, selected book restoration, keyboard and phone.

### 15. Random tables

**Scope:** Rework `GameTablesView.vue` so table selection, roll/manual entry and latest result are visible before the full entry list. Group create/edit/delete and template copying separately; keep result links and add-creature-to-encounter flow.

**Done when:** A GM can roll or enter physical dice and act on the result without scrolling through a long table. Editing ranges, validation, missing references, no-match gaps, copy templates and wrong-system/game checks still work. Test long tables and result navigation/back.

### 16. Print selection and navigation

**Scope:** Improve `PrintMonstersView.vue`, `PrintItemsView.vue`, `PrintSpellbookView.vue` and `CardPrintPreview.vue` selection and orientation without altering the physical card geometry. Replace hard-to-discover multi-select with explicit accessible multi-selection, keep selection/preview/actions understandable and return to the originating encounter/book/inventory context. State accurately which items are eligible: root carried items only in the current implementation; any extension to stash/nested printing must be deliberate and tested separately.

**Done when:** Users can select multiple encounter groups and cards with mouse, keyboard and touch, see counts/warnings, and navigate back with context intact. Existing A4 dimensions, front/back pairing, flip, overflow and calibration tests pass; browser print-to-PDF is checked. Physical printer registration remains a manual follow-up.

### 17. Performance only if measured

**Scope:** Measure search latency, data transfer and memory using an invented representative large catalog, including source JSON, on target desktop/phone. If measurements show material delay, make the smallest correction (e.g. split list/detail payloads, caching or bounded rendering). Consider server search only if needed and document which filters/sorts require server support, including source JSON fields, normalized lists and fractional CR.

**Done when:** Before/after measurements and dataset size are recorded; a slow request cannot replace newer results, and sort/filter/count semantics match the existing `systems.ts` and `catalogFilters.ts` contracts. If no material issue is observed, document the finding and make no speculative backend change.

### 18. End-to-end usability review and handoff

**Scope:** Run complete GM preparation → live combat → player display and player inventory → spellbook → print journeys; include browsing/back, long data, realtime, conflicts, reconnect and empty/error states. Run full `bun run test:e2e`, `bun run build` and `go -C server test ./...`; inspect at the specified viewport sizes and keyboard/zoom. Invite the owner to try the real app and record what still interrupts them.

**Done when:** The original jump and excessive-combat-control complaints have reproducible passing acceptance checks, all existing behavior is either preserved or an explicitly agreed change, test results and genuine device/printer limitations are recorded, and follow-up issues are small and actionable. Update user-facing documentation to match the delivered UI.

## References for the stack decision

- Vue 3 documentation: https://vuejs.org/guide/reusability/composables.html
- PocketBase project and pre-1.0 compatibility notice: https://github.com/pocketbase/pocketbase
- Laravel realtime broadcasting options: https://laravel.com/docs/13.x/broadcasting
- The companion human learning guide: `docs/developer-guide/README.md`.
