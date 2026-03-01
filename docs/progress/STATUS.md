# Project Status

> Last updated: 2026-03-01

## Package Status

| Package | Phase | What's Done | What's Next |
|---------|-------|-------------|-------------|
| `@mirthless/core-models` | Complete (v1) | Branded types, constants, Zod schemas (channel CRUD, destinations, metadata, users, **code templates**, **global scripts**, **filters**, **transformers**, **alerts**, **events**, **settings**), **184 schema validation tests** | Refine schemas as features develop |
| `@mirthless/core-util` | HL7v2 Parser | Result re-export, validation utils, **HL7v2 parser** (encoding, path, message, ACK), **68 HL7 tests** | Add utilities as needed (YAGNI) |
| `@mirthless/engine` | Pipeline Complete | **Sandbox executor** (vm-based), **script compiler** (esbuild), **8-stage message pipeline**, **channel runtime** (state machine), **queue consumer** (with DB content loading), in-memory message store, **filter/transformer compilation**, **code template injection**, **global scripts**, **HL7 bridge functions**, **globalChannelMap**, **destinationSet**, **142 engine tests** | Persistent message store, polling scheduler |
| `@mirthless/connectors` | TCP/MLLP + HTTP + File + Database | Base interfaces, **TCP/MLLP receiver** (MLLP framing, connection pool), **TCP/MLLP dispatcher**, **HTTP receiver** (node:http), **HTTP dispatcher** (native fetch), **File receiver** (polling, glob, post-processing), **File dispatcher** (pattern substitution, temp-file rename), **Database receiver** (polling, parameterized queries, update modes), **Database dispatcher** (parameterized queries, transactions), **query builder** (SQL injection safe), **connection pool** (pg), connector registry, **166 connector tests** | DICOM, FHIR connectors |
| `@mirthless/server` | API Phase 9 + Message Store | Express app, config, middleware, DB schema, auth, seeds, **Channel CRUD API** (6 endpoints), **Deployment API** (8 endpoints), **Message Query API** (4 endpoints), **Statistics API** (3 endpoints), **User Management API** (7 endpoints), **Code Templates API** (8 endpoints), **Global Scripts API** (2 endpoints), **Alerts API** (6 endpoints), **Events API** (3 endpoints), **Settings API** (5 endpoints), **Data Pruner API** (3 endpoints), **event emission** from all services, filter/transformer CRUD (inline with channel), **partition manager** (create/drop per-channel partitions), **data pruner** (age-based message cleanup), **queue manager** (FOR UPDATE SKIP LOCKED), **265 server tests** | DICOM, FHIR connectors |
| `@mirthless/web` | UI Phase 9 + Connectors | React+MUI shell, auth flow, login page, **Channel Editor** (all 5 tabs + **source/destination filter & transformer UI** + **File/Database source & destination forms**), **Dashboard** (summary cards, status table, quick actions), **Message Browser** (search, filter, detail panel), **Users Page** (CRUD, role chips, enable/disable/unlock), **Code Templates Page** (library tree, template editor), **Global Scripts Page** (4-tab Monaco editors), **Alerts Page** (list + toggle + editor), **Events Page** (paginated table, filters, detail panel, purge), **Settings Page** (category tabs, type-aware inputs, bulk save), Monaco editor | DICOM, FHIR connectors |
| `@mirthless/cli` | Scaffold | Empty package shell | CLI commands (future) |

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
| Manual test suite | Done | 24 test files, ~439 scenarios, `docs/testing/` |
| Playwright E2E | Done | 11 spec files, ~57 tests, `e2e/` (4 fixed) |

## Verification Checklist

| Step | Status | Notes |
|------|--------|-------|
| `pnpm install` | PASS | 833 packages resolved |
| `pnpm build` | PASS | All 7 packages compile (0 errors) |
| `pnpm lint` | PASS | 0 warnings |
| `pnpm test` | PASS | **825 tests passing** (184 schema + 68 HL7 + 142 engine + 166 connectors + 265 server) |
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
