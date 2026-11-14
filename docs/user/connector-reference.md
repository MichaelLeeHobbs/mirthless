# Connector Reference

GalvaniFlow connectors are protocol adapters. A **source** connector receives inbound
messages; a **destination** connector sends outbound. This reference documents the
property keys each connector actually reads, sourced from
`packages/connectors/src/registry.ts` (the registry is the source of truth). Defaults
shown are the values the registry applies when a property is omitted.

Source types: `TCP_MLLP`, `HTTP`, `FILE`, `DATABASE`, `JAVASCRIPT`, `CHANNEL`, `DICOM`, `EMAIL`, `KAFKA`, `AMQP`
Destination types: `TCP_MLLP`, `HTTP`, `FILE`, `DATABASE`, `JAVASCRIPT`, `SMTP`, `CHANNEL`, `FHIR`, `DICOM`, `KAFKA`, `AMQP`

The Kafka and AMQP property schemas are in `packages/core-models/src/schemas/queue-connector.schema.ts`; their delivery guarantees are in D-263.

---

## Source connectors

### TCP_MLLP (source)
HL7 lower-layer protocol over TCP.

| Property | Default | Notes |
|---|---|---|
| `host` | `0.0.0.0` | Interface to bind. |
| `port` | — (required) | TCP listen port. |
| `maxConnections` | `10` | Concurrent inbound connections. |

### HTTP (source)
HTTP listener.

| Property | Default | Notes |
|---|---|---|
| `host` | `0.0.0.0` | Interface to bind. |
| `port` | — (required) | Listen port. |
| `path` | `/` | Request path to accept. |
| `method` | `POST` | Accepted HTTP method. |
| `responseContentType` | `text/plain` | Content-Type of the response. |
| `responseStatusCode` | `200` | Status code returned to the caller. |

### FILE (source)
Polls a directory and ingests files.

| Property | Default | Notes |
|---|---|---|
| `directory` | — (required) | Directory to poll. |
| `fileFilter` | `*` | Glob (`*` / `?` wildcards). |
| `pollingIntervalMs` | `5000` | Poll interval. |
| `sortBy` | `NAME` | Processing order (`NAME`, etc.). |
| `charset` | `utf-8` | Read encoding. |
| `binary` | `false` | Read as binary (base64) vs text. |
| `checkFileAge` | `true` | Skip files still being written. |
| `fileAgeMs` | `1000` | Minimum file age before pickup. |
| `postAction` | `DELETE` | After read: `DELETE` / `MOVE` / `NONE`. |
| `moveToDirectory` | `''` | Target when `postAction=MOVE`. |

### DATABASE (source)
Polls a PostgreSQL database with a select query.

| Property | Default | Notes |
|---|---|---|
| `host` | — (required) | DB host. |
| `port` | `5432` | DB port. |
| `database` | — (required) | Database name. |
| `username` | — (required) | DB user. |
| `password` | — (required) | DB password. |
| `selectQuery` | — (required) | Query returning rows to ingest. |
| `updateQuery` | `''` | Optional post-read mark query. |
| `updateMode` | `NEVER` | When to run `updateQuery`. |
| `pollingIntervalMs` | `5000` | Poll interval. |
| `rowFormat` | `JSON` | Row serialization format. |

### JAVASCRIPT (source)
Runs a user script on a timer to generate messages.

| Property | Default | Notes |
|---|---|---|
| `script` | `''` | Script executed each poll (sandboxed). |
| `pollingIntervalMs` | `5000` | Poll interval. |

### CHANNEL (source)
Receives messages routed from another channel's CHANNEL destination.

| Property | Default | Notes |
|---|---|---|
| `channelId` | — (required) | This channel's own ID as the routing target. |

### DICOM (source)
DICOM C-STORE SCP. Files are large; the file path is stored in message content and
metadata in the source map.

| Property | Default | Notes |
|---|---|---|
| `port` | — (required) | DICOM listen port. |
| `storageDir` | — (required) | Where received objects are written. |
| `aeTitle` | `GALVANIFLOW` | Application Entity title. |
| `minPoolSize` | `2` | Association worker pool minimum. |
| `maxPoolSize` | `10` | Association worker pool maximum. |
| `connectionTimeoutMs` | `10000` | Association timeout. |
| `dispatchMode` | `PER_FILE` | `PER_FILE` (one msg per object) or `PER_ASSOCIATION` (JSON array). |
| `postAction` | `DELETE` | After store: `DELETE` / `MOVE` / `NONE`. |
| `moveToDirectory` | `''` | Target when `postAction=MOVE`. |

### EMAIL (source)
Polls a mailbox (IMAP/POP3).

| Property | Default | Notes |
|---|---|---|
| `host` | — (required) | Mail server host. |
| `port` | `993` | Server port. |
| `secure` | `true` | Use TLS. |
| `username` | `''` | Mailbox user. |
| `password` | `''` | Mailbox password. |
| `protocol` | `IMAP` | `IMAP` or `POP3`. |
| `folder` | `INBOX` | Folder to poll. |
| `pollingIntervalMs` | `60000` | Poll interval. |
| `postAction` | `MARK_READ` | After read action. |
| `moveToFolder` | `''` | Target folder when moving. |
| `subjectFilter` | `''` | Only ingest matching subjects. |
| `includeAttachments` | `false` | Attach message attachments. |

### KAFKA (source)
Reads a topic as a member of a consumer group and commits a record only after the channel has stored it. Source map: `topic`, `partition`, `offset`, `key`, `headers`, `timestamp`.

| Property | Default | Notes |
|---|---|---|
| `brokers` | — (required) | `host:port`, comma separated. |
| `clientId` | `galvaniflow` | Shown in broker logs. |
| `topic` | — (required) | An existing topic. |
| `groupId` | — (required) | Consumer group; one per channel. |
| `startFrom` | `EARLIEST` | `EARLIEST` or `LATEST`, for a group with no committed offset. |
| `saslMechanism` | `NONE` | `NONE`, `PLAIN`, `SCRAM-SHA-256` or `SCRAM-SHA-512`. |
| `saslUsername`, `saslPassword` | `''` | Required with a mechanism. |
| `useTls` | `false` | TLS to the brokers. |
| `tls` | — | `caCertId`, `clientCertId` (certificate store ids), `rejectUnauthorized` (default `true`). |

### AMQP (source)
Consumes an existing RabbitMQ (AMQP 0-9-1) queue and acks a message only after the channel has stored it. Source map: `queue`, `exchange`, `routingKey`, `redelivered`, `headers`, and `messageId`/`contentType` when set.

| Property | Default | Notes |
|---|---|---|
| `host` | — (required) | Broker host. |
| `port` | `5672` | 5671 is the usual TLS port. |
| `vhost` | `/` | Virtual host. |
| `username`, `password` | `''` | Login; the broker's default when empty. |
| `queue` | — (required) | An existing queue; never declared. |
| `useTls`, `tls` | `false` | As for Kafka. |

---

## Destination connectors

### TCP_MLLP (destination)
Sends HL7 over MLLP and waits for the ACK.

| Property | Default | Notes |
|---|---|---|
| `host` | — (required) | Target host. |
| `port` | — (required) | Target port. |
| `maxConnections` | `5` | Connection pool size. |
| `responseTimeout` | `30000` | ACK wait timeout (ms). |

### HTTP (destination)
POSTs (or other method) the message to a URL.

| Property | Default | Notes |
|---|---|---|
| `url` | — (required) | Target URL. |
| `method` | `POST` | HTTP method. |
| `headers` | `{}` | Extra request headers. |
| `contentType` | `text/plain` | Request Content-Type. |
| `responseTimeout` | `30000` | Response timeout (ms). |

### FILE (destination)
Writes the message to a file.

| Property | Default | Notes |
|---|---|---|
| `directory` | — (required) | Output directory. |
| `outputPattern` | `${messageId}.txt` | File name template. |
| `charset` | `utf-8` | Write encoding. |
| `binary` | `false` | Write binary vs text. |
| `tempFileEnabled` | `true` | Write to temp then rename (atomic). |
| `appendMode` | `false` | Append instead of overwrite. |

### DATABASE (destination)
Runs an insert/update query against PostgreSQL.

| Property | Default | Notes |
|---|---|---|
| `host` | — (required) | DB host. |
| `port` | `5432` | DB port. |
| `database` | — (required) | Database name. |
| `username` | — (required) | DB user. |
| `password` | — (required) | DB password. |
| `query` | — (required) | Parameterized write query. |
| `useTransaction` | `false` | Wrap in a transaction. |
| `returnGeneratedKeys` | `false` | Return generated keys. |

### JAVASCRIPT (destination)
Runs a user script to dispatch the message however you like.

| Property | Default | Notes |
|---|---|---|
| `script` | `''` | Dispatch script (sandboxed). |

### SMTP (destination)
Sends the message as email.

| Property | Default | Notes |
|---|---|---|
| `host` | `''` | SMTP host. |
| `port` | `587` | SMTP port. |
| `secure` | `false` | Use TLS on connect. |
| `authUser` | `''` | SMTP auth user (maps to `auth.user`). |
| `authPass` | `''` | SMTP auth password (maps to `auth.pass`). |
| `from` | `''` | From address. |
| `to` | `''` | To address(es). |
| `cc` | `''` | Cc address(es). |
| `bcc` | `''` | Bcc address(es). |
| `subject` | `''` | Subject line. |
| `bodyTemplate` | `${msg}` | Body template. |
| `contentType` | `text/plain` | `text/plain` or `text/html`. |
| `attachContent` | `false` | Attach the message content. |

### CHANNEL (destination)
Routes the message to another channel's CHANNEL source.

| Property | Default | Notes |
|---|---|---|
| `targetChannelId` | `''` | Destination channel ID. |
| `waitForResponse` | `false` | Block for the target's response. |

### FHIR (destination)
Sends a FHIR resource to a FHIR server.

| Property | Default | Notes |
|---|---|---|
| `baseUrl` | `''` | FHIR server base URL. |
| `resourceType` | `Patient` | Resource type. |
| `method` | `POST` | `POST` or `PUT`. |
| `authType` | `NONE` | `NONE` / `BASIC` / `BEARER` / `API_KEY`. |
| `authUsername` | — | Basic auth user. |
| `authPassword` | — | Basic auth password. |
| `authToken` | — | Bearer token. |
| `authHeaderName` | — | Header name for `API_KEY`. |
| `authApiKey` | — | API key value. |
| `format` | `json` | `json` or `xml`. |
| `timeout` | `30000` | Request timeout (ms). |
| `headers` | `{}` | Extra request headers. |

### DICOM (destination)
DICOM C-STORE SCU — sends objects to a PACS.

| Property | Default | Notes |
|---|---|---|
| `host` | — (required) | PACS host. |
| `port` | — (required) | PACS port. |
| `calledAETitle` | `PACS` | Remote AE title. |
| `callingAETitle` | `GALVANIFLOW` | Local AE title. |
| `mode` | `multiple` | `single` or `multiple` associations. |
| `maxAssociations` | `4` | Max concurrent associations. |
| `maxRetries` | `3` | Retry attempts. |
| `retryDelayMs` | `1000` | Delay between retries. |
| `timeoutMs` | `30000` | Association timeout. |

### KAFKA (destination)
Publishes to a topic; SENT once every in-sync replica has the record (acks=all). Connection properties (`brokers`, `clientId`, SASL, TLS) as for the source.

| Property | Default | Notes |
|---|---|---|
| `topic` | — (required) | An existing topic; `${name}` is filled per message, and a name the message lacks is an error. |
| `key` | `''` | Record key, `${name}` allowed; empty sends no key. |
| `headers` | `{}` | Record headers; values may use `${name}`. |

### AMQP (destination)
Publishes a persistent message; SENT once the broker confirms it. A message no queue would receive is returned by the broker and is an error. Connection properties as for the source. The message id is `channelId:messageId:metaDataId`, the same on every retry.

| Property | Default | Notes |
|---|---|---|
| `exchange` | `''` | An existing exchange; empty is the default exchange (routing key = queue name). |
| `routingKey` | `''` | `${name}` allowed; a name the message lacks is an error. Required with the default exchange. |
| `headers` | `{}` | Message headers; values may use `${name}`. |
| `contentType` | `text/plain` | AMQP content type. |
