# Shared UI primitives

These are the small building blocks introduced in step 3 of `IMPROVEMENT_PLAN.md`. They are intentionally presentation-level: keep data loading, permissions, persistence and route state in the views or focused components. Do not add a design-system dependency or a second styling system.

## PageHeader

`src/components/PageHeader.vue` renders the compact eyebrow, `h1`, description and a toolbar slot. Use it for a routed screen's main heading when the screen has one primary action or a short toolbar. Keep exploratory or print screens on their existing layouts until their own step.

```vue
<section class="screen" aria-labelledby="page-title">
  <PageHeader eyebrow="GAME MASTER" title="Your games" description="…">
    <template #actions>
      <button class="primary-button" type="button">Create a game</button>
    </template>
  </PageHeader>
</section>
```

- Pass a stable `headingId` if the section uses something other than `page-title` for `aria-labelledby`.
- The title and description wrap anywhere, so long names do not create horizontal page overflow.
- The `actions` slot is the toolbar. Put one primary action there; move infrequent or destructive actions to an `ActionMenu`.
- On narrow screens the actions move below the heading rather than overflowing.

## ActionMenu and ActionMenuItem

`src/components/ActionMenu.vue` and `src/components/ActionMenuItem.vue` wrap Reka UI's accessible dropdown menu. Use a menu for secondary commands such as rename, duplicate, print and delete. Keep the main task as a visible button or link, and never hide the only path to a capability without a discoverable replacement.

```vue
<ActionMenu :label="`Game actions for ${game.name}`">
  <ActionMenuItem @select="beginEdit(game)">Edit game</ActionMenuItem>
  <ActionMenuItem danger @select="deleteGame(game)">Delete game</ActionMenuItem>
</ActionMenu>
```

- The trigger's accessible name must identify the object it acts on, not just say "Actions".
- Reka UI handles arrow-key navigation, Escape, item activation and returning focus to the trigger. Keep the trigger at least 44×44px.
- Add `danger` to `ActionMenuItem` for destructive commands.
- Menu items and the menu surface wrap long text instead of widening the page. The content is viewport-bounded and scrolls if necessary.
- If a future menu item needs to be a link, use Reka's `as-child` pattern around a router link rather than nesting a button in a link.

## FeedbackRegion

`src/components/FeedbackRegion.vue` is the shared loading/error/status line. It uses `role="status"` with polite announcements for progress and `role="alert"` with assertive announcements for errors. Wrap it in `.feedback-slot`, which reserves 44px of height so a loading message, error and success state do not move the toolbar or form below.

```vue
<div class="feedback-slot">
  <FeedbackRegion v-if="error" tone="error" action-label="Try again" @action="load">{{ error }}</FeedbackRegion>
  <FeedbackRegion v-else-if="loading">Loading games…</FeedbackRegion>
</div>
```

- Replace only the feedback area during a refresh; do not replace the whole workspace with a loading screen when the user may be reading or editing.
- Use the `action` event for a local retry control rather than adding unrelated buttons inside the message.
- Error copy should say what failed and what the user can do next.
- The loading mark stops animating under `prefers-reduced-motion: reduce`.

## Buttons and fields

Use the existing global classes rather than creating one-off sizes:

- `.primary-button` for the one main action in a context.
- `.secondary-button` and `.secondary-link` for normal alternatives and navigation.
- `.danger-button` for destructive actions.
- `.text-link` for an inline return or navigation link.
- `.text-input`, `.select-input`, `.text-area`, `.filter-field` and `.field-label` for form controls; always keep the visible label and `for`/`id` pair.
- `.row-actions` for a wrapping row of actions.

Controls keep a practical touch target (44px minimum, 46px for primary buttons and fields), a visible `:focus-visible` outline, and disabled styling. New interactive controls should reuse these patterns.

## Dense rows and responsive behavior

Rows such as `.game-row` use a compact desktop height, a flexible readable copy column and a wrapping action area. On phones the row wraps its actions below the copy and keeps every control tappable. Use `min-width: 0` on flexible copy containers and `overflow-wrap: anywhere` on user-supplied names so long unbroken text cannot force horizontal scrolling.

Test new row patterns at 320px, 390px, 640px, 768px, 1280px and a large desktop, including long names and browser zoom. Include keyboard focus, Escape/focus return, and reduced motion when changing the shared primitives.

## Step 3 usage and checks

`GamesView.vue` is the representative screen: it uses `PageHeader`, `FeedbackRegion`, `ActionMenu` and the existing button/field classes. `e2e/ui-primitives.spec.ts` covers the menu's keyboard focus/return, the labelled appearance dialog and its focus return, reserved loading/error geometry, reduced motion, and long-name wrapping without horizontal overflow on desktop and phone emulation. This is browser emulation, not physical-device, screen-reader or printer validation.

## CatalogPicker

`src/components/CatalogPicker.vue` is the shared contextual catalog picker used by inventory items, spellbooks, encounter creatures and table references. It is a controlled Reka UI dialog: the caller owns `open`, decides whether a `select` handler closes it, and can pass authoritative async feedback.

```vue
<CatalogPicker
  v-model:open="pickerOpen"
  :system-id="systemId"
  type="spell"
  title="Choose a spell"
  :taken-ids="takenSpellIds"
  taken-label="Already in this book"
  :pending="pickerPending"
  :feedback="pickerFeedback"
  @select="addSpell"
/>
```

- Always render the picker in the screen and drive it with `v-model:open`; do not wrap it in a `v-if` editor panel. A modal dialog keeps the underlying page position stable, and Reka returns focus to the control that opened it.
- `select` fires only after the user activates an enabled result. The picker never closes itself, so a caller that supports repeat adds can leave it open and keep the search text; a caller that wants one-shot selection closes it in the same handler.
- Use `takenIds`/`takenLabel` when the caller enforces uniqueness (for example, a spell can only appear once in a spellbook). Taken rows are visibly disabled instead of failing silently.
- Async callers must set `pending` for the whole write and its reconciliation, not just the click. While pending, every result is disabled, the caller's pending feedback replaces any prior success/error, and repeat selection is unavailable. Callers still keep a synchronous re-entry guard because two click events can arrive before Vue renders the disabled state; do not clear pending until the authoritative list refresh finishes.
- Use `feedback` for the authoritative pending/success/error message from the caller. The picker does not announce a selection on its own, so a failed create never looks like a successful add. After success, clear pending and provide success feedback before allowing repeat selection.
- Each instance generates its own search/results IDs with Vue `useId`, so mounting multiple pickers cannot duplicate input IDs.
- Filters remain the collapsible `CatalogFilters` disclosure. Source identity comes from the system `resultLabel`, so same-name records from different imports stay distinguishable. Filter edits made while the catalog is loading are preserved; arriving default filters only apply when the user has not touched them.
- Distinguish only explicit non-timeout client validation/authorization rejections (for example 400, 403, 404, 409 and 422) from ambiguous failures. Treat 408, 5xx, aborts and network errors as uncertain because the server may already have committed the write. For an uncertain create, say the outcome could not be confirmed and direct the user to refresh before retrying; keep selection disabled until a successful authoritative page refresh. Never claim “not added” or invite a blind retry when the response was lost.
- A caller whose create succeeds but whose follow-up refresh fails must report “added, but refresh failed”, keep pending set, and offer a refresh retry rather than invite another create. That retry must reload instead of repeating the completed write.
- Opening focuses the search field without scrolling the underlying page, a retry keeps the picker open, and closing (button, Escape or selection) restores the invoking control and the saved page scroll.

`e2e/catalog-picker.spec.ts` covers item, spell, creature and table-reference flows on desktop Chromium and Pixel 8 emulation, including delayed loads with typed input/filter edits, catalog retry, delayed create double clicks, an explicit validation rejection with safe retry, a server-committed create whose network response is lost, a server-committed create that returns 500, refresh-before-retry recovery with no duplicate replay, successful-create/refresh-failure retry without duplicate writes, creature pending held across a slow refresh, duplicate spellbook rows, repeat creature adds, focus/scroll restoration and generated input IDs.
