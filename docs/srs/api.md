# REST API and live updates

The contract that scripts, other systems and the console itself call: response format, changes made safely, limits, description, compatibility and the live feed. Area code `API`. Exact operations and their shapes are in the published API description; API keys and sign-in are in Authentication, and who may call what is in Access control.

## Responses and errors (RSP)

| ID | Requirement | Pri | Verify | Status |
|---|---|---|---|---|
| API-RSP-01 | The system shall answer every API request, refusals and unknown addresses included, in one format that states success or failure and carries either the data or an error code and message; the only exceptions are file downloads that succeed, health probes and metrics. | P1 | Test | Proposed |
| API-RSP-02 | The system shall give every API failure a code from a published list, so that a client can tell not found, conflict, invalid input, not allowed, rate limited, temporarily unavailable and internal error apart without reading the message text. | P1 | Test | Proposed |
| API-RSP-03 | In production the system shall put no stack trace, database text, file path or part of the request body in the answer to a request that failed for an internal reason or whose body could not be read. | P1 | Test | Proposed |
| API-RSP-04 | The system shall return every list that grows with use (messages, events, audit records, channels, alerts, collection records) in pages with the total number of matches, using the same paging inputs and fields on every such list, 25 items by default and at most 500, and shall refuse a larger page. | P2 | Test | Proposed |

- API-RSP-01: source: docs/ops/api-automation.md (opening section); docs/design/05-server-api.md "Response Format"; AGENTS.md "API Response Format".
- API-RSP-02: source: D-263; docs/design/05-server-api.md "Response Format"; the codes exist in code, no page lists them.
- API-RSP-03: source: D-299 (a body the parser refuses is answered with a fixed message); error handling in packages/server/src/middleware for the production message. The internal-error half is from code only.
- API-RSP-04: source: D-027; docs/design/05-server-api.md "Response Format"; page limits in packages/core-models/src/schemas (100 on most lists, 200 for search across channels, 500 for collection records). Conflict: the design gives an offset and limit, while lists today use either that or page and page size; one scheme (either) is kept as the rule.

## Changing things (CHG)

| ID | Requirement | Pri | Verify | Status |
|---|---|---|---|---|
| API-CHG-01 | The system shall refuse to save a change to a channel, code template or library, global script, alert, channel group, role or shared setting that was made against an older version than the one stored, report a conflict and leave the stored version as it is, including when two saves arrive at the same moment. | P1 | Test | Proposed |
| API-CHG-02 | An update that leaves a field out shall keep the stored value of that field, at every depth, and shall never put it back to its default. | P1 | Test | Proposed |
| API-CHG-03 | The system shall treat an identifier written in capitals and the same identifier in lower case as one object in every lookup, check, lock and record. | P1 | Test | Proposed |
| API-CHG-04 | A request that fails shall leave what is stored as it was, unless its answer lists the outcome of each item it was asked to change. | P1 | Test | Proposed |
| API-CHG-05 | Repeating a redeploy, or an overwriting import of an unchanged file, shall leave the same channels, configuration, credentials and running state as doing it once. | P1 | Test | Proposed |

- API-CHG-01: source: D-146 (channels), D-039 (code templates); docs/design/05-server-api.md "Channels". Built for channels, templates, libraries, alerts and groups; extended by the drafter to the other objects two people edit.
- API-CHG-02: source: #400; D-294 (the same class of fault for script languages).
- API-CHG-03: source: #397.
- API-CHG-04: source: D-146; docs/ops/api-automation.md "Import it on another server" (`errors` per channel).
- API-CHG-05: source: docs/ops/api-automation.md "Import it on another server", "Credentials" and "Deploy it"; D-335. The only operations a source says may be repeated.

## Limits (LIM)

| ID | Requirement | Pri | Verify | Status |
|---|---|---|---|---|
| API-LIM-01 | In production the system shall by default accept at most 600 API requests a minute from one client address and 300 from one API key, both set by the operator, and shall refuse the excess with the rate-limited error and the time to wait, without affecting other addresses or keys. | P1 | Test | Proposed |
| API-LIM-02 | The system shall read no request body from a caller it has not identified, other than a sign-in of at most 4 KB, and at most 1 MB from an identified one, or 50 MB for a channel import, a backup restore or a sent message, and shall refuse a request whose body is larger. | P1 | Test | Proposed |

- API-LIM-01: source: docs/user/access-control.md "API keys" (rate limit); D-313; rate limits in packages/server/src/middleware for the address default, which no page states. The sign-in limit and the daily row limit of a key are in Authentication.
- API-LIM-02: source: D-234, D-299 (#157); body limits in packages/server/src/middleware.

## Description and clients (DOC)

| ID | Requirement | Pri | Verify | Status |
|---|---|---|---|---|
| API-DOC-01 | The system shall publish an OpenAPI description that covers every API operation with its inputs, its answers, its error codes and the permission it needs, and a change that adds or alters an operation without its description shall fail the project's automated checks. | P1 | Test | Proposed |
| API-DOC-02 | Every answer the automated tests receive shall match the published description, which shall contain no credential field in any answer other than the one-time reveal of a new API key. | P2 | Test | Proposed |
| API-DOC-03 | The project shall publish with each release its API description as a file and a TypeScript client generated from it that compiles. | P2 | Test | Proposed |
| API-DOC-04 | The automation guide shall show how to export, import and deploy a channel and check its state with an API key and no browser, and its commands shall run as written against a real server in the project's automated checks. | P2 | Test | Proposed |
| API-DOC-05 | Everything a person can do in the console shall be possible through the described API under the same permission checks. | P1 | Analysis | Proposed |
| API-DOC-06 | The project should provide an MCP server through which an AI agent calls the API with an API key, limited to that key's permissions and recorded like any other use of it. | P3 | Demonstration | Proposed |

- API-DOC-01: source: #347; docs/user/capabilities.md "OpenAPI description of the REST API"; docs/ops/api-automation.md; ROADMAP V14. Conflict: capabilities.md says Yes and api-automation.md says the full API is described; #347 counts 33 of about 165 routes. The promise is kept as the rule.
- API-DOC-02: source: #347 (proposal 3 and acceptance).
- API-DOC-03: source: #347 (proposal 4); docs/user/capabilities.md "Generated API clients and an MCP server" (No); ROADMAP V14. Another language only when someone asks (#347).
- API-DOC-04: source: docs/ops/api-automation.md; #347 (acceptance: the client runs the recipes); D-280.
- API-DOC-05: source: D-280 (scripts call the API instead of a command-line client), keeping the principle of D-067; docs/ops/api-automation.md. Acting on one's own session, password or preferences, and the powers Access control keeps from API keys, need a signed-in person.
- API-DOC-06: source: ROADMAP V14; docs/design/18-voice-of-the-user.md AI2; docs/user/capabilities.md "Generated API clients and an MCP server" (No).

## Compatibility (VER)

| ID | Requirement | Pri | Verify | Status |
|---|---|---|---|---|
| API-VER-01 | From version 1.0 the API version shall be part of every API address, and within one API version no release shall remove or rename an operation, field or error code, change a field's meaning, or require an input it did not require before. | P1 | Test | Proposed |
| API-VER-02 | When a new API version replaces one, the system shall serve the old version beside it for at least 12 months after the release that announces its end. | P2 | Inspection | Proposed |

- API-VER-01: source: docs/design/05-server-api.md "Resolved Decisions" 2 (a version in the address; additive changes preferred; a new version only when a breaking change is unavoidable). Nothing checks it today.
- API-VER-02: source: docs/design/05-server-api.md "Resolved Decisions" 2, which allows a second version and says nothing of the first. The 12 months is the drafter's number.

## Live feed (LIV)

| ID | Requirement | Pri | Verify | Status |
|---|---|---|---|---|
| API-LIV-01 | The system shall accept a live connection only from a caller whose session the API would accept at that moment, check it again at every subscription and at least every 60 seconds, and close it when the check fails or cannot be made. | P1 | Test | Proposed |
| API-LIV-02 | Live events for channels, messages and statistics shall carry only identifiers, states and counts, never message content or metadata. | P1 | Test | Proposed |
| API-LIV-03 | The system shall send at most one message event per channel and one statistics event per second to each caller, shall always send one after the last change, and shall never merge or reorder one channel's state changes. | P2 | Test | Proposed |
| API-LIV-04 | After a lost live connection the console shall subscribe again and reload everything it shows, and while it has none shall refresh statistics at least every 60 seconds and message lists at least every 30 seconds. | P2 | Test | Proposed |

- API-LIV-01: source: D-076; docs/user/access-control.md "Cutting someone off" and docs/user/capabilities.md "Cut off a user by disabling the account" (live connections re-checked every 60 seconds); live feed code for the check at every subscription. Which channels' events a caller receives is in Access control.
- API-LIV-02: source: docs/user/access-control.md "What is not audited" (feeds carry IDs, states and counts; the log feed carries log entries and is not covered here); D-306.
- API-LIV-03: source: D-306. The order of one channel's state changes is from code only.
- API-LIV-04: source: D-078, D-079, D-306.
