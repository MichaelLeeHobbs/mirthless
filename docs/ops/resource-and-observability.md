# Resource Sizing, Logging & Observability

Operational guidance for running GalvaniGraph: health/readiness probes, Prometheus
metrics, log configuration, and rough sizing. Endpoints below are served by the
Node server on `:3000` (reachable through nginx in the production stack).

---

## Health & Readiness Endpoints

The first three are **unauthenticated** and safe for load balancers / orchestrators. `/health/full` needs a session with `system:info`. They are excluded from HTTP request logging to avoid noise.

| Endpoint | Method | Purpose | Response |
|----------|--------|---------|----------|
| `/health/live` | GET | **Liveness** — process is up. Never touches the DB. | `200 {"status":"ok"}` |
| `/health/ready` | GET | **Readiness** — can serve traffic (DB reachable). | `200` when DB OK (`status:"degraded"` and `startup.failedSteps` when a startup step failed); `503 {"status":"unavailable"}` when the DB is not |
| `/health` | GET | **Health status only** — `{"status":"ok"}` or `{"status":"degraded"}`, nothing else. | `200` for `ok` and for `degraded` from a failed startup step; `503` (`degraded`) only while the DB is unreachable |
| `/health/full` | GET | **Full health** (needs `system:info`) — DB, engine channel counts, memory, uptime, failed startup steps with their errors. | Same status codes as `/health` |

### Startup steps

At startup the server starts the job queue (pg-boss), then the data pruner schedule, which needs the queue, and redeploys what each enabled channel last deployed (its recorded deployment, D-328), never configuration saved since. Channel redeploy does not use the queue, so it runs alongside it, and one failed step never skips another. A step fails when it throws or reports an error, and the queue and the pruner schedule also fail when they have not started after 60 seconds. Channel redeploy has no time limit; it reads every live channel in one query, deploys each once, and fails when any channel could not be redeployed, naming those channels (the others are still deployed). It does not redeploy a channel the script watchdog holds ([below](#a-script-that-hangs-the-server)), which counts as failed, a channel someone undeployed, or an enabled channel that has never been deployed: the last is logged and recorded as a `CHANNEL_NOT_REDEPLOYED` WARN event, and does not fail the step. A step reported failed by its timeout keeps running: if it then succeeds, its failure is cleared and a `Startup step finished after its timeout` WARN line is logged (a queue that starts late then starts the pruner schedule); if it fails, its real error replaces the timeout.

A failed step is logged at ERROR (`Startup step failed`, with `step`), recorded as a `SERVER_STARTUP_STEP_FAILED` event (Events page), and reported by health: `/health/ready` and `/health` answer `200` with `status:"degraded"` (`/health/ready` also names the steps in `startup.failedSteps`: `queue`, `pruner-scheduler`, `channel-redeploy`, `audit-partitions`; the last also reruns daily, see [audit log](audit-log.md)), and `/health/full` adds each step's error and time. Both stay `200` so an instance is not pulled out of a load balancer, which would hide the UI an operator needs to fix it (D-308); alert on `status:"degraded"` instead. A failure stays recorded until the server restarts, or until that step later succeeds, so such an alert clears on the next restart that starts cleanly.

`/health/full` payload:

```json
{
  "status": "degraded",
  "timestamp": "2026-07-12T00:00:00.000Z",
  "uptime": 1234.5,
  "database": { "connected": true },
  "engine": { "deployed": 3, "started": 2, "stopped": 1, "paused": 0 },
  "memory": { "rss": 0, "heapUsed": 0, "heapTotal": 0, "external": 0 },
  "startup": { "failed": [{ "step": "queue", "errMsg": "permission denied for schema pgboss", "failedAt": "2026-07-12T00:00:05.000Z" }] }
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

## A script that hangs the server

A channel script's time limit does not stop every script. One it does not stop holds the server's main thread: no channel, API request or health check runs. A watchdog thread ends the process when a script is still running 60 seconds past its limit, and the supervisor starts the server again.

- The channel whose script was stuck stays undeployed after the restart, so the same message can't hang the server again. The others come back. The log has a FATAL line from the watchdog naming the channel. The start logs an ERROR, records a `CHANNEL_NOT_REDEPLOYED` ERROR event with the reason, and reports the `channel-redeploy` step as failed, so health is `degraded`.
- To bring the channel back, fix its script and deploy it. A message it had not finished runs again then, if its content is stored. To keep it off without the error at every start, disable the channel instead.
- If the database does not answer within 8 seconds, the server is ended without holding the channel, and the channel comes back with the restart. If the script ends by itself meanwhile, the server runs on and the channel with it.
- The server must run under something that restarts it: `restart: unless-stopped` (the production compose file), Kubernetes, systemd with `Restart=always`. It is ended with SIGKILL (exit code 137).
- A process cannot end itself as PID 1. The image runs [tini](https://github.com/krallin/tini) as PID 1; another image needs `docker run --init`. The server logs a warning at start when it is PID 1.
- A liveness probe that restarts the server sooner than the watchdog does loses the hold, and the same message can hang the server again after each restart. Give it a failure window longer than twice your longest script timeout plus 70 seconds (reading a script's result has a limit of the same length).
- The watchdog is off from when a debugger port is opened until it is closed or the server restarts: a breakpoint looks like a stuck script. The server logs a warning then, and an ERROR when the watchdog's thread stops, which is started again after 10 seconds.

---

## Metrics (`/metrics`, Prometheus)

The server exposes Prometheus metrics at **`/metrics`**: Node's process metrics, the HTTP requests (`http_request_duration_seconds`, `http_requests_total`, by method, route and status code), and these, which have no labels:

| Metric | Type | Value |
|---|---|---|
| `galvanigraph_deployed_channels` | Gauge | Deployed channels, when read |
| `galvanigraph_started_channels` | Gauge | Deployed channels that are started, when read |
| `galvanigraph_messages_processed_total` | Counter | Messages the pipeline finished since the server started, on every channel: delivered, put on a queue, filtered, or recorded with an error, by crash recovery too. A message the store refused on receipt is not counted |
| `galvanigraph_db_pool_total` | Gauge | Connections the server's database pool holds, idle ones and ones still connecting included, when read. The job queue has a pool of its own, which is not in it |
| `galvanigraph_db_pool_idle` | Gauge | Idle connections of that pool, when read |

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
  - job_name: galvanigraph
    metrics_path: /metrics
    static_configs:
      - targets: ['galvanigraph-server:3000']
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
request and `statusCode` for the response — minimal and safe. The logged `url` is the path
plus the names of its query parameters, never their values: `/api/v1/channels/<id>/messages?contentSearch=12345&limit=25`
is logged as `/api/v1/channels/<id>/messages?contentSearch&limit`, because search terms are
usually patient identifiers. A part with no `=` (`?MRN123456`) or a name that isn't a plain
parameter name (a letter, then up to 63 letters, digits, `_`, `.`, `-`, `[` or `]`) is logged
as `<redacted>`. This holds with either setting. Setting `LOG_HTTP_HEADERS=true`
logs **full inbound request headers**, which is verbose and can capture sensitive material
(the `authorization`/`cookie`/`set-cookie` headers and known secret fields are redacted by
the logger, but custom headers and the `referer` URL are not). **Keep it `false` in production**; enable it only
transiently for debugging, and never ship it on in an environment handling PHI.

### nginx logs

The web container's nginx (`docker/nginx/default.conf`) writes its access log in its own
`no_query` format: client address, time, method, path, protocol, status, size and user agent,
with no query string and no referer. Its error log can't be reformatted: when the API is
unreachable (a 502), nginx's error line quotes the full request line and upstream URL, query
string included. Treat the web container's error output like the server log.

### PHI in logs

Never log message content. The application avoids logging PHI and credentials (a failed database statement is logged without its parameters, D-347); if you add
logging in custom scripts or forks, keep PHI and secrets out of log lines — logs are
generally less protected than the database.

---

## Resource Sizing (starting points)

GalvaniGraph is currently a **single-instance** deployment (no horizontal clustering yet).
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
