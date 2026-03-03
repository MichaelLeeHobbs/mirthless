# 35 — Channel Dependencies Manual Test Checklist

## Prerequisites
- Server running (`pnpm dev:server`)
- At least 3 channels created (A, B, C)

## API Tests

### Get Dependencies
- [ ] `GET /api/v1/channels/:id/dependencies` returns empty array for channel with no deps
- [ ] Returns dependency list after setting dependencies
- [ ] Returns 404 for non-existent channel

### Set Dependencies
- [ ] `PUT /api/v1/channels/:id/dependencies` with `{ dependsOnChannelIds: [id1, id2] }` succeeds
- [ ] Setting empty array clears all dependencies
- [ ] Returns 404 for non-existent source channel
- [ ] Returns 404 for non-existent dependency channel
- [ ] Rejects self-dependency (A depends on A) with 400
- [ ] Rejects direct circular dependency (A→B, then B→A) with 400
- [ ] Rejects transitive circular dependency (A→B→C, then C→A) with 400
- [ ] Allows valid DAG (A→B, A→C, B→C)

### Get Dependents
- [ ] `GET /api/v1/channels/:id/dependents` returns channels that depend on this one
- [ ] Returns empty array when no channels depend on this one
- [ ] Returns 404 for non-existent channel

### Permissions
- [ ] Reading dependencies requires `channels:read`
- [ ] Setting dependencies requires `channels:deploy`
