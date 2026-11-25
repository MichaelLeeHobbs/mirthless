// Design: docs/design/10-collections.md.

import { tryCatch, type Result } from 'stderr-lib';
import { and, eq, asc, desc, gt, inArray, isNull, lt, or, sql, type SQL } from 'drizzle-orm';
import type {
  CreateCollectionInput,
  UpdateCollectionInput,
  StoreRecordInput,
  FindRecordsInput,
  ListRecordsQuery,
  RecordColumn,
  UpdateRecordInput,
} from '@galvanigraph/core-models';
import { ServiceError } from '../lib/service-error.js';
import { emitSuccessEvent, type AuditContext } from '../lib/event-emitter.js';
import { db } from '../lib/db.js';
import { containsPattern } from '../lib/like.js';
import { collections, collectionRecords } from '../db/schema/index.js';

const MAX_PAYLOAD_BYTES = 1_048_576;

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

export interface RecordPage {
  readonly items: readonly CollectionRecordResult[];
  readonly total: number;
}

/** Strings, so GIN `@>` matching is type-consistent. */
function stringifyFields(fields: Record<string, string | number | boolean>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(fields)) out[k] = String(v);
  return out;
}

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

export class CollectionService {
  static async list(): Promise<Result<readonly CollectionSummary[]>> {
    return tryCatch(async () => {
      const rows = await db.select().from(collections).orderBy(asc(collections.name));
      return rows.map(toSummary);
    });
  }

  static async getById(id: string): Promise<Result<CollectionSummary>> {
    return tryCatch(async () => toSummary(await requireById(id)));
  }

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

      emitSuccessEvent('COLLECTION_UPDATED', context, { action: 'create', collectionName: input.name });
      return toSummary(row!);
    });
  }

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
      emitSuccessEvent('COLLECTION_UPDATED', context, { action: 'update', collectionId: id });
      return toSummary(row!);
    });
  }

  /** Cascades to its records. */
  static async delete(id: string, context?: AuditContext): Promise<Result<void>> {
    return tryCatch(async () => {
      const [existing] = await db.select({ id: collections.id }).from(collections).where(eq(collections.id, id));
      if (!existing) throw new ServiceError('NOT_FOUND', `Collection ${id} not found`);
      await db.delete(collections).where(eq(collections.id, id));
      emitSuccessEvent('COLLECTION_UPDATED', context, { action: 'delete', collectionId: id });
    });
  }

  static async store(name: string, input: StoreRecordInput): Promise<Result<CollectionRecordResult>> {
    return tryCatch(async () => insertRecord(await requireByName(name), input));
  }

  static async find(name: string, query: FindRecordsInput): Promise<Result<readonly CollectionRecordResult[]>> {
    return tryCatch(async () => {
      const collection = await requireByName(name);
      assertKnownFields(Object.keys(query.match), collection.indexedFields, 'find match');
      assertKnownFields(Object.keys(query.filter ?? {}), collection.indexedFields, 'find filter');

      const conditions: (SQL | undefined)[] = [eq(collectionRecords.collectionId, collection.id), livesOn()];

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

  static async listRecords(collectionId: string, query: ListRecordsQuery): Promise<Result<RecordPage>> {
    return tryCatch(async () => {
      const collection = await requireById(collectionId);
      const sortExpr = columnExpr(query.sort, collection.indexedFields);
      const conditions: SQL[] = [eq(collectionRecords.collectionId, collectionId)];
      const search = searchCondition(query, collection.indexedFields);
      if (search) conditions.push(search);
      const where = and(...conditions);

      const rows = await db
        .select()
        .from(collectionRecords)
        .where(where)
        .orderBy(query.order === 'asc' ? asc(sortExpr) : desc(sortExpr), desc(collectionRecords.createdAt), asc(collectionRecords.id))
        .limit(query.pageSize)
        .offset((query.page - 1) * query.pageSize);
      const [counted] = await db.select({ total: sql<number>`count(*)::int` }).from(collectionRecords).where(where);
      return { items: rows.map(toRecord), total: counted?.total ?? 0 };
    });
  }

  static async createRecord(
    collectionId: string,
    input: StoreRecordInput,
    context?: AuditContext,
  ): Promise<Result<CollectionRecordResult>> {
    return tryCatch(async () => {
      const record = await insertRecord(await requireById(collectionId), input);
      emitSuccessEvent('COLLECTION_UPDATED', context, { action: 'record.create', collectionId, recordId: record.id });
      return record;
    });
  }

  /** Only the keys given change. */
  static async updateRecord(
    collectionId: string,
    recordId: string,
    input: UpdateRecordInput,
    context?: AuditContext,
  ): Promise<Result<CollectionRecordResult>> {
    return tryCatch(async () => {
      const record = await patchRecord(await requireById(collectionId), recordId, input);
      if (!record) throw new ServiceError('NOT_FOUND', `Record ${recordId} not found`);
      emitSuccessEvent('COLLECTION_UPDATED', context, { action: 'record.update', collectionId, recordId });
      return record;
    });
  }

  static async deleteRecord(collectionId: string, recordId: string, context?: AuditContext): Promise<Result<void>> {
    return tryCatch(async () => {
      if (!(await removeRecord(collectionId, recordId))) {
        throw new ServiceError('NOT_FOUND', `Record ${recordId} not found`);
      }
      emitSuccessEvent('COLLECTION_UPDATED', context, { action: 'record.delete', collectionId, recordId });
    });
  }

  /**
   * Null when the record is gone (deleted, pruned, or expired and not given a new life), so a script
   * can decide: what it wrote to an expired one would never be found, and then be pruned.
   */
  static async updateByName(name: string, recordId: string, input: UpdateRecordInput): Promise<Result<CollectionRecordResult | null>> {
    return tryCatch(async () => patchRecord(await requireByName(name), recordId, input, givesLife(input) ? undefined : livesOn()));
  }

  /** False when it was already gone. */
  static async removeByName(name: string, recordId: string): Promise<Result<boolean>> {
    return tryCatch(async () => removeRecord((await requireByName(name)).id, recordId));
  }

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

async function requireById(id: string): Promise<typeof collections.$inferSelect> {
  const [row] = await db.select().from(collections).where(eq(collections.id, id));
  if (!row) throw new ServiceError('NOT_FOUND', `Collection ${id} not found`);
  return row;
}

function assertPayloadSize(payload: string): void {
  if (Buffer.byteLength(payload, 'utf-8') > MAX_PAYLOAD_BYTES) {
    throw new ServiceError('INVALID_INPUT', `Payload exceeds ${String(MAX_PAYLOAD_BYTES)} bytes`);
  }
}

async function insertRecord(
  collection: typeof collections.$inferSelect,
  input: StoreRecordInput,
): Promise<CollectionRecordResult> {
  assertPayloadSize(input.payload);
  assertKnownFields(Object.keys(input.fields), collection.indexedFields, 'store');
  const [row] = await db
    .insert(collectionRecords)
    .values({
      collectionId: collection.id,
      fields: stringifyFields(input.fields),
      payload: input.payload,
      expireAt: computeExpireAt(input, collection.defaultTtlSeconds),
    })
    .returning();
  return toRecord(row!);
}

/** By the clock that a TTL is counted from, which is not the database's. */
function livesOn(): SQL | undefined {
  return or(isNull(collectionRecords.expireAt), gt(collectionRecords.expireAt, new Date()));
}

function givesLife({ expireAt }: UpdateRecordInput): boolean {
  return expireAt === null || (expireAt !== undefined && Date.parse(expireAt) > Date.now());
}

async function patchRecord(
  collection: typeof collections.$inferSelect,
  recordId: string,
  input: UpdateRecordInput,
  only?: SQL,
): Promise<CollectionRecordResult | null> {
  const changes: Partial<typeof collectionRecords.$inferInsert> = {};
  if (input.fields !== undefined) {
    assertKnownFields(Object.keys(input.fields), collection.indexedFields, 'update');
    changes.fields = stringifyFields(input.fields);
  }
  if (input.payload !== undefined) {
    assertPayloadSize(input.payload);
    changes.payload = input.payload;
  }
  if (input.expireAt !== undefined) changes.expireAt = input.expireAt === null ? null : new Date(input.expireAt);
  const [row] = await db
    .update(collectionRecords)
    .set(changes)
    .where(and(eq(collectionRecords.id, recordId), eq(collectionRecords.collectionId, collection.id), only))
    .returning();
  return row ? toRecord(row) : null;
}

async function removeRecord(collectionId: string, recordId: string): Promise<boolean> {
  const deleted = await db
    .delete(collectionRecords)
    .where(and(eq(collectionRecords.id, recordId), eq(collectionRecords.collectionId, collectionId)))
    .returning({ id: collectionRecords.id });
  return deleted.length > 0;
}

function columnExpr(column: RecordColumn, indexedFields: readonly string[]): SQL {
  switch (column) {
    case 'createdAt': return sql`${collectionRecords.createdAt}`;
    case 'expireAt': return sql`${collectionRecords.expireAt}`;
    case 'payload': return sql`${collectionRecords.payload}`;
    default: {
      const field = column.slice('fields.'.length);
      assertKnownFields([field], indexedFields, 'column');
      return sql`${collectionRecords.fields} ->> ${field}`;
    }
  }
}

function searchCondition(query: ListRecordsQuery, indexedFields: readonly string[]): SQL | undefined {
  const text = query.q?.trim() ?? '';
  if (text === '') return undefined;
  const pattern = containsPattern(text);
  if (query.in !== undefined) return sql`(${columnExpr(query.in, indexedFields)})::text ilike ${pattern}`;
  return or(
    sql`exists (select 1 from jsonb_each_text(${collectionRecords.fields}) as f where f.value ilike ${pattern})`,
    sql`${collectionRecords.payload} ilike ${pattern}`,
  );
}

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
