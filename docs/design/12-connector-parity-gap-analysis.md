# 12 — Connector Parity Gap Analysis (Mirthless vs Mirth Connect / OIE 4.6.0)

> **Status:** Draft for review · **Date:** 2026-07-14 · **Owner:** Michael Hobbs
> **Scope:** Connector feature parity only. Engine/pipeline/UI gaps are noted where they block a connector capability but are otherwise out of scope.
> **Baselines compared:** Mirthless `feature/real-e2e-testing` · Mirth reference source `reference/connect/` · OIE (Open Integration Engine) **4.6.0** at `C:\Users\mhobb\WebstormProjects\_temp\engine`.

---

## 0. Executive Summary

Mirthless is **close to Mirth/OIE on connector breadth** and **ahead on modern safety** (native TLS/mTLS, DoS guards, constant-time credential compare, `FOR UPDATE SKIP LOCKED`, modern `fetch`/`AbortSignal`, first-class FHIR + IMAP). But there are **real connector shortfalls**, and the two most dangerous are not missing connectors — they are **"silent partials"**: connectors that look complete in the UI but cannot reach the targets real hospitals actually use.

**Verdict on the "don't fall short on connectors" red line:** we currently fall short in five places that block whole classes of channel migration:

| # | Gap | Class | Why it matters |
|---|-----|-------|----------------|
| 1 | **Database connector is PostgreSQL-only** | 🔴 Silent blocker | Every Database Reader/Writer pointed at Oracle/SQL Server/MySQL cannot migrate. Looks done; isn't. |
| 2 | **File connector is local-disk-only** (no FTP/FTPS/SMB/S3/WebDAV) | 🔴 Silent blocker | File channels over remote transports cannot migrate. SFTP exists but as a *separate* connector. |
| 3 | **No Web Service / SOAP connector** | 🔴 Missing | Blocks brownfield hospital installs still on SOAP (LIS/RIS/EMR, IHE, state registries). |
| 4 | **TCP/MLLP framing is hardcoded** (VT/FS+CR only, no Basic mode) | 🔴 Degraded | Partners using non-standard LLP bytes or delimited framing cannot be integrated. |
| 5 | **No Document Writer** (PDF/RTF) & **no JMS** | 🟡 Missing | No workaround for rendered clinical documents; JMS narrow but high-value for large IDNs. |

A recurring **cross-cutting theme**: several capabilities are **implemented in the connector runtime but not exposed in the UI forms** (`connector-defaults.ts` + `*Form.tsx`). Even where the engine can do the thing, the user can't reach it. This is cheap to fix and should be its own pass.

**Severity legend used throughout:**

- 🔴 **Blocker** — a channel using this cannot be migrated at all, or is fundamentally broken.
- 🟡 **Degraded** — the channel migrates but silently loses a capability it had in Mirth.
- 🟢 **Parity / Ahead** — equal to or better than Mirth.

---

## 1. Methodology

Six parallel source-reading passes diffed each connector's full option surface. Mirth side: the `*Properties`, `*Receiver`, `*Dispatcher`, and filesystem/scheme classes under `reference/connect/`. Mirthless side: `packages/connectors/src/**`, the runtime wiring in `packages/connectors/src/registry.ts`, and the **UI option surface** in `packages/web/src/components/channels/{source,destinations}/**` including `connector-defaults.ts`.

**OIE divergence check:** OIE 4.6.0 (Gradle build, `version=4.6.0`) has an **identical connector set** to the reference snapshot — 11 connectors (`dimse, doc, file, http, jdbc, jms, js, smtp, tcp, vm, ws`) and the **identical six File schemes** (`FILE, FTP, SFTP, S3, SMB, WEBDAV`). No connectors or schemes were added or removed vs the reference. Divergence is packaging/module layout only. **Conclusion: the reference-based findings below are valid for OIE 4.6.0.**

**Resolved during analysis:** Mirth's per-destination `template` (Velocity string that builds outbound content) has **no gap** in Mirthless. `packages/engine/src/pipeline/message-processor.ts:535-545` runs a full **destination transformer** and hands the resulting `destContent` to the dispatcher. A full transformer script strictly supersedes a Velocity template — **we are ahead here.** Dispatchers correctly send pre-transformed content; this is not a defect.

---

## 2. Connector-by-Connector Findings

### 2.1 🔴 Database (`jdbc`) — **PostgreSQL-only, the #1 silent blocker**

**Current state.** Mirth's connector is JDBC-based and DB-agnostic: `DriverInfo.getDefaultDrivers()` ships **MySQL, Oracle, PostgreSQL, SQL Server/Sybase (jTDS), Microsoft SQL Server, SQLite**, plus a **Custom** option (any JDBC driver class + URL). Mirthless hardwires PostgreSQL — `packages/connectors/src/database/connection-pool.ts` imports `pg` and builds a `pg.Pool`; configs accept `host/port/database/username/password` (no driver, no JDBC URL); `DatabaseSourceForm.tsx` defaults port 5432 with no vendor selector.

> **Critical distinction:** Mirthless's "PostgreSQL-only" *storage* decision (its own message store) is deliberate and correct. The **Database connector**, however, talks to **external customer databases** — those are frequently Oracle/SQL Server/MySQL. Vendor-locking the connector is an unintended consequence of reusing `pg`, not a design decision.

| Capability | Mirth | Mirthless | Sev |
|---|---|---|---|
| Multi-vendor target DB | 6 built-in drivers + Custom JDBC | **Postgres only** (`pg`) | 🔴 |
| JavaScript mode (`useScript`) both R+D | Yes | **Not supported** | 🔴 |
| SQL mode (receiver + dispatcher) | Yes | Yes | 🟢 |
| Select-then-update polling | `updateMode` NEVER/ONCE/EACH | NEVER/ALWAYS/ON_SUCCESS | 🟢 |
| Update-**once** (aggregate post-SQL) | Yes (ONCE) | Per-row only | 🟡 |
| Aggregate results into one message | Yes (`<results>` XML) | **No** (one msg/row) | 🟡 |
| Cache results | Yes | **No** | 🟡 |
| Row output format | XML (`resultMapToXml`) | JSON | 🟡 (format change) |
| Retry count / interval | Yes (3 / 10s) | **No** connector-level retry | 🟡 |
| Fetch size | Yes (1000) | **No** | 🟡 |
| Encoding config | Yes | **No** | 🟡 |
| Concurrent-safe claim | No | **`FOR UPDATE SKIP LOCKED`** | 🟢 Ahead |

**What needs to be fixed.**
1. **Introduce a driver abstraction** in `packages/connectors/src/database/` — a `DbDriver` interface (`connect`, `query`, `stream`, `close`) with implementations backed by `pg`, `mysql2`, `tedious` (SQL Server), and `oracledb`. **Do not fork the connector per vendor.** Config gains a `driver` discriminator + optional raw connection string.
2. **Config + Zod schema changes** (`core-models`): add `driver: 'postgres' | 'mysql' | 'sqlserver' | 'oracle'` and vendor-specific fields (e.g. Oracle SID/service name, SQL Server instance/domain auth).
3. **Form work:** vendor selector in `DatabaseSourceForm.tsx` / `DatabaseDestinationForm.tsx`; default port keys off vendor.
4. **Parameter binding per dialect** — `query-builder.ts` currently emits `$N` (Postgres). MySQL/SQL Server use `?`; Oracle uses `:name`. The driver layer must own placeholder translation.
5. **JavaScript mode:** add a `useScript` path for receiver and dispatcher that runs a sandbox script returning rows / performing writes (parity with Mirth's `DatabaseReceiverScript`/`DatabaseDispatcherScript`).
6. Add **retry count/interval**, **fetch size**, and an **aggregate-results** option (batch rows into one message).

**Migration impact.** Oracle/SQL Server/MySQL/SQLite/Custom-JDBC Database channels **cannot migrate today**. JavaScript-mode DB channels have **no equivalent**. Postgres SQL-mode per-row channels migrate cleanly and gain safer concurrent claiming.

---

### 2.2 🔴 File — **local-disk-only vs Mirth's six-scheme connector**

**Current state.** Mirth's File connector is **scheme-pluggable**: one connector, six backends via `FileSystemConnectionFactory` + `SchemeProperties` (`FileScheme`: FILE, FTP/FTPS, SFTP, S3, SMB, WEBDAV). Mirthless implements **local FILE only** and has a **separate standalone SFTP connector** — SFTP is *not* a File scheme, and FTP/SMB/S3/WebDAV do not exist anywhere.

**Schemes (the headline gap):**

| Scheme | Mirth | Mirthless | Sev |
|---|---|---|---|
| Local FILE | Yes | Yes | 🟢 |
| SFTP | Scheme (key auth, passphrase, knownHosts, hostKeyChecking) | **Separate connector**, not a scheme | 🟡 (architecture) |
| **FTP / FTPS** | Yes (passive mode, secure, init commands) | **None** | 🔴 |
| **SMB (Windows share)** | Yes (jCIFS, SMB1–3.1.1 dialect range) | **None** | 🔴 |
| **Amazon S3** | Yes (region, cred chain, STS temp creds, custom headers) | **None** | 🔴 |
| **WebDAV** | Yes (http/https) | **None** | 🟡 (rare) |

**Local-FILE option gaps:**

| Capability | Mirth | Mirthless | Sev |
|---|---|---|---|
| File filter | wildcard **or regex** | glob only (no `**`/classes) | 🟡 |
| Directory recursion | Yes | **No** | 🟡 |
| ignoreDot (skip dotfiles) | Yes | **No** | 🟢 low |
| File age check | Yes | Yes | 🟢 |
| File size min/max + ignoreMax | Yes | **No** | 🟢 low |
| Sort by name/size/date | Yes | Yes | 🟢 |
| Post-process MOVE/DELETE | + rename (`moveToFileName`) | no rename | 🟢 low |
| **Error-reading action** + error-move-dir | Separate `errorReadingAction` / `errorMoveToDirectory` | **No** (single quarantine ledger) | 🟡 |
| Batch processing | Yes | **No** | 🟡 |
| Dispatcher `errorOnExists` | Yes | **No** | 🟢 low |
| Temp-file-then-rename | Yes | Yes (`tempFileEnabled`) | 🟢 |

**What needs to be fixed.**
1. **Introduce a filesystem-scheme abstraction** mirroring Mirth's `FileSystemConnectionFactory`: a `FileSystem` interface (`list`, `read`, `write`, `move`, `delete`, `exists`) with implementations for local, FTP/FTPS (`basic-ftp`), SFTP (`ssh2-sftp-client`), SMB (`@marsaud/smb2` or similar), and S3 (`@aws-sdk/client-s3`).
2. **Fold the standalone SFTP connector back in as a scheme.** Proliferating one-connector-per-transport is the wrong path and we've already started down it — collapse before it spreads. (Decision: deprecate the standalone SFTP connector with a migration shim, or keep it as a thin alias over the scheme.)
3. **Config/Zod:** File connector gains `scheme` discriminator + per-scheme fields (host/port/creds, FTP passive/secure, SFTP key/passphrase/knownHosts, S3 region/bucket/creds).
4. **Form work:** scheme selector + conditional per-scheme field groups in the File source/destination forms.
5. **Local-file depth:** add regex filter option, directory recursion, batch mode, distinct error-reading action + error-move-dir, dispatcher `errorOnExists`.

**Migration impact.** File channels over FTP(S)/SMB/S3 **cannot migrate today**. SFTP channels migrate but require **config reshaping** (separate connector → scheme). Local-file channels migrate but may lose regex filters / recursion / batch.

---

### 2.3 🔴/🟡 TCP / MLLP — **hardcoded framing, hidden runtime options**

**Current state.** Mirth exposes fully configurable transmission via `FrameModeProperties`/`FrameStreamHandler`: arbitrary N-byte start/end sequences parsed from hex, plus a **Basic mode** (no framing; delimiter/regex batch readers). Mirthless's `MllpParser` recognizes **only** single VT (`0x0B`) start and FS+CR (`0x1C 0x0D`) end — hardcoded in `transmission/mllp-mode.ts`, no configurability, no Basic/LLP-without-CR.

**Also critical:** the runtime (`registry.ts`) wires `tls`, `charset`, `responseMode`, `maxFrameBytes`, `acquireTimeoutMs`, but the **UI forms + `connector-defaults.ts` expose only host/port/maxConnections** (+ responseTimeout on dest). The forms carry TODO comments acknowledging this. **These capabilities exist in code but are unreachable by users.**

| Capability | Mirth | Mirthless | Sev |
|---|---|---|---|
| Configurable start/end bytes (hex, multi-byte) | Yes | **Hardcoded VT/FS+CR** | 🔴 |
| Basic / non-MLLP framing (delimiter/regex batch) | Yes | **No** | 🔴 |
| TLS on TCP | Yes (plugin) | Runtime yes, **UI no** | 🔴 (unreachable) |
| Charset in UI (latin1 common in real HL7) | Yes | Runtime yes, **UI no** | 🟡 |
| Client (reverse) listener mode + reconnect | Yes | **No** (server-only) | 🟡 |
| Respond on new connection + response addr/port | Yes | **No** (same socket) | 🟡 |
| Binary data type | Yes | **No** (string only) | 🟡 |
| `ignoreResponse` / `queueOnResponseTimeout` | Yes | **No** | 🟡 |
| Bytes-before-start reporting | Raises `FrameStreamHandlerException` | Silently discards | 🟢 low |
| DoS max-frame cap | No | **`maxFrameBytes`** | 🟢 Ahead |
| Built-in HL7 ACK/NAK auto-gen | Config | **Built-in AUTO_ACK** | 🟢 Ahead |
| Split-packet / multi-msg-per-chunk resync | Yes | Yes | 🟢 |

**What needs to be fixed.**
1. **Configurable framing:** replace the hardcoded VT/FS+CR in `mllp-mode.ts` with a frame spec `{ startBytes: number[], endBytes: number[] }` parsed from hex in config; add a **Basic mode** (no framing) with delimiter/regex batch splitting.
2. **Surface hidden runtime options in the UI:** TLS, charset, responseMode into `connector-defaults.ts` + the TCP source/dest forms. (Highest ROI item in the whole doc — the engine already supports these.)
3. Add **binary data type**, **`ignoreResponse`/`queueOnResponseTimeout`** queueing semantics, and consider **client-listener mode** + **respond-on-new-connection** for the minority of partners that need them.

**Migration impact.** Non-standard-framing / Basic-mode / delimited TCP channels **cannot migrate**. TLS-secured and non-UTF-8 (latin1) HL7 feeds are un-migratable **until the forms surface the existing runtime support** — a UI gap, not an engine gap.

---

### 2.4 🟡 HTTP — **missing outbound auth & parameters; strong on TLS**

**Current state.** Listener supports path match, single method filter, Basic + bearer-token inbound auth (constant-time compare), content-type response, `maxBodyBytes` DoS guard, and **native TLS/mTLS + custom CA** wired end-to-end. Client supports URL, method, single-valued headers, response body + status class, `AbortSignal` timeout, and the recently added **client TLS/mTLS + custom CA + `rejectUnauthorized`** (confirmed in `tls.ts` → `readTlsClientOptions` → `registry.ts` → `HttpDestinationForm.tsx`).

| Capability | Mirth | Mirthless | Sev |
|---|---|---|---|
| **Outbound Basic/Digest auth** (+ preemptive) | Yes | **None** | 🔴 |
| **Query-parameters / form-urlencoded table** | Yes | **None** | 🔴 |
| Inbound auth Digest/OAuth/custom | Plugin (Jetty security handler) | Basic + bearer only | 🟡 |
| Multi-valued headers table + `${var}` subst | Yes | Single-valued `Record`, no subst | 🟡 |
| Static-resource serving | Yes | **None** | 🟡 |
| XML-body / multipart / binary-by-MIME | Yes | **None** (raw UTF-8 only) | 🟡 |
| Response header/status capture to map | Yes (`connectorMap`) | **None** (body + status class) | 🟡 |
| gzip request/response | Yes | **None** | 🟡 |
| Proxy support | Yes | **None** | 🟡 |
| Pervasive `${...}` variable substitution | Yes | **None** | 🟡 |
| Body-size DoS cap | No | **`maxBodyBytes`** | 🟢 Ahead |
| TLS / mTLS + custom CA (in UI) | Plugin | **Native, in-form** | 🟢 Ahead |
| Modern `fetch` + `AbortSignal` + const-time compare | No (Apache HC) | **Yes** | 🟢 Ahead |

**What needs to be fixed.**
1. **Outbound auth** on the dispatcher: Basic + Digest, with preemptive option. (Highest-impact HTTP item — countless REST endpoints require Basic auth.)
2. **Query-parameters table** + form-urlencoded body support on the dispatcher; multi-valued header maps on both sides.
3. `${...}` **variable substitution** across URL/headers/params/body (needs a small substitution helper reading the message maps).
4. Response **header/status capture** into the connector map so downstream steps can branch on them.
5. Lower priority: static-resource serving, gzip, XML/multipart/binary body modes, proxy.

**Migration impact.** HTTP channels using outbound Basic/Digest auth or query-parameter tables **break or degrade**. TLS/mTLS channels are **ahead** of Mirth.

---

### 2.5 🟢 DICOM (`dimse`) — solid, missing secured-PACS

**Current state.** Genuinely strong: `dcmjs-dimse-adapter.ts` performs real association negotiation, per-presentation-context accept/reject, ~11 transfer syntaxes, C-STORE + C-ECHO (source + dest).

| Capability | Mirth | Mirthless | Sev |
|---|---|---|---|
| Association negotiation / context accept-reject | Yes | Yes | 🟢 |
| C-STORE / C-ECHO | Yes | Yes | 🟢 |
| **DICOM TLS** (keyStore/trustStore/PW) | Yes | **No** | 🟡 |
| PDU length tuning (snd/rcv pdulen) | Yes | **No** | 🟢 low |
| Async operations window | Yes | **No** | 🟢 low |

**What needs to be fixed.** Add **DICOM TLS** (cert/key/trust config) for secured PACS; expose PDU-length tuning. (The prior association-rejection handling bug is **resolved** via the dcmjs-dimse port, D-181.)

**Migration impact.** Plain PACS channels migrate. **Secured (TLS) PACS cannot** until DICOM TLS lands.

---

### 2.6 🟢 SMTP — near parity

**Current state.** `smtp-dispatcher.ts` has TLS/STARTTLS, auth, html/plain, cc/bcc, attachments. Correctly send-only.

| Capability | Mirth | Mirthless | Sev |
|---|---|---|---|
| TLS/STARTTLS, auth, html/plain, cc/bcc | Yes | Yes | 🟢 |
| Attachments | Rich multi-`Attachment` (per-item name/MIME/content) | **Single hardcoded `message.txt`** | 🟡 |

**What needs to be fixed.** Replace the single hardcoded `message.txt` attachment with a multi-attachment array (name/MIME/content per item), sourced from the message's attachment set.

---

### 2.7 🟢 Channel (`vm`) & JavaScript (`js`) — parity

Both present as source + destination with equivalent behavior (channel-to-channel routing with `waitForResponse`; JS polling receiver + dispatcher). No notable gaps. Sandbox/scope-API depth not diffed here — tracked separately under the sandbox design doc.

---

### 2.8 🔴/🟡 Missing connectors

| Connector | Sev | What it does in Mirth | What needs to be built |
|---|---|---|---|
| **Web Service / SOAP (`ws`)** | 🔴 | Receiver + dispatcher; WSDL binding, SOAP handlers, servlet (`WebServiceDispatcher.java`, 904 lines) | A SOAP client dispatcher (WSDL-driven, `strong-soap` or `soap`) + a SOAP listener source. Needed for legacy LIS/RIS/EMR, IHE SOAP transactions, state registries. |
| **Document Writer (`doc`)** | 🟡 | Destination generating **PDF/RTF** (documentType, template, encrypt + password, page size) | A document dispatcher rendering PDF/RTF (`pdfkit`/`pdf-lib` for PDF; encryption + page size). No workaround exists today for rendered clinical documents/letters. |
| **JMS** | 🟡 | Receiver + dispatcher + client (`JmsDispatcher.java`, 487 lines) | A JMS/AMQP bridge (`rhea`/`amqplib`, or a JMS-over-STOMP client). Narrow but high-value for large IDNs with ActiveMQ/IBM MQ backbones. Defer unless a customer needs it. |

---

## 3. Connectors We Have That Mirth Core Does Not

| Connector | Note |
|---|---|
| **FHIR** dispatcher | Core to us; **plugin/extension-only in Mirth**. Strategic differentiator for modern interop. |
| **Email / IMAP + POP3 source** | Inbound email ingestion; Mirth's SMTP is send-only. Ours-only in core. |
| **SFTP** (standalone) | First-class here; a File scheme in Mirth. (See §2.2 — recommend folding into a File scheme.) |

---

## 4. Cross-Cutting Issues

1. **Form-vs-runtime surfacing gap (🟡, cheap to fix).** TCP TLS/charset/responseMode (and likely others) are implemented in the connector runtime but not exposed in `connector-defaults.ts` / `*Form.tsx`. **Action:** audit every connector for runtime options with no form surface; this is the highest ROI work in the doc.
2. **No scheme/driver abstraction (🔴, architectural).** The two biggest gaps (multi-vendor DB, multi-scheme File) both stem from missing an abstraction Mirth has (`DriverInfo`, `FileSystemConnectionFactory`). Build these two abstractions rather than bolting on vendors/transports ad hoc, and **stop creating standalone per-transport connectors** (SFTP was the first wrong step).
3. **Migration is not just XML/`a..b` syntax (🔴).** The accepted breaking changes (special XML syntax, Rhino→Node) are surface-level. The **un-migratable** channels (Oracle/SQL Server DB, FTP/SMB/S3 File, SOAP) are the real migration story and need explicit messaging + a compatibility matrix for adopters.
4. **Binary data handling is thin across connectors (🟡).** TCP and HTTP are string/UTF-8 only; Mirth supports binary data types throughout. Needed for imaging, PDFs, and non-text feeds.

---

## 5. Where We Already Exceed Mirth/OIE

- **First-class FHIR** connector (plugin-only in Mirth) and **IMAP/POP3 inbound email**.
- **Native TLS/mTLS + custom CA** surfaced in-UI on HTTP (both directions); DICOM/TCP runtime TLS present.
- **DoS guards** (`maxBodyBytes`, `maxFrameBytes`), **constant-time** credential comparison.
- **`FOR UPDATE SKIP LOCKED`** concurrent message claiming (Mirth lacks this).
- **Modern `fetch` / `AbortSignal`** timeouts; built-in **AUTO_ACK** HL7 generation.
- **Full destination transformer** replacing Mirth's weaker Velocity `template` field.

---

## 6. Prioritized Remediation Roadmap

Ranked by **channels unblocked**, not effort. Effort is a rough T-shirt size.

| Rank | Item | Sev | Effort | Rationale |
|---|---|---|---|---|
| 1 | **Multi-vendor Database connector** (driver abstraction: pg/mysql2/tedious/oracledb) + JS mode | 🔴 | L | Most channels unblocked; silent blocker today. |
| 2 | **File scheme abstraction + FTP/FTPS, SMB, S3**; fold SFTP in as a scheme | 🔴 | L | Second-most channels; also fixes the connector-proliferation anti-pattern. |
| 3 | **Configurable TCP framing + Basic mode** | 🔴 | M | Unblocks non-standard HL7 partners; contained change to `mllp-mode.ts`. |
| 4 | **Surface hidden runtime options in forms** (TCP TLS/charset first, then audit all) | 🟡 | S | Cheapest wins; capability already exists. |
| 5 | **HTTP outbound auth (Basic/Digest) + parameters table + `${}` subst** | 🟡 | M | Common REST requirement; mostly form/connector surface. |
| 6 | **Web Service / SOAP connector** (source + dispatcher) | 🔴 | L | Unblocks brownfield SOAP hospital installs. |
| 7 | **Document Writer (PDF/RTF)** | 🟡 | M | High routine demand; no workaround. |
| 8 | **DICOM TLS** (cert/key/trust) | 🟡 | M | Secured PACS. (Assoc-rejection bug already fixed, D-181.) |
| 9 | **SMTP multi-attachment** | 🟡 | S | Small, closes SMTP parity. |
| 10 | **Binary data type** across TCP/HTTP | 🟡 | M | Imaging/PDF/non-text feeds. |
| 11 | **JMS connector** | 🟡 | L | Defer unless a specific enterprise/IDN customer needs it. |
| 12 | **WebDAV File scheme** | 🟢 | S | Rare; do last, alongside File schemes. |

---

## 7. Migration Impact Matrix (for adopters)

| Channel uses… | Migratable today? | Blocked on |
|---|---|---|
| Postgres Database Reader/Writer (SQL mode) | ✅ Yes (gains safer claiming) | — |
| Oracle / SQL Server / MySQL / SQLite DB | ❌ No | Rank 1 |
| Database JavaScript mode | ❌ No | Rank 1 |
| Local File | ✅ Mostly (may lose regex/recursion/batch) | Rank 2 (depth) |
| SFTP File | ⚠️ Config reshape | Rank 2 |
| FTP/FTPS / SMB / S3 File | ❌ No | Rank 2 |
| Standard MLLP TCP | ✅ Yes | — |
| Custom-framing / Basic / delimited TCP | ❌ No | Rank 3 |
| TLS TCP / latin1 HL7 | ⚠️ Engine yes, UI no | Rank 4 |
| HTTP (no auth / bearer) | ✅ Yes (TLS ahead) | — |
| HTTP outbound Basic/Digest or query params | ⚠️ Degraded | Rank 5 |
| SOAP / Web Service | ❌ No | Rank 6 |
| Document Writer (PDF/RTF) | ❌ No | Rank 7 |
| Plain PACS DICOM | ✅ Yes | — |
| Secured (TLS) PACS DICOM | ❌ No | Rank 8 |
| SMTP send | ✅ Yes (single attachment) | Rank 9 (depth) |
| Channel / JavaScript / FHIR / IMAP | ✅ Yes | — |
| JMS | ❌ No | Rank 11 |

---

## 8. Open Decisions

1. **SFTP connector fate** — deprecate the standalone connector in favor of a File scheme (with a migration shim), or keep it as a thin alias? *Recommendation: alias over the scheme, deprecate the standalone config shape.*
2. **DB driver bundling** — bundle all four drivers (`oracledb` is a heavy native dep) or make Oracle/SQL Server optional peer installs? *Recommendation: pg/mysql2/tedious bundled; oracledb optional.*
3. **Row output format for non-Postgres** — keep JSON (our default) or offer Mirth-compatible XML output for easier migration? *Recommendation: JSON default, XML opt-in flag.*
4. **JMS scope** — build now or wait for a customer signal? *Recommendation: defer (Rank 11).*

---

## 9. Appendix — Key File References

**Mirthless connectors:** `packages/connectors/src/{tcp-mllp,http,file,sftp,database,dicom,smtp,channel,javascript,fhir,email}/*.ts`, `packages/connectors/src/registry.ts`
**Mirthless forms:** `packages/web/src/components/channels/source/{ConnectorSettingsSection,connector-defaults}.tsx|ts`, `.../destinations/{DestinationConnectorSettings,connector-defaults}.tsx|ts`
**Destination transformer flow:** `packages/engine/src/pipeline/message-processor.ts:535-545`
**Mirth reference:** `reference/connect/server/src/com/mirth/connect/connectors/{tcp,http,file,jdbc,dimse,smtp,vm,js,ws,jms,doc}/**`, `reference/connect/core-server-plugins/.../file/filesystems/*Connection.java`, `reference/connect/.../core/file/FileScheme.java`, `.../DriverInfo.java`
**OIE 4.6.0:** `C:\Users\mhobb\WebstormProjects\_temp\engine` (Gradle, `server/src/main/java/com/mirth/connect/connectors/**`)
