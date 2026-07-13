# Backup & Restore

Mirthless has **two independent backup layers**, and a complete disaster-recovery
plan uses both:

1. **Postgres database backup** (`pg_dump`) — the full source of truth: channels,
   messages, statistics, events, users (with password hashes), audit logs, everything.
2. **Application config backup** (`GET /api/v1/system/backup`) — a portable JSON
   snapshot of *configuration only* (channels, code templates, alerts, users without
   secrets, settings, resources, groups, tags, maps). Ideal for promoting config
   between environments or version-controlling it. It deliberately **excludes message
   content, statistics, and events**.

> Message content is PHI. Backups contain PHI (in the Postgres dump) — store and
> transmit them encrypted, restrict access, and follow your retention policy.

---

## 1. Postgres Database Backup (full)

This is the authoritative backup. The production stack runs Postgres 17 in the
`mirthless-db-prod` container (`mirthless-db` in the dev compose), database `mirthless`,
user `mirthless`, with data on the named volume `postgres_data`.

### Logical backup with `pg_dump` (recommended)

Run a compressed custom-format dump against the running container:

```bash
# Production compose: container name is mirthless-db-prod
docker exec -t mirthless-db-prod \
  pg_dump -U mirthless -d mirthless -F c \
  > mirthless-$(date +%Y%m%d-%H%M%S).dump
```

`-F c` (custom format) enables selective, parallel `pg_restore` and is smaller than
plain SQL. For a plain-SQL dump you can inspect, use `-F p` and redirect to a `.sql`
file.

Automate it with a cron job on the host (example: nightly at 02:00, keep 14 days):

```cron
0 2 * * * docker exec -t mirthless-db-prod pg_dump -U mirthless -d mirthless -F c > /backups/mirthless-$(date +\%Y\%m\%d).dump && find /backups -name 'mirthless-*.dump' -mtime +14 -delete
```

### Restore with `pg_restore`

Restoring into a **fresh, empty** database is safest. Stop the server first so nothing
writes during the restore.

```bash
# Stop the app (leave db running)
docker compose -f docker/docker-compose.prod.yml stop server web

# Drop & recreate the database, then restore
docker exec -t mirthless-db-prod psql -U mirthless -d postgres \
  -c "DROP DATABASE IF EXISTS mirthless WITH (FORCE);" \
  -c "CREATE DATABASE mirthless OWNER mirthless;"

cat mirthless-20260712-020000.dump | \
  docker exec -i mirthless-db-prod pg_restore -U mirthless -d mirthless --no-owner

# Bring the app back up (entrypoint re-runs migrations idempotently)
docker compose -f docker/docker-compose.prod.yml start server web
```

The dump captures the exact migrated schema, so restoring an older dump onto a newer
binary may require the pending migrations to run — the server container runs migrations
on start automatically. Restoring a **newer** dump onto an **older** binary is not
supported.

### Volume-level backup (alternative)

You can also back up the raw `postgres_data` volume, but only while Postgres is
**stopped** (a hot copy of the data directory can be inconsistent):

```bash
docker compose -f docker/docker-compose.prod.yml stop
docker run --rm -v mirthless_postgres_data:/data -v "$PWD":/backup alpine \
  tar czf /backup/pgdata-$(date +%Y%m%d).tar.gz -C /data .
docker compose -f docker/docker-compose.prod.yml start
```

Prefer `pg_dump` for routine backups; use volume snapshots only for full-machine
disaster recovery. (The actual volume name is `<project>_postgres_data`; check with
`docker volume ls`.)

---

## 2. Application Config Backup (JSON, config-only)

The server exposes a config export/import API. It is **not** a substitute for a Postgres
backup — it does not include messages, statistics, or events — but it's the right tool
for moving configuration between environments (dev → staging → prod) or keeping config
under version control.

### Endpoints

| Method | Path | Permission | Purpose |
|--------|------|-----------|---------|
| `GET`  | `/api/v1/system/backup` | `system:backup` | Export config as JSON |
| `POST` | `/api/v1/system/backup` | `system:restore` | Restore config from JSON |

Both require authentication (JWT bearer). The `admin` role holds both permissions.

### Export

```bash
curl -s https://your-host/api/v1/system/backup \
  -H "Authorization: Bearer $TOKEN" \
  | jq '.data' > mirthless-config-$(date +%Y%m%d).json
```

The response is `{ "success": true, "data": { ... } }`. The `data` object
(`version: 1`) contains:

- `channels`, `channelDependencies`, `channelGroups`, `groupMemberships`
- `codeTemplateLibraries`, `codeTemplates`, `globalScripts`
- `alerts`
- `users` — **without password hashes** (see below), `settings`, `resources` (with content)
- `tags`, `tagAssignments`, `configMap`, `globalMap`

### What is included vs excluded

**Included:** all channel configuration and the shared config surface listed above.

**Excluded (by design):**

- **Message content, statistics, and events** — transient operational data. Use the
  Postgres dump for these.
- **User passwords / password hashes** — the `users` section carries username, email,
  name, role, and enabled flag only. **No credentials are exported.** On restore,
  newly-created users have no usable password and must have one set (or the user
  re-created) out of band. This is intentional: config backups should be safe to store
  and diff without leaking secrets.
- **JWT secret, database credentials, and other environment secrets** — these live in
  `.env` / your secrets manager, never in the backup.

### Restore

`POST` the saved payload wrapped in a request body with a collision mode:

```bash
curl -s -X POST https://your-host/api/v1/system/backup \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{ "collisionMode": "SKIP", "backup": '"$(cat mirthless-config-20260712.json)"' }'
```

`collisionMode`:

- `SKIP` — existing entities (matched by id/key) are left untouched; only new ones are
  created. Safe default.
- `OVERWRITE` — existing entities are updated in place from the backup.

Restore runs in dependency order (settings → tags → groups → resources → code
templates → global scripts → channels → alerts → dependencies → maps → memberships →
assignments) and returns a per-section summary of created/updated/skipped/errors. A
`SERVER_RESTORED` audit event is emitted.

> After a config restore that changes channel definitions, redeploy affected channels
> for the changes to take effect in the running engine.
