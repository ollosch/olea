# Olea campaign manager: implementation plan

> Purpose: this is the source of truth for a fresh implementation session. Read `docs/REFERENCE.md` first, then this file, before editing code. Do not restore the removed frontend. Build a new UI from a clean slate.

## Goal

Turn Olea into the single tool for the user's D&D campaign:

- mechanics first: catalog, characters, encounters/combat, player view, inventory/currency, random tables, spellbooks/print as needed;
- then campaign/world content: NPCs, locations, groups, events, threads, notes, maps;
- one executable, local network, no authentication (trusted LAN);
- database is the source of truth; markdown export is optional, not a live second store.

The user will test drive the importer and a proof-of-concept editor for about an hour before the rest is built. The PoC is not the final UI.

## Current progress

- Batches 1–4 are complete on `feat/campaign-manager`: schema migrations, the vault importer, asset/map handling, closure paths, FTS, server-side search, rebuild hooks and the world snapshot endpoint.
- `poc_data/` is imported from the real vault and is ready for the PoC; `pb_data/` is untouched.
- The frontend is still the placeholder. Next is the **frontend design handoff**: the user describes the UI first. Do not start Batch 5 until that description exists; record durable UI decisions in this plan, then implement Batch 5 (shell, Pinia world store, list/local search, campaign filter, detail), Batch 6 (edit/create) and Batch 7 (acceptance, docs refresh, full verification).
- Treat the backend as frozen for the PoC except for fixes: do not redo the schema, importer, hooks or routes, and do not remove backend capabilities before the frontend exists.

## Authoritative decisions

1. **DB-primary.** All content lives in Olea's SQLite database. Obsidian is no longer a live source. A one-time importer reads the existing vault; markdown export is a portability feature.
2. **Campaign 1—* Games.**
   - `systems` = rulesets: D&D 5e, AD&D 2e, OSE.
   - `campaigns` = narrative/world continuity (Almost Titans, Fate's Children). Owns world entities, notes, maps, sessions.
   - `games` = mechanics instance inside a campaign: system, players, characters, encounters, inventory, combats. Has `campaign_id` (nullable for one-shots).
   - Entities are many-to-many with campaigns. A campaign can have multiple games over time; switching rules creates a new game, not a new campaign.
   - Rules content is system-scoped (`scope = rules`, `system_id`), not campaign-scoped.
3. **The engine must live in one app.** No file-first + derived-index split. The graph, prose, maps, and mechanics all live in Olea.
4. **No data preservation in Olea.** The current `pb_data` is test data. Use a separate `poc_data/` directory for the PoC/import so `pb_data/` is untouched. A fresh data directory is the default; migrations create the schema.
5. **Mechanics first, but import early.** Build mechanics screens first, but implement the importer and a minimal world-notes editor early so new NPCs/locations are added in Olea, not Obsidian.
6. **Markdown, extended.** CommonMark/GFM stored as raw markdown, with a small explicit extension layer for wikilinks, embeds, maps, and deferred-entity tokens. Do not use MDX or a block-JSON editor.
7. **Player content is mechanics-only for now.** No player-facing lore wiki. Player view covers encounters/combat.
8. **Deferred:** branch exclusion UI (but keep `entity_paths`, `scope`, `system_id` in the model), full schema-editor UI, print/cards parity, container hierarchy parity, Excalidraw/canvas, player lore.
9. **Timeline is disposable example content.** All notes under `Timeline/` are examples and are no longer needed. The importer must skip the `Timeline/` folder and report the skipped count; the schema still supports `event`/`thread` entities for future content.
10. **Client-memory cache, DB and backend unchanged.** The database remains the source of truth. The PoC frontend hydrates the whole world — campaigns, entities (including bodies), relation types, relations, mentions, maps, map markers; images stay lazy via `/olea/assets/` — through `GET /api/olea/world` into a Pinia world store. Browse, detail, backlinks, link resolution, type/campaign filters and search run in memory, as in Olgur. Keep the importer, hooks, `entity_paths`, `entity_fts` and `/api/olea/search` as the server-side fallback and for future scale. Edits still go through PocketBase; after a save, patch the store from the response and refresh or use realtime for other clients.
11. **Do not remove backend capabilities for the PoC.** The snapshot is an additional read-only hydration path, not a replacement. Do not delete `/api/olea/search`, `/olea/assets/{path...}`, the admin rebuild route, FTS or closure tables while the frontend is being built; the frontend has not yet proved what is unused. Revisit dead-code removal after Batches 6–7.

## Workflow: subagents, git, reference, QMD

### Branch and commits

- Work on a dedicated branch: `feat/campaign-manager` off `main`.
- Make **atomic conventional commits** on that branch. One logical change per commit, with a scoped message:
  - `feat(world): add entity and relation migrations`
  - `feat(import): import vault frontmatter, relations and assets`
  - `feat(ui): add entity list, detail and editor`
  - `test(import): cover unresolved relations and missing assets`
  - `docs: update campaign manager reference`
  - `chore: ignore poc data`
- Do not commit `data/`, `pb_data/`, `poc_data/`, generated frontend output, binaries, or personal content.
- Do not amend or force-push. If a commit is wrong, follow with a fix commit.

### Subagents

Use subagents for all implementation tasks, not only large ones. The main agent orchestrates, reviews, integrates and handles merge/rebase fixes.

- Give one subagent a batch of **3–5 related tasks** where the tasks are small or closely coupled, then start a fresh subagent for the next batch. Use judgment: a schema migration that everything depends on should be its own batch; three independent UI panels can share one batch.
- Do not parallelize work that touches the same files, migrations or shared modules. Parallel subagents must use separate git worktrees and branches, then be integrated serially by the main agent.
- Every subagent prompt must require:
  1. read `docs/REFERENCE.md` first;
  2. read `docs/campaign-manager-plan.md`;
  3. confirm the branch and do not switch branches;
  4. stay inside the named scope and files;
  5. make atomic conventional commits;
  6. run the relevant verification;
  7. do not touch `pb_data/`, `data/` or `poc_data/`;
  8. do not restore the removed frontend;
  9. ask before changing an authoritative decision.
- The main agent reviews each subagent's commits before starting the next batch. Do not let a subagent "fix everything"; keep the batch scoped.

### Reference document

- `docs/REFERENCE.md` is the shared orientation document. It summarizes the app, collections, packages, helpers, commands and conventions so subagents do not re-analyse the whole repository.
- Refer every subagent to it explicitly.
- When a subagent changes architecture, adds a major collection/package, or finds the reference stale, update `docs/REFERENCE.md` in the same batch with a `docs:` commit.

### QMD MCP

- If QMD MCP is configured in the session, use it when semantic lookup of code or docs is faster than broad file exploration.
- Treat QMD hits as leads, not truth: verify the relevant source before editing.
- If QMD is not configured, use the normal search/read tools. Do not use QMD as a substitute for reading this plan or `docs/REFERENCE.md`.

## Stack

Keep the existing backend and domain packages. Do not rewrite the Go domain logic that is already tested (catalog, inventory, currency, encounters/combat, random tables, imports).

Frontend:

- Vue 3 + TypeScript + Vite + Tailwind CSS 4.
- **Pinia** for shared app state. Use stores for current campaign/game/character, entity search, and meta data; keep local UI state in components.
- **VueUse** for utilities (`useLocalStorage`, `useDebounce`, `useMediaQuery`, `useEventListener`, `useClipboard`, `useDateFormat`, etc.).
- **Reka UI** selectively for accessible complex primitives: Dialog, AlertDialog, DropdownMenu, Popover, Tabs, Tooltip, Combobox, Select, Accordion. Use native elements for simple buttons/inputs. Reka is unstyled; Tailwind handles appearance. The accessibility benefit is worth the small integration cost.
- **CodeMirror 6** for markdown editing (`@codemirror/lang-markdown`, `@codemirror/autocomplete`, `@codemirror/view`, `@codemirror/state`, `@codemirror/commands`).
- **markdown-it** + plugins for rendering; **DOMPurify** for sanitizing rendered HTML.
- **Leaflet** later for image maps; keep it out of the PoC unless trivial.
- PocketBase SDK `0.28.1`.
- Current `package.json` contains only Vue, Vue Router, Reka UI and PocketBase. Add Pinia, VueUse, CodeMirror 6, markdown-it and DOMPurify during Batches 5–6; do not assume they are installed.

Backend:

- Go + embedded PocketBase v0.39.7 (pinned).
- PocketBase collections for CRUD/realtime/admin.
- Raw SQLite via `app.DB()` for FTS5, closure tables, and custom query routes.
- Confirmed: the driver has `ENABLE_FTS5` and JSON1. SQLite supports recursive CTEs.
- Custom routes are fine; keep them behind `/api/olea/`.

Use Context7 for current PocketBase, Vue, Pinia, CodeMirror, and markdown-it docs when unsure.

## Data model

### PocketBase collections

Create via versioned migrations in `server/migrations/`.

#### `campaigns`

- `key` text, required, unique (e.g. `almost-titans`, `fate`)
- `name` text, required
- `description` text
- `color` text (optional)
- public rules (trusted LAN)

#### `entities`

- `name` text, required
- `type_class` select: `location`, `actor`, `group`, `concept`, `thread`, `event`, `note`
- `template` text (raw template from the vault, e.g. `settlement`, `npc`, `plane`)
- `source_type` text (raw `type` from the vault, for traceability)
- `status` text (raw; empty means active for display)
- `folder` text (relative folder path from the vault)
- `event_date` text (ISO date or raw date string; index for sorting)
- `data` JSON (frontmatter `data`)
- `links` JSON (editable frontmatter-style links; relations are derived from this)
- `meta` JSON (frontmatter `meta`)
- `aliases` JSON (frontmatter `aliases`)
- `body` text (markdown body)
- `campaigns` multi-relation to `campaigns`
- `scope` select: `world`, `rules`, `notes`
- `system` relation to `systems` (nullable; for rules content)
- `source_path` text, unique (idempotent import key)
- `source_hash` text
- public rules

Indexes: `type_class`, `template`, `source_path` unique, `event_date`, `folder`.

#### `relation_types`

- `key` text, required, unique
- `label` text, required
- `inverse_label` text, required
- `hierarchical` bool
- `source_classes` JSON (empty = any)
- `target_classes` JSON (empty = any)
- `notes` text
- public read; admin writes

Seed known types (see below). Import auto-creates unknown keys with a generic inverse and reports them.

#### `relations`

- `from` relation to `entities`, required
- `to` relation to `entities` (nullable when unresolved)
- `type` relation to `relation_types`, required
- `unresolved_name` text (target name when `to` is empty)
- `note` text
- public rules

Indexes: `from`, `to`, `type`; unique `(from, to, type)` where `to` is not empty (or dedupe in code).

#### `mentions`

- `source` relation to `entities`, required
- `target` relation to `entities` (nullable)
- `target_name` text, required
- public rules

Indexes: `source`, `target`, `target_name`.

#### `maps`

- `name` text, required
- `campaign` relation to `campaigns`
- `image` text (served asset path)
- `config` JSON (leaflet config: id, lat, long, zoom, unit, scale, etc.)
- public rules

#### `map_markers`

- `map` relation to `maps`, required
- `entity` relation to `entities`
- `x` number, required (normalized 0–100 percentage)
- `y` number, required (normalized 0–100 percentage)
- `label` text
- public rules

Map marker coordinates are stored as normalized 0–100 percentages; the renderer converts them to image/leaflet coordinates. This keeps markers independent of the source image dimensions.

### Raw SQLite tables

Create via migration using `app.DB().NewQuery(...)`.

#### `entity_paths`

Closure table for hierarchical relations.

- `ancestor_id` text, required
- `descendant_id` text, required
- `depth` integer, required
- primary key `(ancestor_id, descendant_id, depth)`
- index `(descendant_id, ancestor_id)`

Rebuild after import and after relation changes. For the PoC, a full rebuild is fine (hundreds of entities). Guard against cycles.

#### `entity_fts`

FTS5 virtual table.

```sql
CREATE VIRTUAL TABLE entity_fts USING fts5(
  entity_id UNINDEXED,
  name,
  body,
  type_class,
  template,
  folder
);
```

Maintain with Go code on entity save/delete, or triggers. For the PoC, rebuild after import and after save. Index plain text extracted from markdown (strip syntax), not raw markdown.

### Assets

For the PoC, store copied images in `<dataDir>/olea-assets/`. The importer copies files with a content-hash prefix (e.g. `sha1-shortname-filename.png`) and rewrites image embeds in the body to `/olea/assets/<filename>`. Add a custom GET route:

```text
GET /olea/assets/{path...}
```

Serving from the data directory is simpler than PocketBase file fields and works in the embedded executable. Move to PB file storage later only if needed.

## Type normalization

Map raw `type` to `type_class`:

| raw type | type_class |
|---|---|
| `location` | `location` |
| `actor` | `actor` |
| `group` | `group` |
| `event` | `event` |
| `thread` | `thread` |
| `plot` | `thread` |
| `creature` | `concept` |
| `setting` | `concept` |
| missing | infer from folder, else `note` |

Folder inference:

- `World/Locations` → `location`
- `World/Actors` → `actor`
- `World/Groups` → `group`
- `World/Creatures` → `concept`
- `World/Settings` → `concept`
- `World/Items` → `concept`
- `Timeline/Events` → `event`
- `Timeline/Threads` → `thread`
- `Rules` → `concept` with `scope = rules`
- `Campaigns` / `Notes` / `Files` / root → `note`

Preserve `source_type` and `template`. Do not block import on unknown templates. Report them.

Status: use top-level `status`; if absent, look at `data.Status` and copy it to `status` for display, but preserve `data` untouched. Empty means active.

Event date: use frontmatter `date` or the `YYYY-MM-DD` filename prefix. Store in `event_date`.

Campaign inference:

- Frontmatter `campaigns` array wins.
- If no array and path is under `Campaigns/<Name>/`, infer campaign from `<Name>` (slugify to key).
- If no campaign, entity is global (`campaigns = []`).
- Rules content is not campaign-scoped.

## Relation types to seed

Auto-create unknown keys. Seed these with sensible labels/inverses. Use `hierarchical = true` for `In`, `in`, and `Übergruppe`.

| key | label | inverse_label | hierarchical |
|---|---|---|---|
| `In` | In | Enthält | true |
| `in` | In | Enthält | true |
| `Übergruppe` | Übergruppe | Untergruppen | true |
| `Lebt in` | Lebt in | Bewohnt von | false |
| `Gruppen` | Gruppen | Mitglieder | false |
| `Herrscher` | Herrscher | Herrscht über | false |
| `Besitzer` | Besitzer | Besitzt | false |
| `Betreiber` | Betreiber | Betrieben von | false |
| `Betreibt` | Betreibt | Betrieben von | false |
| `Anführer` | Anführer | Angeführt von | false |
| `HQ` | HQ | Hauptquartier von | false |
| `Geber` | Geber | Gibt Auftrag | false |
| `Quest` / `Quests` | Quest | Quest von | false |
| `Religion` | Religion | Verehrt von | false |
| `Regent` | Regent | Regiert | false |
| `Freunde` | Freunde | Freunde von | false |
| `Feinde` | Feinde | Feinde von | false |
| `Vater` | Vater | Kind von | false |
| `Mutter` | Mutter | Kind von | false |
| `Sohn` | Sohn | Elternteil von | false |
| `Kinder` | Kinder | Elternteil von | false |
| `Brüder` | Brüder | Geschwister von | false |
| `Onkel` | Onkel | Nichte/Neffe von | false |
| unknown | key | `verweist auf` | false |

Normalize obvious duplicates during import only if safe: `in` → `In`, `Quest`/`Quests` → `Quests`, `group`/`Gruppen` → `Gruppen`. Report every rename.

## Importer

Add a Go command:

```sh
go -C server run . --dir=<data-dir> import-vault <vault-path>
```

Or a subcommand on the existing Cobra root. Requirements:

1. Walk all `.md` files in the vault. Skip `.obsidian`, `.trash`, and `Timeline/` (disposable example notes; report the skipped count).
2. Parse YAML frontmatter and body. Use `gopkg.in/yaml.v3`.
3. Build a name/alias → entity map. Fail-safe on duplicate basenames (warn; first wins, report).
4. Create campaigns from frontmatter and folder inference.
5. Upsert entities by `source_path`; compute `source_hash` and skip unchanged. For a fresh import, create all.
6. Create relation types from all `links` keys.
7. Create relations from `links`:
   - values may be string, list, or nested list; flatten defensively;
   - resolve by exact basename or alias;
   - if unresolved, set `unresolved_name`;
   - dedupe `(from, to, type)`;
   - skip self-relations with a warning.
8. Create mentions from body wikilinks (`[[Target|Label]]`, `[[Target#Heading]]`). Ignore image embeds for mentions.
9. Copy image assets:
   - resolve `![[...]]` and `[[...]]` targets by basename;
   - copy to `<dataDir>/olea-assets/` with content-hash prefix;
   - rewrite image embeds to `![alt](/olea/assets/<file>)`;
   - report missing images.
10. Parse ` ```leaflet ` blocks:
    - create/update a `maps` record with config and the image asset;
    - replace the block with `:::map{mapId=<map record id>}`; rendering can come later;
    - report the maps.
11. Build `entity_paths` from hierarchical relation types.
12. Rebuild `entity_fts` from all entities (plain text).
13. Print a JSON report to stdout: counts (entities, relations, mentions, assets, maps), warnings, unresolved names, unknown types/templates, duplicate basenames, missing assets.
14. Exit non-zero only on fatal errors.

The importer must be idempotent. Re-running it on the same vault with the same data directory must not duplicate entities/relations.

Use a separate `poc_data/` directory for testing. Do not write to `pb_data/`.

## PoC editor

A minimal new Vue app, not the final UI. It should be isolated enough to replace screen by screen.

Screens:

- `/` → redirect to `/entities`.
- `/entities`: search input (in-memory search over the hydrated store; `/api/olea/search` remains a fallback), type filter, campaign filter; list rows with name, type/template, campaign chips, folder.
- `/entities/:id`: read view — title, infobox (source type/template, `data`, resolved `links`), rendered markdown body with internal links and images, edit button.
- `/entities/:id/edit`: form — name, type_class select, template, status, campaigns multiselect, `data` JSON editor, `links` JSON editor, body CodeMirror editor; save.
- Create button: blank entity form.

Behavior:

- Hydrate the world once from `GET /api/olea/world` into a Pinia world store. Build in-memory indexes: entity by id, name/alias, type, campaign, folder; relations by from/to; mentions by source/target. Detail views read from the store, not per-note GET requests.
- Use Pinia for current campaign, world snapshot and entity search/list state.
- Use VueUse for debounced local search, localStorage for the selected campaign.
- Use Reka UI for dialogs/menus if needed; native controls are fine for the PoC.
- Render markdown with markdown-it; resolve `[[Name]]` to internal links via the in-memory name/alias map; sanitize with DOMPurify. Compute backlinks from the loaded bodies and relations.
- On save, update the entity through PocketBase, patch the in-memory entity, then refresh the snapshot or the affected entity; the server hook syncs relations/mentions and rebuilds `entity_paths` and FTS.
- Show a visible save result and error message. Keep it simple.
- Do not build the final navigation, campaign manager, maps, or mechanics UI in the PoC.

Campaign filtering:

- Default list = current campaign + global entities (`campaigns = []`).
- Campaign switcher in the header; persist selection.
- "All campaigns" toggle optional.
- Global entities get a badge.
- Do not write per-component filter or search logic; centralize it in the Pinia world store/composable query builder.

## Custom backend routes

- `GET /api/olea/world` — one-shot world snapshot for the Pinia cache: campaigns, entities (bodies included), relation types, relations, mentions, maps, map markers, plus a content revision digest.
- `GET /api/olea/search?q=&type=&campaign=&exclude=&limit=` — FTS5 fallback for server-side search; not required by the cached PoC UI.
- `POST /api/olea/admin/rebuild` — rebuild paths/FTS (dev-only or trusted LAN).
- `GET /olea/assets/{path...}` — serve copied assets.

Keep `pb_data/` untouched; use `poc_data/`.

## Implementation order

Do not use calendar timetables. Work in dependency order.

1. **Schema reset for the PoC — done.**
   - Migrations for `campaigns`, `entities`, `relation_types`, `relations`, `mentions`, `maps`, `map_markers`.
   - Raw migrations for `entity_paths` and `entity_fts`.
   - Systems and relation types seeded.
2. **Importer — done.**
   - Parsing, normalization, campaigns, entities, relations, mentions, assets, maps, paths, FTS.
   - Imported into `poc_data/`; the report is clean enough to inspect.
3. **PoC editor — blocked on frontend design.**
   - First capture the user's frontend design: screens/routes, shell and navigation, list/detail layouts, editor behavior, markdown interactions, campaign switcher and visual direction. Ask before filling gaps.
   - Batch 5: shell, API client, Pinia world store hydrated from `/api/olea/world`, entity list/local search, campaign filter, detail.
   - Batch 6: edit/create, markdown rendering, save flow.
   - Wire save → server relation/path/FTS hook, then patch the in-memory store.
4. **Verification**
   - Go tests, `bun run typecheck`, `bun run build`.
   - Manual test drive: open random entities, search, filter by campaign, edit/save, create an NPC.
5. **Stop and hand off**
   - The user test drives for about an hour.
   - Then build the rest together.

## Suggested subagent batches for the PoC

These are batches, not timetables. Adjust only if the code forces a different dependency order.

- **Batch 1 — schema foundation (done):** migrations for `campaigns`, `entities`, `relation_types`, `relations`, `mentions`, `maps`, `map_markers`; raw `entity_paths` and `entity_fts`; seed relation types/systems.
- **Batch 2 — importer core (done):** vault walk and YAML parsing; normalization/campaign inference; entity upsert; relation types and relations; mentions.
- **Batch 3 — importer finish (done):** asset copy/rewrite; leaflet map extraction; closure paths; FTS rebuild; JSON report; importer tests.
- **Batch 4 — backend lookup (done):** search route with filters; asset serving route; relation/FTS rebuild hook; world snapshot route for the client cache; focused Go tests.
- **Batch 5 — frontend shell and browse (next, blocked on frontend design):** capture the user's UI design first; then new Vue shell; API client; hydrate the world snapshot into a Pinia store with in-memory indexes; entity list/local search; campaign filter; detail view. Aim for 4–5 tasks.
- **Batch 6 — frontend edit/create (pending):** CodeMirror editor; data/links editors; save + relation sync; create entity; markdown rendering with wikilinks/images. Aim for 4–5 tasks.
- **Batch 7 — verification and reference (pending):** re-import only if the importer changed; run acceptance checks; refresh `docs/REFERENCE.md`; run Go tests, typecheck and build. Aim for 3–4 tasks.

The main agent owns integration between batches. Parallelize only with separate worktrees and branches; never let two subagents write the same worktree concurrently.

## Verification commands

```sh
bun run typecheck
bun run build
go -C server test ./...
```

For the importer (run from the repository root; `go -C server` sets the working directory to `server/`):

```sh
go -C server run . --dir=../poc_data import-vault /home/ollo/Documents/Share/Obsidian/DnD
```

`poc_data/` is already imported. Re-run only when the importer or the source vault changes.

For development:

```sh
bun run dev:all -- ./poc_data
```

If ports are occupied, set `OLEA_API_PORT` / `OLEA_FRONTEND_PORT`.

## Acceptance criteria for the PoC

- All vault markdown notes outside `Timeline/` are imported (or explicitly reported as skipped); `Timeline/` is skipped as disposable example content.
- Entities preserve raw `type`/`template`, normalized `type_class`, folder, body, data, links, aliases, campaigns.
- Relations resolve by name/alias; unresolved targets are reported, not silently dropped.
- Images are copied and render in the detail view.
- Search returns expected results; type and campaign filters work.
- The frontend hydrates the world once; entity browse, search, backlinks and detail work without per-note GET requests.
- The server-side search route, asset serving, snapshot and rebuild hooks still pass their tests.
- No custom GET route or derived table is deleted while the frontend is being built; cleanup is revisited after Batches 6–7.
- Branch exclusion is not implemented, but the schema supports it (`entity_paths`).
- Editing an entity saves name/data/links/body; relations and paths update.
- Creating a new NPC/location works and appears in search/list immediately.
- `pb_data/` is untouched.
- Existing Go tests and `bun run typecheck` pass.

## Fresh session prompt

Use this as the first message in a new opencode session opened in `/home/ollo/Code/olea`.

The prompt is intentionally a **design handoff**, not a build instruction. Paste your frontend description where indicated; do not expect Batch 5 to start before that.

```text
Read docs/REFERENCE.md first for orientation, then docs/campaign-manager-plan.md. The plan is the authoritative design and implementation plan for turning Olea into a campaign manager. Follow it exactly unless I say otherwise.

Work on the existing branch feat/campaign-manager. Batches 1–4 are already complete: schema, importer, assets/maps, paths/FTS, search, rebuild hooks and the world snapshot endpoint. poc_data is imported. Do not redo or rewrite that backend work.

Do NOT start Batch 5 yet. First read the frontend design I provide below. If any screen, interaction, component, route or visual decision is missing or ambiguous, ask me before coding. Summarize the design back to me and record durable decisions in docs/campaign-manager-plan.md. Only after that, implement Batch 5 (shell/browse), then Batch 6 (edit/create), then Batch 7 (verification).

Frontend design:
[PASTE THE FRONTEND DESIGN HERE]

The PoC frontend is DB-primary with a client-memory cache. Hydrate GET /api/olea/world into a Pinia world store and do browse, detail, backlinks, link resolution and search in memory, like /home/ollo/Code/olgur. Keep the backend and /api/olea/search as the fallback. Images stay /olea/assets/... URLs. Do not remove backend routes or derived tables.

Make atomic conventional commits on feat/campaign-manager. Do not amend or force-push. Do not commit data/, pb_data/, poc_data/, generated frontend output, binaries or personal content.

Use subagents for all implementation tasks. Give each subagent a batch of 3–5 related tasks, then start a fresh subagent for the next batch. The main agent orchestrates, reviews each batch, and integrates. Do not parallelize work that touches the same files or shared modules; if parallelizing, use separate git worktrees and branches and integrate serially. Every subagent prompt must tell it to read docs/REFERENCE.md and docs/campaign-manager-plan.md first, stay in scope, make atomic conventional commits, run the relevant verification, not touch pb_data/, data/ or poc_data/, and not restore the removed frontend.

If QMD MCP is configured, use it when semantic code/docs lookup saves time; verify hits in source. If it is not configured, use the normal search tools. Do not use it instead of reading the plan and reference.

Use Pinia, VueUse, Reka UI selectively, CodeMirror 6, markdown-it and DOMPurify. Pinia, VueUse, CodeMirror 6, markdown-it and DOMPurify are not installed yet; add them in the frontend batches. Run go -C server test ./..., bun run typecheck and bun run build. Report verification, commits, and anything you changed from the plan.
```
