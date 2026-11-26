# Pipeline

How a message moves through a channel: its stages and statuses, the destinations it is sent to, the answer its sender gets, queues and retries, and what happens to it when a channel or the server stops. The rule behind every row is that an accepted message is never lost, duplicated or corrupted without a record someone can see. Area code `PIPE`. What each protocol acknowledges is in Connectors, what is stored and for how long is in Messages, formats and how they split are in Data types, and scripts are in Scripting.

## Stages and statuses (STG)

| ID | Requirement | Pri | Verify | Status |
|---|---|---|---|---|
| PIPE-STG-01 | The system shall take each message through these stages in this order, leaving out only those its channel does not have: global preprocessor, channel preprocessor, source filter, source transformer, destinations, channel postprocessor, global postprocessor. | P1 | Test | Proposed |
| PIPE-STG-02 | The system shall record a message under its own message number, with the content as received when the channel's storage setting keeps content, before it runs any script on it and before it tells the sender it was accepted; when it cannot record the message, it shall tell the sender the message failed and shall process it no further. | P1 | Test | Proposed |
| PIPE-STG-03 | The system shall show, for the source and for each destination a message was routed to, exactly one of these statuses at a time: received, transformed, filtered, queued, being sent from the queue, sent, or error. | P1 | Test | Proposed |
| PIPE-STG-04 | When parsing, a preprocessor, a filter or a transformer fails for a message, or anything else goes wrong before the message is routed, the system shall send nothing past the failure (to no destination for a source stage, not to that destination for a destination stage), show error with the stage and the reason, and raise an alert. | P1 | Test | Proposed |
| PIPE-STG-05 | The system shall show a message's source as sent only when every destination it was routed to was sent it, filtered it or put it on its queue and no postprocessor failed; otherwise it shall show the source as error. | P1 | Test | Proposed |
| PIPE-STG-06 | When the system has delivered a message and cannot save that destination's status or the partner's answer, it shall log an error and raise an alert, each naming the channel, the message and the destination, and shall not show the delivery as failed. | P1 | Test | Proposed |
| PIPE-STG-07 | The system shall count each received message once and each destination's final outcome once, also when the message was retried from a queue or run again after a server stop. | P2 | Test | Proposed |
| PIPE-STG-08 | After a message has been deleted, the system shall hold none of its content and shall send it to no destination. | P1 | Test | Proposed |

- PIPE-STG-01: source: docs/user/capabilities.md "Filter, transform and route messages through a channel" (Yes); docs/design/04-transformer-sandbox.md "Script Execution Contexts"; D-020.
- PIPE-STG-02: source: docs/design/02-engine.md "Pipeline Flow" and "Source Queue"; D-131; the engine refuses a message whose first store fails (code). What each storage setting keeps is in Messages.
- PIPE-STG-03: source: docs/design/02-engine.md "Pipeline Flow", "Destination Queue Manager" and "Recovery"; D-130 for being sent from the queue.
- PIPE-STG-04: source: D-122 (source stages), D-132 (destination stages), D-228 (an error no stage handles). Alert on a failed destination script: D-132 asks for it.
- PIPE-STG-05: source: D-132; docs/design/02-engine.md "Pipeline Flow". The status of a message whose queued destination later gives up stays the source's; the destination shows error.
- PIPE-STG-06: source: #404; D-132; D-228. A failed status write is only logged today, with no alert; a partner's answer that cannot be stored is dropped with neither.
- PIPE-STG-07: source: ROADMAP "Known Issues" (a message interrupted and run again is counted as received twice); #401. Conflict: D-233 accepts two rows and two counts for such a message, ROADMAP lists it as an issue and #401 says it must stay one message; the later intent (once) kept. D-345 (#408) does this.
- PIPE-STG-08: source: #403. The issue leaves open whether such a delete is refused, waits or ends the processing; the row states only the outcome.

## Routing (RTE)

| ID | Requirement | Pri | Verify | Status |
|---|---|---|---|---|
| PIPE-RTE-01 | The system shall send each message that passes the source filter to every enabled destination of the channel except those a source script took out of the message's destination set, by name or by number. | P1 | Test | Proposed |
| PIPE-RTE-02 | A destination that fails, is slow or holds a queue shall neither stop nor delay sending the same message to any other destination that is not set to wait for it. | P1 | Test | Proposed |
| PIPE-RTE-03 | A destination set to wait for the previous one shall start on a message only when the previous one has ended on it, and its scripts shall be able to read the previous one's answer. | P1 | Test | Proposed |
| PIPE-RTE-04 | The system shall send a queued, resent or recovered message only to the destination it was prepared for, whatever destinations were since added, removed or reordered in the channel; when that destination is gone or switched off it shall not send the message, and shall show on the message, with an alert, why it was not sent. | P1 | Test | Proposed |
| PIPE-RTE-05 | The system shall end a send that has run longer than its destination's limit (CONN-DST-12) and treat it as a failed attempt at that limit, even where its transport cannot be ended; the limit shall be the same for a direct send, a send from the queue and a send after a server stop. | P1 | Test | Proposed |
| PIPE-RTE-06 | The system shall let a channel set a longest time for one message across all its stages, and when a message passes it shall end the scripts and sends still running for it and show it as error with that reason. | P2 | Test | Proposed |
| PIPE-RTE-07 | The system shall refuse to hand a message to another channel when it has already been handed from channel to channel 10 times, counting destinations and scripts together, and shall show the hand-off that was refused as error. | P1 | Test | Proposed |

- PIPE-RTE-01: source: docs/user/capabilities.md "Filter, transform and route messages through a channel" (Yes); docs/design/04-transformer-sandbox.md "Destination Routing Control"; D-238.
- PIPE-RTE-02: source: docs/design/02-engine.md "Destination Routing"; D-189; docs/user/capabilities.md "Multiple threads per destination queue" (destinations run as parallel chains).
- PIPE-RTE-03: source: D-189 (waitForPrevious). Whether a later destination still runs when the previous one failed is in no source; the code runs it.
- PIPE-RTE-04: source: #395 (queue, resend, switched-off destination, stranded queue); D-343 (recovery compares the name and refuses). A queue goes by position today. #395 does not say whether a switched-off destination's queue is held or failed; the row asks only that it is visible.
- PIPE-RTE-05: source: D-212 (connector timeout with a five-minute backstop). Conflict: the code ends a queued or recovered send after 30 seconds whatever the destination's limit, and connector-reference.md "TCP_MLLP as a destination" says a queued message waits at most 30 seconds for a connection; D-212 kept.
- PIPE-RTE-06: source: ROADMAP "Remaining for v1.0" (overall deadline, review item L23); D-212 says there is none.
- PIPE-RTE-07: source: docs/user/connector-reference.md "CHANNEL: what it does" (10 hops); the script hand-off has its own limit of 25 (code), counted apart, so a mixed chain passes both. Conflict between the two numbers; the documented one kept.

## Answer to the sender (RSP)

| ID | Requirement | Pri | Verify | Status |
|---|---|---|---|---|
| PIPE-RSP-01 | The system shall answer the sender at the point its channel is set to: when the message has been recorded and before any script runs on it, when the source transformer has ended, when every destination has ended or queued the message (the default), or never. | P1 | Test | Proposed |
| PIPE-RSP-02 | The system shall report every failure that happened before the answer point to the sender as a failure, count a filtered or queued message as accepted, and show a failure that happens after the answer point on the message and in an alert. | P1 | Test | Proposed |
| PIPE-RSP-03 | The system shall answer with the channel postprocessor's return value or with a named destination's answer when the channel is set to, and shall refuse to deploy a channel that names a destination it does not have. | P1 | Test | Proposed |
| PIPE-RSP-04 | The system shall run a destination's response transformer on the answer of each delivery, direct or from its queue; when the transformer fails, the destination shall stay shown as sent with the error kept and an alert raised, and the message shall not be sent again. | P1 | Test | Proposed |

- PIPE-RSP-01: source: docs/design/02-engine.md "Pipeline Flow" (response mode table) and "Source Queue"; docs/user/capabilities.md "Response transformers and response modes" (Yes). In code the two early choices change what the sender is told but not when: the answer waits for the whole pipeline, and "never" is not applied. The capability row does not name this gap.
- PIPE-RSP-02: source: D-211; D-231 (a filtered message is accepted); e2e/scenarios/s26-respond-before-processing.
- PIPE-RSP-03: source: D-239; docs/user/capabilities.md Mirth migration "Respond from a destination or the postprocessor"; the deploy refusal is in code.
- PIPE-RSP-04: source: docs/user/capabilities.md "Response transformers and response modes" (Yes); docs/design/02-engine.md "Pipeline Flow" and "Recovery" (PENDING messages re-run the response transformer). Conflict: the capability row names no limit, but the queue does not run it (code), and D-343 says so as "not changed" for recovery; the design intent kept for queues.

## Queues (QUE)

| ID | Requirement | Pri | Verify | Status |
|---|---|---|---|---|
| PIPE-QUE-01 | The system shall let each destination be set never to queue, to queue a message whose direct send failed, or always to queue, and shall keep a queued message across restarts until it is delivered, given up on or deleted. | P1 | Test | Proposed |
| PIPE-QUE-02 | The system shall retry a queued message after its destination's retry interval (10 seconds unless set) until it is delivered when the retry count is 0, and otherwise that many times after the first attempt, after which it shall show error with the last reason. | P1 | Test | Proposed |
| PIPE-QUE-03 | The system shall send a destination's queued messages in the order their channel received them and hold those behind a failed one until it is delivered or given up on, unless the destination is set to skip past a failed message, in which case it shall go on with those behind it and retry the failed one after them. | P1 | Test | Proposed |
| PIPE-QUE-04 | While a destination that queues on failure has a message waiting on its queue, the system shall queue later messages behind it instead of sending them directly, unless the destination is set to skip past a failed message. | P1 | Test | Proposed |
| PIPE-QUE-05 | A retry, a resend or a send after a server stop shall use exactly the content and script variables prepared when the message was routed; when they were not kept, the system shall send nothing and show error with that reason, and it shall refuse to deploy a queued destination on a channel whose storage setting does not keep them. | P1 | Test | Proposed |
| PIPE-QUE-06 | The system shall show on a waiting message why its latest attempt failed, raise an alert when a run of failed attempts begins and another for each message it gives up on, and show no failure reason once the message is delivered. | P1 | Test | Proposed |
| PIPE-QUE-07 | The system shall let a destination's queue be sent with more than one send at a time, the number set per destination and 1 unless set. | P2 | Test | Proposed |
| PIPE-QUE-08 | When a destination's queue has more than one send at a time, the system shall send messages that share the value of a key the channel names, such as the patient identifier, one at a time in the order received. | P2 | Test | Proposed |
| PIPE-QUE-09 | The system shall let each destination be set never to queue, to queue a message whose direct send failed other than as CONN-DST-05, CONN-DST-08, CONN-DST-09, CONN-FILE-10 or PIPE-QUE-10 says, or by an error of a target channel or a destination script, or always to queue, and shall keep a queued message across restarts until it is delivered, given up on or deleted. | P1 | Test | Proposed |
| PIPE-QUE-10 | The system shall let a destination be set to queue again (the default) or to hold as an error a send that may have reached its partner without an answer. | P1 | Test | Proposed |

- PIPE-QUE-01: source: docs/design/01-core-models.md queue modes; docs/design/02-engine.md "Destination Queue Manager"; docs/user/capabilities.md Mirth migration "Destination queue settings" (Yes).
- PIPE-QUE-02: source: D-230; the 10-second default is from the channel schema. Supersedes docs/design/02-engine.md "Queue Consumer", where 0 was one attempt.
- PIPE-QUE-03: source: D-210 (order and head-of-line blocking), D-230 ("Skip Past a Failed Message").
- PIPE-QUE-04: source: D-210 (an update must not overtake the admission it updates). Conflict: docs/design/01-core-models.md gives the ordering guarantee to always-queue only, and the code sends later messages directly while earlier ones wait; D-210's reason kept.
- PIPE-QUE-05: source: D-246 (a retry sends the same text), D-247, D-343, #390; docs/user/connector-reference.md "Every destination". Direct sends without a queue keep no variables by the developer's choice (D-343), hence the error.
- PIPE-QUE-06: source: D-230 (one alert on the first failure of a streak), D-248 (the latest reason is kept).
- PIPE-QUE-07: source: docs/user/capabilities.md "Multiple threads per destination queue" (No); ROADMAP N7; D-189; docs/design/02-engine.md "Resolved Decisions" 3.
- PIPE-QUE-08: source: docs/user/capabilities.md "Keep per-patient order while scaling out" (No); ROADMAP B3; docs/design/14 section 5. Must hold from the day PIPE-QUE-07 ships; scaling over several servers is in Operations.
- PIPE-QUE-09: source: srs-debate 2026-11-24, finding C1 (Scope). Keeps Pipeline in step with CONN-DST-08 and CONN-DST-09. Replaces PIPE-QUE-01: when this row is accepted, that row becomes Superseded by PIPE-QUE-09.
- PIPE-QUE-10: source: srs-debate 2026-11-24, finding C27 (Domain 4, moved here by Scope). Mirth's "queue on response timeout".

## Stopping with messages in flight (LIF)

| ID | Requirement | Pri | Verify | Status |
|---|---|---|---|---|
| PIPE-LIF-01 | On a stop, the system shall take no new message and shall give messages already being processed at least 5 seconds to end; one that has not ended by the time the channel is stopped shall either still end with a final status or be finished at the next start, as PIPE-REC-01 says. | P1 | Test | Proposed |
| PIPE-LIF-02 | On a halt, the system shall end every script and every send of the channel that can be ended without waiting for its own time limit, put a queued message whose send it ended back on its queue without counting an attempt, and show any other message it ended as error. | P1 | Test | Proposed |
| PIPE-LIF-03 | On a stop, the system shall take no new message and shall not report the channel stopped until every message already being processed has a final status and its waiting sender its answer, unless a person halts the channel or the server is stopping (OPS-RUN-05). | P1 | Test | Proposed |

- PIPE-LIF-01: source: docs/design/02-engine.md "Stop Sequence"; D-342; #390 (a TCP source gives live messages 5 s; other sources differ). The least time is from code. Server shutdown is in Operations.
- PIPE-LIF-02: source: D-342. A database query, a file write, a DICOM send, a JavaScript destination's script and a send to another channel cannot be ended and run to their end (D-342).
- PIPE-LIF-03: source: srs-debate 2026-11-24, finding C17 (chair, so that Pipeline agrees with CONN-SRC-13). PIPE-LIF-01 gave at least 5 seconds. Replaces PIPE-LIF-01: when this row is accepted, that row becomes Superseded by PIPE-LIF-03.

## Recovery after a server stop (REC)

| ID | Requirement | Pri | Verify | Status |
|---|---|---|---|---|
| PIPE-REC-01 | After the server stopped for any reason, the first start of each channel shall finish every message the channel had recorded and not finished, or show it as error with the reason, such as content that was not kept; none shall stay unfinished with nothing said. | P1 | Test | Proposed |
| PIPE-REC-02 | A message interrupted by a server stop before it was routed shall be run again as the same message, so that however often the server stops meanwhile there is one message and one delivery per destination. | P1 | Test | Proposed |
| PIPE-REC-03 | After a server stop the system shall send an interrupted message only to destinations that had no final outcome, never again to one shown as sent or filtered, and shall show on the message each destination whose interrupted send it repeated. | P1 | Test | Proposed |
| PIPE-REC-04 | When the same message has been interrupted by a server stop 3 times, the system shall not run it again by itself; it shall show it as error, raise an alert, and leave it for a person to run. | P1 | Test | Proposed |
| PIPE-REC-05 | A hand-off from one channel to another that a server stop interrupts shall leave exactly one message in the receiving channel after both channels have started again, and the sending channel shall show the outcome of that message; when the system cannot tell whether the receiving channel holds the message, it shall send it again. | P1 | Test | Proposed |
| PIPE-REC-06 | The system shall never have two sends of one message to one destination under way at the same time, whether from the channel, its queue, a resend, or recovery while an earlier deployment of the channel is still sending. | P1 | Test | Proposed |

- PIPE-REC-01: source: docs/user/capabilities.md "Recover messages after a crash" (Yes); docs/design/02-engine.md "Recovery"; D-133, D-187, D-213, D-233. A message whose content the storage setting did not keep is counted as failed at every start and left unfinished today (D-133, code).
- PIPE-REC-02: source: #401 (one message became 28 and all 28 were sent). Conflict: D-213 and D-233 run it again as a new message and close the original; #401 and the work it cites keep the same message, kept here as the later intent. D-345 (#408) does this.
- PIPE-REC-03: source: D-213; docs/user/connector-reference.md "Every destination" (the partner can get the interrupted message twice). Delivery is at least once (README Out of scope), so the repeat must be visible; nothing marks it today. The mark itself is an assumption from the Purpose.
- PIPE-REC-04: source: #401 "A limit on reruns", which asks for a decision first; the number and the choice of error over holding the channel are the drafter's default.
- PIPE-REC-05: source: #401 "Channel destinations", reproduced in `channel-hand-off.itest.ts`; D-397 does it for a Channel destination, with D-393's ERROR for a message the receiving channel failed. Not yet: `routeMessage` in a script that runs again, a receiving channel that splits batches or keeps no raw content, and one that is not started when the sender sends again (#401).
- PIPE-REC-06: source: D-130, D-233, D-343 (recovery waits for an earlier deployment); #339 (a resend is not checked against a send in progress).

## Batches and attachments (BAT)

| ID | Requirement | Pri | Verify | Status |
|---|---|---|---|---|
| PIPE-BAT-01 | The system shall let a source split what it receives into messages at a delimiter, at each match of a regular expression, by a script, or at the message boundaries of its data type, set in the channel editor. | P2 | Test | Proposed |
| PIPE-BAT-02 | The system shall process every message of a batch in the batch's order, also after one of them fails, and shall report the batch to its source as failed when it could not be split, or when any of its messages ended in error before the channel's answer point (PIPE-RSP-02). | P1 | Test | Proposed |
| PIPE-BAT-03 | When a failure or a server stop ends a batch part way, the system shall show which of its messages were processed, and processing the rest shall neither repeat one nor leave one out. | P1 | Test | Proposed |
| PIPE-BAT-04 | The system shall let a channel take the parts of a message that match a pattern, or that a script picks, out of the message as attachments before its filter runs, put the original part back in what a destination is sent, and show error when taking one out fails. | P2 | Test | Proposed |

- PIPE-BAT-01: source: docs/user/capabilities.md "Split batches by delimiter, regex or script" (Partial: only HL7 v2 is reachable); docs/design/02-engine.md "Batch Message Processing"; ROADMAP "Remaining for v1.0" (attachment extraction and batch splitting).
- PIPE-BAT-02: source: D-254. A script splitter passes the batch on as one message when its script fails (D-254, unused code); this row forbids that.
- PIPE-BAT-03: source: #192 ("a retry neither duplicates nor drops any"). Conflict: D-254 accepts that an MLLP sender told of an error resends the whole batch and the messages that worked are delivered again; kept as accepted for a resend by the partner, not for our own restart.
- PIPE-BAT-04: source: docs/design/02-engine.md "Attachment Handler"; ROADMAP "Remaining for v1.0"; D-189. Putting the part back is an assumption: without it a destination would be sent the reference. Storage and download are in Messages.

## Message patterns (PAT)

| ID | Requirement | Pri | Verify | Status |
|---|---|---|---|---|
| PIPE-PAT-01 | The system shall let a channel collect messages that share a key and release them as one when a count, a time or a condition is reached, keeping what it collected across restarts. | P3 | Test | Proposed |
| PIPE-PAT-02 | The system shall let a channel send a copy of each message to another destination whose failure or delay changes neither the message's status nor its answer. | P3 | Test | Proposed |
| PIPE-PAT-03 | The system shall let a destination move a message it gives up on to a holding place that a person can list, resend from and empty, with the message's history kept. | P3 | Test | Proposed |

- PIPE-PAT-01: source: docs/user/capabilities.md "Aggregator, wire-tap and dead-letter queue steps" (No); ROADMAP B9; docs/design/14 section 5.
- PIPE-PAT-02: source: the same capability row; ROADMAP B9.
- PIPE-PAT-03: source: the same capability row; docs/user/capabilities.md "Bulk and per-destination reprocess with guardrails" (Partial); ROADMAP B9 and V9; #339 leaves it out. Reprocessing by filter is in Messages.
