# Backup & Restore

GalvaniGraph has **two independent backup layers**, and a complete disaster-recovery
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
`galvanigraph-db-prod` container (`galvanigraph-db` in the dev compose), database `galvanigraph`,
user `galvanigraph`, with data on the named volume `postgres_data`.

> **Installs created under an earlier name** keep the database and user they were
> created with, `galvaniflow` or `mirthless` (set as `POSTGRES_DB` / `POSTGRES_USER`, see
> [Upgrade](upgrade.md#renamed-from-mirthless-or-galvaniflow)). Use that name in `-U` and
> `-d` in the commands below. The container is `galvanigraph-db-prod` once the stack has
> been restarted on the new compose file; before that it is `galvaniflow-db-prod` or
> `mirthless-db-prod`.

### Logical backup with `pg_dump` (recommended)

Run a compressed custom-format dump against the running container:

```bash
# Production compose: container name is galvanigraph-db-prod
file=galvanigraph-$(date +%Y%m%d-%H%M%S).dump
docker exec galvanigraph-db-prod pg_dump -U galvanigraph -d galvanigraph -F c > "$file.partial" &&
  docker exec -i galvanigraph-db-prod pg_restore -f /dev/null < "$file.partial" &&
  mv "$file.partial" "$file"
```

The second command reads the whole dump back, and only a dump that passes gets its final name. A file still ending in `.partial` is not a backup.

Run `pg_dump` through `docker exec` without `-t`. With `-t` it writes to a terminal, which changes the newline bytes in the file, and the dump can't be restored.

`-F c` (custom format) enables selective, parallel `pg_restore` and is smaller than
plain SQL. For a plain-SQL dump you can inspect, use `-F p` and redirect to a `.sql`
file.

Automate it with a cron job on the host (example: nightly at 02:00, keep 14 days):

```cron
0 2 * * * f=/backups/galvanigraph-$(date +\%Y\%m\%d).dump; docker exec galvanigraph-db-prod pg_dump -U galvanigraph -d galvanigraph -F c > $f.partial && docker exec -i galvanigraph-db-prod pg_restore -f /dev/null < $f.partial && mv $f.partial $f && find /backups -name 'galvanigraph-*.dump*' -mtime +14 -delete
```

Old dumps, and `.partial` files from runs that failed, are deleted only after a new dump has been read back.

### Check a dump

```bash
docker exec -i galvanigraph-db-prod pg_restore -f /dev/null < galvanigraph-20260712-020000.dump && echo "dump OK"
```

This reads the whole file and restores nothing. If it doesn't print `dump OK`, the file can't be restored as it is. `pg_restore --list` is not enough, because it reads only the table of contents. The check works on custom-format dumps (`-F c`), not on plain SQL.

### Dumps taken with `docker exec -t`

Until 2026-11-23 this page and the upgrade guide ran `pg_dump` through `docker exec -t`, and the dumps that wrote can't be restored ([#361](https://github.com/MichaelLeeHobbs/mirthless/issues/361)). `pg_dump` exited 0, so nothing reported it. If you used those commands:

1. Switch to the commands above, take a new backup now and check it. Update the cron job too.
2. [Check](#check-a-dump) each older dump you still need.
3. Repair the ones that fail. The terminal put one carriage return before each newline byte, and this takes exactly those out:

   ```bash
   perl -pe 's/\r\n\z/\n/' galvanigraph-20260712-020000.dump > repaired.dump
   ```

4. Check `repaired.dump`, and keep the original until it passes. If it fails too, the dump has other damage.

Don't repair a dump that passes the check: the repair damages a good one.

### Restore with `pg_restore`

Restoring into a **fresh, empty** database is safest. Stop the server first so nothing
writes during the restore.

**[Check the dump](#check-a-dump) before you start.** The steps below drop the database before they read the file.

```bash
# Stop the app (leave db running)
docker compose -f docker/docker-compose.prod.yml stop server web

# Drop & recreate the database, then restore
docker exec galvanigraph-db-prod psql -U galvanigraph -d postgres \
  -c "DROP DATABASE IF EXISTS galvanigraph WITH (FORCE);" \
  -c "CREATE DATABASE galvanigraph OWNER galvanigraph;"

cat galvanigraph-20260712-020000.dump | \
  docker exec -i galvanigraph-db-prod pg_restore -U galvanigraph -d galvanigraph --no-owner --no-privileges

# Bring the app back up (entrypoint re-runs migrations idempotently)
docker compose -f docker/docker-compose.prod.yml start server web
```

`--no-privileges` leaves out the dump's grants to the server's role (`galvanigraph_app`,
see [Database roles](upgrade.md#database-roles)). When the server container starts, it
creates that role if it is missing, grants it again, revokes the owner functions from
`PUBLIC` and hands it the `pgboss` schema. Without the flag, a restore into a Postgres
where the role does not exist yet reports `role "galvanigraph_app" does not exist` for
each grant and exits 1, though the data is restored.

The dump captures the exact migrated schema, so restoring an older dump onto a newer
binary may require the pending migrations to run — the server container runs migrations
on start automatically. Restoring a **newer** dump onto an **older** binary is not
supported.

### Volume-level backup (alternative)

You can also back up the raw `postgres_data` volume, but only while Postgres is
**stopped** (a hot copy of the data directory can be inconsistent):

```bash
docker compose -f docker/docker-compose.prod.yml stop
docker run --rm -v docker_postgres_data:/data -v "$PWD":/backup alpine \
  tar czf /backup/pgdata-$(date +%Y%m%d).tar.gz -C /data .
docker compose -f docker/docker-compose.prod.yml start
```

Prefer `pg_dump` for routine backups; use volume snapshots only for full-machine
disaster recovery. (The volume name is `<project>_postgres_data`. The compose project
defaults to the compose file's folder, `docker`, so it is `docker_postgres_data` unless you
run compose with `-p`; check with `docker volume ls`.)

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
curl -s -G https://your-host/api/v1/system/backup \
  --data-urlencode "reason=Nightly configuration backup" \
  -H "Authorization: Bearer $TOKEN" \
  | jq '.data' > galvanigraph-config-$(date +%Y%m%d).json
```

The `reason` is required (one line, 3 to 500 characters): it is recorded in the audit log with the download, which is refused with 503 `AUDIT_UNAVAILABLE` when it cannot be recorded (D-318).

The response is `{ "success": true, "data": { ... } }`. The `data` object
(`version: 1`) starts with `exportInfo`, naming the server, who downloaded it, when, the audit record and the reason; restore ignores it. The rest contains:

- `channels`, `channelDependencies`, `channelGroups`, `groupMemberships`
- `codeTemplateLibraries`, `codeTemplates`, `globalScripts`
- `alerts`
- `users` — **without password hashes** (see below), `settings`, `resources` (with content)
- `tags`, `tagAssignments`, `configMap`, `globalMap`

A backup is complete or it fails: if a channel or a resource cannot be read, or there are more than 10,000 channels or alerts, the download answers an error and the server log says why. For a channel the error names it.

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
  -d '{ "collisionMode": "SKIP", "backup": '"$(cat galvanigraph-config-20260712.json)"' }'
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
