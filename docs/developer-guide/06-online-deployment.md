# 06 — Adding online access later

## The short answer

Yes, it is feasible without changing the stack. It is not just adding a login page. For a small private table, a host-controlled VPN connecting trusted participants to the existing server is a smaller operational change than turning Olea into a public multi-tenant service. For a public service, authentication, authorization, catalog ownership, privacy, migration and operations form a substantial separate project. The difficulty depends on whether one trusted group shares one installation or many unrelated groups share one server; estimate only after choosing that model and auditing every path.

Neither the UI improvement plan nor this guide implements online access. Discuss a deployment or stack change with the owner before doing it.

## What exists today

- The app listens on a LAN interface by default and stores data locally; it serves Vue, ordinary PocketBase collection endpoints and custom routes (`server/main.go`).
- `profiles` are ordinary records for display/ownership labels and preferences, not accounts. Their IDs do not prove identity.
- `setPublicRules` gives many collections public CRUD. Several views call PocketBase collection CRUD directly. Custom routes use `re.App` and do not authenticate a user or enforce membership.
- `encounter_visible` and other switches change the player-facing UI. A connected client can still access data through the public API; hiding enemy details is not an authorization boundary.
- Catalog records are system-wide, not scoped to an owner or game; current unique identity includes system/type/source/source_id, with no user or tenant key.

Consequently, a reverse-proxy password or login-gated home page alone is insufficient for mutually untrusted users, and the current application must not simply be exposed on the public internet as a secure multi-user service.

## Three possible models

| Model | What changes | Key limitations |
|---|---|---|
| Existing trusted LAN | No product change. All connected participants are trusted with API access. | No remote access unless networking provides it; UI privacy is not security. |
| Private VPN to one host | VPN setup/access management and reliable host connectivity; app can continue to serve its private interface. | VPN members still have the same broad API access. Does not create per-user secrecy or legal rights to share content. |
| Hosted service for separate groups | Real identities and permissions; tenant isolation; operational deployment; migration and content policies. | Substantial code/testing/operations work; hosting and sharing source material need rights review. |

PocketBase is designed to provide authentication, collection rules and realtime, but existing rules and custom endpoints have to be redesigned and tested. Laravel also offers authentication and realtime integrations, and can retain Vue; choosing it would require migrating the current database, import behavior, transactions and client API, not merely enabling hosting. PocketBase's pre-1.0 backward-compatibility warning makes pinned versions and tested upgrades important. The current stack remains a reasonable choice for Olea's present use.

## A hosted-service work breakdown

This is a risk map, not an implementation plan or a claim that existing code enforces it:

1. **Decide trust and content boundaries.** Is a catalog owned by an individual, a campaign or a server? Can a user belong to multiple campaigns? Are GM notes secret from players? Can references be shared or copied? Decide who can upload, view, change, delete and export each type of record.
2. **Add authenticated identities and membership.** Model account-to-game roles and character access independently from current local profile labels. Provide account lifecycle and a migration/adoption path for existing games and profiles. A successful login establishes identity, not authorization.
3. **Enforce authorization everywhere.** Restrict every collection operation, expansion, relation, file and realtime subscription. Protect custom routes independently: check the authenticated caller against all affected source and destination records inside the relevant operation. Audit other routes, admin surfaces, imports and background jobs. Filtered UI is only a projection of server permissions.
4. **Redesign catalog tenancy and identity if users bring their own sources.** A global `(system,type,source,source_id)` key can merge users' records and expose or overwrite their edits. Choose tenant/catalog ownership, scoped uniqueness, data migration and reference remapping; preserve stable IDs where possible. Make cross-tenant references impossible without explicit authorized sharing.
5. **Protect secrets and manage operations.** HTTPS, a well-defined reverse-proxy trust boundary, credential/token handling, rate limiting, service updates, monitoring, full backups, verified restore, capacity and incident response all become service responsibilities. Review SQLite's single-host operational fit against the actual workload before changing database or stack.
6. **Test adversarially.** Use at least two unrelated users/groups, a GM and a player. Test ordinary API operations, custom routes, direct IDs, expansions, realtime, file access, cross-game transfers, notes, exports, account revocation and migration. A denied UI control alone is not a security test.

If the goal is just “connect to my existing table remotely,” start with the VPN model and evaluate whether all participants really are trusted with all data. If the goal is a hosted product with isolated campaigns, treat the breakdown above as prerequisites to exposure.

## Copyright and user-supplied data

A login gate or the fact that a user supplied a file does not automatically grant the operator or other users permission to copy, store, host, render or share copyrighted content. Whether a particular use is allowed depends on ownership, licenses, applicable exceptions and jurisdiction. Keeping content private can affect the facts, but it does not itself settle them. Before hosting or enabling sharing, inspect the licenses/terms of the actual sources and obtain appropriate legal advice for the intended service. The software does not currently bundle reference material.

## Checkpoint

Why is a system-wide catalog the difficult part of adding accounts?

**Suggested answer:** Its records and stable-identity index currently have no owner. Two users importing the same identity would reach the same global record; their source data and user-authored notes could collide or become accessible across groups. A hosted design must define ownership, uniqueness, permissions and migration for existing references, not just put a login screen in front of `/games`.

Further reading: [PocketBase project](https://github.com/pocketbase/pocketbase), [PocketBase API rules](https://pocketbase.io/docs/api-rules-and-filters/), and [Laravel broadcasting](https://laravel.com/docs/13.x/broadcasting). Verify documentation against the pinned versions before implementation.
