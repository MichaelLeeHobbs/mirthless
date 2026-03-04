# 59 — Per-Channel Script Timeouts

## Schema Validation

- [ ] Channel with `scriptTimeoutSeconds: 30` (default) — accepted
- [ ] Channel with `scriptTimeoutSeconds: 1` (minimum) — accepted
- [ ] Channel with `scriptTimeoutSeconds: 300` (maximum) — accepted
- [ ] Channel with `scriptTimeoutSeconds: 0` — rejected (below minimum)
- [ ] Channel with `scriptTimeoutSeconds: 301` — rejected (above maximum)
- [ ] Channel with `scriptTimeoutSeconds: 15.5` — rejected (not integer)
- [ ] Channel without `scriptTimeoutSeconds` — defaults to 30

## UI

- [ ] Open channel editor Advanced tab — script timeout field shows current value (default 30)
- [ ] Change timeout to 60 — field accepts the value
- [ ] Enter value below 1 — validation error shown
- [ ] Enter value above 300 — validation error shown
- [ ] Save channel with custom timeout — value persists on reload
- [ ] Create new channel — default timeout is 30

## Service Layer

- [ ] Create channel with custom timeout — `scriptTimeoutSeconds` saved to DB
- [ ] Update channel timeout — value updated in DB
- [ ] Clone channel — timeout value is copied to clone
- [ ] Get channel detail — `scriptTimeoutSeconds` included in response

## Pipeline Integration

- [ ] Channel with 5s timeout — scripts that take >5s are terminated
- [ ] Channel with default 30s timeout — scripts run up to 30s
- [ ] Timeout value flows from channel config → PipelineConfig → MessageProcessor → sandbox
