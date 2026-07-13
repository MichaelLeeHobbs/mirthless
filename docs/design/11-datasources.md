# 11 — Data Sources (`dbQuery` bridge)

> Status: design (approved 2026-07-13). Named, admin-managed database connection
> profiles that channel scripts query via `dbQuery(dataSourceName, sql, params)`.
> This replaces the original, unwired `dbQuery(driver, connectionUrl, sql, params)`
> signature — see the reframe below.

## Why not the original signature

The sandbox declared `dbQuery(driver, connectionUrl, sql, params)` — the **script**
supplies the driver, host, and credentials inline. For a healthcare engine that is
the wrong shape, and it is why the bridge was left unwired (the other four bridges
shipped; see [`10-collections.md`](10-collections.md) and D-177):

- **Credential sprawl** — DB passwords live in channel scripts (plaintext in config,
  surfaced in error logs, no rotation).
- **Unbounded reach** — a script can connect to any host with any credentials it can
  construct: an exfiltration/SSRF primitive with no allowlist.
- **No stable pool key** — per-call URLs can't be pooled cleanly.

The bridge is unwired, so the signature is free to change. **Decision: named Data
Sources.** An admin defines connection profiles server-side; scripts reference them
by name. Credentials never touch scripts, the admin decides which databases are
reachable (allowlist *by construction*), and the pool key is the data-source id.

```js
const rows = await dbQuery('reporting-db',
  'SELECT report FROM reports WHERE accession = $1 ORDER BY created_at DESC LIMIT 1',
  [accession]);
```

This also sidesteps URL parsing: `ConnectionPool.create` already takes structured
`PoolConfig` (host/port/db/user/password), so a Data Source *is* a `PoolConfig` + a
name + policy.

## Data model — `data_sources`

| Field | Notes |
|---|---|
| `id` | uuid |
| `name` | unique; how scripts address it |
| `description` | free text |
| `driver` | `'postgres'` only in v1 (validated); stored so more drivers can be added |
| `host`, `port`, `database`, `user` | structured connection config |
| `password` | **encrypted at rest** via `content-crypto` (`encryptContent`/`decryptContent`, same `CONTENT_ENCRYPTION_KEY` as PHI); decrypted only when building the pool; never logged; never returned by the API |
| `readOnly` | policy flag, **default true** (see below) |
| `maxConnections` | pool size (default e.g. 5) |
| `statementTimeoutMs` | per-query DB-side timeout (default 30s) |
| `maxRows` | hard cap on rows returned to a script (default e.g. 10 000) |
| `createdAt`, `updatedAt` | |

New feature parallel to Resources/Collections: CRUD API + a Data Sources admin page,
RBAC `datasources:read/write/delete` (write/delete for admin + deployer only — they
hold DB credentials). Note this is *stricter* than today: connector passwords
currently sit unencrypted in connector-config JSONB, so encrypted Data Sources set
the pattern to backport later.

**No SSRF host-blocking here** (unlike `httpFetch`): internal databases are the whole
point, and the admin gate is the control.

## Bridge semantics

`dbQuery(dataSourceName, sql, params?) → readonly Record<string, unknown>[]`:

- **Parameterized only** — `params` is separate from `sql`; docs stress "never
  string-interpolate values." Passed straight to `pg` as `$1, $2, …`.
- **Read-only default** — a data source is read-only unless an admin flags it
  read-write. Enforced by the **DB role** (admin configures a read-only user) plus
  Postgres `default_transaction_read_only` on read-only pools — *not* by SQL-string
  sniffing (fragile). A read-write query against a read-only source fails at the DB.
- **Timeout** — `statement_timeout`/`query_timeout` on the pool bound each query
  DB-side; the sandbox wall-clock `AbortSignal` still caps the whole script.
- **Row cap** — enforce `maxRows`; exceeding it fails loud (not silent truncation).
- **Errors** — surface as thrown errors inside the script (via the bridge's
  `ioDispatch` ok/err envelope), like the other bridges.

## Pool manager

`DataSourcePoolManager` singleton keyed by data-source id, wrapping the existing
`packages/connectors/src/database/ConnectionPool`:

- Lazily `create()` a pool on first use; reuse across calls.
- **Invalidate** (destroy + drop) a pool when its Data Source is updated or deleted.
  No `RESOURCE_UPDATED`-style event bus exists, so `DataSourceService` mutations call
  the manager directly (both live in the server process).
- **Shutdown** — destroy all pools during server teardown (register with the existing
  graceful-shutdown sequence).
- Wired into `EngineManager` like the other bridges: one more dep in the
  `new VmSandboxExecutor({...})` construction.

## Drivers

v1 is **Postgres-only** (reuse `pg`/`ConnectionPool`); `driver` validated to
`'postgres'`. Define a thin `DbDriver` interface (`createPool(config)`,
`query(sql, params)`) so MySQL/MSSQL/Oracle are additive later — but don't build them
now (YAGNI).

## Security summary

- Credentials server-side, encrypted at rest, never logged, never returned by the API.
- Reachable databases limited to configured sources (allowlist by construction).
- Read-only by default, enforced by DB role + read-only transactions.
- Parameterized queries; statement timeout; row cap.
- `datasources:write/delete` gated to admin + deployer.
- Optional audit event `DB_QUERY` recording data-source name + row count (not SQL
  values / params — they may carry PHI).

## Build order (mirrors Collections)

1. **core-models** — `DataSource` schemas (create/update incl. `password`, query
   input), branded `DataSourceId`. Change the sandbox `dbQuery` bridge signature to
   `dbQuery(dataSourceName, sql, params)`.
2. **server** — `data_sources` table (password stored via `encryptContent`);
   `DataSourceService` (CRUD + `runQuery(name, sql, params)` with row cap +
   read-only enforcement); `DataSourcePoolManager`; routes + `datasources:*` RBAC;
   password redaction on all responses.
3. **engine/sandbox** — update the `dbQuery` types + bootstrap global in
   `bridge-functions.ts` / `sandbox-executor.ts`; wire `createDbQueryBridge()` into
   `EngineManager`; restore the `dbQuery` IntelliSense decl in `sandbox-types.ts`.
4. **web** — Data Sources page (define connection, "Test Connection" button, no
   password readback), nav item, RBAC gating.
5. **tests + docs** — service unit tests (CRUD, read-only enforcement, row cap,
   redaction), a real-Postgres integration test (`dbQuery` against the test DB),
   pool-manager lifecycle/invalidation tests, sandbox bridge test; `scripting-api.md`
   update, `docs/testing/` checklist, DECISIONS entry, and this doc.

## Open follow-ups (not v1)

- Additional drivers (MySQL/MSSQL/Oracle) behind the `DbDriver` interface.
- Backport encrypted-at-rest credentials to the Database *connector* config.
- An optional config-gated ad-hoc-URL escape hatch (only if a real need appears).
