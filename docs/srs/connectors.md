# Connectors

What a channel's source and destinations guarantee to the partner system on the other end, first for every connector and then for each protocol. Area code `CONN`. A protocol sub-area holds only what is particular to that protocol: the rules in SRC, DST and CFG hold for every connector, the missing protocols in NEW and third-party connectors included. Left to other areas: the message model, queues and retries (PIPE), reading and writing formats (DATA), TLS, certificates, stored credentials, the folders a connector may use and the addresses a Test Connection may reach (SEC), deploy validation (CHAN), connection status on the dashboard (MON), Mirth import mapping (MIG), and the code contract ([interfaces/connector.md](interfaces/connector.md)). "Recorded" means the message is in the product's message store, with or without an error.

## Guarantees every source gives (SRC)

| ID | Requirement | Pri | Verify | Status |
|---|---|---|---|---|
| CONN-SRC-01 | A source shall tell its partner that a message is accepted (a positive acknowledgement or answer, a deleted, moved or marked input, a committed offset, a broker acknowledgement) only after the message is recorded, except as CONN-DCM-12 says for DICOM; a message the channel then filters out counts as accepted. | P1 | Test | Proposed |
| CONN-SRC-02 | When a message, or any message of a split batch, is recorded with an error that the channel's response mode reports to the sender, its source shall answer a sender that waits for an answer with a failure, and shall leave a file or an email where it is, neither deleted, moved nor marked as read. | P1 | Test | Proposed |
| CONN-SRC-03 | An input whose message could not be recorded shall be refused to a sender that waits for an answer, and otherwise stay with the partner system unacknowledged and unchanged and be taken again at the next poll, redelivery or start; a server crash before the message is recorded shall have the same outcome. | P1 | Test | Proposed |
| CONN-SRC-04 | A source shall not make a second message from an input whose message is recorded, also when that message ended in error or the after-processing action failed, and also after a restart, unless the input has changed, the channel is set to leave its inputs in place, or the server stopped between recording the message and marking the input. | P1 | Test | Proposed |
| CONN-SRC-05 | A source that reads text shall never store a message in which bytes it could not read in its character set were replaced or dropped without saying so: it shall refuse the input when a sender waits for the answer, unless CONN-SRC-12 applies, and otherwise store the message marked with the fault and log a warning that holds none of the content. | P1 | Test | Proposed |
| CONN-SRC-06 | A source that listens for connections shall refuse a message larger than its limit, 50 MiB unless set otherwise, measured as received and again after decompression, and shall store nothing of it. | P1 | Test | Proposed |
| CONN-SRC-07 | When a source loses its partner or a poll fails, it shall log the cause, raise a source error that an alert can act on, and try again at every poll, or at least every 10 seconds when it does not poll, without an operator, until it succeeds or the channel is stopped. | P1 | Test | Proposed |
| CONN-SRC-08 | When a channel is stopped or paused, its source shall take no new message from that moment, and shall either finish and answer each message already being processed or leave it unacknowledged, so that its sender keeps it. | P1 | Test | Proposed |
| CONN-SRC-09 | A source that polls shall be able to poll at set times of day, by a cron expression, and only within chosen days and hours, as well as at an interval. | P2 | Test | Proposed |
| CONN-SRC-10 | When a source cannot reach its partner at its start, loses it later, or fails a poll, it shall log the cause, raise a source error that an alert can act on, and try again at every poll, or at least every 10 seconds when it does not poll, without an operator, until it succeeds or the channel is stopped. | P1 | Test | Proposed |
| CONN-SRC-11 | The TCP/MLLP, HTTP and FHIR sources shall refuse a message over their limit, 50 MiB unless set otherwise, measured as received and, for HTTP and FHIR, again after decompression, and shall store nothing of it. | P1 | Test | Proposed |
| CONN-SRC-12 | A channel shall be able to set a listening source that reads text to store a message it cannot fully decode, marked with the fault and with its received bytes kept, instead of refusing it. | P2 | Test | Proposed |
| CONN-SRC-13 | When a channel is stopped or paused, its source shall take no new message from that moment and shall finish and answer every message already recorded; only a halt, a crash or a server stop that reached its limit (OPS-RUN-05) may leave one unanswered. | P1 | Test | Proposed |
| CONN-SRC-14 | A source shall have a setting, on for a channel imported from Mirth with one processing thread, that processes messages from all its connections one at a time in the order recorded. | P1 | Test | Proposed |
| CONN-SRC-15 | When a message, or a batch as PIPE-BAT-02 says, is recorded with an error that the channel's response mode reports to the sender, its source shall answer a sender that waits for an answer with a failure, and shall leave a file or an email where it is and unmarked, unless CONN-FILE-09 applies. | P1 | Test | Proposed |
| CONN-SRC-16 | An operator shall be able to list the inputs a polling source holds back, with the reason, and release one to be read again. | P2 | Test | Proposed |
| CONN-SRC-17 | A source shall mark a message as a possible duplicate, naming the earlier one, when it takes again an input that a server stop left recorded but unmarked. | P2 | Test | Proposed |
| CONN-SRC-18 | A source that polls shall be able to poll at an interval, by a cron expression, and only within chosen days and hours, in a time zone set on the channel. | P2 | Test | Proposed |

- CONN-SRC-01: source: docs/user/connector-reference.md "KAFKA: what it does", "AMQP: what it does", "HTTP: what it does"; D-211, D-231, D-266. conflict: connector-reference "DATABASE as a source" offers `updateMode` `ALWAYS`, and `packages/connectors/src/database/database-receiver.ts` then marks a row whose message was not recorded; D-211 says a database row is kept on failure. The general rule is kept, so `ALWAYS` either loses that meaning or becomes a written exception.
- CONN-SRC-02: source: D-211 (one rule for what a source tells its sender), D-254 (a split batch answers failure if any message failed), D-255 ("Before processing" answers acceptance whatever fails later); docs/user/connector-reference.md "SFTP: what it does". A database row and a broker message recorded with an error are settled so they are not read again (D-231, D-266), which is CONN-SRC-04.
- CONN-SRC-03: source: D-211, D-266; AGENTS.md "Data integrity is non-negotiable". A JavaScript source has no partner to keep its input; CONN-JS-01 covers it.
- CONN-SRC-04: source: D-158, D-168 (file and SFTP quarantine survives a restart), D-195 (email), D-216, D-231, D-266 (a Kafka record stored with an error is committed, an AMQP message is rejected without requeue, to the dead-letter exchange if there is one); docs/user/connector-reference.md "SFTP: what it does". The email source keeps it as a keyword on the mail server (D-382).
- CONN-SRC-05: source: D-270, D-334, #335, #87, #369; AGENTS.md "Data integrity is non-negotiable". conflict: D-270 stores an invalid Kafka or AMQP payload flagged, D-334 refuses an invalid HTTP body; both kept, split by whether a sender waits. The TCP/MLLP, File and SFTP sources replace invalid bytes with no mark (`tcp-mllp/`, `file/file-receiver.ts`, `sftp/sftp-receiver.ts` under `packages/connectors/src`), which no issue tracks.
- CONN-SRC-06: source: D-139, D-334; docs/user/connector-reference.md `maxFrameBytes`, `maxBodyBytes`. No source gives a figure for DICOM.
- CONN-SRC-07: source: D-137, D-266; ROADMAP N10 and V15; AGENTS.md "Fail safe, not silent". Today a failed poll is logged and retried (SFTP, email, Kafka and AMQP reconnect by themselves), and raises one alert for the outage (D-391); a source that stops itself raises one too (D-271). The 10 seconds is assumed; the code waits 5.
- CONN-SRC-08: source: D-341 (HTTP), D-342; docs/user/connector-reference.md "HTTP: what it does"; `packages/connectors/src/tcp-mllp/tcp-mllp-receiver.ts`. The HTTP source waits for the pipeline without a limit, the MLLP source 5 seconds, after which it closes unacknowledged; the row allows both.
- CONN-SRC-09: source: docs/design/03-connectors.md "Polling Scheduler" (interval, time, cron); docs/user/capabilities.md "Polling by time of day or cron, or on some days or hours only"; D-301; docs/design/18-voice-of-the-user.md CON14.
- CONN-SRC-10: source: srs-debate 2026-11-24, finding C5 (Customer 1, Scope). Replaces CONN-SRC-07: when this row is accepted, that row becomes Superseded by CONN-SRC-10.
- CONN-SRC-11: source: srs-debate 2026-11-24, finding C9 (Tester 6, Contractor 8). Replaces CONN-SRC-06: when this row is accepted, that row becomes Superseded by CONN-SRC-11.
- CONN-SRC-12: source: srs-debate 2026-11-24, finding C15 (Customer 4; Scope keeps).
- CONN-SRC-13: source: srs-debate 2026-11-24, finding C17 (Domain 2; Contractor, Customer, Scope agree). D-341 kept over the 5 and 30 second drains of MLLP, Kafka and AMQP. Decision D-C6. Replaces CONN-SRC-08: when this row is accepted, that row becomes Superseded by CONN-SRC-13.
- CONN-SRC-14: source: srs-debate 2026-11-24, finding C23 (Domain 9; Customer 8 and Tester would make it the default; Contractor and Scope against a default, because one slow partner would stall every HTTP caller). Decision D-C7.
- CONN-SRC-15: source: srs-debate 2026-11-24, finding C25 (Customer 9, Scope 7). Replaces CONN-SRC-02: when this row is accepted, that row becomes Superseded by CONN-SRC-15.
- CONN-SRC-16: source: srs-debate 2026-11-24, finding C25 (Customer 9; Scope would cut it). Decision D-C8.
- CONN-SRC-17: source: srs-debate 2026-11-24, finding C26 (Domain 4, bounded by Tester; Scope keeps at P2).
- CONN-SRC-18: source: srs-debate 2026-11-24, finding C38 (Contractor). Replaces CONN-SRC-09: when this row is accepted, that row becomes Superseded by CONN-SRC-18.

## Guarantees every destination gives (DST)

| ID | Requirement | Pri | Verify | Status |
|---|---|---|---|---|
| CONN-DST-01 | A destination shall record a message as SENT only when its partner has confirmed it at the level its protocol defines: an HL7 acceptance, an HTTP success status, a C-STORE success or warning status, a broker confirmation, a mail server's acceptance, a completed statement or file write, a target channel that recorded the message without an error, or a script that ended without an error. | P1 | Test | Proposed |
| CONN-DST-02 | Every send shall end within the time limit set on its destination, 30 seconds unless set otherwise and never more than 5 minutes, and a send with no confirmation by then shall be recorded as an error with that reason. | P1 | Test | Proposed |
| CONN-DST-03 | An HTTP or FHIR destination shall never follow a redirect: it shall send nothing to the new address, and shall record an error that names it. | P1 | Test | Proposed |
| CONN-DST-04 | A destination shall fill each `${name}` in its URL, query parameters, headers, email fields, topic, key, routing key, target channel, query and template from the variables of the message being sent, and shall not read a filled-in value for further placeholders. | P1 | Test | Proposed |
| CONN-DST-05 | A destination shall send nothing, and record an error that names the variable, when a setting that decides where the message goes, or a value bound into a database statement, names a variable the message does not hold. | P1 | Test | Proposed |
| CONN-DST-06 | A destination shall fail the send, and say so, rather than write a message that holds a character its character set does not have. | P1 | Test | Proposed |
| CONN-DST-07 | A halt shall end, within 10 seconds and whether or not the partner answers, every connection attempt, wait and cancellable send of the channel's connectors, and shall leave each message it cut off to be sent after the next start instead of marking it failed. | P1 | Test | Proposed |
| CONN-DST-08 | An HL7 negative acknowledgement, or one for another control ID, shall end its message in error without queuing it, unless the destination is set to retry refusals. | P1 | Test | Proposed |
| CONN-DST-09 | After a send its partner accepted in part, the system shall record the message as an error in every queue mode and shall not send it again unless a person resends it. | P1 | Test | Proposed |
| CONN-DST-10 | A destination shall record a message as SENT only when its partner has confirmed it at the level its protocol defines: an HL7 acceptance, an HTTP success status or one CONN-HTTP-07 names, a C-STORE success or warning status, a broker confirmation, a mail server's acceptance, a completed statement or file write, a target channel that recorded the message without an error, or a script that ended without an error; the one exception is CONN-TCP-08. | P1 | Test | Proposed |
| CONN-DST-11 | A halt shall end, within 10 seconds and whether or not the partner answers, every connection attempt, wait and send of the channel's connectors, except a database statement, file write, DICOM send, script or send to another channel already begun; PIPE-LIF-02 says what becomes of the message. | P1 | Test | Proposed |
| CONN-DST-12 | Every destination shall have a send time limit, 30 seconds unless set otherwise and at most 5 minutes, enforced as PIPE-RTE-05 says. | P1 | Test | Proposed |

- CONN-DST-01: source: docs/user/connector-reference.md "what it does" of each type; D-136, D-227, D-231, D-266. From reading `packages/connectors/src/dicom/dcmjs-dimse-adapter.ts`, the DICOM Sender does not read the C-STORE status (CONN-DCM-04).
- CONN-DST-02: source: D-212 (a five-minute limit behind each connector's own); docs/user/connector-reference.md `responseTimeout`, `timeout`, "A send that takes over 30 seconds is an ERROR"; docs/standards/CodingStandard.md as summarised in AGENTS.md "All async operations need timeouts". A file write and a send to another channel have no limit of their own.
- CONN-DST-03: source: D-227; docs/user/connector-reference.md "HTTP limits", "FHIR: what it does"; #163.
- CONN-DST-04: source: D-246, D-247, D-252, D-275; docs/user/connector-reference.md "Every destination".
- CONN-DST-05: source: docs/user/connector-reference.md `targetChannelId`, Kafka `topic`; D-252; #390 (NULL written and read as SENT). conflict: D-252 and D-275 leave an unknown name as written in an HTTP URL and an email address, and `packages/connectors/src/database/query-builder.ts` binds NULL; the stricter rule D-252 itself sets for a target channel is kept for all three.
- CONN-DST-06: source: AGENTS.md "Data integrity is non-negotiable"; D-219 (a character set that cannot be used refuses to deploy), D-334. The per-character case is from code only: the File and TCP/MLLP destinations write Latin-1 and ASCII through an encoder that changes other characters without an error.
- CONN-DST-07: source: D-342, #377; docs/user/connector-reference.md TCP_MLLP `acquireTimeoutMs`; docs/design/18-voice-of-the-user.md CON18. The 10 seconds is D-342's wait for a stop that is ending. D-342 lets a database query, file write, DICOM send, script and send to another channel run to their end.
- CONN-DST-08: source: srs-debate 2026-11-24, finding C1 (Domain 1; Contractor, Customer and Scope agree). Mirth ends a refusal in error and goes on, and queues only missing or unreadable answers. conflict: D-210 and PIPE-QUE-01 queue any failed send; parity kept. Decision D-C1.
- CONN-DST-09: source: srs-debate 2026-11-24, finding C2 (Contractor 1, Domain 1, Tester, Scope; Customer would retry the refused parts). Decision D-C2.
- CONN-DST-10: source: srs-debate 2026-11-24, finding C7 (Contractor 6, Customer 5, Tester 4). Replaces CONN-DST-01: when this row is accepted, that row becomes Superseded by CONN-DST-10.
- CONN-DST-11: source: srs-debate 2026-11-24, finding C8 (Tester 3; Contractor 7, Domain 7, Scope 2 on PIPE-LIF-02). Replaces CONN-DST-07: when this row is accepted, that row becomes Superseded by CONN-DST-11.
- CONN-DST-12: source: srs-debate 2026-11-24, finding C18 (Scope 3). Replaces CONN-DST-02: when this row is accepted, that row becomes Superseded by CONN-DST-12.

## Configuration and Test Connection (CFG)

| ID | Requirement | Pri | Verify | Status |
|---|---|---|---|---|
| CONN-CFG-01 | Test Connection shall, for every connector type and direction that has an outside partner or folder, connect with the address, credentials, TLS settings and configuration map references a deploy would use, and shall within 10 seconds report success with the time taken or the reason it failed. | P2 | Test | Proposed |
| CONN-CFG-02 | Test Connection shall send no message, take, change or remove no message, file or row at the partner, and create nothing there. | P1 | Test | Proposed |

- CONN-CFG-01: source: D-127, D-262, D-277; #133 (configurations that pass Test Connection and fail later). Today the TCP/MLLP, DICOM and email tests open a TCP connection only (`packages/server/src/services/connection-test.service.ts`), and references are not resolved (D-276).
- CONN-CFG-02: source: D-127 and docs/user/connector-reference.md "AMQP: what it does" (nothing is declared at the broker); `packages/server/src/services/connection-test.service.ts`. No source states it as a rule; it is what the testers do.

## TCP/MLLP (TCP)

| ID | Requirement | Pri | Verify | Status |
|---|---|---|---|---|
| CONN-TCP-01 | The TCP/MLLP source shall find every framed message in the bytes it receives however the network splits or joins them, and shall process the messages of one connection one at a time and answer them in the order received. | P1 | Test | Proposed |
| CONN-TCP-02 | In automatic acknowledgement mode the TCP/MLLP source shall answer every complete frame, one it cannot read as HL7 included, with MSA-1 `AA` when the message was accepted or filtered and `AE` when it was not, and never with `AR`. | P1 | Test | Proposed |
| CONN-TCP-03 | The TCP/MLLP destination shall accept only an acknowledgement with a segment named `MSA` whose MSA-1, up to its first component and in either case, is `AA` or `CA`, and whose MSA-2 is empty, equals the MSH-10 it sent or that field's first component, or is any value when the message it sent has no MSH-10; any other answer, an unreadable one, or a connection closed before one shall be recorded as an error with the code and text received. | P1 | Test | Proposed |
| CONN-TCP-04 | The TCP/MLLP connector shall let a channel set the bytes that start and end a message, in hexadecimal and of any length, for what it receives, sends and answers; with none set it shall use MLLP's. | P1 | Test | Proposed |
| CONN-TCP-05 | While its partner refuses connections, the TCP/MLLP destination shall wait 1 second after each failed attempt of a connection, or a quarter of its connection wait time when that is shorter, and shall log the outage once until the partner is reached again. | P1 | Test | Proposed |
| CONN-TCP-06 | The TCP/MLLP destination shall have a setting, off by default, that connects when the channel starts, keeps the connection open while idle for any length of time, and reconnects when it drops. | P2 | Test | Proposed |
| CONN-TCP-07 | The TCP/MLLP source shall close a connection that has been idle for a time set on the channel, 300 seconds by default or never, and shall detect a partner that has vanished without closing also when it is set to never. | P2 | Test | Proposed |
| CONN-TCP-08 | The TCP/MLLP destination shall have a setting, off by default, that waits for no acknowledgement, and shall then show a message whose bytes were all written as sent without confirmation. | P1 | Test | Proposed |
| CONN-TCP-09 | In automatic acknowledgement mode the TCP/MLLP source shall answer every complete frame, one it cannot read as HL7 included, with MSA-1 `AA` when the message was accepted or filtered and `AE` when it was not, or with the codes the channel sets for accepted, filtered and failed. | P1 | Test | Proposed |
| CONN-TCP-10 | The TCP/MLLP source shall close a connection that has been idle for a time set on the channel, and never for idleness when none is set. | P1 | Test | Proposed |
| CONN-TCP-11 | The TCP/MLLP source shall close, within 10 minutes, a connection whose partner vanished without closing it. | P1 | Test | Proposed |
| CONN-TCP-12 | The TCP/MLLP source and destination shall be able to run over TLS, and to require and present a certificate on both sides. | P1 | Test | Proposed |

- CONN-TCP-01: source: docs/user/connector-reference.md "TCP_MLLP: what it does"; D-024; docs/design/12-connector-parity-gap-analysis.md "Split-packet / multi-msg-per-chunk resync".
- CONN-TCP-02: source: docs/user/connector-reference.md "TCP_MLLP: what it does"; D-134, D-231. conflict: D-135 answers `AR` for a filtered message, D-231 `AA`; the later decision kept. What the acknowledgement contains is DATA-ACK-01 and DATA-ACK-02.
- CONN-TCP-03: source: docs/user/connector-reference.md "TCP_MLLP: what it does"; D-136, D-220, D-292; D-394 (refuse only what cannot be an accept, #414).
- CONN-TCP-04: source: D-253; docs/user/connector-reference.md `frameStart`, `frameEnd`; docs/design/12-connector-parity-gap-analysis.md rank 3. The start may be empty, the end may not. The editor has no field (ROADMAP "Editor controls").
- CONN-TCP-05: source: D-336, #352; docs/user/connector-reference.md `acquireTimeoutMs`.
- CONN-TCP-06: source: #311. The issue also wants reconnect backoff and the state on the dashboard (MON-CST-01).
- CONN-TCP-07: source: #311 "In scope: the receiver's idle timeout".
- CONN-TCP-08: source: srs-debate 2026-11-24, finding C19 (Customer 5; Domain and Scope keep). Mirth's "Ignore Response"; doc 12.
- CONN-TCP-09: source: srs-debate 2026-11-24, finding C20 (Customer 6, Domain 8). Mirth answers a filtered message `AR` by default and its codes are configurable; MIG-SET-01 imports them. Replaces CONN-TCP-02: when this row is accepted, that row becomes Superseded by CONN-TCP-09.
- CONN-TCP-10: source: srs-debate 2026-11-24, finding C21 (Customer 7; Domain and Scope agree). Mirth's default is never. Replaces CONN-TCP-07: when this row is accepted, that row becomes Superseded by CONN-TCP-10.
- CONN-TCP-11: source: srs-debate 2026-11-24, finding C21 (Customer 7; Scope keeps). The other half of CONN-TCP-07.
- CONN-TCP-12: source: srs-debate 2026-11-24, finding C22 (Customer 10; Scope keeps).

## HTTP (HTTP)

| ID | Requirement | Pri | Verify | Status |
|---|---|---|---|---|
| CONN-HTTP-01 | The HTTP source shall make a message only of a request that has its method and its path, or, when so set, a path below it, and shall refuse every other request and store nothing of it. | P1 | Test | Proposed |
| CONN-HTTP-02 | The HTTP source shall decompress a `gzip`, `deflate` or `br` body, and shall refuse, storing nothing, any other content coding, two codings on one body, a body that does not decompress, or one with bytes after the compressed data. | P1 | Test | Proposed |
| CONN-HTTP-03 | An HTTP source with Basic or bearer-token sign-in set shall refuse a request without the matching credentials and store nothing of it. | P1 | Test | Proposed |
| CONN-HTTP-04 | The HTTP source shall keep no credential a sender presented: the values of the Authorization, Proxy-Authorization, Cookie and X-API-Key headers shall be replaced by a marker before the request's headers are stored with the message. | P1 | Test | Proposed |
| CONN-HTTP-05 | The HTTP destination shall sign in with Basic or Digest authentication when set to. | P2 | Test | Proposed |
| CONN-HTTP-06 | The HTTP destination shall give the response transformer the response's status and headers as well as its body. | P2 | Test | Proposed |
| CONN-HTTP-07 | An HTTP destination shall let a channel name further status codes, other than redirects, that count as sent, for example the one its partner answers when it already has the message. | P2 | Test | Proposed |
| CONN-HTTP-08 | One HTTP source shall accept a chosen set of methods on its port, and tell the channel which one each request used. | P2 | Test | Proposed |
| CONN-HTTP-09 | A channel script shall be able to set the status code and headers of the HTTP source's answer to the request it is processing. | P2 | Test | Proposed |

- CONN-HTTP-01: source: docs/user/connector-reference.md "HTTP: what it does", `matchSubpaths`; D-243.
- CONN-HTTP-02: source: D-334, #335; docs/user/connector-reference.md "HTTP: what it does". That page also limits what decompression may use across requests; CONN-SRC-11 holds the size limit.
- CONN-HTTP-03: source: docs/user/connector-reference.md `auth.type`; D-274; #207 (a guard missing a credential refuses to deploy).
- CONN-HTTP-04: source: D-221.
- CONN-HTTP-05: source: docs/user/capabilities.md "Receive and send over HTTP", "HTTP Sender Digest authentication" (No); D-252; ROADMAP connector gap 5.
- CONN-HTTP-06: source: #342 step 1; ROADMAP V11.
- CONN-HTTP-07: source: #342 step 1; ROADMAP V11. D-227 keeps redirects out of the list.
- CONN-HTTP-08: source: #342 step 2; docs/user/connector-reference.md "HTTP limits".
- CONN-HTTP-09: source: #342 step 2.

## Files, local and shared rules (FILE)

| ID | Requirement | Pri | Verify | Status |
|---|---|---|---|---|
| CONN-FILE-01 | A File or SFTP source shall never read, move or delete a file whose name does not match its pattern, compared case-sensitively on every platform, a file whose name starts with a dot unless set to, a folder or a link, or, for File, a name ending in `.ignore` or a file beside which `<name>.ignore` exists. | P1 | Test | Proposed |
| CONN-FILE-02 | A File or SFTP source shall not read a file that was changed less than its minimum age ago, 1 second unless set otherwise. | P1 | Test | Proposed |
| CONN-FILE-03 | A File or SFTP destination that is not appending shall put a finished file in place under its final name in one step, unless set otherwise, so that a partner never reads half a file. | P1 | Test | Proposed |
| CONN-FILE-04 | A File or SFTP destination whose file name pattern holds a placeholder it cannot fill shall refuse to deploy and name the placeholder. | P1 | Test | Proposed |
| CONN-FILE-05 | A File or SFTP destination shall be able to use in its file name the name of the file the message came from. | P1 | Test | Proposed |
| CONN-FILE-06 | A File or SFTP destination shall have a setting that fails the send, and changes nothing, when a file of that name already exists. | P2 | Test | Proposed |
| CONN-FILE-07 | A File or SFTP source shall be able to choose files by a regular expression as well as by a `*` and `?` pattern. | P2 | Test | Proposed |
| CONN-FILE-08 | A File or SFTP source shall delete, move or leave each file whose message is recorded without an error, as set. | P1 | Test | Proposed |
| CONN-FILE-09 | A File or SFTP source shall be able to move a file whose message is recorded with an error to a folder set for failures. | P2 | Test | Proposed |
| CONN-FILE-10 | A File or SFTP destination whose append fails shall restore the file's earlier length, or end the message in error, unqueued, naming the file. | P1 | Test | Proposed |

- CONN-FILE-01: source: D-304, D-315 (links are skipped); docs/user/connector-reference.md "FILE: what it does", `fileFilter`, `ignoreDot`. Which folders a File connector may use is SEC-PRV-02.
- CONN-FILE-02: source: docs/user/connector-reference.md `checkFileAge`, `fileAgeMs`, `minFileAgeMs`.
- CONN-FILE-03: source: docs/user/connector-reference.md "FILE security", `tempFileEnabled`; docs/design/12-connector-parity-gap-analysis.md "Temp-file-then-rename". The SFTP destination writes under the final name (`packages/connectors/src/sftp/sftp-dispatcher.ts`), so the SFTP half is from code only.
- CONN-FILE-04: source: D-219; docs/user/connector-reference.md `outputPattern`, `fileNameTemplate`.
- CONN-FILE-05: source: D-219; ROADMAP "`${originalFilename}` for file and SFTP destinations"; docs/user/connector-reference.md "FILE limits", "SFTP limits"; docs/design/18-voice-of-the-user.md CON7.
- CONN-FILE-06: source: D-301 (a channel whose Writer must not overwrite is imported disabled, because there is no such check); docs/design/12-connector-parity-gap-analysis.md `errorOnExists`.
- CONN-FILE-07: source: docs/user/capabilities.md "File Reader and Writer, file scheme" (warned at import, as are subfolders, a size range and a rename on move, which have no row); docs/design/12-connector-parity-gap-analysis.md section 2.2.
- CONN-FILE-08: source: srs-debate 2026-11-24, finding C25 (Customer 9; Scope keeps).
- CONN-FILE-09: source: srs-debate 2026-11-24, finding C25 (Customer 9 at P1; Scope at P2). Mirth has an error folder; the importer warns today.
- CONN-FILE-10: source: srs-debate 2026-11-24, finding C29 (Domain 10, reworded by Tester; Scope cut the "until a person clears it" clause).

## SFTP (SFTP)

| ID | Requirement | Pri | Verify | Status |
|---|---|---|---|---|
| CONN-SFTP-01 | An SFTP connector shall connect only to a server whose host key equals the one set on the channel, and shall refuse to deploy with no key set, unless the channel turns that check off; the check is on by default. | P1 | Test | Proposed |

- CONN-SFTP-01: source: docs/user/connector-reference.md "SFTP security", `strictHostKey`, `hostKey`. conflict: D-169 has the check off by default; the reference and the current schema have it on, kept.

## Database (DB)

| ID | Requirement | Pri | Verify | Status |
|---|---|---|---|---|
| CONN-DB-01 | The Database source shall read PostgreSQL, MySQL and MariaDB and make one JSON message of each row its query returns, and the Database destination shall run its statement on them once for each message. | P1 | Test | Proposed |
| CONN-DB-02 | The Database source shall give every column's value as the database holds it: no integer or decimal shall lose a digit, and no date or time shall change its day, its time of day or its time zone. | P1 | Test | Proposed |
| CONN-DB-03 | Two sources that mark the rows they read shall not both take the same row when they poll the same table, on one server or on two. | P1 | Test | Proposed |
| CONN-DB-04 | A Database source that marks rows shall mark each row whose message is recorded, also when marking another row fails or the poll's transaction is rolled back. | P1 | Test | Proposed |
| CONN-DB-05 | A value from a message shall reach a database only as a bound parameter and never as part of the statement's text. | P1 | Test | Proposed |
| CONN-DB-06 | When the system gives up on a database statement, the statement shall be ended at the database too, so that it cannot take effect after its message is sent again. | P1 | Test | Proposed |

- CONN-DB-01: source: docs/user/capabilities.md "Read and write PostgreSQL", "Read and write MySQL/MariaDB" (Partial: no CI test against a real server); D-182 (JSON only), D-259. SQL Server and Oracle are CONN-NEW-05 and CONN-NEW-06.
- CONN-DB-02: source: D-259 ("MySQL values stay exact"), D-208 (values are never converted because of what they look like), D-182 (the same row shape for every vendor). PostgreSQL columns go through the driver's default conversion (`packages/connectors/src/database/connection-pool.ts`), which reads a date in the server's time zone.
- CONN-DB-03: source: D-157; docs/design/12-connector-parity-gap-analysis.md "Concurrent-safe claim". A query the database cannot lock (a join, a grouping) fails the poll rather than reading without the lock.
- CONN-DB-04: source: D-216 (each row in its own savepoint), D-259 (rows dispatched before a failed transaction are marked again, not sent again).
- CONN-DB-05: source: docs/user/connector-reference.md "DATABASE: what it does"; AGENTS.md "No raw SQL".
- CONN-DB-06: source: D-259 (the server's limit is 5 seconds below the client's on MySQL). On PostgreSQL both limits are 30 seconds.

## JavaScript (JS)

| ID | Requirement | Pri | Verify | Status |
|---|---|---|---|---|
| CONN-JS-01 | Every value a JavaScript source's script returns, apart from nothing or empty text, shall become a message or raise a source error that an alert can act on, whether the value is not text or its message could not be recorded. | P1 | Test | Proposed |

- CONN-JS-01: source: docs/user/connector-reference.md "JAVASCRIPT: what it does"; AGENTS.md "Messages must never be silently lost". From code (`packages/connectors/src/javascript/javascript-receiver.ts`): an array item that is not text is dropped with no log line, and a message that could not be recorded is only logged.

## Channel (CHN)

| ID | Requirement | Pri | Verify | Status |
|---|---|---|---|---|
| CONN-CHN-01 | A Channel destination shall hand its message to another channel on the same server, and shall record an error when that channel is not running or records the message with an error. | P1 | Test | Proposed |
| CONN-CHN-02 | A Channel destination shall refuse, and record as an error, a message that has already passed through 10 channel hops, so that a routing loop ends. | P1 | Test | Proposed |

- CONN-CHN-01: source: docs/user/connector-reference.md "CHANNEL: what it does"; D-231. Double delivery after a server stop during a hand-off is #401 (PIPE).
- CONN-CHN-02: source: docs/user/connector-reference.md "CHANNEL: what it does", "CHANNEL limits".

## SMTP (SMTP)

| ID | Requirement | Pri | Verify | Status |
|---|---|---|---|---|
| CONN-SMTP-01 | The SMTP destination shall record a message as SENT only when the mail server accepted it for every recipient, and shall otherwise record an error that names the recipients refused and the recipients accepted. | P1 | Test | Proposed |

- CONN-SMTP-01: source: `packages/connectors/src/smtp/smtp-dispatcher.ts` (an error when every recipient is refused; SENT with a count when some are), so the all-refused half is from code only; interfaces/connector.md CPI-DST-02 (a part refused is an error). CONN-DST-09 keeps it from being sent again.

## Email (EML)

| ID | Requirement | Pri | Verify | Status |
|---|---|---|---|---|
| CONN-EML-01 | The Email source shall make one message of each unread email in its IMAP folder that its subject filter lets through, and then mark it read, delete it or move it as set; when that action fails it shall retry only the action, also after a restart. | P1 | Test | Proposed |
| CONN-EML-02 | The Email source shall store the email byte for byte as the mail server holds it, attachments included, and shall report with the message how many attachments it has. | P2 | Test | Proposed |

- CONN-EML-01: source: docs/user/connector-reference.md "EMAIL: what it does"; D-195. A mailbox that refuses custom keywords can have an email delivered twice after a restart; that is logged.
- CONN-EML-02: source: #369 (what the content should be is undecided); docs/user/capabilities.md "Read email over IMAP". Bytes that are not UTF-8 are replaced today, which is also CONN-SRC-05.

## FHIR (FHIR)

| ID | Requirement | Pri | Verify | Status |
|---|---|---|---|---|
| CONN-FHIR-01 | The FHIR destination shall create or update an R4 resource, in JSON or XML, at the address its own type and, for an update, its ID give, and shall record an error and send nothing when the type is missing, or the ID is missing or not a valid FHIR ID. | P1 | Test | Proposed |
| CONN-FHIR-02 | The FHIR destination shall send a transaction or batch Bundle to the server's base address, and shall record an error that names the entry when an entry of a batch fails. | P2 | Test | Proposed |
| CONN-FHIR-03 | The FHIR destination shall be able to create and update conditionally, so that a create sent again after its answer was lost leaves one resource. | P2 | Test | Proposed |
| CONN-FHIR-04 | A FHIR source shall accept creates, updates and transaction Bundles of chosen R4 resource types over HTTPS, and shall answer each, refusals included, with the status FHIR defines and, for an error, an OperationOutcome. | P2 | Test | Proposed |
| CONN-FHIR-05 | A FHIR source shall make one message of each create, update or transaction Bundle of chosen R4 resource types received over HTTPS, answer it in FHIR's form, errors as an OperationOutcome, and answer no read or search. | P2 | Test | Proposed |

- CONN-FHIR-01: source: docs/user/connector-reference.md "FHIR: what it does", `method`; #349 step 1. conflict: the reference takes the type from a setting that defaults to Patient; #349 wants it per message, kept.
- CONN-FHIR-02: source: #349 step 1 and its acceptance list.
- CONN-FHIR-03: source: #349 step 1 and its acceptance list.
- CONN-FHIR-04: source: docs/user/capabilities.md "Receive FHIR (as a source)" (No); #349 step 3; ROADMAP V12. It receives messages and is not a FHIR server (README Out of scope).
- CONN-FHIR-05: source: srs-debate 2026-11-24, finding C37 (Scope 12). Replaces CONN-FHIR-04: when this row is accepted, that row becomes Superseded by CONN-FHIR-05.

## DICOM (DCM)

| ID | Requirement | Pri | Verify | Status |
|---|---|---|---|---|
| CONN-DCM-01 | The DICOM source shall accept C-ECHO, and C-STORE for every storage SOP class of the DICOM standard in the Implicit, Explicit and Deflated VR, RLE, JPEG, JPEG-LS and JPEG 2000 transfer syntaxes, and shall reject only the presentation contexts it does not support. | P1 | Test | Proposed |
| CONN-DCM-02 | The DICOM source shall answer a C-STORE with success only after the whole instance is on disk, and shall record a message for every instance it so answered, also when the channel stops or the server crashes in between. | P1 | Test | Proposed |
| CONN-DCM-03 | The DICOM source shall keep the file a message names, unchanged and not overwritten by a later copy of the same instance, until every destination has delivered the message, queued ones included, and shall keep it when one fails. | P1 | Test | Proposed |
| CONN-DCM-04 | The DICOM destination shall record a message as SENT only when the receiver answered the C-STORE of every instance in it with a success or warning status, and shall record an error for a failure status, a rejected association or presentation context, or an association that ends before the answer. | P1 | Test | Proposed |
| CONN-DCM-05 | An instance the DICOM source stores and the DICOM destination sends on shall have every attribute value, private attributes included, and the pixel data that the sender sent. | P1 | Test | Proposed |
| CONN-DCM-06 | The DICOM source and destination shall be able to run over TLS, and to require and present a certificate on both sides. | P2 | Test | Proposed |
| CONN-DCM-07 | The DICOM source shall be able to accept only associations from a list of calling AE titles and addressed to its own AE title, and shall reject any other association before it stores anything. | P2 | Test | Proposed |
| CONN-DCM-08 | The DICOM source shall answer a modality worklist query from entries that channels add, change and remove, matching on scheduled date, modality, station AE title, patient ID and accession number, with wildcards. | P3 | Test | Proposed |
| CONN-DCM-09 | A DICOM connector's log lines shall hold no SOP Instance UID or other identifier taken from an instance. | P2 | Test | Proposed |
| CONN-DCM-10 | The DICOM source shall refuse an instance larger than its limit, 4 GiB unless set otherwise, and shall keep nothing of it. | P1 | Test | Proposed |
| CONN-DCM-11 | The DICOM source shall give scripts each instance's calling and called AE titles. | P1 | Test | Proposed |
| CONN-DCM-12 | The DICOM source shall answer a C-STORE with success only after the instance is flushed to storage so that it survives a power loss, and shall record one message for every instance so answered, also when the channel stops or the server process is killed in between. | P1 | Test | Proposed |

- CONN-DCM-01: source: D-088, D-181; docs/user/connector-reference.md "DICOM: what it does". The list of transfer syntaxes is from `packages/connectors/src/dicom/dcmjs-dimse-adapter.ts`.
- CONN-DCM-02: source: docs/user/connector-reference.md "DICOM: what it does"; D-211, D-325; interfaces/connector.md CPI-SRC-04. From code: success follows the file write, the message is recorded after it, and a file whose message was not recorded stays on disk with a log line and is not taken up again.
- CONN-DCM-03: source: D-325, #243; docs/user/connector-reference.md "DICOM as a source" `postAction`.
- CONN-DCM-04: source: docs/user/connector-reference.md "DICOM: what it does" ("sends with C-STORE"); D-136 (a refusal is an error for MLLP). #410 (a refused instance reads SENT today).
- CONN-DCM-05: source: AGENTS.md "Data integrity is non-negotiable". No source states it for DICOM; the receiver writes a parsed dataset back out (D-181).
- CONN-DCM-06: source: docs/user/capabilities.md "DICOM over TLS" (No); ROADMAP connector gap 8; #350 step 1. Until then a DICOM connector set to TLS refuses to deploy (D-274).
- CONN-DCM-07: source: docs/user/connector-reference.md "DICOM security"; #350 step 2. An AE title is not authentication, and the issue wants the docs to say so.
- CONN-DCM-08: source: #350 step 3; docs/design/18-voice-of-the-user.md CON12; D-088 (other services deferred). Query and retrieve and storage commitment (steps 4 and 5) have no row yet.
- CONN-DCM-09: source: #321 (undecided: keep UIDs out, or accept them); docs/srs/security.md SEC-LOG-02.
- CONN-DCM-10: source: srs-debate 2026-11-24, finding C9 (Contractor 8; Customer and Domain want a limit; Scope: the number has no source). Decision D-C3.
- CONN-DCM-11: source: srs-debate 2026-11-24, finding C32 (Customer 10, reduced by Scope; reading tags is DATA-OTH-03). Decision D-C9 asks whether DATA-OTH-03 becomes P1.
- CONN-DCM-12: source: srs-debate 2026-11-24, finding C33 (Tester 7; Contractor, Customer and Scope agree). Replaces CONN-DCM-02: when this row is accepted, that row becomes Superseded by CONN-DCM-12.

## Kafka (KFK)

| ID | Requirement | Pri | Verify | Status |
|---|---|---|---|---|
| CONN-KFK-01 | The Kafka source shall read a topic as a member of a consumer group, process the records of a partition one at a time in offset order, and continue after a restart from the group's committed offset. | P1 | Test | Proposed |
| CONN-KFK-02 | When a Kafka or AMQP source fails to record the same message a set number of times in a row (5 by default, 1 to 1,000), it shall stop the channel, record an error event and raise an alert, leave the message with the broker, and read it first when the channel is started again. | P1 | Test | Proposed |
| CONN-KFK-03 | The Kafka destination shall record a message as SENT only when every in-sync replica has the record. | P1 | Test | Proposed |
| CONN-KFK-04 | A Kafka or AMQP connector shall never create, change or delete a topic, queue or exchange, and shall fail its start, or the send, and name the one that is missing. | P1 | Test | Proposed |
| CONN-KFK-05 | A Kafka source that fails to record the same record a set number of times in a row (5 by default, 1 to 1,000), not counting failures while the message store was unreachable, shall stop its channel, raise an alert and read that record first at the next start. | P1 | Test | Proposed |
| CONN-KFK-06 | When a group's committed offset that the source has used before is gone, or its records are, the source shall stop, raise an alert naming the partition and the gap, and continue only where a person chooses. | P1 | Test | Proposed |
| CONN-KFK-07 | The Kafka destination shall record SENT only when every in-sync replica has the record, and an error when fewer are in sync than the topic requires. | P1 | Test | Proposed |

- CONN-KFK-01: source: docs/user/connector-reference.md "KAFKA: what it does", `groupId`, `startFrom`; D-266; #353. Open in ROADMAP V15: no limit of our own on joining the group, and a halt during a rejoin can leave a member behind.
- CONN-KFK-02: source: D-271, D-331, #86, #151; docs/user/connector-reference.md "KAFKA: what it does", "AMQP: what it does". On a quorum queue a message with no message ID may not be counted correctly, and the broker's own delivery limit can remove it first; both stated there.
- CONN-KFK-03: source: D-266; docs/user/connector-reference.md "KAFKA: what it does".
- CONN-KFK-04: source: D-261, D-266; docs/user/connector-reference.md "KAFKA: what it does", "AMQP: what it does".
- CONN-KFK-05: source: srs-debate 2026-11-24, finding C3 (Tester 8, Customer 2). Replaces CONN-KFK-02: when this row is accepted, that row becomes Superseded by CONN-KFK-05.
- CONN-KFK-06: source: srs-debate 2026-11-24, finding C28 (Domain 5; Customer and Scope keep).
- CONN-KFK-07: source: srs-debate 2026-11-24, finding C33 (Tester 9; Contractor, Customer and Scope agree). Replaces CONN-KFK-03: when this row is accepted, that row becomes Superseded by CONN-KFK-07.

## AMQP (AMQ)

| ID | Requirement | Pri | Verify | Status |
|---|---|---|---|---|
| CONN-AMQ-01 | The AMQP destination shall publish persistent messages, and shall record one as SENT only when the broker has confirmed it and at least one queue received it. | P1 | Test | Proposed |
| CONN-AMQ-02 | An AMQP connector with neither a user name nor a client certificate shall refuse to deploy instead of signing in as the broker's default user. | P2 | Test | Proposed |
| CONN-AMQ-03 | An AMQP source that fails to record the same message a set number of times in a row (5 by default, 1 to 1,000), not counting failures while the message store was unreachable, shall stop its channel, raise an alert and leave the message with the broker unacknowledged. | P1 | Test | Proposed |

- CONN-AMQ-01: source: D-266; docs/user/connector-reference.md "AMQP: what it does". The same page gives the message ID partners deduplicate on (interfaces/connector.md CPI-DST-18).
- CONN-AMQ-02: source: ROADMAP V15 "An empty AMQP username connects as guest/guest"; docs/user/capabilities.md "Consume and publish AMQP (RabbitMQ) messages".
- CONN-AMQ-03: source: srs-debate 2026-11-24, finding C3 (Tester 8, Customer 2). The AMQP half of CONN-KFK-02.

## Missing protocols (NEW)

| ID | Requirement | Pri | Verify | Status |
|---|---|---|---|---|
| CONN-NEW-01 | The system shall read and write files over FTP and FTPS, in passive and active mode. | P2 | Test | Proposed |
| CONN-NEW-02 | The system shall read and write files on SMB 2 and SMB 3 shares without the operating system mounting them. | P2 | Test | Proposed |
| CONN-NEW-03 | The system shall read and write objects in Amazon S3 and in stores that speak its protocol, with access keys, temporary credentials or the credentials of the host it runs on. | P2 | Test | Proposed |
| CONN-NEW-04 | The system shall read and write files over WebDAV. | P3 | Test | Proposed |
| CONN-NEW-05 | The Database source and destination shall read and write Microsoft SQL Server. | P1 | Test | Proposed |
| CONN-NEW-06 | The Database source and destination shall read and write Oracle, and a server without Oracle's driver shall run every other connector unaffected. | P2 | Test | Proposed |
| CONN-NEW-07 | The system shall receive and send SOAP 1.1 and 1.2 messages from a service's WSDL, and shall record a SOAP fault as an error with its code and text. | P2 | Test | Proposed |
| CONN-NEW-08 | The system shall have a destination that writes a message as a PDF or RTF document from a template, with a page size and, for PDF, a password when set. | P2 | Test | Proposed |
| CONN-NEW-09 | The system shall send and receive messages over JMS. | P3 | Test | Proposed |
| CONN-NEW-10 | The Email source shall read a mailbox over POP3. | P3 | Test | Proposed |

- CONN-NEW-01: source: docs/user/capabilities.md "Read and write files over FTP or FTPS" (No); ROADMAP connector gap 2; docs/design/12-connector-parity-gap-analysis.md rank 2; D-182.
- CONN-NEW-02: source: docs/user/capabilities.md "Read and write files on SMB shares" (No); ROADMAP connector gap 2; docs/design/03-connectors.md "Resolved Decisions" 2 (no OS mount needed). The SMB versions are assumed; Mirth offers SMB 1 as well.
- CONN-NEW-03: source: docs/user/capabilities.md "Read and write files in Amazon S3" (No); ROADMAP connector gap 2; docs/design/12-connector-parity-gap-analysis.md section 2.2; docs/design/18-voice-of-the-user.md CON11.
- CONN-NEW-04: source: docs/user/capabilities.md "Read and write files over WebDAV" (No); ROADMAP connector gap 12 ("rare; do last").
- CONN-NEW-05: source: docs/user/capabilities.md "Read and write SQL Server" (No, no workaround); ROADMAP connector gap 1; D-182, D-259. The same item covers a JavaScript mode, which has a workaround and no row.
- CONN-NEW-06: source: docs/user/capabilities.md "Read and write Oracle" (No, no workaround); ROADMAP connector gap 1; D-182 (the driver is an optional install whose absence breaks nothing).
- CONN-NEW-07: source: docs/user/capabilities.md "Web Service (SOAP) listener and sender" (No); ROADMAP connector gap 6; docs/design/12-connector-parity-gap-analysis.md section 2.8. conflict: docs/design/09-feature-comparison-and-vision.md 1.4 skips SOAP; doc 12 and the ROADMAP are later and plan it, kept.
- CONN-NEW-08: source: docs/user/capabilities.md "Write PDF or RTF documents" (No, no workaround); ROADMAP connector gap 7; docs/design/12-connector-parity-gap-analysis.md section 2.8. conflict: docs/design/09-feature-comparison-and-vision.md 1.4 skips it; the later sources plan it, kept.
- CONN-NEW-09: source: docs/user/capabilities.md "Send and receive JMS messages" (No); ROADMAP connector gap 11; D-182 (deferred until a customer needs it). conflict: D-261 says "JMS stays out", as does docs/design/09-feature-comparison-and-vision.md 1.4; the later D-261 is the intent, and the row exists for the owner to refuse or defer.
- CONN-NEW-10: source: docs/user/capabilities.md "Read email over POP3" (No); #172 ("deciding not to build it is a fair answer").

## Who may connect (INB)

| ID | Requirement | Pri | Verify | Status |
|---|---|---|---|---|
| CONN-INB-01 | Every source that listens for connections shall have a limit on how many it holds open at once, and shall refuse a connection over it without affecting those already open. | P1 | Test | Proposed |
| CONN-INB-02 | Every source that listens for connections shall let a channel list the addresses that may connect and those that may not, as single addresses, CIDR ranges or start-to-end ranges in IPv4 and IPv6, with a refusal winning over a permission, and shall close a refused connection before it reads any of it. | P2 | Test | Proposed |
| CONN-INB-03 | Every source that listens for connections shall be able to limit how many one sender address holds open at once, and shall refuse that sender's next one while others can still connect. | P2 | Test | Proposed |
| CONN-INB-04 | A source set to require PROXY protocol version 2 shall use the address in the header as the sender's for limits, lists, logs and message metadata, and shall refuse a connection with a missing or malformed header or from a proxy the operator has not listed. | P2 | Test | Proposed |
| CONN-INB-05 | Every source that listens for connections shall hold open no more connections than its limit, 100 unless set otherwise, and shall refuse one over it without affecting those open. | P1 | Test | Proposed |

- CONN-INB-01: source: docs/user/connector-reference.md TCP_MLLP `maxConnections`, "DICOM limits" (no limit on concurrent associations); #310. The HTTP source has no such setting. Known gap in protection against overload, so P1.
- CONN-INB-02: source: #309. Its open questions: the same lists for the admin console, lists shared by name across channels, and hostnames.
- CONN-INB-03: source: #310.
- CONN-INB-04: source: #312; #308 (required for clustering).
- CONN-INB-05: source: srs-debate 2026-11-24, finding C38 (Contractor). 100 is the Contractor's number; #310. Replaces CONN-INB-01: when this row is accepted, that row becomes Superseded by CONN-INB-05.

## OAuth2 credentials (OAU)

| ID | Requirement | Pri | Verify | Status |
|---|---|---|---|---|
| CONN-OAU-01 | An HTTP or FHIR destination shall be able to sign in with an OAuth2 client-credentials token from a credential defined once and shared by any number of channels, and shall get and renew the token without a script, so that no message fails because a token expired. | P2 | Test | Proposed |
| CONN-OAU-02 | The SMTP destination and the Email source shall be able to sign in with OAuth2 to Microsoft 365 and Google mailboxes. | P2 | Demonstration | Proposed |

- CONN-OAU-01: source: docs/user/capabilities.md "HTTP Sender OAuth2 with token refresh" (No), "Shared OAuth2 credential vault" (No); ROADMAP V11 and B10; docs/design/18-voice-of-the-user.md CON5. Storing the secret is SEC-CRD-01.
- CONN-OAU-02: source: docs/user/connector-reference.md "EMAIL limits", "SMTP limits"; docs/design/18-voice-of-the-user.md CON13 and its ranking (Microsoft is retiring password sign-in). No issue or ROADMAP item tracks it.

## Third-party connectors (EXT)

| ID | Requirement | Pri | Verify | Status |
|---|---|---|---|---|
| CONN-EXT-01 | The operator of a server shall be able to add a connector that is not part of the product, without changing the product, and channels shall then be able to use it, under the same rules, as they use a built-in one. | P3 | Demonstration | Proposed |

- CONN-EXT-01: source: ROADMAP "[DECIDE] Extension/plugin platform" and v2.1 "Custom connector SDK"; docs/design/13-non-connector-gap-analysis.md section 6; docs/design/18-voice-of-the-user.md DOC5; docs/srs/README.md "Connector or automation author". How one is loaded, versioned and kept from harming other channels is interfaces/connector.md CPI-REG-03, CPI-VER-03 and CPI-RES-02.
