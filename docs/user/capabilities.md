# What GalvaniFlow can do

This page lists what GalvaniFlow does today beside what it does not do yet, one row per capability, so users can see what it covers and maintainers can see the gaps. Each row has a status, its limits, the plan for what is missing, and the automated tests that prove it.

## How to read this page

Status is one of four words:

- **Yes**: it works, and an automated test that runs in the gate or in CI proves it.
- **Partial**: it works with a limit named in the Limits column, or its only proof is a local or manual check.
- **No**: it is missing. Limits names a workaround, or says "none known". Plan names the issue or ROADMAP item that tracks it.
- **Won't**: it was decided against. Plan names the decision in [DECISIONS.md](../progress/DECISIONS.md) and quotes it.

Proof lists test files. Where each one runs decides how much it proves:

- `packages/**/src/**/*.test.ts(x)` runs in `pnpm gate` on every change.
- `packages/server/test/integration/**/*.itest.ts`, `packages/connectors/src/__tests__/e2e/integration/*.itest.ts` and `e2e/*.spec.ts` run in CI against real Postgres, protocol servers and a browser.
- `e2e/scenarios/*.scenario.ts` (the Mirth migration suite, `pnpm test:scenarios`) runs on a developer machine only.
- `docs/testing/*.md` checklists are run by hand.

Plan is where to look for what happens next. `ROADMAP N13` means the item tagged `[N13]` in [ROADMAP.md](../progress/ROADMAP.md); `#160` is a GitHub issue. Comment there to say you need it.

## Connectors

The [connector reference](connector-reference.md) lists every connector and its settings. This section covers what that page cannot: connectors, schemes and database vendors that are missing, and settings that do nothing.

| Capability | Status | Limits | Plan | Docs | Mirth | Proof |
|---|---|---|---|---|---|---|
| Receive and send HL7 over TCP/MLLP | Yes | Framing bytes can be changed through the API and Mirth import only; the form has no field for them. | | [connector-reference.md#tcp_mllp-as-a-source](connector-reference.md#tcp_mllp-as-a-source) | TCP Listener, TCP Sender | `packages/connectors/src/tcp-mllp/__tests__/tcp-mllp-receiver.test.ts`<br>`packages/connectors/src/tcp-mllp/__tests__/tcp-mllp-dispatcher.test.ts`<br>`packages/connectors/src/transmission/__tests__/mllp-mode.test.ts` |
| Receive and send over HTTP | Yes | The HTTP Sender's query parameters and Basic credentials work but have no form fields yet. | | [connector-reference.md#http-as-a-source](connector-reference.md#http-as-a-source) | HTTP Listener, HTTP Sender | `packages/connectors/src/http/__tests__/http-receiver.test.ts`<br>`packages/connectors/src/http/__tests__/http-dispatcher.test.ts` |
| Read and write files on local disk | Yes | Local disk and OS mounts only. | | [connector-reference.md#file-as-a-source](connector-reference.md#file-as-a-source) | File Reader, File Writer (file scheme) | `packages/connectors/src/file/__tests__/file-receiver.test.ts`<br>`packages/connectors/src/file/__tests__/file-dispatcher.test.ts` |
| Read and write files over SFTP | Yes | A separate connector today, not a File scheme. | | [connector-reference.md#sftp-as-a-source](connector-reference.md#sftp-as-a-source) | File Reader, File Writer (sftp scheme) | `packages/connectors/src/sftp/__tests__/sftp-receiver.test.ts`<br>`packages/connectors/src/sftp/__tests__/sftp-dispatcher.test.ts`<br>`packages/connectors/src/__tests__/e2e/integration/connector-sftp.itest.ts` |
| Read and write PostgreSQL | Yes | Rows arrive as JSON objects. | | [connector-reference.md#database-as-a-source](connector-reference.md#database-as-a-source) | Database Reader, Database Writer | `packages/connectors/src/database/__tests__/database-receiver.test.ts`<br>`packages/connectors/src/database/__tests__/database-dispatcher.test.ts`<br>`packages/server/test/integration/database-receiver.itest.ts`<br>`packages/connectors/src/__tests__/e2e/integration/connector-db.itest.ts` |
| Read and write MySQL/MariaDB | Partial | Rows arrive as JSON objects. Tested only with a mocked driver and the local migration scenario; no CI test runs against a real MySQL or MariaDB server. | | [connector-reference.md#database-as-a-source](connector-reference.md#database-as-a-source) | Database Reader, Database Writer | `packages/connectors/src/database/__tests__/mysql-pool.test.ts`<br>`e2e/scenarios/s15-database-writer-mysql.scenario.ts` |
| Generate and send messages with a JavaScript reader or writer | Yes | | | [connector-reference.md#javascript-as-a-source](connector-reference.md#javascript-as-a-source) | JavaScript Reader, JavaScript Writer | `packages/connectors/src/javascript/__tests__/javascript-receiver.test.ts`<br>`packages/connectors/src/javascript/__tests__/javascript-dispatcher.test.ts`<br>`packages/connectors/src/__tests__/e2e/connector-js.e2e.test.ts` |
| Pass messages between channels | Yes | | | [connector-reference.md#channel-as-a-source](connector-reference.md#channel-as-a-source) | Channel Reader, Channel Writer | `packages/connectors/src/channel/__tests__/channel-receiver.test.ts`<br>`packages/connectors/src/channel/__tests__/channel-dispatcher.test.ts` |
| Send email over SMTP | Yes | | | [connector-reference.md#smtp-as-a-destination](connector-reference.md#smtp-as-a-destination) | SMTP Sender | `packages/connectors/src/smtp/__tests__/smtp-dispatcher.test.ts`<br>`packages/connectors/src/__tests__/e2e/integration/connector-mail.itest.ts` |
| Read email over IMAP | Yes | `includeAttachments` and the pool settings are accepted but not used (#154). | | [connector-reference.md#email-as-a-source](connector-reference.md#email-as-a-source) | none (Mirth has no email reader) | `packages/connectors/src/email/__tests__/email-receiver.test.ts`<br>`packages/connectors/src/__tests__/e2e/integration/connector-mail.itest.ts` |
| Read email over POP3 | No | Use IMAP; an Email source set to POP3 refuses to deploy. | [#172](https://github.com/MichaelLeeHobbs/mirthless/issues/172) | | none (Mirth has no email reader) | |
| Send resources to a FHIR server | Yes | The message must already be a FHIR resource. Redirects are not followed; a 3xx is an ERROR. | | [connector-reference.md#fhir-as-a-destination](connector-reference.md#fhir-as-a-destination) | FHIR Sender (paid in Mirth) | `packages/connectors/src/fhir/__tests__/fhir-dispatcher.test.ts` |
| Receive and send DICOM images (C-STORE) | Yes | C-STORE only; no C-FIND, C-MOVE or C-GET (D-088). No TLS. | | [connector-reference.md#dicom-as-a-source](connector-reference.md#dicom-as-a-source) | DICOM Listener, DICOM Sender | `packages/connectors/src/dicom/__tests__/dicom-receiver.test.ts`<br>`packages/connectors/src/dicom/__tests__/dicom-dispatcher.test.ts`<br>`packages/connectors/src/__tests__/e2e/connector-dicom.e2e.test.ts` |
| Consume and publish Kafka records | Yes | At least once. Kafka over TLS has not been run against a real broker (#151). | [#151](https://github.com/MichaelLeeHobbs/mirthless/issues/151) | [connector-reference.md#kafka-as-a-source](connector-reference.md#kafka-as-a-source) | none | `packages/connectors/src/kafka/__tests__/kafka-receiver.test.ts`<br>`packages/connectors/src/kafka/__tests__/kafka-dispatcher.test.ts`<br>`packages/connectors/src/__tests__/e2e/integration/connector-queue.itest.ts` |
| Consume and publish AMQP (RabbitMQ) messages | Yes | At least once. An empty username connects as guest. | | [connector-reference.md#amqp-as-a-source](connector-reference.md#amqp-as-a-source) | none | `packages/connectors/src/amqp/__tests__/amqp-receiver.test.ts`<br>`packages/connectors/src/amqp/__tests__/amqp-dispatcher.test.ts`<br>`packages/connectors/src/__tests__/e2e/integration/connector-queue.itest.ts` |
| Exactly-once delivery across Kafka or AMQP | Won't | Delivery is at least once; deduplicate downstream. | D-261 "no exactly-once across systems" | | | |
| Read and write files over FTP or FTPS | No | Mount the share with the OS and use the File connector. | ROADMAP 2 | | File Reader, File Writer (ftp scheme) | |
| Read and write files on SMB shares | No | Mount the share with the OS and use the File connector. | ROADMAP 2 | | File Reader, File Writer (smb scheme) | |
| Read and write files in Amazon S3 | No | A JavaScript reader or writer calling `httpFetch`. | ROADMAP 2 | | File Reader, File Writer (s3 scheme) | |
| Read and write files over WebDAV | No | A JavaScript reader or writer calling `httpFetch`. | ROADMAP 12 | | File Reader, File Writer (webdav scheme) | |
| Read and write SQL Server | No | none known; a channel that uses it refuses to deploy and says why. | ROADMAP 1 | | Database Reader, Database Writer | |
| Read and write Oracle | No | none known; a channel that uses it refuses to deploy and says why. | ROADMAP 1 | | Database Reader, Database Writer | |
| Database Reader and Writer in JavaScript mode | No | Use a JavaScript reader or writer with `dbQuery` on a Data Source. | ROADMAP 1 | | Database Reader, Database Writer (Use JavaScript) | |
| Database Reader rows as Mirth `<results>` XML | Won't | Rows arrive as JSON; rewrite transformers that parsed the XML. | D-182 "do NOT implement Mirth's" | | Database Reader | |
| Receive FHIR (as a source) | No | An HTTP source with a JSON transformer. | ROADMAP V12 | | FHIR Listener (paid in Mirth) | |
| Web Service (SOAP) listener and sender | No | An HTTP source or destination carrying the SOAP envelope as XML. | ROADMAP 6 | | Web Service Listener, Web Service Sender | |
| Write PDF or RTF documents | No | none known | ROADMAP 7 | | Document Writer | |
| DICOM over TLS | No | Run DICOM inside a VPN or TLS tunnel. | ROADMAP 8 | | DICOM Listener, DICOM Sender (TLS) | |
| Send and receive JMS messages | No | Deferred until a customer needs it (D-182, D-261). Use AMQP if the broker speaks it. | ROADMAP 11 | | JMS Listener, JMS Sender | |
| HTTP Sender Digest authentication | No | Build the `Authorization` header in a JavaScript writer. | ROADMAP 5 | | HTTP Sender (Digest) | |
| HTTP Sender OAuth2 with token refresh | No | Fetch the token in a script and set the header. | ROADMAP V11 | | | |
| Shared OAuth2 credential vault | No | none known | ROADMAP B10 | | | |
| DICOM and Email settings that take effect | No | none known; DICOM `maxAssociations` and the Email pool and attachment settings are accepted and ignored. | [#154](https://github.com/MichaelLeeHobbs/mirthless/issues/154) | | | |

## Access control

| Capability | Status | Limits | Plan | Docs | Mirth | Proof |
|---|---|---|---|---|---|---|
| Local user accounts with passwords | Yes | Admins create accounts; there is no self-registration. | | [../ops/hipaa-security-checklist.md](../ops/hipaa-security-checklist.md) | Users | `packages/server/src/services/__tests__/user.service.test.ts`<br>`packages/server/src/controllers/__tests__/user.controller.test.ts`<br>`e2e/auth.spec.ts`<br>`e2e/user-management.spec.ts` |
| Four built-in roles checked on every route that needs a permission | Yes | admin, deployer, developer and viewer, fixed in code. The preference routes and `/me/password` have no permission check by design; see [access-control.md](access-control.md#endpoints-any-signed-in-user-or-anyone-can-call). | | | Role-based access (paid in Mirth) | `packages/server/src/lib/__tests__/role-permissions.test.ts`<br>`packages/server/src/middleware/__tests__/permission.middleware.test.ts`<br>`packages/server/src/routes/__tests__/route-permissions.test.ts` |
| Define custom roles | No | none known; the four roles are fixed. | ROADMAP N13 | | Custom roles (paid in Mirth) | |
| Limit a user to some channels | No | none known; `messages:read` covers every channel's messages. | [#160](https://github.com/MichaelLeeHobbs/mirthless/issues/160) | | | |
| Separate permission for bulk message export | No | none known; `messages:read`, held by viewers, also exports messages and downloads attachments. | [#172](https://github.com/MichaelLeeHobbs/mirthless/issues/172) | [../ops/hipaa-security-checklist.md](../ops/hipaa-security-checklist.md) | | |
| Single sign-on (OIDC or SAML) | No | none known. Entra ID is tracked in #148. | ROADMAP V4 | | SSO (paid in Mirth) | |
| LDAP or Active Directory sign-in | No | none known | ROADMAP V4 | | LDAP (paid in Mirth) | |
| Second factor at sign-in (MFA) | No | none known. Passkeys are tracked in #143. | [#142](https://github.com/MichaelLeeHobbs/mirthless/issues/142) | | MFA (paid in Mirth) | |
| API tokens for machine callers | No | A service account that signs in with a password. | [#144](https://github.com/MichaelLeeHobbs/mirthless/issues/144) | | | |
| Password rules | Partial | 8 to 128 characters with a letter and a digit, not configurable. An admin reset does not force a change. | ROADMAP V4 | | | `packages/core-models/src/schemas/__tests__/user.schema.test.ts` |
| Lock an account after failed sign-ins | Yes | 5 failures lock the username for 15 minutes, so anyone can lock out a known username. When a lock expires the count starts again. | | [../ops/hipaa-security-checklist.md](../ops/hipaa-security-checklist.md) | | `packages/server/src/services/__tests__/auth-audit.service.test.ts`<br>`packages/server/src/services/__tests__/auth-lockout.service.test.ts` |
| Rate-limit sign-in attempts | Yes | Per IP; applies only with `NODE_ENV=production` and a correct `TRUST_PROXY`. | | [../ops/deployment.md](../ops/deployment.md) | | `packages/server/src/middleware/__tests__/rate-limit.middleware.test.ts`<br>`packages/server/src/routes/__tests__/auth-rate-limit.test.ts` |
| Idle session timeout | No | Sign out, or disable the user to end their sessions. | [#172](https://github.com/MichaelLeeHobbs/mirthless/issues/172) | [../ops/hipaa-security-checklist.md](../ops/hipaa-security-checklist.md) | | |
| Maximum session length | Partial | `JWT_REFRESH_EXPIRES_IN` sets the session length, but each refresh starts a new session, so an open tab stays signed in. | | [../ops/deployment.md](../ops/deployment.md) | | `packages/server/src/services/__tests__/session-lifetime.test.ts`<br>`packages/server/src/services/__tests__/auth-refresh.service.test.ts` |
| Cut off a user by disabling the account | Yes | REST access ends at once; open sockets are re-checked every 60 seconds. | | | | `packages/server/src/services/__tests__/auth-refresh.service.test.ts`<br>`packages/server/src/services/__tests__/user.service.test.ts` |
| Audit sign-ins and sign-outs | Yes | Includes sign-ins rejected for an unknown user, a wrong password or a locked or disabled account, with the reason. Requests refused by the rate limit (429) or by input validation (400) are not audited. | | [../ops/hipaa-security-checklist.md](../ops/hipaa-security-checklist.md) | Event log | `packages/server/src/services/__tests__/auth-audit.service.test.ts` |
| Audit access to message content (PHI) | Partial | Views, searches, exports and attachment downloads are audited. Cross-channel search and refused requests are not, and an event is dropped if its write fails. | [#158](https://github.com/MichaelLeeHobbs/mirthless/issues/158) | [../ops/hipaa-security-checklist.md](../ops/hipaa-security-checklist.md) | Event log | `packages/server/src/controllers/__tests__/message.controller.test.ts`<br>`packages/server/src/controllers/__tests__/message-export.controller.test.ts`<br>`packages/server/src/controllers/__tests__/attachment.controller.test.ts` |
| Emergency (break-glass) access | No | Keep a sealed second admin account. | [#141](https://github.com/MichaelLeeHobbs/mirthless/issues/141) | [../ops/hipaa-security-checklist.md](../ops/hipaa-security-checklist.md) | | |
| System use notice before sign-in | No | none known | [#135](https://github.com/MichaelLeeHobbs/mirthless/issues/135) | | Login warning banner | |

## Certificates

Mirth Connect sells certificate management as its SSL Manager extension. GalvaniFlow includes it.

| Capability | Status | Limits | Plan | Docs | Mirth | Proof |
|---|---|---|---|---|---|---|
| Certificate store with issuer and expiry | Yes | The HTTP, Kafka and AMQP connectors pick certificates from the store; TCP/MLLP takes raw PEM and DICOM has no TLS. Private keys are stored in plaintext in the database and masked in API responses. | | [../ops/tls-and-phi.md](../ops/tls-and-phi.md) | SSL Manager (paid in Mirth) | `packages/server/src/services/__tests__/certificate.service.test.ts`<br>`packages/web/src/lib/__tests__/certificate-expiry.test.ts`<br>`e2e/certificates.spec.ts` |
| Alert before a certificate expires | No | The Certificates page marks certificates that expire soon. | [#204](https://github.com/MichaelLeeHobbs/mirthless/issues/204) | | | |

## Data types

| Capability | Status | Limits | Plan | Docs | Mirth | Proof |
|---|---|---|---|---|---|---|
| HL7 v2 messages read and edited by path | Yes | Read and written with `msg.get('PID.5.1')`, not E4X. | | [scripting-api.md](scripting-api.md) | HL7 v2.x | `packages/core-util/src/hl7/__tests__/hl7-message.test.ts`<br>`packages/core-util/src/hl7/__tests__/hl7-path.test.ts`<br>`packages/engine/src/pipeline/__tests__/data-type-handler.test.ts` |
| Split an HL7 v2 batch into messages | Yes | Splits on MSH and drops the FHS/BHS envelope. | | | HL7 v2.x batch | `packages/core-util/src/hl7/__tests__/hl7-batch.test.ts`<br>`packages/server/src/__tests__/engine-process-batch.test.ts` |
| Build HL7 v2 acknowledgements | Yes | | | [scripting-api.md](scripting-api.md) | ACK generator | `packages/core-util/src/hl7/__tests__/hl7-ack.test.ts`<br>`packages/connectors/src/tcp-mllp/__tests__/ack-builder.test.ts` |
| XML messages | Yes | A changed document keeps its order and comments, but loses the line break after the XML declaration. | | [scripting-api.md](scripting-api.md) | XML | `packages/engine/src/pipeline/__tests__/data-type-handler.test.ts`<br>`packages/engine/src/pipeline/__tests__/xml-order.test.ts` |
| JSON messages | Yes | Numbers keep their spelling unless a script changes them. | | [scripting-api.md](scripting-api.md) | JSON | `packages/engine/src/pipeline/__tests__/data-type-handler.test.ts` |
| Delimited (CSV) messages read by column name | Yes | No fixed-width columns. | | [scripting-api.md](scripting-api.md) | Delimited Text | `packages/core-util/src/__tests__/delimited.test.ts`<br>`packages/engine/src/pipeline/__tests__/data-type-handler.test.ts` |
| X12 messages read and edited by path | Partial | No envelope validation, 999/TA1 acknowledgements or X12 batch splitting. | | [scripting-api.md](scripting-api.md) | EDI/X12 | `packages/core-util/src/__tests__/x12.test.ts` |
| Raw text messages | Yes | | | | Raw | `packages/engine/src/pipeline/__tests__/data-type-handler.test.ts` |
| FHIR messages | Partial | Passed to scripts as text; parse with `JSON.parse`. No validation. | ROADMAP B7 | | FHIR | `packages/engine/src/pipeline/__tests__/data-type-handler.test.ts` |
| HL7 v3 and CDA messages | Partial | Passed to scripts as text, so `msg` mapping is not possible. | ROADMAP N2 | | HL7 v3.x | |
| DICOM to XML | No | none known; a DICOM message is the received file's path, and there is no XML view of its tags. | ROADMAP N2 | | DICOM | |
| NCPDP pharmacy messages | No | Treat as Raw and parse in a script. | ROADMAP N1 | | NCPDP | |
| Binary messages over TCP and HTTP | No | The File source reads binary as base64; Kafka and AMQP sources take a `base64` charset. | ROADMAP 10 | | Raw (binary) | |
| Convert to the channel's outbound data type | No | Build the outbound format in a transformer; destination content is written as the inbound type. | [#172](https://github.com/MichaelLeeHobbs/mirthless/issues/172) | | Outbound data type | |
| Validate HL7 against a conformance profile | No | Check fields in a filter script. | ROADMAP V10 | | Strict validation | |

## Mirth migration

The importer reads a Mirth channel export or server backup (`POST /api/v1/channels/import/mirth`, with a dry-run preview that returns warnings). This table is what each Mirth feature becomes. Scripts are not translated: E4X and Mirth's script APIs must be rewritten in GalvaniFlow's API (D-244), and the preview names the constructs it finds. The scenario suite proves whole channels end to end, but it runs on a developer machine only, so this section is not CI-proven beyond the importer's unit tests.

| Mirth feature | Imports as | Deploys | Warning at preview | Proof |
|---|---|---|---|---|
| TCP Listener (`TcpReceiverProperties`) | `TCP_MLLP` source with host, port and frame bytes | Yes | No | `packages/server/src/services/__tests__/mirth-import.service.test.ts`<br>`e2e/scenarios/s01-mllp-postprocessor-ack.scenario.ts`<br>`e2e/scenarios/s18-tcp-basic-framing.scenario.ts` |
| TCP Sender (`TcpDispatcherProperties`) | `TCP_MLLP` destination with host, port, template and frame bytes | Yes | No | `packages/server/src/services/__tests__/mirth-import.service.test.ts`<br>`e2e/scenarios/s06-queued-tcp-sender-ack.scenario.ts` |
| HTTP Listener (`HttpReceiverProperties`) | `HTTP` source serving every path under its context path | Yes | No | `packages/server/src/services/__tests__/mirth-import.service.test.ts`<br>`e2e/scenarios/s07-http-api-context-path.scenario.ts` |
| HTTP Sender (`HttpDispatcherProperties`) | `HTTP` destination with method, headers, parameters, content and Basic credentials | Yes; Digest credentials are dropped | No | `packages/server/src/services/__tests__/mirth-import.service.test.ts`<br>`e2e/scenarios/s17-http-sender-auth-params.scenario.ts` |
| File Reader and Writer, file scheme | `FILE` source or destination with the directory, file filter and move-to directory; the after-processing action, output pattern and append setting are dropped | Yes, with changed behaviour: a Reader deletes each file it reads, and a Writer names files `${messageId}.txt` | No ([#178](https://github.com/MichaelLeeHobbs/mirthless/issues/178)) | `packages/server/src/services/__tests__/mirth-import.service.test.ts` |
| File Reader and Writer, sftp scheme | `SFTP` source or destination | Yes, once the host key is entered when Mirth checked it | Yes, when host key checking is on | `packages/server/src/services/__tests__/mirth-import.service.test.ts`<br>`e2e/scenarios/s16-sftp-file-reader.scenario.ts` |
| File Reader and Writer, ftp, smb, s3 or webdav scheme | `FILE` connector without a directory | No | Yes | `packages/server/src/services/__tests__/mirth-import.service.test.ts` |
| Database Reader and Writer on PostgreSQL, MySQL or MariaDB | `DATABASE` with the vendor from the JDBC URL; Reader rows arrive as JSON | Yes | Yes, for the Reader's JSON rows | `packages/server/src/services/__tests__/mirth-import.service.test.ts`<br>`e2e/scenarios/s14-database-reader.scenario.ts`<br>`e2e/scenarios/s15-database-writer-mysql.scenario.ts` |
| Database Reader and Writer on SQL Server or Oracle | `DATABASE` with the vendor kept | No | Yes | `packages/server/src/services/__tests__/mirth-import.service.test.ts` |
| Database Reader and Writer in JavaScript mode | `DATABASE` with the script in the SQL field | No; the script fails as SQL | Yes | `packages/server/src/services/__tests__/mirth-import.service.test.ts` |
| Database URL that is a `${...}` reference or lists several hosts | `DATABASE` with no host, port or database | No, until filled in by hand | Yes | `packages/server/src/services/__tests__/mirth-import.service.test.ts` |
| JavaScript Reader and Writer | `JAVASCRIPT` source or destination with its script and polling interval | Yes | Only for Mirth-only constructs in the script | `packages/server/src/services/__tests__/mirth-import.service.test.ts`<br>`e2e/scenarios/s08-js-writer-outcome.scenario.ts`<br>`e2e/scenarios/s11-js-reader-poller.scenario.ts` |
| SMTP Sender | `SMTP` destination with server, credentials, addresses, subject and body | Yes | No | `packages/server/src/services/__tests__/mirth-import.service.test.ts`<br>`e2e/scenarios/s12-smtp-sender.scenario.ts` |
| Channel Reader and Writer | `CHANNEL` source or destination targeting the same channel id | Yes | No | `packages/server/src/services/__tests__/mirth-import.service.test.ts`<br>`e2e/scenarios/s02-lane-router.scenario.ts`<br>`e2e/scenarios/s09-dynamic-routing.scenario.ts` |
| DICOM Listener and Sender | `DICOM` by transport name, with Mirth's settings not mapped | No: port, AE titles and storage directory are dropped ([#171](https://github.com/MichaelLeeHobbs/mirthless/issues/171)) | Yes, but it wrongly says the connector defaults to JavaScript | none |
| Web Service, JMS, Document Writer and other connector classes | `JAVASCRIPT` connector with no script | No | Yes | `packages/server/src/services/__tests__/mirth-import.service.test.ts` |
| HL7 v2, XML, JSON and Raw data types | The same data type | Yes | No | `packages/server/src/services/__tests__/mirth-import.service.test.ts`<br>`e2e/scenarios/s03-hl7-edit.scenario.ts` |
| Delimited Text data type | `DELIMITED` with its separators and column names | Yes; fixed-width columns are split on the delimiter | Yes, on every Delimited channel (rows are read by column name), plus one for fixed-width columns ([#171](https://github.com/MichaelLeeHobbs/mirthless/issues/171)) | `packages/server/src/services/__tests__/mirth-import.service.test.ts`<br>`e2e/scenarios/s19-delimited-csv.scenario.ts` |
| EDI/X12 data type | `X12` | Yes | No | `packages/server/src/services/__tests__/mirth-import.service.test.ts`<br>`e2e/scenarios/s20-x12-eligibility.scenario.ts` |
| NCPDP, HL7 v3 and DICOM data types | The Mirth name kept as written | Not confirmed; content passes through as text | No | none |
| JavaScript filter rules and transformer steps | `JAVASCRIPT` rules and steps, in sequence order | Yes, once Mirth-only constructs are rewritten | Yes, once per channel | `packages/server/src/services/__tests__/mirth-import.service.test.ts`<br>`e2e/scenarios/s03-hl7-edit.scenario.ts` |
| Rule Builder filter rules | Rules with field, condition and values; a Mirth 4.x `RuleBuilderRule` gets type `RULEBUILDERRULE`, and an older `RULE_BUILDER` rule becomes a JavaScript rule with no script | No: the script compiler refuses the `RULEBUILDERRULE` type, and the empty JavaScript rule is skipped | No ([#171](https://github.com/MichaelLeeHobbs/mirthless/issues/171)) | `packages/server/src/services/__tests__/mirth-import.service.test.ts` |
| Mapper transformer steps | `MAPPER` steps | No (D-207) | No | none |
| Respond from a destination or the postprocessor | The matching response mode | Yes; an unmappable choice auto-generates after the destinations | Yes, for an unmappable choice | `packages/server/src/services/__tests__/mirth-import.service.test.ts`<br>`e2e/scenarios/s01-mllp-postprocessor-ack.scenario.ts`<br>`e2e/scenarios/s26-respond-before-processing.scenario.ts` |
| Process Batch on an HL7 v2 source | `processBatch` | Yes | No | `e2e/scenarios/s21-hl7-batch-file.scenario.ts` |
| Destination queue settings | Queue mode, retry count and interval | Yes | No | `packages/server/src/services/__tests__/mirth-import.service.test.ts`<br>`e2e/scenarios/s06-queued-tcp-sender-ack.scenario.ts` |
| Custom metadata columns | Metadata columns, filled after the source transformer | Yes; the editor cannot show them | No | `packages/server/src/services/__tests__/mirth-import.service.test.ts`<br>`e2e/scenarios/s10-metadata-columns.scenario.ts` |
| Code template libraries in a server backup | Libraries matched by name, with their channel scope | Yes | No | `packages/server/src/services/__tests__/mirth-code-templates.test.ts`<br>`packages/server/test/integration/mirth-code-templates.itest.ts`<br>`e2e/scenarios/s04-code-templates-backup.scenario.ts`<br>`e2e/scenarios/s25-template-library-scope.scenario.ts` |
| Deploy, undeploy and postprocessor scripts | Channel scripts; Mirth's do-nothing defaults are dropped | Yes, once Mirth-only constructs are rewritten | Yes, once per channel | `packages/server/src/services/__tests__/mirth-import.service.test.ts` |
| A disabled channel | A disabled channel | Stays undeployed | No | `packages/server/src/services/__tests__/mirth-import.service.test.ts`<br>`e2e/scenarios/s24-disabled-channel.scenario.ts` |
| Storage mode, encryption and pruning flags | Storage mode and encryption; pruning is never carried over, because Mirth keeps it in `exportData/metadata/pruningSettings`, which the importer does not read | Yes | No ([#171](https://github.com/MichaelLeeHobbs/mirthless/issues/171)) | `packages/server/src/services/__tests__/mirth-import.service.test.ts` |
| Polling by time of day or cron | The connector's default interval | Yes, on the wrong schedule | No ([#171](https://github.com/MichaelLeeHobbs/mirthless/issues/171)) | none |

## Pipeline and scripting

| Capability | Status | Limits | Plan | Docs | Mirth | Proof |
|---|---|---|---|---|---|---|
| Filter, transform and route messages through a channel | Yes | | | [quickstart-first-channel.md](quickstart-first-channel.md) | Channel pipeline | `packages/engine/src/pipeline/__tests__/message-processor.test.ts`<br>`packages/engine/src/pipeline/__tests__/destination-set.test.ts`<br>`packages/server/test/integration/channel-message-roundtrip.itest.ts`<br>`e2e/message-flow.spec.ts` |
| Write scripts in JavaScript or TypeScript | Yes | Scripts run on the main thread, so a tight loop blocks every channel until its timeout fires (D-212). The Monaco editor loads from a public CDN, so the script editors do not load without internet access. | | [scripting-api.md](scripting-api.md) | JavaScript (Rhino) | `packages/engine/src/sandbox/__tests__/sandbox-executor.test.ts`<br>`packages/engine/src/sandbox/__tests__/script-compiler.test.ts`<br>`packages/connectors/src/__tests__/e2e/ts-channel-scripts.e2e.test.ts` |
| Rule Builder filter rules | Yes | | | [scripting-api.md](scripting-api.md) | Rule Builder | `packages/engine/src/sandbox/__tests__/script-compiler.test.ts` |
| Mapper transformer steps | No | Write the mapping as a JavaScript step; a channel with a Mapper step does not deploy. | [#172](https://github.com/MichaelLeeHobbs/mirthless/issues/172) | | Mapper | |
| Iterator, XSLT and External Script steps | No | Loop in a JavaScript step. | ROADMAP N11 | | Iterator, XSLT, External Script | |
| Channel, connector, response, global and configuration maps | Yes | Shortcuts follow Mirth (`$c`, `$co`, `$r`, `$g`, `$gc`, `$s`, `$cfg`). | | [scripting-api.md](scripting-api.md) | Maps | `packages/engine/src/sandbox/__tests__/map-shortcuts.test.ts`<br>`packages/engine/src/pipeline/__tests__/map-continuity.test.ts`<br>`packages/server/test/integration/global-map.itest.ts` |
| Call HTTP, databases, collections and other channels from scripts | Yes | `httpFetch` reaches private hosts only if `SCRIPT_HTTP_ALLOWED_HOSTS` lists them. | | [scripting-api.md](scripting-api.md) | | `packages/engine/src/sandbox/__tests__/bridge-io-functions.test.ts`<br>`packages/server/src/__tests__/engine-bridges.test.ts`<br>`packages/server/test/integration/data-source.itest.ts` |
| Code templates shared across channels | Yes | | | [scripting-api.md](scripting-api.md) | Code Templates | `packages/engine/src/sandbox/__tests__/template-injector.test.ts`<br>`packages/server/src/services/__tests__/code-template.service.test.ts`<br>`e2e/code-templates.spec.ts` |
| Limit a code template library to some channels | Partial | Works through the API, backup and Mirth import; the Code Templates page cannot set it. | ROADMAP N12 | | Library channel scope | `packages/server/test/integration/code-template-scope.itest.ts` |
| Helper functions for dates, attachments and other common jobs | Partial | The scripting API covers HL7, maps and IO bridges; date and attachment helpers are missing. | ROADMAP N9 | [scripting-api.md](scripting-api.md) | userutil classes | |
| Standard helper library and a page on maps and the message model | Partial | [scripting-api.md](scripting-api.md) documents the maps and the HL7 message object. There is no standard helper library, and repeating segments can only be counted and read as raw text (`getSegmentCount`, `getSegmentString`), not iterated as objects. | ROADMAP V8 | [scripting-api.md](scripting-api.md) | | |
| Response transformers and response modes | Yes | | | | Response transformer, Respond from | `packages/engine/src/pipeline/__tests__/response-transformer.test.ts`<br>`packages/server/src/__tests__/engine-dispatch-status.test.ts` |
| Split batches by delimiter, regex or script | Partial | Only HL7 v2 Process Batch is reachable from a channel; the other splitters have no setting. | | | Batch processing | `packages/engine/src/batch/__tests__/batch-processor.test.ts` |
| E4X access to messages | Won't | Use the path API (`msg.get('PID.5.1')`). | D-244 "does not support E4X" | [scripting-api.md](scripting-api.md) | E4X | |
| Mirth script APIs (ResponseFactory, DateUtil, channelMap.put) | Won't | Rewrite in GalvaniFlow's API; the import preview names them. | D-244 "scripts are rewritten in GalvaniFlow's API" | [scripting-api.md](scripting-api.md) | userutil API | |
| Java classes, JAR loading or Python in scripts | Won't | Use JavaScript built-ins and the IO bridges. | D-260 "no Java interop, JAR loading or Python runtime" | | Java interop | |
| Multiple threads per destination queue | No | Split the load over several channels; destinations already run as parallel chains. | ROADMAP N7 | | Queue threads, Rotate | |
| Keep per-patient order while scaling out | No | none known | ROADMAP B3 | | Thread assignment variable | |
| Aggregator, wire-tap and dead-letter queue steps | No | Build an aggregator on a Collection in scripts. | ROADMAP B9 | | | |
| Validate and map FHIR in the pipeline | No | Validate in a script, or call an external validator with `httpFetch`. | ROADMAP B7 | | | |
| AI-assisted mapping and an LLM step | No | none known | ROADMAP B8 | | | |
| Assertion-based channel tests in CI | No | Export channels and test them with the scenario harness. | ROADMAP B5 | | | |
| Step-through debugger and live sample-message editing | No | Send a test message and read the message browser. | ROADMAP V3 | | | |

## Shared data

Named data that every channel's scripts can use, managed from the web UI and the REST API. Mirth Connect has nothing like Collections or Data Sources, and its global map is lost when the server restarts. The [access control](access-control.md#role-and-permission-matrix) page says which roles read and change each one.

| Capability | Status | Limits | Plan | Docs | Mirth | Proof |
|---|---|---|---|---|---|---|
| Keyed record store for scripts (Collections) | Yes | Records can hold PHI; reading them is not audited. | | [scripting-api.md#collections](scripting-api.md#collections) | none | `packages/server/src/services/__tests__/collection.service.test.ts`<br>`packages/server/test/integration/collection.itest.ts`<br>`e2e/collections.spec.ts` |
| Named database connections for scripts (Data Sources) | Yes | PostgreSQL only. Saving a password needs `CONTENT_ENCRYPTION_KEY`; the password is encrypted at rest and never returned. | | [scripting-api.md#data-sources](scripting-api.md#data-sources) | none | `packages/server/src/services/__tests__/data-source.service.test.ts`<br>`packages/server/test/integration/data-source.itest.ts`<br>`e2e/datasources.spec.ts` |
| Named files scripts read by name (Resources) | Yes | Content is stored as text. Scripts read a resource with `getResource`; channels do not load code from it. | | [scripting-api.md#optional-io-bridges](scripting-api.md#optional-io-bridges) | Resources (JAR libraries on the classpath, a different feature) | `packages/server/src/services/__tests__/resource.service.test.ts`<br>`e2e/resources.spec.ts` |
| Global map kept across restarts | Yes | Changes reach the database every 5 seconds, so a crash can lose the last few seconds of writes. Reads are not audited. | | [scripting-api.md#maps](scripting-api.md#maps) | Global map (lost on restart) | `packages/engine/src/runtime/__tests__/global-map-proxy.test.ts`<br>`packages/server/src/services/__tests__/engine-global-map.test.ts`<br>`e2e/global-map.spec.ts` |
| Edit the configuration map from the web UI | Yes | Values are returned in full to admin, deployer and developer, and reads are not audited. | | [scripting-api.md#maps](scripting-api.md#maps) | Configuration Map | `packages/server/src/services/__tests__/config-map.service.test.ts`<br>`e2e/config-map.spec.ts` |

## Messages and storage

| Capability | Status | Limits | Plan | Docs | Mirth | Proof |
|---|---|---|---|---|---|---|
| Store every message and its content in PostgreSQL | Yes | Storage mode is per channel. | | | Message storage | `packages/server/src/services/__tests__/engine-storage.test.ts`<br>`packages/server/test/integration/message-store.itest.ts`<br>`packages/server/test/integration/partition-manager.itest.ts` |
| Encrypt message content at rest | Partial | Off by default per channel; attachments are not encrypted; one key, no rotation. | | [../ops/tls-and-phi.md](../ops/tls-and-phi.md) | Encrypt data | `packages/server/src/services/__tests__/engine-encryption.test.ts`<br>`packages/server/src/lib/__tests__/content-crypto.test.ts` |
| Browse and search a channel's messages | Yes | | | | Message Browser | `packages/server/src/services/__tests__/message-query.service.test.ts`<br>`packages/server/test/integration/content-search.itest.ts`<br>`e2e/message-flow.spec.ts` |
| Search by regex, error and send attempts | Partial | Status, date, content and metadata equality work; regex, error-text and send-attempt filters do not. | ROADMAP N4 | | Advanced search | `packages/server/test/integration/metadata-search.itest.ts` |
| Custom metadata columns | Partial | Filled and searchable through the API; the channel editor cannot define them and the browser cannot show them. | ROADMAP N5 | | Custom Metadata | `packages/engine/src/pipeline/__tests__/metadata-columns.test.ts`<br>`packages/server/test/integration/metadata-search.itest.ts` |
| Search across channels | Yes | Not audited as PHI access. | | | Cross-channel search (paid in Mirth) | `packages/server/test/integration/cross-channel-search.itest.ts`<br>`e2e/cross-channel-search.spec.ts` |
| Reprocess and resend messages | Yes | | | | Reprocess, Resend | `packages/server/src/services/__tests__/message-reprocess.service.test.ts`<br>`packages/server/src/controllers/__tests__/message-reprocess.controller.test.ts` |
| Bulk and per-destination reprocess with guardrails | Partial | Bulk reprocess and per-destination resend exist; guardrails and a dead-letter queue do not. | ROADMAP V9 | | | `packages/server/src/services/__tests__/message-reprocess.service.test.ts` |
| Export messages | Yes | Any role with `messages:read` can export. | | | Export Results | `packages/server/src/services/__tests__/message-export.service.test.ts` |
| View and download attachments | Yes | | | | Attachments | `packages/server/src/services/__tests__/attachment.service.test.ts` |
| Prune old messages on a schedule | Yes | Off by default per channel. | | | Data Pruner | `packages/server/src/services/__tests__/data-pruner.service.test.ts`<br>`packages/server/test/integration/data-pruner.itest.ts` |
| Archive messages before pruning | No | Back up the database before pruning runs. | ROADMAP N8 | | Data Pruner archive | |
| Recover messages after a crash | Yes | | | | Recovery | `packages/engine/src/runtime/__tests__/recovery-manager.test.ts`<br>`packages/server/src/services/__tests__/engine-recovery.test.ts`<br>`packages/server/test/integration/recovery-query.itest.ts` |

## Channels

| Capability | Status | Limits | Plan | Docs | Mirth | Proof |
|---|---|---|---|---|---|---|
| Create, edit, clone and delete channels | Yes | | | [quickstart-first-channel.md](quickstart-first-channel.md) | Channels | `packages/server/src/services/__tests__/channel.service.test.ts`<br>`packages/server/src/services/__tests__/channel-clone.service.test.ts`<br>`e2e/channel-crud.spec.ts` |
| Deploy, start, stop and pause channels | Yes | | | | Dashboard controls | `packages/server/src/services/__tests__/deployment.service.test.ts`<br>`e2e/channel-deploy.spec.ts` |
| Deploy channels in dependency order | Yes | | | | Channel dependencies | `packages/server/src/services/__tests__/channel-dependency.service.test.ts` |
| Keep channel revision history | Yes | No side-by-side diff. | | | | `packages/server/src/services/__tests__/channel-revision.service.test.ts`<br>`packages/server/src/controllers/__tests__/channel-revision.controller.test.ts` |
| Export and import channels as JSON | Yes | | | | Export/Import Channel | `packages/server/src/services/__tests__/channel-export.service.test.ts`<br>`packages/server/src/services/__tests__/channel-import.service.test.ts`<br>`packages/server/test/integration/channel-export-import.itest.ts` |
| Export a set of channels with their templates, dependencies, groups and tags | Partial | A channel exports alone; use a server backup for the rest. | ROADMAP N14 | | Export with code templates | `packages/server/src/services/__tests__/channel-export.service.test.ts` |
| Organize channels in groups and tags | Yes | A channel belongs to one group. | | | Channel groups, tags | `packages/server/src/services/__tests__/channel-group.service.test.ts`<br>`packages/server/src/services/__tests__/tag.service.test.ts`<br>`e2e/channel-groups.spec.ts`<br>`e2e/tags.spec.ts` |
| Send a test message to a channel | Yes | | | | Send Message | `packages/server/src/__tests__/engine-send-message.test.ts` |
| Generate sample HL7 v2 messages | Yes | ADT^A01, ORM^O01, ORU^R01 and SIU^S12 only, up to 100 per request. | | | | `packages/server/src/services/__tests__/message-generator.service.test.ts` |
| Import Mirth channels and server backups | Partial | See the Mirth migration section; scripts must be rewritten. | | | | `packages/server/src/services/__tests__/mirth-import.service.test.ts`<br>`e2e/scenarios/s04-code-templates-backup.scenario.ts` |
| Promote channels from test to production | No | Export JSON and import it on the next server. | ROADMAP B6 | | | |
| Git, CI/CD and revision diff for channels | No | Keep exported JSON in Git by hand. | ROADMAP V2 | | | |
| Generated channel docs and a guided first channel | No | Follow the quickstart. | ROADMAP V13 | [quickstart-first-channel.md](quickstart-first-channel.md) | | |

## Monitoring and alerts

| Capability | Status | Limits | Plan | Docs | Mirth | Proof |
|---|---|---|---|---|---|---|
| Live dashboard of channel state and counts | Yes | | | | Dashboard | `packages/server/src/services/__tests__/statistics.service.test.ts`<br>`packages/server/src/services/__tests__/socket-emission.test.ts`<br>`e2e/dashboard.spec.ts` |
| Alert by email on channel errors | Yes | Throttle state is lost on restart, so a restart can send one extra alert (D-217). | | | Alerts | `packages/engine/src/alerts/__tests__/alert-evaluator.test.ts`<br>`packages/engine/src/alerts/__tests__/alert-manager.test.ts`<br>`packages/server/test/integration/alert.itest.ts`<br>`e2e/alerts.spec.ts` |
| Alert when a channel receives nothing for a while | Yes | | | | | `packages/engine/src/alerts/__tests__/alert-evaluator.test.ts`<br>`packages/server/src/__tests__/engine-silence.test.ts` |
| Alert on queue depth and error rate | No | Scrape `/metrics` with Prometheus and alert there. | ROADMAP B1 | [../ops/resource-and-observability.md](../ops/resource-and-observability.md) | | |
| Webhook alert action and an error triage view | No | An alert email to a mail-to-webhook bridge. | ROADMAP V1 | | | |
| Scope an alert to one connector or error stage | No | Filter in the alert's channel list and read the message. | ROADMAP N15 | | Alert per connector | |
| Connection status per connector | No | Read the server log and the channel state. | ROADMAP N10 | | Dashboard connection status | |
| Prometheus metrics | Yes | No per-channel labels yet (N10). | | [../ops/resource-and-observability.md](../ops/resource-and-observability.md) | | `packages/server/src/lib/__tests__/metrics.test.ts`<br>`packages/server/src/middleware/__tests__/metrics.middleware.test.ts` |
| Health endpoints for probes | Yes | | | [../ops/deployment.md](../ops/deployment.md) | | `packages/server/src/services/__tests__/health.service.test.ts` |
| Event log of user and system actions | Yes | | | | Events | `packages/server/src/services/__tests__/event.service.test.ts`<br>`packages/server/src/services/__tests__/event-export.service.test.ts`<br>`e2e/events.spec.ts` |
| Server log viewer | Yes | In memory, last 10,000 entries. | | | Server Log | `packages/server/src/services/__tests__/log-stream.service.test.ts` |
| Script logger output in the message browser | No | none known; logger output is collected and discarded. | [#164](https://github.com/MichaelLeeHobbs/mirthless/issues/164) | [scripting-api.md](scripting-api.md) | logger | |
| Trace a message across channels with OpenTelemetry | No | Follow the `correlationId` in the logs. | ROADMAP B4 | | | |
| Push alerts to a phone | No | Email to an SMS gateway. | [#147](https://github.com/MichaelLeeHobbs/mirthless/issues/147) | | | |

## Operations

| Capability | Status | Limits | Plan | Docs | Mirth | Proof |
|---|---|---|---|---|---|---|
| Run in production with Docker Compose | Partial | Images fail to build from a checkout with installed dependencies (#137). No automated test proves the stack. | [#137](https://github.com/MichaelLeeHobbs/mirthless/issues/137) | [../ops/deployment.md](../ops/deployment.md) | | |
| Back up and restore server configuration | Yes | Messages are not included; the export is unencrypted JSON. | | [../ops/backup-restore.md](../ops/backup-restore.md) | Backup/Restore Config | `packages/server/src/services/__tests__/server-backup.service.test.ts` |
| Shut down without losing messages | Partial | The shutdown tests cover only the order of the steps and the exit codes; what happens to in-flight messages has no automated test. | | [../ops/upgrade.md](../ops/upgrade.md) | | `packages/server/src/lib/__tests__/shutdown.test.ts` |
| Manage the server from a CLI | Won't | Script the REST API with `curl`; see [api-automation.md](../ops/api-automation.md). | D-280 "A CLI comes back only when someone needs one" | [api-automation.md](../ops/api-automation.md) | Mirth CLI | |
| OpenAPI description of the REST API | Yes | | | | Swagger API | `packages/server/src/lib/__tests__/openapi.test.ts` |
| Generated API clients and an MCP server | No | Generate a client from the OpenAPI description. | ROADMAP V14 | | | |
| Automatic failover to a standby node | No | Run one node; a second node duplicates inbound messages on single-listener sources. | ROADMAP B2 | | Advanced Clustering (paid in Mirth) | |
| Active-active clustering at no cost | No | none known | ROADMAP V6 | | | |
| Upgrade with migration tests per release | Partial | Database migrations run at start, and CI applies them to an empty database. No test upgrades a database from an earlier release, and there is no published Node LTS policy. | ROADMAP V7 | [../ops/upgrade.md](../ops/upgrade.md) | | |
| Published CVE process, SBOM and outside pen test | No | Track Dependabot alerts (#100). | ROADMAP V5 | [../ops/hipaa-security-checklist.md](../ops/hipaa-security-checklist.md) | | |
