# 10 — Message Browser

## Prerequisites
- Logged in as admin
- At least one channel with processed messages (deploy, start, send several messages)

## Navigation

| # | Scenario | Steps | Expected | Pass? |
|---|---|---|---|---|
| 1 | Navigate from channel list | Go to Channels → click messages icon on a channel | Message Browser opens for that channel | |
| 2 | Back navigation | Click back button in Message Browser | Returns to channel list | |
| 3 | Page title | Open Message Browser for a channel | Page title or heading shows channel name | |

## Message Table

| # | Scenario | Steps | Expected | Pass? |
|---|---|---|---|---|
| 4 | Messages displayed | Open Message Browser with messages | Table shows message rows | |
| 5 | Status chips | View messages with different statuses | Status chips colored correctly (SENT=green, ERROR=red, FILTERED=grey, etc.) | |
| 6 | Content preview | View message row | Content preview column shows truncated message text | |
| 7 | Received date | View message row | Date/time column formatted correctly | |

## Search/Filter

| # | Scenario | Steps | Expected | Pass? |
|---|---|---|---|---|
| 8 | Filter by status | Select status filter (e.g., ERROR) | Only messages with that status shown | |
| 9 | Filter by date range | Set start and end date | Only messages in range shown | |
| 10 | Text content search | Type search text | Results filtered after debounce | |
| 11 | Combined filters | Set status + date range + text search | Results match all criteria | |
| 12 | Reset filters | Clear all filters | All messages shown again | |

## Pagination

| # | Scenario | Steps | Expected | Pass? |
|---|---|---|---|---|
| 13 | Change page size | Change rows-per-page dropdown | Table shows correct number of rows | |
| 14 | Navigate pages | Click next/previous page buttons | Different page of results shown | |
| 15 | Pagination resets on filter | Apply a filter | Pagination returns to first page | |

## Detail Panel

| # | Scenario | Steps | Expected | Pass? |
|---|---|---|---|---|
| 16 | Select message | Click a message row | Detail panel appears with message content | |
| 17 | Content tabs | View detail panel | Raw/Encoded/Transformed tabs available | |
| 18 | Deselect message | Click selected row again or click elsewhere | Detail panel closes | |

## Empty/Error States

| # | Scenario | Steps | Expected | Pass? |
|---|---|---|---|---|
| 19 | No messages | Open Message Browser for channel with no messages | Empty state message displayed | |
| 20 | API error | Stop server while viewing messages | Error alert displayed | |
