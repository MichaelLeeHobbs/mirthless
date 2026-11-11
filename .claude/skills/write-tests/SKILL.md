---
name: write-tests
description: Choose the right test layer for a change in this repository and write the test. Use when adding a function, fixing a bug, adding a route, a SQL query, a connector behaviour or a UI flow.
---

# Write tests

This is healthcare software. A bug gets a failing test first: write it, watch it fail for the right reason, then fix. The test stays.

## Pick the layer

| What you are changing | Where the test goes | Notes |
|---|---|---|
| A pure function, a Zod schema, a parser | `__tests__/<name>.test.ts` beside it | Valid, invalid and edge inputs |
| A service (`Result<T>`) | `packages/server/src/services/__tests__/` | Every success and error path |
| SQL, transactions, queues, pruning, partitions | `packages/server/test/integration/*.itest.ts` | Real Postgres. A mocked `db` cannot catch a wrong query, a bind limit or an aborted transaction |
| An API route | `packages/server/src/routes/__tests__/` | Auth, permission, validation, response shape |
| Engine pipeline, sandbox, runtime | `packages/engine/src/**/__tests__/` | Use the real `VmSandboxExecutor`; fake only the message store and the send function |
| How the server wires the engine | `packages/server/src/services/__tests__/engine-*.test.ts` | Import the real `@galvaniflow/engine`; fake the database services and connectors |
| A connector | `packages/connectors/src/<type>/__tests__/` | Real sockets on localhost for protocol behaviour (framing, stop with an open connection) |
| A protocol change end to end | `packages/connectors/src/__tests__/e2e/` | Real messages through a real pipeline |
| A React component | `__tests__/<Name>.test.tsx` beside it | Testing Library; query by role and label |
| A multi-step UI flow | `e2e/*.spec.ts` (Playwright) | Needs Postgres, migrated and seeded |
| How a page looks | `pnpm shots` | Add the page to `PAGES` in `scripts/shots/shots.mjs` |

## Rules

- **Test behaviour, not implementation.** Assert what the caller sees. A test that pins a mock call order breaks on every refactor and proves little.
- **Do not mock what we own.** Mock the outside: database, network, filesystem, clock. If a test needs to mock one of our services to work, prefer the real one with a faked boundary.
- **Mocks hide wiring bugs.** Several real defects here sat behind a mocked module: a compile failure dropped in silence, a setting that never reached the engine, a query that only fails on real Postgres. When the risk is in how parts connect, use the real parts.
- **Test the unhappy path first**: errors, timeouts, empty input, bad input, the second call, the concurrent call.
- **Names say what happens**: `it('returns an error when the channel id is invalid')`.
- **Fast**: unit tests under 100 ms each. Use fake timers for intervals.
- **No conditional assertions.** `if (!result.ok) return;` before the real `expect` lets a test pass while checking nothing. Assert the precondition.
- Coverage floors are in each package's `vitest.config.ts`. They are minimums the gate enforces, not targets; the target is 95% of branches.

## Run

```bash
pnpm --filter @galvaniflow/engine test          # one package
pnpm vitest run src/path/to/file.test.ts        # one file, from the package directory
pnpm test:integration                           # needs DATABASE_URL pointing at a *_test database
pnpm gate                                       # build, lint and every package's tests with coverage
```
