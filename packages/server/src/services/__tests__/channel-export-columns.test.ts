// A column the export file has no field for is lost by every export and import, and by a backup restore (#334).

import { describe, it, expect } from 'vitest';
import { getTableColumns, type Table } from 'drizzle-orm';
import { channelExportEntrySchema } from '@galvanigraph/core-models';
import {
  channels, channelConnectors, channelScripts, channelMetadataColumns,
  channelFilters, filterRules, channelTransformers, transformerSteps,
} from '../../db/schema/index.js';

const entry = channelExportEntrySchema.shape;
const filter = entry.filters.element.shape;
const transformer = entry.transformers.element.shape;

const NEW_ROW = 'the importing server makes its own';
const PARENT = 'the entry it is listed in';
const ORDER = 'its place in the list';

interface ExportedTable {
  readonly table: Table;
  readonly fields: object;
  /** Columns left out on purpose, with the reason. */
  readonly notExported: Readonly<Record<string, string>>;
}

const TABLES: Readonly<Record<string, ExportedTable>> = {
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
  channel_connectors: {
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
  channel_scripts: { table: channelScripts, fields: entry.scripts.element.shape, notExported: { id: NEW_ROW, channelId: PARENT } },
  channel_metadata_columns: { table: channelMetadataColumns, fields: entry.metadataColumns.element.shape, notExported: { id: NEW_ROW, channelId: PARENT } },
  channel_filters: { table: channelFilters, fields: filter, notExported: { id: NEW_ROW, channelId: PARENT } },
  filter_rules: { table: filterRules, fields: filter.rules.element.shape, notExported: { id: NEW_ROW, filterId: PARENT, sequenceNumber: ORDER } },
  channel_transformers: { table: channelTransformers, fields: transformer, notExported: { id: NEW_ROW, channelId: PARENT } },
  transformer_steps: { table: transformerSteps, fields: transformer.steps.element.shape, notExported: { id: NEW_ROW, transformerId: PARENT, sequenceNumber: ORDER } },
};

describe('the channel export file', () => {
  it.each(Object.entries(TABLES))('has a field for every %s column, or a reason not to', (_name, { table, fields, notExported }) => {
    const columns = Object.keys(getTableColumns(table));
    const exported = Object.keys(fields).filter((field) => columns.includes(field));
    expect([...exported, ...Object.keys(notExported)].sort()).toEqual([...columns].sort());
  });
});
