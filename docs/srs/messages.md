# Messages

What the product keeps of every message, how people find and read it, send it again, take it out and get rid of it, for operators, support analysts and whoever answers for PHI. Area code `MSG`. Message statuses, queues and crash recovery are in [Pipeline](pipeline.md), who may do each thing in [Access control](access.md), replacing the encryption key in [Security](security.md), and the record of who read what in [Audit](audit.md).

## Storage (STO)

A channel has one of five storage modes: DEVELOPMENT, PRODUCTION, RAW, METADATA or DISABLED. "Content" below means every stored body of a message at every stage, its stored variables and its error text.

| ID | Requirement | Pri | Verify | Status |
|---|---|---|---|---|
| MSG-STO-01 | In the DEVELOPMENT, PRODUCTION and RAW storage modes, the system shall keep the original of each accepted message exactly as its source connector passed it to the channel, so that reading it back gives the same characters whatever the channel's scripts did to it. | P1 | Test | Proposed |
| MSG-STO-02 | In the DEVELOPMENT and PRODUCTION storage modes, the system shall keep for each message its transformed content, the content sent to each destination, each destination's response, the variables a queued destination needs to send it again, and the text of every error. | P1 | Test | Proposed |
| MSG-STO-03 | The system shall keep no content other than the original and the text of errors in the RAW storage mode, and no content at all in the METADATA and DISABLED storage modes. | P2 | Test | Proposed |
| MSG-STO-04 | In every storage mode, the system shall keep for each accepted message its ID, its correlation ID, the time it was received, and the status and number of send attempts of its source and of each destination, until the message is deleted or pruned. | P1 | Test | Proposed |
| MSG-STO-05 | When any part of an accepted message that its storage mode keeps cannot be stored, a destination's response included, the system shall log an error, raise the channel's error alerts and show on the message which part is missing, and shall leave the status of a destination that already delivered it as delivered. | P1 | Test | Proposed |

- MSG-STO-01: source: docs/user/capabilities.md "Store every message and its content in PostgreSQL" (Yes); docs/design/18-voice-of-the-user.md "MSG8 raw message kept for replay"; docs/design/01-core-models.md storage table. Conflict: D-092, D-133 and docs/testing/32-storage-policies.md say PRODUCTION keeps no original; doc 01, the code and its tests keep it, because reprocessing and recovery need it. Doc 01 and the code kept. An original a connector cannot pass on whole (a binary body, for example) is refused at the source, which the Connectors area owns.
- MSG-STO-02: source: docs/design/01-core-models.md "Content stored per mode"; D-247 (variables of a queued destination are kept in PRODUCTION); D-248 (a failed send keeps its reason). DEVELOPMENT also keeps the preprocessed content and the source variables; that difference is from doc 01 and the code. Conflict: D-092 says PRODUCTION keeps only errors, as under MSG-STO-01.
- MSG-STO-03: source: D-092, D-131. Conflict: doc 01 keeps errors and custom metadata in METADATA, and in DISABLED not even connector status ("statistics only"); D-092 and D-131, which are later, keep no content in either, so the two modes are the same. D-092 kept.
- MSG-STO-04: source: D-092, D-131 ("Storage policy applies to CONTENT rows only, never the message row"). Conflict: doc 01 drops connector status in DISABLED; D-131 kept.
- MSG-STO-05: source: issue #404 (a destination's answer that cannot be stored is dropped and the message reads SENT with no response). Showing the gap on the message is this draft's reading of "Fail safe, not silent" in AGENTS.md.

## Encryption at rest (ENC)

| ID | Requirement | Pri | Verify | Status |
|---|---|---|---|---|
| MSG-ENC-01 | On a channel with content encryption on, the system shall store message content and attachments only encrypted: without a usable key the channel does not deploy, and content that cannot be encrypted is not stored and is reported as a failed store. | P1 | Test | Proposed |
| MSG-ENC-02 | The system shall turn content encryption on by default for each newly created channel when the server has a content key. | P1 | Test | Proposed |

- MSG-ENC-01: source: D-156 ("never store PHI as plaintext"; supersedes D-143); docs/user/capabilities.md "Encrypt message content at rest" (Partial: attachments are not encrypted); docs/ops/hipaa-security-checklist.md "Encryption at rest"; docs/ops/deployment.md.
- MSG-ENC-02: source: docs/user/capabilities.md "Encrypt message content at rest" ("Off by default per channel"); docs/ops/hipaa-security-checklist.md lists that as a gap. The default is this draft's proposal, and no decision asks for it. Cost: stored content on such a channel cannot be text-searched (D-156). Replacing the key is Security's.

## Search and view (SRCH)

| ID | Requirement | Pri | Verify | Status |
|---|---|---|---|---|
| MSG-SRCH-01 | The system shall list a channel's messages, newest first by default and page by page, filtered by any combination of status, connector, received time range, message ID and a text contained in any stored content. | P1 | Test | Proposed |
| MSG-SRCH-02 | The system shall also filter a channel's messages by a regular expression over stored content, by error text, and by a range of send attempts. | P2 | Test | Proposed |
| MSG-SRCH-03 | The system shall let a developer define a channel's custom metadata columns in the channel editor, fill them for each message from its variables, and let a user show them and filter by them in the message browser. | P2 | Test | Proposed |
| MSG-SRCH-04 | The system shall search messages across all the channels the user may read, by status, received time range and chosen channels, and a message shall match a status that its source or any one of its destinations has. | P1 | Test | Proposed |
| MSG-SRCH-05 | The system shall search messages across channels by the value of a custom metadata column and by a text contained in stored content. | P2 | Test | Proposed |
| MSG-SRCH-06 | When a content search could not look inside some messages in its range, because their content is encrypted or was not kept, the system shall say so with the results, so that "not found" is never shown as if every message had been searched. | P1 | Test | Proposed |
| MSG-SRCH-07 | The system shall return the first page of a search by status and one-day time range within 5 seconds on a channel holding 10 million messages. | P2 | Analysis | Proposed |
| MSG-SRCH-08 | The system shall show for one message the status and send attempts of its source and each destination, every stored stage of its content, its stored variables, its error text, and its attachments with a download for each. | P1 | Test | Proposed |
| MSG-SRCH-09 | The system shall show a stored HL7 v2 message segment by segment, whatever its segment endings, delimiters or batch envelope, with the path and name of each field, and the path shown shall be the one a script reads that value by. | P2 | Test | Proposed |

- MSG-SRCH-01: source: docs/user/capabilities.md "Browse and search a channel's messages" (Yes); D-027. The page limit of 100 is the API's and is left to the REST API area.
- MSG-SRCH-02: source: ROADMAP N4; docs/user/capabilities.md "Search by regex, error and send attempts" (Partial); docs/design/13-non-connector-gap-analysis.md "Message search operators".
- MSG-SRCH-03: source: ROADMAP N5; docs/user/capabilities.md "Custom metadata columns" (Partial); D-240 (filled once after the source transformer; filter by equality or presence), D-189 (editor control removed until built). Conflict: doc 13 asks for greater-than, less-than and contains; D-240 rejected them for now. D-240 kept.
- MSG-SRCH-04: source: docs/user/capabilities.md "Search across channels" (Yes); D-310 (only channels in the caller's scope). That any destination counts is from the code and its integration test; the Traffic page's "Needs Attention" list is this search for ERROR.
- MSG-SRCH-05: source: docs/design/18-voice-of-the-user.md "MSG2 metadata search" and "MSG3"; docs/srs/README.md user class "Support analyst" ("Find one message among millions"). No issue asks for content search across channels; assumed P2.
- MSG-SRCH-06: source: D-156 (a content search cannot match inside encrypted content). The message browser turns text search off on a channel that encrypts; the API and a channel whose encryption setting was changed do not say it. The rule is from AGENTS.md "Fail safe, not silent".
- MSG-SRCH-07: source: docs/design/18-voice-of-the-user.md "MSG1 search" (slow search is the theme); docs/srs/README.md "Find one message among millions". No source gives a number; 5 seconds and 10 million are placeholders.
- MSG-SRCH-08: source: docs/design/06-web-admin.md "Message Browser"; docs/user/capabilities.md "View and download attachments" (Yes); docs/user/quickstart-first-channel.md step 7. Script log output in the browser (#164) is left to Monitoring and Scripting.
- MSG-SRCH-09: source: issue #351; ROADMAP V10. The issue also asks for a tree, visible control characters, comparing two stages, and staying responsive on a 5 MB field in a time it does not state.

## Reprocess and resend (REP)

| ID | Requirement | Pri | Verify | Status |
|---|---|---|---|---|
| MSG-REP-01 | The system shall reprocess a message by running its kept original through its channel as a new message, and shall refuse with the reason when the channel is not started or the original was not kept. | P1 | Test | Proposed |
| MSG-REP-02 | The system shall show on a message which message it was reprocessed from and every message it was reprocessed as. | P2 | Test | Proposed |
| MSG-REP-03 | The system shall resend a message to one chosen destination, whatever that destination's queue mode, without sending it to any other destination or changing any other destination's record. | P1 | Test | Proposed |
| MSG-REP-04 | The system shall refuse a resend, with the reason, unless it can send what was routed to the destination it was routed to: that destination is still the same one and switched on, its sent content is kept, so are any variables its settings use, and no delivery of the message to it is in progress or waiting in its queue. | P1 | Test | Proposed |
| MSG-REP-05 | The system shall reprocess, or resend to chosen destinations, every message that matches a search filter or a list of IDs as one background job, in message order, at a rate the user sets, with its progress shown, and shall stop before the next message when the user cancels it. | P2 | Test | Proposed |
| MSG-REP-06 | After a server restart the system shall continue an unfinished reprocess job where it stopped, and shall reprocess each of its messages once. | P2 | Test | Proposed |
| MSG-REP-07 | Before a reprocess job starts, the system shall show the number of messages, their date range, the destinations affected and how many were already delivered, and shall make the user type that number to confirm when it is over 100. | P2 | Test | Proposed |

- MSG-REP-01: source: docs/user/capabilities.md "Reprocess and resend messages" (Yes). The refusals are from the code.
- MSG-REP-02: source: issue #339 ("No lineage view").
- MSG-REP-03: source: issue #339; D-172 (per-destination resend). Conflict: D-172 refuses a destination that does not queue; #339 asks for any chosen destination. #339, which is later, kept.
- MSG-REP-04: source: D-343 (Resend refuses without the stored variables); issue #395 (Resend finds its destination by number alone and does not check that it is switched on); issue #339 ("No check for a delivery in progress"). "Waiting in its queue" is added, because a resend there restarts the retry count of a message already going.
- MSG-REP-05: source: issue #339; ROADMAP V9; docs/user/capabilities.md "Bulk and per-destination reprocess with guardrails" (Partial: up to 500 hand-picked IDs). The dead-letter queue in V9 (REC5, B9) is left to the Pipeline area.
- MSG-REP-06: source: issue #339 acceptance ("a job over 2,000 messages keeps order, survives a restart and reprocesses each message once").
- MSG-REP-07: source: issue #339 ("Above a threshold the user types the count to confirm"). The issue gives no threshold; 100 is a placeholder.

## Export and attachments (EXP)

| ID | Requirement | Pri | Verify | Status |
|---|---|---|---|---|
| MSG-EXP-01 | The system shall export the messages that match the message browser's filters as CSV or JSON, with their content only when the user asks for it. | P2 | Test | Proposed |
| MSG-EXP-02 | When an export holds fewer messages than matched, the system shall state in the file both how many matched and how many it holds. | P1 | Test | Proposed |
| MSG-EXP-03 | The system shall take parts a channel's attachment rule picks out of each inbound message into attachments, and shall put them back unchanged into what a destination sends. | P2 | Test | Proposed |

- MSG-EXP-01: source: docs/user/capabilities.md "Export messages" (Yes); docs/design/06-web-admin.md "Message Browser". Today's export takes only status and dates. The reason for an export and the header that names its audit record (D-318) are Audit's, keeping a CSV cell from running as a formula is Security's; a permission of its own (#172) is Access control's.
- MSG-EXP-02: source: code only (an export is capped at 10,000 rows and tells the caller, outside the file, that it was cut); stated in the file so that a partial export is never taken for a complete one.
- MSG-EXP-03: source: ROADMAP "Attachment extraction and batch splitting: library code exists, no channel setting reaches it"; docs/design/02-engine.md "Attachment Handler"; D-189. Conflict: docs/design/09-feature-comparison-and-vision.md says extraction is done; D-189 and docs/ops/deployment.md say it is not. Putting parts back is docs/research/voice-of-user/ranking.md MSG7 (reattach).

## Deletion and retention (RET)

| ID | Requirement | Pri | Verify | Status |
|---|---|---|---|---|
| MSG-RET-01 | When a message is deleted or pruned, the system shall remove its content, attachments, custom metadata and connector records together, so that none of them outlives it. | P1 | Test | Proposed |
| MSG-RET-02 | The system shall refuse, with the reason, to delete a message that is still being processed or is waiting in a queue, and shall let an authorized user end the processing of a message that will never finish so that it can be deleted. | P1 | Test | Proposed |
| MSG-RET-03 | On the schedule an administrator sets, the system shall prune each channel that has pruning on of its messages older than the number of days a person set for that channel, and shall prune no channel that has no number set. | P1 | Test | Proposed |
| MSG-RET-04 | The system shall never prune a message that is unprocessed or has a destination queued or pending, whatever its age. | P1 | Test | Proposed |
| MSG-RET-05 | When one channel cannot be pruned, the system shall prune the others, report the run as failed and name the channel that was not pruned. | P1 | Test | Proposed |
| MSG-RET-06 | The system shall let a channel keep message records longer than message content, and keep messages that ended in ERROR longer than the rest, each for its own number of days. | P2 | Test | Proposed |
| MSG-RET-07 | On a channel with archiving on, the system shall prune a message only after writing it, with its content and attachments, to the archive, and shall keep a message whose archiving failed and report the failure. | P2 | Test | Proposed |
| MSG-RET-08 | On a channel set to remove content, or attachments, on completion, the system shall remove them only once the source and every destination, queued ones included, ended SENT or FILTERED, and shall keep them when any ended in ERROR. | P1 | Test | Proposed |
| MSG-RET-09 | When a channel is deleted, the system shall keep its messages searchable and marked as a deleted channel's, shall go on pruning them by the channel's settings, and shall let an administrator remove them all at once. | P2 | Test | Proposed |

- MSG-RET-01: source: D-209 and the code (a delete also removes attachments and custom metadata, "which hold PHI"); issue #403 (content left behind by a delete).
- MSG-RET-02: source: issue #403, which lists three ways (refuse, wait, or stop and clean up) and asks for a way to delete a message that will never finish. Refusing is this draft's choice. The issue also asks that rows already left behind are found and pruned, a one-time repair that is not a row.
- MSG-RET-03: source: docs/user/capabilities.md "Prune old messages on a schedule" (Yes, off by default per channel); D-106, D-107. Conflict: the code prunes a channel with pruning on and no age at 30 days, which no document states; D-301 keeps the age for a person to turn on. D-301's intent kept.
- MSG-RET-04: source: D-209.
- MSG-RET-05: source: D-209 ("A channel that fails to prune is reported and the run carries on with the others").
- MSG-RET-06: source: ROADMAP N8 (content/metadata-day split); D-301 (Mirth prunes content only and keeps errored messages by default); docs/research/voice-of-user/ranking.md MSG4 (keep-errored retention).
- MSG-RET-07: source: ROADMAP N8; docs/user/capabilities.md "Archive messages before pruning" (No); docs/design/13-non-connector-gap-analysis.md "archive-then-prune".
- MSG-RET-08: source: D-090 as refined by the content rules in D-325 (a message counts as delivered only when every connector is SENT or FILTERED).
- MSG-RET-09: source: issue #202 (an open choice: mark them as deleted or hide them); docs/user/access-control.md `channels:delete` ("Deleting hides the channel; its messages are kept"). Conflict: D-052 drops a channel's messages when it is deleted; access-control.md and the code keep them, kept here. Pruning on, and removing them all, are this draft's: today nothing removes them.
