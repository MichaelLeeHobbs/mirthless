# 66 — Collections

> A durable, queryable, TTL-pruned keyed record store that channel scripts read/write
> via `getCollection()`. See `docs/design/10-collections.md`.

## Prerequisites
- Logged in as admin (or a role with `collections:*`)
- At least one deployable channel for the script-bridge tests

## API Tests

- [ ] `GET /collections` — lists collections (requires `collections:read`; 401 without token)
- [ ] `POST /collections` — creates a collection (name, indexedFields[], defaultTtlSeconds); requires `collections:write`
- [ ] `POST /collections` with a duplicate name → 409
- [ ] `POST /collections` with an invalid field name (e.g. `"bad name"`) → 400
- [ ] `POST /collections` with empty `indexedFields` → 400
- [ ] `GET /collections/:id` — returns the definition
- [ ] `GET /collections/:id/records` — lists recent records (newest first)
- [ ] `PUT /collections/:id` — updates name/description/fields/TTL
- [ ] `DELETE /collections/:id` — deletes the collection and cascades its records; requires `collections:delete`
- [ ] Viewer role can read but not write/delete (403 on write/delete)

## UI Tests — Collections page

| # | Scenario | Steps | Expected | Pass? |
|---|---|---|---|---|
| 1 | Page loads | Open Collections (sidebar) | Heading "Collections", table, "Create Collection" button | |
| 2 | Create | Click Create; enter name, `accessionNumber, institutionName, orderControl`, TTL `604800` | Collection appears; indexed fields render as chips; TTL shows "7d" | |
| 3 | TTL blank = Never | Create with blank TTL | TTL column shows "Never" | |
| 4 | Invalid TTL | Enter a negative/decimal TTL | Inline error; not saved | |
| 5 | Edit | Edit a collection's fields/TTL | Changes persist after reload | |
| 6 | View records | Click the records icon | Dialog lists recent records (fields JSON, payload, created, expires) or "No records stored yet" | |
| 7 | Delete | Delete → confirm | Collection removed | |
| 8 | RBAC | As viewer | Create/Edit/Delete controls disabled with permission tooltips | |

## Script Bridge Tests (`getCollection`)

Deploy two channels; in a transformer/script:

- [ ] `getCollection('orders').store({ accessionNumber, institutionName, orderControl }, msg.toString())` inserts a record
- [ ] Storing with a field NOT in `indexedFields` throws (fail-loud)
- [ ] Storing a payload > 1 MiB throws
- [ ] `getCollection('orders').find({ accessionNumber, institutionName }, { filter: { orderControl: ['XO','NW','SC'] }, latest: true })` returns the newest matching record
- [ ] `find` with multiple filter fields (scalar + array) AND-combines correctly
- [ ] A record written with `{ ttlSeconds }` / `{ expireAt }` override expires per the override, not the collection default
- [ ] IntelliSense: the channel script editor autocompletes `getCollection(...)` with `store`/`find`

## TTL / Pruning

- [ ] A record past its `expireAt` is removed on the next pruner run
- [ ] A collection with `defaultTtlSeconds = null` never expires its records
- [ ] Editing the collection's default TTL affects only records written afterward
