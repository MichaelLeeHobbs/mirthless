# 09 — Dashboard

## Prerequisites
- Logged in as admin
- At least one channel exists (ideally one deployed/started with some message traffic)

## Summary Cards

| # | Scenario | Steps | Expected | Pass? |
|---|---|---|---|---|
| 1 | Cards displayed | Navigate to Dashboard (/) | 4 summary cards visible: Total Channels, Received, Sent, Errored | |
| 2 | Counts reflect data | Deploy and start a channel, send a message | Received/Sent counts increment | |
| 3 | Zero state | No messages processed yet | Received, Sent, Errored all show 0 | |
| 4 | Error count | Send a message that causes an error | Errored count increments | |

## Channel Status Table

| # | Scenario | Steps | Expected | Pass? |
|---|---|---|---|---|
| 5 | Table shows channels | View Dashboard with channels | Table lists all channels with columns | |
| 6 | State chip — STARTED | Start a deployed channel | Green chip shows STARTED | |
| 7 | State chip — STOPPED | Stop a channel | Red chip shows STOPPED | |
| 8 | State chip — PAUSED | Pause a channel | Chip shows PAUSED | |
| 9 | State chip — UNDEPLOYED | Channel not deployed | Chip shows UNDEPLOYED | |
| 10 | Per-channel stats | Send messages through channel | Received/Sent/Filtered/Errored columns update | |

## Quick Actions

| # | Scenario | Steps | Expected | Pass? |
|---|---|---|---|---|
| 11 | Deploy channel | Click deploy action on undeployed channel | Channel deploys, state chip updates | |
| 12 | Start channel | Click start on stopped channel | State changes to STARTED | |
| 13 | Stop channel | Click stop on started channel | State changes to STOPPED | |
| 14 | Pause/Resume | Click pause on started, then resume | State toggles PAUSED ↔ STARTED | |
| 15 | Undeploy channel | Click undeploy on deployed channel | State returns to UNDEPLOYED | |

## Auto-Refresh

| # | Scenario | Steps | Expected | Pass? |
|---|---|---|---|---|
| 16 | Stats auto-update | Send messages while watching dashboard | Counts update without manual refresh (~5s polling) | |

## Error/Empty States

| # | Scenario | Steps | Expected | Pass? |
|---|---|---|---|---|
| 17 | No channels | Delete all channels, view Dashboard | Empty table or "No channels" message | |
| 18 | API error | Stop server, view Dashboard | Error alert displayed | |
