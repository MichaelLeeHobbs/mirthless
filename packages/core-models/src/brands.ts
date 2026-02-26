// ===========================================
// Branded Types
// ===========================================
// Type-safe ID wrappers that prevent accidental mixing of different ID types.
// Based on design doc 01-core-models.md.

import { z } from 'zod/v4';

declare const __brand: unique symbol;
type Brand<T, TBrand extends string> = T & { readonly [__brand]: TBrand };

/** Branded string type for domain IDs */
export type BrandedString<TBrand extends string> = Brand<string, TBrand>;

/** Branded number type for domain values */
export type BrandedNumber<TBrand extends string> = Brand<number, TBrand>;

// --- Domain ID Types ---

export type ChannelId = BrandedString<'ChannelId'>;
export type ConnectorId = BrandedString<'ConnectorId'>;
export type MessageId = BrandedString<'MessageId'>;
export type UserId = BrandedString<'UserId'>;
export type AlertId = BrandedString<'AlertId'>;
export type CodeTemplateId = BrandedString<'CodeTemplateId'>;
export type CodeTemplateLibraryId = BrandedString<'CodeTemplateLibraryId'>;
export type ChannelGroupId = BrandedString<'ChannelGroupId'>;
export type TagId = BrandedString<'TagId'>;
export type ServerId = BrandedString<'ServerId'>;

// --- Branded Number Types ---

/** 0 = source connector, 1+ = destination connectors */
export type MetaDataId = BrandedNumber<'MetaDataId'>;

/** Monotonically increasing version counter */
export type Revision = BrandedNumber<'Revision'>;

// --- UUID Regex ---

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// --- Factory function type ---

interface BrandFactory<T> {
  (value: string): T;
  schema: z.ZodType<T>;
}

/** Creates a branded string factory with UUID validation */
function makeStringFactory<TBrand extends string>(
  _name: TBrand
): BrandFactory<BrandedString<TBrand>> {
  const schema = z.string().uuid() as unknown as z.ZodType<BrandedString<TBrand>>;

  const factory = (value: string): BrandedString<TBrand> => {
    if (!UUID_REGEX.test(value)) {
      throw new Error(`Invalid ${_name}: not a valid UUID`);
    }
    return value as BrandedString<TBrand>;
  };

  factory.schema = schema;
  return factory;
}

// --- Factory Instances ---

export const createChannelId = makeStringFactory('ChannelId');
export const createConnectorId = makeStringFactory('ConnectorId');
export const createMessageId = makeStringFactory('MessageId');
export const createUserId = makeStringFactory('UserId');
export const createAlertId = makeStringFactory('AlertId');
export const createCodeTemplateId = makeStringFactory('CodeTemplateId');
export const createCodeTemplateLibraryId = makeStringFactory('CodeTemplateLibraryId');
export const createChannelGroupId = makeStringFactory('ChannelGroupId');
export const createTagId = makeStringFactory('TagId');
export const createServerId = makeStringFactory('ServerId');

/** Creates a MetaDataId (0 = source, 1+ = destination) */
export function createMetaDataId(value: number): MetaDataId {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error('Invalid MetaDataId: must be a non-negative integer');
  }
  return value as MetaDataId;
}

/** Creates a Revision (non-negative integer) */
export function createRevision(value: number): Revision {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error('Invalid Revision: must be a non-negative integer');
  }
  return value as Revision;
}

// --- Zod Schemas for branded types ---

export const channelIdSchema = createChannelId.schema;
export const connectorIdSchema = createConnectorId.schema;
export const messageIdSchema = createMessageId.schema;
export const userIdSchema = createUserId.schema;
export const alertIdSchema = createAlertId.schema;
export const codeTemplateIdSchema = createCodeTemplateId.schema;
export const codeTemplateLibraryIdSchema = createCodeTemplateLibraryId.schema;
export const channelGroupIdSchema = createChannelGroupId.schema;
export const tagIdSchema = createTagId.schema;
export const serverIdSchema = createServerId.schema;

export const metaDataIdSchema = z.number().int().nonnegative() as unknown as z.ZodType<MetaDataId>;
export const revisionSchema = z.number().int().nonnegative() as unknown as z.ZodType<Revision>;
