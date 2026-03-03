# 42 — Data Pruner Scheduling Manual Test Checklist

## Schedule Status
- [ ] GET /api/v1/admin/prune/schedule returns current status
- [ ] Status includes enabled, cronExpression, lastRunAt, lastRunResult
- [ ] Requires settings:read permission
- [ ] Returns 401 without authentication

## Update Schedule
- [ ] PUT /api/v1/admin/prune/schedule updates the schedule
- [ ] Updates pruner.enabled and pruner.cron_expression settings
- [ ] Enabling schedule creates pg-boss cron job
- [ ] Disabling schedule removes pg-boss cron job
- [ ] Invalid cron expression returns 400
- [ ] Requires settings:write permission

## Auto Pruning
- [ ] Scheduled job triggers DataPrunerService.pruneAll()
- [ ] Last run result is tracked in memory
- [ ] Status endpoint reflects last run after auto-prune

## Run Now
- [ ] POST /api/v1/admin/prune triggers immediate pruning
- [ ] Returns pruning result (channelsPruned, totalDeleted)
- [ ] Works regardless of schedule enabled/disabled state

## UI - Pruner Section
- [ ] Section appears on System Info page
- [ ] Toggle switch reflects enabled/disabled state
- [ ] Cron expression text field editable
- [ ] Save Schedule button persists changes
- [ ] Success alert shown after save
- [ ] Run Now button triggers immediate pruning
- [ ] Run result shown in info alert
- [ ] Last run info displayed when available
- [ ] Loading spinner during operations
- [ ] Error alerts shown on failure

## Server Startup
- [ ] Pruner scheduler initializes after pg-boss starts
- [ ] Reads pruner settings on startup
- [ ] Creates schedule if enabled
- [ ] Skips schedule if disabled
- [ ] Logs scheduler status on startup
