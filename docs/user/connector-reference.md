# Connector reference

A connector is the part of a channel that talks to the outside world. A source connector receives messages into a channel; a destination connector sends them out.

Every property below is the key the connector reads from the channel's saved properties. Where the channel editor has no control for a key, the notes say so: set it through the REST API or in a channel export you import.

## Connectors at a glance

| Connector | Source | Destination | Covers | Transport security | Auth | Mirth equivalent |
|---|---|---|---|---|---|---|
| [TCP_MLLP](#tcp_mllp) | Yes | Yes | HL7 v2 (or other text) over TCP with MLLP or custom frame bytes | Optional TLS from raw PEM in a `tls` block, set through the API or an import (no editor control). A source `tls` block missing its cert or key fails the deploy; the check in [tls-and-phi.md](../ops/tls-and-phi.md#check-tls-is-on) confirms a listener speaks TLS | Mutual TLS only; no other sign-in | TCP Listener / TCP Sender |
| [HTTP](#http) | Yes | Yes | HTTP and HTTPS requests in either direction | `scheme` HTTPS with certificates from the certificate store. An HTTPS source with no server certificate refuses to deploy. A destination verifies the server certificate by default | Source: Basic or bearer token (API only), client certificates. Destination: Basic, custom headers, client certificate | HTTP Listener / HTTP Sender |
| [FILE](#file) | Yes | Yes | Local disk and OS mounts only. No SMB, S3, FTP or WebDAV | None in the connector; protect the mount | File system permissions of the server process | File Reader / File Writer |
| [SFTP](#sftp) | Yes | Yes | Files on a remote SFTP server | SSH, with host key checking on by default; an empty `hostKey` refuses to deploy while it is on | Password or private key | File Reader / File Writer with the sftp scheme, imported automatically by the Mirth importer |
| [DATABASE](#database) | Yes | Yes | PostgreSQL and MySQL/MariaDB only. No SQL Server or Oracle | `tls` flag; when on, the server certificate is verified | Database username and password | Database Reader / Database Writer |
| [JAVASCRIPT](#javascript) | Yes | Yes | Whatever a sandboxed script can produce or reach through the script bridges | Not applicable (runs in the server) | Not applicable | JavaScript Reader / JavaScript Writer |
| [CHANNEL](#channel) | Yes | Yes | Another GalvaniFlow channel on the same server | Not applicable (in memory) | Not applicable | Channel Reader / Channel Writer |
| [DICOM](#dicom) | Yes | Yes | DICOM C-STORE in and out | No TLS | None. The listener accepts any calling and called AE title | DICOM Listener / DICOM Sender |
| [EMAIL](#email) | Yes | No | Reading an IMAP mailbox. POP3 refuses to deploy | `secure` (IMAP over TLS), on by default | Mailbox username and password | none (Mirth Connect has no email reader connector) |
| [SMTP](#smtp) | No | Yes | Sending email only | `secure` (implicit TLS) and `requireTLS` (STARTTLS required); both off by default | Optional username and password | SMTP Sender |
| [FHIR](#fhir) | No | Yes | Posting a message that is already a FHIR R4 resource. No HL7 v2 to FHIR mapping | HTTPS when `baseUrl` is https, with the Node trust store | None, Basic, bearer token or API key header | FHIR Sender (commercial extension in Mirth) |
| [KAFKA](#kafka) | Yes | Yes | Kafka topics | `useTls` with a CA and client certificate from the certificate store | SASL PLAIN, SCRAM-SHA-256 or SCRAM-SHA-512, or client certificate | none |
| [AMQP](#amqp) | Yes | Yes | AMQP 0-9-1 brokers such as RabbitMQ | `useTls` with a CA and client certificate from the certificate store | Broker username and password, or client certificate | none |

The Kafka and AMQP property schemas are in `packages/core-models/src/schemas/queue-connector.schema.ts`; their delivery guarantees are in D-266. The TCP_MLLP property schemas are in `packages/core-models/src/schemas/tcp-mllp-connector.schema.ts`.

A connector's properties are checked when the channel deploys. TCP_MLLP rejects a key its table below does not list, so a misspelled key fails the deploy instead of being ignored. The exceptions are five keys the editor saved before 2026-07, which are dropped (see `docs/ops/upgrade.md`). A test (`packages/core-models/src/schemas/__tests__/connector-reference-docs.test.ts`) fails when a TCP_MLLP table and its schema list different keys.

## Keys on every connector

### Every source

| Property | Required | Notes |
|---|---|---|
| `processBatch` | No | Off by default. Split an inbound HL7 batch into one message per `MSH` segment. The Mirth importer sets it; the editor has no field for it. |

### Every destination

| Property | Required | Notes |
|---|---|---|
| `template` | No | What to send instead of the encoded message; `${...}` values are filled per message. The Mirth importer sets it from a sender's template; the editor has no field for it. |

## TCP_MLLP

### TCP_MLLP: what it does

The source listens on a TCP port and reads framed messages, by default MLLP (0x0B before the message, 0x1C 0x0D after it). The destination opens pooled connections to a partner and sends each message in the same framing.

The source answers every message. With `responseMode` AUTO_ACK it builds an HL7 ACK from the inbound MSH: AA when the pipeline accepted the message (a filtered message counts as accepted), AE when it failed. It never sends AR. With PASSTHROUGH it returns the response the pipeline produced, and falls back to the same ACK when there is none.

The destination waits for the partner's acknowledgement and reads MSA-1. AA or CA is SENT. Anything else is an ERROR with the code and MSA-3 text in the error message: a NAK (AE, AR, CE, CR), a missing MSA-1, an acknowledgement it cannot parse, an MSA-2 that names a different message control ID, or the connection closing before an acknowledgement arrives. An ERROR is retried only if the destination's queue is on.

### TCP_MLLP security

TLS is turned on by the presence of a `tls` object holding PEM text. The channel editor has no TLS control for this connector, and the server does not resolve certificate IDs for it, so the PEM goes into the properties through the API or a channel import.

On the source, any `tls` object turns TLS on, and it must hold both `tls.cert` and `tls.key`. A `tls` object missing either one, or an empty one, fails the deploy with an error that starts `TLS configuration is incomplete:`. A `tls` value that is not an object fails with `TLS configuration is invalid:`. The listener never falls back to plaintext. To run without TLS, remove `tls` or set it to `false`. After deploying a TLS listener, [Check TLS is on](../ops/tls-and-phi.md#check-tls-is-on) shows how to confirm it from another machine.

On the destination, any `tls` object turns TLS on, even an empty one, and the partner's certificate is verified against `tls.ca` or the Node trust store unless `tls.rejectUnauthorized` is false. A client `tls.cert` without its `tls.key`, or the reverse, fails the deploy.

### TCP_MLLP as a source

| Property | Required | Notes |
|---|---|---|
| `port` | Yes | Port to listen on, 1 to 65535. |
| `host` | No | Interface to bind. Defaults to `0.0.0.0`, every interface. |
| `maxConnections` | No | Most open connections at once. |
| `responseMode` | No | `AUTO_ACK` (default) or `PASSTHROUGH`. See what it does. |
| `charset` | No | `utf-8` (default), `latin1` (ISO-8859-1), `ascii` or `utf16le`, used to read and write frames. Case is ignored, and `utf8`, `ISO-8859-1`, `US-ASCII` and `UTF-16LE` are read as those. |
| `maxFrameBytes` | No | Most bytes buffered for one message before the connection is refused. |
| `frameStart` | No | Start bytes in hex, such as `02` for STX. API or Mirth import only. Invalid hex refuses to deploy. |
| `frameEnd` | No | End bytes in hex, such as `03` for ETX. API or Mirth import only. |
| `tls.cert` | No | Server certificate chain, PEM. API only. Required whenever `tls` is set; without it the deploy fails. |
| `tls.key` | No | Server private key, PEM. API only. Required whenever `tls` is set; without it the deploy fails. |
| `tls.ca` | No | CA bundle, PEM, used to verify client certificates. |
| `tls.requireClientCert` | No | `true` requires and verifies a client certificate (mutual TLS). |

### TCP_MLLP as a destination

| Property | Required | Notes |
|---|---|---|
| `host` | Yes | Partner host name or address. |
| `port` | Yes | Partner port. |
| `maxConnections` | No | Size of the connection pool. |
| `responseTimeout` | No | Milliseconds to wait for the acknowledgement before the send is an ERROR. |
| `acquireTimeoutMs` | No | Milliseconds to wait for a free pooled connection. |
| `charset` | No | As for the source: `utf-8` (default), `latin1`, `ascii` or `utf16le`, used to write the message and read the acknowledgement. |
| `frameStart` | No | Start bytes in hex. API or Mirth import only. |
| `frameEnd` | No | End bytes in hex. API or Mirth import only. |
| `tls.cert` | No | Client certificate, PEM, for mutual TLS. Any `tls` object turns TLS on. Needs `tls.key`. |
| `tls.key` | No | Client private key, PEM. Needs `tls.cert`. |
| `tls.ca` | No | CA bundle, PEM, used to verify the partner. The Node trust store when empty. |
| `tls.rejectUnauthorized` | No | Verification is on unless this is `false`. Set it false only for an audited exception. |

### TCP_MLLP limits

- No TLS control in the channel editor, and no certificate store support: TLS needs raw PEM in the properties.
- The source sends AA or AE only. There is no setting to send AR or a custom acknowledgement apart from PASSTHROUGH.

## HTTP

### HTTP: what it does

The source runs an HTTP or HTTPS server on its own port and accepts requests on one path and one method. A wrong method gets 405, a wrong path 404, failed authentication 401, a body over `maxBodyBytes` 413, and a Content-Type charset the server cannot decode 415. An accepted request answers `responseStatusCode` (a filtered message counts as accepted) and a pipeline failure answers `errorStatusCode`.

The destination sends each message as the request body. A 2xx response is SENT. A 3xx is an ERROR because redirects are not followed, and any other status is an ERROR with the status in the message.

### HTTP security

Set `scheme` to `HTTPS` and pick certificates from the certificate store. At deploy the server replaces the certificate IDs with PEM.

The source refuses to deploy when `scheme` is HTTPS and there is no `tls.serverCertId`, when that certificate has no private key, or when a referenced certificate does not exist. It cannot run plaintext by accident.

The destination verifies the server certificate against `tls.caCertId` or the Node trust store. With `scheme` HTTPS, a client certificate without a private key refuses to deploy. With no `scheme` and an `https://` URL, the request uses the Node trust store; to trust a private CA that way, set `NODE_EXTRA_CA_CERTS` for the server.

### HTTP as a source

| Property | Required | Notes |
|---|---|---|
| `port` | Yes | Port to listen on. |
| `host` | No | Interface to bind. Defaults to `0.0.0.0`. |
| `path` | No | Path to accept, `/` by default. Must start with `/`. |
| `matchSubpaths` | No | `true` also accepts any path below `path` (`/api` takes `/api/report`, not `/apix`). API or Mirth import only. |
| `method` | No | The one method accepted: `GET`, `POST` (default), `PUT`, `PATCH` or `DELETE`, in any case. |
| `responseContentType` | No | Content-Type of the reply. |
| `responseStatusCode` | No | Status for an accepted message, 100 to 599; `200` by default. |
| `errorStatusCode` | No | Status when the pipeline fails, 100 to 599; `500` by default. |
| `maxBodyBytes` | No | Largest request body; a larger one gets 413. |
| `auth.type` | No | `BASIC` or `TOKEN`. With no `auth` object, anyone who can reach the port can post. API only. |
| `auth.username` | No | Expected Basic username. |
| `auth.password` | No | Expected Basic password. |
| `auth.token` | No | Expected bearer token, compared with `Authorization: Bearer <token>`. |
| `scheme` | No | `HTTP` or `HTTPS`. HTTPS needs `tls.serverCertId`. |
| `tls.serverCertId` | No | Certificate store entry with a private key. Required when `scheme` is HTTPS. |
| `tls.caCertId` | No | CA used to verify client certificates. |
| `tls.requireClientCert` | No | `true` requires a client certificate (mutual TLS). |

### HTTP as a destination

| Property | Required | Notes |
|---|---|---|
| `url` | Yes | Target URL. May use `${name}` message variables. |
| `method` | No | `GET`, `POST` (default), `PUT`, `PATCH` or `DELETE`, in any case. |
| `headers` | No | Name and value pairs; values may use `${name}`. Text saved by older editors is read as `Name: value` lines. |
| `parameters` | No | Query parameters added to the URL; values may use `${name}`. API or Mirth import only. |
| `basicAuth` | No | Object with `username` and `password`; sent only when the username is set. API or Mirth import only. |
| `contentType` | No | Content-Type of the request body. |
| `responseTimeout` | No | Milliseconds before the send is an ERROR, at least 1; `30000` by default. |
| `scheme` | No | `HTTPS` always uses TLS with the certificates below, whatever the URL says. |
| `tls.caCertId` | No | CA used to verify the server. The Node trust store when empty. |
| `tls.clientCertId` | No | Client certificate with a private key, for mutual TLS. |
| `tls.rejectUnauthorized` | No | Verification is on unless this is `false`. |

### HTTP limits

- Redirects are not followed; set the final URL.
- The source's `auth`, `matchSubpaths`, and the destination's `parameters` and `basicAuth` have no editor control.
- The source accepts one method per connector.

## FILE

### FILE: what it does

The source polls a local directory for files that match a glob, reads each one as a message, and then deletes, moves or leaves it. The destination writes each message to a file in a local directory.

Only paths the server process can open are reachable: the local disk and anything the operating system has mounted. There is no FTP, SMB, S3 or WebDAV. For SFTP use the [SFTP](#sftp) connector.

### FILE security

The connector adds no transport security. A network share must be protected where it is mounted, and the server process's file permissions decide what it can read and write. A destination writes through a temporary file and renames it by default, so a partner never reads half a file.

### FILE as a source

| Property | Required | Notes |
|---|---|---|
| `directory` | Yes | Directory to poll. |
| `fileFilter` | No | Glob for the files to read, `*` by default. |
| `pollingIntervalMs` | No | Milliseconds between polls. |
| `sortBy` | No | `NAME`, `DATE` or `SIZE`: the order files are read in. |
| `charset` | No | Character set to decode the file. One Node cannot decode refuses to deploy. |
| `binary` | No | `true` reads the file as base64 instead of text. |
| `checkFileAge` | No | On by default: skip files younger than `fileAgeMs`, so a file still being written is not read. |
| `fileAgeMs` | No | Minimum file age in milliseconds. |
| `postAction` | No | `DELETE` (default), `MOVE` or `NONE`. The default deletes each file after the pipeline accepts it. |
| `moveToDirectory` | No | Where `MOVE` puts processed files. |

### FILE as a destination

| Property | Required | Notes |
|---|---|---|
| `directory` | Yes | Directory to write to; created if missing. |
| `outputPattern` | No | File name. Only `${messageId}` and `${timestamp}` are filled; any other placeholder refuses to deploy. Without `${messageId}` and with append off, each message overwrites the last file of that name (a warning is logged). |
| `charset` | No | Character set to encode the file. |
| `binary` | No | `true` decodes the content from base64 and writes the bytes. |
| `tempFileEnabled` | No | On by default: write a temporary file, then rename it. |
| `appendMode` | No | `true` appends to the file instead of replacing it. |

### FILE limits

- Local paths and OS mounts only. FTP, SMB, S3 and WebDAV are not supported; the Mirth importer warns that such a channel will not deploy.
- No `${originalFilename}` in `outputPattern`: the destination does not receive the source file name (D-219 in [DECISIONS.md](../progress/DECISIONS.md)).

## SFTP

### SFTP: what it does

The source polls a directory on an SFTP server for files that match a glob, downloads each one as a message in name order, and then deletes, moves or leaves it. The source map holds `originalFilename`, `remoteDirectory`, `fileSize` and `lastModified`.

A file the channel stored with an ERROR status, or whose delete or move failed after it was sent, is left in place and not read again. The list of those files is kept in `.galvaniflow-quarantine.json` in the remote directory, so it survives a restart, and that file is never read as a message. The list records each file by name and modification time, so a file uploaded again with a new modification time is read.

The destination uploads each message as a file, encoded as UTF-8. Each send opens its own connection, creates `remoteDirectory` if it is missing, writes the file and disconnects. A send that takes over 30 seconds is an ERROR. The response is the remote path written.

A Mirth File Reader or File Writer with the sftp scheme imports as this connector.

### SFTP security

The connection is SSH. Host key checking is on by default: the connector accepts the server only if its key matches `hostKey`, so a channel with `strictHostKey` on and `hostKey` empty refuses to deploy.

`hostKey` is the base64 public key blob, not a `SHA256:` fingerprint. Get it with `ssh-keyscan -t ed25519 sftp.example.org` and copy the third field of the output line (the text after `ssh-ed25519`, starting `AAAA`). Do not paste the whole line or the key type. Use the key type the server presents; for an RSA-only server use `-t rsa`. Check the value against the server's own `/etc/ssh/ssh_host_ed25519_key.pub` over a trusted path, because `ssh-keyscan` itself trusts the network.

Setting `strictHostKey` to false turns the check off and lets anyone who can intercept the connection receive the files. Don't do that for PHI.

### SFTP as a source

| Property | Required | Notes |
|---|---|---|
| `host` | Yes | SFTP server. |
| `port` | No | SSH port, 22 by default, 1 to 65535. |
| `username` | Yes | Login name. |
| `password` | No | Password. Set `password`, `privateKey` or both; with neither the deploy fails. |
| `privateKey` | No | Private key, PEM or OpenSSH text. |
| `passphrase` | No | Passphrase for an encrypted `privateKey`. |
| `remoteDirectory` | Yes | Remote directory to poll. |
| `filePattern` | No | Glob for the files to read, `*` by default. |
| `pollingIntervalMs` | No | Milliseconds between polls, at least 100. |
| `afterProcessing` | No | `DELETE` (default), `MOVE` or `NONE`. The default deletes the remote file after the pipeline accepts it. |
| `moveToDirectory` | No | Remote directory for `MOVE`, created if missing. Required when `afterProcessing` is `MOVE`. |
| `minFileAgeMs` | No | Skip files younger than this, so a file still being uploaded is not read. |
| `strictHostKey` | No | On by default. See security. |
| `hostKey` | Yes | Server's base64 public key. Deploy requires it while `strictHostKey` is on; only `strictHostKey` false lets it be empty. |
| `charset` | No | Character set to decode the file. One Node cannot decode refuses to deploy. |

### SFTP as a destination

| Property | Required | Notes |
|---|---|---|
| `host` | Yes | SFTP server. |
| `port` | No | SSH port, 22 by default, 1 to 65535. |
| `username` | Yes | Login name. |
| `password` | No | Password. Set `password`, `privateKey` or both; with neither the deploy fails. |
| `privateKey` | No | Private key, PEM or OpenSSH text. |
| `passphrase` | No | Passphrase for an encrypted `privateKey`. |
| `remoteDirectory` | Yes | Remote directory to write to; created if missing. |
| `fileNameTemplate` | No | File name. Only `${messageId}` and `${timestamp}` are filled; any other placeholder refuses to deploy. |
| `appendMode` | No | `true` appends to the remote file instead of replacing it. |
| `strictHostKey` | No | On by default. See security. |
| `hostKey` | Yes | Server's base64 public key. Deploy requires it while `strictHostKey` is on; only `strictHostKey` false lets it be empty. |

### SFTP limits

- No `${originalFilename}` in `fileNameTemplate` (D-219 in [DECISIONS.md](../progress/DECISIONS.md)).
- The destination writes UTF-8 text only; it has no `charset` or binary setting.

## DATABASE

### DATABASE: what it does

The source runs `selectQuery` on each poll and sends every row as a JSON message, at most 1,000 rows per poll; it can then run `updateQuery` to mark rows as read. The destination runs `query` once per message. `${name}` parameters in a query are sent as bound parameters, never pasted into the SQL.

It talks to PostgreSQL and to MySQL or MariaDB, picked with `vendor` (D-259 in [DECISIONS.md](../progress/DECISIONS.md)). Any other vendor, such as SQL Server or Oracle, refuses to deploy.

### DATABASE security

Set `tls` to true to connect over TLS. The database server's certificate is then verified against the Node trust store, and an untrusted one fails the connection. With `tls` off the connection, and the PHI in it, is plaintext.

### DATABASE as a source

| Property | Required | Notes |
|---|---|---|
| `vendor` | No | `postgresql` (default) or `mysql`. MariaDB uses `mysql`. Any other value refuses to deploy. |
| `host` | Yes | Database server. |
| `port` | Yes | Deploy checks it is a number; the editor fills 5432 or 3306 for the vendor. |
| `database` | Yes | Database name. |
| `username` | No | Database user. Deploy does not check it. Left empty, PostgreSQL connects as the `PGUSER` environment variable or the server process's operating system user, and MySQL connects with no user name. Set it. |
| `password` | No | Password, if the database asks for one. |
| `selectQuery` | Yes | Query that returns the rows to send. |
| `updateQuery` | No | Statement run after rows are sent, such as marking them processed. |
| `updateMode` | No | `NEVER` (default), `ALWAYS` or `ON_SUCCESS`: when `updateQuery` runs. With `NEVER`, the next poll returns the same rows again unless `selectQuery` excludes them. |
| `pollingIntervalMs` | No | Milliseconds between polls. |
| `rowFormat` | No | `JSON`, the only format. |
| `tls` | No | `true` connects over TLS with certificate verification. |

### DATABASE as a destination

| Property | Required | Notes |
|---|---|---|
| `vendor` | No | `postgresql` (default) or `mysql`. MariaDB uses `mysql`. |
| `host` | Yes | Database server. |
| `port` | Yes | Deploy checks it is a number; the editor fills the vendor's port. |
| `database` | Yes | Database name. |
| `username` | No | Database user. Deploy does not check it; left empty, the drivers fall back as for the source. Set it. |
| `password` | No | Password, if the database asks for one. |
| `query` | Yes | Statement run for each message. |
| `useTransaction` | No | `true` runs the statement in a transaction. |
| `returnGeneratedKeys` | No | `true` makes the response a JSON array instead of the affected row count. On PostgreSQL it holds the rows the statement returns, which is `[]` unless the query has a `RETURNING` clause (such as `RETURNING id`). On MySQL a write gives `[{"insertId": <n>}]` with the first generated id, or `[]` when no id was generated; a `SELECT` gives its rows. |
| `tls` | No | `true` connects over TLS with certificate verification. |

### DATABASE limits

- PostgreSQL and MySQL/MariaDB only. A Mirth channel on SQL Server or Oracle imports with a warning but refuses to deploy.
- One poll sends at most 1,000 rows; the rest wait for the next poll.
- The only row format is JSON.

## JAVASCRIPT

### JAVASCRIPT: what it does

The source runs a script on a timer and sends each value it returns as a message: a string is one message, an array of strings is one message each, and an empty string, null or undefined sends nothing. The destination runs a script with the message in scope, and the script's return value becomes the response.

Both run in the engine's script sandbox, with the same bridges as transformers. See [scripting-api.md](./scripting-api.md).

### JAVASCRIPT security

The script runs inside the server. Whatever it reaches through the script bridges uses the security of that bridge, such as an HTTPS URL for `httpFetch`. The sandbox limits what a script can do, but it is not a security boundary against a hostile author: only give script access to people you would trust with the server.

### JAVASCRIPT as a source

| Property | Required | Notes |
|---|---|---|
| `script` | Yes | Script whose return value is sent. An empty script refuses to deploy. |
| `pollingIntervalMs` | No | Milliseconds between runs. |

### JAVASCRIPT as a destination

| Property | Required | Notes |
|---|---|---|
| `script` | Yes | Script run for each message. An empty script refuses to deploy. |

### JAVASCRIPT limits

- No Rhino, E4X or Java API emulation: Mirth scripts that call Java classes need rewriting.

## CHANNEL

### CHANNEL: what it does

A CHANNEL destination hands the message to another GalvaniFlow channel's CHANNEL source in memory, on the same server, without a network hop. With `waitForResponse` on, the destination's response is the target channel's response; otherwise it is `messageId=<n>` for the message the target created.

The send is an ERROR when the target is not deployed, when the target stores the message with an ERROR status, or when a message has passed through 10 channel hops, which stops a routing loop.

### CHANNEL security

No network is involved, so there is nothing to encrypt. The message stays inside the server process.

### CHANNEL as a source

| Property | Required | Notes |
|---|---|---|
| `channelId` | No | Set for you at deploy to this channel's own ID, which is what a CHANNEL destination puts in `targetChannelId`. Any stored value is replaced, and the editor has no field for it. |

### CHANNEL as a destination

| Property | Required | Notes |
|---|---|---|
| `targetChannelId` | Yes | The target channel's ID. May be a `${name}` reference filled per message, so a router can pick the channel; a variable the message lacks is an ERROR. |
| `waitForResponse` | No | `true` returns the target channel's response instead of its message ID. |

### CHANNEL limits

- Same server only; there is no channel routing between servers.
- At most 10 chained channel hops per message.

## DICOM

### DICOM: what it does

The source is a DICOM storage SCP. It accepts C-STORE associations, writes each instance to `storageDir` as `<SOPInstanceUID>.dcm`, and sends a message whose content is the file path, with the dataset's attributes and the AE titles in the source map. In `PER_ASSOCIATION` mode it sends one message per association whose content is a JSON list of file paths.

The destination is a storage SCU. The message content must be the path of a DICOM file on the server, which it sends with C-STORE.

### DICOM security

DICOM traffic is not encrypted: neither direction supports TLS. The source accepts every association whatever the calling and called AE titles, so anyone who can reach the port can store files. Keep DICOM on a trusted network or a VPN.

### DICOM as a source

| Property | Required | Notes |
|---|---|---|
| `port` | Yes | Port to listen on. |
| `storageDir` | Yes | Directory received files are written to. |
| `aeTitle` | No | This listener's AE title. Not checked against incoming associations. |
| `minPoolSize` | No | Checked at deploy (at least 1) but not used by the current listener. |
| `maxPoolSize` | No | Checked at deploy (not below `minPoolSize`) but not used by the current listener. |
| `connectionTimeoutMs` | No | Connect, association and PDU timeout in milliseconds. |
| `dispatchMode` | No | `PER_FILE` (default) or `PER_ASSOCIATION`. |
| `postAction` | No | `DELETE` (default), `MOVE` or `NONE`. The message holds only the file path, and the default deletes the file once the pipeline accepts it, so a queued destination or a later reprocess has no file to read. Use `MOVE` or `NONE` if anything reads the file afterwards. |
| `moveToDirectory` | No | Where `MOVE` puts files. Required when `postAction` is `MOVE`. |

### DICOM as a destination

| Property | Required | Notes |
|---|---|---|
| `host` | Yes | Remote SCP host. |
| `port` | Yes | Remote SCP port. |
| `calledAETitle` | No | The remote AE title, `PACS` by default. |
| `callingAETitle` | No | This sender's AE title. |
| `mode` | No | `single` or `multiple`. Read but not used by the current sender. |
| `maxAssociations` | No | Read but not used by the current sender. |
| `maxRetries` | No | Retries of a failed send. |
| `retryDelayMs` | No | Milliseconds between retries. |
| `timeoutMs` | No | Milliseconds before the send fails. |

### DICOM limits

- No TLS in either direction, and no AE title filtering on the listener.
- The destination sends whatever readable local file the message content names; nothing limits it to the receiver's storage directory.
- `mode` and `maxAssociations` on the destination, and `minPoolSize` and `maxPoolSize` on the source, have no effect.

## EMAIL

### EMAIL: what it does

EMAIL can only receive; it cannot send messages. Use [SMTP](#smtp) to send email.

It polls an IMAP mailbox folder for unread messages and sends each message body, with subject, from, to, date and the attachment count in the source map. Afterwards it marks the email read, deletes it or moves it.

### EMAIL security

`secure` is on by default and connects with IMAP over TLS (port 993). Turning it off sends the mailbox password and the PHI in plaintext.

### EMAIL as a source

| Property | Required | Notes |
|---|---|---|
| `host` | Yes | IMAP server. |
| `port` | Yes | IMAP port. |
| `secure` | No | On by default: IMAP over TLS. |
| `username` | Yes | Mailbox user. |
| `password` | Yes | Mailbox password. |
| `protocol` | No | `IMAP`. `POP3` refuses to deploy. |
| `folder` | No | Folder to read, `INBOX` by default. |
| `pollingIntervalMs` | No | Milliseconds between polls. |
| `postAction` | No | `MARK_READ` (default), `DELETE` or `MOVE`. |
| `moveToFolder` | No | Folder for `MOVE`. |
| `subjectFilter` | No | Only read emails whose subject contains this text, ignoring case. |
| `includeAttachments` | No | Read but not used: attachments are never read, whatever this says. |

### EMAIL limits

- IMAP only; POP3 is refused at deploy.
- Attachments are not read; the message is the email body. `includeAttachments` has no effect.
- No OAuth sign-in; the mailbox needs a username and password.

## SMTP

### SMTP: what it does

SMTP can only send; it cannot receive messages. Use [EMAIL](#email) to read a mailbox.

It sends one email per message. The subject, body and attachment fields may use `${msg}` (the message content), `${messageId}`, `${channelId}`, `${metaDataId}` and other `${name}` message variables.

### SMTP security

`secure` connects with implicit TLS, usually on port 465. `requireTLS` makes the connection upgrade with STARTTLS, usually on port 587, and fails if the server cannot. Both are off by default, and with both off the email can travel in plaintext if the server offers no encryption. For PHI, turn one of them on.

### SMTP as a destination

| Property | Required | Notes |
|---|---|---|
| `host` | Yes | SMTP server. |
| `port` | Yes | SMTP port. |
| `secure` | No | `true` for implicit TLS. Off by default. |
| `requireTLS` | No | `true` to require STARTTLS. Off by default. |
| `authUser` | No | Username; with none set, the server is used as an anonymous relay. |
| `authPass` | No | Password for `authUser`. |
| `from` | No | Sender address. |
| `to` | Yes | Recipients. |
| `cc` | No | Copy recipients. |
| `bcc` | No | Blind copy recipients. |
| `subject` | No | Subject; may use `${name}` variables. |
| `bodyTemplate` | No | Body, `${msg}` by default. |
| `contentType` | No | `text/plain` or `text/html`. |
| `attachContent` | No | `true` also attaches the message content as a file. |
| `attachments` | No | List of `filename`, `content` and optional `mimeType`; filename and content may use variables. Entries without a filename or content are skipped. |

### SMTP limits

- Sending only.
- No OAuth sign-in; authentication is a username and password.

## FHIR

### FHIR: what it does

FHIR can only send; it cannot receive messages. There is no FHIR source.

It posts the message content as-is to a FHIR R4 server: POST to `<baseUrl>/<resourceType>`, or PUT to `<baseUrl>/<resourceType>/<id>` with the id read from the resource. The message must already be a FHIR resource in the configured format. An HL7 v2 message sent here is posted unchanged and the server rejects it; write a transformer that builds the resource first. A 2xx response is SENT, anything else an ERROR.

Unlike the HTTP destination, FHIR follows redirects. A 301, 302 or 303 turns the POST into a GET with no body, so a 200 from that GET is recorded as SENT although nothing was created ([#163](https://github.com/MichaelLeeHobbs/mirthless/issues/163)). Point `baseUrl` at the server's final address, not one that redirects.

### FHIR security

An `https://` base URL uses TLS with the Node trust store. There is no certificate store or client certificate support; to trust a private CA, set `NODE_EXTRA_CA_CERTS` for the server. An `http://` base URL sends PHI in plaintext.

### FHIR as a destination

| Property | Required | Notes |
|---|---|---|
| `baseUrl` | Yes | FHIR server base URL. Use the final address: redirects are followed (see what it does). |
| `resourceType` | No | Resource type in the URL. Defaults to `Patient`, so set it for any other resource. |
| `method` | No | `POST` (create) or `PUT` (update). `PUT` needs an `id` in the resource, and an id outside the FHIR id rules is refused. |
| `authType` | No | `NONE`, `BASIC`, `BEARER` or `API_KEY`. |
| `authUsername` | No | Basic username. |
| `authPassword` | No | Basic password. |
| `authToken` | No | Bearer token. |
| `authHeaderName` | No | Header that carries the API key. |
| `authApiKey` | No | API key value. |
| `format` | No | `json` or `xml`. |
| `timeout` | No | Milliseconds before the send is an ERROR. |
| `headers` | No | Extra request headers. |

### FHIR limits

- No FHIR source connector.
- No HL7 v2 to FHIR mapping; the message must already be a FHIR resource.
- No client certificate (mutual TLS) support.
- Redirects are followed, and a redirected POST can be recorded as SENT with nothing created ([#163](https://github.com/MichaelLeeHobbs/mirthless/issues/163)).

## KAFKA

### KAFKA: what it does

The source joins a consumer group on a topic and sends each record as a message. The source map holds `topic`, `partition`, `offset`, `key`, `headers` and `timestamp`, and `charsetError` when a UTF-8 value had invalid bytes. The destination writes each message to a topic as UTF-8.

A record the pipeline fails to store is not committed and is read again. After `maxStoreAttempts` failures in a row on the same record, the source stops the channel, records an ERROR `CHANNEL_STOPPED` event and fires a `SOURCE_CONNECTOR` alert. The record stays uncommitted: fix the cause and start the channel, and it reads that record first.

Delivery is at least once: a record's offset is committed only after the pipeline has stored it, so a crash between storing and committing delivers that record twice, which you can recognise by the same `topic`, `partition` and `offset` in the source map (D-266 in [DECISIONS.md](../progress/DECISIONS.md)). The destination reports SENT only when every in-sync replica has the record (acks=all). Topics are the broker administrator's; the connector checks they exist and never creates them.

### KAFKA security

Set `useTls` to connect over TLS. The broker's certificate is verified against `tls.caCertId` or the system trust store, and `tls.clientCertId` adds a client certificate. At deploy the server replaces the IDs with PEM and refuses to deploy if one is missing or a client certificate has no private key. SASL sends its password inside that connection, so use SASL with `useTls`.

### KAFKA as a source

| Property | Required | Notes |
|---|---|---|
| `brokers` | Yes | `host:port` pairs, comma separated. |
| `clientId` | No | Client ID sent to the broker. |
| `useTls` | No | `true` connects over TLS. |
| `tls.caCertId` | No | CA that verifies the broker; the system trust store when empty. |
| `tls.clientCertId` | No | Client certificate with a private key, for mutual TLS. |
| `tls.rejectUnauthorized` | No | Verification is on unless this is `false`. |
| `saslMechanism` | No | `NONE`, `PLAIN`, `SCRAM-SHA-256` or `SCRAM-SHA-512`. Anything but `NONE` needs `saslUsername`. |
| `saslUsername` | No | SASL user. |
| `saslPassword` | No | SASL password. |
| `topic` | Yes | Topic to read. |
| `groupId` | Yes | Consumer group. |
| `startFrom` | No | `EARLIEST` (default) or `LATEST`: where a group with no committed offset starts. The default reads the whole topic the first time a new group connects. |
| `charset` | No | How the record value becomes message text: `utf-8` (default), `latin1` (ISO-8859-1), `windows-1252`, or `base64` to keep a binary payload intact. In `utf-8` mode invalid bytes are replaced with U+FFFD, the message is flagged with `charsetError` in the source map, and a warning is logged. `windows-1252` needs a Node with full ICU (the official builds have it); without it the deploy fails. The key and header values are always read as UTF-8. |
| `maxStoreAttempts` | No | Failures in a row to store the same record before the source stops the channel, 1 to 1000, 5 by default. A record that cannot be converted counts as a failure. |

### KAFKA as a destination

| Property | Required | Notes |
|---|---|---|
| `brokers` | Yes | `host:port` pairs, comma separated. |
| `clientId` | No | Client ID sent to the broker. |
| `useTls` | No | `true` connects over TLS. |
| `tls.caCertId` | No | CA that verifies the broker. |
| `tls.clientCertId` | No | Client certificate with a private key. |
| `tls.rejectUnauthorized` | No | Verification is on unless this is `false`. |
| `saslMechanism` | No | `NONE`, `PLAIN`, `SCRAM-SHA-256` or `SCRAM-SHA-512`. |
| `saslUsername` | No | SASL user. |
| `saslPassword` | No | SASL password. |
| `topic` | Yes | Topic per message; may use `${name}`. A variable the message lacks is an error. |
| `messageKey` | No | Record key per message; may use `${name}`. Empty sends no key. |
| `headers` | No | Record headers; values may use `${name}`. |

### KAFKA limits

- The destination writes the value, key and headers as UTF-8 only; it has no `charset` setting.
- The source reads keys and header values as UTF-8 whatever `charset` says.
- TLS and the `maxStoreAttempts` stop have not been tested against a real Kafka broker ([#151](https://github.com/MichaelLeeHobbs/mirthless/issues/151)).

## AMQP

### AMQP: what it does

The source consumes an existing queue on an AMQP 0-9-1 broker such as RabbitMQ and sends each delivery as a message. The source map holds `queue`, `exchange`, `routingKey`, `redelivered` and `headers`, `messageId` and `contentType` when the message has them, and `charsetError` when a UTF-8 body had invalid bytes. The destination publishes each message to an existing exchange as a persistent message, encoded as UTF-8.

A message the pipeline fails to store goes back to the queue. After `maxStoreAttempts` failures to store the same message, the source stops the channel, records an ERROR `CHANNEL_STOPPED` event and fires a `SOURCE_CONNECTOR` alert. The message is neither acked nor dead-lettered; it stays on the queue for when the channel is started again. Failures are counted per AMQP `messageId`. A message without one is counted as failures in a row, which assumes it comes straight back before the messages behind it: true for a classic queue with prefetch 1, not promised by a quorum queue, so set a `messageId` on messages sent to a quorum queue.

The broker's `x-delivery-count` is not used, because RabbitMQ 4.x does not raise it for the requeue this source returns a message with. RabbitMQ does raise it when a connection closes with the message unacknowledged, which happens each time this cap stops the channel. A quorum queue drops the message, or dead-letters it if it has a dead-letter exchange, once that count passes its delivery limit (20 by default from RabbitMQ 4.0). On RabbitMQ 3.x a requeue counts too, so keep `maxStoreAttempts` below the queue's delivery limit, or the broker removes the message first.

Delivery is at least once: a message is acked only after the pipeline has stored it, so a crash or lost connection between storing and acking delivers it again with `redelivered: true` in the source map, and the destination sends a stable `messageId` (`channelId:messageId:metaDataId`) that partners can deduplicate on (D-266 in [DECISIONS.md](../progress/DECISIONS.md)). The destination reports SENT only when the broker confirms the message, and a message no queue would receive is an ERROR rather than a silent drop. A message stored with an ERROR status is rejected without requeue, which sends it to the queue's dead-letter exchange if one is set. The connector never declares queues or exchanges.

### AMQP security

Set `useTls` to connect with AMQPS. The broker's certificate is verified against `tls.caCertId` or the system trust store, and `tls.clientCertId` adds a client certificate. At deploy the server replaces the IDs with PEM and refuses to deploy if one is missing or a client certificate has no private key. Without `useTls` the broker password and the PHI travel in plaintext. Turning on `useTls` does not change the port, which defaults to 5672; AMQPS brokers usually listen on 5671, so set `port` too.

### AMQP as a source

| Property | Required | Notes |
|---|---|---|
| `host` | Yes | Broker host. |
| `port` | No | Broker port. |
| `vhost` | No | Virtual host, `/` by default. |
| `username` | No | Broker user. |
| `password` | No | Broker password. |
| `useTls` | No | `true` connects with AMQPS. |
| `tls.caCertId` | No | CA that verifies the broker; the system trust store when empty. |
| `tls.clientCertId` | No | Client certificate with a private key, for mutual TLS. |
| `tls.rejectUnauthorized` | No | Verification is on unless this is `false`. |
| `queue` | Yes | Existing queue to consume. |
| `charset` | No | How the body becomes message text: `utf-8` (default), `latin1`, `windows-1252` or `base64`, as for the Kafka source. A message that cannot be converted goes back to the queue and counts toward `maxStoreAttempts`. |
| `maxStoreAttempts` | No | Failures to store the same message before the source stops the channel, 1 to 1000, 5 by default. See what it does. |

### AMQP as a destination

| Property | Required | Notes |
|---|---|---|
| `host` | Yes | Broker host. |
| `port` | No | Broker port. |
| `vhost` | No | Virtual host. |
| `username` | No | Broker user. |
| `password` | No | Broker password. |
| `useTls` | No | `true` connects with AMQPS. |
| `tls.caCertId` | No | CA that verifies the broker. |
| `tls.clientCertId` | No | Client certificate with a private key. |
| `tls.rejectUnauthorized` | No | Verification is on unless this is `false`. |
| `exchange` | No | Existing exchange. Empty is the default exchange, where the routing key is the queue name. |
| `routingKey` | No | Routing key per message; may use `${name}`. With the default exchange, set it to the target queue's name, or every send is an ERROR. |
| `headers` | No | Message headers; values may use `${name}`. |
| `contentType` | No | Content type property of the message. |

### AMQP limits

- The destination writes the body as UTF-8 only; it has no `charset` setting.
- On a quorum queue, a message without a `messageId` may not be counted correctly toward `maxStoreAttempts`.
- AMQP 0-9-1 only; no AMQP 1.0 brokers.
