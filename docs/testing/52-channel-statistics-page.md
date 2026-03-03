# 52 — Channel Statistics Page Manual Test Checklist

## Prerequisites
- Logged in with `channels:read` permission
- At least one deployed channel with message activity

## Navigation
- [ ] Click "Stats" icon on dashboard channel row navigates to `/channels/:id/statistics`
- [ ] "Dashboard" back button returns to dashboard
- [ ] Direct URL `/channels/:id/statistics` loads correctly

## Summary Cards
- [ ] Received card shows total received count
- [ ] Filtered card shows total filtered count
- [ ] Sent card shows total sent count
- [ ] Errored card shows total errored count (red when > 0)
- [ ] Error Rate card shows percentage (red when > 0)

## Connector Breakdown Table
- [ ] Source connector row (metaDataId 0) shown
- [ ] Destination connector rows shown for each destination
- [ ] Current stats columns: Received, Filtered, Sent, Errored
- [ ] Lifetime stats columns: Received, Filtered, Sent, Errored
- [ ] Errored columns highlight in red when > 0

## Reset Statistics
- [ ] Confirm dialog appears before reset
- [ ] After reset, all current stats go to 0
- [ ] Lifetime stats are preserved
- [ ] Auto-refresh (5s) continues after reset

## Auto-Refresh
- [ ] Statistics auto-refresh every 5 seconds
- [ ] New messages reflect in stats without manual refresh
