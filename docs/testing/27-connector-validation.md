# 27 — Connector Validation at Deploy Time

## Prerequisites
- Logged in as admin or deployer
- At least one channel created

## Source Connector Validation

| # | Scenario | Steps | Expected | Pass? |
|---|---|---|---|---|
| 1 | TCP/MLLP source with valid port | Create channel with TCP/MLLP source, port=6661, deploy | Deploy succeeds | |
| 2 | TCP/MLLP source with port 0 | Set source port=0, attempt deploy | Deploy fails: "Invalid source connector properties for TCP_MLLP: port out of range" | |
| 3 | TCP/MLLP source with port >65535 | Set source port=99999, attempt deploy | Deploy fails with port validation error | |
| 4 | HTTP source with valid port | Create channel with HTTP source, port=8080, deploy | Deploy succeeds | |
| 5 | FILE source with empty directory | Create channel with FILE source, directory='', deploy | Deploy fails: directory required | |
| 6 | FILE source with valid directory | Set directory='/tmp/inbound', deploy | Deploy succeeds | |
| 7 | DATABASE source missing host | Create DATABASE source, clear host, deploy | Deploy fails: host required | |
| 8 | DATABASE source missing selectQuery | DATABASE source with empty selectQuery, deploy | Deploy fails: selectQuery required | |
| 9 | JAVASCRIPT source with empty script | JAVASCRIPT source, script='', deploy | Deploy fails: script required | |
| 10 | CHANNEL source with empty channelId | CHANNEL source, channelId='', deploy | Deploy fails: channelId required | |

## Destination Connector Validation

| # | Scenario | Steps | Expected | Pass? |
|---|---|---|---|---|
| 11 | TCP/MLLP dest missing host | Add TCP/MLLP destination, clear host, deploy | Deploy fails: host required | |
| 12 | HTTP dest missing url | Add HTTP destination, clear url, deploy | Deploy fails: url required | |
| 13 | FILE dest with empty directory | Add FILE destination, directory='', deploy | Deploy fails: directory required | |
| 14 | DATABASE dest missing query | Add DATABASE destination, clear query, deploy | Deploy fails: query required | |
| 15 | SMTP dest missing to | Add SMTP destination, clear 'to' field, deploy | Deploy fails: to required | |
