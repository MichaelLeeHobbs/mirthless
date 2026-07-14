// ===========================================
// Collection Zod Schemas
// ===========================================
// A Collection is a durable, queryable, TTL-pruned keyed record store that
// channel scripts read/write via getCollection(). See docs/design/10-collections.md.

import { z } from 'zod/v4';

// ----- Shared -----

/** A field name usable in a collection index / query (safe identifier). */
export const collectionFieldName = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z_][A-Za-z0-9_]*$/, 'must be a valid field identifier');

/** A scalar value stored in an indexed field. */
export const collectionScalar = z.union([z.string(), z.number(), z.boolean()]);
export type CollectionScalar = z.infer<typeof collectionScalar>;

// ----- Collection CRUD -----

export const createCollectionSchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().default(''),
  /** Field names that records may be matched/filtered on. */
  indexedFields: z.array(collectionFieldName).min(1).max(32),
  /** Default record lifetime in seconds; null = never expire. */
  defaultTtlSeconds: z.number().int().positive().nullable().default(null),
});

export type CreateCollectionInput = z.infer<typeof createCollectionSchema>;

export const updateCollectionSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  description: z.string().optional(),
  indexedFields: z.array(collectionFieldName).min(1).max(32).optional(),
  defaultTtlSeconds: z.number().int().positive().nullable().optional(),
});

export type UpdateCollectionInput = z.infer<typeof updateCollectionSchema>;

// ----- Record write (store) -----

export const storeRecordSchema = z.object({
  /** Indexed field values for this record (keys must be in the collection's indexedFields). */
  fields: z.record(z.string(), collectionScalar),
  /** The stored value — opaque to the store; scripts parse it. */
  payload: z.string(),
  /** Absolute expiry (ISO 8601). Overrides the collection default TTL. */
  expireAt: z.string().datetime().optional(),
  /** Relative expiry in seconds from now. Overrides the collection default TTL. */
  ttlSeconds: z.number().int().nonnegative().optional(),
});

export type StoreRecordInput = z.infer<typeof storeRecordSchema>;

// ----- Record query (find) -----

/** A filter value: scalar (equality) or array (IN). */
export const collectionFilterValue = z.union([collectionScalar, z.array(collectionScalar).min(1)]);

export const findRecordsSchema = z.object({
  /** Equality match on indexed fields (AND'd). */
  match: z.record(z.string(), collectionScalar).default({}),
  /** Additional field predicates: scalar = equality, array = IN. Multiple fields AND'd. */
  filter: z.record(z.string(), collectionFilterValue).optional(),
  /** Return only the single newest match. */
  latest: z.boolean().default(false),
  /** Max rows to return (ignored when latest=true). */
  limit: z.number().int().positive().max(1000).optional(),
  /** Ordering by created_at. */
  order: z.enum(['asc', 'desc']).default('desc'),
});

export type FindRecordsInput = z.infer<typeof findRecordsSchema>;

// ----- Params -----

export const collectionUuidParamSchema = z.object({
  id: z.string().uuid(),
});

export const collectionNameParamSchema = z.object({
  name: z.string().min(1).max(255),
});
