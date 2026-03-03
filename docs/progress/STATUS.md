# Project Status

> Last updated: 2026-03-02 (Phase 19 Channel Groups, Tags, Dependencies & Resources)

## Package Status

| Package | Phase | What's Done | What's Next |
|---------|-------|-------------|-------------|
| `@mirthless/core-models` | Complete (v1) | Branded types, constants, Zod schemas (channel CRUD, destinations, metadata, users, **code templates**, **global scripts**, **filters**, **transformers**, **alerts**, **events**, **settings**), **SOCKET_EVENT constants**, **184 schema validation tests** | Refine schemas as features develop |
| `@mirthless/core-util` | HL7v2 Parser | Result re-export, validation utils, **HL7v2 parser** (encoding, path, message, ACK), **68 HL7 tests** | Add utilities as needed (YAGNI) |
| `@mirthless/engine` | Pipeline + Storage Policies | **Sandbox executor** (vm-based), **script compiler** (esbuild, **deploy-time caching**), **8-stage message pipeline**, **channel runtime** (state machine), **queue consumer** (with DB content loading), in-memory message store, **filter/transformer compilation**, **code template injection**, **global scripts**, **HL7 bridge functions**, **globalChannelMap**, **destinationSet**, **alert evaluator** (trigger matching), **action dispatcher** (EMAIL/LOG/CHANNEL actions with EmailSender callback), **alert manager** (throttle/max-alerts), **sourceMap persistence** (JSON, contentType=9), **196 engine tests** | — |
| `@mirthless/connectors` | 9 Connector Types | Base interfaces, **TCP/MLLP receiver/dispatcher**, **HTTP receiver/dispatcher**, **File receiver/dispatcher**, **Database receiver/dispatcher**, **JavaScript receiver/dispatcher** (script callback), **SMTP dispatcher** (nodemailer, template substitution), **Channel receiver/dispatcher** (in-memory registry routing), **FHIR dispatcher** (REST API, auth types), **DICOM receiver/dispatcher** (C-STORE SCP/SCU via @ubercode/dcmtk, factory DI), **query builder**, **connection pool**, connector registry, **321 connector tests** | — |
| `@mirthless/server` | API Phase 19 | Express app, config, middleware, DB schema, auth, seeds, **Channel CRUD API** (6 endpoints + **clone**), **Deployment API** (8 endpoints + **connector validation**), **Message Query API** (4 endpoints), **Statistics API** (3 endpoints), **User Management API** (7 endpoints), **Code Templates API** (8 endpoints), **Global Scripts API** (2 endpoints), **Alerts API** (6 endpoints + **batch getByIds**), **Events API** (3 endpoints), **Settings API** (5 endpoints), **Data Pruner API** (3 endpoints), **Channel Export/Import API** (3 endpoints), **Script Validation API** (1 endpoint), **Channel Groups API** (7 endpoints), **Tags API** (6 endpoints), **Channel Dependencies API** (3 endpoints), **Resources API** (5 endpoints), **event emission** from all services (via **SOCKET_EVENT constants**), filter/transformer CRUD (inline with channel), **partition manager**, **data pruner**, **queue manager**, **AlertManager wired with emailSender**, **JS connector wiring** (**deploy-time script caching**), **email service**, **health service** (live/ready/full), **connector validation service** (+ **DICOM schemas**), **QueueConsumer wiring** (per-destination lifecycle), **Socket.IO server** (JWT auth, rooms, emission, **typed events**), **async dispose()**, **per-channel storage policy adapter** (shouldStoreContent, removeContentOnCompletion, removeAttachmentsOnCompletion), **MessageService.deleteContent/deleteAttachments**, **498 server tests** | — |
| `@mirthless/web` | UI Phase 19 | React+MUI shell, auth flow, login page, **Channel Editor** (all 5 tabs + filter/transformer UI + **9 connector type forms**: TCP/MLLP, HTTP, File, Database, JavaScript, SMTP, Channel, FHIR, **DICOM**), **Dashboard** (+ **WebSocket real-time updates**), **Message Browser** (+ **WebSocket real-time updates**), **Users Page**, **Code Templates Page**, **Global Scripts Page**, **Alerts Page**, **Events Page**, **Settings Page** (+ **SMTP tab**, password masking), **Channel Groups Page**, **Tags Page**, **Resources Page**, **Channel Export/Import** (ExportButton + ImportDialog), **Channel Clone** (dialog + button), Monaco editor, **Socket.IO client** (auto-reconnect, room management), **useSocketRoom hook**, **generic useSocketEvent\<T\>** | — |
| `@mirthless/cli` | Foundation | **Commander-based CLI** with `channels`, `deploy`, `export/import`, `users`, `login` commands, **ApiClient** (HTTP), **output formatters** (table/JSON), **config persistence** (`~/.mirthless/`), **22 tests** | More commands, interactive mode |

## Infrastructure Status

| Component | Status | Notes |
|-----------|--------|-------|
| Monorepo (pnpm workspaces) | Done | All packages wired |
| TypeScript (strict) | Done | Base + build configs |
| ESLint | Done | Flat config, TS rules, 0 warnings |
| Docker (Postgres) | Done | PostgreSQL 17 config ready |
| Drizzle schema | Done | All tables from design doc 07 |
| Auth (JWT+sessions) | Done | Adapted from fullstack-template |
| RBAC | Done | 4 default roles: admin, deployer, developer, viewer |
| Vitest | Done | Configured per package, passWithNoTests |
| Manual test suite | Done | 41 test files, ~815 scenarios, `docs/testing/` |
| Playwright E2E | Done | 11 spec files, ~57 tests, `e2e/` (4 fixed) |

## Verification Checklist

| Step | Status | Notes |
|------|--------|-------|
| `pnpm install` | PASS | 833 packages resolved |
| `pnpm build` | PASS | All 7 packages compile (0 errors) |
| `pnpm lint` | PASS | 0 warnings |
| `pnpm test` | PASS | **1,289 tests passing** (184 schema + 68 HL7 + 196 engine + 321 connectors + 498 server + 22 CLI) |
| `docker:up` | PASS | PostgreSQL 17 running |
| `db:generate` | PASS | 34 tables generated |
| `db:migrate` | PASS | Migrations applied |
| `db:seed` | PASS | Admin user + 31 permissions + settings |
| `dev:server` | PASS | Express on :3000, pgboss started |
| `dev:web` | PASS | Vite on :5173 in 435ms |
| Login round-trip | PASS | admin/Admin123! → JWT + 31 permissions |
| Manual test run | PASS | 81/81 original scenarios passing (2026-02-28-v1) |

## Recent Milestones

| Date | Milestone |
|------|-----------|
| 2026-03-02 | **Phase 19 Channel Groups, Tags, Dependencies & Resources** — Full CRUD stack for channel groups (7 endpoints), channel tags (6 endpoints), channel dependencies (3 endpoints + DAG validation), resources (5 endpoints + content column). 3 new UI pages (ChannelGroups, Tags, Resources). 4 Zod schemas, 4 services, 3 controllers, 4 route modules, 3 TanStack Query hook files. (+55 tests, 1,289 total) |
| 2026-03-02 | **Phase 18 Message Storage Policies** — sourceMap persistence in pipeline (JSON, contentType=9), per-channel storage policy adapter (DEVELOPMENT/PRODUCTION/RAW/METADATA/DISABLED), removeContentOnCompletion and removeAttachmentsOnCompletion enforcement, MessageService.deleteContent/deleteAttachments. (+16 tests, 1,234 total) |
| 2026-03-02 | **Phase 17 DICOM Connector** — DICOM receiver (C-STORE SCP) and dispatcher (C-STORE SCU) via @ubercode/dcmtk with factory injection for testability, deploy validation schemas, source + destination UI forms with conditional fields, 9 connector types total. (+45 tests, 1,218 total) |
| 2026-03-02 | **Phase 16 Simplify Fixes** — JS connector script caching (compile once at deploy, reuse per-message), async `dispose()`, N+1 alert fix (`getByIds` batch query), `SOCKET_EVENT` const object in core-models, typed `ChannelStatus.state`, `emitStateChange` helper, `useSocketRoom` hook extraction, generic `useSocketEvent<T>`. (+5 tests, 1,173 total) |
| 2026-03-01 | **QueueConsumer Wiring + WebSocket Real-Time (Phase 16)** — QueueConsumer per queued destination (lifecycle tied to channel start/stop), Socket.IO server with JWT auth and channel-based rooms, server-side emission for channel state changes and statistics, WebSocket client singleton with auto-reconnect and token refresh, Dashboard and Message Browser real-time updates with polling fallback. 2 new manual test docs (25 scenarios). (+31 tests, 1,168 total) |
| 2026-03-01 | **Production Readiness (Phase 15)** — Email service + AlertManager emailSender wiring (EMAIL alerts now functional), connector property validation at deploy time (Zod schemas for 14 connector type/mode combinations), enhanced health check (live/ready/full endpoints), auth rate limiting on /refresh, script syntax validation API (esbuild), SMTP settings seed data + UI tab. (+82 tests, 1,137 total) |
| 2026-03-01 | **Production Integration & CLI Foundation (Phase 14)** — AlertManager wired into engine deploy, JavaScript connectors wired to sandbox, EMAIL alert action implemented (EmailSender callback), LOG alert action added, commander-based CLI (16 commands, config persistence), channel clone API + UI, 6 new manual test docs (181 scenarios). (+60 tests, 1,055 total) |
| 2026-03-01 | **P2 Connectors + Channel Operations (Phase 13)** — JavaScript connector (source + destination, script callback), SMTP connector (nodemailer, template substitution), Channel connector (in-memory registry routing), FHIR R4 connector (REST API, auth types), Channel import/export (SKIP/OVERWRITE/CREATE_NEW collision modes), Alert evaluation engine (trigger matching, throttle, action dispatch). 8 connector types total. (+170 tests, 995 total) |
| 2026-03-01 | **File/Database Connectors + Message Store (Phases 10-12)** — File receiver/dispatcher, Database receiver/dispatcher with parameterized QueryBuilder, partition manager (per-channel table partitions), data pruner (age-based cleanup API), queue manager (FOR UPDATE SKIP LOCKED), File/Database UI forms, E2E test fixes. (+160 tests, 825 total) |
| 2026-03-01 | **Test Coverage Backfill** — 9 new manual test docs (dashboard, message browser, users, code templates, global scripts, filter/transformer, alerts, events, settings), 4 new Playwright E2E specs (alerts, events, settings, dashboard). Total: 22 manual test docs (~355 scenarios), 11 E2E specs (~57 tests). |
| 2026-03-01 | **Events & Settings Systems (Phase 9)** — Event Zod schemas, Event service (paginated+filtered list, create, purge), Event API (3 endpoints), Events page UI (filter bar, paginated table, detail panel, purge dialog). Settings Zod schemas, Settings service (list, getByKey, upsert, bulkUpsert, delete), Settings API (5 endpoints), Settings page UI (category tabs, type-aware inputs, bulk save). Fire-and-forget event emission from all 8 services (auth, channel, deployment, user, settings, code-template, global-script, alert). AuditContext passed from controllers. (+79 tests, 665 total) |
| 2026-03-01 | **Alerts System (Phase 8)** — Alert Zod schemas (trigger, action, CRUD), Alert service (CRUD + setEnabled + optimistic locking), Alert API (6 endpoints), AlertsPage (list + toggle + delete), AlertEditorPage (General + Trigger + Channels + Actions + Templates sections) (+58 tests) |
| 2026-03-01 | **Filter/Transformer CRUD + UI** — Zod schemas (filter rules, transformer steps), channel service CRUD (load + save with delete-and-reinsert), source filter/transformer accordion UI, destination filter/transformer accordion UI, shared FilterRuleEditor + TransformerStepEditor components, metaDataId-based connectorId resolution (+37 tests) |
| 2026-02-28 | **Engine pipeline completion** — Filter/transformer compilation, code template injection, global scripts, HL7 bridge functions (parseHL7/createACK), globalChannelMap, destinationSet (+71 engine tests) |
| 2026-02-28 | **Production readiness** — Fixed queue consumer content loading, Code Templates API (8 endpoints) + UI (library tree, template editor), Global Scripts API (2 endpoints) + UI (4-tab Monaco editors), Playwright E2E test setup (7 suites, ~36 tests) |
| 2026-02-28 | **HTTP connector + HL7v2 parser + User management** — HTTP source/destination connectors, full HL7v2 parser (parse/get/set/delete/ACK), User CRUD API + Users page UI |
| 2026-02-28 | **Dashboard + Message Browser** — Summary cards, channel status table with live stats, quick actions, message search/filter/detail panel, statistics API, auto-refresh polling |
| 2026-02-28 | **Engine foundation** — vm-based sandbox, esbuild script compiler, 8-stage pipeline, channel runtime state machine, queue consumer, TCP/MLLP connectors, deployment API (8 endpoints), message query API, in-memory message store, E2E ADT^A01 test |
| 2026-02-28 | Complete Channel Editor: Destinations tab (two-panel, TCP/MLLP + HTTP, queue settings), Scripts tab (Monaco), Advanced tab (storage, pruning, metadata columns) |
| 2026-02-28 | Expand schemas: destinationInputSchema, metadataColumnInputSchema, pruning fields (22 new tests) |
| 2026-02-28 | Expand channel service: destination/metadata sync (delete-and-reinsert), pruning fields (5 new tests) |
| 2026-02-28 | Fix layout bugs (vertical scroll, text overflow), restructure manual tests, full test pass |
| 2026-02-28 | Fix auth error format, switch to data router, handle 204 in API client |
| 2026-02-26 | Source tab: TCP/MLLP + HTTP connector forms, dynamic form dispatch, response settings |
| 2026-02-26 | Fix channel list API response structure, add workflow tests (schema + controller) |
| 2026-02-25 | Channel Editor page with Summary tab (create + edit + save) |
| 2026-02-25 | Channel List UI with TanStack Query hooks and new channel dialog |
| 2026-02-24 | Channel CRUD API (6 endpoints, 18 tests) |
