# 40 — Dashboard Tag Filtering & Group Display Manual Test Checklist

## Prerequisites
- Logged in as admin
- Tags and channel groups configured with channel assignments
- Dashboard page

## Tests

### Tag Filtering
- [ ] Tag filter autocomplete appears above the channel table
- [ ] Tags display with their configured colors
- [ ] Selecting a tag filters channels to only those with that tag
- [ ] Multiple tags can be selected (OR logic)
- [ ] Removing all tags shows all channels
- [ ] Summary cards update to reflect filtered channels
- [ ] Chip "x" removes individual tag from filter

### View Mode Toggle
- [ ] Toggle buttons appear in header (flat/grouped)
- [ ] Default view is flat (list icon active)
- [ ] Clicking grouped icon switches to grouped view
- [ ] Toggle state persists during session

### Flat View
- [ ] Same behavior as before (search, sort, all columns)
- [ ] Tag filter applies correctly

### Grouped View
- [ ] Channels are organized into collapsible group sections
- [ ] Group headers show group name and channel count
- [ ] Group headers show aggregate stats (sum of channel stats)
- [ ] Click on group header collapses/expands group
- [ ] Channels not in any group appear in "Ungrouped" section
- [ ] "Ungrouped" section only appears if ungrouped channels exist
- [ ] Individual channel rows show same data as flat view
- [ ] Channel name links navigate to channel editor
- [ ] Channel actions (start/stop/etc.) work within groups
- [ ] Tag filter applies to grouped view

### Empty States
- [ ] No channels: shows "No channels configured"
- [ ] All channels filtered out by tag: shows empty state
