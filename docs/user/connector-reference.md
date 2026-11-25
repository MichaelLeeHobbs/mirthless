# Connector reference

A connector is the part of a channel that talks to the outside world. A source connector receives messages into a channel; a destination connector sends them out.

Every property below is the key the connector reads from the channel's saved properties. Where the channel editor has no control for a key, the notes say so: set it through the REST API or in a channel export you import.

## Connectors at a glance

| Connector | Source | Destination | Covers | Transport security | Auth | Mirth equivalent |
|---|---|---|---|---|---|---|
| [TCP_MLLP](#tcp_mllp) | Yes | Yes | HL7 v2 (or other text) over TCP with MLLP or custom frame bytes | Optional TLS from raw PEM in a `tls` block, set through the API or an import (no editor control). A source `tls` block missing its cert or key fails the deploy; the check in [tls-and-phi.md](../ops/tls-and-phi.md#check-tls-is-on) confirms a listener speaks TLS | Mutual TLS only; no other sign-in | TCP Listener / TCP Sender |
| [HTTP](#http) | Yes | Yes | HTTP and HTTPS requests in either direction | `scheme` HTTPS with certificates from the certificate store. An HTTPS source with no server certificate refuses to deploy. A destination verifies the server certificate by default | Source: Basic or bearer token (API only), client certificates. Destination: Basic, custom headers, client certificate | HTTP Listener / HTTP Sender |
| [FILE](#file) | Yes | Yes | Local disk and OS mounts only. No SMB, S3, FTP or WebDAV | None in the connector; protect the mount | Only directories under `FILE_CONNECTOR_ROOTS`, never the server's own; then the server process's file permissions | File Reader / File Writer |
| [SFTP](#sftp) | Yes | Yes | Files on a remote SFTP server | SSH, with host key checking on by default; an empty `hostKey` refuses to deploy while it is on | Password or private key | File Reader / File Writer with the sftp scheme, imported automatically by the Mirth importer |
| [DATABASE](#database) | Yes | Yes | PostgreSQL and MySQL/MariaDB only. No SQL Server or Oracle | `tls` flag; when on, the server certificate is verified | Database username and password | Database Reader / Database Writer |
| [JAVASCRIPT](#javascript) | Yes | Yes | Whatever a sandboxed script can produce or reach through the script bridges | Not applicable (runs in the server) | Not applicable | JavaScript Reader / JavaScript Writer |
| [CHANNEL](#channel) | Yes | Yes | Another GalvaniGraph channel on the same server | Not applicable (in memory) | Not applicable | Channel Reader / Channel Writer |
| [DICOM](#dicom) | Yes | Yes | DICOM C-STORE in and out | No TLS | None. The listener accepts any calling and called AE title. Files only under `FILE_CONNECTOR_ROOTS` | DICOM Listener / DICOM Sender |
| [EMAIL](#email) | Yes | No | Reading an IMAP mailbox. POP3 refuses to deploy | `secure` (IMAP over TLS), on by default | Mailbox username and password | none (Mirth Connect has no email reader connector) |
| [SMTP](#smtp) | No | Yes | Sending email only | `secure` (implicit TLS) and `requireTLS` (STARTTLS required); both off by default | Optional username and password | SMTP Sender |
| [FHIR](#fhir) | No | Yes | Posting a message that is already a FHIR R4 resource. No HL7 v2 to FHIR mapping | HTTPS when `baseUrl` is https, with the Node trust store | None, Basic, bearer token or API key header | FHIR Sender (commercial extension in Mirth) |
| [KAFKA](#kafka) | Yes | Yes | Kafka topics | `useTls` with a CA and client certificate from the certificate store | SASL PLAIN, SCRAM-SHA-256 or SCRAM-SHA-512, or client certificate | none |
| [AMQP](#amqp) | Yes | Yes | AMQP 0-9-1 brokers such as RabbitMQ | `useTls` with a CA and client certificate from the certificate store | Broker username and password, or client certificate | none |

Each type's property schemas are in `packages/core-models/src/schemas/<type>-connector.schema.ts` (Kafka and AMQP share `queue-connector.schema.ts`; their delivery guarantees are in D-266).

A connector's properties are checked when the channel deploys. Every type rejects a key its table below does not list, or a value of the wrong type, so a misspelled key fails the deploy instead of being ignored. The exceptions are keys this app's own editor or Mirth importer once saved and nothing reads, which are dropped, and old value spellings, which are mapped; `docs/ops/upgrade.md` lists them per type. A test (`packages/core-models/src/schemas/__tests__/connector-reference-docs.test.ts`) fails when a table and its schema list different keys.

### Test Connection

**Test Connection** checks the settings in the form as a deploy checks them, with the references to the configuration map filled, and answers with the deploy's reason when a deploy would refuse them (D-380). So the rest of the form has to be filled in before a connection can be tested. Scripts are not compiled. It then connects, gives up after 10 seconds, and sends no message:

| Connector | What is tested |
|---|---|
| TCP_MLLP and DICOM destinations, EMAIL | A TCP connection. No TLS and no sign-in. |
| HTTP destination | A `HEAD` request. With `scheme` HTTPS it uses the certificates from the store. Any answer passes, an error status too; a redirect does not. |
| HTTP source with `scheme` HTTPS | A TLS handshake on the server itself, with the certificate and its key. |
| Other HTTP sources, TCP_MLLP and DICOM sources | The settings only. A listener connects to nothing: its port is opened when the channel starts. |
| FILE | That the server can read the directory, and for a destination write to it. A directory that a destination would create has to be there. |
| SFTP | Sign-in, and that the remote directory is there. A destination creates one that is not. |
| DATABASE, SMTP | Sign-in. |
| FHIR | `GET <baseUrl>/metadata`, without the credentials. |
| KAFKA, AMQP | Sign-in, and that the topic, queue or exchange is there. A topic that holds `${...}` is not checked. |
| JAVASCRIPT, CHANNEL | The settings only. |

A `${...}` that names no entry of the configuration map is left as it is, as at a deploy, so an HTTP URL whose server is filled per message cannot be tested. Loopback, link-local and other reserved addresses are refused, which a deployed channel may reach (D-262).

To have references filled you need `config_map:read`, or `channels:write` on the channel the test is for, because the form says which server gets the values. Without it, settings that hold a reference to the map are refused (403). Which entries were filled is recorded in the audit log, best effort (`CONFIG_MAP_READ`).

## Keys on every connector

### Every source

| Property | Required | Notes |
|---|---|---|
| `processBatch` | No | Off by default. Split an inbound HL7 batch into one message per `MSH` segment, processed in order. A message recorded with an error does not stop the ones after it, and the batch is an error to the source. A message that could not be recorded at all (the database is down) ends the batch, and the source treats it as it treats a message that was not recorded: a polling source reads it again, Kafka and AMQP up to `maxStoreAttempts` times, and MLLP and HTTP answer an error. Offered again, the messages before that one are processed and sent again; a sender that does not offer it again has the rest of the batch to send. A JavaScript source, which never offers a batch again, goes on with the next message. A batch in which a message holds U+0000 is not taken at all by a channel that stores raw content without encryption, because it could never be recorded (a JavaScript source loses only that message). The log says which messages were not recorded, and an alert is raised. The Mirth importer sets it; the editor has no field for it. |

### Every destination

| Property | Required | Notes |
|---|---|---|
| `template` | No | What to send instead of the encoded message; `${...}` values are filled per message. The Mirth importer sets it from a sender's template; the editor has no field for it. |

When the server stops while a destination is sending, the next start sends the message to it again, so the partner can get it twice. A send that then fails goes to the destination's queue if it has one, as any failed send does. The message's variables (what scripts put in the connector, channel and response maps) are kept only for a destination whose queue is on. A destination whose queue is off is not sent the message again when its settings use variables, because it would get other data; it ends in ERROR with the reason, and an alert. That is a `${name}` in a URL, parameter, header, topic, key, routing key, email field or target channel, a `${name}` in a database query that the message's own JSON does not hold, or a JavaScript script that names `channelMap`, `$`, `$c`, `connectorMessage` or `globalThis`, itself or in a code template linked to the channel. A `${name}` in `template` does not count: the filled text is stored. To have such a message sent again, turn the destination's queue on. Resending one message to one destination is refused for the same reason when no variables are stored for it.

A message the server stopped on before it was routed to its destinations is run again as the same message, from its stored raw content. The source's scripts run again, and what they do outside the message (a database write, a message routed to another channel) happens again too. The source map is kept only in Development storage, so in Production and Raw storage those scripts see it empty. A message whose raw content is not stored (Metadata and Disabled storage) ends in ERROR, with an alert and an error in the log; no destination was sent to, but its scripts may have run. One whose raw content cannot be read stays RECEIVED, with an error in the log at each deploy.

A send may take as long as the destination's own timeout, and 5 minutes at most, whether the message has just come in, waits on the queue or is sent again after a server stop. A longer timeout in the settings is accepted and does not make it longer. At 5 minutes the send is told to end; a destination that cannot cancel what it is doing ends by its own limits. A stop ends the source first, which waits for the messages in hand while the queues go on sending, and then waits for the queued send in flight. From its beginning, as from that of a halt, the channel takes no message from its source, the API, Reprocess, another channel or an alert, although it shows started until it has ended; a send of crash recovery it waits 10 seconds for. A halt ends a queued send and puts the message back on the queue without counting an attempt; the partner may have taken it all the same. A server that stops takes nothing more from any queue, gives queued sends 20 seconds from the signal and then does what a halt does. It has 30 seconds in all, so its container needs a longer grace period than that.

A destination that shows RECEIVED cannot be resent while its message is open: the pipeline or crash recovery is sending it, or is about to. One that shows PENDING cannot be resent either, because its queue is sending it or is about to. If that does not end, redeploy the channel.

A message can be deleted in the message browser once it is processed and no destination of it shows PENDING. One that is still being processed or sent is refused: what is stored for it afterwards would stay when the message is gone. In a bulk delete the others are deleted, and those that were not are named. A message that waits on a queue (QUEUED) can be deleted and is then not sent; the event that records the deletion names it. A queue shows a message as PENDING while an attempt to send it lasts: to delete one whose attempts take long, stop the channel first. A message that never finishes usually ends at the channel's next start. One that does not, such as a message whose raw content cannot be read, can be deleted while the channel is stopped or undeployed, whatever its status, once what was under way when it was halted has ended.

A message is not sent again either, and ends in ERROR, when the destination it was prepared for is gone or switched off since the channel was deployed again.

A destination has a number: `#1` in the channel editor, `metaDataId` in the API and in an export. It keeps the number when you rename it, move it, change it or switch it off, and after you remove it no other destination of the channel gets that number. Queues, Resend, crash recovery and the statistics go by it, so a message reaches the destination it was prepared for or none. If you change where a destination sends, what waits on its queue goes there too. `destinationSet` in a script takes the number or the name.

Messages that wait on the queue of a destination stay there, unsent, while that destination is switched off or has its queue off, and after you remove it. The data pruner does not delete them. Each deploy that is started, and each restart, says how many wait: an error in the server log, an alert and a `QUEUE_HELD` event. To send them, switch the destination or its queue on again and redeploy. Those of a removed destination cannot be given to another. Reprocess each, which sends it to every destination the channel has now, and then delete it, or only delete it: it stays on the queue, and is reported, until it is deleted. Resend is refused for a destination that is switched off or has its queue off.

A message stored before the server kept the numbers also needs the name its destination had then ([upgrade](../ops/upgrade.md#destinations-keep-their-numbers-395)).

## TCP_MLLP

### TCP_MLLP: what it does

The source listens on a TCP port and reads framed messages, by default MLLP (0x0B before the message, 0x1C 0x0D after it). The destination opens pooled connections to a partner and sends each message in the same framing.

The source answers every message. With `responseMode` AUTO_ACK it builds an HL7 ACK from the inbound MSH: AA when the pipeline accepted the message (a filtered message counts as accepted), AE when it failed. It never sends AR. With PASSTHROUGH it returns the response the pipeline produced, and falls back to the same ACK when there is none or when its charset cannot hold it (logged as an error).

A stop or a pause takes no new messages. The message in hand on each connection is answered first, however long it takes. Its sender has up to 15 seconds to take the answer and 2 seconds then to close; one that still sends after that is cut off, and may lose an answer it has not read. One that comes after the stop, or waits behind another on its connection, is not recorded and gets no acknowledgement before the connection closes, so its sender keeps it. A halt closes every connection at once.

The destination waits for the partner's acknowledgement and reads MSA-1. AA or CA is SENT. Anything else is an ERROR with the code and MSA-3 text in the error message: a NAK (AE, AR, CE, CR), a missing MSA-1, an acknowledgement it cannot parse, an MSA-2 that names a different message control ID (MSA-2 must equal the whole sent MSH-10 or its first component), or the connection closing before an acknowledgement arrives. An ERROR is retried only if the destination's queue is on.

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
| `maxFrameBytes` | No | Most bytes one message may have, start and end bytes not counted. A longer one closes the connection without an acknowledgement, for it or for a message that ended in the same read. |
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
| `acquireTimeoutMs` | No | Milliseconds a message waits for a connection, a free pooled one or a new one. While the partner refuses connections, each connection in the pool is tried again after a second (or a quarter of this, if that is shorter), and the outage is logged once. A stop waits for the messages that wait; a halt ends their sends at once. |
| `charset` | No | As for the source: `utf-8` (default), `latin1`, `ascii` or `utf16le`, used to write the message and read the acknowledgement. A message with a character the charset does not have is an ERROR that names the character, and nothing is sent. A queued destination retries it like any failed send, with the message as it is stored: a new charset helps it, a changed transformer does not. |
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

The source runs an HTTP or HTTPS server on its own port and accepts requests on one path and one method. A wrong method gets 405, a wrong path 404, failed authentication 401, a body over `maxBodyBytes` 413, and a request to a channel that has just been undeployed 503. An accepted request answers `responseStatusCode` (a filtered message counts as accepted); a pipeline failure, or any other error in handling it, answers `errorStatusCode`.

A stop or a pause takes no new messages: one that comes on a connection still open gets 503, and the connection is closed. A message already in the pipeline is answered first, however long it takes, and its sender then has 15 seconds to read the answer. A body still arriving has 5 seconds, and then its sender gets 503 (413 if it is over `maxBodyBytes` by then). A halt closes every connection at once.

The source keeps a body whole or refuses it, and a refused body is never stored (D-334 in [DECISIONS.md](../progress/DECISIONS.md)):

- A body with `Content-Encoding` `gzip` (or `x-gzip`), `deflate` (the zlib format) or `br` is decompressed. Any other coding, or two codings, gets 415. A body that does not decompress, or has bytes after the compressed data, gets 400. A `Transfer-Encoding` other than `chunked` gets 501.
- A few bytes can decompress to a large body, so the source decompresses at most two at once, the rest waiting in order. When the decompressed bytes of the requests not answered yet reach four times `maxBodyBytes`, or 64 MiB if that is more, a compressed body gets 503 with `Retry-After: 1`. Uncompressed bodies are not affected, and there is no setting for either limit.
- Text is read in the charset the Content-Type declares, or in `bodyCharset` when it declares none. A body that is not valid in that charset, and a declared charset the server cannot decode, get 415. The response names the charset, and the server logs a warning with the sender's address and Content-Type, never the body. ISO-8859-1 and Windows-1252 have a character for every byte, so a body read in them is never refused for its charset. As in browsers, a body that declares ISO-8859-1 or US-ASCII is read as Windows-1252, which differs from ISO-8859-1 only in the bytes 0x80 to 0x9F; `bodyCharset` `latin1` reads those as control characters.
- A binary body (a PDF, an image, a form with a file in it) is not valid UTF-8, so it gets 415. PostgreSQL cannot store text that holds U+0000 in plain either, so a channel that stores its content without encryption answers `errorStatusCode` to such text in any charset, and the sender may send it again. Set `bodyCharset` to `base64` to keep a binary body: the message is then the base64 of the decompressed bytes, which a File destination with `binary` on writes back as they were.
- A body over `maxBodyBytes` gets its 413 at its end, or after 10 more seconds if it is still arriving, and the connection is then closed.
- A sender that closes its connection before its compressed body is handled is not dispatched: it got no answer, so it sends the message again.
- Requests pipelined on one connection behind a compressed one may be handled first.

The source map keeps the request headers as sent, so a `content-encoding` there does not mean the message is still compressed.

The destination sends each message as the request body. A 2xx response is SENT. A 3xx is an ERROR because redirects are not followed, and any other status is an ERROR with the status in the message. The response is read in the charset its Content-Type declares (ISO-8859-1 and US-ASCII as Windows-1252, as in browsers), else as UTF-8; a byte order mark wins over both and is left out. One that is not valid in its charset, declares one the server does not know, or is compressed although the send goes over the certificates below, changes nothing about the status: it is stored as far as it could be read, with U+FFFD for the rest, and a warning in the log names the message.

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
| `errorStatusCode` | No | Status when the pipeline fails or the request cannot be handled, 100 to 599; `500` by default. |
| `maxBodyBytes` | No | Largest request body, both as received and once decompressed; a larger one gets 413. |
| `bodyCharset` | No | How a body is read when its Content-Type declares no charset: `utf-8` (default), `latin1` (ISO-8859-1) or `windows-1252`. A declared charset wins over these. `base64` keeps the bytes of every body, text included, whatever its Content-Type says. The `charset` key older editors saved is still ignored. |
| `auth.type` | No | `BASIC` or `TOKEN`. With no `auth` object, anyone who can reach the port can post. API only. |
| `auth.username` | No | Expected Basic username. Required with `BASIC`: a guard without it refuses to deploy. |
| `auth.password` | No | Expected Basic password. Required with `BASIC`: a guard without it refuses to deploy. |
| `auth.token` | No | Expected bearer token, compared with `Authorization: Bearer <token>`. Required with `TOKEN`: a guard without it refuses to deploy. |
| `scheme` | No | `HTTP` or `HTTPS`. HTTPS needs `tls.serverCertId`. |
| `tls.serverCertId` | No | Certificate store entry with a private key. Required when `scheme` is HTTPS. |
| `tls.caCertId` | No | CA used to verify client certificates. |
| `tls.requireClientCert` | No | `true` requires a client certificate (mutual TLS). |

### HTTP as a destination

| Property | Required | Notes |
|---|---|---|
| `url` | Yes | Target URL. May use `${name}` message variables. Use `basicAuth` for a user name and password: in the URL, they work only with `scheme` HTTPS or custom TLS material, and every other send fails. |
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
- `bodyCharset` applies to the whole connector; the source cannot keep some content types as base64 and read the rest as text.

## FILE

### FILE: what it does

The source polls a local directory for files that match a glob, reads each one as a message, and then deletes, moves or leaves it. The destination writes each message to a file in a local directory.

Only paths the server process can open are reachable: the local disk and anything the operating system has mounted. There is no FTP, SMB, S3 or WebDAV. For SFTP use the [SFTP](#sftp) connector.

The source leaves alone the files a Mirth File Reader leaves alone. It never reads a name ending in `.ignore`, and it holds back a file while a file named after it plus `.ignore` sits next to it: `a.hl7` is not read while `a.hl7.ignore` exists, and is read on the next poll after that file is removed. With `ignoreDot` on (the default) it skips names starting with `.`, and its filter is case-sensitive. A name of the form `.galvanigraph-<uuid>.tmp` is a destination's temporary file and is never read.

A file is checked again when its turn comes, which can be long after the folder was listed, and after it was read: one that changed and is too new, or that changes while it is read, waits for a later poll. One that is gone once it was read is processed, with a warning in the log. It is checked once more before it is deleted or moved. One whose size or modification time changed while its message was processed is left in place and read again as it is then, so a sender that appends to a file after it was read has the whole file delivered again. A change that keeps both the size and the time is not seen, nor is one in the moment between the last check and the delete or move.

A file the channel stored with an ERROR status, or whose delete or move failed after it was sent, is left in place and not read again, with an ERROR in the log. The list of those files is `.galvanigraph-quarantine.json` in the directory, as [for SFTP](#sftp-what-it-does).

`MOVE` does not replace a file. When the target folder has one of the same name, the file stays where it was and is in that list: it was delivered once and is not delivered again. Rename or remove one of the two, and move the file yourself. A sender that uses the same name every day needs `DELETE`, or something that clears the target folder. On a file system without hard links (FAT, some network shares) a file of that name that appears in the same moment can still be replaced.

### FILE security

A File source or destination may use only directories under `FILE_CONNECTOR_ROOTS`, a comma separated list of absolute paths the operator sets in the server's environment ([deployment](../ops/deployment.md)). With it unset, every File connector refuses to deploy, and Test Connection reports the same. The server's install directory (its code and `.env`), its working directory, `/proc`, `/sys` and `/dev` are refused even inside a root. The check runs after symlinks are resolved, at deploy, on every poll, before every move and before every write, so a `..` in `outputPattern` or a directory later replaced by a symlink cannot reach outside the roots. Files in a source directory that are themselves symlinks are skipped. Without this a deployer could read the server's `JWT_SECRET` through a File source or overwrite its code through a File destination (D-315 in [DECISIONS.md](../progress/DECISIONS.md)).

The connector adds no transport security. A network share must be protected where it is mounted, and the server process's file permissions decide what it can read and write inside the roots. A destination writes through a temporary file and renames it by default, so a partner never reads half a file. An append or a write without a temporary file that is cut off leaves part of the message in the file, and the message's error names the file.

### FILE as a source

| Property | Required | Notes |
|---|---|---|
| `directory` | Yes | Directory to poll: an absolute path under `FILE_CONNECTOR_ROOTS`. |
| `fileFilter` | No | Glob (`*`, `?`) for the files to read, `*` by default. Not empty. Case-sensitive on every platform, Windows included, as a Mirth File Reader's filter is: `*.hl7` does not match `A.HL7` (D-304 in [DECISIONS.md](../progress/DECISIONS.md)). |
| `ignoreDot` | No | On by default: names starting with `.` (editor swap files, partner lock files) are never read or deleted, as in Mirth. `false` reads them. |
| `pollingIntervalMs` | No | Milliseconds between polls, a whole number from 100 to 2147483647 (about 24.8 days), 5000 by default. |
| `sortBy` | No | `NAME` (default), `DATE` or `SIZE`: the order files are read in. |
| `charset` | No | `utf-8` (default), `latin1` (ISO-8859-1), `ascii` or `utf16le`, used to decode the file. Case is ignored, and `utf8`, `ISO-8859-1`, `US-ASCII` and `UTF-16LE` are read as those. Any other refuses to deploy, in binary mode too. |
| `binary` | No | `true` reads the file as base64 instead of text. |
| `checkFileAge` | No | On by default: skip files younger than `fileAgeMs`, so a file still being written is not read. Checked when the folder is listed, and again for a file that changed before its turn. |
| `fileAgeMs` | No | Minimum file age in milliseconds, a whole number from 0, 1000 by default. |
| `postAction` | No | `DELETE` (default), `MOVE` or `NONE`. The default deletes each file after the pipeline accepts it. `NONE` leaves the file in place, so the next poll reads it again. |
| `moveToDirectory` | No | Where `MOVE` puts processed files: an absolute path under `FILE_CONNECTOR_ROOTS`. Required when `postAction` is `MOVE`. A file already there is not replaced. |

### FILE as a destination

| Property | Required | Notes |
|---|---|---|
| `directory` | Yes | Directory to write to, an absolute path under `FILE_CONNECTOR_ROOTS`; created if missing. |
| `outputPattern` | No | File name, `${messageId}.txt` by default. Only `${messageId}` and `${timestamp}` are filled; any other placeholder refuses to deploy. Without `${messageId}` and with append off, each message overwrites the last file of that name (a warning is logged). A name that resolves outside `FILE_CONNECTOR_ROOTS` is not written and the message errors. |
| `charset` | No | As for the source: `utf-8` (default), `latin1`, `ascii` or `utf16le`, used to encode the file. A message with a character the charset does not have is an ERROR that names the character, and nothing is written. |
| `binary` | No | `true` decodes the content from base64 and writes the bytes. |
| `tempFileEnabled` | No | On by default: write a temporary file (`.galvanigraph-<uuid>.tmp` in the same folder), then rename it. Not used for an append. |
| `appendMode` | No | `true` appends to the file instead of replacing it. |

### FILE limits

- Local paths and OS mounts only. FTP, SMB, S3 and WebDAV are not supported; the Mirth importer warns that such a channel will not deploy.
- Absolute paths under `FILE_CONNECTOR_ROOTS` only. An imported Mirth channel whose directory is outside the roots refuses to deploy until the path or the roots change.
- No `${originalFilename}` in `outputPattern`: the destination does not receive the source file name (D-219 in [DECISIONS.md](../progress/DECISIONS.md)).

## SFTP

### SFTP: what it does

The source polls a directory on an SFTP server for files that match a glob, downloads each one as a message in name order, and then deletes, moves or leaves it. The source map holds `originalFilename`, `remoteDirectory`, `fileSize` and `lastModified`.

A file the channel stored with an ERROR status, or whose delete or move failed after it was sent, is left in place and not read again. The list of those files is kept in `.galvanigraph-quarantine.json` in the remote directory, so it survives a restart, and that file is never read as a message. A `.galvaniflow-quarantine.json` or `.mirthless-quarantine.json` left by a version from before a rename is still read, and never read as a message. The list records each file by name and modification time, so a file uploaded again with a new modification time is read.

A file that changes between the listing and its turn, while it is read, or while its message is processed is handled [as for FILE](#file-what-it-does). SFTP carries modification times in whole seconds, so a change that keeps the size within the same second is not seen. `MOVE` does not replace a file, as for FILE; on a server whose rename replaces, one that appears in the target folder in the same moment can be.

A source that is stopped waits for a file it has downloaded, and deletes, moves or lists it before the connection closes. One that is still being downloaded is left for the next start. A halt does not wait, and the downloaded file is dealt with when its message ends. A server that does not answer the close is left after 2 seconds, and the connection is closed on this side; while a file is dealt with, each request has 30 seconds.

The destination uploads each message as a file, encoded as UTF-8. Each send opens its own connection, creates `remoteDirectory` if it is missing, writes the file and disconnects. A send that takes over 30 seconds is an ERROR. The response is the remote path written.

The file is written as `.galvanigraph-<uuid>.tmp` in the same folder and then renamed, so a partner never reads half a file, and a partner that reads every name in the folder can be told to leave that form alone. A source of this connector never reads it. The rename replaces an existing file in one step on OpenSSH and any server with its `posix-rename` extension. On another server whose rename refuses an existing name, that file is renamed aside to a name of the same form and deleted once the new one is in place, so for a moment there is none; if the new one cannot take its place it is renamed back. The file that replaces another is a new one, with the owner, permissions and links the server gives it. A server that allows no renames, refuses a name of that form, or takes each upload as a file the moment it closes, needs `tempFileEnabled` off. A send that fails removes its temporary file, unless that may be the only copy on the server, and the message's error names the files that are left and the one that may hold the message or, for an append or a write without a temporary file, part of it.

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
| `filePattern` | No | Glob for the files to read, `*` by default. An empty pattern refuses to deploy. Case-sensitive, as for FILE: `*.hl7` does not match `A.HL7`. |
| `ignoreDot` | No | On by default: names starting with `.` are never read or deleted, as in Mirth. `false` reads them. |
| `pollingIntervalMs` | No | Milliseconds between polls, a whole number from 100 to 2147483647. Defaults to 5000. |
| `afterProcessing` | No | `DELETE` (default), `MOVE` or `NONE`. The default deletes the remote file after the pipeline accepts it. |
| `moveToDirectory` | No | Remote directory for `MOVE`, created if missing. Required when `afterProcessing` is `MOVE`. A file already there is not replaced. |
| `minFileAgeMs` | No | Skip files younger than this, so a file still being uploaded is not read; 1000 by default. Checked when the folder is listed, and again for a file that changed before its turn. |
| `strictHostKey` | No | On by default. See security. |
| `hostKey` | Yes | Server's base64 public key. Deploy requires it while `strictHostKey` is on; only `strictHostKey` false lets it be empty. |
| `charset` | No | Character set to decode the file: `utf-8` (default), `latin1`, `ascii` or `utf16le`, in any case; `UTF-8`, `utf8`, `ISO-8859-1`, `US-ASCII` and `UTF-16LE` are read as those. Any other name refuses to deploy. |

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
| `fileNameTemplate` | No | File name, `${messageId}.dat` by default. Only `${messageId}` and `${timestamp}` are filled; any other placeholder, or an empty name, refuses to deploy. |
| `tempFileEnabled` | No | On by default: write under a temporary name, then rename. Not used for an append. Off writes under the final name, where a partner can read half a file. |
| `appendMode` | No | `true` appends to the remote file instead of replacing it. |
| `strictHostKey` | No | On by default. See security. |
| `hostKey` | Yes | Server's base64 public key. Deploy requires it while `strictHostKey` is on; only `strictHostKey` false lets it be empty. |

### SFTP limits

- No `${originalFilename}` in `fileNameTemplate` (D-219 in [DECISIONS.md](../progress/DECISIONS.md)).
- The destination writes UTF-8 text only; it has no `charset` or binary setting.

## DATABASE

### DATABASE: what it does

The source runs `selectQuery` on each poll and sends every row as a JSON message, at most 1,000 rows per poll; it can then run `updateQuery` to mark rows as read. The destination runs `query` once per message. `${name}` parameters in a query are sent as bound parameters, never pasted into the SQL.

The name in `${name}` is everything between the braces, without surrounding spaces, and is one key, never a path: `${patient-id}` and `${a.b}` are the columns or variables with exactly those names. A name with only letters, digits and underscores that the row or message lacks is bound as NULL. Any other missing name is left as written, which the database refuses as SQL; between quotes it is text like any other.

It talks to PostgreSQL and to MySQL or MariaDB, picked with `vendor` (D-259 in [DECISIONS.md](../progress/DECISIONS.md)). Any other vendor, such as SQL Server or Oracle, refuses to deploy. No test has run against MariaDB.

How a value stands in a message (D-365):

- A PostgreSQL `date` is `2026-01-15`, a `timestamp` is `2026-01-15T00:30:00.123456`, in no time zone, and a `timestamptz` is the instant in UTC, `2026-01-15T08:30:00.123456Z`. Three to six digits of a second, whatever the time zone of the server. A value outside those forms (`infinity`, a year before 1 or after 9999, a `DateStyle` other than ISO) is the database's own text. MySQL dates and times are the database's own text.
- A `bigint`, a `numeric` (in an array too) and a MySQL `DECIMAL` are text. So is a number inside a `json` or `jsonb` value that JavaScript cannot hold (MySQL: a whole number), and a `NaN` or `Infinity`, also as a coordinate of a `point` or `circle`. Other numbers are numbers.
- The same text goes back in `updateQuery`, so a row can be found by its time.

A statement that takes too long is stopped by the database, so a failed statement does not take effect later. PostgreSQL gives it 30 seconds. MySQL gives it 25: the server ends a wait for a lock and a long SELECT by itself, and for any other statement the connector sends `KILL QUERY` on a second connection as the same user. A statement that ends all the same is reported as it ended. The `KILL` is not sent when the server behind the second connection is another one, or a proxy numbers the connections itself. When the server gives no answer for 30 seconds (for PostgreSQL, 35), or the connection is lost, nobody knows whether the statement took effect; on MySQL the error then says that it may. What a stopped MySQL statement had already done stays only where MySQL cannot undo it: in a table without transactions, such as MyISAM, and, unless `useTransaction` is on, in the statements a stored procedure had finished.

### DATABASE security

Set `tls` to true to connect over TLS. The database server's certificate is then verified against the Node trust store, and an untrusted one fails the connection. With `tls` off the connection, and the PHI in it, is plaintext.

### DATABASE as a source

| Property | Required | Notes |
|---|---|---|
| `vendor` | No | `postgresql` (default) or `mysql`. MariaDB uses `mysql`. Any other value refuses to deploy. |
| `host` | Yes | Database server. |
| `port` | No | 1 to 65535. Defaults to the vendor's port, 5432 or 3306; the editor fills it in. |
| `database` | Yes | Database name. |
| `username` | No | Database user. Deploy does not check it. Left empty, PostgreSQL connects as the `PGUSER` environment variable or the server process's operating system user, and MySQL connects with no user name. Set it. |
| `password` | No | Password, if the database asks for one. |
| `selectQuery` | Yes | Query that returns the rows to send. With an update mode it is sent with `FOR UPDATE SKIP LOCKED`, so two sources cannot take the same row of a table it reads; a query with a `FOR UPDATE` of its own is sent as written, and `FOR SHARE` becomes `FOR UPDATE`. With `OF`, either locks only the tables it names. |
| `updateQuery` | No | Statement run after rows are sent, such as marking them processed. Required when `updateMode` is `ALWAYS` or `ON_SUCCESS`. |
| `updateMode` | No | `NEVER` (default), `ALWAYS` or `ON_SUCCESS`: when `updateQuery` runs. With `NEVER`, the next poll returns the same rows again unless `selectQuery` excludes them. |
| `pollingIntervalMs` | No | Milliseconds between polls, a whole number from 100 to 2147483647 (about 24.8 days). Defaults to 5000. |
| `rowFormat` | No | `JSON`, the only format. |
| `tls` | No | `true` connects over TLS with certificate verification. `true` or `false` only. |

### DATABASE as a destination

| Property | Required | Notes |
|---|---|---|
| `vendor` | No | `postgresql` (default) or `mysql`. MariaDB uses `mysql`. |
| `host` | Yes | Database server. |
| `port` | No | 1 to 65535. Defaults to the vendor's port; the editor fills it in. |
| `database` | Yes | Database name. |
| `username` | No | Database user. Deploy does not check it; left empty, the drivers fall back as for the source. Set it. |
| `password` | No | Password, if the database asks for one. |
| `query` | Yes | Statement run for each message. |
| `useTransaction` | No | `true` runs the statement in a transaction. |
| `returnGeneratedKeys` | No | `true` makes the response a JSON array instead of the affected row count. On PostgreSQL it holds the rows the statement returns, which is `[]` unless the query has a `RETURNING` clause (such as `RETURNING id`). On MySQL a write gives `[{"insertId": <n>}]` with the first generated id, or `[]` when no id was generated; a `SELECT` gives its rows. |
| `tls` | No | `true` connects over TLS with certificate verification. `true` or `false` only. |

A key neither table lists refuses to deploy, naming the key.

### DATABASE limits

- PostgreSQL and MySQL/MariaDB only. A Mirth channel on SQL Server or Oracle imports with a warning but refuses to deploy.
- One poll sends at most 1,000 rows; the rest wait for the next poll.
- The added lock does not reach the rows of a `WITH` query or, on MySQL, of a subquery in `FROM`, and the database does not say so. Such a query needs a `FOR UPDATE SKIP LOCKED` of its own in there, or two sources can take the same row. A `FOR UPDATE` in a subquery of a condition counts as the query's own.
- When `updateQuery` fails for a row whose message was stored, the row is not sent again: each poll that returns it tries the update again, and logs an ERROR while it fails. A row that comes back with different content is a new row, so a `selectQuery` that returns something new at every poll, such as `now()`, sends it every time. A row that the query stops returning and returns later is sent again: one that a `LIMIT` pushes out, for example. One that is missing because another transaction holds it is not, unless the `selectQuery` itself writes (`UPDATE ... RETURNING`). A restart of the server or a deploy of the channel forgets which rows were sent and sends each such row once more, and a second source on the same table sends it once as well.
- A stop waits for the row being processed, marks it, and takes no more rows. A halt does not wait; the row is still marked when its message is done.
- The only row format is JSON.

## JAVASCRIPT

### JAVASCRIPT: what it does

The source runs a script on a timer and sends each value it returns as a message: a string is one message, an array is one message per item, and an empty string, null or undefined sends nothing. A number is sent as text (`NaN` and `Infinity` are null), an object or an array inside the array as JSON, and a message from `parseHL7` as its HL7 text. An item that holds no message is skipped, and a warning in the log counts them: empty text, null, undefined, `true` or `false` in an array, and an object or array without data, which is also what a promise becomes that the script did not await. The destination runs a script with the message in scope, and the script's return value becomes the response.

A stop or a pause waits for the script under way and for every message it returned, however long that takes, because nothing else holds what a script returned. A halt does not wait: what is not sent yet is kept, with a warning in the log that counts it, and the next start sends it before the script runs again. A redeploy or a restart after the halt loses it, with an error in the log that counts it when the channel is undeployed. A server that stops has 30 seconds for all its channels, and what a script returned and is not sent by then is lost.

Both run in the engine's script sandbox, with the same bridges as transformers. See [scripting-api.md](./scripting-api.md).

### JAVASCRIPT security

The script runs inside the server. Whatever it reaches through the script bridges uses the security of that bridge, such as an HTTPS URL for `httpFetch`. The sandbox limits what a script can do, but it is not a security boundary against a hostile author: only give script access to people you would trust with the server.

### JAVASCRIPT as a source

| Property | Required | Notes |
|---|---|---|
| `script` | Yes | Script whose return value is sent. An empty or blank script refuses to deploy. It runs with no message (`msg`, `tmp` and `rawData` are empty), and sees `channelId` and `channelName`. |
| `scriptLanguage` | No | `JAVASCRIPT` or `TYPESCRIPT`; any other value refuses to deploy. Missing means JavaScript. A TypeScript script with type errors refuses to deploy. |
| `pollingIntervalMs` | No | Milliseconds between runs, a whole number from 100 to 2147483647 (about 24.8 days). Default 5000. |

### JAVASCRIPT as a destination

| Property | Required | Notes |
|---|---|---|
| `script` | Yes | Script run for each message. An empty or blank script refuses to deploy. It sees `msg` parsed for the channel's data type, `channelId`, `channelName` and `connectorMessage` (the message being sent, with its ids and content). |
| `scriptLanguage` | No | `JAVASCRIPT` or `TYPESCRIPT`; any other value refuses to deploy. Missing means JavaScript. A TypeScript script with type errors refuses to deploy. |

### JAVASCRIPT limits

- No Rhino, E4X or Java API emulation: Mirth scripts that call Java classes need rewriting.

## CHANNEL

### CHANNEL: what it does

A CHANNEL destination hands the message to another GalvaniGraph channel's CHANNEL source in memory, on the same server, without a network hop. With `waitForResponse` on, the destination's response is the target channel's response; otherwise it is `messageId=<n>` for the message the target created.

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

The source is a DICOM storage SCP. It accepts C-STORE associations, writes each instance to `storageDir` as `<SOPInstanceUID>.dcm` (a copy that arrives while an earlier one is still there is written as `<SOPInstanceUID>_2.dcm`, `_3` and so on, never over it) with its dataset byte for byte as it came, and sends a message whose content is the file path, with the dataset's attributes and the AE titles in the source map. In `PER_ASSOCIATION` mode it sends one message per association whose content is a JSON list of file paths.

It accepts every standard storage SOP class (those under `1.2.840.10008.5.1.4.1.1`, except the protocol approval and inventory services DICOM put there, and the hanging protocol, color palette, implant template and RT delivery instruction classes DICOM put elsewhere) and C-ECHO, in implicit VR, explicit VR little and big endian, deflated, Encapsulated Uncompressed, Deflated Image Frame, RLE, and every JPEG, JPEG-LS, JPEG 2000, High-Throughput JPEG 2000, JPEG XL, MPEG and HEVC transfer syntax (D-355). It rejects JPIP, whose pixel data is only a link, and private SOP classes.

The sender is answered success only when the file is on disk and its message cannot be lost (D-353). In `PER_FILE` mode that is when the message is stored in the database: while it cannot be stored, the sender gets a C-STORE failure and the file is removed, so the sender keeps the image and can send it again. A database that answers slower than `connectionTimeoutMs` ends the association instead, which senders also take as not stored. In `PER_ASSOCIATION` mode the answered files are listed under `.galvanigraph-pending` in `storageDir` until the association's message is stored. An association that ends without a release (an abort, a dropped connection, a timeout) gives a message of the files answered until then, and the log says so; one that stored nothing gives none. After a crash, a stop or a database outage the listener makes the message when it starts, and looks again every 30 seconds. A message is made at least once: an image whose answer was lost, or whose association was being recorded at the moment of a crash, can have two.

The destination is a storage SCU. The message content must be the absolute path of a DICOM file under `FILE_CONNECTOR_ROOTS`, which it sends with C-STORE. The file's dataset is sent byte for byte, private attributes and unknown tags included (D-354): its own transfer syntax is always proposed alone, so an archive that takes it gets it. An explicit VR little endian image is put in implicit VR for an archive that takes only that, with the same elements and values. Any other image whose transfer syntax the archive does not take is an ERROR that names the transfer syntax; nothing is decompressed or transcoded. The message reads SENT only when the remote AE answers that it stored the image: success (0x0000), or a warning (0xB000 to 0xBFFF, such as elements coerced or left out), which the response shows as `warning=0xB000`. Any other status, a rejected association or presentation context, an abort, and a connection closed or timed out before the answer are an ERROR that says which, and are retried as `maxRetries` and the destination's queue say (D-350). 0x0111 (duplicate SOP instance) is an ERROR too: the archive did not take this copy, and may have the image from an earlier attempt whose answer was lost, so check there before you remove the message from its queue.

### DICOM security

DICOM traffic is not encrypted: neither direction supports TLS. The source accepts every association whatever the calling and called AE titles, so anyone who can reach the port can store files. Keep DICOM on a trusted network or a VPN. A DICOM connector imported from Mirth with TLS on (Mirth's `tls` other than `notls`) refuses to deploy rather than run in plaintext; remove `tls` only if plaintext is acceptable on that network.

DICOM files stay under `FILE_CONNECTOR_ROOTS`, as [File connectors' directories](#file-security) do (D-326). The listener's `storageDir` and `moveToDirectory` are checked at deploy and again before every write and every move, after symlinks are resolved, so a directory later swapped for a link out of the roots is refused. The sending AE names each file through its SOP Instance UID, so an instance whose UID is not a DICOM UID (digits and dots, at most 64 characters) is refused with a C-STORE failure rather than stored. The destination checks the path in the message before it reads the file: message content comes from transformers, and without the check a script could send any DICOM file the server can read to the remote AE.

### DICOM as a source

| Property | Required | Notes |
|---|---|---|
| `port` | Yes | Port to listen on. |
| `storageDir` | Yes | Directory received files are written to: an absolute path under `FILE_CONNECTOR_ROOTS`. |
| `aeTitle` | No | This listener's AE title, at most 16 characters, `GALVANIGRAPH` by default. Not checked against incoming associations. |
| `connectionTimeoutMs` | No | Connect, association and PDU timeout in milliseconds, 10000 by default. |
| `dispatchMode` | No | `PER_FILE` (default) or `PER_ASSOCIATION`. |
| `postAction` | No | `DELETE` (default), `MOVE` or `NONE`. The message holds only the file path, so the action waits until every destination has delivered the message, a queued destination included: a DICOM Sender retrying from its queue still finds the file (D-325). If a destination fails, or its queue gives up, the file stays where it is for manual recovery, whatever the channel's response mode tells the sender. A later reprocess of the message has no file to read after `DELETE`; use `MOVE` or `NONE` if anything reads the file afterwards. |
| `moveToDirectory` | No | Where `MOVE` puts files: an absolute path under `FILE_CONNECTOR_ROOTS`. Required when `postAction` is `MOVE`. |

### DICOM as a destination

| Property | Required | Notes |
|---|---|---|
| `host` | Yes | Remote SCP host. |
| `port` | Yes | Remote SCP port. |
| `calledAETitle` | No | The remote AE title, at most 16 characters, `PACS` by default. |
| `callingAETitle` | No | This sender's AE title, at most 16 characters, `GALVANIGRAPH` by default. |
| `maxRetries` | No | Retries of a failed send, 3 by default. A refusal is retried like a lost connection. |
| `retryDelayMs` | No | Milliseconds between retries. |
| `timeoutMs` | No | Milliseconds before the send fails. |

### DICOM limits

- No TLS in either direction, and no AE title filtering on the listener.
- Files only under `FILE_CONNECTOR_ROOTS`; with it unset, DICOM connectors refuse to deploy.
- An association waiting under `.galvanigraph-pending` belongs to its channel and its `storageDir`: point a channel back at the old directory to get the messages of what was left there. Never delete or edit the files there while the channel exists.
- A message that is deleted before every destination has delivered it leaves its file in `storageDir`, as one whose destination failed does. Remove it by hand.
- On a `PER_FILE` channel that does not store raw content, crash recovery cannot run a message again, so an image whose message was being processed when the server stopped stays in `storageDir` and has to be sent on by hand. A `PER_ASSOCIATION` one keeps its list until the message has been processed, so it makes a second message instead.
- The attributes in the source map are read by a library that gives numbers as numbers (a Slice Thickness of `1.50` is `1.5` there) and leaves out what it does not know. The file has everything; a script that needs the exact text has to read the file.
- An instance is refused (C-STORE status 0xC000) when its dataset does not give a SOP Class UID and SOP Instance UID, starts with file meta information, or is deflated and cannot be inflated or grows past 256 MiB. Beyond that the dataset is not checked: one that is cut short is stored and sent on as it came.
- A port in use fails the channel's start. A stop, or a pause, lets the images whose message is being stored be answered, for up to 5 seconds, and then aborts the open associations; an image still being written is answered with a failure, and new associations are rejected as temporary congestion. A halt cuts every association off at once.
- Private SOP classes (a vendor's own, such as Siemens CSA Non-Image) are rejected.
- No limit on concurrent associations in either direction. The destination opens one association per message. `minPoolSize` and `maxPoolSize` (source) and `mode` and `maxAssociations` (destination), which earlier versions saved and never used, are dropped when a channel is validated (#154).

## EMAIL

### EMAIL: what it does

EMAIL can only receive; it cannot send messages. Use [SMTP](#smtp) to send email.

It polls an IMAP mailbox folder for unread messages and sends each one as the mail server holds it: the raw email, headers and MIME parts and attachments included, read as UTF-8. The subject, from, to and date are in the source map. Afterwards it marks the email read, deletes it or moves it.

It keeps track of what it has done with IMAP keywords, which stay on the email through restarts and redeploys: `$GalvaniGraphDispatched` once the pipeline took it, so that only the marking, deleting or moving is tried again, and `$GalvaniGraphError` when its message was recorded with an error. Such an email is left in the folder and not dispatched again, by any channel that reads the folder, and each says once in the log how many there are; reprocess its message from the message browser. Remove the keyword, and mark the email unread, to have it dispatched again. A mailbox that does not accept custom keywords is reported once in the log; there, a restart or a redeploy sends an email that was left in the folder again.

`DELETE` removes an email only after this source has recorded its message since the channel was deployed, one that a filter left out included. A channel that stores no content keeps no copy of it then. An email that carries `$GalvaniGraphDispatched` from before, or from another channel, stays in the folder, and the log says once how many there are. One stays as if recorded with an error when a destination failed although the sender is answered before the destinations (`AUTO_BEFORE`, `AUTO_AFTER_TRANSFORMER`). One that is not valid UTF-8 is marked read instead, because its message does not hold all of it. On Gmail, removing an email from a folder keeps it in All Mail unless the account is set otherwise.

A stop or a pause waits for the email in hand, marks, deletes or moves it, and takes no more. A halt does not wait; the email in hand is dealt with when its message ends. A channel redeployed before that may dispatch that email again, and one that is started again polls only then.

### EMAIL security

`secure` is on by default and connects with IMAP over TLS (port 993). Turning it off sends the mailbox password and the PHI in plaintext.

### EMAIL as a source

| Property | Required | Notes |
|---|---|---|
| `host` | Yes | IMAP server. |
| `port` | No | IMAP port, 993 by default. |
| `secure` | No | On by default: IMAP over TLS. |
| `username` | Yes | Mailbox user. |
| `password` | Yes | Mailbox password. |
| `protocol` | No | `IMAP`. `POP3` refuses to deploy. |
| `folder` | No | Folder to read, `INBOX` by default. An empty folder refuses to deploy. |
| `pollingIntervalMs` | No | Milliseconds between polls, a whole number from 1000 to 2147483647. Defaults to 60000. |
| `postAction` | No | `MARK_READ` (default), `DELETE` or `MOVE`. `DELETE` needs a server that offers UIDPLUS, and `MOVE` one that offers MOVE or UIDPLUS, because without them a server can only remove every email in the folder that is flagged deleted, and both need UIDVALIDITY. Without it the email stays, and an error is logged at every poll, for `DELETE` until the channel is redeployed. |
| `moveToFolder` | No | Folder for `MOVE`. Required when `postAction` is `MOVE`. |
| `subjectFilter` | No | Only read emails whose subject contains this text, ignoring case. |

### EMAIL limits

- IMAP only; POP3 is refused at deploy.
- The email is not parsed: attachments arrive as MIME parts of the raw email and are stored with it, and `attachmentCount` in the source map is always 0 (#369). `includeAttachments`, which earlier versions saved and never used, is dropped when a channel is validated (#154).
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
| `port` | No | SMTP port, 1 to 65535. Defaults to 587. |
| `secure` | No | `true` for implicit TLS. Off by default. |
| `requireTLS` | No | `true` to require STARTTLS. Off by default. |
| `authUser` | No | Username; with none set, the server is used as an anonymous relay. |
| `authPass` | No | Password for `authUser`. |
| `from` | Yes | Sender address. |
| `to` | Yes | Recipients. |
| `cc` | No | Copy recipients. |
| `bcc` | No | Blind copy recipients. |
| `subject` | No | Subject; may use `${name}` variables. |
| `bodyTemplate` | No | Body, `${msg}` by default. |
| `contentType` | No | `text/plain` (default) or `text/html`. |
| `attachContent` | No | `true` also attaches the message content as a file. |
| `attachments` | No | List of `filename`, `content` and optional `mimeType`, all text; filename and content may use variables. An entry with a missing or non-text field, or another key, refuses to deploy. A row left blank in the editor is sent as an empty attachment, so remove rows you do not use. |

### SMTP limits

- Sending only.
- No OAuth sign-in; authentication is a username and password.

## FHIR

### FHIR: what it does

FHIR can only send; it cannot receive messages. There is no FHIR source.

It posts the message content as-is to a FHIR R4 server: POST to `<baseUrl>/<resourceType>`, or PUT to `<baseUrl>/<resourceType>/<id>` with the id read from the resource. The message must already be a FHIR resource in the configured format. An HL7 v2 message sent here is posted unchanged and the server rejects it; write a transformer that builds the resource first. A 2xx response is SENT. A 3xx is an ERROR naming the redirect target, because redirects are not followed: following one would turn the POST into a GET with no body, and nothing would be created. Any other status is an ERROR. The response is read as [the HTTP destination](#http-what-it-does) reads it.

### FHIR security

An `https://` base URL uses TLS with the Node trust store. There is no certificate store or client certificate support; to trust a private CA, set `NODE_EXTRA_CA_CERTS` for the server. An `http://` base URL sends PHI in plaintext.

### FHIR as a destination

| Property | Required | Notes |
|---|---|---|
| `baseUrl` | Yes | FHIR server base URL, an absolute URL without a user name or password. Use the final address: a redirect is an ERROR. |
| `resourceType` | No | Resource type in the URL. Defaults to `Patient`, so set it for any other resource. |
| `method` | No | `POST` (create) or `PUT` (update). `PUT` needs an `id` in the resource, and an id outside the FHIR id rules is refused. |
| `authType` | No | `NONE` (default), `BASIC`, `BEARER` or `API_KEY`. Each type other than `NONE` refuses to deploy without its credentials below. |
| `authUsername` | No | Basic username. Required for `BASIC`. |
| `authPassword` | No | Basic password. Required for `BASIC`. |
| `authToken` | No | Bearer token. Required for `BEARER`. |
| `authHeaderName` | No | Header that carries the API key. Required for `API_KEY`. |
| `authApiKey` | No | API key value. Required for `API_KEY`. |
| `format` | No | `json` (default) or `xml`. |
| `timeout` | No | Milliseconds before the send is an ERROR, a whole number from 1 to 2147483647. Defaults to 30000. |
| `headers` | No | Extra request headers, as a name-to-value map. Text saved by the old editor is read as `Name: value` lines. |

### FHIR limits

- No FHIR source connector.
- No HL7 v2 to FHIR mapping; the message must already be a FHIR resource.
- No client certificate (mutual TLS) support.

## KAFKA

### KAFKA: what it does

The source joins a consumer group on a topic and sends each record as a message. The source map holds `topic`, `partition`, `offset`, `key`, `headers` and `timestamp`, and `charsetError` when a UTF-8 value had invalid bytes. The destination writes each message to a topic as UTF-8.

A record the pipeline fails to store is not committed and is read again. After `maxStoreAttempts` failures in a row on the same record, the source stops the channel, records an ERROR `CHANNEL_STOPPED` event and fires a `SOURCE_CONNECTOR` alert. The record stays uncommitted: fix the cause and start the channel, and it reads that record first.

A stop or a pause waits for the record in hand, however long it takes, commits it and reads no more. A halt does not wait: the record in hand is committed when its message has ended, so one that was recorded is not read again. One that the halt ended with an error is committed only when the channel keeps its content, so that it can be reprocessed. A start, or an undeploy, within that time waits for it for up to 10 seconds; after that the record is not committed and is read again.

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
| `charset` | No | How the record value becomes message text: `utf-8` (default), `latin1` (ISO-8859-1), `windows-1252`, or `base64` to keep a binary payload intact. In `utf-8` mode invalid bytes are replaced with U+FFFD, the message is flagged with `charsetError` in the source map, and a warning is logged. The key and header values are always read as UTF-8. |
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

The source consumes an existing queue on an AMQP 0-9-1 broker such as RabbitMQ and sends each delivery as a message. The source map holds `queue`, `exchange`, `routingKey`, `redelivered` and `headers`, `messageId` and `contentType` when the message has them, and `charsetError` when a UTF-8 body had invalid bytes. A header that is a table or an array becomes JSON text, however deeply it is nested. The destination publishes each message to an existing exchange as a persistent message, encoded as UTF-8.

A message the pipeline fails to store goes back to the queue. After `maxStoreAttempts` failures to store the same message, the source stops the channel, records an ERROR `CHANNEL_STOPPED` event and fires a `SOURCE_CONNECTOR` alert. The message is neither acked nor dead-lettered; it stays on the queue for when the channel is started again. Failures are counted per AMQP `messageId`. A message without one is counted as failures in a row, which assumes it comes straight back before the messages behind it: true for a classic queue with prefetch 1, not promised by a quorum queue, so set a `messageId` on messages sent to a quorum queue.

A stop or a pause waits for the message in hand, however long it takes, acknowledges it and takes no more. A halt does not wait: the connection is kept for the message in hand until it has ended, and it is acked then, so one that was recorded is not delivered again. One that the halt ended with an error goes back to the queue unless the channel keeps its content; then it is rejected as any other stored with an ERROR status. A channel started again meanwhile takes the messages behind it.

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
