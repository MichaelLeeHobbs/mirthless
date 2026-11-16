# What CI runs

`.github/workflows/ci.yml` runs on every pull request to `main` and every push to `main`. On a pull request, its first job, `changes`, looks at which files changed and picks the jobs the change needs. The rules live in one script, [`scripts/ci/classify-changes.mjs`](../../scripts/ci/classify-changes.mjs), with table tests beside it that `pnpm gate` runs (`pnpm test:ci`). Why it works this way: D-280 in [`DECISIONS.md`](../progress/DECISIONS.md).

A pull request is compared with its merge base on `main`.

| Changed | Jobs |
|---|---|
| `packages/web` | Gate (web tests), e2e |
| `packages/server` | Gate (server tests), Postgres integration, e2e |
| `packages/connectors` | Gate (connectors and server tests), connector integration, Postgres integration, e2e |
| `packages/engine`, `core-util`, `core-models` | Gate (the package and everything that depends on it), both integration lanes, e2e |
| `packages/cli` | Gate (cli tests) |
| `e2e/**`, `playwright.*` | e2e |
| `docs/**`, top-level `*.md`, `.claude/**`, `.github/ISSUE_TEMPLATE/**`, `.github/PULL_REQUEST_TEMPLATE.md`, `.github/dependabot.yml`, `LICENSE` | `docs`: the unit tests whose source names a changed file, such as the guards on `docs/user/connector-reference.md`. Nothing else. |
| `.github/workflows/**`, `scripts/ci/**` | Everything, decided in the workflow without running the classifier, so a pull request that breaks the classifier still runs its tests |
| Anything else: root `package.json`, `pnpm-lock.yaml`, `tsconfig*`, `eslint.config.js`, `docker/**`, `scripts/**`, a path with no rule | Everything |

The server's docs guards that read the repository through `readRepoFile` (connector reference, access control, capabilities) run in the `docs` job on every change whose gate doesn't already run the server's tests. The capabilities page cites proof tests across the repo, so deleting a cited web test or e2e spec must still fail CI.

A package's jobs come from the workspace dependency graph: a job runs when a package it exercises, or one of that package's dependencies, changed. Connector integration exercises connectors; the Postgres lane, server; e2e, server and web.

Inside the gate, build, lint and `pnpm audit` always cover the whole repository. Only the unit tests narrow, to the changed packages and the packages that depend on them, and each package's coverage minimums still apply.

These run everything, whatever changed:

- every push to `main`: nobody waits on it, it catches what two green pull requests break together, and a force push can't hide the commits it replaced,
- a version tag (`docker-build.yml` calls `ci.yml` before it publishes images),
- an empty diff, or one the classifier cannot compute (no merge base, a script error).

Dependency changes move `pnpm-lock.yaml`, so they run everything, `pnpm audit` included. A docs-only or e2e-only pull request skips the gate job and with it the audit; the next push to `main` runs it.

## The required check

`ci-ok` needs every other job and runs even when they fail. It passes when each job passed or was skipped and fails when any failed or was cancelled. A skipped job never reports a status, so branch protection on `main` should require `ci-ok` alone, not the individual jobs. `main` has no branch protection configured yet; until it does, nothing stops a merge with a red `ci-ok`.

## Checking a diff locally

```bash
node scripts/ci/classify-changes.mjs origin/main
```

prints the jobs a diff from `origin/main` to `HEAD` would run, with the reason when it chose everything.

## Adding a job

Add it to `CI_JOBS` in the classifier and to `ci-ok`'s `needs`, and give it an `if:` on a `changes` output. `classify-changes.test.mjs` fails until all three agree.
