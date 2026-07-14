// ===========================================
// Showcase Seed
// ===========================================
// Populates one human-reviewable EXAMPLE row for every feature page that would
// otherwise render empty: Resources, Collections, Code Templates, Global
// Scripts, Global Map, Config Map, Data Sources, Alerts, plus a headline
// channel that exercises destination-level filter + transformer + response
// transformer. All rows are clearly named ("Example"/"example-") so they read
// as seed data.
//
// Idempotent: every entity is checked by its natural key before creation and a
// short +/= line is logged per item (matching run-seed's style). Re-running is
// a clean no-op. The data source is gated on content encryption being
// configured (its password is encrypted at rest); it is skipped otherwise.

import { eq, and, isNull } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type { CreateAlertInput, CreateDataSourceInput } from '@mirthless/core-models';
import * as schema from '../schema/index.js';
import { isContentEncryptionConfigured } from '../../lib/content-crypto.js';
import { AlertService } from '../../services/alert.service.js';
import { DataSourceService } from '../../services/data-source.service.js';

type Db = NodePgDatabase<typeof schema>;

// ----- Logging helpers (match run-seed's +/= style) -----

function added(label: string): void {
  // eslint-disable-next-line no-console
  console.log(`  + ${label}`);
}

function skipped(label: string): void {
  // eslint-disable-next-line no-console
  console.log(`  = ${label} (exists)`);
}

// ----- Resources -----

interface ResourceSeed {
  readonly name: string;
  readonly description: string;
  readonly mimeType: string;
  readonly content: string;
}

async function upsertResource(db: Db, seed: ResourceSeed): Promise<void> {
  const [existing] = await db
    .select({ id: schema.resources.id })
    .from(schema.resources)
    .where(eq(schema.resources.name, seed.name));
  if (existing) {
    skipped(`resource ${seed.name}`);
    return;
  }
  await db.insert(schema.resources).values({
    name: seed.name,
    description: seed.description,
    mimeType: seed.mimeType,
    sizeBytes: Buffer.byteLength(seed.content, 'utf-8'),
    content: seed.content,
  });
  added(`resource ${seed.name}`);
}

async function seedResources(db: Db): Promise<void> {
  await upsertResource(db, {
    name: 'example-facility-codes',
    description: 'Example facility code lookup table (CSV).',
    mimeType: 'text/csv',
    content: 'code,name\nVNS,Vanderbilt North Site\nMHH,Memorial Hermann Hospital\n',
  });
  await upsertResource(db, {
    name: 'example-order-priority-map',
    description: 'Example HL7 order-priority code map (JSON).',
    mimeType: 'application/json',
    content: JSON.stringify({ S: 'STAT', A: 'ASAP', R: 'Routine' }, null, 2),
  });
}

// ----- Collections -----

interface RecordSeed {
  readonly fields: Record<string, string | number | boolean>;
  readonly payload: string;
  readonly expireAt: Date | null;
}

async function seedCollection(db: Db): Promise<void> {
  const name = 'example-orders';
  const [existing] = await db
    .select({ id: schema.collections.id })
    .from(schema.collections)
    .where(eq(schema.collections.name, name));
  if (existing) {
    skipped(`collection ${name}`);
    return;
  }
  const [row] = await db
    .insert(schema.collections)
    .values({
      name,
      description: 'Example orders keyed by accession number.',
      indexedFields: ['accessionNumber', 'institutionName', 'orderControl'],
      defaultTtlSeconds: 2_592_000,
    })
    .returning({ id: schema.collections.id });
  const collectionId = row!.id;
  const inThirtyDays = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  const records: ReadonlyArray<RecordSeed> = [
    { fields: { accessionNumber: 'ACC1001', institutionName: 'VNS', orderControl: 'NW' }, payload: JSON.stringify({ test: 'CBC', priority: 'Routine' }), expireAt: null },
    { fields: { accessionNumber: 'ACC1002', institutionName: 'MHH', orderControl: 'NW' }, payload: JSON.stringify({ test: 'BMP', priority: 'STAT' }), expireAt: inThirtyDays },
    { fields: { accessionNumber: 'ACC1003', institutionName: 'VNS', orderControl: 'CA' }, payload: JSON.stringify({ test: 'CBC', priority: 'ASAP' }), expireAt: null },
  ];
  for (const rec of records) {
    await db.insert(schema.collectionRecords).values({ collectionId, fields: rec.fields, payload: rec.payload, expireAt: rec.expireAt });
  }
  added(`collection ${name} (${records.length} records)`);
}

// ----- Code Templates -----

async function seedCodeTemplate(db: Db): Promise<void> {
  const libName = 'Example Library';
  const [existing] = await db
    .select({ id: schema.codeTemplateLibraries.id })
    .from(schema.codeTemplateLibraries)
    .where(eq(schema.codeTemplateLibraries.name, libName));
  if (existing) {
    skipped(`code template library ${libName}`);
    return;
  }
  const [lib] = await db
    .insert(schema.codeTemplateLibraries)
    .values({ name: libName, description: 'Example reusable functions shared across channels.' })
    .returning({ id: schema.codeTemplateLibraries.id });
  await db.insert(schema.codeTemplates).values({
    libraryId: lib!.id,
    name: 'formatName',
    description: 'Formats an HL7 XPN family/given pair as "Given Family".',
    type: 'FUNCTION',
    code: [
      '/**',
      ' * Format a patient name as "Given Family".',
      ' * @param {string} family PID.5.1',
      ' * @param {string} given PID.5.2',
      ' * @return {string}',
      ' */',
      'function formatName(family, given) {',
      "  return ((given || '') + ' ' + (family || '')).trim();",
      '}',
    ].join('\n'),
    contexts: ['SOURCE_FILTER_TRANSFORMER', 'DESTINATION_FILTER_TRANSFORMER'],
  });
  added(`code template library ${libName} (+ formatName)`);
}

// ----- Global Scripts -----

interface GlobalScriptSeed {
  readonly scriptType: string;
  readonly script: string;
}

async function seedGlobalScripts(db: Db): Promise<void> {
  const seeds: ReadonlyArray<GlobalScriptSeed> = [
    { scriptType: 'PREPROCESSOR', script: ["// Runs for every message before channel processing.", "logger.info('Global preprocessor: message received');", 'return message;'].join('\n') },
    { scriptType: 'DEPLOY', script: ["// Runs once when the server deploys channels.", "logger.info('Global deploy script executed');"].join('\n') },
  ];
  for (const seed of seeds) {
    const [existing] = await db
      .select({ scriptType: schema.globalScripts.scriptType })
      .from(schema.globalScripts)
      .where(eq(schema.globalScripts.scriptType, seed.scriptType));
    if (existing) {
      skipped(`global script ${seed.scriptType}`);
      continue;
    }
    await db.insert(schema.globalScripts).values({ scriptType: seed.scriptType, script: seed.script });
    added(`global script ${seed.scriptType}`);
  }
}

// ----- Global Map -----

async function seedGlobalMap(db: Db): Promise<void> {
  const entries: ReadonlyArray<{ readonly key: string; readonly value: string }> = [
    { key: 'environment', value: 'development' },
    { key: 'facilityCode', value: 'VNS' },
  ];
  for (const entry of entries) {
    const [existing] = await db
      .select({ key: schema.globalMapEntries.key })
      .from(schema.globalMapEntries)
      .where(eq(schema.globalMapEntries.key, entry.key));
    if (existing) {
      skipped(`global map ${entry.key}`);
      continue;
    }
    await db.insert(schema.globalMapEntries).values({ key: entry.key, value: entry.value });
    added(`global map ${entry.key}`);
  }
}

// ----- Config Map -----

async function seedConfigMap(db: Db): Promise<void> {
  const rows: ReadonlyArray<{ readonly category: string; readonly name: string; readonly value: string }> = [
    { category: 'endpoints', name: 'labSystemUrl', value: 'https://lab.example.local/api' },
    { category: 'flags', name: 'enableEnrichment', value: 'true' },
    { category: 'flags', name: 'defaultInstitution', value: 'VNS' },
  ];
  for (const row of rows) {
    const [existing] = await db
      .select({ name: schema.configuration.name })
      .from(schema.configuration)
      .where(and(eq(schema.configuration.category, row.category), eq(schema.configuration.name, row.name)));
    if (existing) {
      skipped(`config ${row.category}/${row.name}`);
      continue;
    }
    await db.insert(schema.configuration).values(row);
    added(`config ${row.category}/${row.name}`);
  }
}

// ----- Data Source (gated on content encryption) -----

async function seedDataSource(db: Db): Promise<void> {
  const name = 'reporting-db';
  if (!isContentEncryptionConfigured()) {
    // eslint-disable-next-line no-console
    console.log(`  ~ data source ${name} (skipped: CONTENT_ENCRYPTION_KEY not configured)`);
    return;
  }
  const [existing] = await db
    .select({ id: schema.dataSources.id })
    .from(schema.dataSources)
    .where(eq(schema.dataSources.name, name));
  if (existing) {
    skipped(`data source ${name}`);
    return;
  }
  const input: CreateDataSourceInput = {
    name,
    description: 'Example read-only reporting connection (local Postgres).',
    driver: 'postgres',
    host: 'localhost',
    port: 5432,
    database: 'mirthless',
    user: 'mirthless',
    password: 'mirthless_dev',
    readOnly: true,
    maxConnections: 5,
    statementTimeoutMs: 30_000,
    maxRows: 10_000,
  };
  const result = await DataSourceService.create(input);
  if (!result.ok) {
    throw new Error(`Failed to seed data source ${name}: ${result.error.message}`);
  }
  added(`data source ${name}`);
}

// ----- Alert -----

async function seedAlert(db: Db): Promise<void> {
  const name = 'Example: Channel Error Alert';
  const [existing] = await db
    .select({ id: schema.alerts.id })
    .from(schema.alerts)
    .where(eq(schema.alerts.name, name));
  if (existing) {
    skipped(`alert ${name}`);
    return;
  }
  const input: CreateAlertInput = {
    name,
    description: 'Emails on-call when any channel raises an error.',
    enabled: true,
    trigger: { type: 'CHANNEL_ERROR', errorTypes: ['ANY'], regex: null },
    channelIds: [],
    actions: [{ type: 'EMAIL', recipients: ['oncall@example.com'] }],
    subjectTemplate: 'Mirthless error on ${channelName}',
    bodyTemplate: 'A channel error occurred: ${error}',
    reAlertIntervalMs: null,
    maxAlerts: null,
  };
  const result = await AlertService.create(input);
  if (!result.ok) {
    throw new Error(`Failed to seed alert ${name}: ${result.error.message}`);
  }
  added(`alert ${name}`);
}

// ----- Headline Channel (dest filter + transformer + response transformer) -----

async function findChannelId(db: Db, name: string): Promise<string | null> {
  const [row] = await db
    .select({ id: schema.channels.id })
    .from(schema.channels)
    .where(and(eq(schema.channels.name, name), isNull(schema.channels.deletedAt)));
  return row?.id ?? null;
}

const HEADLINE_SCRIPT_TYPES = ['DEPLOY', 'UNDEPLOY', 'PREPROCESSOR', 'POSTPROCESSOR'] as const;

async function insertHeadlineChannel(db: Db, name: string): Promise<string> {
  const [row] = await db
    .insert(schema.channels)
    .values({
      name,
      description: 'Inbound HL7v2 over MLLP, routed to a destination with a destination-level filter, transformer, and response transformer.',
      enabled: false,
      inboundDataType: 'HL7V2',
      outboundDataType: 'HL7V2',
      sourceConnectorType: 'TCP_MLLP',
      sourceConnectorProperties: { host: '0.0.0.0', port: 6680, responseMode: 'AUTO_ACK', charset: 'utf-8' },
      initialState: 'STOPPED',
      messageStorageMode: 'DEVELOPMENT',
    })
    .returning({ id: schema.channels.id });
  const channelId = row!.id;
  for (const scriptType of HEADLINE_SCRIPT_TYPES) {
    await db.insert(schema.channelScripts).values({ channelId, scriptType, script: '' });
  }
  return channelId;
}

async function insertHeadlineDestination(db: Db, channelId: string): Promise<string> {
  const [row] = await db
    .insert(schema.channelConnectors)
    .values({
      channelId,
      metaDataId: 1,
      name: 'HL7 Writer',
      enabled: true,
      connectorType: 'JAVASCRIPT',
      properties: {
        script: ["// Deliver the transformed message.", "logger.info('Delivering message: ' + msg);", "return 'delivered';"].join('\n'),
      },
      responseTransformer: ['// Normalize the destination response before it is stored.', "response = (response || '').trim();"].join('\n'),
      queueMode: 'NEVER',
    })
    .returning({ id: schema.channelConnectors.id });
  return row!.id;
}

async function addDestinationFilter(db: Db, channelId: string, connectorId: string): Promise<void> {
  const [filter] = await db
    .insert(schema.channelFilters)
    .values({ channelId, connectorId })
    .returning({ id: schema.channelFilters.id });
  await db.insert(schema.filterRules).values({
    filterId: filter!.id,
    sequenceNumber: 0,
    enabled: true,
    operator: 'AND',
    type: 'JAVASCRIPT',
    name: 'Only ADT^A01',
    script: ['// Destination filter: only admit ADT^A01 to this destination.', "return msg.get('MSH.9.2') === 'A01';"].join('\n'),
  });
}

async function addDestinationTransformer(db: Db, channelId: string, connectorId: string): Promise<void> {
  const [transformer] = await db
    .insert(schema.channelTransformers)
    .values({ channelId, connectorId, inboundDataType: 'HL7V2', outboundDataType: 'HL7V2', inboundProperties: {}, outboundProperties: {} })
    .returning({ id: schema.channelTransformers.id });
  await db.insert(schema.transformerSteps).values({
    transformerId: transformer!.id,
    sequenceNumber: 0,
    enabled: true,
    name: 'Tag destination',
    type: 'JAVASCRIPT',
    script: ['// Destination transformer: record which destination handled the message.', "channelMap['deliveredVia'] = 'HL7 Writer';"].join('\n'),
  });
}

async function seedHeadlineChannel(db: Db): Promise<void> {
  const name = 'Example: Full Pipeline';
  const existing = await findChannelId(db, name);
  if (existing) {
    skipped(`channel ${name}`);
    return;
  }
  const channelId = await insertHeadlineChannel(db, name);
  const connectorId = await insertHeadlineDestination(db, channelId);
  await addDestinationFilter(db, channelId, connectorId);
  await addDestinationTransformer(db, channelId, connectorId);
  added(`channel ${name} (dest filter + transformer + response transformer)`);
}

// ----- Main -----

export async function seedShowcase(db: Db): Promise<void> {
  // eslint-disable-next-line no-console
  console.log('\nSeeding showcase example data...');
  await seedResources(db);
  await seedCollection(db);
  await seedCodeTemplate(db);
  await seedGlobalScripts(db);
  await seedGlobalMap(db);
  await seedConfigMap(db);
  await seedDataSource(db);
  await seedAlert(db);
  await seedHeadlineChannel(db);
}
