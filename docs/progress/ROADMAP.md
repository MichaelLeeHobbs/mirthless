# Roadmap

> What's planned. What's done lives in git history and CHANGELOG.md.
> This is a living document. Check items off as they ship, add items as they emerge.

---

## Vision

Mirthless is not a Mirth Connect clone. It's a **modern, open-source healthcare integration platform** built from scratch for Node.js. Everything Connect charges for in Gold/Platinum tiers ships free. The architecture is designed for decades, not a release cycle.

**Core principles:**
- Open source forever — no paywall tiers, no proprietary extensions
- Developer experience as a competitive moat — TypeScript, Monaco, hot reload, debugging
- Healthcare-first but not healthcare-only — the engine is a general message router
- Community-driven ecosystem — npm-based plugins, shared channel templates

---

## v1.0 — Production Ready

The foundation. A single-server deployment that can replace Mirth Connect for common HL7v2/FHIR/HTTP integration workflows.

### Core Pipeline (done)
- [x] 8-stage message pipeline (preprocess → filter → transform → route → postprocess)
- [x] Response modes (before/after transformer, after destinations, postprocessor, specific destination)
- [x] Destination routing control via `destinationSet`
- [x] Batch processing (delimiter/regex/JavaScript split)
- [x] Recovery manager (reprocess after crash)
- [x] Pipeline timing instrumentation (`LOG_LEVEL=debug`)
- [x] correlationId for cross-channel tracing
- [x] Script error handling (ERROR status, not silent skip)
- [x] Performance: 13ms message processing on native Postgres

### Sandbox & Scripting (done)
- [x] VM-based sandbox (node:vm) with strict mode IIFE wrapping
- [x] TypeScript support via esbuild transpilation
- [x] HL7v2 bridge functions (parseHL7, createACK)
- [x] I/O bridges implemented in the sandbox (httpFetch, dbQuery, routeMessage, getResource, getCollection)
- [x] **All IO bridges wired** end-to-end into the production engine (`engine.ts`): getCollection, getResource, httpFetch, routeMessage (hop-depth loop guard), and **dbQuery** via named **Data Sources** (`docs/design/11-datasources.md`, D-178 — encrypted creds, read-only default, statement timeout + row cap, Postgres v1)
- [x] Map system (channelMap, connectorMap, globalMap, configMap, responseMap, sourceMap)
- [x] Map shortcuts ($, $r, $g, $gc)
- [x] Code template injection (FUNCTION type prepended to scripts)
- [x] Per-channel script timeout (1-300s configurable)

### Connectors (done)
- [x] TCP/MLLP (source + destination) — HL7v2 over TCP
- [x] HTTP (source + destination) — REST with configurable methods/headers
- [x] File (source + destination) — local filesystem polling with post-action
- [x] Database (source + destination) — parameterized SQL, connection pooling
- [x] JavaScript (source + destination) — user scripts in sandbox
- [x] Channel (source + destination) — in-memory inter-channel routing
- [x] SMTP (destination) — email with template substitution
- [x] FHIR (destination) — R4 REST client
- [x] DICOM (source + destination) — C-STORE via dcmtk.js
- [x] Email/IMAP (source) — folder polling with filters

### Connector Parity Gaps vs Mirth/OIE 4.6.0

> Full analysis + fix specs + migration matrix: [`docs/design/12-connector-parity-gap-analysis.md`](../design/12-connector-parity-gap-analysis.md).
> The connectors above exist but several are **partial** — these gaps block whole classes of channel migration. Ranked by channels unblocked, not effort.

- [ ] **[1] Multi-vendor Database connector** — driver abstraction (pg/mysql2/tedious/oracledb) + JS mode. 🔴 Postgres-only today; Oracle/SQL Server/MySQL DB channels **cannot migrate**.
- [ ] **[2] File scheme abstraction** — FTP/FTPS, SMB, S3; fold standalone SFTP in as a scheme. 🔴 Local-disk-only today.
- [ ] **[3] Configurable TCP framing + Basic mode** — 🔴 start/end bytes hardcoded VT/FS+CR; no non-standard/delimited framing.
- [x] **[4] Surface hidden runtime options in forms** — surfaced TCP responseMode/charset/maxFrameBytes/acquireTimeoutMs, HTTP-source errorStatusCode/maxBodyBytes, SMTP requireTLS (2026-07-15). TCP TLS deferred to the rank-8 cert-resolver work (not surfacing-only); HTTP inbound auth folded into rank 5. 🟡 cheapest wins.
- [ ] **[5] HTTP outbound auth (Basic/Digest) + query-parameters table + `${}` substitution** — 🟡 common REST requirement.
- [ ] **[6] Web Service / SOAP connector** (source + dispatcher) — 🔴 blocks brownfield SOAP hospital installs.
- [ ] **[7] Document Writer** (PDF/RTF destination) — 🟡 no workaround for rendered clinical docs.
- [ ] **[8] DICOM TLS** (cert/key/trust) — 🟡 secured PACS. (Assoc-rejection bug already fixed, D-181.)
- [x] **[9] SMTP multi-attachment** — config-driven attachments array (filename/mimeType/content, `${msg}` substitution) alongside the `attachContent` body attachment; dispatcher + registry + web form + tests.
- [ ] **[10] Binary data type** across TCP/HTTP — 🟡 imaging/PDF/non-text feeds.
- [ ] **[11] JMS connector** — 🟡 defer unless a customer needs it.
- [ ] **[12] WebDAV File scheme** — 🟢 rare; do last alongside File schemes.

### Non-Connector Parity Gaps vs Mirth/OIE 4.6.0

> Full analysis: [`docs/design/13-non-connector-gap-analysis.md`](../design/13-non-connector-gap-analysis.md).
> Core lifecycle/alerts/monitoring are at parity or ahead. Gaps cluster in data types, scripting API, and a few "half-built" engine features (schema exists, runtime doesn't use it). Ranked by impact, not effort.

- [ ] **[N1] EDI/X12 + NCPDP serializers** (+ enum entries) — 🔴 blocks X12 billing/eligibility + pharmacy channels.
- [ ] **[N2] Finish declared-but-pass-through datatypes** — Delimited, HL7v3, DICOM→XML. 🔴 `msg` mapping impossible on them today.
- [ ] **[N3] Fix `$gc` map-shortcut collision** (means configMap; Mirth = globalChannelMap) + add `$cfg`/`$c`/`$co`/`$s` — 🔴 silent-wrong-map footgun for ported scripts.
- [ ] **[N4] Message search operators** — metadata-column search, regex, error, send-attempt filters. 🔴 daily-use triage gap.
- [ ] **[N5] Populate custom metadata columns + make searchable** — 🔴 currently stored but never populated (half-built).
- [ ] **[N6] Dependency-ordered deploy** (topological sort in `autoDeployChannels`) — 🔴 graph stored/validated but not applied; channel can start before its dependency.
- [ ] **[N7] Destination-queue threading** (threadCount/groupBy/rotate) or remove dead schema fields — 🔴 throughput/ordering at volume.
- [ ] **[N8] Pruner archiver + content/metadata-day split** — 🟡 `pruningArchiveEnabled` flag has no archiver (half-built); HIPAA retention.
- [ ] **[N9] JS API breadth** — DateUtil, ChannelUtil, AttachmentUtil, SerializerFactory, getArrayOrXmlLength, etc. (~10 of Mirth's ~40 userutil objects). 🟡
- [ ] **[N10] Per-connector connection monitoring** (Mirth dashboardstatus) + per-channel Prometheus labels — 🔴 ops triage visibility.
- [ ] **[N11] Iterator transformer step** (+ XSLT / External Script) — 🟡 repeating-segment mapping UX.
- [ ] **[N12] Code-template per-channel library scoping** — 🟡 flat today (all templates to all channels).
- [ ] **[N13] Custom RBAC roles** (roles as permission sets vs 4 fixed) — 🟡 "dev who can't deploy to prod".
- [ ] **[N14] Export completeness** (templates/deps/groups/tags + set export) — 🟡
- [ ] **[N15] Alert per-connector scope + error-stage granularity** — 🟡
- [ ] **[DECIDE] Extension/plugin platform** — 🔴 strategic: Mirth's third-party plugin loader has no equivalent. Decide curated-built-in vs a modern manifest-based SPI. Not a scheduled task until decided.

### Beyond-Mirth Horizon (vs the broader integration landscape)

> Full analysis + pursue/consider/partner/non-goal calls: [`docs/design/14-beyond-mirth-competitive-gaps.md`](../design/14-beyond-mirth-competitive-gaps.md).
> These are **platform expansions beyond Mirth** (Mirth lacks most of them too), NOT parity gaps. A strategy menu, not a defect list — act only after the doc 12/13 blockers clear. Top PURSUE picks:

- [ ] **[B1] Silent-interface / SLA / heartbeat alerting** — 🟢 "no message in N min" + throughput/queue-depth thresholds. Deadliest failure mode; alert engine currently fires only on CHANNEL_ERROR.
- [ ] **[B2] HA / clustering / automatic failover** — 🟢 genuine production gap; multi-node today duplicates inbound on singleton sources.
- [ ] **[B3] Keyed partitioning / per-key ordering + scale** — 🟢 per-patient order + horizontal scale; the real fix for doc 13 N7 (dead threadCount/groupBy).
- [ ] **[B4] End-to-end lineage + OpenTelemetry tracing** — 🟢 cross-channel message journeys.
- [ ] **[B5] Interface test framework** — 🟢 assertion-based per-channel regression in CI; on-brand with testing mandate.
- [ ] **[B6] Environment promotion / config-as-code** — 🟢 formalize JSON export into dev→test→prod.
- [ ] **[B7] FHIR-native transform + IG/US-Core validation (in-pipeline) + HL7v2→FHIR mapping templates** — 🟢 biggest strategic direction; engine work, not becoming a FHIR server.
- [ ] **[B8] AI-assisted mapping + first-class LLM step** — 🟢 modern differentiator; PHI governance required for runtime use.
- [ ] **[B9] EIP primitives**: aggregator (on Collections), wire-tap, dead-letter queue — 🟢 engine-native.
- [ ] **[B10] OAuth2 credential vault** (handshake + auto token refresh) — 🟢 enables FHIR/SMART direction.
- [ ] **[PARTNER] Kafka connector, EMPI, terminology hosting, TEFCA/QHIN, Temporal, Debezium/CDC** — 🔗 integrate best-of-breed, don't rebuild.
- [ ] **[NON-GOAL] FHIR datastore, API gateway, SaaS marketplace, dev portal, streaming internals** — ⛔ front/beside a real tool.
- [ ] **[DECIDE] Multi-tenancy (SaaS vs on-prem), low-code visual canvas, how far up the FHIR-server stack** — business/identity calls, not engineering.

### API & Auth (done)
- [x] 131 REST endpoints across 37 route files
- [x] JWT + refresh tokens + session management
- [x] RBAC with 4 roles (admin, deployer, developer, viewer)
- [x] Channel-scoped permissions
- [x] Audit logging (fire-and-forget events)
- [x] Channel export/import (JSON format)
- [x] Mirth Connect XML import
- [x] Server backup/restore
- [x] Data pruning with cron scheduling (pg-boss)

### Web UI (done)
- [x] Dashboard with grouped channels, summary cards, tag filtering
- [x] Channel editor (Channel Settings, Source, Destinations, Scripts)
- [x] Message browser with search, filters, content tabs
- [x] Code template library editor (Monaco)
- [x] Alerts with trigger/action configuration
- [x] All admin pages (users, settings, events, system info, etc.)
- [x] Dark/light theme, keyboard shortcuts, breadcrumbs
- [x] WebSocket-driven real-time updates (60s polling fallback)
- [x] Group CRUD (create, rename, delete, assign via dashboard + editor)
- [x] Send Message dialog (fire-and-forget)

### CLI (done)
- [x] Commander-based with 16 commands
- [x] Channel lifecycle (deploy, undeploy, start, stop, pause, resume)
- [x] Export/import, user management, login
- [x] Config persistence (~/.mirthless/)

### Remaining for v1.0
- [x] ~~Data type serialization — XML/JSON/HL7v2 parsed `msg` object in sandbox~~
- [x] ~~Inbound data validation — reject malformed messages at source connector~~
- [x] ~~Dashboard: replace polling with WebSocket-driven query invalidation~~
- [x] ~~Example channels seeded (10 channels in Examples group)~~
- [x] ~~Connection testing — "Test Connection" button per connector type~~
- [ ] Load testing — throughput benchmarks with realistic message volumes
- [ ] E2E test suite refresh — 19 specs may need updates after recent UI changes
- [ ] Security review — HIPAA compliance checklist, penetration testing

---

## v1.1 — Developer Experience

Make writing transformers and debugging channels a joy, not a chore.

- [ ] **Visual pipeline builder** — React Flow drag-drop editor as alternative to tree-table
- [ ] **In-browser script debugging** — V8 Inspector Protocol + Monaco breakpoints
- [ ] **Hot reload for scripts** — edit transformer, see result on next message without redeploy
- [ ] **Test harness in editor** — send test message and see pipeline trace inline
- [ ] **Message generator** — create realistic HL7v2/FHIR/JSON test data from templates
- [ ] **Channel diff viewer** — side-by-side revision comparison with Monaco diff editor
- [ ] **Script autocomplete improvements** — context-aware suggestions based on inbound data type

---

## v1.2 — Operational Excellence

Production monitoring, observability, and operational tooling.

- [ ] **OpenTelemetry tracing** — distributed traces across channels, exportable to Jaeger/Zipkin
- [ ] **Prometheus metrics enhancement** — per-channel throughput, latency percentiles, queue depth
- [ ] **Alert escalation chains** — on-call schedules, PagerDuty/Slack integration
- [ ] **Compliance reporting** — HIPAA audit log export with configurable retention
- [ ] **Channel health scoring** — automated detection of degraded channels (error rate, latency spikes)
- [ ] **Scheduled channel operations** — maintenance windows, automated deploy/start on schedule

---

## v2.0 — Visual Flows

The Node-RED moment. Channels become visual graphs. Non-developers can build integrations.

- [ ] **Flow editor** — React Flow canvas where nodes are connectors, edges are message routes
- [ ] **Node palette** — drag source connectors, transformers, filters, destinations from sidebar
- [ ] **Subflows** — reusable flow fragments (like code template libraries but visual)
- [ ] **Conditional routing** — visual branching based on message content/headers
- [ ] **Error handling nodes** — visual dead-letter queues, retry paths, alert triggers
- [ ] **Flow variables** — visual configuration of channelMap/globalMap without code
- [ ] **Import/export flows** — share flows as JSON, publish to community

This builds ON TOP of the channel model — flows compile down to channels. Power users still have full JavaScript/TypeScript access. Visual flows are sugar, not a replacement.

---

## v2.1 — Ecosystem & Plugins

npm-based plugin system. Third-party connectors, data types, and auth providers.

- [ ] **Runtime plugin discovery** — load `@mirthless/*` npm packages at startup
- [ ] **Plugin manifest** — `mirthless` field in package.json declares connector/datatype/auth
- [ ] **Plugin marketplace** — web registry for community plugins (browse, install, rate)
- [ ] **Custom connector SDK** — documented interface for building new connectors
- [ ] **Custom data type SDK** — parsers + serializers as plugins
- [ ] **Auth provider plugins** — LDAP, OIDC, SAML, OAuth2 as installable packages

---

## v3.0 — Enterprise & Scale

Multi-server clustering and enterprise deployment models.

- [ ] **Horizontal clustering** — multiple Mirthless instances sharing PostgreSQL
- [ ] **Leader election** — Postgres advisory locks for coordination
- [ ] **Message takeover** — reassign channels from failed nodes
- [ ] **Heartbeat monitoring** — detect and recover from node failures
- [ ] **Multi-tenancy** — isolated channel namespaces for managed service model
- [ ] **Helm chart** — one-command Kubernetes deployment
- [ ] **GitOps** — channels as code in git, CI/CD deployment pipeline

---

## Someday / Maybe

Ideas that may become relevant. Not committed to any timeline.

- [ ] SFTP connector
- [ ] WebSocket source connector (bidirectional streaming)
- [ ] Serial connector (legacy lab instruments)
- [ ] IHE profiles (PIX, PDQ, XDS) as plugins
- [ ] ASTM E1394 data type / E1381 transmission mode
- [ ] HL7v3/CDA specialized parsing
- [ ] AI-assisted mapping — LLM suggests field mappings between formats
- [ ] AI error explanation — natural language description of why a message errored
- [ ] AI channel generation — describe integration in English, get a working channel
- [ ] Mobile/tablet-optimized UI
- [ ] Channel template library — community-shared pre-built integrations
- [ ] FHIR Subscription source (R4 SubscriptionTopic)
- [ ] GraphQL API alongside REST
- [ ] Time-travel debugging — replay messages through historical channel configs

---

## Performance Targets

| Metric | Current | Target (v1.0) | Target (v2.0) |
|--------|---------|---------------|---------------|
| Simple message (no transformer) | ~10ms | <10ms | <5ms |
| Message with transformer | ~13ms | <15ms | <8ms |
| Message with 3 destinations | ~30ms | <30ms | <15ms |
| Throughput (messages/sec) | ~500 w/ script, ~23k no-script (in-mem baseline — see [benchmark](../ops/throughput-benchmark.md)) | 1,000+ | 5,000+ |
| Dashboard load | ~150ms | <200ms | <100ms |

---

## Known Issues / Tech Debt

- Drizzle ORM `inArray()` fails silently with bigint columns — raw SQL workaround in place
- `pino-http` error logging shows generic "failed with status code 500" — actual error in service layer
- Channel group is single-select but schema is many-to-many — consider schema migration
- Extension system is static catalog — no runtime plugin loading yet
- No HL7v2 serialization back from parsed object — roundtrip transforms incomplete

---

## Competitive Position

| Feature | Mirth Connect (Free) | Mirth Connect (Gold $$) | Mirthless |
|---------|---------------------|------------------------|-----------|
| Channel pipeline | Yes | Yes | Yes |
| RBAC | No | Yes | **Free** |
| MFA | No | Yes | **Free** |
| Channel history/diff | No | Yes | **Free** |
| Cross-channel search | No | Yes ($$) | **Free** |
| Advanced alerting | Basic | Yes | **Free** |
| TypeScript support | No | No | **Yes** |
| Visual flow editor | No | No | **Planned (v2.0)** |
| Plugin marketplace | No | No | **Planned (v2.1)** |
| Cloud-native (k8s) | No | No | **Planned (v3.0)** |
| AI-assisted mapping | No | No | **Someday** |
