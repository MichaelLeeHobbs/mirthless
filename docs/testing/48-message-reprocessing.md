# 48 — Message Reprocessing & Bulk Operations

## API Tests

- [ ] `POST /channels/:id/messages/:msgId/reprocess` — returns raw content for valid message
- [ ] `POST /channels/:id/messages/:msgId/reprocess` — returns 404 when no raw content
- [ ] `DELETE /channels/:id/messages/bulk` — deletes messages in dependency order
- [ ] `DELETE /channels/:id/messages/bulk` — returns 404 when no messages match
- [ ] `DELETE /channels/:id/messages/bulk` — handles partial match (only existing messages deleted)
- [ ] Reprocess requires channels:deploy permission
- [ ] Bulk delete requires channels:delete permission
- [ ] Both require authentication (401 without token)
- [ ] Validation: messageIds must be non-empty array
- [ ] Validation: messageIds max 1000

## UI Tests

- [ ] Select a message in Message Browser — Reprocess and Delete buttons appear
- [ ] Reprocess button retrieves raw content (success snackbar)
- [ ] Delete button removes selected message(s) (success snackbar with count)
- [ ] Selection clears after successful delete
- [ ] Buttons disabled during pending operation
- [ ] Error snackbar shown on failure
- [ ] Snackbar auto-hides after 4 seconds
