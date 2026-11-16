# RBAC, permissions, audit and API keys

Accepted 2026-11-16 with every default (D-310 to D-313). The epics are #263 to #267.

This plan came from a Critical-depth debate: four builders (maintainer, security operator, designer, minimalist), three users (integration admin, scoped lab analyst, privacy officer) and four guardians (architecture, performance, safety, data steward). Users reviewed three times and guardians twice. The guardians' second-round findings were fixes they agreed on, applied without another builder round; the text marks them "(guardian round 2)".

Paths are under `packages/server/src` unless they start with `packages/`, `docs/` or `docker/`. The debate read `main` at f1046da. Before filing, the plan was revised against `main` at 3a9d2de, where these defects it had found were already fixed: #157 and #217 (one `authenticate` mount and body parsing after it, D-299), #218, #219 and #221 (#234; D-298 carries the user's permissions on token refresh), #223 (`PUT /channels/:id/groups`, #235), #229 (#250) and #232 (the server's own database role, D-307). #225 (a restart deploys saved changes) is still open.

## What is wrong today

### Roles and permissions

- Permissions come from code, looked up by role name on every request (`permissionNamesForRole` in `lib/role-permissions.ts`), and each user has exactly one role (`db/schema/users.ts`). Admins can't create, edit or clone roles.
- The `user_permissions` table, with its `scope` column, is written by the seed and read by nothing (`db/schema/user-permissions.ts:8-18`, `db/seeds/run-seed.ts:116-136`).
- Every permission covers every channel. The seeded viewer reads every channel's messages, collections and data source settings (`db/seeds/roles.ts:70-81`).
- Checks keyed on the role name `'admin'` (the last-admin check and password reset in `services/user.service.ts`) stop working once roles are rows; they move to permissions in slice 6.

### Guards and secrets

- Guards read a flat list from `req.user`. A refusal is logged at debug level only, so production records nothing (`middleware/permission.middleware.ts`, #158).
- Connector secrets are unmasked for anyone holding `channels:write` on any channel (`controllers/channel.controller.ts`). Clone reads its source unredacted (`services/channel.service.ts`).
- The route walk (`public-routes.test.ts`, D-299) proves every non-public route refuses a caller without a session. Nothing walks the routes per role: the role test mocks `authenticate` and mounts some of the routers (`routes/__tests__/role-access.test.ts`, #155).

### Channels, groups and libraries

- Membership changes go through `PUT /channels/:id/groups` in one transaction (#235) and need only `channels:write`, because groups are organisational (D-094). A new channel's join to Default only logs a warning when it fails (`services/channel.service.ts`).
- Joining a socket room accepts any channel id (`lib/socket.ts:138-150`).
- An alert with an empty channel list fires on every channel (`engine.ts:1458`).
- Library-to-channel links are a jsonb list with no foreign key, and the web never sets them, so every library made in the UI is linked to all channels (`db/schema/code-templates.ts:13`, `services/code-template.service.ts:123`).

### Audit and logging

- The record of a message-content view is fire-and-forget: the content is returned even if the record fails (`controllers/message.controller.ts:51-57`, `lib/event-emitter.ts:21-29`).
- A purge can delete every audit event older than one day: the server's role can't delete events itself, but `purge_events` takes any age of a day or more (`db/migrations/0016_server_role_support.sql`, D-307).

### Deployed code

- Deployed channel code reaches every collection, resource, data source and map, and can route to any channel, regardless of who wrote it (`engine.ts:404-545`).
- A restart deploys every enabled channel's saved head (`services/deployment.service.ts`, #225).

## Recommended design

### 1. Roles, assignments and grants

- **A role is a job: a set of permissions.** `/roles` has create, read, update and delete. Deleting a role that has assignments is refused with the list of them. Clone opens the role editor pre-filled from the source, saving creates a new role, and the audit row records `clonedFrom`. Built-in roles can be cloned; admin can't be edited or deleted.
- **Scope lives on the assignment.** An assignment is (user or key, role, scope, optional expiry, reason). Scope is either "All channels" or a set of channel groups, chosen explicitly every time.
  - About 8 job roles replace about 45 department clones.
  - Moving someone from Lab to Radiology is one change.
- **Grants combine per permission.** Each permission's scope is the union of the scopes of the assignments whose role grants it. So "Viewer · All" plus "Analyst · Lab" never gives write access to Radiology.
  - Expired assignments are filtered inside the resolver query, so an expiry takes effect live with no background job.
  - There are no deny rules.
  - `foldGrants` and `can` are pure functions in core-models. The guards, the editors and the access views all use the same code.
- **One resolver.** `authenticate` loads user, session and grants in one Drizzle CTE (`db.$with`).
  - It deletes `lib/role-permissions.ts`, the `user_permissions` table and the hardcoded role enums.
  - Admin is a locked role row, which `foldGrants` reads as every permission on every channel.
  - `authenticate` runs once per request.
- **`PERMISSION_CATALOG: Record<Permission, PermissionInfo>`** goes in core-models next to `PERMISSIONS`, so D-268 is kept and no guard changes.
  - Each entry has a label, area, description, class, whether a key may hold it, and four flags: Runs code, As strong as admin, Reads PHI, Reads every channel's data.
  - New permissions: `roles:read`, `roles:write`, `api_keys:read`, `api_keys:manage`, `audit:read`.
- **Classes:**

  | Class | Permissions | Where it can be held |
  |---|---|---|
  | channel | channels, messages, code template write and delete, `events:read` | Scoped by the assignment |
  | system-read | Reads that can't hold PHI | Any assignment, scoped or not |
  | every-channel-read | `system:info`, `collections:read`, `global_map:read`, `config_map:read` | All-channel assignments only, including for keys |
  | trust | System-wide writes, alerts, certificates | All-channel assignments only |
  | identity | Users, roles, keys, `audit:read`, backup, restore | All-channel assignments only; never on a key |

  - Once a scope is picked, the picker disables any role that holds a permission limited to all-channel assignments. It says why, and offers the matching channel-only role.
  - Such a permission can't be added to a role that has scoped assignments, live or expired. The edit is refused with 409 and the list of assignments.
- **Seeded roles:**
  - Admin, locked.
  - Deployer, Developer and Viewer, unchanged.
  - Three new editable roles with no holders: Channel viewer, Channel developer and Channel deployer.
  - Nobody's access changes on upgrade.

### Your question: the system-wide areas

Deployed channel code reads these areas by name, whoever wrote it (`engine.ts:404-545`). Scoping who may edit them on screen wouldn't limit what that code reads, so none of them is scoped by group. Each gets a class instead.

| Area | Reading | Changing | Why |
|---|---|---|---|
| Global map | All-channel assignments only (every-channel-read) | All-channel only (trust) | Scripts store PHI and credentials here, and every channel reads it |
| Configuration map | All-channel only (every-channel-read) | All-channel only (trust) | It often holds credentials, and a change redirects any channel at its next deploy |
| Certificates | Allowed in a scoped assignment; a scoped writer may reference only certificates already used in their scope | All-channel only (trust) | Using a certificate presents the hospital's identity |
| Resources | Allowed in a scoped assignment | All-channel only (trust) | Every channel's scripts read them by name |
| Collections | All-channel only (every-channel-read) | All-channel only (trust) | Records often hold PHI from many channels |
| Data sources | Allowed in a scoped assignment (passwords are never returned) | All-channel only (trust) | `dbQuery` from any channel uses the stored credentials |
| Global scripts | Allowed in a scoped assignment | All-channel only (trust) | They run in every channel |

Reads of the global map, configuration map and collections are recorded (section 6).

### 2. Groups, channels and libraries

- **Groups become an access boundary** (supersedes D-094).
  - Creating, renaming or deleting a group needs `channels:write` on all channels. Deleting a group is refused while any assignment or key uses it.
  - Membership changes keep the transactional `PUT /channels/:id/groups` (#235), which gains the grant check below and a preview of who gains and loses access.
  - **Adding a channel to a group is a grant.** The actor must already hold, on that channel, everything the group's assignments and keys grant.
  - `Default` can't be a scope.
- **Every path that creates channels puts them in an in-scope group:** create, clone, JSON import, Mirth import and restore.
- Clone needs `channels:write` on the source.
- Import overwrite needs scope on each overwritten channel. The library rule applies to each matched library's existing links and its new ones.
- **Code template libraries get a channel-links field.**
  - A library write needs its links, before and after the change, inside the writer's `code_templates:write` scope. "Every channel" and an empty list are all-channel only.
  - A scoped writer's new library defaults to their own channels.
  - Out-of-scope links show as a count only.
  - Existing libraries stay "Every channel", and admins get a "Review links" list.
- In a scoped `alerts:read`, an alert's out-of-scope channels show as a count (guardian round 2).

### 3. What scope promises

This text goes in the role editor, the assignment picker, the key form and `docs/user/access-control.md`, and a doc test checks it:

> Scope limits what a person or key can see and change through GalvaniGraph's screens and API. Message reads, searches and exports, and the reads listed under "What is recorded", are recorded in an audit log that the product can't change or delete; each entry there says whether the read is refused when it can't be recorded or recorded on a best-effort basis. Reads under "What is not recorded" aren't. Scope is not a boundary for code: anyone who can change or deploy channel code, code templates or global scripts, or restore a backup, can reach every channel's messages and credentials through that code, and that reach is not recorded. A database owner can still alter the audit log.

The two-person write/deploy split isn't claimed until #225 lands.

### 4. Request path and guards

- **Order:** already in place (D-299): rate limiter, one `authenticate`, then the JSON parser. Public routes stay a position in `routes/index.ts` checked by the walk, not a per-route tag.
- **Principal:** `req.principal` is a user or a key. `req.user` is available only behind `sessionOnly`.
- **Guards** in `middleware/permission.middleware.ts`: `sessionOnly`, `requirePermission` (already typed with `Permission`), and `requireChannel(perm, resolver)`, which takes the channel from the record, not from the request.
  - An out-of-scope request answers 404 through `deny()` and `errorResponse`.
  - A route that needs two permissions checks both on the same channel.
  - Lint bans `permissions.includes` outside the authz code.
- **Lists, statistics (including the QUEUED subquery in `services/statistics.service.ts`), export, tags, dependencies, events and cross-channel search** filter with `channel_id = ANY(<expanded channel ids>)`.
  - Never a JOIN: a channel in two groups would be counted twice.
  - "All channels" applies no filter at all, so ungrouped channels still appear.
  - Cross-channel search moves to `messages:read`.
- **Test Connection** takes a `channelId`. A scoped writer may reference only certificates already used in their scope.
- **Test-run** checks its channel and wires a read bridge only with the matching read permission (amends D-286). It is recorded and `sessionOnly`.
- **Hidden channels stay hidden:** "Name unavailable", "conflict", and "+1 channel outside your access".
- **Sockets** use `scope:all` and `group:<id>` rooms through `emitToRoom`.
  - An in-memory channel-to-groups map serves them. `grant.service` invalidates it on every membership write, and it is single-instance.
  - The 60-second re-check runs as one batched query.
  - Keys can't open sockets.
- **Freshness:** the server checks grants live on every request, so a change or an expiry takes effect at once. The web learns of it through the token refresh, which already returns the user's current access (D-298); the refresh answer now carries folded grants with their scopes and each scoped grant's expiry instead of a flat list. Two triggers start a refresh besides an expired token:
  - a 404 or 403 from a scoped route makes the client call `refreshSession()` and compare grants. When they differ, the page shows "Your access changed" instead of treating the 404 as "deleted", so nobody recreates a channel they merely lost access to;
  - a timer set from the next expiry drives the "an hour before a temporary grant ends" banner.

  The server also computes a grants hash (sorted folded grants plus the next expiry) from the resolver output, used only to drop a principal's audit dedupe entries. No header, no `/auth/me`, no socket push.

### 5. Anti-escalation

All of these rules live in `services/grant.service.ts`. It is the only writer of the role, assignment, key and membership tables, and `no-restricted-imports` enforces that.

- **Within rule:**
  - An assignment needs the actor to hold its role's permissions on its scope, compared by group id.
  - A role edit needs every added permission on the union of its assignments' scopes, expired ones included.
  - Renewing an assignment counts as a new write and passes the same checks.
- **Target rule:** acting on a user needs their grants, and the grants of keys they own, to be within the actor's own. Each user row carries `canManage` with a reason.
- **Keys:**
  - Every key action needs the key's grants within the actor's: Replace, enable, edit and owner change.
  - Replace makes the actor the issuer and re-checks the cap.
  - Anyone with `api_keys:manage` may revoke or disable a key.
  - A key's assignments can't outlive the issuer assignment that covered them. Removing or narrowing that assignment, or editing its role, re-caps or disables the key in the same transaction (guardian round 2). When the issuer's assignment expires, so do the key's assignments it covered: the cap already ties their expiry to it. The save preview in the user dialog and the role editor lists every key that will be narrowed or disabled, before Save.
  - Key roles can't be reached through the role routes or given to a user.
- **Self and admin:**
  - Users can't change their own assignments.
  - The grant service locks the role row, then the group rows.
  - The last enabled holder of the admin role is protected inside the transaction: the grant service locks the admin role row, and disabling a user takes the same lock. This replaces the user-row lock #234 added (`lockTargetAndAdmins`).

### 6. Audit

- **`audit_log`** is a separate insert-only table, created by a custom migration.
  - Monthly range partitions plus a DEFAULT partition. The migration creates 12 months ahead. The server's role can't add partitions (D-307), so a daily job calls a new owner function, `ensure_audit_partitions()`, built like `create_channel_partitions` (SECURITY DEFINER, pinned `search_path`, PUBLIC revoked, listed in `OWNER_FUNCTIONS`). It takes no argument and creates whichever of the current month through month+3 are missing, so the caller can't make partitions for arbitrary dates. System info alerts when DEFAULT holds any rows.
  - Row triggers refuse UPDATE and DELETE, and a TRUNCATE trigger sits on every partition. These are defence in depth against the owner's own mistakes; the server's role never holds UPDATE, DELETE or TRUNCATE on the table.
  - The server's role gets SELECT and INSERT only. D-307's start-up grant (`GRANT ... ON ALL TABLES`) and default privileges reach every partition, and Postgres checks a partition's own privileges when it is addressed directly, so `db/runtime-role.ts` revokes UPDATE and DELETE on the parent and on every partition (a `pg_inherits` loop), and `ensure_audit_partitions` revokes them on each partition it creates. A runtime-role test asserts a permission error, not a trigger error, for update, delete, truncate and drop on the parent and on a partition.
  - Retention is a setting in `system_settings`, minimum 6 years. A second owner function, `drop_expired_audit_partitions()`, drops only partitions wholly older than the setting (never under 6 years) and runs only from an admin's action, recorded in `audit_log` before it runs.
  - All of these partition rules are guardian round 2.
- **Reading it:** only through `audit:read`, at `GET /api/v1/audit`. The Events page shows `audit_log` on its own Access records tab, next to `events`, rather than as one timeline (D-316: the two tables number rows independently). A holder of `events:read` without `audit:read` sees operational events only.
- **What moves:** `USER_LOGIN`, `USER_LOGIN_FAILED`, the logout event and `EVENTS_PURGED` are written to `audit_log` only, not to both tables. The Events filters and the e2e specs that read those names are updated in the same slice.
- **One writer.** `services/audit.service.ts`, called through `lib/event-emitter.ts` in three ways:
  - `recordInTx` for grant changes, written in the same transaction;
  - `recordOrRefuse`, fail-closed;
  - `emitAuditEvent`, best effort.

  A new `AUDIT_UNAVAILABLE` error maps to 503.
- **What it records:**
  - grant, assignment, membership and key changes, with before and after, plus a baseline at migration;
  - sign-ins, sign-outs and failures;
  - refusals, coalesced per principal, route and reason per minute;
  - purges;
  - who authored code and config, who deployed, who restored;
  - PHI reads.
- **Fail closed:** the audit row is written first. On failure the request gets 503 with no content. The read and the insert run in parallel, with a 2-second statement timeout. This applies to:
  - message detail;
  - export;
  - attachment download;
  - content and metadata searches;
  - lists that carry metadata;
  - send-message responses;
  - test-run reads that returned data;
  - backup downloads, with a hash, a reason and a file header.
- **Dedupe:** a 15-minute in-memory LRU, capped at 100K entries, keyed by principal, route, channel and either the message id or the filters including the page.
  - It runs after the guard and never caches responses.
  - Exports, attachment downloads and backups are never deduped.
  - A list hit still records any new message ids, at once (D-317 changed "at most once a minute per entry for browsers": rows shown between two records went unrecorded).
  - A principal's entries are dropped when their grants hash changes.
  - The dedupe rules are guardian round 2.
- **Best effort:**
  - config-map, server-log, unmasked-secret, collection and global-map reads;
  - Events page searches and exports;
  - alert sends.

  System info counts best-effort records that were lost.
- **Searches record:** the term (unhashed), the filters, the total and every id the page returned (D-317; pages are at most 200 rows).
- **Exports:** a reason is required. The exported ids are recorded, and the file carries a header naming the server, exporter, time, audit row id and reason. Backup downloads warn that the file holds credentials and PHI. Config-map values aren't redacted, because a restore would blank them.

### 7. API keys (#144, slimmed)

- **Format and storage:** `gf_<keyId>_<secret>` with a 256-bit secret, stored as SHA-256 through `hashToken`, which moves to `lib/token-hash.ts` and joins `SHARED_HELPERS`. `ApiKeyId` gets its own brand factory.
- **Requests:**
  - Bearer only, refused in a URL or alongside a second credential.
  - Identical 401s, `timingSafeEqual`.
  - Last-used time and client address are written at most once a minute per key, throttled in memory rather than by a conditional UPDATE on every request, using the existing `TRUST_PROXY` for the address.
- **Lifecycle:** shown once, required expiry, revoke with a reason, enable and disable.
- **Grants:** each key holds assignments through a private role.
- **Limits:**
  - Keys may hold `messages:read`.
  - The rate limit is a second `express-rate-limit` instance keyed by key id.
  - A daily row ceiling (default 5,000) uses an in-memory counter seeded at startup from the day's `audit_log` rows for that key. The server reserves rows before a read and settles to the real count after, counting every row that any fail-closed read returns. Over the ceiling the key gets 429 and a protected record (guardian round 2).
  - A key with `messages:read` on all channels needs a reason.
- **Replace** issues a new secret. For a leak, the old one is revoked now. For a planned change, it expires within 7 days.
- **Offboarding:** every key the leaver issued must be Replaced by someone who passes the within rule within 7 days, or it is disabled. A Replace during offboarding revokes the old secret at once (guardian round 2). "Disable now" is always offered. Through the API with no choice made, the keys are disabled. While the deadline runs, the key list shows a countdown chip ("Disabled in 3 days unless replaced"). From day 5, holders of `api_keys:manage` see a banner when they sign in, and an event is recorded. A vendor feed never stops without that warning.
- **Cut from #144:** pepper, checksum suffix, dummy check, compare-and-set rotation, a separate key audit table.

### 8. Screens

They follow `create-ui`. Badges use `StatusChip` with levels in `packages/web/src/lib/status.ts`. Confirmation uses `ConfirmDialog` with new `requireTyped` and `reason` props. An editor that loses access uses `UnsavedChangesBar`'s blocked reason. The role and key editors are full pages, like `AlertEditorPage`.

Users & access → Roles:

```
Users & access   [Users] [Roles] [API keys]
+------------------------------------------------------------------+
| Roles                                              [ New role ]   |
| Name               Holders               Flags                    |
| Admin (locked)     2 users               As strong as admin       |
| Analyst            14 users in 6 groups  Reads PHI                |
| Channel deployer   3 users, 1 key        Runs code                |
| Deployer           1 user                All channels only        |
| Empty: "No custom roles yet. Clone a built-in role to start."     |
| Error: "Roles couldn't load. [Retry]"                             |
| No access: "You need Read roles. Ask: J. Rivera, M. Chen"         |
+------------------------------------------------------------------+
```

User dialog, access section:

```
Access for Priya Shah
  Analyst · Lab, Radiology              permanent          [x]
  Channel deployer · Radiology · until 06:00 · "on-call INC-4411" [x]
  Viewer · All channels   (!) Read messages applies to all 500 channels
                          through Viewer. Analyst's Lab limit has no effect.
                          [Remove Viewer] [Viewer on Lab instead] [Keep]
  Expired: Deployer · Lab · ended 14 Nov 06:00     [Renew] [Remove]
  [ + Add access ]  [ + Temporary access (12 h) ]
  Saving: gains Reprocess on Radiology; loses nothing.   [Cancel] [Save]
```

Channel page → Who can access:

```
Who can access ADT-Lab-In    As of [ now v ]   Person [ all v ]  [Export CSV]
Through GalvaniGraph (message access recorded)
  Priya Shah   Read, Reprocess   Analyst · Lab      since 3 Oct   permanent
  Acme CI key  Deploy            key role · Lab     since 1 Sep   until 1 Mar
Through channel code (not recorded)
  4 people can change or deploy code in any scope   [revisions]
Through shared data and logs
  2 people read the server log and shared collections
```

How "as of a date" is rebuilt:
- The view replays assignment, group-membership and role-permission rows from `audit_log`, each holding the full after state, starting from the migration baseline. It applies expiry, then runs the same `foldGrants` the guards use.
- A partial index on grant rows keeps the lookup off the PHI rows.
- A test proves that every write to an assignment, membership, role-permission or key table produces exactly one `audit_log` row.

Also on screen:
- A banner an hour before a temporary grant ends.
- "My access" in the account menu.
- The 404 page reads "Not found, or not in your access".
- The 503 page shows `AUDIT_UNAVAILABLE` with a runbook link and no bypass.
- Groups show a "Gives access" chip.
- The dashboard shows a channel under every group it belongs to.

### 9. Migration

- Seed the roles with fixed ids.
- Give each user one all-channel assignment of their current role, and report any unknown role names.
- Drop `users.role` and `user_permissions`.
- An integration test proves every user's permissions are identical before and after.

## Slices

Five epics, in build order. Each slice depends on the one before it, which covers the files several slices touch: `docs/user/access-control.md`, `docs/progress/DECISIONS.md` and the access doc test. Sizes: S is under a day, M a few days, L about a week, XL more than a week.

The debate's first and third slices (one `authenticate` mount and parser order; the message action gates) shipped before filing, in #246 and #234.

### Epic 1: Guard floor (#263)

1. **`deny()` and a route walk over a principal matrix that doesn't mock authenticate**, M.
   - Follows: HTTP route, Tests, Audit.
   - Owns: `middleware/permission.middleware.ts`, a new `test/integration/route-walk.itest.ts` (extends the D-299 walk from "no session" to one principal per seeded role), `routes/__tests__/role-access.test.ts`.
   - Refusals are coalesced per principal, route and reason per minute and recorded through the existing event writer until slice 3 moves them to `audit_log`. Until then they are purgeable after a day, like every event.
   - Closes #155, #158.

### Epic 2: Protected audit (#264)

2. **The `audit_log` table, partitions, triggers, retention setting and custom migration**, L.
   - Follows: Schema change (custom migration: decision 5).
   - Owns: `db/schema/audit-log.ts`, a new custom migration with the `ensure_audit_partitions` and `drop_expired_audit_partitions` owner functions, the `audit_log` grants in `db/runtime-role.ts` (SELECT and INSERT only, like `events`), the audit section of `services/partition-manager.service.ts`, the retention entry in `packages/web/src/lib/settings-catalog.ts`.
   - The doc-tested sentence on what scope promises ships with this slice, because it names the audit log.
3. **AuditService, fail-closed reads with dedupe, `audit:read`, the 503 code, and the sign-in, backup, test-run, refusal and send-message records**, L.
   - Follows: Audit, HTTP route, Code.
   - Owns: `services/audit.service.ts`, `lib/event-emitter.ts`, `lib/controller-helpers.ts`; the message, attachment and export controllers; `services/event.service.ts`, `services/server-backup.service.ts`, `services/script-test-run.service.ts`.
4. **Web: the 503 state, export reasons, and the Events access-record filter**, M.
   - Follows: Screen.
   - Owns: `packages/web/src/components/common/ConfirmDialog.tsx`, `packages/web/src/pages/EventsPage.tsx`, the export dialogs.

### Epic 3: Roles and assignments, all-channel only (#265)

5. **Catalog, `foldGrants`/`can`, brands and lint ban**, M.
   - Follows: Permission list, Code, Tests.
   - Owns: `packages/core-models/src/constants.ts` (the catalog), a new `packages/core-models/src/authz/`, `eslint.config.js`, the coverage floors in `packages/core-models/vitest.config.ts`.
6. **Schema, migration, one resolver, `req.principal`, grant service rules, seeded roles, and folded grants on token refresh**, XL.
   - Follows: Schema change, HTTP route, Tests.
   - Owns: `db/schema/roles.ts`, `db/schema/assignments.ts`; `db/seeds/roles.ts`; `services/grant.service.ts`, `services/user.service.ts` and `controllers/user.controller.ts` (the last-admin check moves into the grant service under the admin role row lock; password reset checks a permission instead of `actorRole`); `services/server-backup.service.ts` (exports assignments, not `u.role`); `db/seeds/run-seed.ts`; `middleware/auth.middleware.ts`; `services/auth.service.ts` (the refresh answer, D-298); the resolver in `lib/socket.ts`; `lib/openapi.ts`, `packages/core-models/src/schemas/user.schema.ts`; `test/integration/role-migration.itest.ts`, proving every user's permissions are the same before and after the migration.
   - Deletes `lib/role-permissions.ts` and `db/schema/user-permissions.ts`.
   - Closes #159 and #140 item 6.
7. **Roles UI**, L.
   - Follows: Screen, Tests.
   - Owns: `packages/web/src/pages/UsersPage.tsx`, a new `RoleEditorPage.tsx`, `packages/web/src/components/users/`, `packages/web/src/stores/auth.store.ts` (stores folded grants), `packages/web/src/lib/status.ts`, `e2e/roles.spec.ts` (signs in as a non-admin).

### Epic 4: Group scope (#266)

8. **`requireChannel` everywhere, SQL filters, search permission, sockets, Test Connection, test-run and existence wording**, XL.
   - Follows: HTTP route, Live updates, Tests (integration test per filtered route).
   - Owns: a new `lib/channel-scope.ts`, the list and search services, the room logic in `lib/socket.ts`, `services/connection-test.service.ts`, test-run's message naming the missing read permission, and `test/integration/channel-scope.itest.ts` covering each filtered route.
   - Closes #160.
9. **Membership as a grant on `PUT /channels/:id/groups`, group create/delete rules, create/clone/import/restore into a group, library links**, L.
   - Follows: HTTP route, Tests. Library links keep the existing `channel_ids` column, so no schema change.
   - Membership writes move into `grant.service` with `recordInTx`: `ChannelGroupService.setChannelGroups` and the Default join in `channel.service.ts` both write `channel_group_members` themselves today and record after commit. The move also invalidates the socket channel-to-groups map.
   - Owns: `routes/channel-group.routes.ts`, `controllers/channel-group.controller.ts`, `services/channel-group.service.ts`, the groups route in `routes/channel.routes.ts`, the create and clone parts of `services/channel.service.ts`, the import services, `services/code-template.service.ts`.
10. **Scope UI**, L.
    - Follows: Screen.
    - The client's refresh-on-404/403 and the expiry timer from section 4 live here, in `packages/web/src/api/client.ts` and `packages/web/src/stores/auth.store.ts`.
    - Owns: `packages/web/src/components/dashboard/GroupedChannelTable.tsx`; `packages/web/src/components/common/AssignGroupDialog.tsx`; `packages/web/src/pages/CodeTemplatePage.tsx`; `packages/web/src/pages/ChannelEditorPage.tsx`, for access-changed handling; the "Your access changed at 13:02" line in the message browser and statistics.
11. **Who can access, now and as of a date, with CSV**, M.
    - Follows: HTTP route, Screen, Tests.
    - Owns: a new `services/access-query.service.ts`, a new `routes/access.routes.ts`, the channel page's access tab, `e2e/scoped-access.spec.ts`, the partial index on grant rows, and `test/integration/grant-audit-coverage.itest.ts` (one audit row per write to each grant table).

### Epic 5: API keys (#267)

12. **Server keys**, L.
    - Follows: HTTP route, Schema change, Audit.
    - Owns: `db/schema/api-keys.ts`, a new `services/api-key.service.ts`, a new `lib/token-hash.ts` and its `SHARED_HELPERS` entry in `eslint.config.js`, the key branch of `middleware/auth.middleware.ts`, `middleware/rate-limit.middleware.ts`.
    - Closes #144.
13. **Keys UI and offboarding dialog**, M.
    - Follows: Screen.
    - Owns: a new `packages/web/src/pages/ApiKeysPage.tsx`, the offboarding step in `packages/web/src/components/users/`.

## Won't build and deferred

Won't build:
- **Deny rules:** union only, the owner's call.
- **Per-user grants:** assignments cover it.
- **A library scope picker:** links follow channels.
- **Process isolation per group:** separate engines do that.
- **Config-map redaction in backups:** a restore would blank the values.

Deferred:

| Item | Returns when |
|---|---|
| Per-channel scope rows | A site shows one-channel groups failing an admin's workflow, reported as an issue |
| Scoped admins | A site asks for department-level user administration in an issue |
| A permission cache | The soak test shows the resolver above 5 ms at p95, or auth queries above 20% of database time |
| A socket push or `/auth/me` for access changes | Users report a button stale for longer than one access-token lifetime |
| Group-owned system objects and scoping the engine bridges | A site needs channel writers kept out of other departments' data through code |
| A per-key activity tab | A site runs more than 20 keys |
| Splitting `messages:export` | The privacy officer asks to grant viewing without bulk export |
| Re-authentication for grant changes | #140 lands |
| A reprocess fan-out warning | An incident report names a reprocess that reached a channel the user couldn't see |
| The two-person write/deploy claim | #225 lands |
| A per-writer test-run slot | A report of one scoped writer blocking test runs for others |

## Decisions

All accepted with their defaults on 2026-11-16. Decisions 12 and 13 were revised before filing because of work that shipped meanwhile.

1. **Where does scope go?** Put it on the assignment ("Analyst · Lab, Radiology") instead of the role, which departs from your wording that a role is assigned groups. Default: on the assignment.
2. **Groups as an access boundary.** Supersede D-094, and treat adding a channel to a group as a grant. Default: yes.
3. **Grants from the database.** Refine D-180: grants resolve from the database in one query, admin becomes a locked row, and `role-permissions.ts` and `user_permissions` go. Default: yes.
4. **Test-run.** Amend D-286: a test-run read bridge needs its matching read permission, and test-run becomes recorded and `sessionOnly`. Default: yes.
5. **The audit table.** A separate insert-only `audit_log` with triggers and partitions, made by a custom migration, not `db:generate` alone (precedent: `0007_partition_message_tables.sql`). Default: yes.
6. **Fail-closed reads.** Content reads fail closed with 503 `AUDIT_UNAVAILABLE` and no bypass. Default: yes.
7. **Search terms.** Record them unhashed, readable only with `audit:read`. Default: yes.
8. **Who holds `audit:read`.** It's identity class, seeded on admin. It may be added to an all-channel custom role (an auditor role), never to a key or a scoped assignment. Default: yes.
9. **Retention.** Audit retention has a 6-year minimum, and partitions are dropped only by the migration role on an admin's action. Default: yes.
10. **Key ceiling.** A daily row ceiling per API key (5,000 by default). Default: keep it. The minimalist would cut it.
11. **Export reasons.** A required reason and a file header on every export. Default: keep both. The minimalist would cut them.
12. **Freshness.** Grants are checked live on the server; the web picks up changes on the next token refresh (D-298), with no header, no `/auth/me` and no socket push. Revised before filing: the debate chose `X-Grants-Hash` plus `/auth/me`, but D-298 shipped meanwhile and covers it.
13. **Membership route.** `PUT /channels/:id/groups` replaces the member routes. Shipped before filing (#235).
14. **The socket cache exception.** The in-memory channel-to-groups map for sockets is the one exception to "no permission cache". `grant.service` invalidates it, and it is single-instance. Default: yes.
15. **New seeded roles.** Seed Channel viewer, Channel developer and Channel deployer. Default: yes.
16. **Keys and PHI.** API keys may hold `messages:read`, with the rate limit and the ceiling. Default: yes.
17. **Offboarding keys.** A leaver's keys must be replaced within 7 days or they are disabled, and a Replace during offboarding revokes the old secret at once. Default: yes.
18. **How libraries are scoped.** Your item 4 asked for "the same idea for code templates/libaries". Instead of assigning libraries to roles, scope follows each library's channel links. You may edit a library only when every channel it runs in is inside your scope. Reading templates stays unscoped, because templates are code, not PHI. Every builder chose this: a separate library scope could push code into channels outside the editor's channel scope. Default: scope through channel links, with no library picker on roles.
19. **Filing.** File the plan as five epic issues with these slices, and fold #144, #155, #158, #159 and #160 into them (#157 shipped before filing). Default: yes.
