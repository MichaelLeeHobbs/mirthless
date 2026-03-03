# 34 — Channel Tags Manual Test Checklist

## Prerequisites
- Server running (`pnpm dev:server`)
- Web UI running (`pnpm dev:web`)
- Authenticated as admin user

## API Tests

### List Tags
- [ ] `GET /api/v1/tags` returns empty array when no tags exist
- [ ] `GET /api/v1/tags` returns tags with `assignmentCount`

### Create Tag
- [ ] `POST /api/v1/tags` with `{ name, color }` returns 201
- [ ] Color must be valid hex format (#RRGGBB) — invalid returns 400
- [ ] Duplicate name returns 409

### Update Tag
- [ ] `PUT /api/v1/tags/:id` updates name and/or color
- [ ] Updating non-existent tag returns 404

### Delete Tag
- [ ] `DELETE /api/v1/tags/:id` returns 204 and cascades assignments
- [ ] Deleting non-existent tag returns 404

### Tag Assignment
- [ ] `POST /api/v1/tags/:id/channels` assigns tag to channel
- [ ] Assigning to non-existent channel returns 404
- [ ] Assigning already-assigned tag returns 409
- [ ] `DELETE /api/v1/tags/:id/channels/:channelId` removes assignment
- [ ] Removing non-existent assignment returns 404

## UI Tests

### Tags Page
- [ ] Navigate to Tags via sidebar
- [ ] Page shows empty state when no tags exist
- [ ] Click "Create Tag" opens dialog with color picker
- [ ] Fill name, pick color, click Create — tag appears with colored chip
- [ ] Click Edit icon — dialog pre-fills with tag data
- [ ] Update color, click Update — table updates
- [ ] Click Delete icon — tag removed from table
- [ ] Channels count column shows correct assignment count

### Permissions
- [ ] Tags use `settings:read`/`settings:write` permissions
- [ ] Viewer role cannot create/edit/delete tags
