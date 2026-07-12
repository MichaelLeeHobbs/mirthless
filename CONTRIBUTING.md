# Contributing to Mirthless

Thanks for your interest in Mirthless. It's an open-source healthcare integration
engine, and because it can end up routing lab results and medication orders, we hold
contributions to a high bar — tests, strict typing, and fail-loud error handling are
not optional. Please read this before opening a PR.

## Ground Rules

- This is **healthcare software.** Messages must never be silently lost, duplicated,
  or corrupted. When in doubt, fail loudly (error status + logs), never silently.
- **PHI is real.** Never commit real patient data, credentials, or `.env` files. Use
  synthetic data in tests and examples.
- Read [`CLAUDE.md`](CLAUDE.md) and [`docs/standards/`](docs/standards/) — they define
  the coding standard this project enforces.

## Development Setup

Prerequisites: **Node.js 22+**, **pnpm 9+**, and **PostgreSQL 17** (Docker is easiest).

```bash
# 1. Install dependencies (pnpm workspaces — do NOT use npm/yarn)
pnpm install

# 2. Start PostgreSQL (dev compose stack)
pnpm docker:up                 # postgres on :5432 (db: mirthless / user: mirthless)

# 3. Configure environment
cp .env.example .env           # defaults line up with docker:up; edit if needed

# 4. Create schema and seed
pnpm db:migrate                # apply Drizzle migrations
pnpm db:seed                   # admin user + 10 example channels

# 5. Run the stack
pnpm dev                       # server on :3000, web UI on :5173
# Login: admin / Admin123!
```

The web UI proxies API calls to the server on `:3000`. Interactive API docs (Swagger)
are at `http://localhost:3000/api-docs` in development.

## Quality Gates

Every PR must pass all of these locally before you push — CI runs the same gates:

```bash
pnpm lint                      # ESLint, --max-warnings 0 (warnings fail)
pnpm build                     # tsc across all packages (strict mode)
pnpm test                      # Vitest unit/integration (mock-DB) across packages
```

Optional but encouraged:

```bash
pnpm test:coverage             # target 95%+ branch coverage on new code
pnpm test:e2e                  # Playwright E2E (needs a running/migrated DB)
pnpm test:integration          # real-Postgres integration lane (needs DATABASE_URL)
```

### Testing expectations

Tests are mandatory, not optional (see [`CLAUDE.md`](CLAUDE.md) → Testing Requirements):

- Every new function/module gets tests. Test **behavior, not implementation.**
- Cover the unhappy path — errors, edge cases, invalid input, timeouts — not just the
  happy path.
- Mock only external boundaries (DB, network, filesystem). Don't mock things you own.
- New raw-SQL paths should also get a real-DB integration test under
  `packages/server/test/integration/` (see the files there for the pattern).

## Coding Standards

We follow the **mission-critical-ts** standard strictly. Full rules live in
[`docs/standards/CodingStandard.md`](docs/standards/CodingStandard.md). Highlights:

- No `any` (use `unknown` + type guards). No `enum` (use `const` objects `as const`).
- No `throw` for control flow — services return `Result<T>` (via `stderr-lib`).
- No raw SQL — parameterized queries via Drizzle ORM only.
- No `eval` / `new Function` — user scripts run in the sandbox only.
- Validate all external input with Zod at every boundary.
- Functions ≤40 lines, ≤4 params, cyclomatic complexity ≤10, explicit return types.
- Immutability by default (`readonly`, `ReadonlyArray`, etc.).

`pnpm lint` enforces most of this; the reviewer enforces the rest.

## Branch, Commit, and PR Conventions

- **Branch off an up-to-date `main`.** Never commit directly to `main`. Use a short
  descriptive branch name with a type prefix, e.g. `feat/dicom-tls`, `fix/queue-dequeue`,
  `docs/ops-backup`, `ci/playwright-lane`.
- **Commits:** imperative mood, concise subject (≤72 chars), body explaining *why* when
  it isn't obvious. Group related changes; avoid noise commits.
- **PRs:** fill out the pull request template. Keep them focused — one logical change per
  PR. Link any related issue. Describe what you tested and how.
- A PR must be green on CI (lint + build + unit + integration) before review.

## Progress Docs

If your change is substantial, add an entry to
[`docs/progress/CHANGELOG.md`](docs/progress/CHANGELOG.md), and record any non-obvious
design decision in [`docs/progress/DECISIONS.md`](docs/progress/DECISIONS.md).

## Code of Conduct

Participation is governed by our [Code of Conduct](CODE_OF_CONDUCT.md). Be respectful.

## License

By contributing, you agree that your contributions are licensed under the project's
[MIT License](LICENSE).
