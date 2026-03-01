# 16 — Events

## Prerequisites
- Logged in as admin
- Some events exist (e.g., from login — USER_LOGIN events are auto-generated)

## Events Table

| # | Scenario | Steps | Expected | Pass? |
|---|---|---|---|---|
| 1 | Table displays events | Navigate to Events page | Table visible with columns: Date/Time, Level, Event, Outcome, User ID, IP Address | |
| 2 | Level chips | View event rows | Level shown as colored chip (INFO=blue, WARN=yellow, ERROR=red) | |
| 3 | Outcome chips | View event rows | Outcome shown as colored chip (SUCCESS=green, FAILURE=red) | |
| 4 | Pagination | View page with >10 events | Pagination controls appear and work | |
| 5 | Date formatting | View event row | Date/time formatted correctly with timestamp | |
| 6 | User ID display | View event row | User ID shown (truncated if UUID) | |

## Filters

| # | Scenario | Steps | Expected | Pass? |
|---|---|---|---|---|
| 7 | Filter by level | Select level filter (e.g., INFO) | Only events with that level shown | |
| 8 | Filter by event name | Select event name (e.g., USER_LOGIN) | Only matching events shown | |
| 9 | Filter by outcome | Select outcome (SUCCESS or FAILURE) | Only events with that outcome shown | |
| 10 | Combined filters | Set level + outcome filters | Results match all criteria | |
| 11 | Clear filters | Remove all filters | All events shown again | |

## Detail Panel

| # | Scenario | Steps | Expected | Pass? |
|---|---|---|---|---|
| 12 | Expand event detail | Click expand icon on event row | Detail panel opens showing attributes as JSON | |
| 13 | Collapse event detail | Click expand icon again on expanded row | Detail panel collapses | |

## Purge

| # | Scenario | Steps | Expected | Pass? |
|---|---|---|---|---|
| 14 | Open purge dialog | Click Purge button | Dialog opens with days input field | |
| 15 | Cancel purge | Click Cancel in purge dialog | Dialog closes, no events deleted | |
| 16 | Confirm purge | Enter days value → click Purge | Events older than N days removed, dialog closes | |

## Empty/Error States

| # | Scenario | Steps | Expected | Pass? |
|---|---|---|---|---|
| 17 | No events | Purge all events | "No events" message displayed | |
| 18 | API error | Stop server while viewing | Error alert displayed | |
