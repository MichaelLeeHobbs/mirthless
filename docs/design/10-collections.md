# 10 — Collections

> Status: design (approved 2026-07-13). A durable, queryable, TTL-pruned keyed
> record store that channel scripts read and write via a `getCollection()` bridge.

## Why

Channels frequently need to **stash a record now and look it up later from a
different channel** — the canonical case (live in the user's Mirth prod at
~100K msgs/day) is order/report matching: an orders channel stores each inbound
order keyed by accession + institution; later a reports channel looks up the
newest matching order (filtered by order-control type) to build the outbound
report. See `reference` memory `vns-mirth-prod-source` →
`portalApi.hl7message.store/find` and `valor-network/core/populateReportMsg.js`.

This is **not** a [Resource](#relationship-to-resources): resources are static
config blobs (read-only, cache-until-invalidated). A collection is mutable,
high-churn, keyed, queryable state. They are separate features.

Nor is it a **map** (`globalMap`/`channelMap`): maps are in-memory, ephemeral,
lost on restart, and not queryable. A collection is durable and indexed.

## Model

A **Collection** is defined once (in the UI / API):

| Field | Meaning |
|---|---|
| `name` | unique; how scripts address it (`getCollection('orders')`) |
| `description` | free text |
| `indexedFields` | ordered list of user-defined field names that are queryable (e.g. `["accessionNumber","institutionName","orderControl","messageCode","triggerEvent"]`) |
| `defaultTtlSeconds` | default record lifetime; `null` = never expire. Applied at write time unless the write overrides it. |

A **CollectionRecord** is one stored row:

| Field | Meaning |
|---|---|
| `id` | uuid, unique per record (append — many records per key) |
| `collectionId` | FK to the collection |
| `fields` | jsonb — the indexed field values supplied at write time |
| `payload` | the stored value (HL7 text, JSON, whatever) |
| `expireAt` | timestamptz, nullable — when the pruner removes it |
| `createdAt` | timestamptz — drives newest-wins ordering |

Records are **append-only**: `store()` inserts, never upserts. "Newest wins" is a
query result (`ORDER BY created_at DESC LIMIT 1`), not a storage constraint. This
matches the domain (many orders accrue per accession over time) and avoids
read-modify-write races at high write volume.

## Storage

One static table (no per-collection dynamic DDL — parameterized queries only,
Postgres-native, Drizzle-friendly):

```
collection_records(
  id           uuid pk default gen_random_uuid(),
  collection_id uuid not null references collections(id) on delete cascade,
  fields       jsonb not null,
  payload      text,                    -- opaque to the store; scripts parse
  expire_at    timestamptz,             -- null = never
  created_at   timestamptz not null default now()
)
  index gin (fields)                              -- @> containment (equality match)
  index btree (collection_id, created_at desc)    -- newest-wins hot path
  index btree (expire_at) where expire_at is not null  -- pruner scan
```

## Query surface (bounded — not a query language)

`find(match, options)`:
- **`match`** — object of `{field: value}`, equality on indexed fields, AND'd.
  Implemented as `fields @> $match` (GIN-indexed). This is the fast key lookup.
- **`options.filter`** — optional `{field: value | value[]}`, **multiple fields**,
  AND'd; a scalar is equality, an array is `IN`. Implemented as
  `fields->>'f' = $v` / `fields->>'f' = ANY($arr)`.
- **`options.latest`** — boolean; return the single newest match (or `null`).
- **`options.limit` / `options.order`** — optional; default order is
  `created_at desc`.

No joins, ranges, or partial-key scans in v1. Both known use cases fit.

## TTL

`defaultTtlSeconds` on the collection is the primary mechanism (the user's prod
sets a backend default and rarely overrides — and when they do it's per-customer,
not per-message). At `store()`:
- `expireAt = now + (override ?? defaultTtlSeconds)`; if both are null → never
  expires.
- Override is an optional `{ expireAt }` (or `{ ttlSeconds }`) on the write.

Pruning reuses the existing data-pruner scheduler: periodic
`DELETE FROM collection_records WHERE expire_at < now()`.

## Script bridge

Shaped to mirror the prod `portalApi.hl7message` API so migrating existing
channel code (`getOrder`) is mechanical:

```js
// Write (orders channel)
getCollection('orders').store(
  { accessionNumber, institutionName, orderControl, messageCode, triggerEvent },
  hl7.toString(),
  { expireAt }                       // optional; else collection default TTL
);

// Read newest match (reports channel) — same semantics as prod getOrder()
const order = getCollection('orders').find(
  { accessionNumber, institutionName },
  { filter: { orderControl: ['XO', 'NW', 'SC'] }, latest: true }
);   // → { id, fields, payload, createdAt } | null
```

The bridge is injected the same way as the other IO bridges, at the currently
unpassed-deps construction point `packages/server/src/engine.ts` (`new
VmSandboxExecutor(...)`). Reads hit Postgres directly — collections are mutable,
so (unlike `getResource`) there is **no read cache**.

## Relationship to Resources

| | Resource | Collection |
|---|---|---|
| Shape | one named text blob | many keyed records |
| Mutability | rarely edited config | high-churn writes |
| Read | `getResource(name)` → string | `getCollection(name).find(...)` → records |
| Caching | cache-until-invalidated | no read cache |
| TTL | none | per-collection default + per-write override |
| UI | Resources page | Collections page |

Separate DB tables, services, routes, bridges, and pages. Wiring `getResource`
(config) is tracked separately; this doc covers Collections only.

## Security / limits

- Any channel script can read/write any collection by name (no per-channel
  scoping in v1 — noted as a future option). PHI lives in `payload`; access is
  auditable via the same event trail as other services.
- Enforce a max `payload` size on write (reject oversized).
- Not a secret store.

## Build order

1. **core-models** — Zod schemas (collection def, record, `find` query input),
   branded `CollectionId`, field-value canonicalization.
2. **server** — `collections` + `collection_records` tables + migration;
   `CollectionService` (define/list/delete; `store`/`find` parameterized);
   routes + RBAC (`collections:read/write/delete`); pruner hook.
3. **engine** — inject `getCollection` into `VmSandboxExecutor`; in-sandbox
   global; `.d.ts` for script IntelliSense.
4. **web** — Collections page (define fields + TTL, browse/inspect records).
5. **tests + docs** — sandbox bridge tests, server unit + integration tests,
   `docs/testing/` checklist, scripting-api docs, progress docs.
