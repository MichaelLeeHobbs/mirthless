# 14 — Beyond Mirth: Competitive Capability Gaps vs the Broader Integration Landscape

> **Status:** Draft for review · **Date:** 2026-07-15 · **Owner:** Michael Hobbs
> **Scope:** Capabilities that *other* integration engines and health-data platforms offer that Mirthless lacks — deliberately looking **past** Mirth/OIE parity (docs [12](./12-connector-parity-gap-analysis.md), [13](./13-non-connector-gap-analysis.md)) to "what should a modern engine that isn't shackled to Mirth's legacy aim for?"
> **Method:** A 6-category survey (healthcare engines, iPaaS/low-code, streaming, workflow/EIP, FHIR/interop, platform/DevEx) → adversarial verification of each candidate against both the cited product's real capabilities and a grounded Mirthless inventory. 68 candidates → **35 confirmed gaps, 33 partial, 0 rejected** (75 agents). Engines surveyed: Rhapsody, Cloverleaf, Corepoint, InterSystems IRIS for Health, Smile CDR, HAPI FHIR, MuleSoft, Boomi, Workato, Tray, n8n, WSO2, Kafka/Confluent, Pulsar, NATS, Redpanda, Apache Camel, NiFi, Node-RED, Camunda/Zeebe, Temporal, Kestra, Google/AWS/Azure health clouds, Redox, 1upHealth, Health Gorilla, Kong.

---

## 0. The One Thing to Understand First

The verification stage confirmed a striking pattern: **almost none of these are Mirth parity gaps.** For nearly every item, the verifier noted *"Mirth Connect itself lacks this too — it's a platform-category expansion, not a routing-engine feature."* In other words, this document is not a list of things we're behind on. It's a **menu of directions to grow into**, and the central risk is not missing features — it's **chasing too many of them and turning a focused healthcare interface engine into a bloated everything-platform.**

So "go beyond Mirth" forks into two very different products:

- **(A) The best *interface engine*** — Mirth's mission, done right with modern JS/TS, no legacy: rock-solid connectors, transforms, routing, ops resilience, and DevEx.
- **(B) A full *health-data platform*** — FHIR server + EMPI + terminology + national-network query + workflow orchestration + iPaaS marketplace.

**Most confirmed gaps are (B).** My recommendation, threaded through this doc: **nail (A) first** (it's the stated mission, and the connector blockers in doc 12 are still the gating work), then **climb selectively into the regulated, high-tailwind slice of (B)** — FHIR-native transform/validate/bulk — while **partnering or integrating rather than building** for the heavy platform categories (EMPI, terminology hosting, TEFCA, full streaming, workflow orchestration, iPaaS gateway/marketplace).

**Recommendation verbs used below:**
- 🟢 **PURSUE** — fits the interface-engine mission, real value, no legacy reason not to.
- 🟡 **CONSIDER** — valuable, but gate on product direction or customer demand.
- 🔗 **PARTNER / INTEGRATE** — real need, but the right move is a connector/integration to a best-of-breed system, not reimplementing it.
- ⛔ **NON-GOAL** — would dilute focus; explicitly out of scope (put a real tool in front/beside instead).

Nothing here is required for v1.0. Docs 12–13 are. This is the horizon map.

---

## 1. Operational Resilience & Production-Readiness — *the real table-stakes*

This is the domain where "beyond Mirth" overlaps most with "actually production-grade for a hospital." These are the items I'd act on soonest, because they're about not losing or silently stalling clinical messages.

| Capability | Engines | Relevance | Rec | Notes |
|---|---|---|---|---|
| **Silent-interface / heartbeat / SLA alerting** ("no message in N min", throughput/queue-depth thresholds, connection-down) | Rhapsody, Corepoint (Mobile Monitor), Cloverleaf | **core** | 🟢 **PURSUE — #1** | The deadliest failure is the *silent* one; our alert engine only fires on `CHANNEL_ERROR`, with no scheduler evaluating statistics. A stalled feed goes unnoticed until a clinician reports a missing result. Cheap relative to impact. |
| **HA / clustering / automatic failover** (node membership, leader election, singleton-source ownership) | InterSystems, Rhapsody, Cloverleaf, Corepoint, Smile CDR | **core** | 🟢 **PURSUE** | We have `FOR UPDATE SKIP LOCKED` dequeue but **no clustering** — running two nodes today would *duplicate* inbound messages on singleton source connectors. The genuine production gap. Hard; design early. |
| **Native dead-letter / retry-letter queues** with auto-routing | Kafka, RabbitMQ, Camel | valuable | 🟢 PURSUE | Small; we have retry/queue but no first-class DLQ surface. |
| **Circuit breaker** for persistently failing endpoints (open/half-open/closed + fallback) | Apache Camel | valuable | 🟡 CONSIDER | Queueing already prevents message loss; breaker adds fail-fast so one dead PACS doesn't exhaust threads. |
| **General-purpose scheduler / cron flow triggers** | most iPaaS/workflow | **core** | 🟢 PURSUE | *Partial today* — we have polling connectors; a first-class time-trigger (cron channel start) is a common need. Verify current state. |
| **Consumer-driven backpressure / flow control** | Kafka, NiFi, reactive engines | niche | 🟡 CONSIDER | Ties to the queue-threading rework (doc 13 N7). |

---

## 2. Observability & Developer Experience

Where our modern stack should let us *exceed* Mirth easily — we already ship Prometheus + Socket.IO, which Mirth doesn't.

| Capability | Engines | Relevance | Rec | Notes |
|---|---|---|---|---|
| **End-to-end message lineage / cross-channel tracing** + **OpenTelemetry** spans across hops | Temporal, Camunda, Kong, MuleSoft | **core** / valuable | 🟢 PURSUE | We have per-step content views + metrics but **no trace stitching a message's journey across channels** (MLLP→transform→Channel route→FHIR out). The difference between "error rate up" and "this message wedged at the FHIR POST retry." Complements doc 13's per-connector monitoring (N10). |
| **Interface test framework** — assertion-based per-channel regression suites in CI (feed sample message → assert transformed output / routing / map values) | MuleSoft MUnit, Boomi Test Mode | valuable | 🟢 PURSUE | Transform logic is exactly where silent data-integrity bugs hide. A user-facing channel-test harness that runs in CI is deeply aligned with the healthcare/testing mandate in CLAUDE.md. Strong differentiator; our engine-level Vitest tests don't cover *user-authored* interfaces. |
| **Environment promotion / config-as-code / GitOps** (dev→test→prod pipelines, declarative channel config in git) | MuleSoft, Boomi, cloud-native | valuable | 🟢 PURSUE | We have JSON channel export already — the building block. Formalize into env-diffing + promotion + git-native config. Real operational pain point in every Mirth shop. |
| **Design-time flow simulation / connector mocking** | MuleSoft, Boomi | valuable | 🟡 CONSIDER | Test a transform without a live endpoint. Pairs with the test framework. |
| **Blue-green / canary channel deploy** with traffic shifting | cloud-native | niche | ⛔ NON-GOAL | Deployment-infra concern; solve at the orchestration layer, not the engine. |

---

## 3. FHIR-Native & Modern Interoperability — *the biggest strategic direction*

This is the heart of product (B) and where the regulatory tailwind is strongest (CMS Interoperability, TEFCA, US Core, ONC certification). It's also where "beyond Mirth" is most real — Mirth treats FHIR as a plugin; a from-scratch modern engine can make it native. **But be disciplined: becoming a FHIR *server/datastore* is a platform pivot, while validating/transforming/bulk-moving FHIR in the pipeline is squarely engine work.**

| Capability | Engines | Relevance | Rec | Notes |
|---|---|---|---|---|
| **HL7v2 / C-CDA → FHIR conversion** (mapping templates, not hand-scripts) | Rhapsody, Smile CDR, cloud health APIs | **core** | 🟢 PURSUE | The defining modern-interface-engine transform. Pairs with finishing our datatype serializers (doc 13 N1/N2). This is *engine* work, not platform. |
| **FHIR profile / IG conformance validation** (US Core, IPS, Da Vinci — `$validate` against StructureDefinitions) | HAPI, Smile CDR, Azure, Google | valuable | 🟢 PURSUE | Fully absent today (only a pass-through "FHIR" datatype). Can validate **in-pipeline** without becoming a server — assert "this resource is US Core compliant" before routing. High value, bounded scope. |
| **Bulk FHIR `$export` / `$import`** (Flat FHIR, ndjson, async kickoff/poll) | HAPI, Smile CDR, Google, AWS, Azure, 1upHealth | **core** | 🟡 CONSIDER | Regulatory table-stakes for payer/population use cases. We only do single-resource R4 REST. Real, but larger. |
| **Terminology services** (`$validate-code`, `$expand`, `$translate`; SNOMED/LOINC/ICD/RxNorm ValueSet/ConceptMap) | HAPI, Smile CDR, IRIS, cloud | valuable | 🔗 PARTNER (+ 🟢 pursue a *client*) | Hosting a terminology server is platform territory. But a **terminology *client*** in the sandbox (`$translate`/`$validate-code` against an external tx server) + ConceptMap-driven mapping is engine-appropriate and high-value for semantic normalization. |
| **Inbound FHIR facade / listener** (be queryable as a FHIR endpoint, not just push) | Smile CDR, IRIS, Rhapsody | valuable | 🟡 CONSIDER | A FHIR *source connector* (facade over legacy) is engine territory; a persistent FHIR *repository* is not (below). |
| **Persistent FHIR repository / RESTful server** (system-of-record, CRUD/search/history/`$everything`) | HAPI, Smile CDR, Google, AWS, Azure | valuable | ⛔ NON-GOAL (big decision) | Becoming a FHIR datastore is a category pivot from "engine" to "platform." If ever pursued, integrate/embed HAPI rather than build. |
| **SMART on FHIR + OAuth2 scopes** (app launch, `patient/*.read`) | Smile CDR, Azure, 1upHealth, Google, Health Gorilla | valuable | 🟡 CONSIDER | Presupposes being a FHIR server/facade. Gate on the facade decision. |
| **FHIR Subscriptions** (topic-based push) | HAPI, Smile CDR, Azure, Google | valuable | 🟡 CONSIDER | Also a FHIR-server capability; gate on facade. |
| **CDS Hooks** (server-side hooks, cards) | Smile CDR, HAPI | niche | ⛔ NON-GOAL | Clinical-decision-support-platform feature; out of engine scope. |
| **SQL-on-FHIR / clinical NLP / analytics-ready views** | cloud health APIs | niche | ⛔ NON-GOAL | Analytics platform territory. |

---

## 4. EDI / B2B — *the claims & eligibility domain*

Directly reinforces doc 12/13: the missing X12 serializer isn't just a datatype gap — the whole B2B lifecycle sits on top of it.

| Capability | Engines | Relevance | Rec | Notes |
|---|---|---|---|---|
| **X12 / EDIFACT serializer** (837/835/270/271, control numbers) | Boomi, MuleSoft, WSO2, *and Mirth itself* | **core** | 🟢 PURSUE | Already tracked as doc 13 **N1**. This is the one B2B item where we trail **Mirth**, not just the field. |
| **Trading-partner management + AS2/MDN + acks (997/999/TA1)** | Boomi B2B, MuleSoft Partner Manager | **core** | 🟡 CONSIDER | The relationship/envelope/ack lifecycle above the serializer. Unlocks US payer/claims traffic. Larger; gate on entering the claims domain. |

---

## 5. Enterprise Integration Patterns — *engine-native, and we should have these*

Unlike most of this doc, EIP patterns (Apache Camel's heritage) are **core interface-engine primitives**, not platform expansions. Several also directly fix half-built items from doc 13.

| Capability | Engines | Relevance | Rec | Notes |
|---|---|---|---|---|
| **Aggregator / correlate-and-combine** (collect related messages by key, release on count/timeout/predicate) | Camel, NiFi | valuable | 🟢 PURSUE | Many-to-one assembly: coalesce multi-OBX ORU fragments, batch claims into an 837. **Ties directly to the existing Collections feature** (keyed record store) — make correlate-and-release first-class on top of it rather than hand-rolled in globalMap. |
| **Key-based partitioning / per-key ordering + horizontal scale** | Kafka, Pulsar, Redpanda, NATS | valuable | 🟢 PURSUE | Solves per-patient ordering (A08 must not overtake A01) *while* scaling out. **This is the real fix for doc 13's ignored `threadCount`/`groupBy` queue fields (N7)** — frame the queue rework as keyed partitioning. |
| **Wire-tap** (non-intrusive message copy to a side channel) | Camel | valuable | 🟢 PURSUE | Small, useful for audit/debug/parallel feeds. |
| **Resequencer** (reorder by sequence/timestamp) | Camel | valuable | 🟡 CONSIDER | HL7 ordering; often better solved by sequential queues than a sort-window. |
| Content-based router, splitter | Camel, NiFi | — | ✅ mostly have | Routing + batch splitting already exist. |

---

## 6. Streaming & Event Infrastructure — *mostly integrate, don't rebuild*

Real capabilities, but this is **Kafka's category, not ours.** Reimplementing a streaming platform inside a healthcare engine is the clearest example of scope dilution. The right move for most of these is a **Kafka/Pulsar connector** so Mirthless participates in a streaming backbone without becoming one. Cherry-pick only the few that are engine-local.

| Capability | Relevance | Rec |
|---|---|---|
| **Log-based CDC ingestion** (Debezium — ordered row-level DB changes incl. deletes) | valuable | 🔗 PARTNER/INTEGRATE (Debezium-style DB source, or Kafka Connect connector) |
| **Replayable event log / replay from offset-timestamp** | valuable | 🟡 CONSIDER (our message store + reprocess is a partial analog; formalize replay) |
| **Idempotent producers / exactly-once delivery** | valuable | 🟡 CONSIDER (idempotency keys on destinations) |
| **Schema registry + enforced schema evolution** | valuable | ⛔ NON-GOAL / 🔗 integrate |
| **Distributed consumer groups + rebalancing** | valuable | ⛔ NON-GOAL (that's Kafka) |
| **Stateful stream processing** (windowing, joins, aggregation) | valuable | ⛔ NON-GOAL / 🔗 integrate Flink/ksqlDB |
| **Log compaction, tiered/infinite storage, geo-replication** | niche/valuable | ⛔ NON-GOAL |

> **Recommendation:** ship a **Kafka (and/or NATS) connector** as the strategic answer to this whole row. It gives customers the streaming backbone they want and positions Mirthless as the *healthcare-aware edge* of an event platform, not a competitor to it.

---

## 7. Patient Identity & National Networks — *partner, don't build*

The highest-stakes, most distinct product categories. Even the big platforms treat these as separate products, and getting them wrong is a patient-safety event.

| Capability | Engines | Relevance | Rec | Notes |
|---|---|---|---|---|
| **EMPI / patient matching / MDM** (deterministic+probabilistic linkage, golden record, `$match`) | IRIS, Smile CDR (MDM), Rhapsody, HAPI MDM, Health Gorilla | valuable | 🔗 PARTNER/INTEGRATE | Merging the wrong patients can kill someone. Distinct product category; integrate an EMPI (or embed HAPI MDM) rather than hand-roll. Provide a clean `$match` client + hook points. |
| **National network / TEFCA QHIN / Carequality / CommonWell query + record locator** | Health Gorilla, Redox, 1upHealth | valuable | 🔗 PARTNER | You *integrate with* a QHIN (legal onboarding, XCPD/XCA); you don't *become* one in software. Build the connector. |
| **IHE profiles** (XDS.b, XCA, PIX/PDQ, MHD) | Smile CDR, HAPI/IPF | valuable | 🟡 CONSIDER (via connectors) | Backbone of regional HIEs. Deliver as connectors/actors when a deployment needs them; Mirth reached these via plugins. |

---

## 8. Security & Identity Governance

Mostly enterprise-console concerns that layer on the admin API. Several already appear in the doc 13 roadmap (SSO, custom RBAC roles).

| Capability | Engines | Relevance | Rec | Notes |
|---|---|---|---|---|
| **OAuth2 credential vault** (auth-code/client-credentials handshake + auto token refresh/rotation, reused across channels) | Workato, Tray, MuleSoft, Boomi | valuable | 🟢 PURSUE | Enabler for SMART-on-FHIR and modern EHR/SaaS APIs; managing OAuth per-channel in script is fragile. Complements the FHIR direction. |
| **SSO (SAML/OIDC) + SCIM provisioning/deprovisioning** | MuleSoft, Boomi, Kong | valuable | 🟡 CONSIDER | HIPAA access-control: auto-deprovision when staff leave. Ties to doc 13 **N13** (custom RBAC roles). Build together as the "enterprise auth" epic. |
| **External secrets manager** (Vault / cloud KMS, dynamic secrets, rotation) | Kong, MuleSoft, Boomi | valuable | 🟡 CONSIDER | We encrypt at rest (AES-256-GCM) but secrets live in our own store. Vault-backed references shrink breach blast radius. |
| **Multi-tenancy** (isolated tenants/namespaces on shared infra) | MuleSoft, Boomi, Temporal | valuable | 🟡 **DECISION** | Depends entirely on business model. On-prem server-per-org (the Mirth pattern) vs a multi-tenant SaaS is a **product/GTM decision**, not just engineering. Surface to the business before building. |

---

## 9. Transformation & Authoring

The "modern JS/TS" positioning is the wedge here. AI-assisted authoring in particular is where a greenfield engine can leapfrog Mirth's ecosystem.

| Capability | Engines | Relevance | Rec | Notes |
|---|---|---|---|---|
| **AI/LLM-assisted mapping + LLM step type** (suggest HL7→FHIR mappings, generate transforms from samples, native model/agent nodes) | Boomi, MuleSoft, n8n, Workato, Zapier | valuable | 🟢 PURSUE | Modern differentiator squarely on-brand for a from-scratch TS engine. Compresses the analyst's most expensive task (mapping). Two forms: **build-time** mapping assist (safe) and a **runtime** LLM step for narrative summarization/extraction (adopt skeptically in a PHI path — governance required). Our `httpFetch` bridge already reaches models; make it first-class. |
| **HL7v2→FHIR mapping templates** | (see §3) | core | 🟢 PURSUE | Cross-listed. |
| **Declarative transform language + streaming transforms** (DataWeave-style) | MuleSoft, WSO2 | valuable | 🟡 CONSIDER | The concrete value is **streaming large payloads** (not loading whole messages into vm memory), more than the declarative syntax. Consider a streaming transform path for large batches. |
| **Visual field-level data mapper** (drag lines between source/target fields) | MuleSoft, Boomi | valuable | 🟡 CONSIDER | Lowers the barrier for non-developer analysts. Pairs with mapping templates. |
| **Low-code visual flow canvas** (node graph vs tabbed forms) | MuleSoft, Boomi, n8n, Tray, WSO2 | valuable | 🟡 **DECISION / DEFER** | Big UX undertaking; Mirth-lineage is form+script and that's a deliberate identity. A modern node-canvas could be a differentiator, but it's a large bet — decide, don't drift into it. |

---

## 10. Workflow Orchestration — *adjacent category, integrate*

| Capability | Engines | Relevance | Rec | Notes |
|---|---|---|---|---|
| **Durable long-running / stateful workflow orchestration** (survive restarts, timers/waits/days, exactly-once steps) | Temporal, Camunda/Zeebe, Kestra | valuable | 🔗 PARTNER/INTEGRATE | Prior-auth, care-coordination, order→result→reconcile→bill are long-running. But this is Temporal's category. Integrate (Temporal client / a workflow connector) rather than build a durable-execution engine inside the router. A *light* resumable-multi-step feature could be considered later. |
| **Saga / compensation** (distributed rollback) | Camunda, Temporal | niche | ⛔ NON-GOAL |
| **Human-in-the-loop / manual task steps** | Camunda, workflow engines | niche | ⛔ NON-GOAL |

---

## 11. iPaaS Platform / Ecosystem — *mostly non-goals (front a real tool)*

The MuleSoft/Boomi/Workato feature set. Attractive-looking, but pursuing it is the fastest way to lose the healthcare focus. Note the **connector marketplace** connects to doc 13's *extension-platform decision* — a curated, manifest-based connector SPI captures the healthcare-relevant slice without becoming Zapier.

| Capability | Relevance | Rec | Notes |
|---|---|---|---|
| **SaaS/application connector marketplace** (hundreds of app connectors) | valuable | ⛔ NON-GOAL as-is / 🟡 curated via plugin SPI | Real healthcare integrations increasingly touch Salesforce Health Cloud / ServiceNow / EHR REST — but a curated set delivered via the **doc 13 extension platform** beats an open marketplace. |
| **API management & gateway** (rate-limit, quota, keys, spike control, versioning, analytics) | valuable | ⛔ NON-GOAL | Separate front-door tier. Put **Kong/APISIX in front** of the HTTP/FHIR endpoints rather than build a gateway into the engine. |
| **Developer portal for API consumers** | niche | ⛔ NON-GOAL |
| **Reusable API asset catalog / exchange** | valuable | 🟡 CONSIDER | Overlaps with code-template libraries (doc 13). |
| **Contract testing & spec-based API mocking** | niche | ⛔ NON-GOAL |

---

## 12. Recommended Strategic Direction (the short version)

If I had to compress 68 candidates into a bet: **spend the no-legacy advantage on being the best modern interface engine, plus the FHIR-native and AI-assisted slices — and integrate everything else.**

**Pursue (fits the mission, act when docs 12–13 blockers clear):**
1. **Silent-interface / SLA / heartbeat alerting** — deadliest failure mode, cheapest high-value win.
2. **HA / clustering / failover** — the one genuine production-grade gap; design early (message-duplication risk exists today).
3. **Keyed partitioning / per-key ordering** — reframes and fixes doc 13's dead queue-threading fields; per-patient order + scale.
4. **End-to-end lineage + OpenTelemetry tracing** — cross-channel message journeys.
5. **Interface test framework** (channel regression in CI) — on-brand with the testing mandate; strong differentiator.
6. **Environment promotion / config-as-code** — formalize the JSON export we already have.
7. **FHIR-native transform + IG/US-Core validation** (in-pipeline, not a server) + **HL7v2→FHIR mapping templates**.
8. **AI-assisted mapping + first-class LLM step** — the modern wedge.
9. **EIP primitives**: aggregator (on Collections), wire-tap, DLQ.
10. **OAuth2 credential vault** — enables the FHIR/SMART direction.

**Partner / integrate (don't rebuild):** EMPI, terminology hosting, TEFCA/QHIN, full streaming (ship a **Kafka connector**), durable workflow orchestration (Temporal), CDC (Debezium).

**Explicit non-goals (put a real tool beside/in front):** FHIR datastore/system-of-record, API management gateway, SaaS connector marketplace (curated-SPI instead), developer portal, saga/human-task workflow, streaming-platform internals, blue-green infra.

**Business decisions (not engineering):** multi-tenancy (SaaS vs on-prem), low-code visual canvas (identity bet), how far up the FHIR-server stack to climb.

---

## 13. Open Decisions

1. **Product identity:** interface engine (A) or health-data platform (B), and how far into B? This gates §3, §7, §8-multitenancy. *Recommendation: A first, then the regulated FHIR-native slice of B.*
2. **Streaming stance:** integrate (Kafka connector) vs build. *Recommendation: integrate.*
3. **FHIR server line:** validate/transform/bulk in-pipeline (engine) vs become a repository (platform). *Recommendation: stop at facade + validate + bulk; embed HAPI if a datastore is ever needed.*
4. **Multi-tenancy** — driven by GTM (SaaS vs licensed on-prem). Needs a business call.
5. **AI in a PHI path** — build-time assist is low-risk; a runtime LLM step needs a governance/BAA/data-handling policy before shipping.
6. **Connector marketplace vs curated SPI** — ties to the doc 13 extension-platform decision; pick one model.

---

## 14. Method, Confidence & Caveats

- **Verification upgraded strictness:** the verify pass repeatedly corrected researcher "partial" claims to "absent" (e.g. FHIR facade, SMART, IG validation, external secrets, silent-interface alerting) — the gaps are, if anything, *cleaner* than first surveyed. All 35 confirmed items are high-confidence.
- **0 rejected** is expected here, not suspicious: researchers were given the grounded Mirthless inventory up front and pre-filtered things we already ship (TLS, RBAC, FHIR client, Prometheus, revision history, etc.), so few false candidates reached verify.
- **The dominant caveat, restated:** most confirmed items are *beyond-Mirth platform expansions*, which is exactly what was requested — but it means this doc is a **strategy menu, not a defect list.** Treat 🟢 PURSUE items as roadmap candidates *after* the doc 12/13 blockers; treat ⛔/🔗 items as scope discipline.
- **Dedup:** semantic duplicates across surveys (terminology ×2, EMPI/patient-matching ×2, FHIR facade/repository ×3, durable workflow ×3, visual canvas ×2, backpressure ×2) are merged in the tables above.

---

## 15. Appendix — Verified Gap Inventory (35 confirmed)

**Core relevance:** HA/clustering · Silent-interface/SLA alerting · Bulk FHIR $export/$import · B2B/EDI (X12 + trading-partner) · (partials: interface testing, cross-channel lineage, cross-reference/lookup service, general scheduler, HL7v2/C-CDA→FHIR).

**Valuable relevance (confirmed):** Terminology services · EMPI/patient matching · FHIR repository/facade · SMART on FHIR · FHIR profile/IG validation · FHIR Subscriptions · National-network/TEFCA query · IHE profiles · SaaS connector marketplace · Low-code visual canvas · Declarative transform language · API management/gateway · AI-assisted integration · OAuth2 credential vault · Keyed partitioning/ordering · Stateful stream processing · Log-based CDC · Aggregator/correlation · Resequencer · Circuit breaker · Durable workflow orchestration · Interface test framework · OpenTelemetry tracing · Multi-tenancy · SCIM provisioning · External secrets manager · AI-assisted mapping.

**Niche (confirmed):** CDS Hooks.

Full per-item detail (engines, description, why-it-matters, verifier's corrected note) is in the workflow result: `<scratch>/tasks/w4yo0v4u5.output`. Companion docs: [12](./12-connector-parity-gap-analysis.md), [13](./13-non-connector-gap-analysis.md).
