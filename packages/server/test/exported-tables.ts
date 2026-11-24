// The tables a channel export is read from, and the fields its file has for them.

import type { PgTable } from 'drizzle-orm/pg-core';
import { channelExportEntrySchema } from '@galvanigraph/core-models';
import {
  channels, channelConnectors, channelScripts, channelMetadataColumns,
  channelFilters, filterRules, channelTransformers, transformerSteps,
} from '../src/db/schema/index.js';

const entry = channelExportEntrySchema.shape;
const filter = entry.filters.element.shape;
const transformer = entry.transformers.element.shape;

const NEW_ROW = 'the importing server makes its own';
const PARENT = 'the entry it is listed in';
const ORDER = 'its place in the list';

export interface ExportedTable {
  readonly table: PgTable;
  readonly fields: object;
  /** Columns left out on purpose, with the reason. */
  readonly notExported: Readonly<Record<string, string>>;
}

export const EXPORTED_TABLES = {
  channels: {
    table: channels,
    fields: entry,
    notExported: {
      createdAt: NEW_ROW,
      updatedAt: NEW_ROW,
      deletedAt: 'a deleted channel is not exported',
      lastDeployedAt: 'an import does not deploy',
    },
  },
  channelConnectors: {
    table: channelConnectors,
    fields: entry.destinations.element.shape,
    notExported: {
      id: 'metaDataId names the destination',
      channelId: PARENT,
      chainId: 'nothing sets or reads it',
      orderInChain: 'nothing sets or reads it',
      createdAt: NEW_ROW,
      updatedAt: NEW_ROW,
    },
  },
  channelScripts: { table: channelScripts, fields: entry.scripts.element.shape, notExported: { id: NEW_ROW, channelId: PARENT } },
  channelMetadataColumns: { table: channelMetadataColumns, fields: entry.metadataColumns.element.shape, notExported: { id: NEW_ROW, channelId: PARENT } },
  channelFilters: { table: channelFilters, fields: filter, notExported: { id: NEW_ROW, channelId: PARENT } },
  filterRules: { table: filterRules, fields: filter.rules.element.shape, notExported: { id: NEW_ROW, filterId: PARENT, sequenceNumber: ORDER } },
  channelTransformers: { table: channelTransformers, fields: transformer, notExported: { id: NEW_ROW, channelId: PARENT } },
  transformerSteps: { table: transformerSteps, fields: transformer.steps.element.shape, notExported: { id: NEW_ROW, transformerId: PARENT, sequenceNumber: ORDER } },
} as const satisfies Readonly<Record<string, ExportedTable>>;

export type ExportedTableName = keyof typeof EXPORTED_TABLES;
