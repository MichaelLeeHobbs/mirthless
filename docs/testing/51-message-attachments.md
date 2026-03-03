# 51 — Message Attachments Manual Test Checklist

## Prerequisites
- Logged in with `channels:read` permission
- Channel with messages that have attachments

## API Tests

### List Attachments
- [ ] `GET /api/v1/channels/:id/messages/:msgId/attachments` returns attachment summaries
- [ ] Returns empty array when no attachments exist
- [ ] Response includes id, segmentId, mimeType, attachmentSize, isEncrypted (no content)

### Get Attachment
- [ ] `GET /api/v1/channels/:id/messages/:msgId/attachments/:attachmentId` returns full attachment with content
- [ ] Returns 404 for non-existent attachment ID
- [ ] Response includes content field

## UI Tests

### Message Detail Panel
- [ ] Attachments tab appears in message detail when attachments exist
- [ ] Attachment table shows ID, MIME type, size, encrypted flag
- [ ] Preview button loads and displays attachment content
- [ ] Clicking preview again toggles it off

## Edge Cases
- [ ] Multiple segments for same attachment ID render separately
- [ ] Large attachments display correctly in preview
