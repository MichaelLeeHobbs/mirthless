# Implementation Changelog

> Session-by-session log of what was built. Enables any future Claude instance to pick up where we left off.

## 2026-02-25 — Initial Scaffolding

### What was done:
- Created progress tracking system (`docs/progress/`)
- Set up monorepo root configuration (package.json, tsconfig, eslint, prettier, etc.)
- Docker setup with PostgreSQL 17
- Scaffolded all 7 packages:
  - `@mirthless/core-models` — branded types, constants, Zod schemas from design doc 01
  - `@mirthless/core-util` — Result re-export, validation utils
  - `@mirthless/engine` — empty shell
  - `@mirthless/connectors` — empty shell with base interface
  - `@mirthless/server` — Express app, config, middleware, Drizzle schema, auth, seeds
  - `@mirthless/web` — React+MUI shell, auth flow, login page
  - `@mirthless/cli` — empty shell
- Adapted auth system from fullstack-template (JWT + sessions + RBAC)
- Wrote Drizzle schema for all tables from design doc 07
- Verified: pnpm install (833 packages), build (0 errors), lint (0 warnings), test (framework runs)

### Build fixes applied:
- Zod v4: `z.record(z.unknown())` → `z.record(z.string(), z.unknown())` (2-arg requirement)
- stderr-lib Result<T>: Success needs `error: null`, Failure needs `value: null`
- Web tsconfig: `module: "ESNext"`, `moduleResolution: "bundler"` (for MUI + Vite)
- `exactOptionalPropertyTypes`: conditional property inclusion instead of `undefined` assignment
- Vitest: `passWithNoTests: true` in all 6 configs
- Drizzle bigint: `mode: 'number'` instead of `mode: 'bigint'` (BigInt JSON.stringify error in Drizzle Kit)
- Replaced `bcrypt` with `bcryptjs` (native binding missing for Node.js v24 on Windows)
- Web API base URL: `/api/v1` (matches server route mount)

### Key decisions made:
- See DECISIONS.md D-001 through D-012

### What's next:
- Channel CRUD API endpoints
- Channel list page in web UI
- Engine message pipeline (Phase 2)
