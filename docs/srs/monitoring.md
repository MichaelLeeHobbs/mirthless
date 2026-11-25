# Monitoring and alerts

Seeing what every channel is doing, being told when one is wrong, and giving other tools the same facts: dashboard, connection status, error triage, alerts and their delivery, health, metrics, events, logs and tracing. Area code `MON`. The alert before a certificate expires and the rules for sending mail passwords belong to Security (`SEC`), the protected access record and the reasons for exports to Audit (`AUD`), the live feeds to REST API and live updates (`API`), how fresh a screen must be to Admin console (`UI`), what a log must never hold to Security (`SEC`), one message's own detail to Messages (`MSG`), and which channels a person may see to Access control (`ACC`).

## Dashboard (DASH)

| ID | Requirement | Pri | Verify | Status |
|---|---|---|---|---|
| MON-DASH-01 | The system shall show on one dashboard, for every channel the user may see, its state, its received, filtered, sent and errored counts since they were last reset, the deliveries queued, and the time it last received a message. | P1 | Test | Proposed |
| MON-DASH-02 | The system shall raise a channel's received, filtered, sent or errored count by exactly one for each such outcome it records, with no outcome uncounted or counted twice across stops, crashes and recovery, and shall show as queued the number of deliveries waiting at that moment. | P1 | Test | Proposed |

- MON-DASH-01: source: docs/user/capabilities.md "Live dashboard of channel state and counts" (Yes); D-026; the time of the last message is from docs/research/voice-of-user/ranking.md MON5 (a user asks for "time since last message"). How fresh the dashboard must be is an Admin console rule (D-306; D-025 set 5-second polling and is superseded).
- MON-DASH-02: source: D-026; D-132 (a source is not counted as sent when a destination failed, so failures are not hidden); D-213 and D-233 (a message run again after a stop is a new message and counts as received again; its interrupted original adds no error). Pruning messages lowers no count.

## Connector status and triage (CST)

| ID | Requirement | Pri | Verify | Status |
|---|---|---|---|---|
| MON-CST-01 | The system shall show, for each source and destination of a deployed channel, whether it is idle, connected, receiving, polling, sending, waiting to retry or disconnected, the number of open connections, the deliveries queued for it, and the time and reason of its last failure, within 5 seconds of a change. | P2 | Test | Proposed |
| MON-CST-02 | The system shall list the errors of a chosen period across every channel the user may see, grouped by channel, connector, processing stage and cause, with a count and the first and last time, and open the messages behind each group. | P2 | Demonstration | Proposed |
| MON-CST-03 | The system shall mark a running channel as degraded when its error rate or processing time over the last 15 minutes is worse than limits an operator can set, with the reason. | P3 | Test | Proposed |

- MON-CST-01: source: docs/user/capabilities.md "Connection status per connector" (No); ROADMAP N10; docs/design/13-non-connector-gap-analysis.md section 7. The 5 seconds is the drafter's.
- MON-CST-02: source: ROADMAP V1 (error triage view); docs/research/voice-of-user/ranking.md MON7; D-248 for the kept failure reason. The grouping is the drafter's reading of "triage".
- MON-CST-03: source: ROADMAP v1.2 "Channel health scoring" ("automated detection of degraded channels (error rate, latency spikes)"). The 15 minutes is the drafter's.

## Alert conditions (ALT)

| ID | Requirement | Pri | Verify | Status |
|---|---|---|---|---|
| MON-ALT-01 | The system shall raise an alert when a message fails in any channel the alert covers (all channels, or those chosen), if the failure is of a chosen kind and its error text matches the alert's pattern when one is set. | P1 | Test | Proposed |
| MON-ALT-02 | The system shall let an alert be limited to chosen connectors of a channel and to chosen processing stages (preprocessor, source filter and transformer, destination filter and transformer, send, response, postprocessor, deploy and undeploy script), and every stage it offers shall be one that failures are reported under. | P2 | Test | Proposed |
| MON-ALT-03 | The system shall raise an alert within 60 seconds when a channel that was deployed to run is not running for a reason other than a person's action: its source stopped itself, it could not be brought back at server start, or it is held back after hanging the server. | P1 | Test | Proposed |
| MON-ALT-04 | The system shall raise an alert within 60 seconds when a started channel has received no message for a set window of 1 minute to 7 days, once per silence and again only at the alert's repeat interval, and shall not count time in which the channel was stopped or paused. | P1 | Test | Proposed |
| MON-ALT-05 | The system shall let a silence alert count silence only inside chosen days and hours in a chosen time zone, correct across midnight and daylight-saving changes. | P2 | Test | Proposed |
| MON-ALT-06 | The system shall raise an alert when more than a set number of messages stay queued for a set number of minutes, or the oldest queued message is older than a set number of minutes, for a channel or one destination, once until the queue recovers. | P2 | Test | Proposed |
| MON-ALT-07 | The system shall raise an alert when a channel has more than a set number of errors, or more than a set percentage of at least a set number of messages fail, within a set number of minutes. | P2 | Test | Proposed |
| MON-ALT-08 | The system shall apply a created, changed, enabled, disabled or deleted alert to every running channel it covers within 60 seconds, without a redeploy. | P1 | Test | Proposed |
| MON-ALT-09 | The system shall send one alert for one channel at most once per the alert's repeat interval (1 minute when none is set, every time when set to 0) and at most its set maximum number of times, counting an alert from when its sending begins. | P1 | Test | Proposed |
| MON-ALT-10 | The system shall keep the time and number of alerts already sent across a server restart, so that a restart sends no alert the repeat interval or maximum would have held back. | P2 | Test | Proposed |
| MON-ALT-11 | The system shall not delay a message's processing or its reply to the sender for the sending of an alert. | P1 | Test | Proposed |
| MON-ALT-12 | The system shall refuse to save an enabled alert that can never fire or reach anyone, such as one whose pattern does not compile or that has no action, and say why. | P2 | Test | Proposed |

- MON-ALT-01: source: docs/user/capabilities.md "Alert by email on channel errors" (Yes); D-060, D-122, D-132, D-228; a queued delivery alerts on the first failure of a streak, not when retries run out (D-230).
- MON-ALT-02: source: docs/user/capabilities.md "Scope an alert to one connector or error stage" (No); ROADMAP N15; docs/design/13-non-connector-gap-analysis.md section 7 ("stage mapping thin").
- MON-ALT-03: source: D-271 (a source that stops itself raises an alert); D-308, D-328 and D-340 (a channel not brought back, or held, is an event and degraded health); docs/design/08-paid-plugin-analysis.md "Advanced Alerting" (channel state alerts); docs/research/voice-of-user/ranking.md MON1. The 60 seconds is the drafter's.
- MON-ALT-04: source: docs/user/capabilities.md "Alert when a channel receives nothing for a while" (Yes); D-192; the 1 minute to 7 days is from code only.
- MON-ALT-05: source: #338 (active hours); ROADMAP V1, B1.
- MON-ALT-06: source: docs/user/capabilities.md "Alert on queue depth and error rate" (No); #338; ROADMAP B1.
- MON-ALT-07: source: docs/user/capabilities.md "Alert on queue depth and error rate" (No); #338; ROADMAP V1.
- MON-ALT-08: source: code only: alerts are read when a channel deploys (D-328 "read live at every deploy", D-062 "reload alerts on redeploy"). conflict: those make an alert change wait for a redeploy, while nothing on the Alerts page says so; immediate kept, because an alert someone believes is on and is not is a silent failure.
- MON-ALT-09: source: D-060; D-217 ("counted before they are sent"; once a minute by default, 0 means every error). conflict: docs/testing/25-alert-evaluation.md says no interval means no limit; D-217 kept.
- MON-ALT-10: source: ROADMAP "Persist alert throttle state"; docs/user/capabilities.md "Alert by email on channel errors" (limit). conflict: D-217 and D-062 accept the loss, ROADMAP plans to end it; ROADMAP kept.
- MON-ALT-11: source: D-217.
- MON-ALT-12: source: docs/ops/upgrade.md "An alert's regex must compile (#133)" for the pattern; the missing action is the drafter's extension of the same rule.

## Alert delivery (DLV)

| ID | Requirement | Pri | Verify | Status |
|---|---|---|---|---|
| MON-DLV-01 | The system shall send an alert, with a subject and body from the alert's own templates or a default text, to every email address the alert lists. | P1 | Test | Proposed |
| MON-DLV-02 | The system shall send an alert's text as a message into another started channel the alert names, and shall refuse to send it into the channel the alert is about. | P1 | Test | Proposed |
| MON-DLV-03 | The system shall send an alert as a web request to an address with a method, headers and JSON body the alert's owner sets, with ready-made bodies for Slack, Microsoft Teams and PagerDuty. | P2 | Test | Proposed |
| MON-DLV-04 | The system shall send an alert as a push notification to the phones that the users or roles it names have registered from their own accounts, and stop sending to a phone the push service reports as gone. | P3 | Test | Proposed |
| MON-DLV-05 | The system shall send an unacknowledged alert to the next person or group of its on-call schedule after a set number of minutes, until someone acknowledges it or the schedule ends. | P3 | Test | Proposed |
| MON-DLV-06 | The system shall end each attempt to deliver an alert, by any kind of action, after 30 seconds at most and retry a failed one three times at growing intervals, except when the receiver refused it as invalid. | P1 | Test | Proposed |
| MON-DLV-07 | The system shall record every alert delivery that did not succeed, including one a server stop cut short, with the alert, channel, action, recipient or target and cause, where a person who may read events finds it. | P1 | Test | Proposed |
| MON-DLV-08 | The system shall not put message content, attachments or map values into an alert; the only text from a message an alert may carry is the failure's error text. | P1 | Test | Proposed |
| MON-DLV-09 | The system shall leave the error text out of every push alert, and out of a web request alert unless the person setting it up has turned it on after a warning that it can hold PHI. | P1 | Test | Proposed |

- MON-DLV-01: source: docs/user/capabilities.md "Alert by email on channel errors" (Yes); D-064, D-068, D-275 (template names).
- MON-DLV-02: source: D-217 ("refuses the channel the alert is about").
- MON-DLV-03: source: docs/user/capabilities.md "Webhook alert action and an error triage view" (No); #336; ROADMAP V1. Which addresses it may reach is undecided in #336.
- MON-DLV-04: source: docs/user/capabilities.md "Push alerts to a phone" (No); #147.
- MON-DLV-05: source: ROADMAP v1.2 "Alert escalation chains"; docs/design/08-paid-plugin-analysis.md "Advanced Alerting" (escalation, on-call); docs/research/voice-of-user/ranking.md MON2.
- MON-DLV-06: source: #336 ("a timeout, three retries with backoff ... apply to email and channel actions too"); the 30 seconds is the default time limit in AGENTS.md.
- MON-DLV-07: source: #336 ("a failed delivery of any action type leaves a record naming the cause"); a delivery cut short by a stop is the drafter's reading of the same rule.
- MON-DLV-08: source: docs/user/access-control.md `alerts:write` ("Alert emails carry the error text of the failure"); #147 and #336; the alert template names in code.
- MON-DLV-09: source: #147 ("No PHI in the payload"); #336 ("No message text by default"). Email's default text does carry the error text (docs/user/access-control.md `alerts:write`), and no source says otherwise.

## Health (PRB)

| ID | Requirement | Pri | Verify | Status |
|---|---|---|---|---|
| MON-PRB-01 | The system shall answer a liveness check without sign-in and without using the database, so that a database outage never makes it look dead. | P1 | Test | Proposed |
| MON-PRB-02 | The system shall answer a readiness check without sign-in: unavailable while the database cannot be reached, degraded, and still in service, with the names of the start-up steps that failed, and ready otherwise. | P1 | Test | Proposed |
| MON-PRB-03 | The system shall give error texts, channel counts, memory use and metrics only to a caller with the system information permission, except that an administrator may make the metrics, and nothing else, readable without sign-in. | P1 | Test | Proposed |

- MON-PRB-01: source: docs/user/capabilities.md "Health endpoints for probes" (Yes); D-070; docs/ops/resource-and-observability.md "Health & Readiness Endpoints".
- MON-PRB-02: source: D-308; docs/ops/resource-and-observability.md "Startup steps".
- MON-PRB-03: source: docs/ops/resource-and-observability.md "Health & Readiness Endpoints" and "Metrics"; D-150; D-308 ("the public readiness body names steps only"). conflict: D-070 made the full status public; the later split in the page kept.

## Metrics (MET)

| ID | Requirement | Pri | Verify | Status |
|---|---|---|---|---|
| MON-MET-01 | The system shall give, in the Prometheus text format, the current number of deployed and of started channels, the number of messages processed, the database connections in use and idle, the API requests by method, route and outcome with their duration, and its own memory and CPU use, each equal to the true value when read. | P1 | Test | Proposed |
| MON-MET-02 | The system shall give, per channel and connector, the Prometheus metrics for messages received, filtered, sent and errored, messages queued, time from receipt to delivery at the 50th, 95th and 99th percentile, and state, labelled by channel and connector and by nothing taken from a message. | P2 | Test | Proposed |

- MON-MET-01: source: docs/user/capabilities.md "Prometheus metrics" (Yes); docs/ops/resource-and-observability.md "Metrics"; the list of metrics is from code and docs/ops/upgrade.md.
- MON-MET-02: source: ROADMAP N10 and v1.2 "Prometheus metrics enhancement" ("per-channel throughput, latency percentiles, queue depth"); the label rule follows from docs/ops/resource-and-observability.md "PHI in logs". The percentiles are the drafter's.

## Event log (EVT)

| ID | Requirement | Pri | Verify | Status |
|---|---|---|---|---|
| MON-EVT-01 | The system shall record each deploy, undeploy, start, stop, pause, enabling and disabling of a channel, and each start-up step or redeploy that failed, with the time, level, outcome, channel and reason, and the user or the system itself as its cause. | P1 | Test | Proposed |
| MON-EVT-02 | The system shall let a person find events by date range, level, kind, outcome, user and channel, and export what they found as CSV or JSON, saying in the file when a row limit left some out. | P2 | Test | Proposed |

- MON-EVT-01: source: docs/user/capabilities.md "Event log of user and system actions" (Yes); D-271 (`CHANNEL_STOPPED` with its reason), D-308, D-328, D-340. What is recorded about people and PHI belongs to Audit.
- MON-EVT-02: source: docs/user/capabilities.md "Event log of user and system actions" (Yes); docs/testing/16-events.md. An export holds at most 50,000 rows, from code only; saying that rows were left out is the drafter's.

## Logs (LOG)

| ID | Requirement | Pri | Verify | Status |
|---|---|---|---|---|
| MON-LOG-01 | The system shall show a person with the system information permission the last 10,000 server log entries, newest first and live, filtered by level, text and channel, with the channel named on every entry about one. | P2 | Test | Proposed |
| MON-LOG-02 | The system shall write what a channel script sends to its logger to the server log, with the level, channel, message identifier and script, within 5 seconds and in order. | P1 | Test | Proposed |

- MON-LOG-01: source: docs/user/capabilities.md "Server log viewer" (Yes, in memory, last 10,000 entries); D-110, D-111; docs/research/voice-of-user/ranking.md MON6 for the channel. conflict: docs/design/06-web-admin.md plans historical logs by date; D-110 (memory only, log aggregation outside) kept.
- MON-LOG-02: source: docs/user/capabilities.md "Script logger output in the message browser" (No); #164. conflict: the capability names the message browser, #164 leaves the choice between the server log, the message record or both open; the server log kept, as in Mirth. #164 also asks for a limit, so that a script in a loop cannot flood the log. A script's own text can hold PHI, which is the script author's choice. The 5 seconds is the drafter's.

## Tracing (TRC)

| ID | Requirement | Pri | Verify | Status |
|---|---|---|---|---|
| MON-TRC-01 | The system shall show, from any message, every message it came from and every message it caused in other channels, with the channel, status and time of each step, limited to channels the user may see. | P2 | Test | Proposed |
| MON-TRC-02 | The system shall send trace data for each message and each of its steps across channels to an OpenTelemetry collector an administrator names, with identifiers, names, times and outcomes only. | P3 | Test | Proposed |

- MON-TRC-01: source: docs/user/capabilities.md "Trace a message across channels with OpenTelemetry" (No); ROADMAP B4; docs/research/voice-of-user/ranking.md MON8; a message reprocessed within its channel is a Messages rule (#339).
- MON-TRC-02: source: docs/user/capabilities.md "Trace a message across channels with OpenTelemetry" (No); ROADMAP B4, v1.2 "OpenTelemetry tracing". The limit to identifiers is the rule for logs applied to traces.
