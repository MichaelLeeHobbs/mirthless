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
- [ ] `GET /collections/:id/records` — returns `{ items, total }`, newest first by default; takes `page`, `pageSize` (≤500), `sort` (`createdAt`, `expireAt`, `payload`, `fields.<name>`), `order`, `q` and `in` *(automated: collection.itest.ts)*
- [ ] `GET /collections/:id/records?sort=fields.bogus` (field not indexed) → 400
- [ ] `POST /collections/:id/records` — adds a record (`fields`, `payload`, optional `expireAt`/`ttlSeconds`); requires `collections:write`
- [ ] `PUT /collections/:id/records/:recordId` — changes the given `fields` (whole set), `payload` and/or `expireAt` (null = never); 400 when none is given; 404 for a record in another collection
- [ ] `DELETE /collections/:id/records/:recordId` — deletes one record; requires `collections:delete`
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
| 6 | View records | Click the collection name (or the records icon) | Records grid opens: a column per indexed field, payload, created, expires; "No records yet" when empty *(automated: e2e/collections.spec.ts)* | |
| 7 | Delete | Delete → confirm | Collection removed | |
| 8 | RBAC | As viewer | Create/Edit/Delete controls disabled with permission tooltips | |

## UI Tests — Records grid

Automated in `e2e/collections.spec.ts` (sort, search, add/edit/delete) and `CollectionRecordsPage.test.tsx` (read-only, errors, pager).

| # | Scenario | Steps | Expected | Pass? |
|---|---|---|---|---|
| 1 | Sort | Click a column head, then again | Rows re-sort across all pages, ascending then descending | |
| 2 | Search | Type in "Search records"; pick a column in "Search in" | Count shows "N records found"; "No matching records" when none | |
| 3 | Add | Add Record → fill fields and payload → Add | Row appears; blank Expires uses the collection default TTL | |
| 4 | Edit | Click a row → change a field → Save | Row shows the new value | |
| 5 | Delete | Row delete icon → confirm | Row removed; confirm names the first field's value | |
| 6 | Read-only | As viewer, click a row | Record opens read-only with no Save; Add and Delete disabled | |
| 7 | Jump to | Ctrl+K → type the collection name | "<name> records" opens the grid | |

## Script Bridge Tests (`getCollection`)

Deploy two channels; in a transformer/script:

- [ ] `getCollection('orders').store({ accessionNumber, institutionName, orderControl }, msg.toString())` inserts a record
- [ ] Storing with a field NOT in `indexedFields` throws (fail-loud)
- [ ] Storing a payload > 1 MiB throws
- [ ] `getCollection('orders').find({ accessionNumber, institutionName }, { filter: { orderControl: ['XO','NW','SC'] }, latest: true })` returns the newest matching record
- [ ] `getCollection('orders').update(order.id, { payload, expireAt: null })` changes only those keys; returns `null` for a deleted or pruned record
- [ ] `getCollection('orders').delete(order.id)` returns `true`, then `false` on a second call
- [ ] `update`/`delete` with a non-UUID id, or on an unknown collection, throws in the script
- [ ] `find` with multiple filter fields (scalar + array) AND-combines correctly
- [ ] A record written with `{ ttlSeconds }` / `{ expireAt }` override expires per the override, not the collection default
- [ ] IntelliSense: the channel script editor autocompletes `getCollection(...)` with `store`/`find`

## TTL / Pruning

- [ ] A record past its `expireAt` is removed on the next pruner run
- [ ] A collection with `defaultTtlSeconds = null` never expires its records
- [ ] Editing the collection's default TTL affects only records written afterward
