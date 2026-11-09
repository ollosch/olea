# Step 18 usability review and handoff — 2026-11-09

This is the end-to-end review for step 18 of `IMPROVEMENT_PLAN.md`. It records what was exercised, what failed, what was fixed, and what still needs a real device, printer, screen reader or the product owner. It does not claim owner review, physical-device validation or production performance work.

## Status

The automated portion of step 18 is complete. The step's done-when statement is **not fully satisfied yet**: the owner has not reviewed the app, the exact original jump sequence is still unknown, and physical-device, printer, screen-reader and real zoom verification remain outstanding.

## Environment and exact commands

- Branch: `usability-improvements`.
- Frontend: Vue 3.5, Vue Router 4, TypeScript, Vite, Reka UI.
- Backend: Go with embedded PocketBase. **Bun** is used for frontend and Playwright commands.
- Browser tests use Playwright desktop Chromium and Pixel 8 emulation against a fresh synthetic PocketBase database created by `scripts/e2e-server.sh` in a temporary directory. No `pb_data/` or personal data is touched.
- Port **8091** was already occupied by an unrelated process during this review, so an untracked temporary config was used: Vite on **5174**, disposable PocketBase on **8092**, and the default **5173** was left untouched. The temporary config was removed after verification.
- Zoom was not directly automated. Width sweeps and Pixel 8 emulation were used instead; real browser zoom, touch keyboards and physical screens remain manual.

Commands used, from the repository root:

```sh
E2E_PORT=8092 bunx playwright test --config=.playwright-step18.config.ts --workers=1
E2E_PORT=8092 bunx playwright test --config=.playwright-step18.config.ts --workers=1 e2e/usability-journeys.spec.ts
E2E_PORT=8092 bunx playwright test --config=.playwright-step18.config.ts --workers=1 e2e/print-foundation.spec.ts --grep "print calibration"
bun run build
go -C server test ./...
```

The temporary config used the same web-server commands as `playwright.config.ts`, with `E2E_PORT=8092`, `E2E_API_PORT=8092`, Vite `--port 5174 --strictPort`, and base URL `http://127.0.0.1:5174`. `E2E_PORT` must also be set for the Playwright process so `e2e/fixtures.ts` talks to the same PocketBase instance.

## Journeys exercised

### GM preparation → live combat → player display

1. Open one encounter with an active combat and confirm the compact roster: one expanded participant, one editor and labelled secondary actions.
2. End the active combat through the GM UI, then use the reusable preparation and combat setup.
3. Confirm prepared quantities, manual/unknown HP copy and the 5e average-HP actions.
4. Start combat from setup and confirm the combat-setup rows are gone while the reusable preparation remains, six live participants appear, only one participant editor is open and only one current-HP field is visible.
5. Apply damage on the GM view, open the player-facing route in a second browser context, confirm the same HP and no loading replacement.
6. Change HP again from the GM and confirm the player updates in place.
7. Turn off enemy HP in player display settings and confirm the player stops showing it; restore it.
8. Turn off the active encounter and confirm the player empty state; re-enable it and confirm the roster returns.

### Player inventory → spellbook → print

1. Open the character inventory, search it, clear the search and open item-card printing.
2. Confirm the root-carried-only scope, counts and A7/A4 preview; generate an A4 PDF from the browser.
3. Return to the inventory, open the character overview, then the spellbook.
4. Search the book, expand a long spell with the keyboard, confirm the preferred long description, then exercise the no-match empty state and clear it.
5. Open spellbook card printing, confirm counts and warnings, generate an A4 PDF, return to the originating book query and step back/forward through the print history.

### Cross-cutting states

- **Browsing/back:** catalog URL state, browser Back/Forward, catalog history restoration, encounter query switching, spellbook `book=` return and print returns are covered by the existing specs and the new journey spec.
- **Long data:** the spellbook long description, catalog pagination and 20-participant live/realtime fixtures remain covered. The new width sweep expands the long spell in place.
- **Realtime:** GM/player updates stay in place without a loading replacement or roster reset.
- **Conflicts/reconnect/uncertain writes:** covered by `encounter-live`, `encounter-realtime`, `inventory`, `inventory-currency`, `spellbooks`, `random-tables` and `catalog-picker`; no new production behavior was changed in this step.
- **Empty/error:** the new journey spec covers inventory load failure then Retry, a no-match spellbook search, and the hidden player encounter. Existing specs cover catalog, picker, encounter, spellbook, inventory and random-table failures.
- **System contracts:** 5e automatic initiative/HP, AD&D manual order and supported HP rolls, unknown/manual systems, retained unsupported currency, player visibility and existing routes remain unchanged and are still covered by their prior specs.

## New acceptance coverage

`e2e/usability-journeys.spec.ts` adds four focused integrated tests:

1. **GM preparation, live combat and player display complete one coherent journey** — includes a compact-controls acceptance check (one `.combatant-details`, one current-HP input, collapsed add/display disclosures), prepared manual/unknown HP copy, start handoff, player visibility and in-place realtime updates.
2. **Player inventory, spellbook and print journeys keep their context** — includes search/empty states, keyboard expansion, print counts, PDF generation and route/book query restoration.
3. **Workspace screens stay usable from phone to large desktop widths** — desktop Chromium at 320, 390, 768, 1280 and 1920 CSS pixels for live encounters, inventory, long spellbooks and catalog; asserts no horizontal overflow and keeps catalog search focus/count while narrowing.
4. **Empty and error states recover without losing the journey** — inventory load failure then Retry, and a spellbook no-match state then clear.

The long-standing jump and excessive-combat-control concerns are covered by reproducible checks rather than by one exact reproduction of the owner's sequence:

- `e2e/catalog-history.spec.ts` keeps catalog search/filter/page context, focus and scroll behavior across typing, detail, Back and explicit returns.
- `e2e/usability-baseline.spec.ts` still measures the representative jump sequences.
- `e2e/usability-journeys.spec.ts` keeps catalog search focus and result count while narrowing, and asserts that only one live participant editor is open.
- `e2e/encounter-realtime.spec.ts` keeps the player roster and scroll in place during delayed authoritative updates.
- `e2e/encounter-live.spec.ts` covers 20 participants, compact roster, guarded writes and conflicts.

The owner's exact real jumping sequence is still unknown. These checks cover representative causes but cannot claim to be that exact sequence.

## Results

Final verification for this step:

- Full Playwright suite (`--workers=1`, desktop Chromium + Pixel 8): **285 passed, 11 skipped, 0 failed** in about 4.7 minutes after the spellbook cleanup change.
- Targeted `e2e/spellbooks.spec.ts` + `e2e/catalog-workspace.spec.ts` across both projects: **24 passed, 0 failed** in about 29 seconds, including the spellbook fixture-leak `afterAll` check.
- Final `e2e/spellbooks.spec.ts` rerun after the last cleanup edit: **16 passed, 0 failed** across both projects.
- New integrated journey spec: **7 passed, 1 skipped** (desktop and mobile; the explicit width sweep is desktop-only because Pixel 8 touch layout is covered separately).
- Browser print-to-PDF: calibration test passed on both projects, including the five-page Chromium PDF; the inventory and spellbook journey test also generated A4 PDFs.
- `bun run build`: passed. Only the existing chunk-size warning above 500 kB remains.
- `go -C server test ./...`: all packages passed.
- `bun run typecheck`: passed as part of the build.

The 11 skips are the existing project-conditional and opt-in skips: the two opt-in catalog-performance tests on both projects, four touch-only tests skipped on desktop, and three desktop-only shell/width tests skipped on mobile (including the new width sweep).

## Failures, flakes and fixes

The first full run failed one mobile catalog-workspace assertion because the database still contained catalog records created by earlier spellbook tests in the desktop run. The product was behaving correctly; the test assumed only its six workspace records existed after clearing search. The assertion now checks the six prefixed workspace rows instead of a global entry count. This is a test-isolation fix, not a product change.

A later full run hit an existing mobile encounter print-return flake: the test scrolled programmatically immediately after a return while a restoration frame was still scheduled, so the next print link recorded the previous position. The test now waits for two animation frames after the first restoration before recording the browser-back position. The product's real-user path is unchanged; programmatic scrolling does not fire the interaction events that intentionally cancel restoration.

The spellbook specs also left synthetic catalog records behind after the desktop project: their local cleanup tried to delete catalog records while required `spellbook_spells` relations still pointed at them, so PocketBase protected the records and the delete was not checked. This is now fixed at the spec-fixture level. The helpers track only the synthetic catalog, book and spellbook-entry IDs they create; `afterEach` deletes dependent `spellbook_spells` first, then the tracked books, then the tracked catalog records, tolerating 404 for records a test already removed. It runs even when a test fails and does not query or delete unrelated fixture records. An `afterAll` check asserts that no catalog record with this spec's synthetic key remains after either project. The targeted spellbook + catalog-workspace run and the full suite both passed after this change.

## Delivered decisions

- No broad redesign was made in step 18. No production files were changed; changes are limited to integrated tests and documentation.
- Step 18 is automated-test complete, not fully done: owner review and physical/printer/screen-reader/zoom validation are outstanding.
- No compression or production performance change was delivered, consistent with the owner's rejection in step 17.
- Item card eligibility remains root carried only; stash contents and container contents remain excluded.
- Existing route contracts remain: `/games/:gameId/encounter`, `/games/:gameId/encounters?encounter=`, `/games/:gameId/monsters/print?encounter=&returnEncounter=`, `/characters/:characterId/inventory/print`, `/characters/:characterId/spellbooks/:spellbookId/print` and `?book=` returns.
- Player display settings remain UI-only on a trusted LAN and are not access controls.

## Limitations

- Browser emulation only. No physical phone, tablet, laptop, touch keyboard, printer, scanner or screen reader was used.
- No real Wi-Fi/latency variation, server CPU allocation or native-memory profile was measured.
- Actual printer scaling, duplex registration, cut alignment and card thickness were not checked. PDF page count is verified, not physical output.
- No owner review was performed. The exact original jump sequence and the owner's most-used table actions remain unknown.
- Zoom was approximated by width sweeps and Pixel 8 emulation, not by changing real browser zoom.
- The full suite uses a disposable local database; behavior under a populated personal database or concurrent real users is not covered by this review.

## Questions for the owner

1. Which screen, browser/OS, device and approximate screen size or zoom are involved in the jump you still notice? What exact actions happen immediately before it (typing, filtering, scrolling, opening detail, returning, picker, realtime update, Back/Forward)?
2. Which of these do you use most often at the table: catalog search/filter, adding creatures/items/spells, live HP/initiative/conditions, random tables, printing, or something else?
3. For "excessive combat controls", do you mean too many always-visible controls, too many fields per participant, too many participants expanded, or something else? Which controls should stay one click away?
4. Which printer and paper/card formats will you use, and do you need long-edge or short-edge duplex? Please print the calibration page at 100% on the real printer.
5. Which screen reader and browser/OS should be prioritised, and which flow should be tested first?
6. Do you expect the catalog to default to PHB/MM source filters on first open, or should it show every source until you choose one?
7. Which physical device should be used for the next hands-on check, and is real Wi-Fi performance on that device still a concern?

## Small follow-ups

- Reproduce the owner's exact jump sequence and add a targeted regression only if it still occurs.
- Run a physical-device pass on the owner's phone/tablet and a printer calibration pass.
- Run one screen-reader pass on the GM live tracker and the player inventory/spellbook flow.
- Keep the spellbook fixture cleanup assertion in place, and use the same tracked-ID pattern if another spec starts creating shared catalog data.
- Revisit server-side catalog search only if real catalogs or real Wi-Fi measurements show a material delay; step 17 found none at the representative size.
