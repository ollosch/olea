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
