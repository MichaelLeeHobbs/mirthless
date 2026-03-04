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

### Manage Groups Dialog (Channels Page)
- [ ] Click "Groups" button in Channels page toolbar — Manage Groups dialog opens
- [ ] Dialog shows list of existing groups with member counts
- [ ] Dialog shows empty state when no custom groups exist (only "Default" group)
- [ ] Click "Create Group" within dialog — inline form or sub-dialog appears
- [ ] Fill name and description, click Create — group appears in group list
- [ ] Click Edit icon on a group — form pre-fills with group data
- [ ] Update name, click Save — group list updates
- [ ] Click Delete icon on a group — confirm dialog appears, group removed after confirm
- [ ] "Default" group cannot be deleted (delete button disabled or absent)
- [ ] Member count column shows correct count per group
- [ ] Closing the dialog returns to the Channels page

### Permissions
- [ ] Viewer role cannot create/edit/delete groups (buttons disabled or 403)
- [ ] Developer role can view groups
