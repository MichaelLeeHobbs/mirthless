# GalvaniGraph Software Requirements Specification

## Purpose

GalvaniGraph is a free, open-source healthcare integration engine. It receives messages from clinical and business systems, filters and transforms them, and delivers them to other systems, for hospitals, labs, imaging groups and vendors who build and run their own interfaces. A message it accepts may be a lab result, a medication order or an emergency alert, so it must never be lost, duplicated or corrupted without someone being told. It is the successor to Mirth Connect for the teams who move off it: a Mirth channel imports, and its scripts need edits but never a rewrite of the channel. This SRS is the contract agents and people build toward: a requirement here is the definition of done for the work that meets it. It is allowed to change, and the product's developer, Michael Hobbs, decides what gets in.

The product was named Mirthless and then GalvaniFlow before GalvaniGraph (D-309). Older sources use those names for the same product.

## Scope

- Receive and send messages over healthcare and general protocols: HL7 v2 over TCP/MLLP, HTTP, files and SFTP, databases, DICOM, FHIR, email, Kafka, AMQP, other channels and scripts.
- Parse, filter, transform, route and acknowledge messages in HL7 v2, XML, JSON, delimited, X12, FHIR and raw formats.
- Store every message with its content and status, let people search, resend, export and prune it, and recover it after a crash.
- Build, test, deploy, version and move channels from a browser and over an API.
- Import Mirth Connect channels and server backups and say what must change.
- Control who can do what, to which channels, and keep a record of it that the product's own users cannot change.
- Watch channels, alert people when something is wrong, and expose health and metrics to other tools.
- Run on one server with one PostgreSQL database, and later on more than one, with documented backup, upgrade and recovery.

Systems it talks to: its PostgreSQL database; the partner systems behind each connector (electronic health records, lab and radiology systems, archives, brokers, databases, file and mail servers); an identity provider (planned); metrics and log collectors; browsers and API clients.

## Out of scope

Things a reader might expect this product to do that it will not. Each line is a decision, not a gap. A requirement that falls under one of these lines is scope creep and gets rejected or the line changes first. The lines that cite only doc 14 come from its non-goals and have no decision record yet (D-260 calls patient matching, a FHIR server and a marketplace "integrations or later calls"): they hold until the developer confirms or strikes them at the first review.

- E4X, Mirth's XML message model, or any layer that runs Mirth scripts unchanged: GalvaniGraph is Mirth-like, not script-compatible (D-244, D-260).
- Mirth's script APIs, such as `ResponseFactory`, `DateUtil` and `channelMap.put`: scripts are rewritten in GalvaniGraph's own API (D-244).
- Java classes, JAR loading or a Python runtime in scripts: scripts are JavaScript or TypeScript in one sandbox (D-260).
- Mirth's `<results>` XML for database rows: rows arrive as JSON (D-182).
- Exactly-once delivery across Kafka, AMQP or any other partner system: delivery is at least once (D-261).
- A message broker of its own, or its own consumer-group, partition or schema-registry management: that is the broker's job (D-261, doc 14).
- Any backend database other than PostgreSQL: connectors may reach other databases, the product stores its own data only in PostgreSQL (D-260).
- Paid editions, license keys, paid add-ons or phone-home: everything is free (D-260).
- A command-line client: scripts call the REST API (D-280).
- A FHIR server or clinical data repository, CDS Hooks, analytics views or clinical NLP: the product moves FHIR data, it is not the system of record (doc 14).
- Patient matching (EMPI), hosted terminology services, or membership in a national exchange network: integrate with one (doc 14).
- An API gateway, a developer portal for API consumers, or spec-based API mocking: put a real one in front (doc 14).
- A marketplace of SaaS application connectors (doc 14).
- Stateful stream processing, log compaction, tiered storage or geo-replication (doc 14).
- Long-running workflow orchestration, sagas or human task steps (doc 14).
- Blue-green or canary traffic shifting between channel versions: solve it in the layer that runs the servers (doc 14).
- Deny rules, per-user permission grants, or a library scope picker on roles: assignments are a union of roles, and a library's scope follows the channels chosen for it (doc 20).
- Separate engine processes per department for isolation: run separate engines (doc 20).
- A desktop administrator application: the admin console is a web application (doc 09).
- A Java Virtual Machine thread viewer or other Java operations tooling (D-260, doc 18).

## User classes

| Class | Who they are | What they need most |
|---|---|---|
| Interface developer | Builds and changes channels, scripts and code templates; often one of two or three people who own hundreds of interfaces | Build and test a channel quickly, and know it will do in production what it did in test |
| Interface operator | Deploys, starts and stops channels and answers the 2 a.m. page when a feed stops | See at once which interface is broken and why, and resend without making it worse |
| Support analyst | Reads messages to answer "did the result arrive?", in one department or all of them | Find one message among millions, without being able to change anything |
| Administrator | Runs the server, creates accounts and roles, sets policy, backs up and upgrades | Safe defaults, clear failure, and an upgrade that does not lose data |
| Privacy or security officer | Answers for PHI access, audits and incidents; may not be technical | A record of who saw and changed what that nobody can edit, and proof that cut-off means cut off |
| Migration engineer | Moves a site from Mirth Connect channel by channel | Know before cutover what will not work, with nothing silently changed |
| Connector or automation author | Writes a connector, or scripts the API from CI and other systems | A stable, documented contract with named errors |
| Partner system | The machine on the other end: an EHR, analyzer, archive, broker or web service | A correct acknowledgement that means the message is safe, and no surprise duplicates |

## Conventions

These rules govern every file in this folder. Skills and agents that read or write the SRS follow them.

**Files.** `README.md` (this file), one `<area>.md` per area with nested headings for sub-areas, `interfaces/<name>.md` for contracts other code builds against (each with its own semver in its header), and `trace.md`, which only the verifier writes.

**Requirement rows.** Every requirement is one row of a table with exactly these columns:

| ID | Requirement | Pri | Verify | Status |
|---|---|---|---|---|

- **ID** `AREA-SUB-NN`: capitals, then a sub-area, then two or more digits. Never reused. A changed requirement gets a new ID; the old row's Status becomes `Superseded by <new ID>`.
- **Pri** `P1` required for the end state, `P2` expected, `P3` nice to have.
- **Verify** how proof is obtained (ISO/IEC/IEEE 29148): `Test` (an automated test asserts it), `Demonstration` (steps run and observed), `Inspection` (a file and line show it), `Analysis` (reasoning written out).
- **Status** `Proposed`, `Accepted`, `Deferred`, `Rejected`, or `Superseded by <ID>`. Anyone may add a Proposed row. Only the developer moves a row to Accepted, Deferred or Rejected, in their own words, and each such decision gets a dated line in the change log naming every ID it moved, with the word Accepted before the IDs it accepts.

**Wording.** `shall` is mandatory, `should` is expected, `may` is permitted. Each requirement is necessary, singular (one behaviour per row), unambiguous, verifiable, and says what the product does, not how it is built. Interface specs are the exception: there the exact shape is the requirement.

**Source notes.** A Proposed row discovered during a build or drafted from existing material carries its source in a note under the table: `AUTH-USR-07: source: discovered while building the login screen, PR 214`.

**Tests.** A test that proves a requirement carries its ID in its name, for example `AUTH-USR-03: locks the account after 5 failed logins`. Where a language forbids hyphens in names, use underscores (`test_auth_usr_03_locks_account`).

**Verdicts.** (Until the first rows are accepted, `trace.md` holds only a section of provisional verdicts, marked as such.) `trace.md` records, per Accepted requirement, one of `Met`, `Partial`, `Not met`, `Regressed`, or `Cannot verify` (with the reason), and the evidence. Whoever built the work never marks it Met.

**Beside this folder.** [capabilities.md](../user/capabilities.md) stays the page that tells users what works today; this folder says what must be true at the end. [DECISIONS.md](../progress/DECISIONS.md) stays the record of why. A `D-NNN` here is a decision there, and `doc NN` is a file in [docs/design](../design/).

**Domain guardian.** When this SRS is debated, the domain seat guards HIPAA, message data integrity (never lost, duplicated or corrupted without someone being told) and Mirth Connect migration parity.

**Security defects.** This repository is public. A row states the required behaviour and never describes how a present defect could be used. A defect an outsider or a lower role can use goes to a private advisory as [SECURITY.md](../../SECURITY.md) says, not into a row, a source note or `trace.md`.

## Areas

| Area | File | What it covers |
|---|---|---|
| Authentication (`AUTH`) | [auth.md](auth.md) | Accounts, passwords, sign-in, lockout, sessions, second factors, single sign-on, API keys, cutting someone off |
| Access control (`ACC`) | [access.md](access.md) | Permissions, roles, assignments, channel-group scope, enforcement, who could reach a channel |
| Audit (`AUD`) | [audit.md](audit.md) | What is recorded, protection and retention of the record, reading it, export reasons |
| Security (`SEC`) | [security.md](security.md) | Secrets, certificates, TLS, network exposure, privileges, supply chain |
| Connectors (`CONN`) | [connectors.md](connectors.md) | What every connector guarantees, and each protocol |
| Data types (`DATA`) | [data-types.md](data-types.md) | Parsing, editing, writing, splitting, validating and acknowledging each format |
| Pipeline (`PIPE`) | [pipeline.md](pipeline.md) | Message flow, statuses, queues, retries, order, responses, crash recovery |
| Scripting (`SCR`) | [scripting.md](scripting.md) | Languages, script API, sandbox limits, code templates, the script editor's checks |
| Messages (`MSG`) | [messages.md](messages.md) | Storage, encryption, browsing, search, reprocess, export, attachments, pruning |
| Channels (`CHAN`) | [channels.md](channels.md) | Editing, deploying, dependencies, revisions, import and export, groups, testing |
| Mirth migration (`MIG`) | [mirth-migration.md](mirth-migration.md) | What a Mirth export becomes, and what the preview must say |
| Shared data (`SHR`) | [shared-data.md](shared-data.md) | Global and configuration maps, collections, data sources, resources |
| Monitoring and alerts (`MON`) | [monitoring.md](monitoring.md) | Dashboard, alerts, health, metrics, events, logs, tracing |
| Operations (`OPS`) | [operations.md](operations.md) | Install, configuration, backup, upgrade, shutdown, availability, performance |
| REST API and live updates (`API`) | [api.md](api.md) | API format, description, limits, concurrency, live feeds |
| Admin console (`UI`) | [admin-console.md](admin-console.md) | What every screen must do: access, errors, accessibility, phones, notices |

Interfaces:

| Interface | File | Version |
|---|---|---|
| Connector plugin contract (`CPI`) | [interfaces/connector.md](interfaces/connector.md) | 0.1.0 |

Review packet: `REVIEW.md` holds the recommendations and open decisions for the first review. It is deleted, with this line, once those decisions are applied.

## Completeness summary

Written by the coverage script. Do not edit between the markers.

<!-- srs-summary:start -->
Generated by srs-coverage on 2026-11-25. Do not edit by hand.

| Area | Accepted | Met | Partial | Not met or regressed | Cannot verify | Not yet verified | Test-verified with a test | Proposed |
|---|---|---|---|---|---|---|---|---|
| access.md | 0 | 0 | 0 | 0 | 0 | 0 | 0/0 | 37 |
| admin-console.md | 0 | 0 | 0 | 0 | 0 | 0 | 0/0 | 27 |
| api.md | 0 | 0 | 0 | 0 | 0 | 0 | 0/0 | 23 |
| audit.md | 0 | 0 | 0 | 0 | 0 | 0 | 0/0 | 37 |
| auth.md | 0 | 0 | 0 | 0 | 0 | 0 | 0/0 | 90 |
| channels.md | 0 | 0 | 0 | 0 | 0 | 0 | 0/0 | 41 |
| connectors.md | 0 | 0 | 0 | 0 | 0 | 0 | 0/0 | 121 |
| data-types.md | 6 | 0 | 0 | 0 | 0 | 6 | 0/6 | 33 |
| interfaces/connector.md | 0 | 0 | 0 | 0 | 0 | 0 | 0/0 | 82 |
| messages.md | 0 | 0 | 0 | 0 | 0 | 0 | 0/0 | 36 |
| mirth-migration.md | 0 | 0 | 0 | 0 | 0 | 0 | 0/0 | 39 |
| monitoring.md | 0 | 0 | 0 | 0 | 0 | 0 | 0/0 | 39 |
| operations.md | 0 | 0 | 0 | 0 | 0 | 0 | 0/0 | 39 |
| pipeline.md | 0 | 0 | 0 | 0 | 0 | 0 | 0/0 | 45 |
| scripting.md | 0 | 0 | 0 | 0 | 0 | 0 | 0/0 | 43 |
| security.md | 0 | 0 | 0 | 0 | 0 | 0 | 0/0 | 32 |
| shared-data.md | 0 | 0 | 0 | 0 | 0 | 0 | 0/0 | 25 |
| **Total** | 6 | 0 | 0 | 0 | 0 | 6 | 0/6 | 789 |
<!-- srs-summary:end -->

## Change log

Newest first. One line per decision: the date, what moved, and the developer's words.

- 2026-11-25: CONN-SMTP-01 reworded in place, still Proposed (#414, D-398): the error says how many recipients were refused, and the stored response names them. Not a decision of the developer's: it applies the default of D-C2.
- 2026-11-25: CONN-TCP-03 reworded in place, still Proposed (#414, D-399): only a segment named MSA counts, MSA-1 is read as its first value in either case, and any MSA-2 is accepted when the message sent has no MSH-10. Not a decision of the developer's: the task asked to refuse only what cannot be an accept.
- 2026-11-25: CONN-CHN-01 reworded in place, still Proposed (#414, D-393): a Channel destination records an error that the target's response mode hides from its own sender. Not a decision of the developer's: it follows D-211 and D-231.
- 2026-11-25: Accepted DATA-HL7-05, DATA-HL7-09, DATA-HL7-10, DATA-HL7-11, DATA-HL7-12, DATA-HL7-13 (#194, D-392). Before acceptance, DATA-HL7-05 was narrowed in place to the rows it cites, DATA-HL7-09 was reworded in place (UTF-16 code units, the surrogate-pair rule, DATA-HL7-11's UTF-8), and DATA-HL7-11 to DATA-HL7-13 were added for the decision's defaults. The developer's words: "Mark them Accepted (I've decided)".
- 2026-11-25: DATA-HL7-05 reworded in place, DATA-HL7-09 and DATA-HL7-10 added, all still Proposed (#194): MSH-18 names the character set of hex escapes, and a channel setting says when the sender writes code points. The developer's words: "Build the switch (my pick)."
- 2026-11-25: AUTH-KEY-10 reworded in place, still Proposed (#419): the access must come back at least until the key's end, or the key is disabled. The developer's words: "Apply the picks".
- 2026-11-24: Created by an unattended pilot of the srs skills. Every row is Proposed; nothing has been decided.
