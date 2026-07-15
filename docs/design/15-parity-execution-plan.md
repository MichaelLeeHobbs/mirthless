# 15 — Connector Parity Execution Plan (phased)

> **Status:** Draft for review · **Date:** 2026-07-15 · **Owner:** Michael Hobbs
> Turns the ranked gaps in [`12-connector-parity-gap-analysis.md`](./12-connector-parity-gap-analysis.md) into review-sized phases. Decisions locked in **D-182**.

## 0. Where we are

**Done** (merged): rank **4** (surface hidden runtime options) and rank **9** (SMTP config-driven multi-attachment).
**Decisions** (D-182): DB drivers = pg/mysql2/tedious bundled + oracledb optional; SFTP → File scheme + alias; non-Postgres DB rows = **JSON only** (no `<results>` XML — Mirth channels parsing it must rewrite transformers); JMS **deferred**.

**Remaining doc-12 gaps:** medium — 3, 5, 7, 8, 10; large — 1, 2, 6; deferred — 11; folded — 12 (into File schemes).

## 1. Principles

- **One phase = one reviewable PR** (large phases sub-split). No mega-branch.
- **Every connector gap is proven by a real-message E2E** through the harness (`packages/engine/src/__tests__/support/e2e-harness.ts`) — actually send a message through it — plus unit tests. Infra-needing suites go in the engine integration lane (`*.itest.ts`, docker `--profile test`).
- Each phase updates the **migration matrix** (doc 12 §7) + progress docs (CHANGELOG/DECISIONS/ROADMAP) and ticks its ROADMAP box.
- **Build reusable infra once:** the `${…}` substitution helper (P2) and the generalized cert-resolver (P1) are consumed by later phases — do them early.

## 2. Phases

### P1 — TLS everywhere via the Certificate module  (rank 8 + the TCP-TLS deferred from rank 4)  ·  M
Generalize the HTTP cert pattern (already shipped) to the other TLS-capable connectors.
- Make `connector-tls-resolver` connector-agnostic (resolve cert-IDs → PEM for **TCP source/dest** and **DICOM**), and extend the `engine.ts` deploy + `connection-test` resolution seam beyond the current `=== 'HTTP'` gate.
- **TCP TLS:** surface enable + `CertificateSelect` on the TCP source/dest forms (server cert for the listener; CA/client for the dispatcher); server resolves IDs at deploy.
- **DICOM TLS:** wire `dcmjs-dimse` `securityOptions` (key/cert/ca, `requireClientCert`) on the Server/Client in `dcmjs-dimse-adapter.ts`; cert-ID references resolved server-side.
- **Tests:** resolver units (TCP/DICOM); real TLS handshake E2E — TLS TCP source↔dest, DICOM SCU↔SCP over TLS; web form tests. Reuse the certs fixture.
- **Risk:** M (TLS correctness). **Unblocks:** TLS TCP / latin1-secured HL7, secured (TLS) PACS.

### P2 — HTTP dispatcher completeness  (rank 5)  ·  M
- Outbound **Basic + Digest** auth (preemptive option); **query-parameters** table + form-urlencoded body; multi-valued **header maps**; a shared **`${…}` substitution helper** (reads message maps) applied across URL/headers/params/body; capture **response headers + status** into `connectorMap`.
- **Files:** `http-dispatcher.ts`, new `substitute.ts` helper, `registry.ts`, `HttpDestinationForm.tsx`, defaults.
- **Tests:** dispatcher units (basic/digest challenge-response, params, subst, response capture); real E2E — HTTP dest → local server asserting the auth header/query it received; web tests.
- **Risk:** L–M. **Unblocks:** the many REST endpoints needing Basic/Digest or query params. **Note:** the `${…}` helper is reused by P6/P7.

### P3 — TCP framing flexibility  (rank 3)  ·  M
- Configurable frame **start/end bytes** (hex, multi-byte) replacing the hardcoded VT/FS+CR in `mllp-mode.ts`; a **Basic (non-MLLP) mode** with delimiter/regex batch splitting; `ignoreResponse` / `queueOnResponseTimeout` semantics.
- **Tests:** frame-parser units (custom bytes, split packets, multi-msg-per-chunk resync), Basic-mode batch split; real E2E — custom-framed TCP source↔dest; web tests.
- **Risk:** M (protocol-critical; keep the DoS `maxFrameBytes` guard). **Unblocks:** non-standard-LLP / delimited TCP partners.

### P4 — Binary data type across TCP/HTTP  (rank 10)  ·  M
- A **Buffer-based content path** so TCP + HTTP can carry binary (imaging/PDF/non-text); `BINARY` in the data-type layer; base64 at the sandbox boundary. Coordinates with non-connector **N2** (declared pass-through datatypes) but scoped to the binary connector path here.
- **Tests:** binary round-trip E2E (TCP + HTTP); data-type-layer units.
- **Risk:** M (touches the content/serialization spine — guard the string path).

### P5 — Document Writer connector  (rank 7)  ·  M
- New **PDF/RTF destination** connector: `documentType`, template with `${…}` subst, page size, encrypt + password (`pdf-lib`/`pdfkit` for PDF). Register in `registry.ts` + the connector-type enum.
- **Tests:** connector units (PDF/RTF bytes, encryption); real E2E — message → rendered document (assert PDF magic + encryption); web form.
- **Risk:** L (self-contained new connector). **Unblocks:** rendered clinical docs/letters (no workaround today).

### P6 — Multi-vendor Database connector  (rank 1)  ·  L  ·  own PR(s)
Driver abstraction, per D-182.
- **P6a** — `DbDriver` interface + adapters: **pg** (existing) + **mysql2** + **tedious** (SQL Server), bundled; JSON rows only; keep `FOR UPDATE SKIP LOCKED` for pg. Web: driver select.
- **P6b** — Database **JavaScript mode** (source + dest); aggregate-into-one-message, result cache, fetch size, connector-level retry, encoding.
- **P6c** — **oracledb** as an *optional* lazy peer (absence never breaks a non-Oracle install; Instant Client documented).
- **Infra:** add **mysql** + **mssql** to docker-compose `--profile test`; integration lane suites per driver.
- **Tests:** per-driver integration (real DBs) + JS-mode units + real E2E per driver.
- **Risk:** M–H (native deps, per-vendor SQL). **Unblocks:** the most channels (Oracle/SQL Server/MySQL/JS-mode DB).

### P7 — File scheme abstraction  (rank 2 + fold SFTP + rank 12 WebDAV)  ·  L  ·  own PR(s)
Scheme abstraction (Mirth's `FileSystemConnectionFactory`), per D-182.
- **P7a** — scheme abstraction + **local** + **FTP/FTPS**; **fold SFTP** in as a scheme with the standalone connector kept as a thin **alias + migration shim** (deprecate the standalone config); File depth options (regex filter, recursion, batch, `errorReadingAction`/`errorMoveToDirectory`, size min/max, rename-on-move).
- **P7b** — **SMB** + **S3**.
- **P7c** — **WebDAV** (rank 12).
- **Infra:** add **ftp** + **smb (samba)** + **minio (S3)** to docker-compose `--profile test`.
- **Tests:** per-scheme upload↔poll cascade E2E (integration lane) + an SFTP-alias back-compat test.
- **Risk:** M–H. **Unblocks:** FTP/FTPS/SMB/S3 File channels; fixes the connector-proliferation anti-pattern.

### P8 — Web Service / SOAP connector  (rank 6)  ·  L  ·  own PR
- New **SOAP dispatcher** (WSDL-driven; `strong-soap`/`soap`) + **SOAP listener** source. Register.
- **Tests:** dispatcher units (WSDL binding, envelope); real E2E — SOAP source↔dispatcher loopback (or a local mock SOAP server); web forms.
- **Risk:** M. **Unblocks:** brownfield SOAP (LIS/RIS/EMR, IHE, state registries).

### Deferred
- **Rank 11 (JMS)** — deferred until a customer signal (D-182).

## 3. Recommended sequence & the value-vs-risk call

Two defensible orders:

- **A. Momentum-first (recommended): P1 → P2 → P3 → P4 → P5, then P6 → P7 → P8.**
  Closes five partial gaps quickly at low/medium risk, and builds the reusable `${…}` helper (P2) and generalized cert-resolver (P1) *before* the big phases consume them. The three large phases then land as isolated, heavily-reviewed PRs.
- **B. Blockers-first: P6 → P7 → P1…P5 → P8.**
  Doc 12 ranks by *channels unblocked*, so DB (P6) and File (P7) are the highest-value — but also the riskiest, and doing them first means the big native-dep changes land while the shared helpers don't exist yet.

**Recommendation: A.** Same total scope, but every large phase benefits from infra built by the mediums, and early PRs stay small and fast to review.

## 4. Cross-cutting

- **Test infra:** P6/P7 need new docker `--profile test` services (mysql, mssql, ftp, smb, minio); the integration-lane gate pattern (`integration/gates.ts`) extends cleanly.
- **New deps:** mysql2, tedious, (oracledb optional), pdf-lib/pdfkit, basic-ftp, an SMB client, `@aws-sdk/client-s3`, webdav, strong-soap/soap. Each added in its phase.
- **`connectorType` enum + registry** grow with each new connector (Document Writer, SOAP); web connector-type lists + defaults + settings forms follow.
- **Out of scope here:** the non-connector gaps (doc 13, N1–N15) and beyond-Mirth (doc 14) — separate plans.

## 5. Rough effort

| Phase | Gaps | Effort | New infra/deps |
|---|---|---|---|
| P1 TLS-via-certs | 8 (+TCP TLS) | M | — |
| P2 HTTP dispatcher | 5 | M | — |
| P3 TCP framing | 3 | M | — |
| P4 Binary type | 10 | M | — |
| P5 Document Writer | 7 | M | pdf-lib |
| P6 Multi-vendor DB | 1 | L (×3) | mysql2, tedious, oracledb*, docker mysql/mssql |
| P7 File schemes | 2, 12 | L (×3) | basic-ftp, smb, s3, webdav, docker ftp/smb/minio |
| P8 SOAP | 6 | L | strong-soap |

*optional peer.
