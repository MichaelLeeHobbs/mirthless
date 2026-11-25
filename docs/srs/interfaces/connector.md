# Connector plugin contract interface

Version 0.1.0. Area code `CPI`. Consumers: the thirteen built-in connectors (TCP_MLLP, HTTP, FILE, SFTP, DATABASE, JAVASCRIPT, CHANNEL, DICOM, EMAIL, SMTP, FHIR, KAFKA, AMQP), the engine that calls them, deploy validation and Test Connection in the server, and later the authors of connectors that are not built in. Whether third-party connectors are ever loaded is the open ROADMAP item "[DECIDE] Extension/plugin platform", which the developer has not decided; the rows that assume it are P3.

What a user sees of each protocol is in the Connectors area (`CONN`), and message statuses, queues and recovery are in the Pipeline area (`PIPE`). This file says what a connector and the engine owe each other. A member marked `planned` in a block does not exist in the code at this version. Where the code differs from a row, the source note says so.

## Versioning

Major: a change that breaks an existing connector or the engine's use of it. Minor: an addition an existing connector can ignore. Patch: wording only. While the version is below 1.0.0 nothing outside this repository builds against it, and a minor version may break.

## Base types and results (RES)

```ts
type Result<T, E = ConnectorError> = { ok: true; value: T; error: null } | { ok: false; value: null; error: E };
interface ConnectorError extends Error {
  readonly code: ConnectorErrorCode;                  // planned
  readonly delivery?: 'NOT_SENT' | 'UNKNOWN';         // planned; set by send only
}
type ConnectorErrorCode =                             // planned
  | 'CONFIG_INVALID' | 'NOT_STARTED' | 'UNREACHABLE' | 'AUTH_FAILED' | 'PERMISSION_DENIED'
  | 'PROTOCOL_ERROR' | 'TIMEOUT' | 'ABORTED' | 'INTERNAL';
```

| ID | Requirement | Pri | Verify | Status |
|---|---|---|---|---|
| CPI-RES-01 | Every method of a connector that returns a promise, and every `MessageDispatcher` the engine supplies, shall resolve to a `Result` and shall never throw or reject; the exceptions are `onMessageDelivered`, whose rejection CPI-SRC-06 defines, and the factories of CPI-REG-01. | P1 | Test | Proposed |
| CPI-RES-02 | When a connector throws, rejects or resolves to anything that is not a `Result`, the engine shall treat that one call as `{ ok: false }` with code `INTERNAL`, and the outcome of the same message at its other destinations, and every other channel, shall be what it would have been without the fault. | P1 | Test | Proposed |
| CPI-RES-03 | The `error` of every `{ ok: false }` a connector returns shall carry one `code` from `ConnectorErrorCode`, and the same failure shall carry the same code in every connector: `CONFIG_INVALID` for settings, `UNREACHABLE` when no connection was made, `AUTH_FAILED` when the partner refused the credentials, `TIMEOUT` when a time limit passed, `ABORTED` when `signal` or `onHalt` ended the call, `NOT_STARTED` for a call before `onStart`, `PERMISSION_DENIED` when the partner or the file system refused the action, `PROTOCOL_ERROR` for an answer that cannot be read, `INTERNAL` otherwise. | P2 | Test | Proposed |

- CPI-RES-01: source: `packages/connectors/src/base.ts` (every method returns `Result`), AGENTS.md "Result<T>"; docs/design/03-connectors.md "Base Interface". Today all thirteen wrap their methods in `tryCatch`, but nothing checks it.
- CPI-RES-02: source: the same as CPI-RES-01, and README Purpose ("never lost ... without someone being told"). Today `sendFn` in `packages/server/src/engine.ts` calls `connector.send` unguarded, so a thrown error ends the whole message in `failUnexpected` (`packages/engine/src/pipeline/message-processor.ts`), and `runHalt` in `packages/engine/src/runtime/channel-runtime.ts` never reads the `Result` of `onHalt`.
- CPI-RES-03: source: README User classes, Connector or automation author ("a stable, documented contract with named errors"). Today errors are plain text; no connector sets a code. The list of codes is this draft's proposal.

## Lifecycle (LIF)

```ts
interface ConnectorLifecycle {
  onDeploy(): Promise<Result<void>>;
  onStart(): Promise<Result<void>>;
  onStop(): Promise<Result<void>>;    // graceful
  onHalt(): Promise<Result<void>>;    // forced
  onUndeploy(): Promise<Result<void>>;
}
// onDeploy ( onStart ( onStop | onHalt ) )* onUndeploy
```

| ID | Requirement | Pri | Verify | Status |
|---|---|---|---|---|
| CPI-LIF-01 | The engine shall call one instance in the order `onDeploy`, then any number of `onStart` followed by `onStop` or `onHalt`, then `onUndeploy`; it shall not call a method before the earlier one has settled, except `onHalt`, which may come while `onStart` or `onStop` is unsettled; and it shall build a new instance for each deployment. | P1 | Test | Proposed |
| CPI-LIF-02 | `onDeploy` shall resolve `{ ok: false }` with code `CONFIG_INVALID` for settings that can never work, and shall leave no listener, connection, timer or file handle open whether it succeeds or fails. | P1 | Test | Proposed |
| CPI-LIF-03 | `onStart` shall resolve ok only when the connector can do its work: a source that listens is bound to its port, a source that subscribes or polls a remote server has connected to it, and a destination can accept `send`. | P1 | Test | Proposed |
| CPI-LIF-04 | `onStart` of a destination shall not fail because its partner cannot be reached; that failure shall appear on each `send`. | P2 | Test | Proposed |
| CPI-LIF-05 | `onStop` shall take no new input from the moment it is called, and shall resolve only when every message the source had dispatched and every `send` in flight has settled, without a time limit of its own on that wait; any other wait inside `onStop` shall end within 15 seconds. | P1 | Test | Proposed |
| CPI-LIF-06 | Once `onStop` or `onHalt` has resolved, or `onStart` has failed, the connector shall hold no listener, connection, timer or file handle, and shall not call the `MessageDispatcher` until the next `onStart`. | P1 | Test | Proposed |
| CPI-LIF-07 | `onHalt` shall end every connect, wait and cancellable `send` of the instance, whoever started it, and shall resolve within 10 seconds, also when the partner does not answer and while `onStop` is unsettled. | P1 | Test | Proposed |
| CPI-LIF-08 | `onStart` after `onStop` or `onHalt` on the same instance shall work as the first `onStart` did, and work left from the earlier run shall not close, answer, commit or dispatch anything that belongs to the new run; `onStop`, `onHalt` and `onUndeploy` with nothing to end shall resolve ok and change nothing. | P1 | Test | Proposed |
| CPI-LIF-09 | A connection error, a malformed input or a partner that disconnects at any point in the lifecycle, between calls included, shall not end the server process and shall not produce an unhandled rejection. | P1 | Test | Proposed |
| CPI-LIF-10 | `onStart` shall resolve ok only when a listening source is bound to its port and a destination can accept `send`; a source that polls or subscribes shall resolve ok while its partner is unreachable, call `reportError`, and keep trying until it connects, stops or halts. | P1 | Test | Proposed |
| CPI-LIF-11 | Once `onStop` or `onHalt` has resolved, or `onStart` has failed, the connector shall not call the `MessageDispatcher` until the next `onStart`, and shall hold no listener, connection, timer or file handle except, until it settles, those of a `send` declared `cancellable: false`. | P1 | Test | Proposed |
| CPI-LIF-12 | `onStop` shall take no new input once called, and before it resolves shall meet CONN-SRC-13 for input in hand and PIPE-LIF-03 for sends in flight; any other wait inside `onStop` shall end within 15 seconds. | P1 | Test | Proposed |

- CPI-LIF-01: source: `packages/engine/src/runtime/channel-runtime.ts` (`deploy`, `join`, `TAKEN_OVER_BY_HALT`), D-342. Today a stop may call `onStop` while a pause's `onStop` or a resume's `onStart` is unsettled; the row removes that case so a connector author need not handle it. The engine starts destinations before the source and stops the source first.
- CPI-LIF-02: source: `onDeploy` of every receiver and dispatcher; docs/design/03-connectors.md "Base Interface"; D-274. Most settings are refused by the schema before `onDeploy` (CPI-CFG-01).
- CPI-LIF-03: source: `packages/connectors/src/tcp-mllp/tcp-mllp-receiver.ts`, `http/http-receiver.ts`, `email/email-receiver.ts`, `kafka/kafka-receiver.ts` ("a broker that cannot be reached fails the start"). Today the DICOM listener resolves ok without waiting for its port (`dicom/dcmjs-dimse-adapter.ts` `start`), so a port in use is only logged.
- CPI-LIF-04: source: `packages/connectors/src/kafka/kafka-dispatcher.ts` ("a broker that is down fails sends (and queues), not the start"), and the same behaviour in AMQP, HTTP, TCP_MLLP, SFTP and SMTP. Conflict: `database/database-dispatcher.ts` `onStart` creates and checks its pool, so a channel whose destination database is down does not start; the majority behaviour is kept.
- CPI-LIF-05: source: D-341 (an HTTP stop waits for the pipeline "without a limit, as before, until a halt", 5 seconds for a body still arriving, 15 seconds for an answer to be read). Conflict: `tcp-mllp-receiver.ts` waits 5 seconds (`STOP_DRAIN_MS`) and Kafka and AMQP 30 seconds; D-341 is the latest decision and is kept. Today JAVASCRIPT and SFTP sources do not wait for the input in hand at all, and FILE and EMAIL do.
- CPI-LIF-06: source: `file/file-receiver.ts` and `kafka/kafka-receiver.ts` (a `running` flag or generation checked before each input), D-342. Today a JAVASCRIPT source goes on dispatching the rest of its script's array after a stop, a DATABASE source drains its pool without waiting for its poll cycle, and a SFTP source closes the connection under the file in hand.
- CPI-LIF-07: source: D-342 (a halt ends every send that can be ended, whoever asked for it). The 10 seconds is `EARLIER_ENDS_MS` in `channel-runtime.ts`, the time the next start waits before it refuses; no source states a limit for `onHalt`. Today Kafka, AMQP and EMAIL may take 30 seconds to close, and a DATABASE destination waits for its query.
- CPI-LIF-08: source: D-342 ("a connector's `onStop` that resumes after a start takes down what the start made"); `generation` in the Kafka and AMQP receivers; `close` in `tcp-mllp-dispatcher.ts`.
- CPI-LIF-09: source: `attachIdleHandlers` in `tcp-mllp-dispatcher.ts`, the `error` listeners in `email/email-receiver.ts` and `dicom/dicom-receiver.ts`; each comment says an unhandled `error` event would take the server down.
- CPI-LIF-10: source: srs-debate 2026-11-24, finding C5 (Customer 1 over Contractor 4; the source error added by Contractor). Replaces CPI-LIF-03: when this row is accepted, that row becomes Superseded by CPI-LIF-10.
- CPI-LIF-11: source: srs-debate 2026-11-24, finding C8 (Contractor 7, Tester). Replaces CPI-LIF-06: when this row is accepted, that row becomes Superseded by CPI-LIF-11.
- CPI-LIF-12: source: srs-debate 2026-11-24, finding C17 (Scope 6, with Domain 2). Replaces CPI-LIF-05: when this row is accepted, that row becomes Superseded by CPI-LIF-12.

## Source guarantees (SRC)

```ts
interface RawMessage { readonly content: string; readonly sourceMap: Readonly<Record<string, unknown>>; } // sourceMap: JSON values
interface DispatchResult {
  readonly messageId: number; readonly response?: string;
  readonly status?: 'PROCESSED' | 'FILTERED' | 'ERROR';   // absent means PROCESSED
  readonly queued?: boolean; readonly destinationFailed?: boolean;
  readonly metadata?: Readonly<Record<string, unknown>>;  // planned (CPI-DST-17)
}
type MessageDispatcher = (raw: RawMessage) => Promise<Result<DispatchResult>>;
type SourceFatalHandler = (error: Error) => void;
interface SourceConnectorRuntime extends ConnectorLifecycle {
  setDispatcher(dispatcher: MessageDispatcher): void;      // after onDeploy, before onStart
  setFatalHandler?(handler: SourceFatalHandler): void;
  setErrorReporter(reportError: (error: ConnectorError) => void): void; // planned (CPI-SRC-14); before onStart
  onMessageDelivered?(content: string): Promise<void>;
}
```

| ID | Requirement | Pri | Verify | Status |
|---|---|---|---|---|
| CPI-SRC-01 | The `MessageDispatcher` shall resolve `{ ok: true }` only when the message made from `raw`, or every message when `processBatch` splits it, is recorded as the channel's storage mode requires, and `{ ok: false }` only when nothing made from `raw` was recorded. | P1 | Test | Proposed |
| CPI-SRC-02 | On `{ ok: false }` a source shall not acknowledge, commit, delete, move or mark its input, and shall either offer the input again or tell the waiting sender that it failed (MLLP `AE`, the HTTP `errorStatusCode`, a C-STORE failure). | P1 | Test | Proposed |
| CPI-SRC-03 | On `{ ok: true }` with status `ERROR` a source shall not answer success to a waiting sender, shall not run its after-processing action, and shall not dispatch that input again by itself, also after a restart. | P1 | Test | Proposed |
| CPI-SRC-04 | A source shall give its protocol's acceptance (MLLP `AA`, an HTTP 2xx, a C-STORE `Success`, a Kafka commit, an AMQP ack, a deleted, moved or marked input) only after the dispatcher resolved ok, or after it has itself kept the input where a restart dispatches it. | P1 | Test | Proposed |
| CPI-SRC-05 | A source whose `content` is a reference to its input, such as a file path, shall keep that input when the result has `queued` or `destinationFailed` set, until `onMessageDelivered` is called for it. | P1 | Test | Proposed |
| CPI-SRC-06 | `onMessageDelivered` shall act on the `content` it is given without state from the instance that dispatched it, shall do nothing for input already removed, and when its action fails shall reject, upon which the engine shall raise an alert naming the channel and the message. | P1 | Test | Proposed |
| CPI-SRC-07 | A source whose transport gives an input an identity shall put it in `sourceMap` under documented keys with the same values at every delivery of that input, and shall set `sourceMap.redelivered` to `true` when the transport says the input was delivered before. | P2 | Test | Proposed |
| CPI-SRC-08 | A source shall stop reading from an ordered stream (one MLLP connection, Kafka partition, AMQP queue, or polled directory, mailbox or query) while a dispatch from that stream is unresolved, so inputs are dispatched one at a time in stream order and unread input waits with the sender. | P1 | Test | Proposed |
| CPI-SRC-09 | A source that offers the same input again by itself shall, after `maxStoreAttempts` results of `{ ok: false }` in a row for that input (1 to 1000, default 5), stop itself with the input unreleased and call its `SourceFatalHandler` exactly once, and shall not count failures that arrive after a stop or halt. | P1 | Test | Proposed |
| CPI-SRC-10 | When a `SourceFatalHandler` is called by the deployment that is running, the engine shall stop the channel, record an ERROR event with reason `SOURCE_FAILED` and raise a `SOURCE_CONNECTOR` alert; a call from a stopped or replaced deployment shall change nothing. | P1 | Test | Proposed |
| CPI-SRC-11 | A source that decodes bytes to text shall not replace a byte it cannot decode without saying so: it shall refuse the input, or dispatch it with `sourceMap.charsetError` set to the reason. | P1 | Test | Proposed |
| CPI-SRC-12 | A source bound by CONN-KFK-05 or CONN-AMQ-03 shall, at its limit, stop itself with the input unreleased and call its `SourceFatalHandler` exactly once, not counting failures with code `UNREACHABLE` or after a stop or halt. | P1 | Test | Proposed |
| CPI-SRC-13 | The dispatcher's `{ ok: false }` shall carry code `UNREACHABLE` when the message store could not be reached. | P1 | Test | Proposed |
| CPI-SRC-14 | The engine shall give every source, before `onStart`, a `reportError(error: ConnectorError): void`; each call shall record an ERROR event and raise a `SOURCE_CONNECTOR` alert without stopping the channel. | P1 | Test | Proposed |
| CPI-SRC-15 | The `MessageDispatcher` shall record the message made from `raw`, or every message `processBatch` splits it into, as the channel's storage mode requires before it processes any, resolving `{ ok: true }`, or shall record none of them and resolve `{ ok: false }`. | P1 | Test | Proposed |
| CPI-SRC-16 | When `DispatchResult.status` (the outcome after the channel's response mode) is `ERROR`, a source shall not answer success to a sender waiting for that result, and shall leave a file or email in place, unless CONN-FILE-09 applies. | P1 | Test | Proposed |
| CPI-SRC-17 | A source shall not dispatch again by itself, also after a restart, an input recorded with an error, and shall mark its database row, commit its offset or reject it without requeue. | P1 | Test | Proposed |
| CPI-SRC-18 | On `{ ok: false }` a source shall not acknowledge, commit, delete, move or mark its input, and shall offer it again, tell the waiting sender it failed (MLLP `AE`, the HTTP `errorStatusCode`, a C-STORE failure), or, for a JAVASCRIPT source, call `reportError`. | P1 | Test | Proposed |
| CPI-SRC-19 | A source that decodes bytes to text shall, on a byte it cannot decode, refuse the input when a sender waits, unless CONN-SRC-12 applies, and otherwise dispatch it with `sourceMap.charsetError` set to the reason. | P1 | Test | Proposed |
| CPI-SRC-20 | A source shall give the acceptance CONN-SRC-01 names only after the dispatcher resolved ok, except as CONN-DCM-12 says. | P1 | Test | Proposed |
| CPI-SRC-21 | A source set to binary shall give `content` as base64 of the exact bytes with `sourceMap.contentEncoding` `base64`, and a destination set to binary shall write the decoded bytes and fail the send on invalid base64. | P2 | Test | Proposed |

- CPI-SRC-01: source: `dispatchFailure` in `packages/connectors/src/base.ts` ("Nothing was recorded"), `processMessage` in `message-processor.ts` ("refuse it: the sender gets an error and resends"), D-211. Conflict: `processBatch` in `packages/server/src/engine.ts` (D-254) returns the first part's failure, so `{ ok: false }` can follow parts that were recorded, and the source then offers them again; D-254 accepts that for an MLLP sender, and the row keeps the rule in `base.ts`.
- CPI-SRC-02: source: `dispatchFailure` in `base.ts`, D-266, D-211. Conflict: D-157 says `updateMode` ALWAYS marks a row "unconditionally", so a DATABASE source marks rows the pipeline did not store (`ackRow` in `database/database-receiver.ts`); the rule that nothing is lost is kept. Today a JAVASCRIPT source logs and drops a message that was not stored.
- CPI-SRC-03: source: `dispatchFailure` in `base.ts`, D-211 and D-266 (Kafka commits such a record, AMQP rejects it without requeue, MLLP answers `AE`). Today the EMAIL source keeps these only in memory (`heldAfterError`), so a redeploy dispatches them again.
- CPI-SRC-04: source: D-266, `dispatchFailure` in `base.ts`; README User classes, Partner system ("a correct acknowledgement that means the message is safe"). Today the DICOM listener answers `Success` once the file is written and dispatches afterwards (`dicom/dcmjs-dimse-adapter.ts` `handleInstance`), and a restart does not dispatch a file that was written and never dispatched.
- CPI-SRC-05: source: D-325, `DispatchResult.queued` and `destinationFailed` in `base.ts`, `keepsInput` in `dicom/dicom-receiver.ts`.
- CPI-SRC-06: source: D-325, `onMessageDelivered` in `base.ts` and `dicom/dicom-receiver.ts`, `notifyDelivered` in `packages/engine/src/runtime/queue-consumer.ts`.
- CPI-SRC-07: source: D-266 (Kafka `topic`/`partition`/`offset`, AMQP `redelivered`), `channel/channel-dispatcher.ts` (`sourceChannelId`, `sourceMessageId`, `sourceMetaDataId`, the keys #401 would deduplicate on). Today the EMAIL source map carries no UID or Message-ID, and MLLP and HTTP have no transport identity.
- CPI-SRC-08: source: D-266 ("one message at a time"), `tcp-mllp-receiver.ts` ("HL7 senders assume strict sequential request/response"). Today an MLLP connection goes on reading and holds parsed messages in memory behind the one in hand. HTTP requests are not an ordered stream.
- CPI-SRC-09: source: D-271, `giveUp` in the Kafka and AMQP receivers, `DEFAULT_MAX_STORE_ATTEMPTS` in `packages/core-models/src/schemas/queue-connector.schema.ts`. Polled file, email and database sources retry at every poll without a limit and do not stop.
- CPI-SRC-10: source: D-271, `stopAfterSourceFailure` in `packages/server/src/engine.ts`.
- CPI-SRC-11: source: D-334 (an HTTP body that is not valid in its charset gets 415), `toRawMessage` in the Kafka and AMQP receivers (`charsetError`); README Purpose ("never be ... corrupted without someone being told"). Today TCP_MLLP, FILE, SFTP and EMAIL decode without checking.
- CPI-SRC-12: source: srs-debate 2026-11-24, finding C3 (Contractor 2, Customer 2, Scope 5, Tester). Replaces CPI-SRC-09: when this row is accepted, that row becomes Superseded by CPI-SRC-12.
- CPI-SRC-13: source: srs-debate 2026-11-24, finding C3 (Tester).
- CPI-SRC-14: source: srs-debate 2026-11-24, finding C4 (Contractor 3; Customer and Scope agree).
- CPI-SRC-15: source: srs-debate 2026-11-24, finding C10 (Domain 3, Contractor 9, Tester, Scope). conflict: D-254 lets a batch answer not-ok after parts were recorded. Replaces CPI-SRC-01: when this row is accepted, that row becomes Superseded by CPI-SRC-15.
- CPI-SRC-16: source: srs-debate 2026-11-24, finding C11 (Contractor 10 with Tester 2, Domain 6). DICOM answers before the dispatch (CONN-DCM-12), so no sender waits there: decision D-C4. Replaces CPI-SRC-03: when this row is accepted, that row becomes Superseded by CPI-SRC-16.
- CPI-SRC-17: source: srs-debate 2026-11-24, finding C11 (Contractor 10, Tester 2). The other half of CPI-SRC-03.
- CPI-SRC-18: source: srs-debate 2026-11-24, finding C11 (Tester 2). Replaces CPI-SRC-02: when this row is accepted, that row becomes Superseded by CPI-SRC-18.
- CPI-SRC-19: source: srs-debate 2026-11-24, finding C15 (Contractor 14, Customer 4). Replaces CPI-SRC-11: when this row is accepted, that row becomes Superseded by CPI-SRC-19.
- CPI-SRC-20: source: srs-debate 2026-11-24, finding C16 (Scope 1). Replaces CPI-SRC-04: when this row is accepted, that row becomes Superseded by CPI-SRC-20.
- CPI-SRC-21: source: srs-debate 2026-11-24, finding C31 (Tester 10, Domain 13).

## Polling sources (POL)

```ts
const QUARANTINE_LEDGER_NAME = '.galvanigraph-quarantine.json'; // a JSON array of `name:mtime` keys
interface QuarantineLedger { load(paths: readonly string[]): Promise<void>; has(key: string): boolean; add(key: string): Promise<void>; }
```

| ID | Requirement | Pri | Verify | Status |
|---|---|---|---|---|
| CPI-POL-01 | A polling source shall begin no poll while one is unsettled, and neither a hung server (each remote operation ends within 30 seconds) nor a failing input shall keep it from the next input or the next poll. | P1 | Test | Proposed |
| CPI-POL-02 | A polling source shall not dispatch again an input that was recorded with status `ERROR` or whose after-processing action failed after an ok dispatch, also after a restart and for as long as the input is unchanged; when it cannot save that fact it shall raise an alert naming the input. | P1 | Test | Proposed |
| CPI-POL-03 | A polling source shall not stop itself because an input was not recorded; it shall offer it again at each later poll. | P1 | Test | Proposed |

- CPI-POL-01: source: the `polling` flag in every polling receiver; `client-lifecycle.ts` ("a hung server cannot wedge a poll loop"), `SFTP_OP_TIMEOUT_MS` and `IMAP_OP_TIMEOUT_MS`, `STATEMENT_TIMEOUT_MS` in the DATABASE receiver. An interval is 100 to 2147483647 ms, at least 1000 for EMAIL (D-274).
- CPI-POL-02: source: D-158, D-168, `quarantine-ledger.ts`, `DISPATCHED_KEYWORD` in `email/email-receiver.ts`. Conflict: the code only logs a ledger it could not write and D-158 accepts a loud log; the alert follows AGENTS.md "Fail safe, not silent". Today a SFTP source whose connection was closed by a stop takes a skipped post-action for a done one (`postProcess` returns when there is no client), so the file is neither removed nor quarantined, and the next start dispatches it again.
- CPI-POL-03: source: srs-debate 2026-11-24, finding C3 (Contractor 2).

## Destination guarantees (DST)

```ts
interface ConnectorMessage {
  readonly channelId: string; readonly messageId: number; readonly metaDataId: number;
  readonly content: string; readonly dataType: string; readonly correlationId?: string;
  readonly variables?: Readonly<Record<string, unknown>>;
  readonly deliveryId: string;                            // planned; opaque, see CPI-DST-18 and CPI-DST-19
}
interface ConnectorResponse {
  readonly status: 'SENT' | 'ERROR'; readonly content: string; readonly errorMessage?: string;
  readonly retryable?: boolean;                           // planned (CPI-DST-14)
  readonly metadata?: Readonly<Record<string, unknown>>;  // planned (CPI-DST-17)
}
interface DestinationConnectorRuntime extends ConnectorLifecycle {
  send(message: ConnectorMessage, signal: AbortSignal): Promise<Result<ConnectorResponse>>;
  variablesUsed(message: ConnectorMessage): readonly string[];
}
```

| ID | Requirement | Pri | Verify | Status |
|---|---|---|---|---|
| CPI-DST-01 | `send` shall resolve with status `SENT` only when the partner accepted the message at the protocol's own level: an HL7 `AA` or `CA` that names the sent control ID, an HTTP 2xx, a C-STORE `Success` for every instance, a broker's confirmation, a committed statement, a closed file under its final name, or the target channel's dispatch ok and not `ERROR`. | P1 | Test | Proposed |
| CPI-DST-02 | When a partner accepts one part of a message and refuses another (an email recipient, a DICOM instance, a file), `send` shall resolve with status `ERROR` and an `errorMessage` that says which parts were accepted and which were not. | P1 | Test | Proposed |
| CPI-DST-03 | When the partner answers with a refusal, `send` shall resolve `{ ok: true }` with status `ERROR`, the partner's answer unchanged in `content`, and a reason in `errorMessage` that is not blank. | P1 | Test | Proposed |
| CPI-DST-04 | When `send` ends without an answer from the partner it shall resolve `{ ok: false }` with `error.delivery` set to `NOT_SENT` if no byte of the message was handed to the transport, and to `UNKNOWN` otherwise; the engine shall show `UNKNOWN` with the message as "may have been delivered". | P1 | Test | Proposed |
| CPI-DST-05 | The engine shall record status `SENT` as SENT, and status `ERROR` or `{ ok: false }` as ERROR when the destination's queue mode is `NEVER` and as QUEUED with the reason kept when it is `ON_FAILURE` or `ALWAYS`, until the queue's retry limit is reached; under `ALWAYS` it shall queue the message without a first send. | P1 | Test | Proposed |
| CPI-DST-06 | `send` shall settle with code `ABORTED` within 1 second of `signal` aborting, or without sending when `signal` is already aborted; a connector whose transport cannot cancel shall declare `cancellable: false` and settle within the time CPI-DST-20 gives it. | P2 | Test | Proposed |
| CPI-DST-07 | `send` shall settle within the timeout its properties set, or 30 seconds when they set none, and the engine shall not abort a send before that time unless the channel is halted, whether the send is direct, from the queue or by crash recovery. | P1 | Test | Proposed |
| CPI-DST-08 | `deliveryId` shall be `channelId:messageId:metaDataId`, the same for the first send, every queue retry, crash recovery and a resend, and a destination whose protocol has a place for a message ID outside the payload shall send it there. | P2 | Test | Proposed |
| CPI-DST-09 | `send` shall fill `${name}` from `message.variables` once, without scanning filled text again, and when a setting that decides where the message goes still holds an unfilled `${name}`, it shall resolve with status `ERROR` and send nothing. | P1 | Test | Proposed |
| CPI-DST-10 | `variablesUsed` shall return every name that `send` would look up in `variables` for that message, so a message whose variables were not kept is not sent with other data. | P1 | Test | Proposed |
| CPI-DST-11 | `send` shall be safe to call again before earlier calls settle: each answer shall reach only the call it belongs to, and a connection whose exchange failed, timed out or was aborted shall carry no later message. | P1 | Test | Proposed |
| CPI-DST-12 | Within one `send` call a connector shall not transmit the message again after an attempt whose outcome is unknown; a later attempt is the engine's to make. | P1 | Test | Proposed |
| CPI-DST-13 | The engine shall record status `SENT` as SENT; under queue mode `ON_FAILURE` or `ALWAYS` it shall queue, until the retry limit, a `{ ok: false }` whose code is not `CONFIG_INVALID` (except, where PIPE-QUE-10's hold is set, one with `delivery: 'UNKNOWN'`) and an `ERROR` whose `retryable` is not `false`, and shall record anything else as ERROR; under `ALWAYS` it shall queue without a first send. | P1 | Test | Proposed |
| CPI-DST-14 | `ConnectorResponse` shall have an optional `retryable: boolean`, set to `false` for an HL7 refusal (unless CONN-DST-08's setting is on), for a message accepted in part, for an append CONN-FILE-10 could not undo, and for an error of a target channel or a script, and absent or `true` otherwise. | P1 | Test | Proposed |
| CPI-DST-15 | `send` shall resolve with status `SENT` only when CONN-DST-10 and the protocol's CONN rows count the message as confirmed. | P1 | Test | Proposed |
| CPI-DST-16 | `send` shall fill `${name}` from `message.variables` once, without scanning filled text, and when a URL, recipient, topic, routing key, target channel or bound statement value names a variable the message lacks, shall resolve `{ ok: false }` with code `CONFIG_INVALID`, `delivery: 'NOT_SENT'` and the name, sending nothing. | P1 | Test | Proposed |
| CPI-DST-17 | `ConnectorResponse` and `DispatchResult` shall carry an optional `metadata` of JSON values: the partner's status and headers, and those a script set for the answer. | P2 | Test | Proposed |
| CPI-DST-18 | `deliveryId` shall be the same for the first send, queue retries, crash recovery and a resend of a message not shown as SENT, and different for a resend of one that is; a protocol with a place for a message ID outside the payload shall carry it there. | P2 | Test | Proposed |
| CPI-DST-19 | No two messages shall have the same `deliveryId`, also after a database restore or on another server. | P2 | Test | Proposed |
| CPI-DST-20 | `send` shall settle within the CONN-DST-12 limit, and the engine shall not abort it sooner unless the channel is halted, whether the send is direct, from the queue or by crash recovery. | P1 | Test | Proposed |

- CPI-DST-01: source: D-266 ("report SENT only when the broker has the message"), `classifyAckResponse` in `tcp-mllp/ack-builder.ts`, `redirect.ts`, docs/user/connector-reference.md "TCP_MLLP: what it does" and "HTTP: what it does", `channel/channel-dispatcher.ts`. Today the DICOM sender never reads the C-STORE response status (#410).
- CPI-DST-02: source: AGENTS.md "Messages must never be silently lost" and "Fail safe, not silent". Conflict: `smtp/smtp-dispatcher.ts` reports SENT when at least one recipient was accepted, because a retry would mail the accepted ones twice; the no-silent-loss side is kept.
- CPI-DST-03: source: `ConnectorResponse` in `base.ts`, `sendFailureReason` in `packages/engine/src/pipeline/send-failure.ts`, D-248.
- CPI-DST-04: source: D-342 ("either may already have reached the partner, as with any send that gets no answer"), D-343 and `MAY_BE_DELIVERED` in `packages/engine/src/runtime/destination-redispatcher.ts`. Today a send failure does not say whether the message may have been delivered; only crash recovery does, in text.
- CPI-DST-05: source: `DestinationConfig.queueMode` and `recordSendFailure` in `message-processor.ts`, `queue-consumer.ts`, D-248.
- CPI-DST-06: source: D-342, which lists what runs to its end (a database query, a file write, a DICOM send, a JavaScript destination's script, a send to another channel). The 1 second is this draft's number.
- CPI-DST-07: source: AGENTS.md "All async operations need timeouts (30s default)", `responseTimeout` in docs/user/connector-reference.md, `SEND_BACKSTOP_MS` (300 s) in `packages/server/src/engine.ts`. Today the queue consumer and crash recovery abort at 30 seconds whatever the connector's own timeout is, so a partner that takes 45 seconds to answer works directly and never from the queue.
- CPI-DST-08: source: D-266 (the AMQP `messageId`). Today only AMQP sends it; Kafka headers, an HTTP header and the SMTP Message-ID do not carry it. #395 is a save that renumbers `metaDataId`, which this ID must survive.
- CPI-DST-09: source: D-252, D-275, `fillVariables` in `base.ts`; Kafka, AMQP and CHANNEL refuse an unfilled topic, routing key and target. Today an HTTP URL and SMTP addresses are used as written.
- CPI-DST-10: source: D-343, `variablesUsed` in `base.ts`, `packages/connectors/src/__tests__/variables-used.test.ts`.
- CPI-DST-11: source: `message-processor.ts` (destination chains run in parallel and messages overlap), `send` in `tcp-mllp-dispatcher.ts` (`pool.destroy` after a failed exchange), `sftp-dispatcher.ts` and `smtp-dispatcher.ts` (a connection per send).
- CPI-DST-12: source: D-342 and D-343 on unknown outcomes. Today `DimseSender.send` retries up to `maxRetries` after any network error, also one after the instance was transmitted; a C-STORE of the same instance is usually harmless at an archive.
- CPI-DST-13: source: srs-debate 2026-11-24, finding C1 (Domain 1, Contractor; default inverted by Scope so that a 503 still queues). Replaces CPI-DST-05: when this row is accepted, that row becomes Superseded by CPI-DST-13.
- CPI-DST-14: source: srs-debate 2026-11-24, finding C1 (Contractor). A target channel's error must not queue, because each retry would record another message there.
- CPI-DST-15: source: srs-debate 2026-11-24, finding C7 (Scope 4, Contractor 6, Domain 12, Tester 4). Replaces CPI-DST-01: when this row is accepted, that row becomes Superseded by CPI-DST-15.
- CPI-DST-16: source: srs-debate 2026-11-24, finding C12 (Contractor 11). The old row answered ok where CPI-DST-04 demands not-ok, and left out bound values (CONN-DST-05). Replaces CPI-DST-09: when this row is accepted, that row becomes Superseded by CPI-DST-16.
- CPI-DST-17: source: srs-debate 2026-11-24, finding C13 (Contractor 12).
- CPI-DST-18: source: srs-debate 2026-11-24, finding C14 (Domain over Contractor 13). Decision D-C5. Replaces CPI-DST-08: when this row is accepted, that row becomes Superseded by CPI-DST-18.
- CPI-DST-19: source: srs-debate 2026-11-24, finding C14 (Domain).
- CPI-DST-20: source: srs-debate 2026-11-24, finding C18 (Scope 3). Replaces CPI-DST-07: when this row is accepted, that row becomes Superseded by CPI-DST-20.

## Configuration (CFG)

```ts
interface ConnectorProperties<T> {                        // one per type and direction
  readonly schema: ZodType<T>;                            // strict
  readonly keys: { readonly deciding: readonly string[]; readonly free: readonly string[]; readonly credentials: readonly string[] };
}
type TestConnection = (properties: unknown, env: ConnectorEnvironment, signal: AbortSignal) => Promise<Result<ConnectionTestResult>>; // planned
interface ConnectionTestResult { readonly success: boolean; readonly message: string; readonly latencyMs: number; }
```

| ID | Requirement | Pri | Verify | Status |
|---|---|---|---|---|
| CPI-CFG-01 | Each connector type shall have one strict property schema per direction, the only place a default is set, used by deploy validation, the factory, the editor's defaults and the reference page; a key the schema does not list, or a value of the wrong type, shall refuse the deploy with every issue listed as `path: message`. | P1 | Test | Proposed |
| CPI-CFG-02 | Each property shall be declared `deciding`, `free` or `credentials`; a property declared `credentials` shall be masked in every read by that declaration, and an import shall keep a stored credential only while every property not declared `free` or `credentials` is unchanged, an undeclared one counting as `deciding`. | P1 | Test | Proposed |
| CPI-CFG-03 | `${NAME}` and `${category.NAME}` references to the configuration map shall be resolved at deploy before the schema is applied, except inside scripts and SQL; a reference that does not resolve in a property that takes no message variables shall refuse the deploy and name the reference, and the stored deployment shall keep the text as written. | P1 | Test | Proposed |
| CPI-CFG-04 | A security setting that is malformed or half set (a certificate without its key, an authentication guard without its credential, a host key check without a key) shall refuse the deploy; a connector shall never run without the protection its settings name. | P1 | Test | Proposed |
| CPI-CFG-05 | `TestConnection` shall check properties with the same schema and resolve the same references as a deploy, use the client the connector sends or receives with, refuse loopback and reserved addresses and paths outside `env.fileRoots` before touching them, send no message and change nothing at the partner, and resolve within 10 seconds. | P2 | Test | Proposed |

- CPI-CFG-01: source: D-274, `packages/core-models/src/schemas/*-connector.schema.ts`, `validateConnectorProperties` in `packages/server/src/services/connector-validation.service.ts`, docs/user/connector-reference.md "Connectors at a glance". Legacy keys a past editor or importer saved are dropped or mapped in the schema and listed in docs/ops/upgrade.md.
- CPI-CFG-02: source: D-335, `CONNECTOR_KEYS` in `packages/server/src/lib/stored-credentials.ts`. Today masking goes by fragments of the key's name (`isSecretPropertyKey` in `packages/server/src/lib/secret-redaction.ts`), and the declared `credentials` lists are used only by import.
- CPI-CFG-03: source: D-246, D-275, D-276, D-328 ("the record keeps the unresolved channel"), `packages/server/src/lib/config-references.ts`, `withConfigReferences` in `deployment.service.ts`. Today a port names the unresolved reference, and other properties keep it as text.
- CPI-CFG-04: source: D-277, `packages/connectors/src/tls.ts`, `missingCredential` in `http/http-receiver.ts`, docs/user/connector-reference.md "SFTP security".
- CPI-CFG-05: source: `packages/server/src/services/connection-test.service.ts`, D-262, D-315, D-337, D-276 (Test Connection does not resolve references, #92). Today each tester reads properties itself rather than through the schema, apart from Kafka and AMQP, and lives in the server, not with the connector. #133 lists configurations that pass the test and fail later.

## Manifest (MAN)

```ts
interface ConnectorManifest {                             // planned
  readonly id: string; readonly name: string; readonly version: string;   // semver
  readonly contract: string;                              // a semver range, such as '^1.0.0'
  readonly source?: ConnectorProperties<unknown>; readonly destination?: ConnectorProperties<unknown>;
  readonly capabilities: { readonly tls: boolean; readonly binary: boolean; readonly cancellable: boolean; readonly testConnection: boolean };
  readonly permissions: readonly ('network-listen' | 'network-connect' | 'files')[];
}
```

| ID | Requirement | Pri | Verify | Status |
|---|---|---|---|---|
| CPI-MAN-01 | Every connector type, built-in ones included, shall have exactly one `ConnectorManifest`, from which the server and the editor take the list of types, their directions, labels, property keys and capabilities; a type missing any of them shall fail the build. | P2 | Test | Proposed |
| CPI-MAN-02 | `id` shall match `^[A-Z][A-Z0-9_]*$` for a built-in type, and once a released version can store it in a channel shall neither change nor be reused for another connector. | P2 | Test | Proposed |
| CPI-MAN-03 | Every built-in type shall have exactly one `ConnectorManifest`, from which the server and the editor take its directions, label, property keys and capabilities; a type missing one shall fail the build. | P2 | Test | Proposed |

- CPI-MAN-01: source: AGENTS.md "Adding a connector" (seven places, several keyed by a plain string "so nothing tells you when one is missing"); ROADMAP v2.1 "Plugin manifest". Today there is no manifest; `extension.service.ts` lists nine of the thirteen connectors by hand.
- CPI-MAN-02: source: `SOURCE_CONNECTOR_TYPES` and `DESTINATION_CONNECTOR_TYPES` in `packages/core-models/src/constants.ts` (the type string stored in every channel); D-274 on stored values. The pattern is what the thirteen types already match.
- CPI-MAN-03: source: srs-debate 2026-11-24, finding C34 (Scope 9). Replaces CPI-MAN-01: when this row is accepted, that row becomes Superseded by CPI-MAN-03.

## Registration and loading (REG)

```ts
interface FileRoots { readonly allowed: readonly string[]; readonly denied: readonly string[]; }
type ConnectorLogger = Record<'debug' | 'info' | 'warn' | 'error', (record: Readonly<Record<string, unknown>>, message: string) => void>; // planned
interface ConnectorEnvironment {
  readonly fileRoots: FileRoots;
  readonly logger: ConnectorLogger; readonly reportStatus: ReportStatus;  // planned
  readonly storage: { get(key: string): Promise<string | null>; set(key: string, value: string): Promise<void> }; // planned (CPI-REG-04)
}
function createSourceConnector(type: string, properties: Record<string, unknown>, env: ConnectorEnvironment): SourceConnectorRuntime;
function createDestinationConnector(type: string, properties: Record<string, unknown>, env: ConnectorEnvironment): DestinationConnectorRuntime;
```

| ID | Requirement | Pri | Verify | Status |
|---|---|---|---|---|
| CPI-REG-01 | A factory shall throw for a type it does not have in that direction or for properties the schema refuses, before the connector opens anything, and the engine shall fail that channel's deploy with the type or the property named and leave every other channel as it was. | P1 | Test | Proposed |
| CPI-REG-02 | A connector shall open, write, move or delete a path on the server only after checking it, with symbolic links resolved, against `env.fileRoots` at deploy and again at each use, and a connector built without `fileRoots` shall be able to use no path. | P1 | Test | Proposed |
| CPI-REG-03 | The engine shall load a connector that is not built in only at startup and only from a list the operator sets outside the product's own settings, never because a channel, an import or an API call names it, and never over the ID of a built-in or earlier loaded connector. | P3 | Test | Proposed |
| CPI-REG-04 | `env` shall give a connector storage, private to its channel and connector, that survives restart and redeploy. | P2 | Test | Proposed |

- CPI-REG-01: source: `packages/connectors/src/registry.ts`, `packages/connectors/src/__tests__/registry-types.test.ts`, `deploy` in `packages/server/src/engine.ts`; D-328 (each channel's startup redeploy runs by itself).
- CPI-REG-02: source: D-315, D-326, `resolveWithinRoots` in `file/file-roots.ts`. The remaining check-then-use gap is stated in D-315.
- CPI-REG-03: source: ROADMAP v2.1 "Runtime plugin discovery" and "[DECIDE] Extension/plugin platform"; docs/design/13-non-connector-gap-analysis.md "On the extension system". Not decided. The operator-only list follows D-315, which keeps such settings in the environment so an administrator in the product cannot widen them.
- CPI-REG-04: source: srs-debate 2026-11-24, finding C36 (Customer 13; Scope would cut it as pre-empting the plugin decision).

## Compatibility (VER)

```ts
const CONNECTOR_CONTRACT_VERSION = '0.1.0';               // planned; equals the version of this document
```

| ID | Requirement | Pri | Verify | Status |
|---|---|---|---|---|
| CPI-VER-01 | Within one major version the contract shall only gain optional members, and a connector that passes the conformance kit of `1.x` shall pass it unchanged on every later `1.y`; a member to be removed shall first be marked deprecated for at least one minor version and log one warning per deployment that uses it. | P2 | Test | Proposed |
| CPI-VER-02 | An upgrade of a connector shall read the properties, quarantine ledgers, dispatched markers and stored variables every earlier release wrote, or refuse the deploy with the property named and an entry in the upgrade notes; it shall never ignore or reinterpret one. | P1 | Test | Proposed |
| CPI-VER-03 | The engine shall refuse a connector whose `contract` range does not include `CONNECTOR_CONTRACT_VERSION`, name both versions in an ERROR event, start every channel that does not use it, and refuse to deploy the channels that do. | P3 | Test | Proposed |

- CPI-VER-01: source: this document's Versioning section; docs/design/18-voice-of-the-user.md row DOC5 ("A stable API must come before a marketplace"). The deprecation window is this draft's number.
- CPI-VER-02: source: D-274 (legacy keys and values handled in the schema, each listed in docs/ops/upgrade.md), D-309 and D-205 (`LEGACY_QUARANTINE_LEDGER_NAMES`, `LEGACY_DISPATCHED_KEYWORDS`), D-343 (variables stored by an earlier version).
- CPI-VER-03: source: ROADMAP v2.1 "Plugin manifest"; docs/design/09-feature-comparison-and-vision.md "Plugin Marketplace / Registry" ("versioning and compatibility checks"). Not decided.

## Health and logging (HLT)

```ts
type ConnectionState = 'IDLE' | 'CONNECTING' | 'CONNECTED' | 'RECEIVING' | 'SENDING' | 'WAITING' | 'DISCONNECTED'; // planned
type ReportStatus = (status: { readonly state: ConnectionState; readonly connections?: number; readonly reason?: string }) => void; // planned
```

| ID | Requirement | Pri | Verify | Status |
|---|---|---|---|---|
| CPI-HLT-01 | A connector shall report each change of its `ConnectionState` within 1 second; a connector that lost or cannot reach its partner shall report `DISCONNECTED` with a reason, and log that outage once until the partner has been reached again. | P2 | Test | Proposed |
| CPI-HLT-02 | No log record, error message, status reason or `ConnectionTestResult` from a connector shall hold message content, a variable's value or a credential, and no `sourceMap` shall hold a credential the sender presented. | P1 | Test | Proposed |
| CPI-HLT-03 | A connector shall log only through `env.logger`, whose records carry the channel ID, the destination's `metaDataId` (0 for the source) and the connector type, and the `messageId` when there is one. | P2 | Test | Proposed |
| CPI-HLT-04 | No log record, status reason, `reportError` call or `ConnectionTestResult` from a connector shall hold message content, a variable's value, partner answer text or a credential; a response's `errorMessage` and `content`, stored as message content, may hold all but a credential. | P1 | Test | Proposed |
| CPI-HLT-05 | No output of a connector, errors and `sourceMap` included, shall hold a credential. | P1 | Test | Proposed |

- CPI-HLT-01: source: ROADMAP N10, docs/user/capabilities.md "Connection status per connector" (No), docs/design/13-non-connector-gap-analysis.md "Per-connector connection state" (Mirth's IDLE, READING, WRITING, POLLING, CONNECTED, WAITING, DISCONNECTED); D-336 for the single outage record. Not built, except the once-per-outage log in TCP_MLLP.
- CPI-HLT-02: source: AGENTS.md "No credential logging", docs/standards/LoggingStandard.md, `withoutCredentials` in `http/http-receiver.ts`, `RecordPosition` in `kafka/kafka-receiver.ts`. A known open case is #321. The kit proves it by sending marked content and credentials and searching every output for the marks.
- CPI-HLT-03: source: docs/design/03-connectors.md "Deploy Context" (a logger scoped to the connector), docs/standards/LoggingStandard.md "Child Loggers and Context". Today `createConnectorLogger` in `logger.ts` tags the connector type only, so a record does not say which channel it came from.
- CPI-HLT-04: source: srs-debate 2026-11-24, finding C6 (Tester 5, Contractor 5, Domain, Scope). Replaces CPI-HLT-02: when this row is accepted, that row becomes Superseded by CPI-HLT-04.
- CPI-HLT-05: source: srs-debate 2026-11-24, finding C6 (Contractor 5). The credential half of CPI-HLT-02.

## Conformance kit (TCK)

```ts
interface ConformanceCase { readonly id: string; readonly direction: 'source' | 'destination'; run(subject: ConformanceSubject): Promise<void>; } // planned
interface FaultingPartner { start(): Promise<void>; stop(): Promise<void>; next(fault: 'refuse' | 'accept-part' | 'close' | 'late' | 'none'): void; } // planned
interface ConformanceSubject { create(env: ConnectorEnvironment): ConnectorLifecycle; readonly partner: FaultingPartner; readonly manifest: ConnectorManifest; } // planned
```

| ID | Requirement | Pri | Verify | Status |
|---|---|---|---|---|
| CPI-TCK-01 | One conformance kit shall hold a case, named by row ID, for every row of this document whose Verify is Test and that a connector must meet; every built-in connector shall pass the kit against a real partner in CI in each direction it has, and a case that cannot run shall fail the build instead of being skipped. | P1 | Test | Proposed |
| CPI-TCK-02 | The kit shall inject for a source a dispatcher that answers `{ ok: false }`, answers `ERROR`, never settles until a halt, and a process killed between dispatch and acceptance; and for a destination a partner that refuses, accepts in part, closes before it answers and answers after the abort; and shall fail when an input is lost, an input is accepted before it is recorded, or a message not accepted is reported `SENT`. | P1 | Test | Proposed |
| CPI-TCK-03 | The kit shall mark every Test row `engine`, `connector` or `both` and hold a case, named by row ID, for each of the last two; each case shall run for every built-in connector and direction the kit does not exempt with a reason, against a real partner where CI runs one and a faulting fake otherwise, and one that does not run shall fail the build. | P1 | Test | Proposed |

- CPI-TCK-01: source: ROADMAP v2.1 "Custom connector SDK"; D-273 (a missing service fails the run, never a quiet skip); AGENTS.md "Verification Matrix", engine pipeline or a connector. Today each connector has its own tests and no shared kit; `registry-types.test.ts` and `variables-used.test.ts` are the only ones that run over every type.
- CPI-TCK-02: source: the rows above; the fakes in `packages/connectors/src/__fixtures__/` and `dispatch-failure.test.ts` cover parts of it per connector. No test kills the process between dispatch and acceptance.
- CPI-TCK-03: source: srs-debate 2026-11-24, finding C35 (Tester 1; Customer and Domain keep it P1 against Scope 10). Replaces CPI-TCK-01: when this row is accepted, that row becomes Superseded by CPI-TCK-03.

## Version history

- 0.1.0 (2026-11-24): first draft, from `packages/connectors/src`, the engine's use of it, and the decisions it cites. Every row is Proposed. The rows of the debate of 2026-11-24 were added the same day, before anything was accepted.
