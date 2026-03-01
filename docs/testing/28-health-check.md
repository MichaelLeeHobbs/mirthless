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

## Full Health Check

| # | Scenario | Steps | Expected | Pass? |
|---|---|---|---|---|
| 5 | Full health returns all sections | `GET /health` | 200 with status, timestamp, uptime, database, engine, memory sections | |
| 6 | Engine stats show deployed channels | Deploy 2 channels, start 1, `GET /health` | engine.deployed=2, engine.started=1, engine.stopped=1 | |
| 7 | Memory stats present | `GET /health` | memory.rss, memory.heapUsed, memory.heapTotal, memory.external all present and positive | |
| 8 | Full health returns 503 when DB down | Stop PostgreSQL, `GET /health` | 503 with status='degraded', database.connected=false | |
