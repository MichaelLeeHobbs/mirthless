# 37 — Global Map Manual Test Checklist

## Prerequisites
- Logged in as admin
- Global Map page accessible via sidebar

## Tests

### List
- [ ] Empty state shows "No global map entries" message
- [ ] Entries display with key, value, updated at columns
- [ ] Entries are sorted by key alphabetically

### Create
- [ ] Click "Add Entry" opens create dialog
- [ ] Key field is required (cannot save empty)
- [ ] Value can be multi-line text
- [ ] After save, entry appears in table
- [ ] Dialog closes on successful save

### Edit
- [ ] Click edit icon opens dialog with pre-filled values
- [ ] Key field is disabled when editing
- [ ] Updated value saves correctly
- [ ] Updated timestamp reflects change

### Delete
- [ ] Click delete icon removes entry
- [ ] Entry disappears from table

### Clear All
- [ ] "Clear All" button is disabled when table is empty
- [ ] Click "Clear All" shows confirmation dialog
- [ ] Cancel does not delete entries
- [ ] Confirm deletes all entries
- [ ] Table shows empty state after clear

### Permissions
- [ ] Users with `global_map:read` can view but not modify
- [ ] Users with `global_map:write` can create, edit, delete, clear
- [ ] Users without permission get 403
