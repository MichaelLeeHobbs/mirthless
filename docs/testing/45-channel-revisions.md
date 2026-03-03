# 45 — Channel Revision History

## API Tests

- [ ] `GET /channels/:id/revisions` — returns revision list for channel
- [ ] `GET /channels/:id/revisions` — returns empty array for channel with no revisions
- [ ] `GET /channels/:id/revisions/:rev` — returns revision detail with snapshot
- [ ] `GET /channels/:id/revisions/:rev` — returns 404 for non-existent revision
- [ ] Updating a channel creates a new revision snapshot automatically
- [ ] Revision number matches the channel's current revision after update
- [ ] Snapshot contains full channel configuration (source, destinations, filters, etc.)

## UI Tests

- [ ] History button appears in channel editor header (edit mode only)
- [ ] History button does not appear when creating a new channel
- [ ] Clicking History opens revision list dialog
- [ ] Revision list shows revision number, date, comment
- [ ] Selecting two revisions and clicking Compare opens diff view
- [ ] Compare button disabled when fewer than 2 revisions selected or same revision
- [ ] Monaco DiffEditor shows side-by-side JSON comparison
- [ ] Left pane shows older revision, right pane shows newer
- [ ] Back button returns to revision list
- [ ] Close button closes dialog
- [ ] Dialog respects dark/light theme
