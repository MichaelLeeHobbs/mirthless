# Resource Sizing, Logging & Observability

Operational guidance for running Mirthless: health/readiness probes, Prometheus
metrics, log configuration, and rough sizing. Endpoints below are served by the
Node server on `:3000` (reachable through nginx in the production stack).

---

## Health & Readiness Endpoints

All three are **unauthenticated** and safe for load balancers / orchestrators. They are
excluded from HTTP request logging to avoid noise.

| Endpoint | Method | Purpose | Response |
|----------|--------|---------|----------|
| `/health/live` | GET | **Liveness** — process is up. Never touches the DB. | `200 {"status":"ok"}` |
| `/health/ready` | GET | **Readiness** — can serve traffic (DB reachable). | `200` when DB OK; `503 {"status":"unavailable"}` when not |
| `/health` | GET | **Full health** — DB, engine channel counts, memory, uptime. | `200` when `status:"ok"`; `503` when `status:"degraded"` (DB down) |

`/health` (full) payload:

```json
{
  "status": "ok",
  "timestamp": "2026-07-12T00:00:00.000Z",
  "uptime": 1234.5,
  "database": { "connected": true },
  "engine": { "deployed": 3, "started": 2, "stopped": 1, "paused": 0 },
  "memory": { "rss": 0, "heapUsed": 0, "heapTotal": 0, "external": 0 }
}
```

Recommended probe wiring:

- **Liveness probe** → `/health/live` (restart the container only if the process is
  wedged; do not gate on the DB, or a DB blip would restart-loop the app).
- **Readiness probe** → `/health/ready` (pull the instance out of rotation while the DB
  is unreachable).

The Docker healthcheck for the server container uses `/health/live` (see
`docker/docker-compose.prod.yml`).

---

## Metrics (`/metrics`, Prometheus)

The server exposes Prometheus metrics via `prom-client` at **`/metrics`** (default Node
process metrics plus HTTP request metrics from the metrics middleware).

**Access control — auth-gated by default.** `/metrics` requires authentication and the
`system:info` permission **unless** `METRICS_PUBLIC=true` is set. Only set
`METRICS_PUBLIC=true` when the endpoint is reachable solely by a **network-isolated**
scraper.

Defense in depth: the shipped `docker/nginx/default.conf` additionally restricts
`/metrics` at the proxy to loopback and the Docker bridge ranges (`127.0.0.1`,
`10.0.0.0/8`, `172.16.0.0/12`) and denies everything else. Keep that allow-list tight; do
not expose metrics to the public internet (they leak operational detail).

Scrape config sketch (when `METRICS_PUBLIC=true` on an internal network):

```yaml
scrape_configs:
  - job_name: mirthless
    metrics_path: /metrics
    static_configs:
      - targets: ['mirthless-server:3000']
```

If you keep `/metrics` auth-gated instead, configure the scraper with a bearer token for
a `system:info`-capable user.

---

## Logging

Logging uses **Pino** (`pino` + `pino-http`). Human-readable via `pino-pretty` in dev,
structured JSON in production.

| Variable | Values | Default | Notes |
|----------|--------|---------|-------|
| `LOG_LEVEL` | `debug` / `info` / `warn` / `error` | `info` (`debug` in dev `.env`) | Set `info` or `warn` in prod; `debug` is verbose. |
| `LOG_HTTP_HEADERS` | `true` / `false` | `false` | See caveat below. |

Health and metrics requests (`/health`, `/health/live`, `/health/ready`, `/metrics`) are
not logged, so probe traffic won't drown your logs.

### `LOG_HTTP_HEADERS` caveat

When `false` (the default), request logs include only `id`, `method`, and `url` for the
request and `statusCode` for the response — minimal and safe. Setting `LOG_HTTP_HEADERS=true`
logs **full inbound request headers**, which is verbose and can capture sensitive material
(the `authorization`/`cookie`/`set-cookie` headers and known secret fields are redacted by
the logger, but custom headers are not). **Keep it `false` in production**; enable it only
transiently for debugging, and never ship it on in an environment handling PHI.

### PHI in logs

Never log message content. The application avoids logging PHI and credentials; if you add
logging in custom scripts or forks, keep PHI and secrets out of log lines — logs are
generally less protected than the database.

---

## Resource Sizing (starting points)

Mirthless is currently a **single-instance** deployment (no horizontal clustering yet).
There are no hard, benchmarked numbers for every workload — start here and adjust from the
`/health` memory stats and `/metrics` under your real load. See
[`docs/ops/throughput-benchmark.md`](throughput-benchmark.md) for a measured baseline and
how to reproduce it on your hardware.

| Component | Small / dev | Production starting point | Scale driver |
|-----------|-------------|---------------------------|--------------|
| **Server (Node)** | 0.5 vCPU / 512 MB | 2 vCPU / 1–2 GB | Message rate, script complexity, connector count |
| **Postgres** | 1 vCPU / 1 GB | 2–4 vCPU / 4–8 GB + fast SSD | Message volume + retention; this is usually the bottleneck |
| **Disk (Postgres)** | a few GB | Size for retention: (msgs/day × avg message size × retention days) × ~2–3 | Message storage mode + pruning policy |

Levers that dominate resource use:

- **Message storage mode** (per channel): `PRODUCTION`/`DEVELOPMENT` store full content;
  `METADATA`/`RAW`/`DISABLED` store less. Storing less content cuts DB size and I/O
  dramatically.
- **Data pruning** — enable per-channel pruning (`pruningEnabled` + `pruningMaxAgeDays`)
  and run the pruner so message tables don't grow unbounded. See
  [`docs/ops/backup-restore.md`](backup-restore.md) for the operational data lifecycle.
- **Script timeout** (`scriptTimeoutSeconds`, default 30) bounds CPU per message in the
  sandbox.
- **Node heap** — watch `memory.heapUsed` from `/health`; raise the container limit /
  `--max-old-space-size` if you run large batches or DICOM (100 MB+ objects).

Because it's single-instance, plan a maintenance window for restarts/upgrades rather than
relying on rolling deploys (see [`docs/ops/upgrade.md`](upgrade.md)).
