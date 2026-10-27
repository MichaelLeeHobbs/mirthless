# Upgrade Procedure

GalvaniFlow applies schema changes through **Drizzle migrations**. The golden rule:

> **Always back up the database, then run migrations, before starting the new server
> version.** Never point a new binary at an un-migrated database and never point an old
> binary at a database migrated by a newer version.

## How migrations run

- **Docker (production):** the server container's entrypoint
  (`docker/server-entrypoint.sh`) runs `node packages/server/migrate.mjs` on every
  start, *before* the server boots. Migrations are **fail-loud** — if a migration
  errors, the container exits and the server never serves against a half-migrated
  schema. It then runs an idempotent seed unless `SEED_ON_START=false`. The seed creates the admin user,
  roles, permissions and default settings only; demo channels and data are seeded only when
  `SEED_DEMO_DATA=true`.
- **Local / non-Docker:** run `pnpm db:migrate` yourself before `pnpm start` /
  `pnpm dev`.

Migrations use `drizzle-orm`'s migrator reading the `.sql` files and
`meta/_journal.json` from `packages/server/src/db/migrations` (copied to
`packages/server/migrations` in the image). Applied migrations are tracked in Postgres,
so re-running is a no-op — safe and idempotent.

## ⚠️ Migration 0007 is data-destructive (pre-1.0 only)

Migration `0007_partition_message_tables.sql` **drops and recreates all six message
tables** (`messages`, `message_content`, `connector_messages`, `message_attachments`,
`message_custom_metadata`, and the stats table) to convert them to LIST-partitioned
tables. **It does not copy existing rows** — any message history present before 0007
is permanently lost when it runs.

This is intentional for the pre-1.0 phase (there is no production data to preserve yet).
If you are upgrading an install that predates 0007 and has message history you care
about, **export it first** (per-channel message export or a full `pg_dump`), because the
migration will not migrate it for you. From 1.0 onward, migrations will be data-preserving.

## Standard upgrade (Docker)

```bash
# 1. BACK UP FIRST (see docs/ops/backup-restore.md)
#    First upgrade after the rename: the container is still mirthless-db-prod and
#    the database and user are mirthless (see "Renamed from Mirthless" below).
docker exec -t galvaniflow-db-prod pg_dump -U galvaniflow -d galvaniflow -F c > pre-upgrade.dump

# 2. Pull the new code
git pull                # there are no published images; the stack builds from source

# 3. Rebuild & restart — the server container migrates on start
docker compose -f docker/docker-compose.prod.yml up -d --build

# 4. Verify
curl -fsS http://localhost/health   # via nginx → server; expect status "ok"
docker compose -f docker/docker-compose.prod.yml logs server | grep -i migrat
```

Watch the server logs for `[migrate] migrations applied` before the startup banner.

## Renamed from Mirthless

The project was renamed from Mirthless to GalvaniFlow. Upgrading an install created under
the old name has these one-time effects.

**Database name and user.** New installs default to database and user `galvaniflow`.
Postgres applies `POSTGRES_DB` / `POSTGRES_USER` only when it first creates the data
volume, so an existing volume still holds database `mirthless` owned by user
`mirthless`. Nothing in the code depends on the database name; keep using the old one:

- **Docker prod stack:** set `POSTGRES_DB=mirthless` and `POSTGRES_USER=mirthless` in the
  same place you set `POSTGRES_PASSWORD`. `docker/docker-compose.prod.yml` builds the
  server's `DATABASE_URL` from these three, so leaving them unset points the server at a
  `galvaniflow` database that does not exist in the old volume.
- **Local / non-Docker:** keep your existing `DATABASE_URL` in `.env`
  (`postgresql://mirthless:...@.../mirthless`). The dev compose (`pnpm docker:up`) keeps
  the same volume, so the old databases are still there; for `pnpm test:integration`,
  point `DATABASE_URL` at `mirthless_test`. Or start fresh with `pnpm docker:reset`,
  which deletes the dev volume and its data.
- The data volume keeps its name (`docker_postgres_data`; the compose project is named
  after the `docker/` folder), so no data moves. Only the containers are renamed:
  `mirthless-db-prod`, `mirthless-server` and `mirthless-web` become
  `galvaniflow-db-prod`, `galvaniflow-server` and `galvaniflow-web` (dev: `mirthless-db`
  becomes `galvaniflow-db`). Update any backup cron jobs or scripts that name a container.

**Other changes:**

- **CLI:** the command is `galvaniflow` (was `mirthless`). It writes its config to
  `~/.galvaniflow`; when only `~/.mirthless` exists it reads that, so a saved login keeps
  working.
- **Prometheus metrics** are renamed from `mirthless_*` to `galvaniflow_*` (for example
  `galvaniflow_messages_processed_total`). Update dashboards, alert rules and recording
  rules.
- **Web UI:** each user signs in once more after the upgrade (the browser stores the
  session under a new key).
- **Wire defaults** change from `MIRTHLESS` to `GALVANIFLOW`: the DICOM source AE title
  and destination calling AE title for new connectors, MSH-3 in generated test HL7
  messages, and the control-ID prefix of the fallback ACK sent for unparseable HL7.
  Existing channels keep the AE titles saved in them. If a trading partner checks these
  values (for example a PACS that allow-lists calling AE titles), tell them before you
  create new channels or rely on the fallback ACK.
- **File and SFTP sources:** the quarantine ledger is now `.galvaniflow-quarantine.json`.
  An existing `.mirthless-quarantine.json` in the watched directory is still read, so
  quarantined files stay quarantined.
- **Email sources:** processed emails are now marked `$GalvaniFlowDispatched`. Emails
  marked `$MirthlessDispatched` by the old version still count as dispatched.

## Standard upgrade (local / non-Docker)

```bash
git pull
pnpm install
pnpm db:migrate     # apply new migrations to the running Postgres
pnpm build
pnpm start          # or pnpm dev
```

## Downtime expectations

GalvaniFlow is currently a **single-instance** deployment (no clustering yet — see the
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
