// ===========================================
// Collection Service
// ===========================================
// Business logic for Collections — a durable, queryable, TTL-pruned keyed record
// store for channel scripts. See docs/design/10-collections.md.
// All methods return Result<T> using tryCatch from stderr-lib.

import { tryCatch, type Result } from 'stderr-lib';
import { and, eq, asc, desc, inArray, lt, sql, type SQL } from 'drizzle-orm';
import type {
  CreateCollectionInput,
  UpdateCollectionInput,
  StoreRecordInput,
  FindRecordsInput,
} from '@mirthless/core-models';
import { ServiceError } from '../lib/service-error.js';
import { emitEvent, type AuditContext } from '../lib/event-emitter.js';
import { db } from '../lib/db.js';
import { collections, collectionRecords } from '../db/schema/index.js';

/** Maximum stored payload size (1 MiB). Larger writes are rejected. */
const MAX_PAYLOAD_BYTES = 1_048_576;

// ----- Response Types -----

export interface CollectionSummary {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly indexedFields: readonly string[];
  readonly defaultTtlSeconds: number | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface CollectionRecordResult {
  readonly id: string;
  readonly fields: Record<string, string>;
  readonly payload: string | null;
  readonly expireAt: Date | null;
  readonly createdAt: Date;
}

// ----- Helpers -----

/** Coerce indexed field values to strings so GIN `@>` matching is type-consistent. */
function stringifyFields(fields: Record<string, string | number | boolean>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(fields)) out[k] = String(v);
  return out;
}

/** Reject any key not declared in the collection's indexedFields. */
function assertKnownFields(keys: readonly string[], indexedFields: readonly string[], context: string): void {
  const known = new Set(indexedFields);
  const unknown = keys.filter((k) => !known.has(k));
  if (unknown.length > 0) {
    throw new ServiceError(
      'INVALID_INPUT',
      `${context}: unknown field(s) [${unknown.join(', ')}]; collection indexes [${indexedFields.join(', ')}]`,
    );
  }
}

function toSummary(row: typeof collections.$inferSelect): CollectionSummary {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    indexedFields: row.indexedFields,
    defaultTtlSeconds: row.defaultTtlSeconds,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

// ----- Service -----

export class CollectionService {
  /** List all collection definitions. */
  static async list(): Promise<Result<readonly CollectionSummary[]>> {
    return tryCatch(async () => {
      const rows = await db.select().from(collections).orderBy(asc(collections.name));
      return rows.map(toSummary);
    });
  }

  /** Get a collection definition by ID. */
  static async getById(id: string): Promise<Result<CollectionSummary>> {
    return tryCatch(async () => {
      const [row] = await db.select().from(collections).where(eq(collections.id, id));
      if (!row) throw new ServiceError('NOT_FOUND', `Collection ${id} not found`);
      return toSummary(row);
    });
  }

  /** Create a collection definition. */
  static async create(input: CreateCollectionInput, context?: AuditContext): Promise<Result<CollectionSummary>> {
    return tryCatch(async () => {
      const [existing] = await db
        .select({ id: collections.id })
        .from(collections)
        .where(eq(collections.name, input.name));
      if (existing) throw new ServiceError('ALREADY_EXISTS', `Collection "${input.name}" already exists`);

      const [row] = await db
        .insert(collections)
        .values({
          name: input.name,
          description: input.description,
          indexedFields: input.indexedFields,
          defaultTtlSeconds: input.defaultTtlSeconds,
        })
        .returning();

      emitCollectionEvent(context, { action: 'create', collectionName: input.name });
      return toSummary(row!);
    });
  }

  /** Update a collection definition. */
  static async update(
    id: string,
    input: UpdateCollectionInput,
    context?: AuditContext,
  ): Promise<Result<CollectionSummary>> {
    return tryCatch(async () => {
      const [existing] = await db.select().from(collections).where(eq(collections.id, id));
      if (!existing) throw new ServiceError('NOT_FOUND', `Collection ${id} not found`);

      if (input.name && input.name !== existing.name) {
        const [dup] = await db
          .select({ id: collections.id })
          .from(collections)
          .where(eq(collections.name, input.name));
        if (dup) throw new ServiceError('ALREADY_EXISTS', `Collection "${input.name}" already exists`);
      }

      const updates: Record<string, unknown> = { updatedAt: new Date() };
      if (input.name !== undefined) updates['name'] = input.name;
      if (input.description !== undefined) updates['description'] = input.description;
      if (input.indexedFields !== undefined) updates['indexedFields'] = input.indexedFields;
      if (input.defaultTtlSeconds !== undefined) updates['defaultTtlSeconds'] = input.defaultTtlSeconds;

      const [row] = await db.update(collections).set(updates).where(eq(collections.id, id)).returning();
      emitCollectionEvent(context, { action: 'update', collectionId: id });
      return toSummary(row!);
    });
  }

  /** Delete a collection definition and all its records (cascade). */
  static async delete(id: string, context?: AuditContext): Promise<Result<void>> {
    return tryCatch(async () => {
      const [existing] = await db.select({ id: collections.id }).from(collections).where(eq(collections.id, id));
      if (!existing) throw new ServiceError('NOT_FOUND', `Collection ${id} not found`);
      await db.delete(collections).where(eq(collections.id, id));
      emitCollectionEvent(context, { action: 'delete', collectionId: id });
    });
  }

  /** Append a record to a collection (by name). Called by the script bridge. */
  static async store(name: string, input: StoreRecordInput): Promise<Result<CollectionRecordResult>> {
    return tryCatch(async () => {
      if (Buffer.byteLength(input.payload, 'utf-8') > MAX_PAYLOAD_BYTES) {
        throw new ServiceError('INVALID_INPUT', `Payload exceeds ${String(MAX_PAYLOAD_BYTES)} bytes`);
      }
      const collection = await requireByName(name);
      assertKnownFields(Object.keys(input.fields), collection.indexedFields, 'store');

      const expireAt = computeExpireAt(input, collection.defaultTtlSeconds);
      const [row] = await db
        .insert(collectionRecords)
        .values({
          collectionId: collection.id,
          fields: stringifyFields(input.fields),
          payload: input.payload,
          expireAt,
        })
        .returning();

      return toRecord(row!);
    });
  }

  /** Query records in a collection (by name). Called by the script bridge. */
  static async find(name: string, query: FindRecordsInput): Promise<Result<readonly CollectionRecordResult[]>> {
    return tryCatch(async () => {
      const collection = await requireByName(name);
      assertKnownFields(Object.keys(query.match), collection.indexedFields, 'find match');
      assertKnownFields(Object.keys(query.filter ?? {}), collection.indexedFields, 'find filter');

      const conditions: SQL[] = [eq(collectionRecords.collectionId, collection.id)];

      if (Object.keys(query.match).length > 0) {
        const matchJson = JSON.stringify(stringifyFields(query.match));
        conditions.push(sql`${collectionRecords.fields} @> ${matchJson}::jsonb`);
      }

      for (const [key, value] of Object.entries(query.filter ?? {})) {
        const fieldText = sql`${collectionRecords.fields} ->> ${key}`;
        conditions.push(
          Array.isArray(value)
            ? inArray(fieldText, value.map(String))
            : eq(fieldText, String(value)),
        );
      }

      const latest = query.latest;
      const orderExpr = latest || query.order === 'desc'
        ? desc(collectionRecords.createdAt)
        : asc(collectionRecords.createdAt);
      const limit = latest ? 1 : query.limit;

      const base = db.select().from(collectionRecords).where(and(...conditions)).orderBy(orderExpr);
      const rows = await (limit !== undefined ? base.limit(limit) : base);
      return rows.map(toRecord);
    });
  }

  /** List records for a collection (UI browse), newest first. */
  static async listRecords(
    collectionId: string,
    limit = 100,
    offset = 0,
  ): Promise<Result<readonly CollectionRecordResult[]>> {
    return tryCatch(async () => {
      const rows = await db
        .select()
        .from(collectionRecords)
        .where(eq(collectionRecords.collectionId, collectionId))
        .orderBy(desc(collectionRecords.createdAt))
        .limit(limit)
        .offset(offset);
      return rows.map(toRecord);
    });
  }

  /** Delete all expired records across all collections. Called by the pruner. */
  static async pruneExpired(): Promise<Result<number>> {
    return tryCatch(async () => {
      const deleted = await db
        .delete(collectionRecords)
        .where(lt(collectionRecords.expireAt, new Date()))
        .returning({ id: collectionRecords.id });
      return deleted.length;
    });
  }
}

// ----- Internal -----

async function requireByName(name: string): Promise<typeof collections.$inferSelect> {
  const [row] = await db.select().from(collections).where(eq(collections.name, name));
  if (!row) throw new ServiceError('NOT_FOUND', `Collection "${name}" not found`);
  return row;
}

function computeExpireAt(input: StoreRecordInput, defaultTtlSeconds: number | null): Date | null {
  if (input.expireAt !== undefined) return new Date(input.expireAt);
  if (input.ttlSeconds !== undefined) return new Date(Date.now() + input.ttlSeconds * 1000);
  if (defaultTtlSeconds !== null) return new Date(Date.now() + defaultTtlSeconds * 1000);
  return null;
}

function toRecord(row: typeof collectionRecords.$inferSelect): CollectionRecordResult {
  return {
    id: row.id,
    fields: row.fields as Record<string, string>,
    payload: row.payload,
    expireAt: row.expireAt,
    createdAt: row.createdAt,
  };
}

function emitCollectionEvent(context: AuditContext | undefined, attributes: Record<string, unknown>): void {
  emitEvent({
    level: 'INFO', name: 'COLLECTION_UPDATED', outcome: 'SUCCESS',
    userId: context?.userId ?? null, channelId: null,
    serverId: null, ipAddress: context?.ipAddress ?? null,
    attributes,
  });
}
