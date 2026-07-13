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

## Grouped View Layout

| # | Scenario | Steps | Expected | Pass? |
|---|---|---|---|---|
| 17 | Header alignment | Switch to grouped view | Column headers (Name, State, Received, etc.) align with group row cells | |

## Deploy Action Feedback

| # | Scenario | Steps | Expected | Pass? |
|---|---|---|---|---|
| 18 | Deploy success toast | Deploy a channel from quick actions | Toast notification confirms successful deploy | |
| 19 | Start success toast | Start a stopped channel | Toast notification confirms channel started | |
| 20 | Stop success toast | Stop a started channel | Toast notification confirms channel stopped | |
| 21 | Action error toast | Attempt deploy when server has an issue | Error toast notification with reason displayed | |

## Send Message

| # | Scenario | Steps | Expected | Pass? |
|---|---|---|---|---|
| 22 | Send via context menu | Right-click a started channel, select "Send Message" | Send Message dialog opens with Monaco editor | |
| 23 | Send succeeds | Enter message content in dialog, click Send | Dialog closes, success toast, message appears in Message Browser | |
| 24 | Send not available for stopped | Right-click a stopped channel | "Send Message" option is absent or disabled | |

## Error/Empty States

| # | Scenario | Steps | Expected | Pass? |
|---|---|---|---|---|
| 25 | No channels | Delete all channels, view Dashboard | Empty table or "No channels" message | |
| 26 | API error | Stop server, view Dashboard | Error alert displayed | |

## Dashboard Overhaul — Channel Management (list retired, everything from here)

| # | Scenario | Steps | Expected | Pass? |
|---|---|---|---|---|
| 27 | /channels redirects | Navigate to `/channels` | Redirects to the Dashboard (`/`); no Channels nav item exists | |
| 28 | Header authoring actions | View the Dashboard header | New Channel, Import, Export, New Group, Columns buttons present | |
| 29 | New Channel from header | Click "New Channel", complete the dialog | Channel created; appears in the table | |
| 30 | Context menu: full actions | Right-click a channel | Edit, Messages, Statistics, Enable/Disable, deploy lifecycle (state-aware), Send Message, Change Group, Clone, Export, Delete | |
| 31 | Enable/Disable | Right-click a channel → Enable/Disable | Label reflects current state; toggling flips enabled | |
| 32 | Clone from context menu | Right-click → Clone → confirm | Clone dialog prefilled "Copy of …"; clone created disabled | |
| 33 | Delete from context menu | Right-click → Delete → confirm | MUI confirm dialog; channel removed | |
| 34 | Tags inline | Assign tags to a channel, view Dashboard | Tag chips render next to the channel name, readable on light/dark colors | |
| 35 | Configurable columns | Click "Columns", toggle Source/Rev/Updated | Columns appear/disappear; choice persists across reloads (per-user) | |
| 36 | Column values | Enable Source/Rev/Updated (server restarted) | Values populate from the channel metadata | |
| 37 | Group right-click menu | Right-click a group header | Menu with Deploy/Start/Stop/Undeploy all, Rename, Delete | |
| 38 | Group bulk lifecycle | Group menu → "Start all" | Only applicable (STOPPED) channels start; toast summarizes count | |
| 39 | Drag to regroup | Drag a channel's handle onto another group header | Row moves to that group and persists; drop target highlights while hovering | |
| 40 | Drag to Ungrouped | Drag a channel onto the Ungrouped section header | Channel's group membership is removed | |
