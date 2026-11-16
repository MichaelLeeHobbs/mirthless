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
- **Roles:** a user's permissions come from their role in code at every request, so an upgrade that changes a role applies to existing users at once. Check the matrix in [Access control](../user/access-control.md#role-and-permission-matrix) after upgrading.
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

## Stricter connector properties (#115)

Connector properties are moving, one connector type at a time, to a schema in `packages/core-models` that refuses keys it does not list and values of the wrong type. A channel that deployed before can then fail its deploy, including the auto-deploy at server start, with `Invalid source connector properties for <TYPE>: ...` or `Invalid destination connector properties for <TYPE>: ...`. The message names the key. Nothing in the database is changed; edit the channel's properties and deploy again. `docs/user/connector-reference.md` lists the keys each type accepts.

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
                'maxBodyBytes','auth','scheme','tls','processBatch','contextPath','methods','charset');
SELECT channel_id, name, k AS unknown_key FROM channel_connectors, jsonb_object_keys(properties) k
WHERE connector_type = 'HTTP'
  AND k NOT IN ('url','method','headers','parameters','basicAuth','contentType','responseTimeout','scheme','tls','template','charset');
```

**DATABASE** is the third. Channels saved by this app's own editor keep deploying: the Database Reader and Writer forms have saved the same keys since 2026-03, plus `tls` since 2026-11, so there is nothing to drop or map. Nothing in the database is rewritten.

Two things now deploy that didn't. `port` is no longer required: with none set, the connector uses the vendor's port (5432 for PostgreSQL, 3306 for MySQL), as the registry always did. A Database Reader imported from Mirth with no port in its JDBC URL used to fail its deploy with `port: expected number`; it now deploys. A port written as digits (`"5432"`, e.g. a resolved configuration reference) is also accepted.

A DATABASE channel now fails to deploy when it has:

- any other key its table doesn't list, e.g. a misspelling such as `pollingInterval`. Before, such a key was ignored. Channels imported from Mirth before 2026-11-12 carry `url` and `driver` (and a reader's SELECT under `query`); they never deployed, because they had no `host`. Import them again.
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
                'selectQuery','updateQuery','updateMode','pollingIntervalMs','rowFormat','processBatch');
SELECT channel_id, name, k AS unknown_key FROM channel_connectors, jsonb_object_keys(properties) k
WHERE connector_type = 'DATABASE'
  AND k NOT IN ('vendor','host','port','database','username','password','tls',
                'query','useTransaction','returnGeneratedKeys','template');
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

Before upgrading, list the keys the schema would refuse:

```sql
SELECT id, name, k AS unknown_key FROM channels, jsonb_object_keys(source_connector_properties) k
WHERE source_connector_type = 'FILE'
  AND k NOT IN ('directory','fileFilter','pollingIntervalMs','sortBy','charset','binary','checkFileAge','fileAgeMs',
                'postAction','moveToDirectory','processBatch');
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

**DICOM** is the ninth. Channels saved by this app's own editor keep deploying: the DICOM forms have saved the same keys since 2026-03. The Mirth importer has no DICOM mapping, so since 2026-03-03 it has copied all of a DICOM Listener's or Sender's Mirth properties (`applicationEntity`, `localHost`, `dest`, `tls`, `keyStorePW`, `stgcmt` and some 30 more, listed in `packages/core-models/src/schemas/dicom-connector.schema.ts`). Nothing reads them, and the schema drops them, so an imported Sender (whose `host` and `port` have the same names here) keeps deploying, and so does a Listener once its port and storage directory were filled in. Nothing in the database is rewritten.

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
- a `secure` or `includeAttachments` that is not `true` or `false`. Before, any text, `"false"` included, turned `secure` on.
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
                'fileNameTemplate','appendMode','template');
```

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

- **CLI:** removed (D-280). Scripts call the REST API; see `docs/ops/api-automation.md`.
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
