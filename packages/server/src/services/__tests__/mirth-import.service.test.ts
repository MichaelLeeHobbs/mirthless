// ===========================================
// Mirth Connect XML Import Service Tests
// ===========================================

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Mock database and dependencies (must be before imports)
vi.mock('../../lib/db.js', () => ({
  db: {
    select: vi.fn().mockReturnValue({ from: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) }) }),
    insert: vi.fn().mockReturnValue({ values: vi.fn().mockReturnValue({ returning: vi.fn().mockResolvedValue([{ id: 'new-id' }]) }) }),
    update: vi.fn().mockReturnValue({ set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) }) }),
    delete: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) }),
    transaction: vi.fn(async (fn) => fn({
      insert: vi.fn().mockReturnValue({ values: vi.fn().mockReturnValue({ returning: vi.fn().mockResolvedValue([{ id: 'new-id' }]) }) }),
      update: vi.fn().mockReturnValue({ set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) }) }),
      delete: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) }),
    })),
  },
}));

vi.mock('../../lib/event-emitter.js', () => ({
  emitEvent: vi.fn(),
}));

vi.mock('../../lib/logger.js', () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('../partition-manager.service.js', () => ({
  PartitionManagerService: {
    createPartitions: vi.fn().mockResolvedValue({ ok: true, value: undefined, error: null }),
  },
}));

vi.mock('../../db/schema/index.js', () => ({
  channels: { id: 'id' },
  channelScripts: { channelId: 'channelId' },
  channelConnectors: { channelId: 'channelId' },
  channelMetadataColumns: { channelId: 'channelId' },
  channelFilters: { channelId: 'channelId', id: 'id' },
  filterRules: { filterId: 'filterId' },
  channelTransformers: { channelId: 'channelId', id: 'id' },
  transformerSteps: { transformerId: 'transformerId' },
}));

import type { ChannelExportEntry } from '@galvaniflow/core-models';
import { MirthImportService } from '../mirth-import.service.js';

// ----- Helpers -----

function loadFixture(name: string): string {
  return readFileSync(resolve(__dirname, 'fixtures', name), 'utf-8');
}

// ----- Setup -----

beforeEach(() => {
  vi.clearAllMocks();
});

// ----- convertXml -----

describe('MirthImportService.convertXml', () => {
  it('converts a basic Mirth channel XML', () => {
    const xml = loadFixture('mirth-channel-basic.xml');
    const result = MirthImportService.convertXml(xml);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.channels).toHaveLength(1);
    expect(result.value.channels[0]?.name).toBe('HL7 Inbound Listener');
    expect(result.value.channels[0]?.description).toBe('Basic TCP listener for HL7 messages');
    expect(result.value.channels[0]?.enabled).toBe(true);
    expect(result.value.warnings).toHaveLength(0);
  });

  it('rejects XML containing a DOCTYPE (entity-expansion/XXE defense)', () => {
    const xml = '<!DOCTYPE foo [<!ENTITY a "x">]><channel><name>Evil</name></channel>';
    const result = MirthImportService.convertXml(xml);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).toContain('DOCTYPE');
  });

  it('preserves channel ID from XML', () => {
    const xml = loadFixture('mirth-channel-basic.xml');
    const result = MirthImportService.convertXml(xml);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.channels[0]?.id).toBe('a1b2c3d4-e5f6-7890-abcd-ef1234567890');
  });

  it('maps TCP receiver connector type correctly', () => {
    const xml = loadFixture('mirth-channel-basic.xml');
    const result = MirthImportService.convertXml(xml);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.channels[0]?.sourceConnectorType).toBe('TCP_MLLP');
  });

  it('maps HTTP dispatcher connector type correctly', () => {
    const xml = loadFixture('mirth-channel-basic.xml');
    const result = MirthImportService.convertXml(xml);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.channels[0]?.destinations).toHaveLength(1);
    expect(result.value.channels[0]?.destinations[0]?.connectorType).toBe('HTTP');
  });

  it('extracts deploy and undeploy scripts', () => {
    const xml = loadFixture('mirth-channel-basic.xml');
    const result = MirthImportService.convertXml(xml);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const scripts = result.value.channels[0]?.scripts ?? [];
    const deployScript = scripts.find((s) => s.scriptType === 'DEPLOY');
    const undeployScript = scripts.find((s) => s.scriptType === 'UNDEPLOY');
    expect(deployScript?.script).toBe("logger.info('Channel deployed');");
    expect(undeployScript?.script).toBe("logger.info('Channel undeployed');");
  });

  it('converts complex XML with multiple destinations', () => {
    const xml = loadFixture('mirth-channel-complex.xml');
    const result = MirthImportService.convertXml(xml);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.channels[0]?.destinations).toHaveLength(3);
    expect(result.value.channels[0]?.destinations[0]?.name).toBe('File Archive');
    expect(result.value.channels[0]?.destinations[0]?.connectorType).toBe('FILE');
    expect(result.value.channels[0]?.destinations[1]?.name).toBe('Database Logger');
    expect(result.value.channels[0]?.destinations[1]?.connectorType).toBe('DATABASE');
    expect(result.value.channels[0]?.destinations[2]?.name).toBe('SMTP Alert');
    expect(result.value.channels[0]?.destinations[2]?.connectorType).toBe('SMTP');
  });

  it('maps FILE connector type from class name', () => {
    const xml = loadFixture('mirth-channel-complex.xml');
    const result = MirthImportService.convertXml(xml);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const fileDest = result.value.channels[0]?.destinations[0];
    expect(fileDest?.connectorType).toBe('FILE');
    expect(fileDest?.properties['directory']).toBe('/opt/archive/hl7');
  });

  it('maps DATABASE connector type from class name', () => {
    const xml = loadFixture('mirth-channel-complex.xml');
    const result = MirthImportService.convertXml(xml);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const dbDest = result.value.channels[0]?.destinations[1];
    expect(dbDest?.connectorType).toBe('DATABASE');
    expect(dbDest?.properties['url']).toBe('jdbc:postgresql://localhost:5432/hl7db');
    expect(dbDest?.properties['driver']).toBe('org.postgresql.Driver');
  });

  it('maps SMTP connector type from class name', () => {
    const xml = loadFixture('mirth-channel-complex.xml');
    const result = MirthImportService.convertXml(xml);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const smtpDest = result.value.channels[0]?.destinations[2];
    expect(smtpDest?.connectorType).toBe('SMTP');
    expect(smtpDest?.properties['host']).toBe('smtp.example.com');
    expect(smtpDest?.properties['port']).toBe(587);
    expect(smtpDest?.properties['to']).toBe('admin@example.com');
  });

  it('generates warning for unknown connector type', () => {
    const xml = `<channel>
      <id>test-unknown</id>
      <name>Unknown Connector</name>
      <enabled>true</enabled>
      <sourceConnector>
        <properties class="com.mirth.connect.connectors.custom.CustomReceiverProperties">
        </properties>
        <transformer>
          <inboundDataType>HL7V2</inboundDataType>
          <outboundDataType>HL7V2</outboundDataType>
        </transformer>
      </sourceConnector>
      <destinationConnectors>
        <connector>
          <name>Dest 1</name>
          <enabled>true</enabled>
          <properties class="com.mirth.connect.connectors.custom.CustomDispatcherProperties">
          </properties>
          <transformer>
            <inboundDataType>HL7V2</inboundDataType>
            <outboundDataType>HL7V2</outboundDataType>
          </transformer>
        </connector>
      </destinationConnectors>
    </channel>`;

    const result = MirthImportService.convertXml(xml);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.warnings.length).toBeGreaterThanOrEqual(1);
    expect(result.value.warnings.some((w) => w.includes('Unknown connector type'))).toBe(true);
    expect(result.value.channels[0]?.sourceConnectorType).toBe('JAVASCRIPT');
  });

  it('converts filter rules from source connector', () => {
    const xml = loadFixture('mirth-channel-complex.xml');
    const result = MirthImportService.convertXml(xml);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const filters = result.value.channels[0]?.filters ?? [];
    const sourceFilter = filters.find((f) => f.connectorId === null);
    expect(sourceFilter).toBeDefined();
    expect(sourceFilter?.rules).toHaveLength(1);
    expect(sourceFilter?.rules[0]?.name).toBe('Accept ADT only');
    expect(sourceFilter?.rules[0]?.type).toBe('JAVASCRIPT');
  });

  it('converts filter rules from destination connectors', () => {
    const xml = loadFixture('mirth-channel-complex.xml');
    const result = MirthImportService.convertXml(xml);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const filters = result.value.channels[0]?.filters ?? [];
    const destFilter = filters.find((f) => f.connectorId === '2');
    expect(destFilter).toBeDefined();
    expect(destFilter?.rules).toHaveLength(1);
    expect(destFilter?.rules[0]?.name).toBe('Only A01 events');
  });

  it('converts transformer steps from source connector', () => {
    const xml = loadFixture('mirth-channel-complex.xml');
    const result = MirthImportService.convertXml(xml);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const transformers = result.value.channels[0]?.transformers ?? [];
    const sourceTransformer = transformers.find((t) => t.connectorId === null);
    expect(sourceTransformer).toBeDefined();
    expect(sourceTransformer?.steps).toHaveLength(2);
    expect(sourceTransformer?.steps[0]?.name).toBe('Set patient name');
    expect(sourceTransformer?.steps[0]?.type).toBe('MAPPER');
    expect(sourceTransformer?.steps[1]?.name).toBe('Add timestamp');
    expect(sourceTransformer?.steps[1]?.type).toBe('JAVASCRIPT');
  });

  it('converts transformer steps from destination connectors', () => {
    const xml = loadFixture('mirth-channel-complex.xml');
    const result = MirthImportService.convertXml(xml);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const transformers = result.value.channels[0]?.transformers ?? [];
    const destTransformer = transformers.find((t) => t.connectorId === '2');
    expect(destTransformer).toBeDefined();
    expect(destTransformer?.steps).toHaveLength(1);
    expect(destTransformer?.steps[0]?.name).toBe('Log message type');
  });

  it('returns error for invalid XML', () => {
    // fast-xml-parser throws on seriously malformed XML
    const result = MirthImportService.convertXml('<<<not valid xml>>>');
    expect(result.ok).toBe(false);
  });

  it('returns error for XML with no channel structure', () => {
    const result = MirthImportService.convertXml('<foo><bar>baz</bar></foo>');
    expect(result.ok).toBe(false);
  });

  it('returns error when no channels found', () => {
    const xml = '<configuration><setting>value</setting></configuration>';
    const result = MirthImportService.convertXml(xml);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toContain('No channels found');
    }
  });

  it('handles empty description gracefully', () => {
    const xml = `<channel>
      <id>test-no-desc</id>
      <name>No Description</name>
      <enabled>true</enabled>
      <sourceConnector>
        <properties class="com.mirth.connect.connectors.js.JavaScriptReceiverProperties"></properties>
        <transformer><inboundDataType>HL7V2</inboundDataType><outboundDataType>HL7V2</outboundDataType></transformer>
      </sourceConnector>
      <destinationConnectors></destinationConnectors>
    </channel>`;

    const result = MirthImportService.convertXml(xml);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.channels[0]?.description).toBeNull();
  });

  it('maps JAVASCRIPT connector type from class name', () => {
    const xml = `<channel>
      <id>test-js</id>
      <name>JS Channel</name>
      <enabled>true</enabled>
      <sourceConnector>
        <properties class="com.mirth.connect.connectors.js.JavaScriptReceiverProperties"></properties>
        <transformer><inboundDataType>HL7V2</inboundDataType><outboundDataType>HL7V2</outboundDataType></transformer>
      </sourceConnector>
      <destinationConnectors>
        <connector>
          <name>JS Dest</name>
          <enabled>true</enabled>
          <properties class="com.mirth.connect.connectors.js.JavaScriptDispatcherProperties"></properties>
          <transformer><inboundDataType>HL7V2</inboundDataType><outboundDataType>HL7V2</outboundDataType></transformer>
        </connector>
      </destinationConnectors>
    </channel>`;

    const result = MirthImportService.convertXml(xml);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.channels[0]?.sourceConnectorType).toBe('JAVASCRIPT');
    expect(result.value.channels[0]?.destinations[0]?.connectorType).toBe('JAVASCRIPT');
  });

  it('extracts all four script types', () => {
    const xml = loadFixture('mirth-channel-complex.xml');
    const result = MirthImportService.convertXml(xml);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const scripts = result.value.channels[0]?.scripts ?? [];
    const types = scripts.map((s) => s.scriptType);
    expect(types).toContain('DEPLOY');
    expect(types).toContain('UNDEPLOY');
    expect(types).toContain('PREPROCESSOR');
    expect(types).toContain('POSTPROCESSOR');
  });

  it('extracts metadata columns', () => {
    const xml = loadFixture('mirth-channel-complex.xml');
    const result = MirthImportService.convertXml(xml);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const columns = result.value.channels[0]?.metadataColumns ?? [];
    expect(columns).toHaveLength(1);
    expect(columns[0]?.name).toBe('PatientId');
    expect(columns[0]?.dataType).toBe('STRING');
    expect(columns[0]?.mappingExpression).toBe('PID.3.1');
  });

  it('maps disabled destination correctly', () => {
    const xml = loadFixture('mirth-channel-complex.xml');
    const result = MirthImportService.convertXml(xml);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const smtpDest = result.value.channels[0]?.destinations[2];
    expect(smtpDest?.enabled).toBe(false);
  });

  it('extracts queue connector properties', () => {
    const xml = loadFixture('mirth-channel-complex.xml');
    const result = MirthImportService.convertXml(xml);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const dbDest = result.value.channels[0]?.destinations[1];
    expect(dbDest?.queueMode).toBe('ALWAYS');
    expect(dbDest?.retryCount).toBe(3);
    expect(dbDest?.retryIntervalMs).toBe(5000);
    expect(dbDest?.rotateQueue).toBe(true);
    expect(dbDest?.queueThreadCount).toBe(2);
  });

  it('maps channel properties correctly', () => {
    const xml = loadFixture('mirth-channel-complex.xml');
    const result = MirthImportService.convertXml(xml);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const channel = result.value.channels[0];
    expect(channel?.messageStorageMode).toBe('PRODUCTION');
    expect(channel?.removeContentOnCompletion).toBe(true);
    expect(channel?.removeAttachmentsOnCompletion).toBe(true);
  });

  it('generates UUID when channel ID is missing', () => {
    const xml = `<channel>
      <name>No ID Channel</name>
      <enabled>true</enabled>
      <sourceConnector>
        <properties class="com.mirth.connect.connectors.js.JavaScriptReceiverProperties"></properties>
        <transformer><inboundDataType>HL7V2</inboundDataType><outboundDataType>HL7V2</outboundDataType></transformer>
      </sourceConnector>
      <destinationConnectors></destinationConnectors>
    </channel>`;

    const result = MirthImportService.convertXml(xml);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.channels[0]?.id).toBeDefined();
    expect(result.value.channels[0]?.id.length).toBeGreaterThan(0);
  });
});

// ----- importFromXml -----

describe('MirthImportService.convertXml with a Mirth 4.x export', () => {
  function convert4x(edit: (xml: string) => string = (x) => x): ChannelExportEntry {
    const result = MirthImportService.convertXml(edit(loadFixture('mirth-4x-channel.xml')));
    if (!result.ok) throw result.error;
    const channel = result.value.channels[0];
    if (!channel) throw new Error('no channel converted');
    return channel;
  }

  it('decodes XML entities and character references in scripts', () => {
    const channel = convert4x();
    const source = channel.transformers.find((t) => t.connectorId === null);
    expect(source?.steps[0]?.script).toBe('if (1 < 2 && true) { channelMap.put(\'ack\', "MSA|AA"); }\r\nvar done = true;');
    expect(channel.scripts.find((s) => s.scriptType === 'POSTPROCESSOR')?.script).toBe("return $c('ack');");
  });

  it('keeps values as written, not as numbers', () => {
    expect(convert4x().description).toBe('0123');
  });

  it('reads transformer steps from <elements> in sequence order', () => {
    const source = convert4x().transformers.find((t) => t.connectorId === null);
    expect(source?.steps.map((s) => [s.name, s.type])).toEqual([['Build ACK', 'JAVASCRIPT'], ['Second step', 'JAVASCRIPT']]);
  });

  it('reads filter rules from the <filter> next to the transformer', () => {
    const filters = convert4x().filters;
    expect(filters.find((f) => f.connectorId === null)?.rules[0]).toMatchObject({ name: 'Not A08', type: 'JAVASCRIPT' });
    expect(filters.find((f) => f.connectorId === '1')?.rules[0]?.name).toBe('Only ORM');
  });

  it('keys destinations, their filters and transformers by the metaDataId in the export', () => {
    const channel = convert4x();
    expect(channel.destinations.map((d) => d.metaDataId)).toEqual([1, 3]);
    expect(channel.transformers.find((t) => t.connectorId === '1')?.steps[0]?.name).toBe('Stamp');
  });

  it('reads queue settings from destinationConnectorProperties', () => {
    const [tryFirst, always] = convert4x().destinations;
    expect(tryFirst).toMatchObject({ queueMode: 'ON_FAILURE', retryCount: 3, retryIntervalMs: 5000, rotateQueue: true, queueThreadCount: 2 });
    expect(always?.queueMode).toBe('ALWAYS');
    const never = convert4x((x) => x.replace('<queueEnabled>true</queueEnabled>\n          <sendFirst>false</sendFirst>', '<queueEnabled>false</queueEnabled>\n          <sendFirst>false</sendFirst>'));
    expect(never.destinations[1]?.queueMode).toBe('NEVER');
  });

  it('responds from the postprocessor, and the MLLP listener passes that response through', () => {
    const channel = convert4x();
    expect(channel.responseMode).toBe('POSTPROCESSOR');
    expect(channel.sourceConnectorProperties).toMatchObject({ port: 6661, responseMode: 'PASSTHROUGH' });
  });

  it('responds from the destination a "dN" setting names', () => {
    const channel = convert4x((x) => x.replace('<responseVariable>Postprocessor</responseVariable>', '<responseVariable>d3</responseVariable>'));
    expect(channel.responseMode).toBe('DESTINATION');
    expect(channel.responseConnectorName).toBe('Always queue');
  });

  it.each([
    ['None', 'NONE'],
    ['Auto-generate (Before processing)', 'AUTO_BEFORE'],
    ['Auto-generate (After source transformer)', 'AUTO_AFTER_TRANSFORMER'],
    ['Auto-generate (Destinations completed)', 'AUTO_AFTER_DESTINATIONS'],
  ])('maps "Respond from" %s to %s with the listener sending its own ACK', (variable, mode) => {
    const channel = convert4x((x) => x.replace('<responseVariable>Postprocessor</responseVariable>', `<responseVariable>${variable}</responseVariable>`));
    expect(channel.responseMode).toBe(mode);
    expect(channel.sourceConnectorProperties['responseMode']).toBe('AUTO_ACK');
  });

  it('warns and auto-generates when "Respond from" names something it cannot map', () => {
    const result = MirthImportService.convertXml(loadFixture('mirth-4x-channel.xml').replace('<responseVariable>Postprocessor</responseVariable>', '<responseVariable>myResponse</responseVariable>'));
    if (!result.ok) throw result.error;
    expect(result.value.channels[0]?.responseMode).toBe('AUTO_AFTER_DESTINATIONS');
    expect(result.value.warnings.some((w) => w.includes('"myResponse"'))).toBe(true);
  });
});

describe('MirthImportService.importFromXml', () => {
  it('converts and imports channels from XML', async () => {
    const xml = loadFixture('mirth-channel-basic.xml');
    const result = await MirthImportService.importFromXml(xml, 'SKIP', false);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.convertResult.channels).toHaveLength(1);
    expect(result.value.importResult.created).toBe(1);
  });

  it('returns preview without saving on dry run', async () => {
    const xml = loadFixture('mirth-channel-basic.xml');
    const result = await MirthImportService.importFromXml(xml, 'SKIP', true);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.convertResult.channels).toHaveLength(1);
    expect(result.value.importResult.created).toBe(0);
    expect(result.value.importResult.updated).toBe(0);
    expect(result.value.importResult.skipped).toBe(0);
  });

  it('returns error for invalid XML input', async () => {
    const result = await MirthImportService.importFromXml('<foo>bar</foo>', 'SKIP', false);

    expect(result.ok).toBe(false);
  });

  it('maps RENAME collision mode to CREATE_NEW', async () => {
    const xml = loadFixture('mirth-channel-basic.xml');
    const result = await MirthImportService.importFromXml(xml, 'RENAME', false);

    // Should succeed — the internal mapping to CREATE_NEW is transparent
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.importResult.created).toBe(1);
  });
});
