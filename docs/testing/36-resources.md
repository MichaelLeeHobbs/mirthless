# 36 — Resources Manual Test Checklist

## Prerequisites
- Server running (`pnpm dev:server`)
- Web UI running (`pnpm dev:web`)
- Authenticated as admin user

## API Tests

### List Resources
- [ ] `GET /api/v1/resources` returns empty array when no resources exist
- [ ] Returns metadata only (no `content` field in list response)
- [ ] Results sorted by name ascending

### Create Resource
- [ ] `POST /api/v1/resources` with `{ name, description, mimeType, content }` returns 201
- [ ] `sizeBytes` is auto-computed from content length
- [ ] Duplicate name returns 409
- [ ] Empty name returns 400

### Get Resource by ID
- [ ] `GET /api/v1/resources/:id` returns resource with content
- [ ] Returns 404 for non-existent resource

### Update Resource
- [ ] `PUT /api/v1/resources/:id` updates metadata and/or content
- [ ] Updating content recomputes `sizeBytes`
- [ ] Returns 404 for non-existent resource

### Delete Resource
- [ ] `DELETE /api/v1/resources/:id` returns 204
- [ ] Returns 404 for non-existent resource

## UI Tests

### Resources Page
- [ ] Navigate to Resources via sidebar
- [ ] Page shows empty state when no resources exist
- [ ] Click "Create Resource" opens dialog with content editor
- [ ] Fill name, MIME type, content, click Create — resource appears in table
- [ ] Size column shows human-readable bytes (e.g. "1.2 KB")
- [ ] Click Edit icon — dialog pre-fills with resource data
- [ ] Update content, click Update — table updates with new size
- [ ] Click Delete icon — resource removed from table

### Permissions
- [ ] Resources use `resources:read`/`resources:write`/`resources:delete` permissions
- [ ] Viewer role cannot create/edit/delete resources
