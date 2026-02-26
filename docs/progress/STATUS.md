# Project Status

> Last updated: 2026-02-26

## Package Status

| Package | Phase | What's Done | What's Next |
|---------|-------|-------------|-------------|
| `@mirthless/core-models` | Scaffold | Package structure, branded types, constants, Zod schemas (incl. channel CRUD schemas) | Tests, refine schemas as engine develops |
| `@mirthless/core-util` | Scaffold | Package structure, Result re-export, validation utils | Add utilities as needed (YAGNI) |
| `@mirthless/engine` | Scaffold | Empty package shell | Channel runtime, message pipeline (Phase 2) |
| `@mirthless/connectors` | Scaffold | Empty package shell, base interface | TCP/MLLP connector (Phase 3) |
| `@mirthless/server` | API Phase 1 | Express app, config, middleware, DB schema, auth, seeds, **Channel CRUD API (6 endpoints, 18 tests)** | Channel deployment/lifecycle API |
| `@mirthless/web` | UI Phase 1 | React+MUI shell, auth flow, login page, dashboard stub, **Channel list page + new channel dialog** | Channel editor page, dashboard stats |
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

## Verification Checklist

| Step | Status | Notes |
|------|--------|-------|
| `pnpm install` | PASS | 833 packages resolved |
| `pnpm build` | PASS | All 7 packages compile (0 errors) |
| `pnpm lint` | PASS | 0 warnings |
| `pnpm test` | PASS | 18 tests passing (channel service) |
| `docker:up` | PASS | PostgreSQL 17 running |
| `db:generate` | PASS | 34 tables generated |
| `db:migrate` | PASS | Migrations applied |
| `db:seed` | PASS | Admin user + 31 permissions + settings |
| `dev:server` | PASS | Express on :3000, pgboss started |
| `dev:web` | PASS | Vite on :5173 in 435ms |
| Login round-trip | PASS | admin/Admin123! → JWT + 31 permissions |
