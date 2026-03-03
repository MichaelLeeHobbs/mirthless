# 33 — Channel Groups Manual Test Checklist

## Prerequisites
- Server running (`pnpm dev:server`)
- Web UI running (`pnpm dev:web`)
- Authenticated as admin user

## API Tests

### List Groups
- [ ] `GET /api/v1/channel-groups` returns empty array when no groups exist
- [ ] `GET /api/v1/channel-groups` returns groups with `memberCount` after creating groups

### Create Group
- [ ] `POST /api/v1/channel-groups` with `{ name, description }` returns 201
- [ ] Creating a group with duplicate name returns 409
- [ ] Creating a group with empty name returns 400

### Get Group by ID
- [ ] `GET /api/v1/channel-groups/:id` returns group detail with `channels` array
- [ ] Getting non-existent group returns 404

### Update Group
- [ ] `PUT /api/v1/channel-groups/:id` with correct `revision` succeeds
- [ ] Updating with stale `revision` returns 409 CONFLICT
- [ ] Updating non-existent group returns 404

### Delete Group
- [ ] `DELETE /api/v1/channel-groups/:id` returns 204 and cascades member removal
- [ ] Deleting non-existent group returns 404

### Member Management
- [ ] `POST /api/v1/channel-groups/:id/members` adds channel to group
- [ ] Adding non-existent channel returns 404
- [ ] Adding already-present channel returns 409
- [ ] `DELETE /api/v1/channel-groups/:id/members/:channelId` removes member
- [ ] Removing non-existent membership returns 404

## UI Tests

### Channel Groups Page
- [ ] Navigate to Channel Groups via sidebar
- [ ] Page shows empty state when no groups exist
- [ ] Click "Create Group" opens dialog
- [ ] Fill name and description, click Create — group appears in table
- [ ] Click Edit icon — dialog pre-fills with group data
- [ ] Update name, click Update — table updates
- [ ] Click Delete icon — group removed from table
- [ ] Member count column shows correct count

### Permissions
- [ ] Viewer role cannot create/edit/delete groups (buttons disabled or 403)
- [ ] Developer role can view groups
