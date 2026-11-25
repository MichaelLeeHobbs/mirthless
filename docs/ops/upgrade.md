# Upgrade Procedure

GalvaniGraph applies schema changes through **Drizzle migrations**. The golden rule:

> **Always back up the database, then run migrations, before starting the new server
> version.** Never point a new binary at an un-migrated database and never point an old
> binary at a database migrated by a newer version.

## How migrations run

- **Docker (production):** the server container's entrypoint
  (`docker/server-entrypoint.sh`) runs `node packages/server/migrate.mjs` on every
  start, *before* the server boots. It migrates as the table owner (`MIGRATION_DATABASE_URL`), then grants the server's own role (`DATABASE_URL`) and checks it; see [Database roles](#database-roles). Migrations are **fail-loud** — if a migration
  or the role step errors, the container exits and the server never serves against a half-migrated
  schema or as the wrong role. It then runs an idempotent seed unless `SEED_ON_START=false`. The seed creates the admin user,
  roles, permissions and default settings only; demo channels and data are seeded only when
  `SEED_DEMO_DATA=true`.
- **Roles:** a user's permissions come from their role in code at every request, so an upgrade that changes a role applies to existing users at once. Check the matrix in [Access control](../user/access-control.md#role-and-permission-matrix) after upgrading.
- **Local / non-Docker:** run `pnpm db:migrate` yourself before `pnpm start` /
  `pnpm dev`.

Migrations use `drizzle-orm`'s migrator reading the `.sql` files and
`meta/_journal.json` from `packages/server/src/db/migrations` (copied to
`packages/server/migrations` in the image). Applied migrations are tracked in Postgres,
so re-running is a no-op — safe and idempotent.

## Database roles

The Docker stack uses two Postgres roles (D-307):

- **Owner** (`POSTGRES_USER`, default `galvanigraph`): the superuser the Postgres image creates. It owns every table and runs only the migration step at container start.
- **Server** (`POSTGRES_APP_USER`, default `galvanigraph_app`, password `POSTGRES_APP_PASSWORD`): the role the server connects as. It owns no application table, so it cannot alter, empty, drop or disable triggers on any of them, and a leaked connection string or an injected statement cannot either. The one thing it owns is the job queue's `pgboss` schema (below).

On every start the migration step, as the owner, creates the server role if it is missing, sets its password from `POSTGRES_APP_PASSWORD`, and grants it exactly this (`packages/server/src/db/runtime-role.ts`):

| Grant | Why |
|---|---|
| `CONNECT` on the database, `USAGE` on schema `public` | To log in and see the tables |
| `SELECT, INSERT, UPDATE, DELETE` on every table in `public` | Channels, users, settings, messages and the rest; `DELETE` is for the data pruner, deleting messages, sessions, map entries and the like |
| Only `SELECT, INSERT` on `events` | The audit trail is appended and read, never rewritten or deleted row by row |
| `EXECUTE` on `purge_events(integer)` | **Purge Old Events** on the Events page. This owner function (migration 0016) deletes only events at least one day old, the minimum the API allows, so a stolen connection cannot erase recent events |
| `USAGE` on every sequence in `public` | `nextval()` for the serial ids |
| `EXECUTE` on `create_channel_partitions(uuid)` | Only a table's owner may add a partition to it. This owner function (migration 0016) creates the six message partitions of a channel that exists, and nothing else |
| Default privileges for tables and sequences the owner creates later | The partitions that function creates, and the next migration's tables, get the same grants at once |
| Ownership of schema `pgboss` and everything in it | The job queue (pg-boss, which runs the scheduled data pruner) creates, migrates and maintains its own tables while the server runs. Migration 0016 creates the schema, so the role needs no `CREATE` on the database. The schema holds no PHI, and owning it gives no rights outside it. On an install whose server ran as the owner, the step hands over the tables pg-boss made, jobs included |

Nothing grants `TRUNCATE`, `REFERENCES`, `TRIGGER` or `CREATE` on `public`. The step revokes table and sequence grants before granting, so the list above is the whole of what the role holds on them, and revokes `EXECUTE` on the two owner functions from `PUBLIC` again in case a restore dropped that. It sets the password as a SCRAM-SHA-256 verifier computed in the container, so the password itself never reaches Postgres or its logs.

The container stops instead of starting when the server role is the owner (`POSTGRES_APP_USER` set to the owner's name), has superuser, CREATEROLE, CREATEDB, REPLICATION or BYPASSRLS, or is a member of any role (a member can `SET ROLE` to it even without inheriting its rights, for example to the owner, a superuser role or `pg_read_server_files`), and when `POSTGRES_APP_PASSWORD` equals `POSTGRES_PASSWORD`. After granting, it connects as the server role and checks the same again. Change `POSTGRES_APP_PASSWORD` and restart to rotate the password.

### Upgrading an install from before the split

An install created before this change runs the server as the superuser. After `git pull`, `docker compose up` stops with `required variable POSTGRES_APP_PASSWORD is missing a value` and changes nothing until you set it:

1. Back up, as for any upgrade.
2. Add a new password to `.env`, next to `POSTGRES_PASSWORD`, letters and digits only: `POSTGRES_APP_PASSWORD=<openssl rand -hex 24>`. Remove any `DATABASE_URL=` line from `.env`; the compose file builds it.
3. `docker compose -f docker/docker-compose.prod.yml up -d --build`.
4. Check the server log for `[migrate] the server runs as "galvanigraph_app", which owns no application tables`, and that the server's connections use that role:

   ```bash
   docker exec galvanigraph-db-prod psql -U galvanigraph -d galvanigraph \
     -c "SELECT DISTINCT usename FROM pg_stat_activity WHERE datname = current_database() AND backend_type = 'client backend' AND pid <> pg_backend_pid();"
   ```

The application tables, and the partitions the old server created, stay owned by the owner; only the `pgboss` schema changes owner, and nothing is moved or rewritten. To go back to the previous version, check out its compose file: it connects as the owner again, and the unused role does no harm.

**The empty test database.** The production compose used to mount `docker/init-db`, so every production volume also got an empty `galvaniflow_test` database (`mirthless_test` on older volumes), meant only for the dev stack's tests. It no longer does. Nothing uses that database in production; once you have checked it is empty, you may drop it yourself (for example `DROP DATABASE galvaniflow_test;` as the owner). The upgrade leaves it alone.

**Running the image another way** (your own compose file, Kubernetes): set `MIGRATION_DATABASE_URL` to the owner's connection string and `DATABASE_URL` to the server role's. The container refuses to start without `MIGRATION_DATABASE_URL`, or when `DATABASE_URL` connects as a superuser or the owner.

**Local / non-Docker:** `pnpm dev` and `pnpm db:migrate` still use one `DATABASE_URL`, the dev superuser. A non-Docker production install should create a separate login role and grant it the table above as the table owner; `runtime-role.ts` holds the exact statements.

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

## A restart redeploys what was deployed (#225)

From migration 0026 the server records what each deploy deployed: the channel, the code templates compiled into it and the global scripts. A restart redeploys that record, so configuration saved but not deployed no longer goes live when the server restarts (D-328).

An install upgrading to it has no records yet. On the first start after the upgrade, each channel that was enabled when the migration ran has its saved configuration deployed and recorded, once, so it comes back as it did before. Each one is logged and recorded as a `CHANNEL_DEPLOYMENT_ADOPTED` WARN event. That start still runs whatever was saved, so **before upgrading, deploy or revert every channel, code template and global script with saved changes you have not deployed**.

After that start:

- A channel comes back as it was last deployed. A code template or global script change reaches a channel only when the channel is deployed again.
- A channel you undeploy stays undeployed after a restart. So does one whose script hung the server, until it is deployed again ([operations](resource-and-observability.md#a-script-that-hangs-the-server)).
- An enabled channel that has never been deployed is not deployed at startup; the log and a `CHANNEL_NOT_REDEPLOYED` event name it. This includes channels restored from a backup onto a new server: deploy them after the restore.
- Enabling or disabling a channel needs `channels:deploy`.

## HTTP sources refuse bodies they used to store damaged (#335)

An HTTP source used to decode every request body without checking it, so text in another charset, a compressed body or a binary one was stored with its bytes replaced by U+FFFD and answered with the success status. It now keeps a body whole or refuses it (D-334):

- A body that is not valid UTF-8 and whose Content-Type declares no charset gets 415 and is not stored. A sender of ISO-8859-1 or Windows-1252 text must declare it (`Content-Type: text/plain; charset=ISO-8859-1`), or the source's Body Charset (`bodyCharset`) must be set to `latin1` or `windows-1252` and the channel deployed again. A body that is not valid in the charset it declares gets 415 as well.
- A binary body (a PDF, an image, a form with a file in it) is not valid UTF-8, so it gets 415. To keep it, set `bodyCharset` to `base64`; every message of that channel is then base64 text, so its scripts and destinations must expect that.
- A body with `Content-Encoding` `gzip`, `deflate` or `br` is decompressed, and `maxBodyBytes` also limits its decompressed size. Any other coding gets 415, a `Transfer-Encoding` other than `chunked` gets 501, and a body that does not decompress gets 400.
- Text that holds U+0000 is taken, as before. PostgreSQL cannot store it in plain, so a channel that stores its content without encryption still answers `errorStatusCode` to it; a binary body needs `base64`, not `latin1` or `windows-1252`.

A channel whose stored messages contain U+FFFD likely has such a sender. A refused sender gets the reason in the response, and the server logs a warning that starts `Refused a request body` with its address and Content-Type. A `charset` saved by an older editor is still ignored.

**Going back** to a version before this one: it refuses to deploy a channel that has `bodyCharset`, and the editor writes `bodyCharset` into every HTTP source created after the upgrade, `utf-8` included. The editor cannot remove a property, so before going back remove `bodyCharset` from those channels' `sourceConnectorProperties` through the API (`PUT /api/v1/channels/:id`) and deploy them, since a restart deploys what was last deployed. This lists them:

```sql
SELECT id, name, source_connector_properties->>'bodyCharset' AS body_charset
FROM channels WHERE source_connector_type = 'HTTP' AND source_connector_properties ? 'bodyCharset';
```

## Stricter connector properties (#115)

Connector properties moved, one connector type at a time, to a schema in `packages/core-models` that refuses keys it does not list and values of the wrong type. A channel that deployed before can then fail its deploy, including the auto-deploy at server start, with `Invalid source connector properties for <TYPE>: ...` or `Invalid destination connector properties for <TYPE>: ...`. The message names the key. Nothing in the database is changed; edit the channel's properties and deploy again. `docs/user/connector-reference.md` lists the keys each type accepts.

**TCP_MLLP** is the first. Channels saved by this app's own editor keep deploying. From 2026-02 to 2026-07 the TCP/MLLP forms saved `receiveTimeout`, `bufferSize`, `keepConnectionOpen`, `transmissionMode` and `sendTimeout`, which no connector reads; the schema drops those five keys. It also reads a charset name in any case and maps the names that editor saved: `UTF-8` and `utf8` become `utf-8`, `ISO-8859-1` becomes `latin1`, `US-ASCII` becomes `ascii`, and `UTF-16LE` becomes `utf16le`. Nothing in the database is rewritten. A channel saved with `ISO-8859-1` or `US-ASCII` used to deploy and then fail on its first message, because Node has no encoding by those names; it now works.

A TCP_MLLP channel now fails to deploy when it has:

- any other key its table doesn't list, e.g. a misspelling such as `maxConnection` or a key left over from another connector type. Before, such a key was ignored.
- a `charset` that is none of the above, e.g. `windows-1252`.
- a number that is not a whole number, written as a number or as digits (e.g. `maxConnections: "ten"`), or a timeout or size below 1. Before, a value that wasn't a number was replaced by the default without a word, and a `responseTimeout` of 0 made every send time out at once.
- a `tls` that is not an object, `false` or `null`, a PEM field that is not text, or a key inside `tls` that `docs/ops/tls-and-phi.md` doesn't list.

Before upgrading, you can list the keys the schema would refuse with this `psql` query. It checks key names only, not values:

```sql
SELECT id, name, k AS unknown_key FROM channels, jsonb_object_keys(source_connector_properties) k
WHERE source_connector_type = 'TCP_MLLP'
  AND k NOT IN ('host','port','maxConnections','responseMode','charset','maxFrameBytes','frameStart','frameEnd','tls','processBatch',
                'receiveTimeout','bufferSize','keepConnectionOpen','transmissionMode','sendTimeout');
SELECT channel_id, name, k AS unknown_key FROM channel_connectors, jsonb_object_keys(properties) k
WHERE connector_type = 'TCP_MLLP'
  AND k NOT IN ('host','port','maxConnections','responseTimeout','acquireTimeoutMs','charset','frameStart','frameEnd','tls','template',
                'receiveTimeout','bufferSize','keepConnectionOpen','transmissionMode','sendTimeout');
```

**HTTP** is the second. Channels saved by this app's own editor keep deploying. The old HTTP forms saved keys no connector reads: `contextPath`, `methods` and `charset` on the source (2026-02 to 2026-07), `charset` on the destination (2026-03 to 2026-07). The schema drops them, so the source still serves `/` and `POST` as before. On 2026-07-14 the destination form saved empty inline-PEM fields (`ca`, `cert`, `key`) inside `tls`; empty ones are dropped too. A method is read in any case (`put` is `PUT`). Nothing in the database is rewritten.

One behaviour changes without a deploy error. The 2026-03 to 2026-07 destination form saved `headers` as text. The editor has shown that text as `Name: value` lines since then, but the connector sent one junk header per character (`0`, `1`, ...). The text is now read the way the editor shows it, so those headers are sent as written. Empty header text sends none, as before.

An HTTP channel now fails to deploy when it has:

- any other key its table doesn't list, e.g. a misspelling such as `responseStatus`. Before, such a key was ignored.
- a source `path` that doesn't start with `/`. Before, it deployed and answered 404 to every request.
- a `method` other than GET, POST, PUT, PATCH or DELETE.
- a `responseStatusCode` or `errorStatusCode` outside 100 to 599, a `maxBodyBytes` below 1, or a destination `responseTimeout` below 1. Before, a value that wasn't a number was replaced by the default without a word, and a `responseTimeout` of 0 failed every send at once (the editor wrongly said 0 meant no timeout).
- an `auth` whose `type` is not `BASIC` or `TOKEN`, header, `parameters` or `basicAuth` values that are not text, or a `scheme` other than `HTTP` or `HTTPS`.
- an `auth` guard missing a credential: `BASIC` without a non-empty `username` and `password`, or `TOKEN` without a non-empty `token`. Before, a `BASIC` guard with no username or password accepted a request with empty ones, so the channel was open to anyone who could reach the port (#207). Set the credentials, or remove `auth` if the channel was meant to be open.
- a `tls` that is not an object, `false` or `null`, or a key inside it the table doesn't list. That includes a destination `tls` with inline PEM pasted into `ca`, `cert` or `key`; pick the certificates from the store instead (`tls.caCertId`, `tls.clientCertId`).

Before upgrading, list the keys the schema would refuse:

```sql
SELECT id, name, k AS unknown_key FROM channels, jsonb_object_keys(source_connector_properties) k
WHERE source_connector_type = 'HTTP'
  AND k NOT IN ('host','port','path','matchSubpaths','method','responseContentType','responseStatusCode','errorStatusCode',
                'maxBodyBytes','bodyCharset','auth','scheme','tls','processBatch','contextPath','methods','charset');
SELECT channel_id, name, k AS unknown_key FROM channel_connectors, jsonb_object_keys(properties) k
WHERE connector_type = 'HTTP'
  AND k NOT IN ('url','method','headers','parameters','basicAuth','contentType','responseTimeout','scheme','tls','template','charset');
```

**DATABASE** is the third. Channels saved by this app's own editor keep deploying: the Database Reader and Writer forms have saved the same keys since 2026-03, plus `tls` since 2026-11, so there is nothing to drop or map. Nothing in the database is rewritten.

Two things now deploy that didn't. `port` is no longer required: with none set, the connector uses the vendor's port (5432 for PostgreSQL, 3306 for MySQL), as the registry always did. A Database Reader imported from Mirth with no port in its JDBC URL used to fail its deploy with `port: expected number`; it now deploys. A port written as digits (`"5432"`, e.g. a resolved configuration reference) is also accepted.

A DATABASE channel now fails to deploy when it has:

- any other key its table doesn't list, e.g. a misspelling such as `pollingInterval`. Before, such a key was ignored. Channels imported from Mirth between 2026-03-03 and 2026-11-12 carry `url` and `driver` (and a reader's SELECT under `query`). They deployed once someone filled in the host, database and query in the editor, which cannot remove keys, so the schema drops `url`, `driver` and a reader's `query` (#227). Those channels keep deploying with the edits made to them; nothing in the database is rewritten. A reader nobody gave a `selectQuery` never deployed and still refuses, naming `selectQuery`: its old `query` is not used, because starting it would run a SELECT nobody sees, with no update query, reading the same rows again every poll.
- a `vendor` other than `postgresql` or `mysql`. That refused before too, with the same message.
- an empty or blank `host`, `database`, `selectQuery` or `query`, or a `port` outside 1 to 65535.
- an `updateMode` other than `NEVER`, `ALWAYS` or `ON_SUCCESS`, or `ALWAYS`/`ON_SUCCESS` with an empty `updateQuery`. Before, an unknown mode marked every row as `ALWAYS` does; the empty query failed when the connector deployed, without naming the key.
- a `pollingIntervalMs` that is not a whole number from 100 to 2147483647. Before, a value that wasn't a number became 5000 without a word.
- a `tls`, `useTransaction` or `returnGeneratedKeys` that is not `true` or `false`, or a `username` or `password` that is not text. Before, a `tls` of `"true"` connected in plaintext.
- a `rowFormat` other than `JSON`.

Before upgrading, list the keys the schema would refuse:

```sql
SELECT id, name, k AS unknown_key FROM channels, jsonb_object_keys(source_connector_properties) k
WHERE source_connector_type = 'DATABASE'
  AND k NOT IN ('vendor','host','port','database','username','password','tls',
                'selectQuery','updateQuery','updateMode','pollingIntervalMs','rowFormat','processBatch',
                'url','driver','query');
SELECT channel_id, name, k AS unknown_key FROM channel_connectors, jsonb_object_keys(properties) k
WHERE connector_type = 'DATABASE'
  AND k NOT IN ('vendor','host','port','database','username','password','tls',
                'query','useTransaction','returnGeneratedKeys','template','url','driver');
```

**FILE** is the fourth. Channels saved by this app's own editor keep deploying: the File Reader and Writer forms have saved the same keys since 2026-03, so nothing is dropped. The charset is read as for TCP_MLLP: any case, and `UTF-8`, `utf8`, `ISO-8859-1`, `US-ASCII` and `UTF-16LE` become `utf-8`, `latin1`, `ascii` and `utf16le`. The FILE defaults saved `UTF-8` until this release, and the 2026-03 to 2026-07 forms offered `ISO-8859-1` and `US-ASCII`. Nothing in the database is rewritten.

A FILE channel now fails to deploy when it has:

- any other key its table doesn't list, e.g. `filePattern` or `fileNameTemplate` (the SFTP connector's names). Before, such a key was ignored.
- a `charset` that is none of the above, even with `binary` on. Before, a binary channel ignored its charset. The other names the connector used to read (`iso8859-1`, `latin-1`, `ucs2`, `ucs-2`, `binary`, `base64`, `hex`) now refuse too; the editor never offered them.
- a `sortBy` other than `NAME`, `DATE` or `SIZE`, or a `postAction` other than `DELETE`, `MOVE` or `NONE`. Before, an unknown sort read files by name, and an unknown post action left each file in place, so the next poll read it again.
- a `pollingIntervalMs` that is not a whole number from 100 to 2147483647, or a `fileAgeMs` that is not a whole number of at least 0. Before, a value that wasn't a number was replaced by the default without a word.
- a `binary`, `checkFileAge`, `tempFileEnabled` or `appendMode` that is not `true` or `false`. Before, any text, `"false"` included, turned the setting on.
- an empty `directory`, `fileFilter` or `outputPattern`. These failed before as well, when the connector deployed, without naming the key. A `directory`, `fileFilter` or `outputPattern` of only spaces now fails too.
- `postAction` `MOVE` with an empty `moveToDirectory`. This failed before as well, without naming the key.
- an `ignoreDot` that is not `true` or `false` (#244). The SFTP source refuses one too.

Three things change without a deploy error, for the FILE source and the SFTP source alike, so that both pick the files a Mirth File Reader picks (#244, D-304). Each makes a source read fewer files, never more, and a file it no longer reads stays in its folder.

- The filter is case-sensitive on every platform, Windows included: `*.hl7` no longer picks up `A.HL7`. Before, matching ignored case. If a channel needs both, write the filter in the case the files arrive in, or run a second channel with the other case's pattern.
- Names starting with `.` are skipped. A channel saved before this release has no `ignoreDot`, and a missing `ignoreDot` means `true`. Turn `ignoreDot` off on a channel that must read dotfiles.
- The FILE source never reads a name ending in `.ignore`, and holds back `<name>` while `<name>.ignore` exists next to it. Remove the `.ignore` file to release it; the next poll reads it.

Before upgrading, list the keys the schema would refuse:

```sql
SELECT id, name, k AS unknown_key FROM channels, jsonb_object_keys(source_connector_properties) k
WHERE source_connector_type = 'FILE'
  AND k NOT IN ('directory','fileFilter','pollingIntervalMs','sortBy','charset','binary','checkFileAge','fileAgeMs',
                'postAction','moveToDirectory','processBatch','ignoreDot');
SELECT channel_id, name, k AS unknown_key FROM channel_connectors, jsonb_object_keys(properties) k
WHERE connector_type = 'FILE'
  AND k NOT IN ('directory','outputPattern','charset','binary','tempFileEnabled','appendMode','template');
```

**JAVASCRIPT** is the fifth. Channels saved by this app's own editor keep deploying: the JavaScript Reader and Writer forms have saved `script` (and the reader `pollingIntervalMs`) since 2026-03, plus `scriptLanguage` since 2026-11-15. Until 2026-11-13 the Mirth importer copied all of a JavaScript Reader's or Writer's Mirth properties into the channel: `pluginProperties`, `pollConnectorProperties` and `sourceConnectorProperties` on a reader, `pluginProperties` and `destinationConnectorProperties` on a writer, or `responseConnectorProperties` and `queueConnectorProperties` from a Mirth 3.0 export. Nothing read them, and the schema drops them, so those channels keep deploying and still poll every 5000 ms. Import such a channel again to get Mirth's polling interval and Process Batch setting, which the importer now maps. Nothing in the database is rewritten.

The importer brings in a connector it has no mapping for as JAVASCRIPT with a warning, and since 2026-11-15 also a connector used in a direction it cannot run in (e.g. SMTP as a source, EMAIL as a destination). Such a stand-in has no `script`, so it never deployed, and still doesn't. An unmapped connector imported before 2026-11-13 also carries the other connector's Mirth properties, which are now refused as well; replace the connector in the editor.

A JAVASCRIPT channel now fails to deploy when it has:

- any other key its table doesn't list, e.g. a misspelling such as `pollingInterval`, or `pollingIntervalMs` on a destination. Before, such a key was ignored.
- a `scriptLanguage` other than `JAVASCRIPT` or `TYPESCRIPT`, e.g. `typescript`. Before, any other value was read as JavaScript, so a TypeScript script written through the API with a misspelled language skipped its deploy type check.
- a `script` of only spaces or line breaks. Before, it deployed and did nothing. An empty `script` failed before as well.
- a `pollingIntervalMs` that is not a whole number from 100 to 2147483647. Below 100 failed before as well, when the connector deployed, without naming the key; a value that wasn't a number became 5000 without a word.
- a `processBatch` that is not `true` or `false`, or a `template` that is not text.

Before upgrading, list the keys the schema would refuse:

```sql
SELECT id, name, k AS unknown_key FROM channels, jsonb_object_keys(source_connector_properties) k
WHERE source_connector_type = 'JAVASCRIPT'
  AND k NOT IN ('script','scriptLanguage','pollingIntervalMs','processBatch',
                'pluginProperties','pollConnectorProperties','sourceConnectorProperties','responseConnectorProperties');
SELECT channel_id, name, k AS unknown_key FROM channel_connectors, jsonb_object_keys(properties) k
WHERE connector_type = 'JAVASCRIPT'
  AND k NOT IN ('script','scriptLanguage','template','pluginProperties','destinationConnectorProperties','queueConnectorProperties');
```

**CHANNEL** is the sixth. Channels saved by this app's own editor keep deploying: the Channel Reader and Writer forms have saved the same keys since 2026-03. From 2026-03-03 to 2026-11-12 the Mirth importer copied all of a Channel Reader's or Writer's Mirth properties: `pluginProperties` and `sourceConnectorProperties` on a reader; `pluginProperties`, `destinationConnectorProperties`, `channelId`, `channelTemplate` and `mapVariables` on a writer (`responseConnectorProperties` and `queueConnectorProperties` from a Mirth 3.0 export). Nothing read them, and the schema drops them. The reader's `channelId` is still set at deploy to the channel's own id. Nothing in the database is rewritten.

A CHANNEL channel now fails to deploy when it has:

- any other key its table doesn't list, e.g. `waitForReply`. Before, such a key was ignored.
- a `waitForResponse` that is not `true` or `false`. Before, any text, `"false"` included, made the writer wait for the target's response.
- a `targetChannelId` of only spaces. An empty one failed before as well.

```sql
SELECT id, name, k AS unknown_key FROM channels, jsonb_object_keys(source_connector_properties) k
WHERE source_connector_type = 'CHANNEL'
  AND k NOT IN ('channelId','processBatch','pluginProperties','sourceConnectorProperties','responseConnectorProperties');
SELECT channel_id, name, k AS unknown_key FROM channel_connectors, jsonb_object_keys(properties) k
WHERE connector_type = 'CHANNEL'
  AND k NOT IN ('targetChannelId','waitForResponse','template','pluginProperties','destinationConnectorProperties',
                'queueConnectorProperties','channelId','channelTemplate','mapVariables');
```

**FHIR** is the seventh. Channels saved by this app's own editor keep deploying: the FHIR form has saved the same keys since 2026-03. The importer never creates a FHIR destination. Nothing in the database is rewritten.

One behaviour changes without a deploy error. From 2026-03-01 to 2026-07-12 the form saved `headers` as text, one `Name: value` per line. The connector sent one junk header per character (`0`, `1`, ...) instead of those headers. The text is now read the way the editor shows it, so those headers are sent as written, as HTTP's have been since its slice.

A FHIR channel now fails to deploy when it has:

- any other key its table doesn't list. Before, such a key was ignored.
- an `authType` other than `NONE`, `BASIC`, `BEARER` or `API_KEY`. Before, an unknown type sent every request with no credentials.
- an auth type without its credentials (`BASIC` without `authUsername` and `authPassword`, `BEARER` without `authToken`, `API_KEY` without `authHeaderName` and `authApiKey`), or a `baseUrl` that is not an absolute URL. These failed before as well, when the connector deployed, without naming the key. A credential of only spaces now fails too; before, it was sent.
- a `method` other than `POST` or `PUT`, or a `format` other than `json` or `xml`. Before, any other format was sent as XML.
- a `timeout` that is not a whole number from 1 to 2147483647. Before, 0 failed every send at once, and a value that wasn't a number became 30000 without a word.
- `headers` whose values are not text, or a credential that is not text.

```sql
SELECT channel_id, name, k AS unknown_key FROM channel_connectors, jsonb_object_keys(properties) k
WHERE connector_type = 'FHIR'
  AND k NOT IN ('baseUrl','resourceType','method','authType','authUsername','authPassword','authToken','authHeaderName',
                'authApiKey','format','timeout','headers','template');
```

**SMTP** is the eighth. Channels saved by this app's own editor keep deploying: the SMTP form has saved the same keys since 2026-03, plus `requireTLS` and `attachments` since 2026-07-15, and the importer writes only keys the connector reads. Nothing in the database is rewritten.

Two things now deploy that didn't: `port` written as digits, e.g. a `${smtpPort}` configuration reference, which resolves to text, and no `port` at all, which now means 587. Before, deploy refused both with `port: expected number` or a missing `port`.

An SMTP channel now fails to deploy when it has:

- any other key its table doesn't list, e.g. `user` or `password` (the names are `authUser` and `authPass`). Before, such a key was ignored; with `user`, the mail went out with no login.
- an attachment that is not an object with text `filename` and `content` and optional text `mimeType`, or one with another key. Before, such an entry was skipped without a word.
- a `secure`, `requireTLS` or `attachContent` that is not `true` or `false`. Before, any text, `"false"` included, turned the setting on.
- a `contentType` other than `text/plain` or `text/html`, or a `port` outside 1 to 65535.
- an empty or blank `host`, `from` or `to`. An empty one failed before as well, when the connector deployed, without naming the key; one of only spaces now fails too. `from` is now marked required in the reference.

```sql
SELECT channel_id, name, k AS unknown_key FROM channel_connectors, jsonb_object_keys(properties) k
WHERE connector_type = 'SMTP'
  AND k NOT IN ('host','port','secure','requireTLS','authUser','authPass','from','to','cc','bcc','subject','bodyTemplate',
                'contentType','attachContent','attachments','template');
```

**DICOM** is the ninth. Channels saved by this app's own editor keep deploying: the DICOM forms have saved the same keys since 2026-03. Until it mapped DICOM on 2026-11-16 (#171), the Mirth importer copied all of a DICOM Listener's or Sender's Mirth properties (`applicationEntity`, `localHost`, `dest`, `tls`, `keyStorePW`, `stgcmt` and some 30 more, listed in `packages/core-models/src/schemas/dicom-connector.schema.ts`). Nothing reads them, and the schema drops them, so an imported Sender (whose `host` and `port` have the same names here) keeps deploying, and so does a Listener once its port and storage directory were filled in. Nothing in the database is rewritten. A channel imported since then has the DICOM keys themselves (D-301).

One behaviour changes without a deploy error. An imported DICOM Sender also carries Mirth's default template, `${DICOMMESSAGE}`. Since 2026-11-12 the engine has sent a destination's template instead of the message, so every send from such a channel failed: the text `${DICOMMESSAGE}` is not a DICOM file. The engine and the schema now treat that one template as no template (`destinationTemplate` in core-models), so the message itself is sent, as in Mirth. Mirth's `applicationEntity` is still not mapped to `calledAETitle`; set the called AE title by hand ([#171](https://github.com/MichaelLeeHobbs/mirthless/issues/171)).

A DICOM channel now fails to deploy when it has:

- any other key its table doesn't list. Before, such a key was ignored.
- an imported Mirth `tls` setting other than `notls` (`aes`, `3des` or `without`). This connector has no TLS, so before, such a channel connected in plaintext without a word. Remove `tls` only if plaintext is acceptable on that network.
- a `dispatchMode` other than `PER_FILE` or `PER_ASSOCIATION`, a `postAction` other than `DELETE`, `MOVE` or `NONE`, or a destination `mode` other than `single` or `multiple`.
- a number that is not a whole number (digits as text are read), a negative timeout, retry count, delay or `maxAssociations`, or a timeout above 2147483647. Before, a value that wasn't a number became the default without a word, and number text with a sign or a dot (`+5`, `30000.`) was read as a number.
- a `storageDir` or `host` of only spaces. An empty one, a port outside 1 to 65535, an AE title longer than 16 characters, a `minPoolSize` below 1, a `maxPoolSize` below `minPoolSize`, and `MOVE` without `moveToDirectory` failed before as well, when the connector deployed, without naming the key.

```sql
SELECT id, name, k AS unknown_key FROM channels, jsonb_object_keys(source_connector_properties) k
WHERE source_connector_type = 'DICOM'
  AND k NOT IN ('port','storageDir','aeTitle','minPoolSize','maxPoolSize','connectionTimeoutMs','dispatchMode','postAction',
                'moveToDirectory','processBatch');
SELECT channel_id, name, k AS unknown_key FROM channel_connectors, jsonb_object_keys(properties) k
WHERE connector_type = 'DICOM'
  AND k NOT IN ('host','port','calledAETitle','callingAETitle','mode','maxAssociations','maxRetries','retryDelayMs','timeoutMs','template');
```

These queries also list the Mirth keys the schema drops; compare what they print with the list in `dicom-connector.schema.ts`.

**EMAIL** is the tenth. Channels saved by this app's own editor keep deploying: the Email form has saved the same keys since 2026-03, and the importer never creates an EMAIL source. Nothing in the database is rewritten. `port` no longer needs to be set (993 by default), and digits as text are read.

An EMAIL channel now fails to deploy when it has:

- any other key its table doesn't list. Before, such a key was ignored.
- a `secure` that is not `true` or `false`. Before, any text, `"false"` included, turned it on.
- a `postAction` other than `DELETE`, `MARK_READ` or `MOVE`, or a `pollingIntervalMs` above 2147483647.
- a `host`, `username`, `password` or `folder` of only spaces. An empty one, `POP3`, a polling interval below 1000 ms, and `MOVE` without `moveToFolder` failed before as well, when the connector deployed, without naming the key.

```sql
SELECT id, name, k AS unknown_key FROM channels, jsonb_object_keys(source_connector_properties) k
WHERE source_connector_type = 'EMAIL'
  AND k NOT IN ('host','port','secure','username','password','protocol','folder','pollingIntervalMs','postAction','moveToFolder',
                'subjectFilter','includeAttachments','processBatch');
```

**SFTP** is the eleventh. Channels saved by this app's own editor keep deploying: the SFTP forms have saved the same keys since 2026-07 (`charset` since 2026-11-11), and the importer writes only keys the connector reads. Nothing in the database is rewritten. The charset is read as for FILE: `utf-8`, `latin1`, `ascii` or `utf16le` in any case, with `UTF-8`, `utf8`, `ISO-8859-1`, `US-ASCII` and `UTF-16LE` mapped onto them.

An SFTP channel now fails to deploy when it has:

- any other key its table doesn't list, e.g. `fileFilter` or `outputPattern` (the FILE connector's names). Before, such a key was ignored.
- a `charset` that is none of the above. The other names the connector used to read (an empty charset, `iso8859-1`, `latin-1`, `ucs2`, `ucs-2`, `base64`, `hex`, `binary`) now refuse too; the editor never offered them.
- an `appendMode` that is not `true` or `false`. Before, any text, `"false"` included, turned it on. A `strictHostKey` that is not `true` or `false` failed before as well.
- a `pollingIntervalMs` or `minFileAgeMs` that is not a whole number, a negative `minFileAgeMs`, or a polling interval above 2147483647. Before, a value that wasn't a number became the default without a word, and number text with a sign or a dot was read as a number.
- a `host`, `username`, `remoteDirectory`, `filePattern`, `fileNameTemplate` or `moveToDirectory` of only spaces. An empty one, no password or private key, host key checking with no host key, and `MOVE` without a directory failed before as well.

```sql
SELECT id, name, k AS unknown_key FROM channels, jsonb_object_keys(source_connector_properties) k
WHERE source_connector_type = 'SFTP'
  AND k NOT IN ('host','port','username','password','privateKey','passphrase','remoteDirectory','strictHostKey','hostKey',
                'filePattern','pollingIntervalMs','afterProcessing','moveToDirectory','minFileAgeMs','charset','processBatch');
SELECT channel_id, name, k AS unknown_key FROM channel_connectors, jsonb_object_keys(properties) k
WHERE connector_type = 'SFTP'
  AND k NOT IN ('host','port','username','password','privateKey','passphrase','remoteDirectory','strictHostKey','hostKey',
                'fileNameTemplate','tempFileEnabled','appendMode','template');
```

**KAFKA** and **AMQP** come last. They have had a core-models schema since they shipped, but it dropped a key it did not list instead of refusing it; now it refuses it, like every other type. Their forms have saved the same keys since they reached `main` on 2026-11-15, and the importer never creates them, so channels saved by the editor keep deploying. Nothing in the database is rewritten. The Kafka destination's record key has always been `messageKey` on `main`; a channel saved with `key` on the pre-release branch now fails and needs it renamed.

A KAFKA or AMQP channel now fails to deploy when it has:

- any other key its table doesn't list, e.g. `key`, `prefetch` or `persistent`, or a key inside `tls` other than `caCertId`, `clientCertId` and `rejectUnauthorized` (such as pasted PEM). Before, such a key was dropped without a word.
- an AMQP `port` or a `maxStoreAttempts` of `true`, or text other than plain digits (`"0x1628"`, `"5.672e3"`). Before, `true` was read as 1 and such text as the number it spells.

```sql
SELECT id, name, source_connector_type, k AS unknown_key FROM channels, jsonb_object_keys(source_connector_properties) k
WHERE (source_connector_type = 'KAFKA'
       AND k NOT IN ('brokers','clientId','useTls','tls','saslMechanism','saslUsername','saslPassword','topic','groupId',
                     'startFrom','charset','maxStoreAttempts','processBatch'))
   OR (source_connector_type = 'AMQP'
       AND k NOT IN ('host','port','vhost','username','password','useTls','tls','queue','charset','maxStoreAttempts','processBatch'));
SELECT channel_id, name, connector_type, k AS unknown_key FROM channel_connectors, jsonb_object_keys(properties) k
WHERE (connector_type = 'KAFKA'
       AND k NOT IN ('brokers','clientId','useTls','tls','saslMechanism','saslUsername','saslPassword','topic','messageKey','headers','template'))
   OR (connector_type = 'AMQP'
       AND k NOT IN ('host','port','vhost','username','password','useTls','tls','exchange','routingKey','headers','contentType','template'));
-- Keys inside tls, both directions:
SELECT id, name, k AS unknown_tls_key FROM channels, jsonb_object_keys(source_connector_properties->'tls') k
WHERE source_connector_type IN ('KAFKA','AMQP') AND jsonb_typeof(source_connector_properties->'tls') = 'object'
  AND k NOT IN ('caCertId','clientCertId','rejectUnauthorized');
SELECT channel_id, name, k AS unknown_tls_key FROM channel_connectors, jsonb_object_keys(properties->'tls') k
WHERE connector_type IN ('KAFKA','AMQP') AND jsonb_typeof(properties->'tls') = 'object'
  AND k NOT IN ('caCertId','clientCertId','rejectUnauthorized');
```

## Roles become rows (#265)

Migrations 0018 to 0020 move roles from code into the database (D-310). 0018 creates the `roles`, `role_permissions` and `assignments` tables, writes the built-in roles, and gives every user one all-channel assignment of the role in `users.role`, so nobody's access changes. 0019 drops `users.role` and the unused `user_permissions` table, and 0020 allows only one admin role.

The previous version reads `users.role` on every request, so it cannot run against an upgraded database. Going back needs the pre-upgrade dump (see [Rollback](#rollback)). Server backups made after the upgrade list each user's `roles` instead of one `role`, and an older server refuses to restore them.

## DICOM paths limited to FILE_CONNECTOR_ROOTS (#313)

A DICOM Listener's `storageDir` and `moveToDirectory`, and the file a DICOM Sender sends, must now be under `FILE_CONNECTOR_ROOTS`, as File connectors' directories have been since D-315 (D-326). A Listener outside the roots, or on a server with `FILE_CONNECTOR_ROOTS` unset, refuses to deploy; a Sender asked to send a file outside them errors that message. Before upgrading, add each DICOM storage and move-to directory to `FILE_CONNECTOR_ROOTS`, or move it under a root. These list them:

```sql
SELECT id, name, source_connector_properties->>'storageDir' AS storage_dir,
       source_connector_properties->>'moveToDirectory' AS move_to
FROM channels WHERE source_connector_type = 'DICOM';
```

A Listener also refuses an instance whose SOP Instance UID is not a DICOM UID (digits and dots, at most 64 characters), answering the sender with a C-STORE failure instead of storing it.

## DICOM settings that did nothing are gone (#154)

The editor no longer shows the Listener's pool sizes or the Sender's mode and maximum associations: the connector never used them. A saved channel that has `minPoolSize`, `maxPoolSize`, `mode` or `maxAssociations` keeps deploying; validation drops the keys, whatever their values, so a `maxPoolSize` below `minPoolSize` no longer fails a deploy. Nothing in the database is rewritten.

## Backups taken with `docker exec -t` can't be restored (#361)

Until 2026-11-23 the backup commands on this page and in [Backup & restore](backup-restore.md) wrote dumps that can't be restored. Take a new backup with `docker/backup.sh`, change any cron job or script that runs `pg_dump` through `docker exec -t`, and [repair the dumps you still need](backup-restore.md#dumps-taken-with-docker-exec--t).

## Alert email signs in over TLS only (#358)

With `smtp.auth_user` set and `smtp.secure` off, alert email now requires STARTTLS, and it fails if the server does not offer it (before, it signed in over plaintext). Turn on `smtp.secure` if the server takes TLS from the start, or clear `smtp.auth_user` if it needs no sign-in. A value of `smtp.secure` other than `true` or `false` also fails the email; before, it counted as off. Changing `smtp.host` clears the saved password, so type it again in the same save. A script that sets the settings one at a time must set `smtp.host` before `smtp.auth_pass`, on a new install too. The new `smtp.require_tls` setting appears on the Settings page once the seed has run; with `SEED_ON_START=false`, add it with `PUT /api/v1/settings/smtp.require_tls`.

## The Email source's Include Attachments setting is gone (#154)

The receiver never read it: an email arrives as the mail server holds it, attachments included, with the box ticked or not. If you left it off to keep attachments out of message storage, they have been stored all along (#369). A saved channel that has `includeAttachments` keeps deploying; validation drops the key, whatever its value. Nothing in the database is rewritten.

## An alert's regex must compile (#133)

An alert whose regex filter does not compile never fired, and nothing said so. Saving one is now refused with the reason. One saved earlier is kept, still never fires, and logs a warning when a channel it covers deploys: look for "its regex filter does not compile" after the upgrade. Restoring a backup that would create or overwrite such an alert reports it and restores the others; in Skip mode, one the server already has is skipped as before.

## Imports keep stored credentials and script timeouts (#334)

Importing a channel with `OVERWRITE`, or restoring a backup with it, used to clear every connector credential the target had, because the file masks them. It now keeps a stored credential while the connector is the same one and still goes to the same place as the same user, and clears it otherwise ([Credentials](api-automation.md#credentials)). A pipeline that puts the credentials back after each import can stop doing so. A connector an earlier import or restore left without its credential still needs it entered: look for destinations that deploy without one, such as HTTP with an `Authorization` header.

Exports and backups now hold each channel's script timeout. Before, a channel imported as new, or restored onto a fresh server, got 30 seconds whatever it had. If you raised a channel's script timeout before such an import or restore, set it again. A file made before this version has no timeout: a channel it creates gets 30 seconds, and one it overwrites keeps its own.

## Crash recovery runs an interrupted message again as the same message (#401)

Before, a server that stopped again while crash recovery was running a message left a second copy of it, and the next start ran and delivered both. The upgrade stops that from happening, and it can't tell copies that are already there apart: each one is run and delivered once at the first start. If the server has been restarting over and over, disable the affected channels before the upgrade (the API may answer only now and then, so try again), and delete the extra copies in the message browser before you enable and deploy them: they have the same content and read RECEIVED. Keep one, or none if a copy with that content already reads SENT.

## More connector credentials are masked (D-346)

Reads without `channels:write` on the channel, exports and backups now also mask the user name and password in a URL, a URL's query parameters named like a secret, the lines so named in headers saved as text, and settings whose name ends in `PW` or `pwd`. Someone who may change other channels but only read this one sees credentials masked. The answers to creating, saving, cloning, enabling and disabling a channel have them masked for everyone: a script that read them from there must read the channel. Saving a channel that still holds the mask is refused. Before, whoever could read a channel could read those credentials, and so could whoever was given an export or a backup file: replace the ones that matter.

An HTTP or FHIR destination never could send with a user name or password in its URL, unless it is an HTTP destination with scheme HTTPS or TLS settings of its own, which signs in with them. Each send failed, and the error kept with the message quoted the URL; it no longer does. Neither does the error for a header value with a line break in it. Messages that failed that way before still show the password in their errors, to whoever may read messages.

An import with `OVERWRITE` keeps a credential in a URL or in text headers when the file changes nothing else in that setting ([Credentials](api-automation.md#credentials)). Otherwise, and for a new channel, a masked URL is left out and the connector does not deploy until you enter it.

## The log no longer holds the parameters of a failed statement (D-347)

When a database statement failed, for example during a database restart, its parameters were in the error's text: passwords when saving a channel, a setting or a certificate failed (with the certificate's private key), and message content when storing it failed. The server logged that text. Alerts, events, the errors stored with a message (from a script's use of a collection) and a few API answers (a backup restore's, for one) could carry it too. It now names the statement and the database's error code. What was written before stays: treat those logs as you treat the database, and replace the passwords and keys they show. The log pages of the web UI did not show them.

## Destinations keep their numbers (#395)

Saving a channel used to number its destinations again from 1, in their order, while queued messages, Resend and `destinationSet` go by the number. After a destination was removed or moved, what waited for one partner could be sent to another. From migration 0028 a destination keeps its number, and no other destination of the channel gets it ([Every destination](../user/connector-reference.md#every-destination), D-348). The numbers channels have now stay as they are.

**Before upgrading**, let the queues empty of any channel whose destinations were renamed, moved, removed or replaced since messages were put on them, or that has two destinations with the same name. Then deploy the channel's saved changes, or undo them. Don't deploy them while messages wait: the version you are upgrading from can send those to another destination. Stop the server before the migration runs (the Docker upgrade does): an old one that goes on saving or deploying channels renumbers them as before.

The number of a message stored before the upgrade does not say which destination it was for, so the migration notes the name that each number has in the deployed version of the channel (in the saved one, if none is recorded). Such a message is sent from a queue, by Resend or after a crash only if it was prepared under that name and no other destination has the name. Renaming a destination after the upgrade changes nothing. A message on a queue that fails this stays there and is reported: reprocess it, then delete it. One the server stopped on while sending it ends in ERROR. For a channel with saved changes that are not deployed, the same goes for messages stored until you deploy them, and they are then sent only to destinations the changes left as they were: same number, name, connector type and settings. A message that is run again after a crash goes to the destinations it is routed to then, unless it was stored before such a deploy.

The migration builds the index of waiting messages again, which reads the whole `connector_messages` table.

**After upgrading:**

- A destination that is switched off no longer sends what is on its queue. Switch it on, or let its queue empty first, if it should be sent.
- Messages that wait for a destination that is switched off, has its queue off or was removed, or that are not known to be for the one with their number, are reported at the first start, also those left there long ago. Nothing is sent or deleted. Look for `QUEUE_HELD` on the Events page.
- `PUT /api/v1/channels/:id` needs the `id` and `enabled` of each destination, and filters and transformers name their destination by that `id`. A script that sends `metaDataId` there, or ids the channel does not have, gets a 400 ([Change a channel](api-automation.md#change-a-channel)).
- An import finds the channel's destinations by the `id` that exports now carry, and can refuse a channel over its numbers ([which ones](api-automation.md#import-it-on-another-server)). A file from before the upgrade is read as before, by number and name.

## File and SFTP: temporary names, moves and changed files (#412)

**An SFTP destination now writes under a temporary name** (`.galvanigraph-<uuid>.tmp` in the same folder) and renames the file, as a FILE destination does. Every SFTP destination without append is affected, with no change to the channel. Turn **Use Temp File** off on one whose server allows uploads but no renames, allows overwriting but no new files, or refuses names that start with a dot or end in `.tmp`, where each send now ends in an ERROR that points to the setting, and on one whose server takes each upload as a file the moment it closes (a mailbox, a transfer workflow), which would take the temporary name. A file that replaces another is a new one: its owner, permissions and access list are the server's defaults, and a name that is a link is replaced by the file instead of written through. Ask the partner before you upgrade; these are the destinations:

```sql
SELECT channel_id, name, properties->>'host' AS host, properties->>'remoteDirectory' AS directory FROM channel_connectors
WHERE connector_type = 'SFTP' AND COALESCE(properties->>'appendMode', 'false') <> 'true';
```

A FILE destination's temporary file has the same form of name; it was the file's name plus `.<uuid>.tmp`.

**A FILE source's `MOVE` no longer replaces a file of the same name** in the target folder; SFTP already failed on most servers. The file stays in the source folder, is delivered once, and is in the quarantine list with an ERROR in the log. A sender that uses the same name every day, such as `results.hl7`, needs another after-processing action, or something that clears the target folder.

**An SFTP source asks the server for each file's size and time (STAT) before it reads it**, after, and before it deletes or moves it. A server that answers the listing and refuses that gives an ERROR in the log for each file at each poll, and the files stay.

**A source that finds a file changed while its message was processed leaves it and reads it again.** Before, it deleted or moved the changed file unread. A file that grows by appending is delivered again whole, so set its minimum age longer than the sender's pauses.

**A stop of an SFTP source waits for a file it has downloaded** until that is processed and deleted, moved or quarantined, as a FILE source's does.

**An SFTP write that the server stops taking part-way, such as on a full disk, is an ERROR.** Before, the message read SENT and the file was cut short. If a partner's disk or quota ran full, files from that time may be incomplete although their messages read SENT.

## A DICOM Sender reads SENT only for a stored image (#410)

A DICOM Sender took a refused C-STORE, a rejected presentation context, an aborted association and a closed connection as sent, and a DICOM Listener in front of it deleted its file. Each is now an ERROR that names the status or the reason, and a destination with a queue retries it. Nothing in the database is rewritten: a message that reads SENT from before the upgrade is no proof that the archive has the image, so compare with the archive where that matters. Expect errors on channels whose archive has been refusing images unnoticed.

## Windows-1252 text is read the same on every Node (#391)

Some Node versions, 24.13.0 among them, decode Windows-1252 as Latin-1 without an error. On those, the bytes 0x80 to 0x9F (curly quotes, dashes, the euro sign) were stored as the control characters U+0080 to U+009F. That concerns Kafka and AMQP sources with `charset` `windows-1252`, HTTP sources with `bodyCharset` `windows-1252`, and HTTP bodies that declare Windows-1252, ISO-8859-1 or US-ASCII. The server now decodes Windows-1252 itself, so nothing needs to be changed (D-351). DICOM text under `ISO_IR 100` and a few rarer charsets that an HTTP sender can declare still depend on the Node version (#427).

To see whether the Node you run the server with was affected, run this with it. `false` means that it was:

```bash
node -p "new TextDecoder('windows-1252').decode(Uint8Array.of(0x80)).charCodeAt(0) === 0x20ac"
```

Messages stored that way stay as they are. Their text has characters from U+0080 to U+009F, which real text does not use, and nothing is lost: each is the byte of that number, to be read as Windows-1252. Where partners got such text, correct it with them: sending the messages again can duplicate them there.

## A destination does not send text its charset cannot hold (#415)

A File or TCP/MLLP destination with the charset `latin1` or `ascii` wrote another character in place of one the charset does not have, and the message read SENT. In `latin1` a curly quote became U+0019, and `č` became a carriage return, which cut the HL7 segment in two. Such a message is now an ERROR that names the character (D-358). `ascii` refuses everything above U+007F, which it used to write as ISO-8859-1, and `utf-8` half of a surrogate pair (text cut through an emoji). Expect errors on channels that did this unnoticed: set the destination's charset to one the partner reads that has the characters (`utf-8`) and deploy again. Replacing the characters in a transformer helps the messages after that, not one already on a queue, which is sent as it is stored; with no retry limit and `rotateQueue` off, the queue waits behind it. An `ascii` destination whose partner reads ISO-8859-1 needs `latin1`.

The HTTP and FHIR destinations and `httpFetch` now read an answer in the charset it declares, where they read every answer as UTF-8. A script that worked around that must stop. A server that declares ISO-8859-1 and sends UTF-8 was read right by accident, and is now read as it declares. `httpFetch`, and an HTTP destination with certificates, no longer keep a byte order mark at the start of an answer, so a script that cut it off must stop too.

## A JavaScript source sends every item of an array (#415)

A JavaScript source dropped the items of a returned array that were not text, without a word, and sent a single object as the text `[object Object]`. Items that are numbers, objects or arrays are now messages of their own, and an object is sent as JSON, so a channel whose script returns such items sends messages after the upgrade that it did not send before: look for polling scripts that return rows (`dbQuery`) or parsed messages in an array. Items that hold no message are skipped with a warning in the log, as [JAVASCRIPT: what it does](../user/connector-reference.md#javascript-what-it-does) lists. A single object without data, which was sent as `[object Object]` too, is one of them.

## A DICOM Listener answers once the message is safe (#410)

A DICOM Listener answered success before the message was stored. In `PER_FILE` mode it now answers when the message is in the database, and a sender gets a C-STORE failure while the database is down. In `PER_ASSOCIATION` mode it keeps a list of answered files under `.galvanigraph-pending` in the storage directory until the message is stored ([DICOM](../user/connector-reference.md#dicom), D-353): include that folder in the backup of the storage directory, and let nothing clean it up. An association that was aborted now gives a message of the images it answered, where it gave none; one that stored nothing (a C-ECHO) gives none, where it gave a message with an empty list. `associationId` in the source map is now unique (`assoc-<uuid>`), where it started again at `assoc-1` with each start. Files that were left in a storage directory without a message before the upgrade are not picked up.

## DICOM images pass byte for byte (#410)

The DICOM Listener and Sender read and rewrote every dataset, which dropped private attributes and tags the library does not know and rewrote numbers as text (`1.50` became `1.5`). The Listener now stores the dataset as it came, and the Sender sends the stored bytes ([DICOM](../user/connector-reference.md#dicom), D-354). Images received before the upgrade stay as they were stored. An instance without a SOP Class UID or SOP Instance UID in its dataset is now refused, where it was stored under a made-up UID.

An image in a transfer syntax the archive does not take is now an ERROR that names it. A compressed one never went out uncompressed (it was not sent, and read SENT); one in explicit VR big endian or in implicit VR was rewritten in the archive's, with that loss, and no longer is.

## A DICOM Listener accepts every standard storage class, and its start can fail (#410)

A DICOM Listener accepted 59 storage SOP classes, so RT structure sets, plans and doses, segmentations, presentation states, key object selections and ECGs among others were rejected, as were JPEG Extended and JPEG Lossless. It now accepts every standard one ([DICOM](../user/connector-reference.md#dicom), D-355): check the filters of channels that relied on the rejection. A Listener whose port is in use now fails to start, where it read started and received nothing. Look for such channels after the upgrade.

## Channels imported from Mirth: Message Builder steps and retry counts (#418)

An import before this version dropped the content of a Mirth Message Builder step, and the engine skipped the empty step, so messages went on without what the step set. An enabled Message Builder step with no script now fails the deploy (`Transformer step 2 has type MESSAGE_BUILDER, which this engine cannot run without a script`), at a restart too, which reports the channel as one that failed to redeploy. Before upgrading, open the transformers of channels imported from Mirth, and of any other with a Message Builder step, write the step's script, or disable the step if the message is right without it, and redeploy the channel: a restart deploys what was last deployed, not what was saved.

Such an import also kept Mirth's retry count, which in Mirth is the attempts before a message is queued. Here it ends the queue: a message that fails that many retries goes to ERROR (D-230). Set the retry count of a queued destination to 0, and redeploy, where the message must be retried until it is delivered, as Mirth does with one it could not send. With 0 the queue also sends a message again that the partner refuses (a negative acknowledgement), which ends it in Mirth, and the messages behind it wait unless "Skip Past a Failed Message" is on. A new import does this and says so.

A new import can also hold a channel disabled, or refuse to overwrite an enabled one, where it only warned or said nothing before: see the migration table in [capabilities.md](../user/capabilities.md).

## Standard upgrade (Docker)

1. Get the new code. Nothing changes until step 3. There are no published images; the stack builds from source.

   ```bash
   git pull
   ```

2. **Back up** into a directory outside the checkout and outside the one your nightly job cleans up, and note the file's name. Create the directory once. Go on only if it prints `dump OK`. An install [created as Mirthless or GalvaniFlow](#renamed-from-mirthless-or-galvaniflow) sets its names as [Backup & restore](backup-restore.md#logical-backup-with-pg_dump-recommended) shows.

   ```bash
   sh docker/backup.sh /pre-upgrade-backups
   ```

3. Rebuild and restart. The server container migrates when it starts.

   ```bash
   docker compose -f docker/docker-compose.prod.yml up -d --build
   ```

4. Verify: the health check goes through nginx to the server and answers with status `ok`.

   ```bash
   curl -fsS http://localhost/health
   docker compose -f docker/docker-compose.prod.yml logs server | grep -i migrat
   ```

Watch the server logs for `[migrate] migrations applied` before the startup banner.

## Renamed from Mirthless or GalvaniFlow

The project was called Mirthless until 2026-10-27 (D-205), then GalvaniFlow until 2026-11-16 (D-309), and is now GalvaniGraph. Upgrading an install created under either old name has these one-time effects. Below, `<old>` is the name your install was created under: `mirthless` or `galvaniflow`.

**Database name and user.** New installs default to database and user `galvanigraph`.
Postgres applies `POSTGRES_DB` / `POSTGRES_USER` only when it first creates the data
volume, so an existing volume still holds database `<old>` owned by user `<old>`.
Nothing in the code depends on the database name; keep using the old one:

- **Docker prod stack:** set `POSTGRES_DB=<old>` and `POSTGRES_USER=<old>` in the
  same place you set `POSTGRES_PASSWORD`. `docker/docker-compose.prod.yml` builds the
  server's `DATABASE_URL` from these three, so leaving them unset points the server at a
  `galvanigraph` database that does not exist in the old volume.
- **Server role:** the default for `POSTGRES_APP_USER` is now `galvanigraph_app`. A GalvaniFlow
  install already has `galvaniflow_app`; set `POSTGRES_APP_USER=galvaniflow_app` to keep
  using it. Left unset, the migration step creates `galvanigraph_app` with the same
  grants and the old role sits unused.
- **Local / non-Docker:** keep your existing `DATABASE_URL` in `.env`
  (`postgresql://<old>:...@.../<old>`). The dev compose (`pnpm docker:up`) keeps
  the same volume, so the old databases are still there; for `pnpm test:integration`,
  point `DATABASE_URL` at `<old>_test`. Or start fresh with `pnpm docker:reset`,
  which deletes the dev volume and its data.
- The data volume keeps its name (`docker_postgres_data`; the compose project is named
  after the `docker/` folder), so no data moves. Only the containers are renamed:
  `<old>-db-prod`, `<old>-server` and `<old>-web` become
  `galvanigraph-db-prod`, `galvanigraph-server` and `galvanigraph-web` (dev: `<old>-db`
  becomes `galvanigraph-db`). Update any backup cron jobs or scripts that name a container.

**Other changes:**

- **CLI:** removed (D-280). Scripts call the REST API; see `docs/ops/api-automation.md`.
- **Prometheus metrics** are renamed from `<old>_*` to `galvanigraph_*` (for example
  `galvanigraph_messages_processed_total`). Update dashboards, alert rules and recording
  rules.
- **Web UI:** each user signs in once more after the upgrade (the browser stores the
  session under a new key). The light or dark theme carries over.
- **Wire defaults** change from `MIRTHLESS` or `GALVANIFLOW` to `GALVANIGRAPH`: the DICOM
  source AE title and destination calling AE title for new connectors, MSH-3 in generated
  test HL7 messages, and the control-ID prefix of the fallback ACK sent for unparseable HL7.
  Existing channels keep the AE titles saved in them. If a trading partner checks these
  values (for example a PACS that allow-lists calling AE titles), tell them before you
  create new channels or rely on the fallback ACK.
- **File and SFTP sources:** the quarantine ledger is now `.galvanigraph-quarantine.json`.
  An existing `.galvaniflow-quarantine.json` or `.mirthless-quarantine.json` in the
  watched directory is still read and merged into it, so quarantined files stay quarantined.
- **Email sources:** processed emails are now marked `$GalvaniGraphDispatched`. Emails
  marked `$GalvaniFlowDispatched` or `$MirthlessDispatched` by an older version still
  count as dispatched.

## Standard upgrade (local / non-Docker)

```bash
# Stop the server first: an old one must not work on a migrated database.
git pull
pnpm install
pnpm db:migrate     # apply new migrations to the running Postgres
pnpm build
pnpm start          # or pnpm dev
```

## Downtime expectations

GalvaniGraph is currently a **single-instance** deployment (no clustering yet — see the
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
   [backup-restore.md](backup-restore.md)) into a fresh database, without its last step,
   which would start the new version and migrate it again. This is the only safe
   way to undo a schema migration — reverting just the code while leaving a newer schema
   in place is unsupported and can corrupt data.
3. Redeploy the **previous** image/code version. A version from before 2026-11-23 has no `docker/backup.sh`, so a nightly job that calls it fails until you upgrade again: copy `docker/backup.sh` and `docker/check-dump.sh` elsewhere first and point the job there.
4. Start the old server; it will see its own schema already migrated and boot normally.

Because rollback means a database restore, **the pre-upgrade `pg_dump` is mandatory** —
do not skip step 2 of the upgrade. Test upgrades in staging first whenever a release
includes migrations.
