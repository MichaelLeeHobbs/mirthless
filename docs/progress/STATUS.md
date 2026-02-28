# Project Status

> Last updated: 2026-02-28

## Package Status

| Package | Phase | What's Done | What's Next |
|---------|-------|-------------|-------------|
| `@mirthless/core-models` | Schema Testing | Package structure, branded types, constants, Zod schemas (channel CRUD + destination + metadata), **51 schema validation tests** | Refine schemas as engine develops |
| `@mirthless/core-util` | Scaffold | Package structure, Result re-export, validation utils | Add utilities as needed (YAGNI) |
| `@mirthless/engine` | Scaffold | Empty package shell | Channel runtime, message pipeline (Phase 2) |
| `@mirthless/connectors` | Scaffold | Empty package shell, base interface | TCP/MLLP connector (Phase 3) |
| `@mirthless/server` | API Phase 1 | Express app, config, middleware, DB schema, auth, seeds, **Channel CRUD API (6 endpoints, 23 service + 13 controller tests)**, destination/metadata sync, pruning fields | Channel deployment/lifecycle API |
| `@mirthless/web` | UI Phase 1 | React+MUI shell, auth flow, login page, dashboard stub, **Channel Editor (all 5 tabs: Summary, Source, Destinations, Scripts, Advanced)**, Monaco editor | Dashboard stats, engine integration |
| `@mirthless/cli` | Scaffold | Empty package shell | CLI commands (Phase 5) |

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
| `pnpm test` | PASS | 87 tests passing (51 schema + 23 service + 13 controller) |
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
