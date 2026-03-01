# 25 — Alert Evaluation Engine

## Prerequisites
- Logged in as admin
- At least two channels deployed
- At least one alert configured (via Alerts page or API)

## Alert Trigger Matching

| # | Scenario | Steps | Expected | Pass? |
|---|---|---|---|---|
| 1 | Alert matches specific channel | Create alert with channelIds=[channelA], trigger error on channelA | Alert fires | |
| 2 | Alert does not match excluded channel | Create alert with channelIds=[channelA], trigger error on channelB | Alert does not fire | |
| 3 | Alert with empty channelIds matches all | Create alert with channelIds=[], trigger error on any channel | Alert fires for all channels | |
| 4 | Error type ANY matches all error types | Create alert with errorTypes=["ANY"], trigger SOURCE_CONNECTOR error | Alert fires | |
| 5 | Error type filter matches specific type | Create alert with errorTypes=["SOURCE_CONNECTOR"], trigger SOURCE_CONNECTOR error | Alert fires | |
| 6 | Error type filter excludes non-matching type | Create alert with errorTypes=["DESTINATION_CONNECTOR"], trigger SOURCE_CONNECTOR error | Alert does not fire | |
| 7 | Regex matches error message | Create alert with regex="timeout.*connection", trigger error "timeout on connection" | Alert fires | |
| 8 | Regex does not match error message | Create alert with regex="^fatal", trigger error "warning: low memory" | Alert does not fire | |
| 9 | No regex means all messages match | Create alert with regex=null | Alert fires regardless of error message content | |
| 10 | Invalid regex treated as no match | Create alert with regex="[invalid" | Alert does not fire (invalid regex safely handled) | |
| 11 | Disabled alert never matches | Create alert with enabled=false, trigger matching error | Alert does not fire | |
| 12 | Only CHANNEL_ERROR trigger type matches | Create alert with trigger.type="OTHER_TYPE" | Alert does not fire for channel errors | |

## Alert Throttling

| # | Scenario | Steps | Expected | Pass? |
|---|---|---|---|---|
| 13 | First alert always fires | Create alert with reAlertIntervalMs=60000, trigger error | Alert fires (no prior state) | |
| 14 | Repeated alert within interval suppressed | reAlertIntervalMs=60000, trigger two errors 10s apart | First fires, second suppressed | |
| 15 | Alert fires again after interval expires | reAlertIntervalMs=1000, trigger error, wait >1s, trigger again | Both alerts fire | |
| 16 | No throttle when reAlertIntervalMs is null | reAlertIntervalMs=null, trigger multiple errors rapidly | All alerts fire | |
| 17 | No throttle when reAlertIntervalMs is 0 | reAlertIntervalMs=0, trigger multiple errors | All alerts fire | |
| 18 | maxAlerts limit enforced | maxAlerts=3, trigger 5 errors (no throttle interval) | First 3 fire, last 2 suppressed | |
| 19 | maxAlerts null means unlimited | maxAlerts=null, trigger 100 errors | All 100 fire (assuming no throttle) | |
| 20 | Combined throttle and maxAlerts | reAlertIntervalMs=100, maxAlerts=2, trigger 5 errors over 1s | At most 2 alerts fire, respecting both interval and count | |

## Alert Actions

| # | Scenario | Steps | Expected | Pass? |
|---|---|---|---|---|
| 21 | EMAIL action logs warning (deferred) | Create alert with EMAIL action, trigger error | Warning logged with alertId, alertName, channelId, recipients | |
| 22 | CHANNEL action routes to target | Create alert with CHANNEL action targeting channelX, trigger error | Alert content dispatched to channelX via channelSender | |
| 23 | CHANNEL action with no channelSender | CHANNEL action but channelSender not provided | Warning logged instead of dispatch | |
| 24 | CHANNEL action with send failure | channelSender throws an error | Warning logged with "Failed to dispatch alert to channel" | |
| 25 | Multiple actions on one alert | Alert has EMAIL + CHANNEL actions, trigger error | Both actions executed (EMAIL logged, CHANNEL dispatched) | |
| 26 | Alert content uses body template | bodyTemplate="${alertName}: ${errorMessage} on ${channelId}" | Template variables substituted in dispatched content | |
| 27 | Default alert body format | No bodyTemplate configured | Content includes "Alert: name", "Channel: id", "Error Type: type", "Error: message", "Time: ISO timestamp" | |
| 28 | Subject template substitution | subjectTemplate="${alertName} - ${errorType}" | Template variables substituted correctly | |

## Alert Manager Lifecycle

| # | Scenario | Steps | Expected | Pass? |
|---|---|---|---|---|
| 29 | loadAlerts replaces previous alerts | Load 3 alerts, then load 2 different alerts | getAlerts returns only the 2 new alerts | |
| 30 | handleEvent evaluates all loaded alerts | Load 3 alerts, trigger error matching all 3 | All 3 alert actions dispatched | |
| 31 | handleEvent with no loaded alerts | No alerts loaded, trigger error | No actions dispatched, no errors | |
| 32 | clearThrottleState resets counters | Fire alert 3 times (maxAlerts=3), clearThrottleState, fire again | Alert fires again after clearing | |
| 33 | resetAlert clears single alert state | Fire alertA 3 times (maxAlerts=3), resetAlert(alertA), fire again | alertA fires again; other alerts' throttle state unchanged | |
