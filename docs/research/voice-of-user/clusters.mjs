// Theme clusters: id, area, title, entries, status (have|partial|gap|n/a), verdict (have|build|consider|partner|wont|context), note.
// k() splits a space-separated key list.
const k = (s) => s.split(/\s+/).filter(Boolean);
const c = (id, area, title, keys, status, verdict, note) => ({ id, area, title, entries: k(keys), status, verdict, note });

export const AREAS = {
  LIC: 'Licensing, cost and governance',
  UI: 'Admin UI and usability',
  SCR: 'Scripting and transformation',
  DT: 'Data types and parsing',
  FHIR: 'FHIR',
  CON: 'Connectors',
  RT: 'Routing and pipeline',
  MSG: 'Message storage and search',
  REC: 'Reprocessing and recovery',
  MON: 'Monitoring, alerting and observability',
  PERF: 'Performance and scale',
  HA: 'High availability and deployment',
  OPS: 'Version control, promotion and config',
  API: 'API and CLI',
  SEC: 'Security, auth and audit',
  TEST: 'Testing and debugging',
  UPG: 'Upgrades and migration',
  DOC: 'Docs, community and ecosystem',
  AI: 'AI',
  OTH: 'Other',
};

export const CLUSTERS = [
  // Licensing / governance
  c('LIC1', 'LIC', 'Essential features are paywalled, and Mirth went closed-source at 4.6', 'MG95 MG97 OB1 OB3 QA69 QA20 CR6 CR8 WP57 WP58 OS91 CR78 MG96 WP61 WP56 WP62 OB4 OB5 CR35', 'have', 'have', 'Every feature ships free; no editions. Keep it that way in writing (license + governance doc).'),
  c('LIC2', 'LIC', 'License cost, renewals and per-interface pricing', 'CR4 CR5 CR7 CR86 WP60 CR85', 'have', 'have', 'Free removes the complaint outright.'),
  c('LIC3', 'LIC', 'Single-vendor control of roadmap and license; slow, unresponsive vendors', 'OB2 MG101 WP33 CR56 OB6 CR55 OS65 CR54 OB11', 'partial', 'build', 'Public roadmap, contribution guide, release cadence, and a license that cannot be pulled (consider foundation or CLA-free contribution).'),
  c('LIC4', 'LIC', 'Lock-in through proprietary configuration formats', 'CR10 OS78', 'partial', 'build', 'Publish the channel JSON schema and keep exports stable and documented.'),
  c('LIC5', 'LIC', 'Phone-home and forced vendor registration', 'MG99 QA70 WP28 OB20', 'have', 'have', 'No telemetry, no registration. Keep any future telemetry opt-in (see OTH2).'),
  c('LIC6', 'LIC', 'License provenance of bundled code, and an SBOM', 'MG98 OB160 MG87 WP69', 'gap', 'build', 'Generate an SBOM per release; license check in CI.'),
  c('LIC7', 'LIC', 'Paid support, hosting and training from someone', 'WP63 OB10 CR57', 'n/a', 'consider', 'Not engine work. Make it easy for third parties to offer support (stable releases, docs).'),

  // UI
  c('UI1', 'UI', 'Java desktop Administrator and launcher: fails to launch, freezes, breaks on new Java/macOS', 'MG107 OB22 OB23 QA51 QA53 WP29 WP30 OS85 MG106 MG108 MG109 MG110 QA102 OB62 CR18 CR19 MG100 OB25 WP67 MG9 MG111 QA52 OB43 WP44 OB24', 'have', 'have', 'Web UI, nothing to install. The single loudest Mirth complaint by volume.'),
  c('UI2', 'UI', 'Dated look: dark mode, HiDPI, density, font size', 'MG104 MG105 OB26 OB27 CR17 WP37 OS84 CR1 QA50', 'have', 'have', 'Light/dark themes and tokens exist; keep shots coverage.'),
  c('UI3', 'UI', 'Steep learning curve; needs specialist training', 'CR2 CR93 CR73 OS15 WP52 CR53 OB13', 'partial', 'build', 'Guided first channel, inline help, recipes (see DOC3).'),
  c('UI4', 'UI', 'Managing hundreds of channels: find ports, search inside scripts, bulk edit, grouping', 'MG115 MG116 OB33 OB35 QA55 WP32 OB39 WP8 OB156', 'partial', 'build', 'Groups and tags exist. Missing: listening-port column, grep across all scripts and templates, bulk edit.'),
  c('UI5', 'UI', 'Script editor lacks IDE features (autocomplete, typings, formatting)', 'MG8 OB68 QA37 WP41 OS69', 'partial', 'build', 'Monaco + TS exist; finish typed autocomplete for msg and the sandbox API, and bundle Monaco offline (ROADMAP).'),
  c('UI6', 'UI', 'Concurrent edits silently overwrite each other', 'MG112 OB41 OB40', 'have', 'have', 'Optimistic locking on channel revision. Real-time co-editing (OB40) is not planned.'),
  c('UI7', 'UI', 'Validate channel configuration before save/deploy', 'MG113 OB37 OB139 OB150', 'partial', 'build', 'Deploy validation exists; validate on save in the editor and at server start.'),
  c('UI8', 'UI', 'Transformer and rule editing ergonomics; mapper too limited', 'MG118 OB29 QA95 OB79 OS92 MG25', 'partial', 'build', 'Mapper steps do not deploy yet (D-207). Fix before any visual mapper.'),
  c('UI9', 'UI', 'Keyboard shortcuts, copy/paste, multiple windows, deep links, tooltips', 'MG119 MG114 OB28 OB36 WP31 CR81 OB30 OB32 MG117 MG121 QA54', 'partial', 'build', 'A browser gives tabs and links for free; audit copy-from-table and deep links.'),
  c('UI10', 'UI', 'Localization and 12/24-hour formats', 'MG120 OB31 WP53 OB64 OB8', 'gap', 'consider', 'Use locale formatting now; full i18n only on demand.'),
  c('UI11', 'UI', 'Readable HL7 viewer/editor: highlighting, field hover, hex, lab rendering', 'QA89 OS11 OS98 OB124 WP90 CR21 OB122 OB121 OS32 OS21', 'partial', 'build', 'Message viewer with segment/field hover and a raw/hex toggle; HL7 files with CR-only endings must display.'),
  c('UI12', 'UI', 'Show which server and environment you are on (production banner)', 'CR16 MG36', 'gap', 'build', 'Cheap; prevents production mistakes.'),
  c('UI13', 'UI', 'Generate human-readable documentation of channels', 'MG103 QA72 WP36', 'gap', 'build', 'Render a channel to HTML/Markdown: sources, filters, mappings, destinations.'),
  c('UI14', 'UI', 'Visual graph of channel topology', 'WP34', 'gap', 'consider', 'Channel dependency graph view; ties to MON8 lineage.'),
  c('UI15', 'UI', 'White-label branding', 'OB42 OS89', 'gap', 'consider', ''),
  c('UI16', 'UI', 'Mobile monitoring and push notifications', 'WP15', 'partial', 'consider', 'Phone-width layouts exist (shots).'),
  c('UI17', 'UI', 'Low-code visual mapping that analysts, not only programmers, can use', 'CR45', 'gap', 'consider', 'v2.0 flow editor. InterSystems DTL and Corepoint win reviews on this; code stays the escape hatch.'),

  // Scripting
  c('SCR1', 'SCR', 'Rhino is obsolete: want modern JavaScript (ES6+), no Java/JS string confusion', 'MG1 MG2 OB65 QA2 WP43 MG4 QA3 OB66 CR3', 'have', 'have', 'Node + TypeScript. Proprietary script languages (ObjectScript, Tcl, Lua) are a hiring complaint against rivals.'),
  c('SCR2', 'SCR', 'Keep E4X XML navigation', 'MG3 QA1', 'n/a', 'wont', 'D-244. QA1 shows E4X is also a top confusion source, which supports dropping it.'),
  c('SCR3', 'SCR', 'Java interop: custom JARs, classloader conflicts, importPackage', 'MG14 QA35 OB58 OB104', 'n/a', 'wont', 'No Java. The real need is "use a library": consider vetted npm packages exposed to the sandbox.'),
  c('SCR4', 'SCR', 'Thin standard library: dates/timezones, hashing, base64, UUID, identifiers, PDF', 'MG16 CR47 WP45 OB81 OB82 QA32 OS60 CR46 OS123 OS122', 'partial', 'build', 'N9. A documented, typed helper library is the most-built community workaround.'),
  c('SCR5', 'SCR', 'Iterating and editing repeating segments and fields', 'QA4 QA5 OS67 OS53', 'partial', 'build', 'Top Stack Overflow theme by views. Path API + iterator step (N11) + examples.'),
  c('SCR6', 'SCR', 'Lookup tables, value mapping and cached reference data', 'MG15 OB17 QA15 WP48 WP49 OB157 OS61', 'partial', 'build', 'Collections cover keyed lookups; add a table editor UI and code-system crosswalks (LOINC/SNOMED ConceptMap import).'),
  c('SCR7', 'SCR', 'Global/shared state: persistent maps, atomic operations, shared across nodes', 'MG11 MG12 MG72 QA34', 'partial', 'build', 'Global map persists; add atomic ops; cluster sharing comes with HA1.'),
  c('SCR8', 'SCR', 'Variable maps and the message model are confusing', 'QA33 QA93 OB72 OB75 OB74 QA94 OS107', 'partial', 'build', 'Docs plus typings: one page that says which map lives where and for how long.'),
  c('SCR9', 'SCR', 'Code template libraries: backwards dependencies, no find-usages, fragile import', 'MG13 OB69 OB70 QA36 WP7 OS82', 'partial', 'build', 'Library-to-channel scoping done (D-249); editor control and find-usages open (N12).'),
  c('SCR10', 'SCR', 'Server-level startup/shutdown and global scripts', 'MG10', 'have', 'have', 'Global scripts exist.'),
  c('SCR11', 'SCR', 'Python (or other languages) for scripts', 'CR48 WP46', 'gap', 'wont', 'One sandboxed language keeps security review and docs tractable. Revisit only on strong demand.'),
  c('SCR12', 'SCR', 'Scripts that hang or loop block everything', 'OB67 OS81', 'partial', 'build', 'Per-channel timeouts exist; worker threads still open (D-212).'),
  c('SCR13', 'SCR', 'XPath 2.0, XSLT 2.0, jq', 'MG24 QA99', 'gap', 'consider', ''),
  c('SCR14', 'SCR', 'Config map keys with dots fail to resolve', 'OB78 OS97', 'partial', 'build', 'Verify against D-246 `${category.NAME}` resolution; add a test.'),

  // Data types
  c('DT1', 'DT', 'HL7v2 fidelity: escapes, terminators, malformed input, structures across versions', 'MG17 QA6 QA7 OS30 OS33 OS54 OS70 OS27 OS28 OB84 QA90', 'partial', 'build', 'Round-trip corpus tests (byte-identical when untouched). QA90 is the most-viewed theme in the Q&A set.'),
  c('DT2', 'DT', 'Character encoding bugs', 'MG18 QA96 OB63', 'partial', 'build', 'Charset per connector exists; test non-Latin content end to end.'),
  c('DT3', 'DT', 'Validation: conformance profiles, strict parsing, data-quality rules, receiver-specific rules', 'QA86 OS29 OB80 OS103 OS105 OS99', 'partial', 'build', 'Profile-based validation step with readable errors; per-partner profiles.'),
  c('DT4', 'DT', 'JSON and XML to/from HL7 conversion is fragile', 'MG19 QA16 QA17 OS31 CR76 CR87', 'partial', 'build', 'Documented, lossless HL7 to JSON shape.'),
  c('DT5', 'DT', 'X12/EDI and NCPDP support', 'MG20 QA77 OB83 CR75 OS116 OS117', 'gap', 'build', 'Doc 17 S20. OS116: no mature open-source engine does X12 well, so this is a differentiator.'),
  c('DT6', 'DT', 'CDA/C-CDA parsing, generation and conversion', 'QA18 OS114 OS115', 'gap', 'consider', 'High views (QA18). XML path works today; a CDA helper layer is the ask.'),
  c('DT7', 'DT', 'Delimited, CSV, Excel and Parquet', 'MG22 QA92 MG21', 'partial', 'build', 'Doc 17 S19 (rows by column name).'),
  c('DT8', 'DT', 'Binary content: PDFs, images, base64, multipart corruption', 'QA30 OB94 OS49', 'partial', 'build', 'Connector parity [10] binary data type.'),
  c('DT9', 'DT', 'Custom schemas and Z-segments', 'QA85 OS26', 'have', 'have', 'Path API reads any segment; keep an example.'),
  c('DT10', 'DT', 'Batch files (FHS/BHS), split and aggregate', 'MG23 QA31 OS68', 'partial', 'build', 'HL7 batch split done (D-254); aggregator is B9.'),
  c('DT11', 'DT', 'Lab instruments: ASTM, serial', 'OB85 QA79 WP78 WP79', 'gap', 'consider', 'Someday list. Niche but Gold-tier paid in Mirth.'),

  // FHIR
  c('FHIR1', 'FHIR', 'First-class FHIR: listener, client, validation, R4/R5, bundles', 'MG28 QA19 CR74 WP86 OB12 OS51 OS41', 'partial', 'build', 'FHIR destination (R4) exists. Add FHIR source, bundle/transaction support, profile validation (B7).'),
  c('FHIR2', 'FHIR', 'HL7v2 to FHIR mapping that covers real messages and validates', 'WP87 OS55 OS56 OS57 OS58 OS110 OS59 OS113 OS111 OS112 OS126', 'gap', 'build', 'Every open converter is criticised for gaps and invalid output. Maintained, testable, overridable maps (B7) would be a reason to switch.'),
  c('FHIR3', 'FHIR', 'FHIR Subscriptions (rest-hook, R5 topics, websocket) and FHIRcast', 'OS34 OS35 OS36 OS37 OB91 OS130', 'gap', 'consider', 'Someday list.'),
  c('FHIR4', 'FHIR', 'Bulk FHIR import/export client', 'OS39 OS40', 'gap', 'consider', ''),
  c('FHIR5', 'FHIR', 'Cloud FHIR stores are not engines: need MLLP-to-cloud bridging', 'CR71 CR72 WP84', 'gap', 'build', 'Opportunity: MLLP in, cloud healthcare API out, with OAuth (CON5).'),

  // Connectors
  c('CON1', 'CON', 'TCP/MLLP robustness: resets, keepalive, socket leaks, framing', 'QA26 MG38 OS20 OS120 OS1 OS66 QA27 OS121', 'have', 'have', 'Biggest Q&A theme by count. Framing configurable (D-253); keep the E2E suite growing.'),
  c('CON2', 'CON', 'TLS on MLLP and every connector without a paid plugin', 'OB89 QA25 WP21 OS24 OS23', 'partial', 'build', 'TCP TLS and certificates exist; DICOM TLS open ([8]).'),
  c('CON3', 'CON', 'Custom ACK/NACK control and response mapping', 'QA8 MG39 QA9 OS72 OS73 MG51 QA22', 'have', 'have', 'Response modes, auto-ACK (D-255), postprocessor response (D-239).'),
  c('CON4', 'CON', 'HTTP connector flexibility: multipart, headers, binary, status codes, paths, gzip', 'QA21 MG40 OB93 WP85 OS96 OB96 CR67 QA97 OS25', 'partial', 'build', 'matchSubpaths done (D-243); multipart and binary open.'),
  c('CON5', 'CON', 'Outbound auth: OAuth2 with token refresh, SMART, digest, proxy credentials', 'MG41 CR70 QA24 OS44', 'gap', 'build', 'B10 credential vault. Blocks the FHIR/cloud direction.'),
  c('CON6', 'CON', 'Remote files: SFTP/FTP/SMB/S3 reliability and schemes', 'MG32 MG33 MG34 QA29 CR68 OB101', 'partial', 'build', 'SFTP exists; FTP/FTPS/SMB/S3 schemes are parity gap [2].'),
  c('CON7', 'CON', 'File ergonomics: dynamic and original file names, move after read, header row, per-poll limit', 'QA28 OB97 OS95 OB98', 'partial', 'build', '`${originalFilename}` on destinations still open (D-219).'),
  c('CON8', 'CON', 'Database connector: more vendors, pooling, robustness', 'QA12 QA14 MG45 MG46 QA13 CR69', 'partial', 'build', 'Postgres-only today; doc 17 S15 proposes MySQL first. Pooling exists.'),
  c('CON9', 'CON', 'SOAP web services', 'QA23 MG44', 'gap', 'build', 'Parity [6]. Second-largest Q&A theme by count; brownfield hospitals still run SOAP.'),
  c('CON10', 'CON', 'Queues and streaming: Kafka, RabbitMQ/AMQP, JMS, SQS, Pub/Sub', 'MG29 MG31 MG43 OB90 QA80 WP83 OS125', 'gap', 'build', 'Doc 14 said partner; demand says ship Kafka and AMQP connectors (thin clients, not a broker).'),
  c('CON11', 'CON', 'Cloud storage and identity: S3, Azure Blob, IAM roles', 'MG30 OB100 OS48', 'gap', 'build', 'S3 as a file scheme (CON6) covers most of it.'),
  c('CON12', 'CON', 'DICOM: modern stack, worklist, query/retrieve, routing by AE, TLS', 'MG26 MG27 OB87 OB88 QA78 OS93 OS94 CR30 WP100', 'partial', 'build', 'C-STORE on dcmjs-dimse works; MWL, Q/R and TLS open.'),
  c('CON13', 'CON', 'Email: OAuth for Microsoft 365/Google, SMTP modernisation', 'MG42 OB99 QA81 WP81', 'partial', 'build', 'Basic-auth SMTP/IMAP is being retired by Microsoft; OAuth is required to keep working.'),
  c('CON14', 'CON', 'Polling: poll now, cron windows, pre-poll scripts, run-once', 'MG5 MG6 MG35 QA82', 'partial', 'build', ''),
  c('CON15', 'CON', 'TCP sender failover and multiple endpoints', 'MG37 WP76', 'gap', 'consider', ''),
  c('CON16', 'CON', 'Reaching endpoints behind NAT: SSH tunnels, edge agents', 'OB92 WP77 OS75 OS76', 'gap', 'consider', ''),
  c('CON17', 'CON', 'IHE (PIX/PDQ/XDS/XCA/XCPD), TEFCA and Direct messaging', 'WP80 OS118 OS119 WP82', 'gap', 'partner', 'Gold-tier paid in Mirth. Plugin candidates once PL1 exists.'),
  c('CON18', 'CON', 'Connectors hang and cannot be stopped', 'MG47 OB116', 'partial', 'build', 'Halt cancels scripts and sends; add a test per connector.'),
  c('CON19', 'CON', 'PDFs and documents: generate them, extract data from them, OCR', 'WP47 OB86', 'gap', 'consider', 'Parity [7] Document Writer covers generation; extraction/OCR is a library choice.'),
  c('CON20', 'CON', 'Integration network coverage beyond EHRs', 'CR89', 'n/a', 'context', 'Redox-specific.'),

  // Routing
  c('RT1', 'RT', 'Duplicate message detection (MSH-10) and result floods', 'MG52 QA47 OS101', 'gap', 'build', 'Per-channel dedupe window on a key, built on Collections.'),
  c('RT2', 'RT', 'Ordering with parallelism: FIFO, per-patient ordering, threads per channel', 'QA46 CR88 MG48 OB109', 'partial', 'build', 'B3/N7.'),
  c('RT3', 'RT', 'Channel-to-channel calls, provenance and responses', 'QA10 MG50 OB113 OB111', 'have', 'have', 'routeMessage reports outcome (D-231); correlationId.'),
  c('RT4', 'RT', 'Routing control: fan-out by type, DestinationSet, set destination status', 'QA84 OB112 MG49', 'have', 'have', 'destinationSet by name or id (D-238).'),
  c('RT5', 'RT', 'Hold and release, delayed delivery, throttling and rate limits', 'QA103 OS74 OB110 OS17', 'gap', 'consider', 'Pause exists per channel; per-destination throttle is the common ask.'),
  c('RT6', 'RT', 'Multiple source connectors per channel', 'QA83', 'gap', 'consider', 'Channel Writer covers it today.'),
  c('RT7', 'RT', 'Business rules separate from code; chaining steps without glue', 'CR94 OS16', 'gap', 'consider', ''),

  // Message storage
  c('MSG1', 'MSG', 'Message search: slow, no saved filters, bulk IDs, regex, cancel', 'MG55 OB117 OB120 QA42 CR20 OS83', 'partial', 'build', 'N4.'),
  c('MSG2', 'MSG', 'Custom metadata and business-key search (MRN, facility)', 'MG54 OB118 OB119 CR82 WP92 OS104', 'partial', 'build', 'Engine fills columns and API filters on them; UI open (N5).'),
  c('MSG3', 'MSG', 'Search and export across channels', 'WP91 QA11', 'have', 'have', 'Cross-channel search service exists (paid in Mirth Enterprise).'),
  c('MSG4', 'MSG', 'Storage growth, pruning, retention by status, archiving', 'MG57 QA44 OB123 CR24 OS18 CR23 MG58', 'partial', 'build', 'Pruner and partitions exist; archiver (N8) and keep-errored retention open.'),
  c('MSG5', 'MSG', 'Backend database pain (Derby default, deadlocks, multi-DB quirks)', 'MG59 OB105 QA100 OB107 OB108 OB106', 'have', 'have', 'PostgreSQL only, partitioned. Multi-database backend is a non-goal.'),
  c('MSG6', 'MSG', 'Query the message store with SQL; traffic analytics', 'QA43 CR39 OB18', 'partial', 'consider', 'Documented read-only views over the message tables.'),
  c('MSG7', 'MSG', 'Attachments: export, reattach, object storage', 'MG56', 'partial', 'build', 'Attachment extraction has no channel setting yet (ROADMAP).'),

  // Recovery
  c('REC1', 'REC', 'Reprocess/resend: one destination, bulk, date range, order, lineage', 'QA45 CR22 OS3 OS4 OS102 MG62 OB126 OB127', 'partial', 'build', 'Reprocess service exists; bulk by filter and destination targeting are the ask.'),
  c('REC2', 'REC', 'Queue visibility and control', 'MG61 CR36', 'partial', 'build', 'Failure reason stored (D-248); per-destination queue view open.'),
  c('REC3', 'REC', 'No message loss: ACK after durable store, safe shutdown, DB outage recovery', 'OS71 OB115 MG60', 'partial', 'build', 'Soak test lost 0 of 1.08M; add a DB-outage chaos test.'),
  c('REC4', 'REC', 'Runaway retries that cannot be stopped', 'OS2', 'partial', 'build', ''),

  // Monitoring
  c('MON1', 'MON', 'Channel health, not server up: silent interfaces, queue depth, error rate, schedule-aware', 'MG63 QA48 WP11 CR32 OS106 CR34 OB131', 'partial', 'build', 'NO_MESSAGES exists; add queue depth, error rate and business-hours windows (B1).'),
  c('MON2', 'MON', 'Alert delivery and escalation: webhook, Slack, PagerDuty, throttling, templates', 'MG64 CR33 WP12 WP13 OS14', 'partial', 'build', 'Email works; add webhook (covers Slack/Teams/PagerDuty) and escalation.'),
  c('MON3', 'MON', 'One dashboard across many engine instances', 'WP14 CR37 OB19', 'gap', 'consider', 'Paid in Mirth (Command Center) and BridgeLink (Fleet). A thin read-only aggregator over the API.'),
  c('MON4', 'MON', 'Dashboard accuracy and visibility: errors stand out, stats, time series', 'OB34 MG65 OB114 OB133', 'partial', 'build', ''),
  c('MON5', 'MON', 'External monitoring: Prometheus, health checks, NMS, OpenTelemetry hooks', 'WP9 OB129 QA49 WP10 MG68 OS47 MG66 OB130 WP20', 'partial', 'build', '/metrics and health endpoints exist; per-channel labels (N10) and OTel (B4) open.'),
  c('MON6', 'MON', 'Per-channel logs, channel name on every line, logs in the UI, SIEM forwarding', 'MG67 OB128 QA40 WP16 WP17 CR38 OB102', 'partial', 'build', 'Log viewer exists; filter by channel.'),
  c('MON7', 'MON', 'Finding where and why a message errored', 'QA41 OB103 OB95 OS77 OS12 OB76 OS88', 'partial', 'build', 'Failure reason kept (D-248); show stage, error and content side by side.'),
  c('MON8', 'MON', 'End-to-end visual trace of a message across channels', 'CR40 WP35 OS63 OS13', 'partial', 'build', 'InterSystems Visual Trace is the most-praised competitor feature. correlationId exists; B4.'),
  c('MON9', 'MON', 'JVM thread viewer and deadlock detection', 'OB132 WP19', 'n/a', 'wont', 'JVM-specific. Event-loop lag metric is the Node equivalent.'),

  // Performance
  c('PERF1', 'PERF', 'Throughput and memory: large messages, OOM, benchmarks', 'MG69 QA66 QA67 CR25 CR96 OS22 OS64 WP89 CR27 MG70 OB77 CR92', 'partial', 'build', 'Published soak baseline; worker threads and streaming large payloads open.'),
  c('PERF2', 'PERF', 'Choose speed vs audit trail per channel', 'CR26', 'have', 'have', 'Per-channel storage policy.'),

  // HA / deploy
  c('HA1', 'HA', 'Free high availability: active-active, takeover, shared database', 'MG71 OB148 QA68 CR28 WP73 WP74 OS46 CR29 CR95', 'gap', 'build', 'B2. Paid Platinum in Mirth and reported buggy.'),
  c('HA2', 'HA', 'Kubernetes, Helm, cloud reference deployments; on-prem or cloud', 'OB147 WP75 WP68 OS50 CR66 CR59 CR65 CR64 CR58', 'partial', 'build', 'Compose and images exist; Helm chart and reference HA deploy open.'),
  c('HA3', 'HA', 'Official, maintained container images; start with channels preloaded', 'OB137 QA61 WP64 WP66 WP42', 'partial', 'build', 'Images build to ghcr; add declarative channel import at start.'),
  c('HA4', 'HA', 'Installers and packages: non-root, silent, signed, Linux packages', 'MG81 OB57 OB61 OB140 OB144 CR63 OS62 WP98', 'partial', 'consider', 'Containers first; native packages only on demand.'),
  c('HA5', 'HA', 'Run behind reverse proxies and path prefixes', 'MG80 OB146', 'have', 'have', 'nginx in the production stack.'),
  c('HA6', 'HA', 'Multi-tenancy: one instance for many facilities', 'CR31 OS38', 'gap', 'consider', 'Rhapsody lockers are praised. Open decision in doc 14.'),

  // Ops / versioning
  c('OPS1', 'OPS', 'Git and CI/CD for channels with deterministic, diffable exports', 'MG73 MG74 QA56 CR11 WP1 WP4 WP5 WP6 OB136 CR12', 'partial', 'build', 'Most-built workaround (mirthSync and 7 others). File-per-component export + CLI sync (B6).'),
  c('OPS2', 'OPS', 'Version history, diff and rollback', 'OB135 WP2 OS79', 'partial', 'build', 'Revisions stored; diff viewer and restore UI open (v1.1). Paid in Mirth.'),
  c('OPS3', 'OPS', 'Promote between environments with dependencies and environment settings', 'MG75 QA57 CR13 CR15 WP3 OS127 MG82 OB71 OB125', 'partial', 'build', 'B6. Export completeness (N14) is a prerequisite.'),
  c('OPS4', 'OPS', 'Environment variables and layered config for containers', 'MG77 MG78 MG79 QA58 OB138 WP65 OS19', 'partial', 'build', 'Config map `${}` (D-246); env-var sourcing for config map values.'),
  c('OPS5', 'OPS', 'Scheduled, complete backup and restore', 'MG76 QA62 WP72 OB155', 'partial', 'build', 'Backup/restore exists; schedule it.'),
  c('OPS6', 'OPS', 'Deploy without downtime', 'CR14', 'partial', 'consider', 'Per-channel redeploy; zero-drop handover for listeners is the gap.'),

  // API / CLI
  c('API1', 'API', 'Complete, documented REST API, OpenAPI and client SDKs', 'MG83 QA60 OB151 OB152 WP93 WP95 CR83 CR84 OB153', 'partial', 'build', 'OpenAPI at /api-docs; generate a TS/Python client from it.'),
  c('API2', 'API', 'Supported CLI covering everything', 'MG84 OB154 WP94', 'partial', 'build', 'CLI exists; coverage and session refresh (L25) open.'),
  c('API3', 'API', 'Scripts that control channels and read server info', 'MG53 QA98', 'gap', 'consider', 'Needs a permission model before scripts can stop channels.'),

  // Security
  c('SEC1', 'SEC', 'Unpatched dependencies and CVEs; slow security fixes; disclosure process', 'MG85 MG86 MG88 OB52 OB53 OB54 OB55 OB59 QA76 CR9 WP70 OS43 OB7', 'partial', 'build', 'Dependency audit in CI, SECURITY.md, CVE list in release notes.'),
  c('SEC2', 'SEC', 'Role-based access: custom roles, channel and message-body visibility', 'MG92 OB44 WP27 OS7 OS5', 'partial', 'build', 'Four roles + channel scope exist; custom roles (N13).'),
  c('SEC3', 'SEC', 'SSO, directory login and MFA: LDAP/AD, OIDC, SAML, TOTP', 'MG91 OB45 QA74 WP24 WP26 OS6 WP25', 'gap', 'build', 'All paid Gold in Mirth. None exist here yet, though the ROADMAP "Competitive Position" table said MFA ships free.'),
  c('SEC5', 'SEC', 'Password policy, default credentials, lockout, auto-logoff', 'MG89 OB46 OB47 OB48 OB49 OB56 OS86 WP71 OS10', 'partial', 'build', 'Server-side policy and forced first-login change; HIPAA auto-logoff.'),
  c('SEC6', 'SEC', 'Encrypt secrets and data at rest; vault integration', 'MG90 QA59 CR80 OS52', 'partial', 'build', 'Content encryption exists; encrypt connector credentials; env/vault references.'),
  c('SEC7', 'SEC', 'Audit trail: who changed what, PHI access, SIEM forwarding, tamper-resistance', 'MG93 QA75 OB134 WP18 CR79 OS45', 'partial', 'build', 'Audit events exist; add syslog/webhook forwarding and message-view events.'),
  c('SEC8', 'SEC', 'Certificate management: mTLS, CRL/OCSP, reload without restart', 'WP22 OS8 OS9 WP23', 'partial', 'build', 'Certificates page exists.'),
  c('SEC9', 'SEC', 'Secure defaults: no exposed docs/dirs, safe file permissions, FIPS', 'MG94 OB51 OB50', 'partial', 'build', 'HIPAA checklist lists the open items.'),
  c('SEC10', 'SEC', 'De-identification and PHI-safe test data', 'CR77 OS108', 'gap', 'build', 'Pairs with TEST3: anonymise a production message into a test fixture.'),
  c('SEC11', 'SEC', 'ONC Cures certification support', 'WP97', 'gap', 'consider', 'Paid add-on in Mirth.'),

  // Testing
  c('TEST1', 'TEST', 'Step-through debugger for channel scripts', 'MG7 QA38 WP38', 'gap', 'build', 'v1.1. Node inspector makes this feasible where Rhino could not.'),
  c('TEST2', 'TEST', 'Automated channel tests in CI: unit, golden files, replay-and-diff regression', 'QA39 OB149 OS80 WP39 WP40 OS109 CR49 OB143 QA65', 'gap', 'build', 'B5. Nobody does this well; strongest DevEx differentiator.'),
  c('TEST3', 'TEST', 'Test message generator and simulators', 'QA88 WP88 OS129', 'partial', 'build', 'Message generator service exists; add a listener/sender simulator.'),
  c('TEST4', 'TEST', 'Live, test-driven editing: run a sample message and see values inline', 'CR50 CR51 OB38', 'gap', 'build', 'Iguana Translator is the most-loved feature in its reviews.'),

  // Upgrades
  c('UPG1', 'UPG', 'Runtime version churn (Java 8/11/17/21) breaks installs', 'MG122 OB60 QA64 OS42', 'partial', 'build', 'Node LTS only; publish a runtime support policy and ship in containers.'),
  c('UPG2', 'UPG', 'Upgrades break channels, plugins and settings; no rollback', 'MG123 OB141 QA63 OB73 WP55 OS87 OS124 CR60 CR62 OB142', 'partial', 'build', 'Migration tests per release, deprecation notes, pre-upgrade backup.'),
  c('UPG3', 'UPG', 'Move from another engine without rebuilding; prove behaviour is the same', 'CR61 WP99', 'partial', 'build', 'Mirth importer + scenario suite (55/60). Cross-compatible, not backward-compatible (D-244).'),

  // Docs / community / ecosystem
  c('DOC1', 'DOC', 'Accurate public documentation: user guide, API, upgrade notes', 'MG102 OB16 QA71 CR52', 'partial', 'build', 'The Mirth wiki disappeared; docs are a reason people pick an engine.'),
  c('DOC2', 'DOC', 'HL7 semantics help: which message, segment, field', 'QA87', 'gap', 'consider', 'Field descriptions on hover in the viewer and editor (UI11).'),
  c('DOC3', 'DOC', 'Library of example channels and recipes', 'WP51', 'partial', 'build', '10 seeded examples; grow into a recipe gallery. Most-starred community repos.'),
  c('DOC4', 'DOC', 'Community chat, roadmap visibility, suggestion box', 'OB159', 'gap', 'build', 'GitHub Discussions + public ROADMAP.'),
  c('DOC5', 'DOC', 'Plugin SDK, stable plugin API and a marketplace', 'MG124 OB145 OB14 QA73 WP50 WP54 OS90', 'gap', 'build', 'ROADMAP [DECIDE] item. A stable API must exist before any marketplace.'),

  // AI
  c('AI1', 'AI', 'AI-assisted mapping, channel generation and error explanation', 'CR42 CR41 MG125 QA101', 'gap', 'build', 'B8. Rhapsody already markets AI mapping.'),
  c('AI2', 'AI', 'Expose the engine to AI agents (MCP)', 'CR43 WP96', 'gap', 'build', 'Cheap given the OpenAPI spec; respect RBAC and PHI rules.'),
  c('AI3', 'AI', 'Use the engine as an AI pipeline hub (LLM step)', 'OB158 CR44', 'gap', 'consider', 'Runtime LLM calls on PHI need governance first.'),

  // Other
  c('OTH1', 'OTH', 'Partner onboarding is slow, manual and ticket-driven', 'OS100 CR90 CR99', 'gap', 'consider', 'Per-partner profiles + self-service validation (DT3) address part of it.'),
  c('OTH2', 'OTH', 'Opt-in anonymous usage statistics', 'OB21 OS131', 'gap', 'consider', 'Only ever opt-in (LIC5).'),
  c('OTH3', 'OTH', 'Clinical safety process for releases', 'OB15', 'gap', 'consider', ''),
  c('OTH4', 'OTH', 'Context: engines become app platforms; multiple engines per site; rewrites as alternatives', 'OS128 CR91 OB9 WP59 QA91 CR97 CR98', 'n/a', 'context', 'Not features. WP59/OB9 show others are also rewriting Mirth from scratch.'),

  // Added with the social/blog stream
  c('LIC8', 'LIC', 'The engine must outlive its vendor: open code, no license-key kill switch, no acquisition risk', '', 'have', 'have', 'Reported Iguana vendor collapse (2026) and Mirth 4.6 both cited. Open source with no license keys answers it.'),
  c('LIC9', 'LIC', 'EHR vendors charge per interface and gate FHIR; sites buy an engine to escape', '', 'n/a', 'context', 'Why sites need an engine at all; not a feature.'),
  c('SEC12', 'SEC', 'Trust signals for a new open engine: outside pen test, independent security review', '', 'gap', 'build', 'Pen test is still open on ROADMAP. Needed before hospitals put it on the critical path.'),
  c('CON21', 'CON', 'Secure transport instead of per-partner VPNs and plain-text MLLP', '', 'partial', 'build', 'MLLP over TLS with mTLS and HTTPS ingestion exist in part; document a VPN-free partner setup.'),
  c('CON22', 'CON', 'Lightweight embeddable MLLP/HTTPS receiver for app vendors', '', 'gap', 'consider', 'Could ship as an npm package from the connectors code.'),
  c('RT8', 'RT', 'Patient matching (EMPI) inside the engine', '', 'gap', 'partner', 'Doc 14: integrate an EMPI, do not build one. Collections cover simple MRN cross-reference.'),
  c('REC5', 'REC', 'Dead-letter / holding queue to correct, re-route or reject by hand', '', 'gap', 'build', 'B9.'),
  c('MSG8', 'MSG', 'Keep the raw inbound message byte-for-byte for replay', '', 'have', 'have', 'Raw content is stored per message.'),
  c('HA7', 'HA', 'Hosted / SaaS engine for small organisations', '', 'gap', 'consider', 'Not the project itself; a third party could host it (LIC7).'),
  c('MON10', 'MON', 'Data-quality metrics and anomaly detection on the live stream', '', 'gap', 'consider', 'Null/unmapped-field rates per channel would catch partner drift.'),
  c('DOC6', 'DOC', 'Free edition to learn on; commercial engines need an employer license', '', 'have', 'have', 'Free download, no license, Docker one-liner.'),
  c('AI4', 'AI', 'AI skepticism: precision over speed; hallucinated mappings are unacceptable', '', 'n/a', 'context', 'Constraint on AI1: suggestions must be reviewable and tested, never applied silently.'),
  c('OTH5', 'OTH', 'Context: interface work is people and process (Epic change control, analyst skills, chasing specs)', '', 'n/a', 'context', 'Tools help at the edges (docs generation, test kits); not engine features.'),
];

// Social/blog stream (SB) assignments, kept separate so the cluster lines above stay readable.
const SB = {
  LIC1: 'SB1 SB4', LIC2: 'SB2 SB11 SB12 SB18 SB134', LIC7: 'SB16 SB129 SB130', LIC8: 'SB3 SB7 SB13 SB14 SB15',
  LIC9: 'SB19 SB20 SB21 SB114', SEC1: 'SB8 SB9', SEC12: 'SB17', CON2: 'SB5', HA1: 'SB6', HA3: 'SB10',
  UI1: 'SB22 SB23', UI2: 'SB24 SB25', MON8: 'SB26', UI11: 'SB27 SB48', UI17: 'SB28 SB29', UI9: 'SB30',
  SCR1: 'SB31 SB32 SB33 SB34 SB132', UI8: 'SB35', SCR3: 'SB36', OTH4: 'SB37 SB90 SB139 SB140', SCR6: 'SB38',
  DT10: 'SB39 SB105', TEST4: 'SB40', TEST1: 'SB41 SB42', TEST2: 'SB43 SB44 SB50 SB51', DT3: 'SB45 SB103',
  TEST3: 'SB46 SB49', SEC10: 'SB47', OPS1: 'SB52 SB53 SB54 SB55', HA2: 'SB56 SB59', SCR9: 'SB57', HA7: 'SB58',
  PERF1: 'SB60 SB62 SB63 SB64 SB65 SB67', HA6: 'SB61', MSG6: 'SB66 SB70 SB72', MSG4: 'SB68', MSG5: 'SB69',
  MSG8: 'SB71', MSG1: 'SB73 SB74', REC1: 'SB75 SB79', CON6: 'SB76 SB96', REC2: 'SB77', REC5: 'SB78',
  MON1: 'SB80 SB82 SB84', MON7: 'SB81', MON3: 'SB83', CON8: 'SB85', MON6: 'SB86', MON5: 'SB87', MON10: 'SB88 SB89',
  CON21: 'SB91 SB92 SB93', CON4: 'SB94 SB97', CON1: 'SB95', CON22: 'SB98', DT11: 'SB99 SB100 SB101',
  CON19: 'SB102 SB109 SB110', DT1: 'SB104 SB111 SB112', DT2: 'SB106', SCR4: 'SB107', DT8: 'SB108', DT5: 'SB113',
  FHIR2: 'SB115', RT8: 'SB116', RT3: 'SB117', API1: 'SB118', UPG3: 'SB119 SB120', UPG2: 'SB121', DOC4: 'SB122',
  DOC1: 'SB123 SB126', DOC6: 'SB124 SB125', UI13: 'SB127 SB128', UI3: 'SB131', UI7: 'SB133',
  OTH5: 'SB135 SB136 SB137 SB138 SB141', AI1: 'SB142 SB144', AI4: 'SB143', SEC6: 'SB145', SEC8: 'SB146', OPS2: 'SB147',
};
for (const [id, keys] of Object.entries(SB)) {
  const cl = CLUSTERS.find((x) => x.id === id);
  if (!cl) throw new Error(`unknown cluster ${id}`);
  cl.entries.push(...k(keys));
}
