# Mirthless Release-Readiness Review — 2026-07-12

Deep re-review on `main` @ `1eb03d1`, after the Wave 1–3 production-readiness program.
Method: 6 parallel specialist code audits (engine, security, connectors, server API, web UI, ops/docs/tests)
+ a second independent engine pass + live browser walkthrough of the admin console + direct code verification
of every headline finding. This supersedes the "all blockers fixed" status in `memory/release-readiness-blockers.md`.

**Verdict: NOT release-ready.** Build/lint/test are genuinely green (2,176 unit tests, 0 skipped; CI gates
build → lint → unit → real-DB integration → e2e). The prior review's infra blockers (LICENSE, migrations-in-image,
user docs, unauthed `/metrics`, no integration/e2e in CI) are genuinely fixed, and the **VM sandbox RCE is genuinely
closed** (empirically un-escapable on Node 24, including advanced `Error.prepareStackTrace` and thenable-assimilation
vectors). But this pass found a fresh cluster of **silent message-loss** bugs, **two independent ways graceful
shutdown fails**, **credential/PHI exposure**, and **UI features wired to nothing** that block a credible healthcare v1.

The recurring theme: `MessageStore` write Results are systematically ignored inside the pipeline, the batch
fast-path methods bypass the storage/cleanup policies, and several UI surfaces (scripting IO, certificates, resources,
extensions, archive-pruning) present capabilities the backend does not actually implement.

---

## Good news — verified fixed since the prior review

- **VM sandbox RCE — closed.** Prod wires `new VmSandboxExecutor()` with no bridges; all escape vectors throw
  `process is not defined`. Two advanced vectors tested empirically on Node 24 and could not escape.
- **Queue path — fixed.** `dequeue` is a single atomic `UPDATE … RETURNING` with camelCase aliases; `send_attempts`
  incremented in SQL; retry cap correct; `FOR UPDATE SKIP LOCKED` claim + `resetPending` at deploy.
- **RBAC — wired end-to-end.** `defaultRoles` → `role-permissions` → `user_permissions` at create → auth middleware
  loads per request → `permission.middleware` enforces. UI has a real permission layer (`use-permissions`,
  `RequirePermission`). The "zero RBAC / dead RBAC" memory notes are **stale**.
- **Message content encryption — real** AES-256-GCM, fail-loud, deploy refuses encryptData without a key, decrypt
  on all read paths. (Attachments are the exception — see B4.)
- **Destination filter/transformer errors — no longer swallowed** (route to error content + ERROR + alert).
- **TCP/MLLP flagship — largely fixed:** real ACK/NAK generation from inbound MSH, remote AE/AR NAK recorded as
  ERROR, MLLP+HTTP TLS/mTLS, idle-pooled-socket handler (no more process kill).
- **Connector UI contract drift — fixed.** The `contextPath`/`methods` → `path`/`method` bug class is gone; all 19
  connector forms match what the registry reads (verified live: HTTP source now shows Path / Allowed Method).
- **Ops/docs — dramatically improved:** LICENSE (MIT), SECURITY.md, user docs (`docs/user/` scripting-api,
  connector-reference, quickstart), ops runbooks, non-root Docker image, migrations run fail-loud in entrypoint,
  `/metrics` double-protected.

---

## BLOCKERS (must fix before any healthcare deployment)

### B1. Every destination send uses `messageId: 0` → File/SFTP silently overwrite one file
`packages/server/src/engine.ts:355` — `sendFn` hardcodes `messageId: 0` (the `SendToDestination` signature carries
no id). FILE default output pattern is `${messageId}.txt` (`registry.ts:152`), SFTP `${messageId}.dat`, with
`tempFileEnabled:true`/`appendMode:false`. Every message resolves to `0.txt` and atomically overwrites the previous.
A lab-results channel delivers exactly **one** file regardless of volume — all others marked SENT, permanently gone,
no error. Also poisons `${messageId}` in SMTP templates, DB inserts, and `msg.messageId` in JS destination scripts.
*Confirmed by 3 independent audits + direct read.* Fix: thread the real messageId through `SendToDestination`
(available at both the pipeline and queue-consumer call sites).

### B2. Graceful shutdown is broken two independent ways → every SIGTERM is a hard kill
1. **Undeploy throws on started channels.** `server.ts:56` loops `engine.undeploy(id)` directly; `engine.ts:475`
   calls `runtime.undeploy()` which throws `Cannot undeploy: channel is STARTED` (`channel-runtime.ts:173`).
   `source.onUndeploy()` (stops the listener) sits *after* that check → never runs. First started channel aborts
   the loop; `shutdown.ts` → `process.exit(1)`.
2. **Socket.IO keeps `server.close()` from resolving.** `stopAccepting` awaits `server.close()`, which won't resolve
   while any dashboard websocket is open (closed only in a later step) → hits the 30s force timer → `exit(1)`.
Either way: in-flight messages severed, global maps unflushed, pg-boss/pool cleanup skipped, on every routine
restart (e.g. Docker redeploy). `DeploymentService.stop()` already does teardown correctly — the shutdown path just
never calls it. Fix: stop each channel (and consumers) before undeploy; disconnect sockets before/with `server.close()`.

### B3. Non-DEVELOPMENT storage modes = 100% delivery failure for queued destinations + dead recovery
`engine.ts:115-121`: PRODUCTION stores only error content (CT ≥ 11) — not RAW(1) or SENT(5); METADATA/DISABLED store
nothing. The pipeline "stores" CT_SENT (silently dropped), enqueues; the queue consumer reloads CT_SENT → `null` →
releases **ERROR** for every queued message. Crash recovery needs RAW/SENT → also dead. And the message browser shows
no content for successful messages. This diverges from Mirth (PRODUCTION stores raw/encoded/sent/response/maps). The
channel editor offers these modes with no warning. Nothing validates `queueMode != NEVER` against a non-storing mode.
Fix: keep RAW+SENT in PRODUCTION/queued modes, or reject the combination at deploy.

### B4. Silent, unrecoverable message loss on store/enqueue error paths
`message-processor.ts:525` — `await this.store.enqueue(...)` Result ignored; also `storeContent` CT_SENT (`:520`) and
`createConnectorMessage` (`:482`). On a DB blip the pipeline still returns QUEUED, source is finalized SENT +
`processed=true`, dest row stays RECEIVED. Recovery only scans `processed=false` → the message is never delivered,
never errored, never alerted. This is exactly the silent-loss class the project forbids. Virtually every non-batch
`MessageStore` call in the pipeline ignores its Result. Fix: check every store Result; on failure mark ERROR + alert.

### B5. Attachments stored plaintext under `encryptData` (PHI at-rest leak)
`engine.ts:177` `storeAttachment` has no `if (encrypt)` branch (contrast `storeContent` at `:145`);
`message.service.ts` never sets `isEncrypted`; read path returns raw. HL7 with embedded PDFs/images on an encryptData
channel writes PHI plaintext, silently defeating the channel's guarantee. *Currently latent* — the AttachmentHandler
is dead code (B6) so attachments are never created — but it becomes live the moment attachments are wired. Fix
alongside B6.

### B6. AttachmentHandler is dead code — attachments never exist
`message-processor.ts:156` accepts `attachmentConfig` but nothing in `processMessage` ever reads it or calls
`AttachmentHandler`; `engine.ts` never passes it. The AttachmentTab, attachment API, `deleteAttachments`, and
`removeAttachmentsOnCompletion` all operate on rows that can never be created. (Prior review's "fixed" claim does not
hold.) Either wire it (with encryption per B5) or remove the surface before release.

### B7. Viewer role can read all connector credentials
`channel.service.ts:377,405` — `GET /channels/:id` (guard `channels:read`, which **viewer** holds) returns raw
`sourceConnectorProperties` and destination `properties` including DB/SFTP passwords and API keys. Redaction exists
but is applied only on the export path. Fix: redact for callers without `channels:write` (merge-on-write like settings).

### B8. `pnpm audit`: 9 high-severity vulns on PHI-handling paths
`drizzle-orm@0.38.2` (**SQL injection via improper identifier escaping** — the data layer),
`express-rate-limit@8.2.1` (IPv6 bypass on the auth limiter), `fast-xml-parser` (entity expansion on the message-parse
path), `path-to-regexp`/`ws`/`socket.io-parser`/`nodemailer` DoS/SSRF. Most fixed by routine upgrades. Add `pnpm audit`
to CI. (42 total: 9 high / 27 moderate / 6 low.)

### B9 (UI). Script editor advertises IO globals that ReferenceError at runtime
`web/src/lib/sandbox-types.ts:117-154` gives IntelliSense for `httpFetch()`, `dbQuery()`, `routeMessage()`,
`getResource()`, but prod wires no bridges (`engine.ts:211`). A transformer using an autocompleted `httpFetch(...)`
throws at message time — the editor actively suggests code that ERRORs PHI messages. The roadmap marks these bridges
"done." Either wire the bridges or strip the type defs (and the Resources feature, H-below, depends on the same
unwired `getResource`).

---

## HIGH

- **H1. Response-transformer (CT=7) errors silently swallowed** — `message-processor.ts:553-564` has no else branch;
  destination stays SENT, no error content, no alert, untransformed response feeds the ACK. Same bug class fixed for
  destination transformers, re-introduced on the Wave-2 path.
- **H2. Recovery strands/loses messages** — marks the original `processed` *before* checking reprocess success
  (`engine.ts:524-527`, permanent loss if reprocess fails early); skips source status `TRANSFORMED` so a crash between
  transform and routing leaves the message rescanned forever with no ERROR/alert; drops the original sourceMap on
  reprocess; runs during `deploy()` before destination connectors start.
- **H3. "Soft" channel delete hard-destroys all message history** — `channel.service.ts:879-882` sets `deletedAt`
  then immediately `dropPartitions` CASCADE on all 6 message tables. Irreversible PHI/audit destruction for a
  "restorable" delete; no undeployed-state check. (Also flagged by server-API audit M6.)
- **H4. Single-message DELETE orphans attachments + custom-metadata, non-transactional, unaudited** —
  `message-query.service.ts:299-340` deletes only content/connector/message rows in 3 separate statements. The correct
  transactional helper (`message-delete-helper.ts`) already exists and is used by the pruner — the single delete just
  doesn't call it. PHI persists after "delete."
- **H5. Backup → restore corrupts every secret** — export redacts credentials to `__REDACTED__`; restore writes those
  literals back over live SMTP/DB/SFTP passwords in OVERWRITE mode. Backups are unusable for DR. Skip `REDACTED`
  values on restore.
- **H6. `mustChangePassword` unenforced server-side** — the flag is gated only by a React dialog on localStorage.
  `POST /auth/login {admin, Admin123!}` returns full tokens usable against all endpoints forever; the seed prints the
  default credential. (Confirmed live: admin logged straight in, no forced change.) Add a middleware 403-gate.
- **H7. JWT placeholder secret passes validation** — `config/index.ts:25` only checks `min(32)`; the shipped
  `.env.production.example` placeholder is 45 chars and boots → publicly-known signing key = admin-token forgery.
  Refuse known placeholders in production; generate in the entrypoint.
- **H8. Socket.IO bypasses RBAC** — handshake verifies only the JWT; any authenticated user can `join:logs` and stream
  live server logs (REST equivalent requires `system:info`), or any `channel:<id>`/`dashboard` room. Enforce
  permissions in the `join:*` handlers.
- **H9. Live connector SSRF + SFTP MITM defaults** — HTTP/FHIR dispatchers `fetch(config.url)` with no egress policy
  and follow redirects (deployer can POST PHI to `169.254.169.254`); SFTP `strictHostKey` defaults **false** →
  `ssh2` accepts any host key (MITM of PHI + credentials). DICOM/DB have no TLS at all.
- **H10. DICOM + Email receivers can silently lose messages / crash the process** — DICOM: pipeline failure isn't
  logged and the file is never re-dispatched; the `error` event is never subscribed (uncaughtException risk). Email:
  no `client.on('error')` on ImapFlow → a between-poll disconnect throws uncaughtException and kills the engine;
  post-action failure re-dispatches (duplicate delivery).
- **H11. MLLP/DICOM listener ports unreachable in prod Docker** — `docker-compose.prod.yml` publishes only port 80;
  the server is `expose:3000` internal-only. Any TCP/MLLP source (the flagship inbound path) can't be reached. No
  ops doc addresses listener port mapping.
- **H12. Coverage story is dishonest** — server 64% stmt / 75% branch vs a claimed 95% floor; no `thresholds`
  enforced in any of 8 vitest configs; CI runs `pnpm test` without `--coverage` yet "uploads coverage" from a
  directory that's never created. 35 controllers, only 4 tested; 2/7 middleware tested. Either enforce an honest
  threshold or drop the 95% claim.
- **H13 (UI). Editor strips transformer templates/properties on every save** — `ChannelEditorPage.tsx:463-501` always
  sends empty properties/null templates and drops empty-step transformers. A channel imported from Mirth XML loses
  its serialization config the first time it's saved from the UI. Silent transformation-data loss.
- **H14 (UI). No redeploy path / stale-config indicator** — editing a live channel + Save leaves the running channel
  on the old config with zero indication; applying needs Stop→Undeploy→Deploy→Start across two menus; the editor has
  no Deploy button. `deployedRevision` is tracked nowhere. This is the core integration-engineer workflow.
- **H15 (UI). Three CRUD UIs manage objects nothing reads** — Certificates (no consumer; connectors read TLS PEM
  inline, never by cert id; no form even exposes TLS), Resources (needs the unwired `getResource` bridge), Extensions
  (enable/disable writes a settings key no code reads). All cosmetic.
- **H16 (UI). "Archive before pruning" deletes instead of archiving** — `data-pruner.service.ts` has no archive path;
  the toggle round-trips but pruned PHI is permanently gone. Data-integrity violation.
- **H17 (UI). File charset dropdown offers Node-invalid encodings** — `ISO-8859-1`/`US-ASCII` fail
  `Buffer.isEncoding` → `fs` throws `ERR_UNKNOWN_ENCODING`; selecting either breaks the file connector at runtime.
- **H18 (connectors). Registry config is unvalidated `as`-casts** — no Zod at the connector boundary (violates the
  project's own rule); a wrong-typed port/headers/charset slips past `onDeploy` and throws per-message at runtime.

---

## MEDIUM (representative — full list in the agent transcripts)

- Resend button errors on default (NEVER-queue) channels every time (server rejects with CONFLICT).
- `removeContentOnCompletion` inverted: never runs on success (content kept), runs on error (wipes exactly the
  content you'd investigate) and can race the queue consumer.
- `ON_FAILURE` queue mode behaves as `ALWAYS` (never attempts a direct send first).
- Queued/recovered sends bypass response handling (no CT_RESPONSE, no response transformer) — behavior differs by
  whether a destination happened to be queued.
- BatchProcessor dead code — batch (multi-MSH) files ingested as one message.
- Audit log trivially erasable (`DELETE /events`, unaudited, no retention floor, no tamper evidence); audit emission
  is fire-and-forget (PHI read succeeds even if the audit insert fails); password/role changes under-audited.
- `TRUST_PROXY=true` in the prod template defeats IP rate limiting + spoofs audit IPs; global 100 req/min/IP limiter
  will 429 legit NAT'd production use.
- Migration 0007 drops+recreates all 6 message tables with no data copy — data-destructive on in-place upgrade;
  not called out in `upgrade.md`.
- Mirth XML import: entity-expansion DoS (`processEntities:true`), reachable by viewers via the dry-run route.
- DB TLS uses `rejectUnauthorized:false` (MITM-able PHI link).
- Channel connector has no routing-loop detection (A→B→A → OOM).
- DB receiver holds row locks + a pooled connection across the whole pipeline run (pool-exhaustion risk).
- MLLP receiver has no inbound idle timeout / backpressure (dead connections fill `maxConnections`, then silently
  refuse senders).
- SMTP total-recipient-rejection recorded as SENT; JS receiver swallows script-Result errors (channel STARTED,
  produces nothing, no log); File/SFTP `matchGlob` only escapes `.` (regex injection/crash on `(`/`[` in filter).
- UI: ungated destructive controls that always 403 for most roles (Events purge, Alerts, Code Templates); no
  `beforeunload` guard (refresh discards dirty editors; Settings has no blocker at all); group-change bypasses Save
  and toasts success unconditionally; connector filter + dashboard connector labels hardcoded "Dest 1/2/3"; no
  connection-status/queue-depth on the dashboard; missing intermediate content views (processed-raw, filtered-reason).
- Flagship `e2e/message-flow.spec.ts` has 6 `test.skip()` escape hatches → can pass green without sending a message.
- Access tokens survive logout + admin password reset up to the 15-min TTL (no session-id check in `authenticate`).

---

## Cross-cutting recommendations

1. **Fix the message-loss cluster as a design pass, not spot fixes** (B1, B3, B4, H1, H2). Make every pipeline
   `MessageStore` write check its Result and fail to ERROR+alert; reconcile the batch fast-path
   (`initializeMessage`/`finalizeMessage`) with the storage/cleanup policies built around the non-batch methods;
   thread real `messageId`/`sourceMap`/`correlationId` through `SendToDestination`.
2. **Fix shutdown properly** (B2) — route through `DeploymentService.stop()`, disconnect sockets before `server.close()`.
   Add a test that SIGTERM with a started channel + open dashboard drains and exits 0.
3. **Close the storage-mode footgun** (B3) — validate storage mode × queue mode at deploy; warn in the editor.
4. **Secret/PHI exposure** (B7, H5, H6, H7, H8, H9) — redact connector properties on read, enforce
   mustChangePassword + reject placeholder JWT secret server-side, RBAC on sockets, egress policy for HTTP/FHIR,
   SFTP host-key verify-by-default.
5. **Reconcile UI ↔ backend reality** (B9, H13–H17) — either wire the four "advertised but unimplemented" features
   (IO bridges, certificates→connectors, resources, archive-pruning) or remove the surfaces; add a redeploy button +
   deployed-revision indicator; add field-level validation with tab/field error mapping.
6. **Dependencies + honesty** (B8, H12) — upgrade the 9 high-severity deps and add `pnpm audit` to CI; enforce a
   real coverage threshold or stop claiming 95%; de-soften the flagship e2e spec; fix README (PG 17 not 18, MFA is
   not implemented, real test count).
7. **Docs/release mechanics** — call out the 0007 data-loss on upgrade; cut a `v0.0.1` tag to exercise the never-run
   docker-build/publish pipeline; document listener-port mapping for the prod stack (H11).

---

## Bottom line

The engineering is genuinely strong — the architecture, the sandbox hardening, the RBAC layer, the message browser,
and the docs are all real and well-built, and the admin console is a mature, functional product. But this is
**healthcare message routing**, and the current `main` will, under ordinary configuration, silently lose messages
(B1, B3, B4), lose in-flight messages on every restart (B2), destroy message history on a "soft" delete (H3), leak
connector credentials to read-only users (B7), and cannot be restored from its own backups (H5). Those are v1
blockers. Estimated to an honest, defensible **v0.1**: the 9 blockers + the security/data-loss HIGHs (H1–H11),
with the UI-reality items (H13–H17) close behind. The MEDIUM/LOW list is triage-after-tag.
