# 18. Voice of the user: complaints, requests and dreams across interface engines

Status: research, for ranking by Michael. Date: 2026-11-13.

Seven research agents collected 865 complaints, feature requests and wishes from users of Mirth Connect, Open Integration Engine (OIE), BridgeLink, Rhapsody, Cloverleaf, Corepoint, InterSystems, Iguana, Qvera, BizTalk, Redox, the cloud FHIR services and the open-source engines (OpenHIM, HAPI, Camel, NiFi, the v2-to-FHIR converters). `docs/research/voice-of-user/clusters.mjs` groups them into 160 themes, and every entry lands in exactly one theme. The full ranking with evidence links is [`docs/research/voice-of-user/ranking.md`](../research/voice-of-user/ranking.md). This document is the reading of it.

Docs 12 and 13 measured parity with Mirth, and doc 14 surveyed capabilities across the market. This one asks what users say hurts or what they want, whether or not any product has it.

## Sources

| Stream | Where | Entries |
|---|---|---|
| MG | `nextgenhealthcare/connect`: all 5,005 issues and 1,219 discussions | 125 |
| OB | OIE (253 issues, 16 discussions, roadmap, site), BridgeLink (125 issues, 36 discussions, release notes), other forks | 160 |
| QA | 1,479 Stack Overflow questions, ~2,840 archived Mirth forum threads, GitHub discussions | 103 |
| CR | KLAS, PeerSpot, G2 via AWS Marketplace, InterSystems Ideas, comparison posts. G2, Capterra and Gartner block fetching, so those rest on search snippets | 99 |
| SB | ~30k r/healthIT, r/HealthInformatics, r/HL7 and r/FHIR posts (783 kept), Hacker News, blogs, news on the 4.6 license change | 147 |
| WP | Community tools that patch gaps (mirthSync and others, by stars) and every paid NextGen and third-party add-on | 100 |
| OS | Issue trackers of OpenHIM, HAPI, FHIR-Converter, ReportStream and others; chat.fhir.org | 131 |

## What stands out

- The loudest Mirth complaint is the Java desktop Administrator and its launcher: it won't start, it freezes, and it breaks on new Java and on macOS (rank 1, 239 sources across all seven streams). Our web UI removes it. The second is the paywall and the 4.6 move to closed source (rank 3). Being free removes that too. Those two are why people would try us. Neither is a reason to stay.
- What would keep them is operational: channel-health alerting (8), Git and promotion workflows (12, 16), safe upgrades (7), reprocessing (19), HA (11). Every one of these is partial or missing here.
- The most-built workaround is Git sync for channels: eight community tools, 145 stars, plus a paid plugin. When users build the same tool eight times, it belongs in the product.
- What reviewers praise in competitors points to the same features: InterSystems Visual Trace (follow one message through every component), Iguana's editor that runs a sample message as you type, Corepoint's ease for analysts, Rhapsody and Cloverleaf's stability under load. Only stability is in our current plan.
- On-call pain is the top social theme: 2am pages, teams of two or three, and "it's always the interface", meaning the engine team must prove where a failure happened. Monitoring that shows the server is up but not whether channels are healthy is a complaint against six engines (CR32).
- Trust is the barrier for a new open engine. Hospitals ask who answers at 2am and whether anyone outside has tested security. The Mirth 4.6 change, and a reported 2026 collapse of Iguana's vendor (two r/healthIT threads, not independently verified), make "the engine outlives its vendor" a selling point we already have.
- No open-source engine handles X12 well (OS116), and every open v2-to-FHIR converter is criticised for skipped fields and output that fails validation (OS55, OS57). Both are openings to lead, not just to catch up.
- E4X does not appear as something people want. It is one of the most confusing parts of Mirth (QA1, 37 questions). Only three issues ask to keep it. Dropping it (D-244) is supported by the data.

## The filter

A request being popular does not make it ours. Each theme was judged against these rules, recorded as D-260:

- Free, all of it. No editions, no license keys, no paid add-ons, no phone-home.
- Cross-compatible with Mirth, not backward-compatible. A Mirth channel imports, and its scripts need edits, never a rewrite. No E4X, no Rhino or Java API emulation (D-244).
- PostgreSQL is the only backend database. Connectors may talk to any database.
- One sandboxed scripting language, JavaScript/TypeScript. No Java interop, no JAR loading, no Python runtime.
- Interface engine first (doc 14 option A). Platform features such as EMPI, a FHIR server or a marketplace are integrations or later decisions.

That filter rules out four themes: E4X (SCR2), Java interop and JAR loading (SCR3), Python scripts (SCR11) and a JVM thread viewer (MON9). The real need behind SCR3 is "let me use a library". Exposing vetted npm packages to the sandbox would answer it without Java and is listed under open decisions.

## Recommended build order

The ranking measures demand only. This order also weighs what is missing here, what blocks adoption, and what sets us apart. Demand rank is in brackets.

| # | Themes | Why now |
|---|---|---|
| 1 | MON1 channel-health alerts [8], MON2 alert delivery [65], MON7 error triage [57] | The on-call theme. Queue depth, error rate, schedule-aware silence and a webhook action cover most of it. Only NO_MESSAGES exists today. |
| 2 | OPS1 Git and CI/CD [12], OPS2 history and rollback [60], OPS3 promotion [16], OPS4 env config [36] | Most-built workaround. File-per-component export, a CLI sync command, a revision diff and restore. Doc 14 B6. |
| 3 | TEST2 channel tests in CI [18], TEST4 live sample-message editing [104], TEST1 debugger [72] | Nobody does tests well; Iguana's live editor is the most-loved feature in its reviews; Node's inspector makes a debugger possible. Doc 14 B5. |
| 4 | SEC3 SSO, LDAP and MFA [41], SEC2 custom roles [75], SEC5 password policy [73] | All paid Gold in Mirth, and none built here. The ROADMAP table claimed MFA was free; it is now corrected. |
| 5 | SEC1 dependency and CVE process [6], SEC12 outside pen test [158], LIC6 SBOM [96] | Trust for a new engine. Rank 158 understates SEC12: hospitals won't run an untested engine. |
| 6 | HA1 free active-active HA [11] | Paid Platinum in Mirth and reported buggy. Doc 14 B2. |
| 7 | UPG2 safe upgrades [7], UPG1 runtime policy [47] | Mirth upgrades break channels and Java churn breaks installs. Migration tests per release and a published Node LTS policy. |
| 8 | SCR4 standard library [4], SCR5 repeating segments [62], SCR8 maps and message model docs [58] | Rank 4 overall. Repeating-segment questions have 110k views, the most of any scripting theme on Stack Overflow. |
| 9 | REC1 bulk and targeted reprocess [19], REC5 dead-letter queue [147] | Resend by search, by destination, with guardrails. |
| 10 | DT1 HL7 round-trip fidelity [15], UI11 HL7 viewer with field names [20], DT3 conformance validation [40] | A byte-identical round-trip corpus test and a viewer that shows what PID-3.4 means. |
| 11 | CON4 HTTP flexibility [2], CON5 OAuth2 with token refresh [61] | Rank 2 overall. OAuth2 also unblocks FHIR and cloud targets (B10). |
| 12 | FHIR1 FHIR source, bundles, validation [10], FHIR2 v2-to-FHIR maps [69] | A strategic opening: maintained, overridable maps that produce valid resources (B7). |
| 13 | Migration blockers: CON8 database vendors [42], CON6 file schemes [33], DT5 X12 [27], CON9 SOAP [87] | Already ranked in docs 12, 13 and 17. X12 doubles as a differentiator. |
| 14 | MSG1 search [25], MSG2 metadata search [56], MSG4 retention and archive [24] | N4, N5, N8. |
| 15 | PERF1 throughput and memory [5] | Worker threads (D-212) and streaming large payloads. Keep publishing the soak baseline. |
| 16 | DOC1 docs [32], DOC3 recipes [121], UI13 generated channel docs [85], UI3 onboarding [34] | The Mirth wiki vanished. Example-channel repos (connect-examples, 114 stars) are among the most-starred community projects. |
| 17 | API1 generated client SDKs [14], AI2 MCP server [113], AI1 AI-assisted mapping [71] | Cheap given the OpenAPI spec. AI suggestions must be reviewable and tested (AI4). |
| 18 | CON10 Kafka and AMQP [38], CON12 DICOM worklist, Q/R and TLS [17] | Kafka and AMQP connectors decided in D-261. |
| 19 | DOC5 plugin SDK [35] | The ROADMAP [DECIDE] item. A stable API must come before a marketplace. |

## Already ours

These rank high and we already answer them. They are the pitch, so they need to stay solid and be visible on the project page:

- UI1 web admin, nothing to install [1]; UI2 light and dark themes [9]
- LIC1 and LIC2 free, no paywall, no license cost [3, 54]; LIC5 no phone-home [82]; LIC8 open code that outlives any vendor [105]; DOC6 free to learn on [126]
- SCR1 modern JavaScript and TypeScript instead of Rhino [13]
- CON1 MLLP robustness [29]; CON3 ACK and response control [59]
- MSG3 cross-channel search, paid Enterprise in Mirth [132]; MSG5 one well-tuned PostgreSQL backend [70]; MSG8 raw message kept for replay
- UI6 optimistic locking on concurrent edits; RT3 and RT4 channel-to-channel routing and destinationSet

## Open decisions

1. Kafka and AMQP connectors. Decided 2026-11-14 (D-261): build both as source and destination connectors; no broker of our own.
2. Libraries in scripts. Expose a vetted set of npm packages to the sandbox, or keep everything behind GalvaniFlow's own helpers (SCR4)? Recommendation: helpers first, a short allow-list later.
3. Python in scripts (SCR11). Recorded as won't. Overrule it if you see demand the data doesn't show.
4. Multi-tenancy (HA6) and a hosted offering (HA7). Both stay consider. Rhapsody's lockers are praised, but both are business-model choices.
5. Low-code visual mapping (UI17). Reviewers love DTL-style mapping and also say no-code tools break down for complex logic (SB29). The v2.0 flow editor should compile to code and keep code as the escape hatch.

## Method and caveats

- Score = 4 × streams that found the theme + 2 × log2(1 + sources) + log2(1 + votes and stars) + engines named (max 6). Breadth across independent streams counts most, so a theme raised in seven places outranks one with huge volume in one place. Repeating segments (SCR5) has the most Stack Overflow views but ranks 62 because only two streams found it. Use the score to order, not to settle close calls.
- Source counts mean different things per stream: issues, questions matched by keyword, reviews, threads, tools. Reddit reaction counts are per thread, so an entry resting on one comment carries the whole thread's votes.
- Review sites mostly block fetching. The commercial-engine stream leans on KLAS excerpts, PeerSpot, marketplace mirrors and snippets.
- Theme assignment, status and call are judgment calls, made against the code on 2026-11-13. To change one, edit `clusters.mjs` and run:

```bash
node docs/research/voice-of-user/score.mjs docs/research/voice-of-user/data --check
```

```bash
node docs/research/voice-of-user/gen-tables.mjs docs/research/voice-of-user/data > docs/research/voice-of-user/ranking.md
```
