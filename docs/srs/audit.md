# Audit

The protected record of who signed in, who was refused, who saw patient data, and who changed what. It covers what the record holds, when a request is refused because it cannot be recorded, how the record is protected and kept, how it is read, and what must never be in it. Operational events for running the server are in [Monitoring and alerts](monitoring.md). Area code `AUD`.

## The record (REC)

| ID | Requirement | Pri | Verify | Status |
|---|---|---|---|---|
| AUD-REC-01 | Each audit record shall hold the server's time, the action, its outcome, the person or API key, the client address, and the channel when there is one, and shall still identify that person, key or channel after it is deleted. | P1 | Test | Proposed |

- AUD-REC-01: source: D-312, D-033 (a deleted account keeps its identity); docs/ops/audit-log.md "How it is protected"; docs/user/access-control.md "Cutting someone off".

## Sign-ins and refusals (SIGN)

| ID | Requirement | Pri | Verify | Status |
|---|---|---|---|---|
| AUD-SIGN-01 | The system shall record each sign-in, sign-out and rejected sign-in, with the reason a sign-in was rejected: unknown user, wrong password, locked account, disabled account or rate limit. | P1 | Test | Proposed |
| AUD-SIGN-02 | The system shall record each API request refused for its credential or its permission, with the method, the operation, the reason and the request's identifier. | P1 | Test | Proposed |
| AUD-SIGN-03 | The system shall record the first refusal for a given caller, operation and reason at once, and shall record the number of repeats in the following 60 seconds as one further record when those 60 seconds end. | P2 | Test | Proposed |
| AUD-SIGN-04 | The system shall record in the same way a refusal to give access the person does not hold, and a refusal to join a live feed. | P1 | Test | Proposed |
| AUD-SIGN-05 | The record of a sign-in shall identify the text of the system use notice the person agreed to, when one was shown. | P2 | Test | Proposed |

- AUD-SIGN-01: source: docs/user/capabilities.md "Audit sign-ins and sign-outs" (Yes, rate-limited requests excluded); docs/user/access-control.md "Signing in". Conflict: capabilities.md lists a rate-limited sign-in as not recorded; drafted as recorded, because a password-guessing run is mostly rate-limited. Records of these are best effort (D-312).
- AUD-SIGN-02: source: D-314; docs/user/access-control.md "Refused requests".
- AUD-SIGN-03: source: D-314; docs/user/access-control.md "Refused requests".
- AUD-SIGN-04: source: docs/design/20-rbac-access-plan.md slice 10a "Open after 10a" (an access refusal is answered but not recorded); for live feeds, code only (a refused join is logged, not recorded).
- AUD-SIGN-05: source: srs-debate 2026-11-24, finding A26 (Scope 5; Domain agrees). Replaces AUTH-SUN-02: when this row is accepted, that row becomes Superseded by AUD-SIGN-05.

## Reads of patient data and secrets (PHI)

| ID | Requirement | Pri | Verify | Status |
|---|---|---|---|---|
| AUD-PHI-01 | Before anything is sent to the caller, the system shall record each message search in one channel or across channels, message view, message export, attachment download, message sent from the console, script test run that returns a result, event export and backup download. | P1 | Test | Proposed |
| AUD-PHI-02 | When a record AUD-PHI-01 requires cannot be written within 2 seconds, the system shall refuse the request, send none of the data, and offer no way to go on without the record. | P1 | Test | Proposed |
| AUD-PHI-03 | The record of a search shall hold the search term as typed, the filters, the total found and the identifier of every message returned, and the record of an export the identifier of every message exported. | P1 | Test | Proposed |
| AUD-PHI-04 | When a person repeats the same search page or message view within 15 minutes, the system may omit a new record only if every message returned was already recorded for that person and read, and shall otherwise record the newly shown identifiers at once. | P1 | Test | Proposed |
| AUD-PHI-05 | The system shall record every export, attachment download, backup download and API key read, however often it is repeated. | P1 | Test | Proposed |
| AUD-PHI-06 | The system shall record each read of the global map, the configuration map, collection records, unmasked connector credentials, the server log, its live feed, and event searches, and the recipients of each alert email, without holding the request up for the record. | P1 | Test | Proposed |
| AUD-PHI-07 | The system shall record an API key's read of collection records before sending them, and shall refuse the read when the record cannot be written. | P1 | Test | Proposed |
| AUD-PHI-08 | The system shall count each audit record that was lost because its write failed, and shall show administrators that count since the server started. | P2 | Test | Proposed |

- AUD-PHI-01: source: D-312, D-318; docs/user/capabilities.md "Audit access to message content (PHI)" (Partial) and "Search across channels" (Yes); docs/user/access-control.md "Where PHI and secrets can leave" and "What is recorded".
- AUD-PHI-02: source: D-312; docs/user/access-control.md "What is recorded" and "Exports and backups need a reason". Conflict: D-144 made these records never block a read; D-312 is later and kept.
- AUD-PHI-03: source: D-312, D-317; docs/user/access-control.md "What is recorded". The term may itself be patient data, which is why AUD-USE-05 limits who reads it (D-312).
- AUD-PHI-04: source: D-312, D-317; docs/user/access-control.md "What is recorded". Not drafted: docs/design/20-rbac-access-plan.md section 6 also drops a caller's remembered reads when their access changes, which no later decision mentions and the code does not do.
- AUD-PHI-05: source: D-312, D-313, D-318; docs/user/access-control.md "API keys".
- AUD-PHI-06: source: D-312; docs/user/access-control.md "Where PHI and secrets can leave". The live feed of the server log is listed there as not recorded; drafted as recorded, like the log page.
- AUD-PHI-07: source: D-321; docs/user/access-control.md "API keys".
- AUD-PHI-08: source: docs/user/access-control.md "What is not audited"; docs/design/20-rbac-access-plan.md section 6; docs/ops/hipaa-security-checklist.md "Audit controls".

## Changes (CHG)

| ID | Requirement | Pri | Verify | Status |
|---|---|---|---|---|
| AUD-CHG-01 | The system shall record every change to a role, an assignment, a channel's groups, an API key or whether an account is enabled, with the state after the change and who made it, such that the change and its record are both kept or neither is. | P1 | Test | Proposed |
| AUD-CHG-02 | The system shall record in the protected audit record, with who made it, each change a person or API key makes to, or deployment of, a channel, code template, global script, setting, extension, certificate, alert, map, collection, resource or data source, each backup restore, password reset, account unlock and statistics reset, and each connection test. | P1 | Test | Proposed |
| AUD-CHG-03 | The system shall record in the protected audit record, with who did it, each message reprocessed, resent, deleted or pruned on demand. | P1 | Test | Proposed |
| AUD-CHG-04 | When the record of a change in AUD-CHG-02 or AUD-CHG-03 cannot be written, the system shall refuse the change. | P2 | Test | Proposed |
| AUD-CHG-05 | The system shall record each purge of operational events, with the age chosen and the number removed, and shall remove nothing when that record cannot be written. | P1 | Test | Proposed |
| AUD-CHG-06 | The system shall record in the audit log, or refuse, each account creation, change of an account's email address, change of a user's own password, second-factor change and identity link. | P1 | Test | Proposed |

- AUD-CHG-01: source: D-312, D-319, D-320; docs/design/20-rbac-access-plan.md section 6 and slice 11a (one record per change, proved by a test).
- AUD-CHG-02: source: docs/design/20-rbac-access-plan.md section 6 ("who authored code and config, who deployed, who restored"); docs/user/capabilities.md "Keep the audit record where the server cannot change it" (Partial: configuration changes are still events that can be purged); docs/user/access-control.md "What is not audited" (an extension change names no user, and unlocks, statistics resets and connection tests are unrecorded). Conflict: capabilities.md says these move "until grant changes move there in #265"; grant changes moved, configuration changes did not.
- AUD-CHG-03: source: docs/user/access-control.md "Where PHI and secrets can leave" and "Exports and backups need a reason" (these are events, which can be purged after 1 day); docs/ops/hipaa-security-checklist.md "Audit controls".
- AUD-CHG-04: source: docs/ops/hipaa-security-checklist.md "Known gaps" 5 (audit events can be dropped). Conflict: D-044 chose that a failed event write never stops the operation; D-312 made only reads, exports and access changes refuse.
- AUD-CHG-05: source: D-316, D-312; docs/user/access-control.md "What is not audited".
- AUD-CHG-06: source: srs-debate 2026-11-24, finding A27 (Domain 8, moved here by Scope).

## Exports (EXP)

| ID | Requirement | Pri | Verify | Status |
|---|---|---|---|---|
| AUD-EXP-01 | The system shall require a reason of 3 to 500 characters on one line for each message export, event export and backup download, and shall keep it in the export's audit record. | P1 | Test | Proposed |
| AUD-EXP-02 | The system shall start each file it exports from messages, events or a backup with the server's name, the exporter, the time, the reason and the number of the audit record that names the export, in a form that a spreadsheet reads as one cell and never as a formula. | P1 | Test | Proposed |
| AUD-EXP-03 | The audit record of a backup download shall hold a fingerprint of the file, so that a backup found later can be matched to its record. | P2 | Test | Proposed |

- AUD-EXP-01: source: D-318, D-312; docs/user/access-control.md "Exports and backups need a reason".
- AUD-EXP-02: source: D-318; docs/ops/audit-log.md "Tracing an exported file". Conflict: docs/design/20-rbac-access-plan.md section 6 made event exports best effort; D-318 refuses them without a record, and is kept.
- AUD-EXP-03: source: D-312, D-318; docs/ops/audit-log.md "Tracing an exported file" (the fingerprint leaves the header out).

## Protection and retention (PROT)

| ID | Requirement | Pri | Verify | Status |
|---|---|---|---|---|
| AUD-PROT-01 | The system shall offer no screen, API request or script call, to any role, that adds an audit record of the caller's own wording or changes or deletes an audit record. | P1 | Inspection | Proposed |
| AUD-PROT-02 | In the shipped deployment, the database credential the running server holds shall be able only to add and read audit records, and shall be refused every attempt to change, delete, empty or drop them. | P1 | Test | Proposed |
| AUD-PROT-03 | The database shall refuse to change, delete or empty audit records even for the database owner unless the owner first removes that protection, and the documentation shall say that a database owner can. | P2 | Test | Proposed |
| AUD-PROT-04 | The system shall keep audit records at least 6 years, treating a retention setting that is lower, missing or unreadable as 6 years. | P1 | Test | Proposed |
| AUD-PROT-05 | The system shall remove audit records only as whole calendar months wholly past retention, only when a database owner asks and gives a reason, and only after recording the months, the retention applied, the reason and the database user. | P1 | Test | Proposed |
| AUD-PROT-06 | The system shall keep accepting audit records when storage for the current month was not prepared, and shall warn administrators that it was not. | P1 | Test | Proposed |
| AUD-PROT-07 | The system should let an administrator detect that an audit record was changed or removed by a database owner. | P3 | Test | Proposed |

- AUD-PROT-01: source: D-043 (nobody can inject a record), D-312; docs/user/access-control.md "What scope promises" ("an audit log that the product can't change or delete").
- AUD-PROT-02: source: D-307, D-312; docs/user/capabilities.md "Keep the audit record where the server cannot change it" (Partial); docs/ops/audit-log.md "How it is protected".
- AUD-PROT-03: source: D-312; docs/ops/audit-log.md "How it is protected"; docs/user/access-control.md "What scope promises".
- AUD-PROT-04: source: D-312; docs/ops/audit-log.md "Retention".
- AUD-PROT-05: source: docs/ops/audit-log.md "Retention"; D-312. Conflict: D-312 says "from an admin's action"; the runbook gives it to the database owner alone, and is kept.
- AUD-PROT-06: source: docs/ops/audit-log.md "Partitions"; docs/design/20-rbac-access-plan.md section 6.
- AUD-PROT-07: source: docs/ops/hipaa-security-checklist.md "Integrity" ("audit rows have no hash"), which lists the gap without asking for it. Conflict: the same line says audit rows have no immutability, which docs/ops/audit-log.md contradicts and replaces.

## Reading the record (USE)

| ID | Requirement | Pri | Verify | Status |
|---|---|---|---|---|
| AUD-USE-01 | The system shall let only a person holding the permission to read the audit record read it, and shall refuse that permission to every API key, to every assignment on chosen groups, and on a new install to every built-in role but admin. | P1 | Test | Proposed |
| AUD-USE-02 | The system shall let that person find records by action, outcome, person, channel and time, and by the record number in an exported file's header. | P1 | Test | Proposed |
| AUD-USE-03 | The system shall let that person export the audit records for a chosen period, with a reason, as AUD-EXP-01 and AUD-EXP-02 require of other exports. | P2 | Test | Proposed |
| AUD-USE-04 | The system shall record each search and view of the audit record, with the filters used. | P2 | Test | Proposed |
| AUD-USE-05 | The system shall let only a person holding the permission to read the audit record read it, and shall refuse that permission to every assignment on chosen groups, and on a new install to every built-in role but admin. | P1 | Test | Proposed |

- AUD-USE-01: source: D-312, D-316; docs/design/20-rbac-access-plan.md decision 8; docs/user/access-control.md "Role and permission matrix" (`audit:read`). Conflict: the `events:read` row of that matrix still says it reads every user's sign-ins and client addresses; the text below the matrix and D-316 say sign-ins moved to the audit record, and are kept.
- AUD-USE-02: source: docs/ops/audit-log.md "Tracing an exported file"; docs/user/access-control.md "What scope promises". The list of filters comes from the query schema.
- AUD-USE-03: source: docs/progress/ROADMAP.md v1.2 "Compliance reporting" (open).
- AUD-USE-04: source: docs/user/access-control.md "What is not audited" (the audit log itself), which states the gap without asking for it; search terms in the record can be patient data.
- AUD-USE-05: source: srs-debate 2026-11-24, finding A26 (Scope 9). That an API key cannot hold it is AUTH-KEY-04's. Replaces AUD-USE-01: when this row is accepted, that row becomes Superseded by AUD-USE-05.

## What must never be in it (NEV)

| ID | Requirement | Pri | Verify | Status |
|---|---|---|---|---|
| AUD-NEV-01 | An audit record shall never hold message or attachment content, a test run's sample, a request's body, full address or query, or the text of an alert; the terms and filters a caller searched with are the only exception. | P1 | Inspection | Proposed |
| AUD-NEV-02 | An audit record shall never hold a password, token, API key secret, connector credential, private key, or the key or value of a global map entry. | P1 | Inspection | Proposed |

- AUD-NEV-01: source: D-314, D-286, D-312; docs/user/access-control.md "Refused requests" and "Where PHI and secrets can leave" (alert emails).
- AUD-NEV-02: source: AGENTS.md "Security First" (no credential logging); docs/user/access-control.md "Refused requests". That map keys stay out because scripts build them from patient identifiers comes from code.
