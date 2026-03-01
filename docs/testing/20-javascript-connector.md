# 20 — JavaScript Connector

## Prerequisites
- Logged in as admin or deployer
- At least one channel created

## JavaScript Source Connector Form

| # | Scenario | Steps | Expected | Pass? |
|---|---|---|---|---|
| 1 | Select JavaScript source type | Edit channel, Source tab, change connector to JAVASCRIPT | JavaScript source form appears with Script textarea and Polling Interval | |
| 2 | Default values populated | Select JAVASCRIPT connector type | script empty, pollingIntervalMs=5000 | |
| 3 | Enter script text | Type `return 'hello';` in Script textarea | Monospace text area updates | |
| 4 | Change polling interval | Enter 10000 | Value updates | |
| 5 | Save JavaScript source settings | Save channel, reload | Script text and pollingIntervalMs persisted | |

## JavaScript Destination Connector Form

| # | Scenario | Steps | Expected | Pass? |
|---|---|---|---|---|
| 6 | Add JavaScript destination | Destinations tab, add destination, change type to JAVASCRIPT | JavaScript destination form appears with Script textarea | |
| 7 | Default values populated | Select JAVASCRIPT connector type | script empty | |
| 8 | Enter script text | Type `return msg.toUpperCase();` in Script textarea | Monospace text area updates | |
| 9 | Save JavaScript destination settings | Save channel, reload | Script text persisted | |

## JavaScript Source Connector Runtime

| # | Scenario | Steps | Expected | Pass? |
|---|---|---|---|---|
| 10 | Script returns string | Deploy channel with JAVASCRIPT source, script: `return 'test message';` | String dispatched as a single message with content "test message" | |
| 11 | Script returns array of strings | Script: `return ['msg1', 'msg2', 'msg3'];` | Three separate messages dispatched | |
| 12 | Script returns null | Script: `return null;` | No messages dispatched, no errors | |
| 13 | Script returns undefined | Script: `return undefined;` or no return statement | No messages dispatched, no errors | |
| 14 | Script returns empty string | Script: `return '';` | No messages dispatched (empty strings filtered) | |
| 15 | Script returns non-string value | Script: `return 42;` | Value converted to string "42" and dispatched | |
| 16 | Script returns array with mixed types | Script: `return ['valid', null, '', 'also valid'];` | Only non-empty string items dispatched ("valid", "also valid") | |
| 17 | Polling interval respected | Set pollingIntervalMs=2000, script returns one message | Script executes approximately every 2 seconds | |
| 18 | Empty script rejected on deploy | Leave script empty, deploy channel | Deploy fails with "Script is required" error | |
| 19 | Polling interval too low | Set pollingIntervalMs=50, deploy channel | Deploy fails with "Polling interval must be at least 100ms" | |
| 20 | Script error recovery | Script throws an error on first poll | Error logged, next poll cycle still executes | |
| 21 | sourceMap populated | Script returns a message | sourceMap contains connectorType="JAVASCRIPT" and executedAt timestamp | |
| 22 | No sandbox runner fallback | scriptRunner not set (edge case) | No messages dispatched, no crash | |

## JavaScript Destination Connector Runtime

| # | Scenario | Steps | Expected | Pass? |
|---|---|---|---|---|
| 23 | Script executes with msg variable | Script: `return msg.length;`, send "hello" | Response content is "5", status SENT | |
| 24 | Script returns null | Script: `return null;` | Response content is empty string, status SENT | |
| 25 | Script returns undefined | Script: no return statement | Response content is empty string, status SENT | |
| 26 | Script error returns ERROR status | Script: `throw new Error('fail');` | ConnectorResponse status is ERROR with errorMessage | |
| 27 | Empty script rejected on deploy | Leave script empty, deploy channel | Deploy fails with "Script is required" error | |
| 28 | Send aborted | Send with already-aborted AbortSignal | Error: "Send aborted" | |
