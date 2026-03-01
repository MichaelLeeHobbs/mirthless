# Project Status

> Last updated: 2026-03-01

## Package Status

| Package | Phase | What's Done | What's Next |
|---------|-------|-------------|-------------|
| `@mirthless/core-models` | Complete (v1) | Branded types, constants, Zod schemas (channel CRUD, destinations, metadata, users, **code templates**, **global scripts**, **filters**, **transformers**), **97 schema validation tests** | Refine schemas as features develop |
| `@mirthless/core-util` | HL7v2 Parser | Result re-export, validation utils, **HL7v2 parser** (encoding, path, message, ACK), **68 HL7 tests** | Add utilities as needed (YAGNI) |
| `@mirthless/engine` | Pipeline Complete | **Sandbox executor** (vm-based), **script compiler** (esbuild), **8-stage message pipeline**, **channel runtime** (state machine), **queue consumer** (with DB content loading), in-memory message store, **filter/transformer compilation**, **code template injection**, **global scripts**, **HL7 bridge functions**, **globalChannelMap**, **destinationSet**, **142 engine tests** | Persistent message store, polling scheduler |
| `@mirthless/connectors` | TCP/MLLP + HTTP | Base interfaces, **TCP/MLLP receiver** (MLLP framing, connection pool), **TCP/MLLP dispatcher**, **HTTP receiver** (node:http), **HTTP dispatcher** (native fetch), connector registry, **49 connector tests** | File, Database, DICOM, FHIR connectors |
| `@mirthless/server` | API Phase 4 | Express app, config, middleware, DB schema, auth, seeds, **Channel CRUD API** (6 endpoints), **Deployment API** (8 endpoints), **Message Query API** (4 endpoints), **Statistics API** (3 endpoints), **User Management API** (7 endpoints), **Code Templates API** (8 endpoints), **Global Scripts API** (2 endpoints), **filter/transformer CRUD** (inline with channel), **172 server tests** | Alerts API |
| `@mirthless/web` | UI Phase 4 | React+MUI shell, auth flow, login page, **Channel Editor** (all 5 tabs + **source/destination filter & transformer UI**), **Dashboard** (summary cards, status table, quick actions), **Message Browser** (search, filter, detail panel), **Users Page** (CRUD, role chips, enable/disable/unlock), **Code Templates Page** (library tree, template editor), **Global Scripts Page** (4-tab Monaco editors), Monaco editor | Alert configuration |
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
| Manual test suite | Done | 13 test files, ~160 scenarios, `docs/testing/` |

## Verification Checklist

| Step | Status | Notes |
|------|--------|-------|
| `pnpm install` | PASS | 833 packages resolved |
| `pnpm build` | PASS | All 7 packages compile (0 errors) |
| `pnpm lint` | PASS | 0 warnings |
| `pnpm test` | PASS | **528 tests passing** (97 schema + 68 HL7 + 142 engine + 49 connectors + 172 server) |
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
