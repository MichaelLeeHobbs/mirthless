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
> [Upgrade](upgrade.md#renamed-from-mirthless-or-galvaniflow)). Use that name in `-U`,
> `-d` and the SQL of the commands below, and set it for `backup.sh`. The container is `galvanigraph-db-prod` once the stack has
> been restarted on the new compose file; before that it is `galvaniflow-db-prod` or
> `mirthless-db-prod`.

### Logical backup with `pg_dump` (recommended)

Run this on the Docker host, from the checkout. The directory must exist, and should be outside the checkout:

```bash
sh docker/backup.sh /backups
```

It takes a compressed custom-format dump from the running container, reads it back, and prints `dump OK` with the file's name, `galvanigraph-<UTC time>.dump`. If anything fails it exits non-zero and leaves no dump. A `.partial` file stays only if the script is killed outright or the machine goes down; delete it, it holds PHI. Only the user who ran it can read the dump.

If your database user, database or container has another name, set `POSTGRES_USER`, `POSTGRES_DB` or `DB_CONTAINER`, in the cron job too. An install created as Mirthless always needs the first two, and the third until its container is renamed:

```bash
DB_CONTAINER=mirthless-db-prod POSTGRES_USER=mirthless POSTGRES_DB=mirthless sh docker/backup.sh /backups
```

Automate it with a cron job on the host (example: nightly at 02:00, keep 14 days, checkout in `/opt/galvanigraph`):

```cron
0 2 * * * sh /opt/galvanigraph/docker/backup.sh /backups && find /backups -maxdepth 1 -type f -name 'galvanigraph-*.dump' -mtime +14 -delete
```

Old dumps are deleted only after a new one has been read back. Make sure someone sees the job fail: cron mails the output only if the host can send mail.

The read-back finds a file that is cut short or garbled, and one without GalvaniGraph's tables. It doesn't find everything, and can't tell whether the data is what you expect. Only a restore proves a backup, so restore one into a spare Postgres from time to time.

### Check a dump

```bash
sh docker/check-dump.sh /backups/galvanigraph-20260712-020000.dump
```

This reads the dump back as `backup.sh` does and restores nothing. Use it on custom-format dumps (`-F c`). It needs the `postgres:17-alpine` image. If Docker can't run the check, it says so, and that says nothing about the dump.

Don't use `pg_restore`'s exit status alone. It reads some damaged files as an empty archive, exits 0, and restores nothing.

### Dumps taken with `docker exec -t`

Until 2026-11-23 this page and the upgrade guide ran `pg_dump` through `docker exec -t`. That put a carriage return before every newline byte of the dump. Restoring one fails, or restores nothing and reports no error ([#361](https://github.com/MichaelLeeHobbs/mirthless/issues/361)). `pg_dump` exited 0, so nothing reported it. If you used those commands:

1. Take a new backup with `backup.sh` now, and change the cron job.
2. Repair each older dump you still need, on a host that has Perl, from the checkout:

   ```bash
   sh docker/repair-dump.sh /backups/galvanigraph-20260712-020000.dump
   ```

   It writes `galvanigraph-20260712-020000.dump.repaired` without exactly those carriage returns, and prints `dump OK` if that can be read. It never changes the original, and refuses a dump that wasn't damaged this way. The cron job above doesn't delete repaired files.
3. Keep the original until you have restored the repaired file somewhere.

If the repaired dump is reported `NOT OK`, it has other damage too. A warning from `pg_dump` inside the file is one cause. Plain-SQL dumps (`-F p`) taken with `-t` load with the same rows; only the text of database functions gains carriage returns.

### Restore with `pg_restore`

Restoring into a **fresh, empty** database is safest, so this drops the database and creates it again.

Put your file in the first line and paste the whole block. Each step runs only if the one before it worked. The dump is checked first, because the next steps stop the server and drop the database:

```bash
f=/backups/galvanigraph-20260712-020000.dump
sh docker/check-dump.sh "$f" &&
  docker compose -f docker/docker-compose.prod.yml stop server web &&
  docker exec galvanigraph-db-prod psql -v ON_ERROR_STOP=1 -U galvanigraph -d postgres \
    -c "DROP DATABASE IF EXISTS galvanigraph WITH (FORCE);" \
    -c "CREATE DATABASE galvanigraph OWNER galvanigraph;" &&
  docker exec -i galvanigraph-db-prod pg_restore -U galvanigraph -d galvanigraph --no-owner --no-privileges < "$f" &&
  echo "restored: $f"
```

**Start the server only after it prints `restored`.** On an empty or half-restored database the server migrates and seeds what is there and looks like a new install. If you are rolling back an upgrade, put the previous version back before you start it, because the server container runs any pending migrations when it starts.

```bash
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
