# 38 — Configuration Map Manual Test Checklist

## Prerequisites
- Logged in as admin
- Config Map page accessible via sidebar

## Tests

### List
- [ ] Empty state shows "No configuration entries" message
- [ ] Entries display with category, name, value columns
- [ ] Entries are sorted by category then name

### Category Tabs
- [ ] "All" tab shows all entries
- [ ] Category-specific tabs appear dynamically
- [ ] Selecting a category tab filters entries
- [ ] Tab scrolls when many categories exist

### Create
- [ ] Click "Add Entry" opens create dialog
- [ ] Category and Name fields are required
- [ ] Value can be multi-line text
- [ ] After save, entry appears in table
- [ ] Category chip renders correctly

### Edit
- [ ] Click edit icon opens dialog with pre-filled values
- [ ] Category and Name fields are disabled when editing
- [ ] Updated value saves correctly

### Delete
- [ ] Click delete icon removes entry
- [ ] Entry disappears from table

### Permissions
- [ ] Users with `config_map:read` can view but not modify
- [ ] Users with `config_map:write` can create, edit, delete
- [ ] Users without permission get 403
