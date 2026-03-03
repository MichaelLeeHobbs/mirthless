# 50 — User Preferences Manual Test Checklist

## Prerequisites
- Logged in as any role

## API Tests

### List Preferences
- [ ] `GET /api/v1/users/me/preferences` returns empty array for new user
- [ ] Returns all preferences after creating some

### Get Preference
- [ ] `GET /api/v1/users/me/preferences/theme` returns the preference
- [ ] Returns 404 for non-existent key

### Upsert Preference
- [ ] `PUT /api/v1/users/me/preferences` with `{ key: "theme", value: "dark" }` creates new
- [ ] Same call with `value: "light"` updates existing
- [ ] Value can be `null`

### Bulk Upsert
- [ ] `PUT /api/v1/users/me/preferences/bulk` with multiple entries creates/updates all

### Delete Preference
- [ ] `DELETE /api/v1/users/me/preferences/theme` removes the preference
- [ ] Returns 404 for non-existent key

## Isolation
- [ ] User A's preferences are not visible to User B
- [ ] Deleting a user cascades preference deletion
