# Deploying Mirthless

This guide covers a single-node production install with the Docker Compose stack in
`docker/docker-compose.prod.yml`. Read [TLS & PHI-in-transit](tls-and-phi.md) and
[Backup & restore](backup-restore.md) before you route real patient data through it.

## What you get

| Service | Image | Purpose |
|---|---|---|
| `db` | `postgres:17-alpine` | All configuration and message storage |
| `server` | built from `docker/Dockerfile.server` | API, engine and every connector listener |
| `web` | built from `docker/Dockerfile.web` | nginx serving the admin UI on :80 and proxying `/api` to the server |

There are no published images yet. The stack builds from the checked-out source, so the
version you run is the commit you have checked out. Tag or pin that commit.

## First install

1. Copy `.env.production.example` to `.env` at the repository root and fill in every
   `CHANGE_ME`:
   - `POSTGRES_PASSWORD`: required; compose refuses to start without it.
   - `JWT_SECRET`: at least 32 random characters (`openssl rand -base64 48`).
   - `CONTENT_ENCRYPTION_KEY`: 64 hex characters (`openssl rand -hex 32`). Set it
     before you create anything. Data source passwords are stored encrypted with it,
     and channels with **Encrypt stored data** refuse to deploy without it. Keep it with
     your backups: losing it makes that data unreadable.
   - `FRONTEND_URL`: the URL users open, for CORS.
   - `TRUST_PROXY`: the number of proxies in front of the app (1 for the bundled nginx).
2. Build and start:

   ```bash
   docker compose -f docker/docker-compose.prod.yml up -d --build
   ```

   The server container runs migrations, then an idempotent seed, then starts. A failed
   migration stops the container rather than serving a half-migrated schema.
3. Sign in at `FRONTEND_URL` as `admin` / `Admin123!`. You must choose a new password
   before anything else works. Do this immediately: until you do, the admin account is
   on a published default password.

The seed creates the admin user, roles, permissions and default settings only. Example
channels and demo data are added only with `SEED_DEMO_DATA=true`; leave it off for
anything that will carry real data.

## Listener ports

Source connectors (TCP/MLLP, DICOM, HTTP sources) open their own ports inside the
`server` container. Sending systems can only reach the ports you publish.

- Publish one contiguous range with `MLLP_PORT_RANGE` in `.env` (default `6661-6670`),
  and give each inbound channel a port inside it.
- The API and UI do not need extra ports; they go through nginx on :80.
- Put TLS in front of the published listener ports (a TLS-terminating load balancer or
  the connector's own TLS settings), per [TLS & PHI-in-transit](tls-and-phi.md).
- Outbound connectors need no published ports, but your firewall must allow the server
  to reach its destinations.

## Operating it

- Upgrades: [Upgrade procedure](upgrade.md). Always back up first.
- Health, metrics and logs: [Resource sizing & observability](resource-and-observability.md).
- Capacity: [Soak test](soak-test.md) baseline (memory, latency, database growth at 100 msg/s).
- Backups: [Backup & restore](backup-restore.md).
- Before carrying PHI: work through the operator checklist in
  [HIPAA / security checklist](hipaa-security-checklist.md) and set up TLS per
  [TLS & PHI in transit](tls-and-phi.md).
- Silent interfaces: add an alert with the trigger **A started channel receives no messages**
  for each inbound interface, set to a window longer than its normal quiet periods. A feed that
  stops sending is otherwise invisible until someone notices missing results.

## Known limitations in this release

- **Single node.** Run one `server` container. There is no clustering or HA failover; two
  servers against one database will both run every deployed channel.
- **PostgreSQL only**, by design, for Mirthless's own storage. The Database connector can
  still talk to other databases.
- **DICOM is beta.** It has no TLS support yet.
- **Not built yet:** extracting attachments from inbound messages, custom metadata columns, multi-threaded
  destination queues, and FTP/SMB/S3/WebDAV file transports. The UI no longer offers them.
- **Batch files** are ingested as one message. A file with several MSH segments is not
  split.
- Migration 0007 drops message history on upgrade from installs that predate it; see
  [Upgrade procedure](upgrade.md).
