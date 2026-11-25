# Operations

Installing, configuring, starting, stopping, backing up, upgrading and scaling the product, and how much load it must carry. Area code `OPS`. Health endpoints, metrics and logs belong to Monitoring and alerts (`MON`); what becomes of one message after a crash, and what an acknowledgement promises, belong to Pipeline (`PIPE`); secrets, TLS and the server's privileges belong to Security (`SEC`).

In this file, the reference host is one machine with 4 CPU cores and 16 GB of memory that runs the server and its PostgreSQL database, and the reference channel receives HL7 v2 over MLLP, runs one transformer script, sends to one MLLP destination and stores all content. Both come from the recorded soak baseline.

## Install and configuration (INS)

| ID | Requirement | Pri | Verify | Status |
|---|---|---|---|---|
| OPS-INS-01 | The documented container install steps, run with a release's published images on a host that holds nothing of the product, shall end with the administrator signed in to the console and one message delivered through a channel, with no step that is not documented. | P1 | Test | Proposed |
| OPS-INS-02 | The system shall refuse to start when a setting it reads at start is missing or malformed, and shall name every such setting in that one attempt. | P1 | Test | Proposed |
| OPS-INS-03 | A new install shall contain no example channel, example message or other demonstration data unless the installer asked for it. | P1 | Test | Proposed |
| OPS-INS-04 | The project shall provide a documented install for Kubernetes that one command carries out and that gives the result named in OPS-INS-01. | P3 | Demonstration | Proposed |

- OPS-INS-01: source: docs/user/capabilities.md "Run in production with Docker Compose" (Partial, no automated test proves the stack); docs/ops/deployment.md "First install". Conflict: deployment.md says there are no published images, the release workflow publishes them for each version tag; published images kept, since no release is tagged yet.
- OPS-INS-02: source: docs/ops/deployment.md "First install" (the stack refuses to start without its passwords). A weak signing secret is a Security rule. The server's configuration tests are the only source for the other settings, and its code the only source for naming them all in one attempt.
- OPS-INS-03: source: docs/ops/deployment.md "First install"; docs/ops/release-notes-v0.1.0.md "Breaking changes".
- OPS-INS-04: source: docs/progress/ROADMAP.md v3.0 "Helm chart"; doc 09 section 3.6 "Cloud-Native Deployment".

## Start and stop (RUN)

| ID | Requirement | Pri | Verify | Status |
|---|---|---|---|---|
| OPS-RUN-01 | When one start step fails (the job queue, the message clean-up schedule, channel redeploy or audit storage), the system shall still carry out every start step that does not need it and shall keep the console and the API reachable. | P1 | Test | Proposed |
| OPS-RUN-02 | The system shall count a start step other than channel redeploy as failed when it has not finished after 60 seconds, shall let it go on, and shall clear the failure if it then succeeds. | P2 | Test | Proposed |
| OPS-RUN-03 | When the server process ends for any reason an operator did not ask for, the shipped deployment shall start it again and every channel that was deployed shall come back without an operator, except a channel held because its script hung the server. | P1 | Test | Proposed |
| OPS-RUN-04 | A message the system acknowledged positively before it was asked to stop shall, after the next start, be stored and either hold a final status at each of its destinations or still be queued for it. | P1 | Test | Proposed |
| OPS-RUN-05 | The server shall end by itself within 30 seconds of being asked to stop, reporting failure if it had to abandon a step, and the shipped deployment shall not end it by force before that time is up. | P1 | Test | Proposed |

- OPS-RUN-01: source: D-308; docs/ops/resource-and-observability.md "Startup steps".
- OPS-RUN-02: source: D-308; docs/ops/resource-and-observability.md "Startup steps". How a failed step or a channel that did not come back is reported is in Monitoring and alerts.
- OPS-RUN-03: source: docs/ops/resource-and-observability.md "A script that hangs the server" (D-340); docs/ops/deployment.md "Operating it". Which deployed version comes back is a Channels rule (D-328).
- OPS-RUN-04: source: docs/user/capabilities.md "Shut down without losing messages" (Partial: in-flight messages have no automated test); doc 05 "Graceful Shutdown". Written as the rule that must hold.
- OPS-RUN-05: source: doc 05 "Graceful Shutdown" (30 seconds, then force exit). That the deployment must wait as long is a drafter's inference: the shipped container files set no stop wait, so the container runtime's default of 10 seconds applies.

## Backup and restore (BAK)

| ID | Requirement | Pri | Verify | Status |
|---|---|---|---|---|
| OPS-BAK-01 | The documented database backup command shall read each backup back and check that it lists the product's own tables, shall keep the backup only when both hold, and shall otherwise report failure and leave no backup file behind. | P1 | Test | Proposed |
| OPS-BAK-02 | The documented restore steps, run on every release into a fresh database, shall check the backup before they replace any database and shall reproduce every row of a populated install, after which every channel deploys and delivers a message. | P1 | Test | Proposed |
| OPS-BAK-03 | A configuration backup shall hold every kind of configuration the product stores apart from secrets (channels, code templates, scripts with their languages, alerts, users, roles, assignments, settings, resources, groups, tags, dependencies, maps, certificates, data sources and collection definitions), or fail and name the item it could not read. | P1 | Test | Proposed |
| OPS-BAK-04 | A configuration restore shall report, for each kind, how many items it created, updated, skipped and failed, with the reason for each failure, and one failed item shall not stop the others from being restored. | P2 | Test | Proposed |

- OPS-BAK-01: source: D-338; #361; docs/ops/backup-restore.md "Logical backup with pg_dump".
- OPS-BAK-02: source: docs/ops/backup-restore.md "Restore with pg_restore" ("Only a restore proves a backup"); D-338; #340. CI runs the documented commands against a throwaway database today; "every row, and every channel delivers" is the rule of #340 applied to restore.
- OPS-BAK-03: source: docs/user/capabilities.md "Back up and restore server configuration" (Yes); docs/ops/backup-restore.md "Application Config Backup" ("A backup is complete or it fails"). Conflict: that page calls the list complete, but the backup format has no certificates, data sources, collection definitions, roles or assignments, and no language for a code template; the stated intent (complete or fail) kept.
- OPS-BAK-04: source: docs/ops/backup-restore.md "Restore"; docs/ops/upgrade.md "An alert's regex must compile" (reports it and restores the others); D-303.

## Upgrade and rollback (UPG)

| ID | Requirement | Pri | Verify | Status |
|---|---|---|---|---|
| OPS-UPG-01 | When a database migration or the check of the server's database role fails, the new version shall not start serving or processing messages, and the failed migration shall leave schema and data as they were before it. | P1 | Test | Proposed |
| OPS-UPG-02 | Every release shall upgrade a populated database of each release it claims to upgrade from with no row lost or changed except as its release notes say, after which every channel that deployed before either deploys or is listed by OPS-UPG-05, and what was queued is delivered. | P1 | Test | Proposed |
| OPS-UPG-03 | When migrations are pending on a database that holds data, the system shall refuse to migrate unless a readable backup of that database at its current migration was taken in the last 24 hours, or the operator named the newest pending migration in an override that is logged. | P1 | Test | Proposed |
| OPS-UPG-04 | The documented upgrade steps shall stop the system accepting messages before they take the backup that a rollback would restore, so that a rollback loses no acknowledged message. | P1 | Inspection | Proposed |
| OPS-UPG-05 | The system shall list, before an upgrade changes anything, each channel the new version would refuse to deploy and the reason. | P2 | Test | Proposed |
| OPS-UPG-06 | A version of the server shall refuse to start on a database that a newer version has migrated. | P1 | Test | Proposed |
| OPS-UPG-07 | The documented rollback steps shall bring back the previous release on its own data from the pre-upgrade backup, proved by a test that runs the documented commands for each release. | P1 | Test | Proposed |
| OPS-UPG-08 | Each release shall state the runtime and PostgreSQL versions it supports, the earlier releases it upgrades from directly, the date support for each ends, and every change that can stop a channel that deployed before. | P2 | Inspection | Proposed |

- OPS-UPG-01: source: docs/ops/upgrade.md "How migrations run" and "Database roles"; D-155; D-307. "As they were before it" is the drafter's reading of "never serves against a half-migrated schema".
- OPS-UPG-02: source: docs/user/capabilities.md "Upgrade with migration tests per release" (Partial); #340; ROADMAP V7; docs/ops/upgrade.md "Migration 0007" ("From 1.0 onward, migrations will be data-preserving").
- OPS-UPG-03: source: #363; D-338 ("Not covered: a check that a backup exists before an upgrade").
- OPS-UPG-04: source: #363 (proposal 4). Conflict: docs/ops/upgrade.md "Standard upgrade (Docker)" backs up while the server still runs; #363 is the later intent and is kept.
- OPS-UPG-05: source: #340 (preflight check); docs/ops/upgrade.md "Stricter connector properties" prints queries to run by hand.
- OPS-UPG-06: source: docs/ops/upgrade.md opening rule ("never point an old binary at a database migrated by a newer version") and docs/ops/backup-restore.md (newer dump on an older binary is not supported). The docs ask the operator; that the product enforces it is a drafter's inference.
- OPS-UPG-07: source: #340 (rollback test); docs/ops/upgrade.md "Rollback" (forward-only migrations, restore the dump). There is no down migration, and this row does not ask for one.
- OPS-UPG-08: source: ROADMAP V7; #340 (published policy); doc 18 themes UPG1 and UPG2. Conflict: D-007 says Node 22, the images and the package's engine range say 24 or later; the number belongs in the release statement, so no number is kept here.

## Availability (HA)

| ID | Requirement | Pri | Verify | Status |
|---|---|---|---|---|
| OPS-HA-01 | A server started against a database that another live server is using shall start no channel and say why, unless it has joined that server in a supported cluster. | P1 | Test | Proposed |
| OPS-HA-02 | When the server running a channel fails, a standby server shall take over that channel within 60 seconds without an operator. | P2 | Test | Proposed |
| OPS-HA-03 | A takeover shall lose no message that was acknowledged positively, and a server that has lost a channel shall store, send or acknowledge nothing more for it. | P1 | Test | Proposed |
| OPS-HA-04 | The system shall run different channels on several servers at once over one database and let any server take over the others' channels. | P3 | Demonstration | Proposed |
| OPS-HA-05 | When the database stops answering, the system shall keep running, and within 60 seconds of it answering again every started channel shall receive and deliver again without an operator. | P1 | Test | Proposed |
| OPS-HA-06 | The system shall let a channel keep accepting messages while the database is down by holding them in other durable, encrypted storage, and process them in arrival order, ahead of later messages, when the database returns. | P3 | Test | Proposed |
| OPS-HA-07 | The system shall host several organisations in one install, with channels, users and data of each invisible to the others. | P3 | Test | Proposed |

- OPS-HA-01: source: docs/ops/deployment.md "Known limitations" (two servers against one database will both run every deployed channel); docs/user/capabilities.md "Automatic failover to a standby node" (No). Written as the safety rule that must hold until clustering ships; that the product refuses is a drafter's inference.
- OPS-HA-02: source: docs/user/capabilities.md "Automatic failover to a standby node"; ROADMAP B2 and v3.0 "Leader election", "Message takeover", "Heartbeat monitoring". No source gives a takeover time; 60 seconds is the drafter's number.
- OPS-HA-03: source: #308 (leases and fencing; only the node that stored the message may acknowledge it). P1 because it binds whatever failover ships; it adds no promise before OPS-HA-02 does.
- OPS-HA-04: source: docs/user/capabilities.md "Active-active clustering at no cost"; ROADMAP V6 and v3.0 "Horizontal clustering"; #308. Order within a channel and per patient is a Pipeline rule (ROADMAP B3).
- OPS-HA-05: source: #307 (most engines stop when the database stops); docs/ops/resource-and-observability.md "Health & Readiness Endpoints" (the database being down is not a reason to restart the process). The 60 seconds is the drafter's number.
- OPS-HA-06: source: #307 (ideas, not a design).
- OPS-HA-07: source: ROADMAP v3.0 "Multi-tenancy". Conflict: the same roadmap lists multi-tenancy as undecided (Beyond-Mirth "[DECIDE]"), doc 18 keeps it at "consider" and doc 14 calls it a business decision; the v3.0 line is written out so the owner can answer it.

## Performance and capacity (PERF)

| ID | Requirement | Pri | Verify | Status |
|---|---|---|---|---|
| OPS-PERF-01 | On the reference host the system shall carry 1,000 messages per second through reference channels for 60 minutes, with no message lost and no queue growing. | P2 | Test | Proposed |
| OPS-PERF-02 | On the reference host, below 100 messages per second, the median time from receiving a message to its stored final status shall be at most 10 ms with no script, 15 ms with one transformer script, and 30 ms with three destinations. | P2 | Test | Proposed |
| OPS-PERF-03 | With 500 deployed channels, the server shall answer everything the dashboard needs for its first display within 200 ms at the median. | P3 | Test | Proposed |
| OPS-PERF-04 | Before each release, a run of at least 3 hours at 100 messages per second through a reference channel shall show every acknowledged message stored and delivered exactly once, with the transformer's change applied. | P1 | Test | Proposed |
| OPS-PERF-05 | In the run of OPS-PERF-04, the 99th percentile acknowledgement time of every minute shall stay at or below 100 ms, and the server's memory shall grow by at most 10 percent after the first hour. | P2 | Test | Proposed |
| OPS-PERF-06 | While 8 users sign in at the same moment, the system shall still answer a health check and accept a message within 100 ms. | P2 | Test | Proposed |
| OPS-PERF-07 | On the reference host the system shall carry 5,000 messages per second, and meet medians of 5 ms, 8 ms and 15 ms in place of those in OPS-PERF-02 and 100 ms in place of that in OPS-PERF-03. | P3 | Test | Proposed |
| OPS-PERF-08 | Each release shall publish what it measured (message rate, acknowledgement time, memory, database growth per message and per day for each storage mode) and the largest message it was tested with, with the steps to repeat it. | P2 | Inspection | Proposed |

- OPS-PERF-01: source: ROADMAP "Performance Targets" (Throughput, v1.0: 1,000+). The target names no host, channel or duration; the ones here are the drafter's. Conflict: docs/ops/throughput-benchmark.md measures about 500 per second with one script per message and nothing stored, and the soak baseline is 100 per second; the roadmap's target kept.
- OPS-PERF-02: source: ROADMAP "Performance Targets" (Simple message, Message with transformer, Message with 3 destinations, v1.0). The median and the load are the drafter's reading; the table gives neither.
- OPS-PERF-03: source: ROADMAP "Performance Targets" (Dashboard load, v1.0: under 200 ms). The channel count and the median are the drafter's.
- OPS-PERF-04: source: docs/ops/soak-test.md (what the run checks, and the 2026-10-09 baseline: 1,080,004 sent, none missing, duplicated or untransformed). "Before each release" is the drafter's reading of "Keep publishing the soak baseline" (doc 18 theme PERF1). Exactly once holds here because no partner or server fails during the run; delivery in general is at least once (README, Out of scope).
- OPS-PERF-05: source: docs/ops/soak-test.md "Baseline" (per-minute p99 15 to 61 ms; memory 917 to 952 MB after the first minutes). The limits are the drafter's, set above the baseline.
- OPS-PERF-06: source: #257; D-324 (eight sign-ins at once took a health check from 2 ms to about 690 ms). The 100 ms is the drafter's number. A script that loops and blocks other channels (#348, #402) is a Scripting rule.
- OPS-PERF-07: source: ROADMAP "Performance Targets", v2.0 column.
- OPS-PERF-08: source: docs/ops/soak-test.md "Observations worth knowing"; docs/ops/resource-and-observability.md "Resource Sizing"; docs/ops/throughput-benchmark.md; #192 (a batch file is held in memory whole).

## Time (TIM)

| ID | Requirement | Pri | Verify | Status |
|---|---|---|---|---|
| OPS-TIM-01 | The system shall record every time it stores so that it names the same moment whatever time zone the server, the database or the reader is in, and so that a change of any of them or of daylight saving time does not change it. | P1 | Test | Proposed |
| OPS-TIM-02 | The system shall show the time zone a schedule runs in beside that schedule, and run it in that zone. | P2 | Test | Proposed |

- OPS-TIM-01: source: the database schema, where every stored time carries its zone (code is the only source; no document states the rule).
- OPS-TIM-02: source: the Settings page text for the pruning schedule ("3 AM daily") names no zone, and no document says which one applies (code is the only source); doc 18 theme UI10.
