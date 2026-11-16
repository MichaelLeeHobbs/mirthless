# 28 — Health Check Endpoints

## Prerequisites
- Server running (dev or production)
- Database accessible

## Liveness Probe

| # | Scenario | Steps | Expected | Pass? |
|---|---|---|---|---|
| 1 | Liveness always returns 200 | `GET /health/live` | 200 `{ "status": "ok" }` | |
| 2 | Liveness works without auth | No Authorization header | Still returns 200 | |

## Readiness Probe

| # | Scenario | Steps | Expected | Pass? |
|---|---|---|---|---|
| 3 | Readiness returns 200 when DB connected | `GET /health/ready` | 200 `{ "status": "ok", "database": { "connected": true } }` | |
| 4 | Readiness returns 503 when DB unreachable | Stop PostgreSQL, `GET /health/ready` | 503 `{ "status": "unavailable", "database": { "connected": false } }` | |
| 4a | A failed startup step is reported and skips nothing | Make pg-boss fail to start (a database user that can't create the `pgboss` schema), restart, `GET /health/ready` | 200 `status: "degraded"`, `startup.failedSteps` lists `queue` and `pruner-scheduler`; `GET /health` answers 200 `{ "status": "degraded" }`; channels that were deployed are deployed again; a `SERVER_STARTUP_STEP_FAILED` event per step | |

## Full Health Check

| # | Scenario | Steps | Expected | Pass? |
|---|---|---|---|---|
| 5 | Public health returns the status only | `GET /health` (no auth) | 200 `{ "status": "ok" }` and nothing else | |
| 5a | Full health returns all sections | `GET /health/full` as an admin | 200 with status, timestamp, uptime, database, engine, memory and startup sections | |
| 5b | Full health needs `system:info` | `GET /health/full` with no token, then as a viewer | 401, then 403 | |
| 6 | Engine stats show deployed channels | Deploy 2 channels, start 1, `GET /health/full` | engine.deployed=2, engine.started=1, engine.stopped=1 | |
| 7 | Memory stats present | `GET /health/full` | memory.rss, memory.heapUsed, memory.heapTotal, memory.external all present and positive | |
| 8 | Health returns 503 when DB down | Stop PostgreSQL, `GET /health`, then `GET /health/full` | 503 `{ "status": "degraded" }`; `/health/full` also shows database.connected=false | |
