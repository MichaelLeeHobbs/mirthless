# 13 — Non-Connector Gap Analysis (Mirthless vs Mirth Connect / OIE 4.6.0)

> **Status:** Draft for review · **Date:** 2026-07-15 · **Owner:** Michael Hobbs
> **Scope:** Everything *except* connectors (those are in [`12-connector-parity-gap-analysis.md`](./12-connector-parity-gap-analysis.md)) — the message engine, storage, scripting/sandbox API, data types, transformers, channel lifecycle, code templates, admin/server, the extension model, alerts, events, and monitoring.
> **Baselines:** Mirthless `feature/real-e2e-testing` · Mirth reference `reference/connect/` · OIE **4.6.0** at `C:\Users\mhobb\WebstormProjects\_temp\engine`.

---

## 0. Executive Summary

The expectation going in was "there won't be much here." That held for **channel lifecycle, alerts, events, and monitoring** — those are at parity or ahead. But there is **more than expected** in two places, and it's worth knowing:

1. **Data types & the scripting API** — the richest gap area. **EDI/X12 and NCPDP serializers are entirely absent** (blocks X12 billing/eligibility and pharmacy channels); **HL7v3, Delimited, and DICOM are declared but only pass through as raw strings** (no XML serialization, so `msg`-based mapping is impossible on them). The user-facing JS API implements ~10 of Mirth's ~40 `userutil` objects.
2. **Engine internals that are "half-built"** — schema/flags exist but the runtime never uses them: **custom metadata columns** (stored, never populated, not searchable), **the pruner archive** (`pruningArchiveEnabled` flag, no archiver), and **destination-queue thread-buckets/groupBy/rotation** (schema fields, single-poll consumer). These read as "done" in the data model but aren't wired end-to-end.

Two structural themes tie most of this together:

- **"Half-built" features** — a recurring pattern of schema present / runtime missing (custom metadata, pruner archive, queue threading, HL7v3 datatype). These are the most dangerous because they *look* complete.
- **The extension/plugin model is architecturally absent** — Mirth's whole third-party ecosystem (runtime plugin loader, `plugin.xml`, typed extension points) has no Mirthless equivalent. This is a **strategic decision to make, not a bug** — but it should be a conscious one.

**Severity legend:** 🔴 blocker (channel/feature unusable) · 🟡 degraded (works but loses capability) · 🟢 parity / ahead.

Nothing here changes the top-line: the **connector gaps in doc 12 are the migration blockers**. The items below are mostly capability depth, a few genuine correctness gaps, and one big architectural decision.

---

## 1. Data Types & Serializers — 🔴 the biggest non-connector gap

Mirth ships full inbound/outbound serializers (raw ⇄ XML) for each datatype, so the `msg` object works for mapping. Mirthless's `data-type-handler.ts` genuinely transforms only **HL7v2, XML, JSON, Raw**; the rest are declared in the `DATA_TYPE` enum but pass through as raw strings.

| Datatype | Mirth | Mirthless | Sev |
|---|---|---|---|
| HL7v2 (ER7) | Full serializer → XML, batch, ACK, validation | Path-proxy get/set/toString (**not E4X XML `msg`**) | 🟡 different access model |
| XML | Full | parse/build via fast-xml-parser | 🟢 |
| JSON | Full | JSON.parse/stringify | 🟢 |
| Raw | Full | Pass-through | 🟢 |
| **Delimited (CSV/fixed-width)** | Full serializer + batch | **Pass-through string only** — no delimited→XML | 🔴 |
| **DICOM** | Full serializer + DICOMUtil | **Pass-through** (declared, not serialized) | 🔴 |
| **EDI / X12** | Full serializer, X12 vocab, batch | **Absent from enum entirely** | 🔴 |
| **NCPDP** | Full serializer + NCPDPUtil | **Absent** | 🔴 |
| **HL7v3** | Full serializer, batch | Declared enum only; pass-through | 🔴 |
| FHIR | Not a native Mirth datatype | Declared (pass-through) | 🟢 Mirthless extra |

**Why it matters.** X12 (837/835/270/271) is ubiquitous in US billing/eligibility; NCPDP is the pharmacy standard; HL7v3/CDA appears in registries and older EMRs. A channel whose source/transformer relies on any of these datatypes' `msg` object **cannot be built or migrated**.

**What needs to be fixed.**
1. Implement **Delimited** and **HL7v3** serializers (both are the "declared but pass-through" case — the enum already lists them, the handler doesn't serialize).
2. Add **EDI/X12** (with X12 segment/element vocab) and **NCPDP** serializers + their enum entries.
3. Wire **DICOM** dataset → XML serialization so `msg` mapping works (the connector handles the wire protocol; the *datatype* serializer is separate).
4. Decide on the HL7v2 access model (see §2 — path-proxy vs E4X-style) since it affects portability of Mirth transformer scripts.

---

## 2. Scripting / Sandbox JS API — 🟡 breadth + a portability footgun

Mirthless exposes a deliberately small, JSON-marshalled bridge (`sandbox-executor.ts` + `bridge-functions.ts`, typed in `sandbox-globals.d.ts`) — ~10 of Mirth's ~40 `userutil` objects. Maps, `logger`, `createACK`, `httpFetch`, `dbQuery`, `routeMessage`, `getCollection`, and map shortcuts are present. The following are **absent** and appear in real Mirth channel scripts:

| Missing API | Mirth use | Sev |
|---|---|---|
| **DateUtil** (format/parse/convert) | date reformatting in transformers | 🟡 common |
| **SerializerFactory** | programmatic re-serialize between datatypes | 🟡 |
| **ChannelUtil** (start/stop/getStatistics/getDeployedIds) | operational scripts | 🟡 |
| **AttachmentUtil / Attachment** (add/get/reattach) | script-level attachment handling | 🟡 |
| **FileUtil** (read/write/append/delete) | ad-hoc file IO in scripts | 🟡 |
| **DICOMUtil / NCPDPUtil** | datatype-specific helpers | 🟡 (ties to §1) |
| **getArrayOrXmlLength**, replaceValues/template | repeating-field mapping idioms | 🟡 common |
| **Response / Status / RawMessage** classes | destination response construction | 🟡 |
| **SMTPConnection**, HTTPUtil helpers | send mail / http from script | 🟡 |
| Lists / Maps / builders, EncryptionUtil / HashUtil / UUIDGenerator | misc | 🟢 low |
| DatabaseConnection (explicit conn, executeUpdate, transactions) | our `dbQuery` is read-style only | 🟡 |

### 2.1 🔴 Map-shortcut divergence — a silent-corruption footgun

Verified in `sandbox-executor.ts:274-286`. This is a **correctness/portability** issue, not just missing sugar:

| Shortcut | Mirth means | Mirthless means | Status |
|---|---|---|---|
| `$('key')` | precedence search across maps | precedence search (`responseMap, connectorMap, channelMap, globalChannelMap, globalMap, configMap, sourceMap`) | ~parity |
| `$r` | responseMap | responseMap | ✅ correct |
| `$g` | globalMap | globalMap | ✅ correct (earlier "swapped" report was wrong) |
| **`$gc`** | **globalChannelMap** | **configurationMap** | 🔴 **silent collision** |
| `$cfg` | configurationMap | — (absent) | ❌ missing |
| `$c` | channelMap | — (absent) | ❌ missing |
| `$co` | connectorMap | — (absent) | ❌ missing |
| `$s` | sourceMap | — (absent) | ❌ missing |

**The dangerous one is `$gc`:** a migrated Mirth script using `$gc('x')` to read the **global channel map** will instead read the **configuration map** in Mirthless — no error, just wrong data. In healthcare that's a silent-wrong-value class of bug. **Fix:** align `$gc`→globalChannelMap, add `$cfg`→configurationMap, and add the missing `$c`/`$co`/`$s`. This is small and high-value; do it before anyone ports scripts.

---

## 3. Transformer Step Types — 🟡

Mirth has six visual step types: **Mapper, Message Builder, JavaScript, XSLT, External Script, + Iterator** (repeat/loop wrapper). Mirthless (`transformer.schema.ts`, `TransformerStepEditor.tsx`) has three: **JavaScript, Mapper, Message Builder**.

- **Missing: XSLT, External Script, and Iterator.** The **Iterator** absence is the notable one — repeating-segment mapping (e.g. iterate OBX segments) is a daily HL7 idiom; without an Iterator step users must hand-write loops in a Code step. Medium impact, UX-level (not a hard blocker).

---

## 4. Message Engine & Storage — 🟡/🔴 several half-built features

Mirthless reproduces the *coarse* model well (5 `MessageStorageMode` levels, queue-mode/retry, recovery, at-rest encryption, age-based prune) and is **cleaner** in a few spots. The gaps are granularity — and three features that are wired in the schema but not the runtime.

| Capability | Mirth | Mirthless | Sev |
|---|---|---|---|
| Storage modes | 5 modes + ~20 per-content-type `StorageSettings` booleans | Same 5 modes, gating collapses to 3 fixed content sets (`shouldStoreContent`) | 🟡 |
| **Custom metadata columns** | Defined, **populated via MetaDataReplacer**, typed, **searchable** | Table + `mappingExpression` stored, **never populated in pipeline, not in search** | 🔴 half-built |
| **Message pruner** | Separate `pruneContentDays` vs `pruneMetaDataDays`, **archive-then-prune**, skipIncomplete, events | Whole-message age delete; `pruningArchiveEnabled` flag exists but **no archiver**; no content/metadata split | 🔴 half-built |
| **Destination queue** | queueEnabled, retryCount/interval, **threadCount buckets + groupBy hashing, rotate, queueBufferSize** | queueMode/retry + `rotateQueue`/`threadCount` **in schema but consumer ignores them** (single poll loop) | 🔴 half-built |
| **Message search operators** | regex text, metadata operators (EQ/GT/LT/CONTAINS), error, send-attempt range, id ranges, content-type search | status, date, id, metaDataId, content **ILIKE substring only** | 🔴 daily-use gap |
| Reprocess / resend | reprocess, **reimport**, resend individual destination, per-destination-subset | reprocess, bulk, resendDestination (queue-enabled only); **no reimport, no subset** | 🟡 |
| Durability toggles | durable / rawDurable / recovery flags | Implicit via Postgres txn | 🟢 low |
| Encryption at rest | Pluggable `Encryptor` | AES-256-GCM, **fail-loud if key missing** | 🟢 ahead |
| Multi-consumer dequeue | — | **`FOR UPDATE SKIP LOCKED`** | 🟢 ahead |
| Statistics counters | received/filtered/queued/sent/error | Same | 🟢 |

**What needs to be fixed (priority order within this section).**
1. **Message search operators** — add metadata-column search, regex, error and send-attempt filters. Highest daily-use pain for operators triaging messages.
2. **Custom metadata columns** — populate them from `mappingExpression` during the pipeline and expose in search (this and #1 are complementary — the columns are useless until both land).
3. **Destination-queue threading** — honor `threadCount`/`groupBy`/`rotate`/buffer in the consumer, or remove the dead schema fields. Affects throughput and ordering guarantees at volume.
4. **Pruner** — implement the archiver behind `pruningArchiveEnabled` and split content-days vs metadata-days (HIPAA retention often wants metadata kept longer than PHI content).

---

## 5. Channel Lifecycle, Scripts & Code Templates — 🟢 mostly parity

Strong parity on all four channel script types (deploy/undeploy/preprocessor/postprocessor + attachment/batch), all four global scripts, groups, tags, dependency cycle-validation, and deploy/redeploy/initial-state. **Mirthless exceeds Mirth** on channel revision history (full JSONB snapshots + comment + userId vs Mirth's bare `revision` integer) and redeploy state-preservation. Real gaps:

| Capability | Mirth | Mirthless | Sev |
|---|---|---|---|
| **Dependency-ordered deploy** | `ChannelDependencyGraph` topological deploy order | Stored + cycle-validated, **but `autoDeployChannels` iterates arbitrarily** — no topo sort | 🔴 correctness |
| **Code-template library per-channel scoping** | `enabledChannelIds`/`disabledChannelIds`/`includeNewChannels` | Flat — every template offered to every channel (context-filtered only) | 🟡 |
| Channel/set export completeness | Bundles code templates + dependencies + set-level | Channel-only (scripts inline); **omits templates, deps, groups, tags**; no set export | 🟡 |
| Per-channel pruning granularity | metadata-days / content-days / archive | Single `pruningMaxAgeDays` + archive flag | 🟡 (ties to §4) |
| Template types | FUNCTION / DRAG_AND_DROP / COMPILED (3) | FUNCTION / CODE_BLOCK (2) | 🟡 |
| Per-channel `resourceIds` binding | Yes (ties to library resources) | messageStorageMode/encrypt present; **no resourceIds binding** | 🟡 (ties to §6) |

**Most important fix:** **dependency-ordered deploy.** Storing and validating the dependency graph but not applying it at deploy time means a channel can start before the channel it depends on — a latent, order-dependent failure. Small change (topological sort in `autoDeployChannels`), real correctness win.

---

## 6. Admin / Server / Extensions — 🔴 the extension model (strategic)

Feature-parity items are largely covered as **built-in services** (data pruner, server log, dashboard status, config map, global scripts, SMTP/settings, SSL/keystore manager, backup/restore, system info). RBAC has ~30 granular `resource:action` permissions — good. The gaps:

| Capability | Mirth | Mirthless | Sev |
|---|---|---|---|
| **3rd-party plugin/extension system** | Runtime loader, 30 `plugin.xml` descriptors, 8 typed extension points (`ServicePlugin`, `ChannelPlugin`, `DataTypeServerPlugin`, `ResourcePlugin`, `TransmissionModeProvider`, `AuthorizationPlugin`, `MultiFactorAuthenticationPlugin`, …), zip install/uninstall | **None** — static built-in catalog (`extension.service.ts`) with enable/disable only | 🔴 strategic |
| Add connectors/datatypes/dashboard panels by 3rd party | Yes (plugin) | No — must fork/PR | 🔴 strategic |
| Granular RBAC | Operation-based; commercial plugin adds per-channel ACLs | 30 perms but **4 fixed roles**, no custom roles / per-channel grants | 🟡 |
| Library resources (JAR/classpath injection to channels) | `ResourcePlugin` dynamic classpath | resource.service — metadata only, **likely no runtime classpath/module injection** (verify) | 🟡 |
| LDAP / Active Directory | `AuthorizationPlugin` (**commercial**) | None | 🟡 (parity w/ OSS core) |
| MFA / SSO | `MultiFactorAuthenticationPlugin` (**commercial**) | None | 🟢 (parity w/ OSS core) |
| Password policy engine | Configurable | `failed_login_attempts` column only | 🟡 |
| Clustering / advanced | **Commercial** | None | 🟢 (parity w/ OSS core) |

**On the extension system — a decision, not a defect.** Replicating individual Mirth plugins as built-ins is tractable and mostly done. Replicating the **open plugin platform** (descriptor format, isolated loading, extension-point SPI, install lifecycle) is a large, deliberate architectural choice. Mirth's extensibility is a core reason for its ecosystem. **Recommendation:** decide explicitly whether Mirthless wants a third-party extension contract (even a narrow, modern one — e.g. npm-package connectors/datatypes registered via a manifest) or commits to a curated built-in-only model. Don't let it be decided by default. *Note:* LDAP/MFA/clustering are Mirth **commercial** extensions — their absence is parity-with-open-source, not a shortfall vs OIE.

**Custom RBAC roles** is the tractable near-term item here: allow defining roles as permission sets rather than the 4 hardcoded roles. Healthcare orgs frequently need "developer who can't deploy to prod" style roles.

---

## 7. Alerts, Events & Monitoring — 🟢 parity or ahead

Core alerting, events, statistics, and message browsing are present, and Mirthless is **ahead** on real-time and observability. Gaps are Mirth's per-connector granularity.

| Capability | Mirth | Mirthless | Sev |
|---|---|---|---|
| **Per-connector connection state** | dashboardstatus plugin: IDLE/READING/WRITING/POLLING/CONNECTED/WAITING/DISCONNECTED | Channel-level STARTED/STOPPED/PAUSED only | 🔴 (ops visibility) |
| **Current connections / queue depth per connector** | connectionCount / maxConnectionCount | None | 🔴 |
| Per-connector connection log | timestamped `ConnectionLogItem` feed | None | 🟡 |
| Alert error-stage granularity | 13 `ErrorEventType`s (serializer/filter/transformer/response/deploy/…) + regex | `CHANNEL_ERROR` + `errorTypes[]`/regex (stage mapping thin) | 🟡 |
| Alert scope | per-channel **and per-connector** | per-channel only | 🟡 |
| Alert action types | Email, Channel, **User (dashboard notify)** | Email, Channel, Log (**no dashboard notify**) | 🟢 low |
| Alert throttling | bare count + reset | **interval + max-count** | 🟢 ahead |
| Event filters | + attributeSearch, ipAddress, serverId, id-range | level/name/outcome/userId/channelId/dates | 🟡 |
| Event export | export / export-and-remove | **CSV + JSON** | 🟢 ahead |
| Real-time push | polling | **Socket.IO** (dashboard + channel + log rooms) | 🟢 ahead |
| Metrics | none shipped | **Prometheus `/metrics`** | 🟢 ahead |
| Per-channel labeled metrics | n/a | aggregate counters only (no per-channel labels) | 🟡 |
| Per-step content view | raw/transformed/encoded/sent/response + maps | Same set (decrypted) | 🟢 |

**Most important fix:** **per-connector connection monitoring** (Mirth's dashboardstatus). When a TCP destination is stuck, operators need to see "WRITING / 3 connections / queue depth 412" at the connector level — channel-level STARTED isn't enough for triage. Add per-channel labels to the Prometheus metrics at the same time.

---

## 8. Where Mirthless Already Exceeds Mirth (non-connector)

- **Channel revision history** — full JSONB snapshots + comment + user (Mirth: bare integer).
- **Encryption at rest** — AES-256-GCM, **fail-loud** if key missing (never silently stores plaintext PHI).
- **Concurrency** — `FOR UPDATE SKIP LOCKED` multi-consumer dequeue; `storageModeSupportsQueue` invariant.
- **Real-time** — Socket.IO dashboard/channel/log rooms vs Mirth's client polling.
- **Observability** — Prometheus `/metrics` shipped in core.
- **Alert throttling** — interval + max-count vs bare count.
- **Event export** — CSV *and* JSON.
- **Result-typed** recovery and services throughout.

---

## 9. Prioritized Remediation Roadmap (non-connector)

Ranked by real-world impact (channels blocked / correctness / daily-use pain), not effort. Effort is a rough T-shirt size.

| Rank | Item | §  | Sev | Effort |
|---|---|---|---|---|
| 1 | **EDI/X12 + NCPDP serializers** (+ enum entries) | 1 | 🔴 | L |
| 2 | **Finish declared-but-pass-through datatypes** (Delimited, HL7v3, DICOM→XML) | 1 | 🔴 | M |
| 3 | **Fix `$gc` collision + add `$cfg`/`$c`/`$co`/`$s`** | 2.1 | 🔴 | S |
| 4 | **Message search operators** (metadata, regex, error, send-attempt) | 4 | 🔴 | M |
| 5 | **Populate custom metadata columns + make searchable** | 4 | 🔴 | M |
| 6 | **Dependency-ordered deploy** (topological sort) | 5 | 🔴 | S |
| 7 | **Destination-queue threading** (threadCount/groupBy/rotate) or remove dead fields | 4 | 🔴 | M |
| 8 | **Pruner archiver + content/metadata-day split** | 4 | 🟡 | M |
| 9 | **JS API breadth** (DateUtil, ChannelUtil, AttachmentUtil, SerializerFactory, getArrayOrXmlLength, …) | 2 | 🟡 | L |
| 10 | **Per-connector connection monitoring** + per-channel Prometheus labels | 7 | 🔴 | M |
| 11 | **Iterator transformer step** (+ XSLT / External Script) | 3 | 🟡 | M |
| 12 | **Code-template per-channel library scoping** | 5 | 🟡 | S |
| 13 | **Custom RBAC roles** (roles as permission sets) | 6 | 🟡 | M |
| 14 | **Export completeness** (templates/deps/groups/tags + set export) | 5 | 🟡 | S |
| 15 | **Alert per-connector scope + error-stage granularity** | 7 | 🟡 | M |
| — | **Extension/plugin platform** | 6 | 🔴 | XL — *strategic decision, not a scheduled task* |

---

## 10. Open Decisions

1. **Extension model** — commit to a curated built-in-only engine, or design a modern third-party extension contract (npm-package connectors/datatypes via manifest)? Biggest strategic call in this doc. *Recommendation: decide deliberately; a narrow manifest-based connector/datatype SPI captures most ecosystem value without Mirth's classloader complexity.*
2. **HL7v2 access model** — keep the path-proxy or offer a Mirth-compatible XML/E4X-style `msg` for script portability? Affects how cleanly Mirth transformers migrate.
3. **Dead schema fields** — for queue threading and pruner archive, either implement or remove. Leaving flags that do nothing is a correctness/trust hazard (they imply behavior that doesn't exist).
4. **Datatype scope** — X12 and NCPDP are large; gate behind demand, or build proactively as parity table-stakes? *Recommendation: Delimited + HL7v3 + DICOM-serialize first (already half-done via enum), X12/NCPDP on first real channel need.*

---

## 11. Appendix — Key File References

**Mirthless — sandbox/datatypes:** `packages/engine/src/sandbox/{sandbox-executor,bridge-functions,template-injector}.ts`, `packages/engine/sandbox-globals.d.ts`, `packages/engine/src/pipeline/data-type-handler.ts`, `packages/core-models/src/constants.ts` (`DATA_TYPE`), `packages/core-models/src/schemas/transformer.schema.ts`
**Mirthless — engine/storage:** `packages/server/src/engine.ts` (`shouldStoreContent`, `storageModeSupportsQueue`, encrypt gating), `packages/server/src/services/{data-pruner,message-query,message-reprocess,message-export}.service.ts`, `packages/engine/src/runtime/{queue-consumer,recovery-manager}.ts`
**Mirthless — lifecycle/admin/monitoring:** `packages/server/src/services/{deployment,channel-dependency,code-template,global-script,channel-export,extension,alert,event,event-export,statistics}.service.ts`, `packages/server/src/lib/{socket,metrics}.ts`, `packages/web/src/components/messages/*`
**Mirth reference:** `reference/connect/server/src/com/mirth/connect/server/userutil/*`, `.../plugins/datatypes/{edi,ncpdp,hl7v3,dicom,delimited}/*`, `.../donkey/.../StorageSettings.java`, `.../queue/DestinationQueue.java`, `.../model/MessageStorageMode.java`, `.../model/filters/{MessageFilter,EventFilter}.java`, `.../plugins/datapruner/DataPruner.java`, `.../server/controllers/DefaultExtensionController.java`, `.../plugins/dashboardstatus/*`, `.../model/codetemplates/CodeTemplateLibrary.java`, `.../core-util/.../ChannelDependencyGraph.java`
**OIE 4.6.0:** `C:\Users\mhobb\WebstormProjects\_temp\engine` (connector/datatype set confirmed identical to reference)
