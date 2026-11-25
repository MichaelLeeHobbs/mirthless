// See docs/design/10-collections.md.

import { z } from 'zod/v4';
import { idSchema } from './id.schema.js';

export const collectionFieldName = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z_][A-Za-z0-9_]*$/, 'must be a valid field identifier');

export const collectionScalar = z.union([z.string(), z.number(), z.boolean()]);
export type CollectionScalar = z.infer<typeof collectionScalar>;

export const createCollectionSchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().default(''),
  indexedFields: z.array(collectionFieldName).min(1).max(32),
  /** null: never expire. */
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

export const storeRecordSchema = z.object({
  /** Keys must be in the collection's indexedFields. */
  fields: z.record(z.string(), collectionScalar),
  /** Opaque to the store. */
  payload: z.string(),
  /** Overrides the collection default TTL. */
  expireAt: z.string().datetime().optional(),
  /** Seconds from now. Overrides the collection default TTL. */
  ttlSeconds: z.number().int().nonnegative().optional(),
});

export type StoreRecordInput = z.infer<typeof storeRecordSchema>;

/** Scalar: equality; array: IN. */
export const collectionFilterValue = z.union([collectionScalar, z.array(collectionScalar).min(1)]);

export const findRecordsSchema = z.object({
  /** Equality match on indexed fields (AND'd). */
  match: z.record(z.string(), collectionScalar).default({}),
  /** Multiple fields AND'd. */
  filter: z.record(z.string(), collectionFilterValue).optional(),
  /** Return only the single newest match. */
  latest: z.boolean().default(false),
  /** Ignored when latest is true. */
  limit: z.number().int().positive().max(1000).optional(),
  /** Ordering by created_at. */
  order: z.enum(['asc', 'desc']).default('desc'),
});

export type FindRecordsInput = z.infer<typeof findRecordsSchema>;

/** Field names are checked against the collection on the server. */
export const recordColumn = z.union([
  z.enum(['createdAt', 'expireAt', 'payload']),
  z.string().regex(/^fields\.[A-Za-z_][A-Za-z0-9_]*$/, 'must be createdAt, expireAt, payload or fields.<name>'),
]);
export type RecordColumn = z.infer<typeof recordColumn>;

export const listRecordsQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(500).default(25),
  /** Ties fall back to newest first. */
  sort: recordColumn.default('createdAt'),
  order: z.enum(['asc', 'desc']).default('desc'),
  /** Case-insensitive substring to look for. */
  q: z.string().max(500).optional(),
  /** Where to look for `q`: one column, or every indexed field and the payload when omitted. */
  in: recordColumn.optional(),
});

export type ListRecordsQuery = z.infer<typeof listRecordsQuerySchema>;

/** Only the keys given change; `fields` replaces the whole field set; `expireAt: null` never expires. */
export const updateRecordSchema = z.object({
  fields: z.record(z.string(), collectionScalar).optional(),
  payload: z.string().optional(),
  expireAt: z.string().datetime().nullable().optional(),
}).refine((v) => v.fields !== undefined || v.payload !== undefined || v.expireAt !== undefined, {
  message: 'give at least one of fields, payload or expireAt',
});

export type UpdateRecordInput = z.infer<typeof updateRecordSchema>;

export const collectionUuidParamSchema = z.object({
  id: idSchema,
});

export const collectionNameParamSchema = z.object({
  name: z.string().min(1).max(255),
});

// eslint-disable-next-line no-restricted-syntax -- idSchema with the text a script sees.
export const collectionRecordIdSchema = z.uuid('record id must be a UUID').toLowerCase();

export const collectionRecordParamSchema = z.object({
  id: idSchema,
  recordId: collectionRecordIdSchema,
});
