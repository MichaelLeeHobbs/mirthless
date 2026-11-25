# Scripting

What people can write inside a channel and what the system promises about it: languages, what each kind of script may do, the functions scripts can call, limits that keep one script from harming other channels, shared code, and the tools for writing and trying a script. Area code `SCR`. Message formats are in Data types, the order scripts run in is in Pipeline, maps, collections and data sources themselves are in Shared data, and testing a whole channel is in Channels.

## Languages and checks (LNG)

| ID | Requirement | Pri | Verify | Status |
|---|---|---|---|---|
| SCR-LNG-01 | The system shall let each script be written in JavaScript or TypeScript and shall keep that choice through save, clone, export, import, backup and restore. | P1 | Test | Proposed |
| SCR-LNG-02 | The system shall refuse to deploy a channel with a script, filter rule or transformer step it cannot compile or cannot run, naming it, and shall never skip one; a refused redeploy shall leave the version that was running as it was. | P1 | Test | Proposed |
| SCR-LNG-03 | When a person deploys or redeploys a channel, the system shall refuse while a TypeScript script in it has a type error, naming the script and the line; a server restart shall bring back a deployed channel without this check. | P1 | Test | Proposed |
| SCR-LNG-04 | The system shall refuse to save a global script or a shared function that does not compile, or a TypeScript one with a type error, naming the line. | P1 | Test | Proposed |

- SCR-LNG-01: source: docs/user/capabilities.md "Write scripts in JavaScript or TypeScript" (Yes); D-284, D-294, D-296. One exception is kept and reported: a restore that stores a TypeScript global script with type errors as JavaScript (D-294, D-303).
- SCR-LNG-02: source: D-207, D-229. Known gaps: a Message Builder step with no script is skipped (code), and the standalone script check accepts a filter rule with an await that then fails to deploy (ROADMAP "Known Issues").
- SCR-LNG-03: source: D-285, D-297.
- SCR-LNG-04: source: D-229 (compile), D-285 (types, global scripts; a template is checked when saved).

## Kinds of script and step (KND)

| ID | Requirement | Pri | Verify | Status |
|---|---|---|---|---|
| SCR-KND-01 | The system shall accept a message only when its filter returns exactly true, and shall show error, naming the rule, when a filter rule returns anything but true or false. | P1 | Test | Proposed |
| SCR-KND-02 | The system shall take what a preprocessor, transformer or response transformer left in the message, or the text or object it returned in place of it; a script that returns nothing, true or false shall not replace the message. | P1 | Test | Proposed |
| SCR-KND-03 | The system shall run the preprocessors on the text as received, before it is parsed, so that a preprocessor can repair text that would not parse. | P1 | Test | Proposed |
| SCR-KND-04 | The system shall run the global and the channel's deploy script at each deploy and undeploy script at each undeploy; a deploy script that fails shall fail the deploy, and an undeploy script that fails shall be logged as an error and shall not stop the undeploy. | P1 | Test | Proposed |
| SCR-KND-05 | The system shall let a person build a filter rule without code by choosing a field, a condition (equals, does not equal, contains, does not contain, exists, does not exist, starts with, ends with, matches a pattern) and values, and join rules with and or or. | P1 | Test | Proposed |
| SCR-KND-06 | The system shall run Mapper transformer steps, which copy one field, with an optional default value, into a message field or a map variable without code. | P1 | Test | Proposed |
| SCR-KND-07 | The system shall run Message Builder transformer steps, which write a value with an optional default into a field of the message without code. | P1 | Test | Proposed |
| SCR-KND-08 | The system shall let a filter rule or transformer step be repeated over each occurrence of a repeating segment, element or array without code. | P2 | Test | Proposed |
| SCR-KND-09 | The system shall run transformer steps that apply an XSLT 1.0 style sheet to an XML message. | P3 | Test | Proposed |
| SCR-KND-10 | The system shall run filter rules and transformer steps whose script is read from a file on the server when the step runs. | P3 | Test | Proposed |

- SCR-KND-01: source: D-226; docs/user/scripting-api.md "What a script returns".
- SCR-KND-02: source: D-226, D-132; docs/user/scripting-api.md "What a script returns". What leaves a script is data (D-223).
- SCR-KND-03: source: docs/design/02-engine.md "Pipeline Flow"; docs/design/04-transformer-sandbox.md "Script Execution Contexts" (the preprocessor gets the raw string). Conflict: ROADMAP "Remaining for v1.0" ticks off rejecting malformed messages at the source, and the code refuses text that does not parse before any preprocessor runs; the design intent kept.
- SCR-KND-04: source: D-229; docs/design/04-transformer-sandbox.md "Script Execution Contexts". A failing undeploy script is logged and the teardown carries on (code).
- SCR-KND-05: source: docs/user/capabilities.md "Rule Builder filter rules" (Yes); D-207; the condition list is from code.
- SCR-KND-06: source: docs/user/capabilities.md "Mapper transformer steps" (No); ROADMAP "Remaining for v1.0"; D-207; #172. P1 although planned, because it is migration parity.
- SCR-KND-07: source: docs/design/13-non-connector-gap-analysis.md section 3 (three step types); the importer maps Mirth's step and the editor offers it (code). Today the editor's step of this name holds a script, an imported one has none and is skipped with no warning, against D-207.
- SCR-KND-08: source: docs/user/capabilities.md "Iterator, XSLT and External Script steps" (No); ROADMAP N11.
- SCR-KND-09: source: the same capability row; ROADMAP N11. XSLT 1.0 is the drafter's assumption.
- SCR-KND-10: source: the same capability row; ROADMAP N11. It would run code that no deployment recorded, against D-328.

## Functions scripts can call (API)

| ID | Requirement | Pri | Verify | Status |
|---|---|---|---|---|
| SCR-API-01 | The system shall let scripts read, replace and delete any field, repetition, component and subcomponent of an HL7 v2 message, and any element of an X12 message, by a path whose numbers count from 1, as raw text and (HL7 v2) as unescaped text. | P1 | Test | Proposed |
| SCR-API-02 | The system shall give scripts the source, channel, connector, response, global channel, global and configuration maps, the source and configuration maps read-only, with the same scopes and the same short names as Mirth Connect. | P1 | Test | Proposed |
| SCR-API-03 | The system shall let scripts query databases and use resources and collections only by the name of one a person with permission defined, with the values of a query passed apart from its text, and shall never give a script the credentials. | P1 | Test | Proposed |
| SCR-API-04 | The system shall let a script hand text to another channel by name, shall raise a script error when that channel is not started or records the message as error, and shall tell the script when that channel filtered it. | P1 | Test | Proposed |
| SCR-API-05 | The system shall give scripts helpers that read and write HL7 timestamps with their precision and offset, convert between named time zones, add and subtract time, and compute an age, correct across daylight-saving changes. | P2 | Test | Proposed |
| SCR-API-06 | The system shall give scripts helpers that encode and decode base64, hexadecimal and URL text, make a UUID, and compute SHA-256 and HMAC-SHA-256. | P2 | Test | Proposed |
| SCR-API-07 | The system shall give scripts helpers that go through the segments, groups and repetitions of an HL7 v2 message as objects, and insert, copy and remove a segment at a position. | P2 | Test | Proposed |
| SCR-API-08 | The system shall let scripts list, read and add attachments of the message they run on. | P2 | Test | Proposed |

- SCR-API-01: source: docs/user/scripting-api.md "HL7 helpers"; docs/user/capabilities.md "HL7 v2 messages read and edited by path" (Yes), "X12 messages read and edited by path" (Partial); D-218, D-224, D-244, D-258. Exact parsing rules are in Data types.
- SCR-API-02: source: docs/user/capabilities.md "Channel, connector, response, global and configuration maps" (Yes); docs/user/scripting-api.md "Maps"; D-191. How long shared maps keep values is in Shared data.
- SCR-API-03: source: docs/user/capabilities.md "Call HTTP, databases, collections and other channels from scripts" (Yes); D-178, D-177; docs/user/scripting-api.md "Data Sources", "Collections". Which databases, limits and read-only defaults are in Shared data.
- SCR-API-04: source: the same capability row; D-231; docs/user/scripting-api.md "Optional IO bridges".
- SCR-API-05: source: docs/user/capabilities.md "Helper functions for dates, attachments and other common jobs" (Partial), "Standard helper library and a page on maps and the message model" (Partial); #343; ROADMAP N9, V8.
- SCR-API-06: source: #343; ROADMAP V8.
- SCR-API-07: source: #343; ROADMAP V8; docs/design/18 theme SCR5.
- SCR-API-08: source: docs/user/capabilities.md "Helper functions for dates, attachments and other common jobs" (Partial); ROADMAP N9. #343 does not list attachments; the capability row and N9 do.

## Limits and isolation (ISO)

| ID | Requirement | Pri | Verify | Status |
|---|---|---|---|---|
| SCR-ISO-01 | The system shall end a script that runs longer than its channel's script time limit (1 to 300 seconds, 30 unless set), waiting for HTTP, database and other calls included, show the message as error with that limit, and count only the script's own time against it. | P1 | Test | Proposed |
| SCR-ISO-02 | When a script cannot be ended at its limit and other channels cannot run, the system shall within 70 seconds past that limit end and restart by itself, bring back every other deployed channel, keep that script's channel undeployed, and show which channel is held and why until it is deployed again. | P1 | Test | Proposed |
| SCR-ISO-03 | While a script of one channel computes without pause until its time limit, every other channel shall still start processing a received message, and the health check shall still answer, within 1 second. | P1 | Test | Proposed |
| SCR-ISO-04 | When a script uses more memory than the limit set for scripts, the system shall end that script and show its message as error; the server and every other channel shall keep running. | P1 | Test | Proposed |
| SCR-ISO-05 | A script shall reach no file, process, environment value, module, network address, database or other channel's data except through the functions this area and Shared data name. | P1 | Test | Proposed |
| SCR-ISO-06 | A script's HTTP call shall return a redirect to the script instead of following it, fail when the response is larger than 10 MB, and fail after its own time limit, 30 seconds unless the script sets another. | P2 | Test | Proposed |

- SCR-ISO-01: source: D-212, D-300, D-323, D-184; docs/ops/resource-and-observability.md "Resource Sizing"; the range is from the channel schema. Building the script's surroundings and reading its result back each have a limit of their own, as long as the script's (D-323).
- SCR-ISO-02: source: D-340; docs/ops/resource-and-observability.md "A script that hangs the server": 60 seconds, then up to 8 to record the hold. The restart needs a supervisor that starts the server again (the shipped deployment has one, OPS-RUN-03). Stays needed as the last resort once SCR-ISO-03 holds.
- SCR-ISO-03: source: docs/user/capabilities.md "Write scripts in JavaScript or TypeScript" (Limits); ROADMAP "Remaining for v1.0" (worker threads); #348 ("within a stated latency"), #402; D-212. The 1 second is the drafter's number.
- SCR-ISO-04: source: #402, #348; packages/engine/src/sandbox/README.md "Notes / limitations" (no memory limit today). The size of the limit is in no source.
- SCR-ISO-05: source: docs/design/04-transformer-sandbox.md "The Problem"; docs/user/scripting-api.md "What a script does not have"; D-129, D-206, D-223, D-329, D-339. Conflict: SECURITY.md and scripting-api.md promise best effort, not a boundary, and tell sites to trust script authors with the server; design 04's goal kept as the rule, and #402 asks for the decision that could meet it.
- SCR-ISO-06: source: docs/user/scripting-api.md "Optional IO bridges"; D-227 for the reason redirects are not followed; the 30 seconds is from code. Which addresses a call may reach is SEC-NET-01 and SEC-NET-02 (D-235).

## Errors and logging (ERR)

| ID | Requirement | Pri | Verify | Status |
|---|---|---|---|---|
| SCR-ERR-01 | When a script fails on a message, the system shall keep with the message the error text, the script's name and the line of the script as its author wrote it, TypeScript included. | P2 | Test | Proposed |
| SCR-ERR-02 | The system shall show what a script wrote with its logger, with level and time, on the message it ran for, to people who may read that message, keeping at least the first 200 lines of each script run and saying when lines were left out. | P2 | Test | Proposed |

- SCR-ERR-01: source: docs/design/04-transformer-sandbox.md "Resolved Decisions" 5; compile and type errors already carry the line (D-285). Errors raised while a script runs carry no line, because scripts get no stack (D-339).
- SCR-ERR-02: source: docs/user/capabilities.md "Script logger output in the message browser" (No); #164, which leaves the place open (server log, message or both). On the message only, because SEC-LOG-02 keeps message content out of server logs. The 200 lines is the test run's cap (code).

## Shared code (TPL)

| ID | Requirement | Pri | Verify | Status |
|---|---|---|---|---|
| SCR-TPL-01 | The system shall make each shared function callable by name from every script of the kinds its author chose, in every channel its library is enabled for, without copying it into the script. | P1 | Test | Proposed |
| SCR-TPL-02 | The system shall let a person limit a library to chosen channels on the page where libraries are edited, and shall keep that limit through backup, restore and Mirth import. | P2 | Test | Proposed |
| SCR-TPL-03 | A saved change to a shared function shall reach a deployed channel only when that channel is deployed again, and the system shall show which deployed channels run an older version of it. | P2 | Test | Proposed |

- SCR-TPL-01: source: docs/user/capabilities.md "Code templates shared across channels" (Yes); docs/user/scripting-api.md "Code templates"; docs/design/04-transformer-sandbox.md "Code Template Integration".
- SCR-TPL-02: source: docs/user/capabilities.md "Limit a code template library to some channels" (Partial: the page cannot set it); ROADMAP N12; D-249, D-242.
- SCR-TPL-03: source: docs/design/02-engine.md "Deploy Sequence" ("needs redeploy" indicator); D-328 (a deployment records the templates compiled into it). The indicator does not exist (code).

## Writing and trying scripts (EDT)

| ID | Requirement | Pri | Verify | Status |
|---|---|---|---|---|
| SCR-EDT-01 | The script editors, with their completion and type checking, shall work in a browser that can reach nothing but the server. | P1 | Test | Proposed |
| SCR-EDT-02 | The script editor shall offer completion and type errors for exactly the functions, maps, message type and shared functions that the script being edited will have when it runs. | P2 | Test | Proposed |
| SCR-EDT-03 | The system shall let a person run one script on a sample message before saving it and see the resulting message, its maps, logger output and errors, as the pipeline would give them; the run shall send, write and route nothing and shall name each call it did not make. | P1 | Test | Proposed |
| SCR-EDT-04 | A test run shall end within 5 seconds of script time or the channel's script limit if shorter, use at most 64 MB of script memory, and never delay a channel, whatever the script does. | P1 | Test | Proposed |
| SCR-EDT-05 | The system shall neither store nor log the sample message of a test run, and shall withhold the result of a run it could not record in the audit log. | P1 | Test | Proposed |
| SCR-EDT-06 | The system shall let a person step through a script on a sample message, stop at a line and see each variable's value there, without stopping any deployed channel. | P3 | Demonstration | Proposed |
| SCR-EDT-07 | The system shall apply a saved script to a deployed channel's next message without a deploy. | P3 | Test | Proposed |
| SCR-EDT-08 | The system shall let scripts use libraries from a list that ships with the product, each at a fixed version, under every limit in this area. | P3 | Test | Proposed |
| SCR-EDT-09 | The system shall be able to suggest field mappings or script code to a person editing a channel, sending the model no message content, and shall apply a suggestion only when the person accepts it. | P3 | Demonstration | Proposed |
| SCR-EDT-10 | The system shall offer a pipeline step that sends message content to a language model an administrator configured and uses its answer, off unless an administrator turns it on for that channel, with each call recorded. | P3 | Test | Proposed |

- SCR-EDT-01: source: D-283 (the editor is bundled). Conflict: docs/user/capabilities.md "Write scripts in JavaScript or TypeScript" says the editor loads from a public CDN; D-283 is later and the code agrees, so the capability page is out of date. SEC-NET-04 says the same of the whole console.
- SCR-EDT-02: source: D-285, D-295, D-296; D-108. Types are checked for the focused editor only (D-295).
- SCR-EDT-03: source: D-286; docs/design/19-script-editor-tools.md shortlist 1. No test run exists for global scripts, code templates or JavaScript connector scripts (D-286, D-296). Testing a whole channel (#345) is in Channels.
- SCR-EDT-04: source: D-286, D-300, D-323; packages/server script test run limits. Known limit: a script stuck in native code keeps a thread until the server restarts (packages/engine/src/sandbox/README.md).
- SCR-EDT-05: source: D-286, D-312.
- SCR-EDT-06: source: docs/user/capabilities.md "Step-through debugger and live sample-message editing" (No); ROADMAP V3 and "v1.1"; docs/design/04-transformer-sandbox.md "Resolved Decisions" 4; docs/design/19 ranks per-line values from the last run as the cheaper form.
- SCR-EDT-07: source: ROADMAP "v1.1" (hot reload for scripts). It would run code no deployment recorded, against D-328.
- SCR-EDT-08: source: ROADMAP "[DECIDE] npm packages in the sandbox?"; docs/design/18 "Open decisions" 2 (helpers first, a short allow-list later).
- SCR-EDT-09: source: docs/user/capabilities.md "AI-assisted mapping and an LLM step" (No); ROADMAP B8, V14; docs/design/14 (build-time assist is low risk); docs/design/19 shortlist 8 (schema or tree only, never message content).
- SCR-EDT-10: source: the same capability row; ROADMAP B8 (PHI governance required for runtime use); docs/design/14 open decision 5.
