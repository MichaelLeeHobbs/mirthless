# What CI runs

`.github/workflows/ci.yml` runs on every pull request to `main` and every push to `main`. Its first job, `changes`, looks at which files changed and picks the jobs the change needs. The rules live in one script, [`scripts/ci/classify-changes.mjs`](../../scripts/ci/classify-changes.mjs), with table tests beside it that `pnpm gate` runs (`pnpm test:ci`). Why it works this way: D-279 in [`DECISIONS.md`](../progress/DECISIONS.md).

A pull request is compared with its merge base on `main`; a push with the commit before it.

| Changed | Jobs |
|---|---|
| `packages/web` | Gate (web tests), e2e |
| `packages/server` | Gate (server tests), Postgres integration, e2e |
| `packages/connectors` | Gate (connectors and server tests), connector integration, Postgres integration, e2e |
| `packages/engine`, `core-util`, `core-models` | Gate (the package and everything that depends on it), both integration lanes, e2e |
| `packages/cli` | Gate (cli tests) |
| `e2e/**`, `playwright.*` | e2e |
| `docs/**`, top-level `*.md`, `.claude/**`, `.github/ISSUE_TEMPLATE/**`, `.github/PULL_REQUEST_TEMPLATE.md`, `.github/dependabot.yml`, `LICENSE` | `docs`: the unit tests whose source names a changed file, such as the guards on `docs/user/connector-reference.md`. Nothing else. |
| Anything else: root `package.json`, `pnpm-lock.yaml`, `tsconfig*`, `eslint.config.js`, `.github/workflows/**`, `docker/**`, `scripts/**`, a path with no rule | Everything |

A package's jobs come from the workspace dependency graph: a job runs when a package it exercises, or one of that package's dependencies, changed. Connector integration exercises connectors; the Postgres lane, server; e2e, server and web.

Inside the gate, build, lint and `pnpm audit` always cover the whole repository. Only the unit tests narrow, to the changed packages and the packages that depend on them, and each package's coverage minimums still apply.

These run everything, whatever changed:

- a version tag (`docker-build.yml` calls `ci.yml` before it publishes images),
- an empty diff, or one the classifier cannot compute (no base commit, a script error).

## The required check

`ci-ok` needs every other job and runs even when they fail. It passes when each job passed or was skipped and fails when any failed or was cancelled. A skipped job never reports a status, so branch protection on `main` should require `ci-ok` alone, not the individual jobs.

## Checking a diff locally

```bash
node scripts/ci/classify-changes.mjs origin/main
```

prints the jobs a diff from `origin/main` to `HEAD` would run, with the reason when it chose everything.

## Adding a job

Add it to `CI_JOBS` in the classifier and to `ci-ok`'s `needs`, and give it an `if:` on a `changes` output. `classify-changes.test.mjs` fails until all three agree.
