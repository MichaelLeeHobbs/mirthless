# 06 — Destinations Tab

## Prerequisites
- Logged in as admin
- At least one channel created

## Destination List CRUD

| # | Scenario | Steps | Expected | Pass? |
|---|---|---|---|---|
| 1 | Empty state | Open channel editor, go to Destinations tab | Shows "No destinations. Click + to add one." | |
| 2 | Add destination | Click + button | New "Destination 1" appears in list, selected, settings panel shows | |
| 3 | Add second destination | Click + again | "Destination 2" added at bottom, auto-selected | |
| 4 | Select destination | Click on Destination 1 in list | Settings panel shows Destination 1's values | |
| 5 | Rename destination | Change name field to "Lab Results" | List updates to show "Lab Results" | |
| 6 | Remove destination | Click delete (trash) button | Destination removed from list, selection adjusts | |
| 7 | Remove last destination | Remove all destinations | Shows empty state message | |
| 8 | Move up | Select Destination 2, click up arrow | Moves to position 1, stays selected | |
| 9 | Move down | Select Destination 1, click down arrow | Moves to position 2, stays selected | |
| 10 | Up disabled at top | Select first destination | Up arrow is disabled | |
| 11 | Down disabled at bottom | Select last destination | Down arrow is disabled | |

## Destination Settings

| # | Scenario | Steps | Expected | Pass? |
|---|---|---|---|---|
| 12 | Default connector type | Add new destination | Connector type is TCP/MLLP | |
| 13 | Change connector type | Switch to HTTP | Connector form changes to HTTP fields | |
| 14 | Properties reset on type change | Set TCP host to "lab", switch to HTTP, switch back to TCP | TCP properties reset to defaults | |
| 15 | Enable/disable toggle | Toggle enabled switch off | "OFF" label appears in list next to destination | |
| 16 | Unsupported connector | Switch to FILE or DATABASE | Shows "not yet available" placeholder | |

## Queue Settings

| # | Scenario | Steps | Expected | Pass? |
|---|---|---|---|---|
| 17 | Default queue mode | Add destination | Queue mode is "Never" | |
| 18 | Enable queue | Switch to "On Failure" | Retry count, interval, thread count, rotate, wait-for-previous appear | |
| 19 | Queue always | Switch to "Always" | Same additional fields visible | |
| 20 | Queue never hides fields | Switch back to "Never" | Retry/thread/rotate fields hidden | |
| 21 | Retry count | Set to 3 | Value persists | |
| 22 | Retry interval | Set to 5000 | Value persists | |
| 23 | Thread count minimum | Try to set to 0 | Stays at 1 (minimum) | |
| 24 | Rotate queue | Toggle on | Checked | |
| 25 | Wait for previous | Toggle on | Checked | |
