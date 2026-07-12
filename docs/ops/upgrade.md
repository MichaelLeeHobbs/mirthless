# Upgrade Procedure

Mirthless applies schema changes through **Drizzle migrations**. The golden rule:

> **Always back up the database, then run migrations, before starting the new server
> version.** Never point a new binary at an un-migrated database and never point an old
> binary at a database migrated by a newer version.

## How migrations run

- **Docker (production):** the server container's entrypoint
  (`docker/server-entrypoint.sh`) runs `node packages/server/migrate.mjs` on every
  start, *before* the server boots. Migrations are **fail-loud** — if a migration
  errors, the container exits and the server never serves against a half-migrated
  schema. It then runs an idempotent seed unless `SEED_ON_START=false`.
- **Local / non-Docker:** run `pnpm db:migrate` yourself before `pnpm start` /
  `pnpm dev`.

Migrations use `drizzle-orm`'s migrator reading the `.sql` files and
`meta/_journal.json` from `packages/server/src/db/migrations` (copied to
`packages/server/migrations` in the image). Applied migrations are tracked in Postgres,
so re-running is a no-op — safe and idempotent.

## Standard upgrade (Docker)

```bash
# 1. BACK UP FIRST (see docs/ops/backup-restore.md)
docker exec -t mirthless-db-prod pg_dump -U mirthless -d mirthless -F c > pre-upgrade.dump

# 2. Pull the new images / new code
git pull                # or: docker compose pull  (if using published tags)

# 3. Rebuild & restart — the server container migrates on start
docker compose -f docker/docker-compose.prod.yml up -d --build

# 4. Verify
curl -fsS http://localhost/health   # via nginx → server; expect status "ok"
docker compose -f docker/docker-compose.prod.yml logs server | grep -i migrat
```

Watch the server logs for `[migrate] migrations applied` before the startup banner.

## Standard upgrade (local / non-Docker)

```bash
git pull
pnpm install
pnpm db:migrate     # apply new migrations to the running Postgres
pnpm build
pnpm start          # or pnpm dev
```

## Downtime expectations

Mirthless is currently a **single-instance** deployment (no clustering yet — see the
ROADMAP). A schema migration therefore implies a short restart window:

- **Low-downtime:** most migrations are additive (new tables/columns) and complete in
  seconds. Downtime is essentially the container restart time.
- **Long migrations:** a migration that rewrites a large table (e.g. adding a NOT NULL
  column with a backfill) can hold locks. For big message tables, plan a maintenance
  window, and consider quiescing inbound connectors first (stop channels) so no new
  messages queue during the migration.
- There is **no zero-downtime rolling upgrade** today because a second instance would
  race on the same schema/migrations. Treat upgrades as stop → migrate → start.

To minimize impact: schedule during low volume, stop source connectors/channels ahead
of time if a migration is heavy, and keep the pre-upgrade dump handy.

## Rollback

**Migrations are forward-only.** There are no automated `down` migrations. To roll back
a bad upgrade:

1. Stop the new server (`docker compose ... stop server web`).
2. Restore the **pre-upgrade Postgres dump** (see
   [backup-restore.md](backup-restore.md)) into a fresh database. This is the only safe
   way to undo a schema migration — reverting just the code while leaving a newer schema
   in place is unsupported and can corrupt data.
3. Redeploy the **previous** image/code version.
4. Start the old server; it will see its own schema already migrated and boot normally.

Because rollback means a database restore, **the pre-upgrade `pg_dump` is mandatory** —
do not skip step 1 of the upgrade. Test upgrades in staging first whenever a release
includes migrations.
