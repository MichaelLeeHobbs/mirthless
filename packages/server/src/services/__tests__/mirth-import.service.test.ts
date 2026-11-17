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

// Placing a new channel in a group is covered against Postgres (create-in-scope.itest.ts).
vi.mock('../grant.service.js', () => ({ GrantService: { placeNewChannel: vi.fn().mockResolvedValue(null), newChannelGroup: vi.fn().mockResolvedValue(null) } }));

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

import type { ChannelExportEntry } from '@galvanigraph/core-models';
import { compileFilterRulesToScript } from '@galvanigraph/engine';
import { MirthImportService, type MirthConvertResult } from '../mirth-import.service.js';
import { validateConnectorProperties } from '../connector-validation.service.js';
import { ChannelImportService } from '../channel-import.service.js';
import { CodeTemplateService } from '../code-template.service.js';

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
    expect(dbDest?.properties).toMatchObject({ host: 'localhost', port: 5432, database: 'hl7db' });
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

  it('imports a send-only connector used as a source as JAVASCRIPT, with a warning (#109)', () => {
    const xml = `<channel>
      <id>test-wrong-direction</id>
      <name>Wrong Direction</name>
      <enabled>true</enabled>
      <sourceConnector>
        <properties class="com.mirth.connect.connectors.smtp.SmtpDispatcherProperties">
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
          <properties class="com.mirth.connect.connectors.smtp.SmtpDispatcherProperties">
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
    expect(result.value.channels[0]?.sourceConnectorType).toBe('JAVASCRIPT');
    expect(result.value.warnings.some((w) => w.includes('SMTP cannot be a source'))).toBe(true);
    expect(result.value.channels[0]?.destinations[0]?.connectorType).toBe('SMTP');
    // The stand-in has no script and none of the SMTP keys, so it refuses to deploy, naming the script.
    const standIn = result.value.channels[0]?.sourceConnectorProperties ?? {};
    expect(standIn).toEqual({});
    expect(validateConnectorProperties('JAVASCRIPT', 'source', standIn)).toMatchObject({ ok: false, error: { message: expect.stringContaining('script') } });
  });

  it('converts filter rules from source connector', () => {
    const xml = loadFixture('mirth-channel-complex.xml');
    const result = MirthImportService.convertXml(xml);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const filters = result.value.channels[0]?.filters ?? [];
    const sourceFilter = filters.find((f) => (f.metaDataId ?? null) === null);
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
    const destFilter = filters.find((f) => f.metaDataId === 2);
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
    const sourceTransformer = transformers.find((t) => (t.metaDataId ?? null) === null);
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
    const destTransformer = transformers.find((t) => t.metaDataId === 2);
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

  it('reads Mirth Delimited settings into delimited options, warning only about fixed widths and Mirth-style row access', () => {
    const ser = (widths: string): string => `<serializationProperties class="com.mirth.connect.plugins.datatypes.delimited.DelimitedSerializationProperties">
      <columnDelimiter>\\t</columnDelimiter><recordDelimiter>\\r\\n</recordDelimiter><columnWidths>${widths}</columnWidths>
      <quoteToken>'</quoteToken><escapeWithDoubleQuote>false</escapeWithDoubleQuote><quoteEscapeToken>\\\\</quoteEscapeToken>
      <columnNames>mrn, family ,given</columnNames><ignoreCR>false</ignoreCR></serializationProperties>`;
    const xml = (widths: string, script = ''): string => `<channel>
      <id>test-delimited</id>
      <name>Census</name>
      <enabled>true</enabled>
      <sourceConnector>
        <properties class="com.mirth.connect.connectors.js.JavaScriptReceiverProperties"></properties>
        <transformer><elements>${script === '' ? '' : `<com.mirth.connect.plugins.javascriptstep.JavaScriptStep><name>Map</name><sequenceNumber>0</sequenceNumber><enabled>true</enabled><script>${script}</script></com.mirth.connect.plugins.javascriptstep.JavaScriptStep>`}</elements><inboundDataType>DELIMITED</inboundDataType><outboundDataType>HL7V2</outboundDataType>
          <inboundProperties class="com.mirth.connect.plugins.datatypes.delimited.DelimitedDataTypeProperties">${ser(widths)}</inboundProperties>
        </transformer>
      </sourceConnector>
      <destinationConnectors></destinationConnectors>
    </channel>`;

    const result = MirthImportService.convertXml(xml(''));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const source = result.value.channels[0]?.transformers.find((t) => (t.metaDataId ?? null) === null);
    expect(source?.inboundProperties['delimited']).toEqual({
      columnDelimiter: '\t', recordDelimiter: '\r\n', quote: "'", quoteEscape: '\\',
      escapeWithDoubleQuote: false, ignoreCR: false, columnNames: ['mrn', 'family', 'given'],
    });
    // Nothing to say about a channel whose scripts do not read rows Mirth's way (#171).
    expect(result.value.warnings).toEqual([]);

    const fixed = MirthImportService.convertXml(xml('5,10'));
    expect(fixed.ok && fixed.value.warnings.join('\n')).toContain('fixed-width columns are not supported');
    expect(fixed.ok && fixed.value.warnings.join('\n')).not.toContain('read msg[0].column');

    const rowAccess = MirthImportService.convertXml(xml('', "var mrn = msg[&apos;row&apos;][&apos;mrn&apos;].toString();"));
    expect(rowAccess.ok && rowAccess.value.warnings.join('\n')).toContain('read msg[0].column');
  });

  it('imports Mirth EDI/X12 as the X12 data type, on the channel and its transformers', () => {
    const xml = `<channel>
      <id>test-x12</id>
      <name>Eligibility</name>
      <enabled>true</enabled>
      <sourceConnector>
        <properties class="com.mirth.connect.connectors.js.JavaScriptReceiverProperties"></properties>
        <transformer><inboundDataType>EDI/X12</inboundDataType><outboundDataType>EDI/X12</outboundDataType></transformer>
      </sourceConnector>
      <destinationConnectors></destinationConnectors>
    </channel>`;

    const result = MirthImportService.convertXml(xml);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const channel = result.value.channels[0]!;
    expect([channel.inboundDataType, channel.outboundDataType]).toEqual(['X12', 'X12']);
    expect(channel.transformers[0]).toMatchObject({ inboundDataType: 'X12', outboundDataType: 'X12' });
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

  it('extracts deploy and undeploy scripts and drops Mirth\'s do-nothing pre- and postprocessor', () => {
    const xml = loadFixture('mirth-channel-complex.xml');
    const result = MirthImportService.convertXml(xml);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const scripts = result.value.channels[0]?.scripts ?? [];
    expect(scripts.map((s) => s.scriptType)).toEqual(['DEPLOY', 'UNDEPLOY']);
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
    const source = channel.transformers.find((t) => (t.metaDataId ?? null) === null);
    expect(source?.steps[0]?.script).toBe('if (1 < 2 && true) { channelMap.put(\'ack\', "MSA|AA"); }\r\nvar done = true;');
    expect(channel.scripts.find((s) => s.scriptType === 'POSTPROCESSOR')?.script).toBe("return $c('ack');");
  });

  it('drops the do-nothing scripts Mirth puts in every channel and keeps real ones', () => {
    expect(convert4x().scripts.map((s) => s.scriptType)).toEqual(['POSTPROCESSOR']);
  });

  it('warns once per channel about the Mirth-only constructs its scripts use', () => {
    const result = MirthImportService.convertXml(loadFixture('mirth-4x-channel.xml'));
    if (!result.ok) throw result.error;
    const warning = result.value.warnings.find((w) => w.includes('Mirth-only constructs'));
    expect(warning).toContain('Channel "4x Listener"');
    expect(warning).toContain("E4X field access (msg['PID']...)");
    // Mirth's E4X indexes count from 0 and GalvaniGraph paths from 1, so a straight port reads the wrong segment.
    // Both sides name the same thing: field 5 of the second OBX (#198).
    expect(warning).toContain("[n] counts from 1, so Mirth's msg['OBX'][1]['OBX.5'] is msg.get('OBX[2].5')");
    expect(warning).toContain('Java map methods (channelMap.put)');
    expect(warning).not.toContain("'message' variable");
  });

  it('does not warn about scripts written for GalvaniGraph', () => {
    const native = (x: string): string => x
      .replace("return msg[&apos;MSH&apos;][&apos;MSH.9&apos;][&apos;MSH.9.2&apos;].toString() != &apos;A08&apos;;", "return msg.get(&apos;MSH.9.2&apos;) != &apos;A08&apos;;")
      .replace(/channelMap\.put\(&apos;(\w+)&apos;, ([^)]*)\)/g, '$c(&apos;$1&apos;, $2)');
    const result = MirthImportService.convertXml(native(loadFixture('mirth-4x-channel.xml')));
    if (!result.ok) throw result.error;
    expect(result.value.warnings.filter((w) => w.includes('Mirth-only constructs'))).toEqual([]);
  });

  it('reads a channel\'s enabled flag from exportData/metadata, where Mirth 4.x writes it', () => {
    const withFlag = (flag: string) => (x: string): string => x.replace('</properties>\n</channel>', `</properties>\n  <exportData><metadata><enabled>${flag}</enabled></metadata></exportData>\n</channel>`);
    expect(convert4x(withFlag('false')).enabled).toBe(false);
    expect(convert4x(withFlag('true')).enabled).toBe(true);
    expect(convert4x().enabled).toBe(true);
  });

  it('keeps values as written, not as numbers', () => {
    expect(convert4x().description).toBe('0123');
  });

  it('reads transformer steps from <elements> in sequence order', () => {
    const source = convert4x().transformers.find((t) => (t.metaDataId ?? null) === null);
    expect(source?.steps.map((s) => [s.name, s.type])).toEqual([['Build ACK', 'JAVASCRIPT'], ['Second step', 'JAVASCRIPT']]);
  });

  it('reads filter rules from the <filter> next to the transformer', () => {
    const filters = convert4x().filters;
    expect(filters.find((f) => (f.metaDataId ?? null) === null)?.rules[0]).toMatchObject({ name: 'Not A08', type: 'JAVASCRIPT' });
    expect(filters.find((f) => f.metaDataId === 1)?.rules[0]?.name).toBe('Only ORM');
  });

  describe('Rule Builder values', () => {
    const ruleBuilder = (values: string) => (x: string): string => x.replace(
      '<operator>NONE</operator>\n            <script>return true;</script>',
      `<operator>NONE</operator>\n            <field>MSH.9.1</field>\n            <condition>EQUALS</condition>\n            ${values}`,
    );
    const destRule = (values: string): unknown => convert4x(ruleBuilder(values)).filters.find((f) => f.metaDataId === 1)?.rules[0]?.values;

    it('imports a single value as a one-item list', () => {
      expect(destRule('<values><string>5</string></values>')).toEqual(['5']);
    });

    it('imports several values in order', () => {
      expect(destRule('<values><string>ORM</string><string>0123</string></values>')).toEqual(['ORM', '0123']);
    });

    it('imports an empty values list as no values', () => {
      expect(destRule('<values/>')).toEqual([]);
    });

    it('imports a rule without a values list as no values', () => {
      expect(destRule('')).toEqual([]);
    });
  });

  it('keys destinations, their filters and transformers by the metaDataId in the export', () => {
    const channel = convert4x();
    expect(channel.destinations.map((d) => d.metaDataId)).toEqual([1, 3]);
    expect(channel.transformers.find((t) => t.metaDataId === 1)?.steps[0]?.name).toBe('Stamp');
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

  it('keeps a TCP connector\'s frame bytes when they are not MLLP\'s', () => {
    expect(convert4x().sourceConnectorProperties['frameStart']).toBeUndefined();
    const basic = convert4x((x) => x
      .replace('<startOfMessageBytes>0B</startOfMessageBytes>', '<startOfMessageBytes>02</startOfMessageBytes>')
      .replace('<endOfMessageBytes>1C0D</endOfMessageBytes>', '<endOfMessageBytes>03</endOfMessageBytes>'));
    expect(basic.sourceConnectorProperties).toMatchObject({ frameStart: '02', frameEnd: '03' });
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

  it('maps a Channel Reader source and a Channel Writer to the target channel id', () => {
    const writer = '<properties class="com.mirth.connect.connectors.vm.VmDispatcherProperties" version="4.5.0"><pluginProperties/><channelId>5c000200-0000-4000-8000-000000000001</channelId><channelTemplate>${message.encodedData}</channelTemplate><mapVariables/></properties>';
    const channel = convert4x((x) => x
      .replace(/<properties class="com\.mirth\.connect\.connectors\.tcp\.TcpReceiverProperties"[\s\S]*?<\/properties>\s*<transformer/, '<properties class="com.mirth.connect.connectors.vm.VmReceiverProperties" version="4.5.0"><pluginProperties/></properties><transformer')
      .replace(/<properties class="com\.mirth\.connect\.connectors\.js\.JavaScriptDispatcherProperties"[\s\S]*?<\/properties>/, writer));
    expect(channel.sourceConnectorType).toBe('CHANNEL');
    expect(channel.destinations[0]).toMatchObject({ connectorType: 'CHANNEL', properties: { targetChannelId: '5c000200-0000-4000-8000-000000000001' } });
    expect(validateConnectorProperties('CHANNEL', 'destination', channel.destinations[0]?.properties ?? {})).toMatchObject({ ok: true });
    // Deploy sets the reader's channelId before validating.
    expect(validateConnectorProperties('CHANNEL', 'source', { ...channel.sourceConnectorProperties, channelId: channel.id })).toMatchObject({ ok: true });
  });

  it('maps an HTTP Listener to serve every path under its context path with its response settings', () => {
    const listener = (contextPath: string, status: string): string => `<properties class="com.mirth.connect.connectors.http.HttpReceiverProperties" version="4.5.0"><listenerConnectorProperties version="4.5.0"><host>0.0.0.0</host><port>8081</port></listenerConnectorProperties><responseContentType>application/json</responseContentType><responseStatusCode>${status}</responseStatusCode><contextPath>${contextPath}</contextPath></properties><transformer`;
    const swap = (contextPath: string, status: string) => (x: string): string =>
      x.replace(/<properties class="com\.mirth\.connect\.connectors\.tcp\.TcpReceiverProperties"[\s\S]*?<\/properties>\s*<transformer/, listener(contextPath, status));

    expect(convert4x(swap('', '')).sourceConnectorProperties).toEqual({
      host: '0.0.0.0', port: 8081, path: '/', matchSubpaths: true, responseContentType: 'application/json',
    });
    expect(convert4x(swap('api', '202')).sourceConnectorProperties).toMatchObject({ path: '/api', responseStatusCode: 202 });
    // Every key the importer writes is one the HTTP schema accepts, so the channel deploys.
    const batch = convert4x((x) => swap('api', '202')(x).replace('<contextPath>', '<sourceConnectorProperties version="4.5.0"><processBatch>true</processBatch></sourceConnectorProperties><contextPath>'));
    expect(batch.sourceConnectorProperties['processBatch']).toBe(true);
    expect(validateConnectorProperties('HTTP', 'source', batch.sourceConnectorProperties)).toMatchObject({ ok: true });
  });

  it('keeps an HTTP Listener\'s ${...} port for the deploy to resolve', () => {
    const listener = '<properties class="com.mirth.connect.connectors.http.HttpReceiverProperties" version="4.5.0"><listenerConnectorProperties version="4.5.0"><host>0.0.0.0</host><port>${HTTP_PORT}</port></listenerConnectorProperties><contextPath>/</contextPath></properties><transformer';
    const channel = convert4x((x) => x.replace(/<properties class="com\.mirth\.connect\.connectors\.tcp\.TcpReceiverProperties"[\s\S]*?<\/properties>\s*<transformer/, listener));
    expect(channel.sourceConnectorProperties['port']).toBe('${HTTP_PORT}');
  });

  it('carries a TCP Sender\'s template and keeps a ${...} port for the deploy to resolve', () => {
    const sender = (port: string, template: string): string => `<properties class="com.mirth.connect.connectors.tcp.TcpDispatcherProperties" version="4.5.0"><remoteAddress>\${MIRTH_SENDER_HOST}</remoteAddress><remotePort>${port}</remotePort><template>${template}</template></properties>`;
    const swap = (port: string, template: string) => (x: string): string =>
      x.replace(/<properties class="com\.mirth\.connect\.connectors\.js\.JavaScriptDispatcherProperties"[\s\S]*?<\/properties>/, sender(port, template));

    expect(convert4x(swap('${MIRTH_SENDER_PORT}', '${oru}')).destinations[0]?.properties)
      .toEqual({ host: '${MIRTH_SENDER_HOST}', port: '${MIRTH_SENDER_PORT}', template: '${oru}' });
    expect(convert4x(swap('6661', '${message.encodedData}')).destinations[0]?.properties)
      .toEqual({ host: '${MIRTH_SENDER_HOST}', port: 6661 });
  });

  it('maps a Database Writer and Reader JDBC URL, credentials, queries and update mode', () => {
    const writer = '<properties class="com.mirth.connect.connectors.jdbc.DatabaseDispatcherProperties" version="4.5.0"><driver>org.postgresql.Driver</driver><url>jdbc:postgresql://db.example.org:5433/partner?ssl=true</url><username>mirth</username><password>0123</password><query>INSERT INTO t (a) VALUES (${mrn})</query><useScript>false</useScript></properties>';
    const reader = '<properties class="com.mirth.connect.connectors.jdbc.DatabaseReceiverProperties" version="4.5.0"><pluginProperties/><pollConnectorProperties version="4.5.0"><pollingType>INTERVAL</pollingType><pollOnStart>false</pollOnStart><pollingFrequency>2000</pollingFrequency></pollConnectorProperties><sourceConnectorProperties version="4.5.0"><responseVariable>None</responseVariable><processBatch>true</processBatch></sourceConnectorProperties><driver>org.postgresql.Driver</driver><url>jdbc:postgresql://db.example.org/orders</url><username>mirth</username><password>pw</password><select>SELECT id FROM o</select><update>UPDATE o SET s = 1 WHERE id = ${id}</update><useScript>false</useScript><aggregateResults>false</aggregateResults><cacheResults>true</cacheResults><keepConnectionOpen>true</keepConnectionOpen><updateMode>3</updateMode><retryCount>3</retryCount><retryInterval>10000</retryInterval><fetchSize>1000</fetchSize><encoding>DEFAULT_ENCODING</encoding></properties><transformer';
    const channel = convert4x((x) => x
      .replace(/<properties class="com\.mirth\.connect\.connectors\.js\.JavaScriptDispatcherProperties"[\s\S]*?<\/properties>/, writer)
      .replace(/<properties class="com\.mirth\.connect\.connectors\.tcp\.TcpReceiverProperties"[\s\S]*?<\/properties>\s*<transformer/, reader));

    expect(channel.destinations[0]?.properties).toEqual({
      vendor: 'postgresql', host: 'db.example.org', port: 5433, database: 'partner', username: 'mirth', password: '0123', query: 'INSERT INTO t (a) VALUES (${mrn})',
    });
    expect(channel.sourceConnectorProperties).toEqual({
      vendor: 'postgresql', host: 'db.example.org', database: 'orders', username: 'mirth', password: 'pw',
      selectQuery: 'SELECT id FROM o', updateQuery: 'UPDATE o SET s = 1 WHERE id = ${id}', updateMode: 'ON_SUCCESS',
      pollingIntervalMs: 2000, processBatch: true,
    });
    // Every key the importer writes is one the DATABASE schemas accept, so the channel deploys as imported.
    expect(validateConnectorProperties('DATABASE', 'destination', channel.destinations[0]?.properties ?? {})).toMatchObject({ ok: true });
    expect(validateConnectorProperties('DATABASE', 'source', channel.sourceConnectorProperties)).toMatchObject({ ok: true });
    // The reader's rows are JSON objects here, so the channel and its source transformer read JSON.
    expect(channel.inboundDataType).toBe('JSON');
    expect(channel.transformers.find((t) => (t.metaDataId ?? null) === null)?.inboundDataType).toBe('JSON');
  });

  it.each([
    ['jdbc:mysql://partner.example.org:3307/results', 'mysql', { host: 'partner.example.org', port: 3307, database: 'results' }],
    ['jdbc:mariadb://partner.example.org/results', 'mysql', { host: 'partner.example.org', database: 'results' }],
    ['jdbc:sqlserver://partner.example.org:1433;databaseName=results', 'sqlserver', { host: 'partner.example.org', port: 1433, database: 'results' }],
    ['jdbc:sqlserver://partner.example.org;encrypt=true;database=results', 'sqlserver', { host: 'partner.example.org', database: 'results' }],
    ['jdbc:sqlserver://partner.example.org\\LAB:1433', 'sqlserver', { host: 'partner.example.org\\LAB', port: 1433 }],
    // Configuration map references stay as written for the deploy to resolve (#227).
    ['jdbc:postgresql://${DB_HOST}:${DB_PORT}/lab', 'postgresql', { host: '${DB_HOST}', port: '${DB_PORT}', database: 'lab' }],
    ['jdbc:postgresql://dbhost:${DB_PORT}/orders', 'postgresql', { host: 'dbhost', port: '${DB_PORT}', database: 'orders' }],
    ['jdbc:mysql://${DB_HOST}/${DB_NAME}', 'mysql', { host: '${DB_HOST}', database: '${DB_NAME}' }],
    ['jdbc:sqlserver://${DB_HOST}:${DB_PORT};databaseName=results', 'sqlserver', { host: '${DB_HOST}', port: '${DB_PORT}', database: 'results' }],
  ])('takes the database vendor from the JDBC URL %s', (url, vendor, location) => {
    const writer = `<properties class="com.mirth.connect.connectors.jdbc.DatabaseDispatcherProperties" version="4.5.0"><url>${url}</url><query>INSERT INTO t (a) VALUES (\${mrn})</query></properties>`;
    const channel = convert4x((x) => x
      .replace(/<properties class="com\.mirth\.connect\.connectors\.js\.JavaScriptDispatcherProperties"[\s\S]*?<\/properties>/, () => writer));

    expect(channel.destinations[0]?.properties).toEqual({ vendor, ...location, query: 'INSERT INTO t (a) VALUES (${mrn})' });
  });

  describe('preview warnings for database connectors that will not run', () => {
    const writer = (url: string, useScript = 'false'): string => `<properties class="com.mirth.connect.connectors.jdbc.DatabaseDispatcherProperties" version="4.5.0"><url>${url}</url><query>INSERT INTO t (a) VALUES (1)</query><useScript>${useScript}</useScript></properties>`;
    const reader = (url: string, useScript = 'false'): string => `<properties class="com.mirth.connect.connectors.jdbc.DatabaseReceiverProperties" version="4.5.0"><url>${url}</url><select>SELECT id FROM o</select><useScript>${useScript}</useScript></properties><transformer`;
    const convert = (edit: (xml: string) => string): readonly string[] => {
      const result = MirthImportService.convertXml(edit(loadFixture('mirth-4x-channel.xml')));
      if (!result.ok) throw result.error;
      return result.value.warnings;
    };
    const withWriter = (xml: string) => (x: string): string =>
      x.replace(/<properties class="com\.mirth\.connect\.connectors\.js\.JavaScriptDispatcherProperties"[\s\S]*?<\/properties>/, () => xml);
    const withReader = (xml: string) => (x: string): string =>
      x.replace(/<properties class="com\.mirth\.connect\.connectors\.tcp\.TcpReceiverProperties"[\s\S]*?<\/properties>\s*<transformer/, () => xml);
    const databaseWarnings = (warnings: readonly string[]): readonly string[] => warnings.filter((w) => /Database (Reader|Writer)/.test(w) && !w.includes('rows arrive as JSON'));

    it.each([
      ['jdbc:sqlserver://db:1433;databaseName=lab', 'sqlserver'],
      ['jdbc:oracle:thin:@db:1521:LAB', 'oracle'],
    ])('warns that a Database Writer on %s will not deploy', (url, vendor) => {
      const warnings = databaseWarnings(convert(withWriter(writer(url))));
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toContain('Channel "4x Listener"');
      expect(warnings[0]).toContain('Database Writer');
      expect(warnings[0]).toContain(vendor);
      expect(warnings[0]).toContain('will not deploy');
    });

    it('warns that a Database Reader on SQL Server will not deploy', () => {
      const warnings = databaseWarnings(convert(withReader(reader('jdbc:sqlserver://db:1433;databaseName=lab'))));
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toContain('Database Reader');
      expect(warnings[0]).toContain('sqlserver');
    });

    it('does not warn for PostgreSQL, MySQL or MariaDB', () => {
      expect(databaseWarnings(convert(withWriter(writer('jdbc:postgresql://db/lab'))))).toEqual([]);
      expect(databaseWarnings(convert(withWriter(writer('jdbc:mysql://db/lab'))))).toEqual([]);
      expect(databaseWarnings(convert(withReader(reader('jdbc:mariadb://db/lab'))))).toEqual([]);
    });

    it('warns that a Database Writer or Reader in JavaScript mode will not run its script', () => {
      const writerWarnings = databaseWarnings(convert(withWriter(writer('jdbc:postgresql://db/lab', 'true'))));
      expect(writerWarnings).toHaveLength(1);
      expect(writerWarnings[0]).toContain('Database Writer');
      expect(writerWarnings[0]).toContain('JavaScript mode');
      const readerWarnings = databaseWarnings(convert(withReader(reader('jdbc:postgresql://db/lab', 'true'))));
      expect(readerWarnings).toHaveLength(1);
      expect(readerWarnings[0]).toContain('Database Reader');
      expect(readerWarnings[0]).toContain('JavaScript mode');
    });

    it('gives both warnings for a SQL Server connector in JavaScript mode', () => {
      expect(databaseWarnings(convert(withWriter(writer('jdbc:sqlserver://db:1433;databaseName=lab', 'true'))))).toHaveLength(2);
    });

    const writerProps = (url: string): Record<string, unknown> => {
      const result = MirthImportService.convertXml(withWriter(writer(url))(loadFixture('mirth-4x-channel.xml')));
      if (!result.ok) throw result.error;
      return result.value.channels[0]?.destinations[0]?.properties ?? {};
    };

    it('warns that a ${...} reference URL must be filled in by hand, and guesses no location', () => {
      const warnings = databaseWarnings(convert(withWriter(writer('${LAB_DB_URL}'))));
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toContain('Database Writer');
      expect(warnings[0]).toContain('${LAB_DB_URL}');
      expect(warnings[0]).toContain('by hand');
      const readerWarnings = databaseWarnings(convert(withReader(reader('${LAB_DB_URL}'))));
      expect(readerWarnings).toHaveLength(1);
      expect(readerWarnings[0]).toContain('Database Reader');
      expect(writerProps('${LAB_DB_URL}')).not.toHaveProperty('host');
    });

    it.each([
      ['jdbc:mysql://h1,h2/lab'],
      ['jdbc:postgresql://h1:5432,h2:5432/lab'],
    ])('warns that the multi-host URL %s must be filled in by hand, and guesses no host', (url) => {
      const warnings = databaseWarnings(convert(withWriter(writer(url))));
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toContain('several hosts');
      const props = writerProps(url);
      expect(props).not.toHaveProperty('host');
      expect(props).not.toHaveProperty('port');
      expect(props).not.toHaveProperty('database');
    });

    it.each([
      ['jdbc:mysql:loadbalance://h1,h2/lab', 'loadbalance'],
      ['jdbc:mysql:replication://h1:3306,h2:3306/lab', 'replication'],
    ])('warns that the MySQL %s URL must be filled in by hand, and guesses no host', (url, mode) => {
      const warnings = databaseWarnings(convert(withWriter(writer(url))));
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toContain(mode);
      expect(writerProps(url)).not.toHaveProperty('host');
    });

    it('warns when a ${...} reference stands for the whole location, which the import cannot split (#227)', () => {
      const warnings = databaseWarnings(convert(withWriter(writer('jdbc:postgresql://${DB_LOCATION}'))));
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toContain('${DB_LOCATION}');
      expect(databaseWarnings(convert(withWriter(writer('jdbc:postgresql://${DB_HOST}:${DB_PORT}/lab'))))).toEqual([]);
    });

    it('does not put the URL itself in a multi-host warning, which can carry credentials', () => {
      const warnings = databaseWarnings(convert(withWriter(writer('jdbc:mysql://h1,h2/lab?password=s3cret'))));
      expect(warnings.join(' ')).not.toContain('s3cret');
    });
  });

  it('keeps a polling source\'s interval and gives a JavaScript Reader only its script', () => {
    const reader = (type: string): string => `<properties class="com.mirth.connect.connectors.js.JavaScriptReceiverProperties" version="4.5.0"><pluginProperties/><pollConnectorProperties version="4.5.0"><pollingType>${type}</pollingType><pollOnStart>true</pollOnStart><pollingFrequency>500</pollingFrequency></pollConnectorProperties><sourceConnectorProperties version="4.5.0"><responseVariable>None</responseVariable></sourceConnectorProperties><script>return 'tick';</script></properties><transformer`;
    const swap = (type: string) => (x: string): string => x
      .replace(/<properties class="com\.mirth\.connect\.connectors\.tcp\.TcpReceiverProperties"[\s\S]*?<\/properties>\s*<transformer/, reader(type))
      .replace('<transportName>TCP Listener</transportName>', '<transportName>JavaScript Reader</transportName>');

    expect(convert4x(swap('INTERVAL')).sourceConnectorProperties).toEqual({ script: "return 'tick';", pollingIntervalMs: 500 });
    const batch = convert4x((x) => swap('INTERVAL')(x).replace('<responseVariable>None</responseVariable>', '<responseVariable>None</responseVariable><processBatch>true</processBatch>'));
    expect(batch.sourceConnectorProperties['processBatch']).toBe(true);
    expect(convert4x(swap('TIME')).sourceConnectorProperties).toEqual({ script: "return 'tick';" });
    expect(validateConnectorProperties('JAVASCRIPT', 'source', convert4x(swap('INTERVAL')).sourceConnectorProperties)).toMatchObject({ ok: true });
    expect(validateConnectorProperties('JAVASCRIPT', 'source', batch.sourceConnectorProperties)).toMatchObject({ ok: true });
  });

  it('gives a JavaScript Writer only its script, which the JAVASCRIPT schema accepts', () => {
    const writers = convert4x().destinations.filter((d) => d.connectorType === 'JAVASCRIPT');
    expect(writers.map((d) => d.properties)).toEqual([{ script: "logger.info('sent');" }, { script: 'return;' }]);
    for (const writer of writers) {
      expect(validateConnectorProperties('JAVASCRIPT', 'destination', writer.properties)).toMatchObject({ ok: true });
    }
  });

  it('maps an HTTP Sender\'s method, headers, parameters, Basic credentials and content, and an SMTP Sender\'s mail', () => {
    const http = '<properties class="com.mirth.connect.connectors.http.HttpDispatcherProperties" version="4.5.0"><host>http://api/orders/${accession}</host><method>put</method><headers class="linked-hash-map"><entry><string>X-Source</string><list><string>HUB</string><string>LAB</string></list></entry></headers><parameters class="linked-hash-map"><entry><string>site</string><list><string>${site}</string></list></entry></parameters><useAuthentication>true</useAuthentication><authenticationType>Basic</authenticationType><username>mirth</username><password>s3cret</password><content>{"a":"${accession}"}</content><contentType>application/json</contentType></properties>';
    const smtp = '<properties class="com.mirth.connect.connectors.smtp.SmtpDispatcherProperties" version="4.5.0"><smtpHost>mail</smtpHost><smtpPort>25</smtpPort><encryption>tls</encryption><authentication>true</authentication><username>u</username><password>p</password><to>${email}</to><from>reports@example.com</from><cc></cc><subject>${subject}</subject><html>true</html><body>Ready</body></properties>';
    const channel = convert4x((x) => x
      .replace(/<properties class="com\.mirth\.connect\.connectors\.js\.JavaScriptDispatcherProperties"[\s\S]*?<\/properties>/, http)
      .replace(/<properties class="com\.mirth\.connect\.connectors\.js\.JavaScriptDispatcherProperties"[\s\S]*?<\/properties>/, smtp));

    expect(channel.destinations[0]?.properties).toEqual({
      url: 'http://api/orders/${accession}', method: 'PUT', headers: { 'X-Source': 'HUB, LAB' }, parameters: { site: '${site}' },
      contentType: 'application/json', basicAuth: { username: 'mirth', password: 's3cret' }, template: '{"a":"${accession}"}',
    });
    expect(validateConnectorProperties('HTTP', 'destination', channel.destinations[0]?.properties ?? {})).toMatchObject({ ok: true });
    expect(channel.destinations[1]?.properties).toEqual({
      host: 'mail', port: 25, to: '${email}', from: 'reports@example.com', subject: '${subject}', bodyTemplate: 'Ready',
      contentType: 'text/html', requireTLS: true, authUser: 'u', authPass: 'p',
    });
    expect(validateConnectorProperties('SMTP', 'destination', channel.destinations[1]?.properties ?? {})).toMatchObject({ ok: true });
  });

  it('maps a local File Reader and Writer to keys the FILE schemas accept', () => {
    const reader = '<properties class="com.mirth.connect.connectors.file.FileReceiverProperties" version="4.5.0"><pluginProperties/><pollConnectorProperties version="4.5.0"><pollingType>INTERVAL</pollingType><pollOnStart>false</pollOnStart><pollingFrequency>2000</pollingFrequency></pollConnectorProperties><sourceConnectorProperties version="4.5.0"><responseVariable>None</responseVariable><processBatch>true</processBatch></sourceConnectorProperties><scheme>FILE</scheme><host>/data/in</host><fileFilter>*.hl7</fileFilter><regex>false</regex><directoryRecursion>false</directoryRecursion><ignoreDot>true</ignoreDot><anonymous>true</anonymous><afterProcessingAction>MOVE</afterProcessingAction><moveToDirectory>/data/done</moveToDirectory><checkFileAge>true</checkFileAge><fileAge>1000</fileAge><sortBy>date</sortBy><binary>false</binary><charsetEncoding>DEFAULT_ENCODING</charsetEncoding></properties><transformer';
    const writer = '<properties class="com.mirth.connect.connectors.file.FileDispatcherProperties" version="4.5.0"><scheme>FILE</scheme><host>/data/out</host><outputPattern>${message.messageId}.hl7</outputPattern><anonymous>true</anonymous><outputAppend>false</outputAppend><errorOnExists>false</errorOnExists><temporary>false</temporary><binary>false</binary><charsetEncoding>DEFAULT_ENCODING</charsetEncoding><template>${message.encodedData}</template></properties>';
    const channel = convert4x((x) => x
      .replace(/<properties class="com\.mirth\.connect\.connectors\.js\.JavaScriptDispatcherProperties"[\s\S]*?<\/properties>/, writer)
      .replace(/<properties class="com\.mirth\.connect\.connectors\.tcp\.TcpReceiverProperties"[\s\S]*?<\/properties>\s*<transformer/, reader));

    expect(channel.sourceConnectorType).toBe('FILE');
    expect(channel.sourceConnectorProperties).toEqual({
      directory: '/data/in', fileFilter: '*.hl7', postAction: 'MOVE', moveToDirectory: '/data/done',
      sortBy: 'DATE', checkFileAge: true, fileAgeMs: 1000, binary: false, pollingIntervalMs: 2000, processBatch: true,
    });
    expect(channel.destinations[0]).toMatchObject({
      connectorType: 'FILE',
      properties: { directory: '/data/out', outputPattern: '${messageId}.hl7', appendMode: false, binary: false },
    });
    // Every key the importer writes is one the FILE schemas accept, so the channel deploys as imported.
    expect(validateConnectorProperties('FILE', 'source', channel.sourceConnectorProperties)).toMatchObject({ ok: true });
    expect(validateConnectorProperties('FILE', 'destination', channel.destinations[0]?.properties ?? {})).toMatchObject({ ok: true });
  });

  describe('a local File Reader\'s after-processing action and a File Writer\'s file name (#178)', () => {
    const reader = (inner: string): string => `<properties class="com.mirth.connect.connectors.file.FileReceiverProperties" version="4.5.0"><scheme>FILE</scheme><host>/data/in</host><fileFilter>*.hl7</fileFilter>${inner}</properties><transformer`;
    const writer = (inner: string): string => `<properties class="com.mirth.connect.connectors.file.FileDispatcherProperties" version="4.5.0"><scheme>FILE</scheme><host>/data/out</host>${inner}</properties>`;
    const convert = (readerInner: string, writerInner = ''): MirthConvertResult => {
      const result = MirthImportService.convertXml(loadFixture('mirth-4x-channel.xml')
        .replace(/<properties class="com\.mirth\.connect\.connectors\.tcp\.TcpReceiverProperties"[\s\S]*?<\/properties>\s*<transformer/, reader(readerInner))
        .replace(/<properties class="com\.mirth\.connect\.connectors\.js\.JavaScriptDispatcherProperties"[\s\S]*?<\/properties>/, writer(writerInner)));
      if (!result.ok) throw result.error;
      return result.value;
    };
    const source = (readerInner: string): Record<string, unknown> => convert(readerInner).channels[0]?.sourceConnectorProperties ?? {};
    const dest = (writerInner: string): Record<string, unknown> => convert('', writerInner).channels[0]?.destinations[0]?.properties ?? {};

    it.each([
      ['NONE', 'NONE'],
      ['DELETE', 'DELETE'],
      ['MOVE', 'MOVE'],
    ])('maps afterProcessingAction %s to postAction %s', (action, postAction) => {
      expect(source(`<afterProcessingAction>${action}</afterProcessingAction><moveToDirectory>/data/done</moveToDirectory>`)['postAction']).toBe(postAction);
    });

    it('leaves files in place when the export names no action, as Mirth does, instead of the FILE default DELETE', () => {
      expect(source('')['postAction']).toBe('NONE');
      expect(validateConnectorProperties('FILE', 'source', source(''))).toMatchObject({ ok: true });
    });

    it('carries the File Writer\'s append setting, Mirth\'s default (append) when absent', () => {
      expect(dest('<outputPattern>out.hl7</outputPattern><outputAppend>true</outputAppend>')).toMatchObject({ outputPattern: 'out.hl7', appendMode: true });
      expect(dest('<outputPattern>out.hl7</outputPattern>')['appendMode']).toBe(true);
    });

    it('turns Mirth\'s message id and system time placeholders into the ones the File Writer fills', () => {
      expect(dest('<outputPattern>${message.messageId}_${SYSTIME}.hl7</outputPattern><outputAppend>false</outputAppend>')['outputPattern']).toBe('${messageId}_${timestamp}.hl7');
    });

    it('keeps the FILE default name when Mirth\'s output pattern is blank', () => {
      expect(dest('<outputPattern></outputPattern>')['outputPattern']).toBeUndefined();
    });

    it('carries the File Writer\'s template as the destination template', () => {
      expect(dest('<outputPattern>a.txt</outputPattern><template>${accession}</template>')['template']).toBe('${accession}');
      expect(dest('<outputPattern>a.txt</outputPattern><template>${message.encodedData}</template>')['template']).toBeUndefined();
    });

    it('warns, naming the channel and destination, when the output pattern uses a value the File Writer cannot fill', () => {
      const result = convert('', '<outputPattern>${originalFilename}.hl7</outputPattern>');
      expect(result.channels[0]?.destinations[0]?.properties['outputPattern']).toBe('${originalFilename}.hl7');
      const warning = result.warnings.find((w) => w.includes('${originalFilename}'));
      expect(warning).toContain('Channel "4x Listener"');
      expect(warning).toContain('"Try then queue"');
    });

    it('warns when the Reader\'s file filter is a regular expression, which the FILE source reads as a glob', () => {
      expect(convert('<regex>true</regex>').warnings.some((w) => w.includes('regular expression'))).toBe(true);
      expect(convert('<regex>false</regex>').warnings.some((w) => w.includes('regular expression'))).toBe(false);
    });

    it('warns when Mirth renames the files it moves, which the FILE source does not', () => {
      const result = convert('<afterProcessingAction>MOVE</afterProcessingAction><moveToDirectory>/d</moveToDirectory><moveToFileName>${originalFilename}.done</moveToFileName>');
      expect(result.warnings.some((w) => w.includes('${originalFilename}.done'))).toBe(true);
    });

    it('reads an action it does not know as NONE, leaving the file in place', () => {
      expect(source('<afterProcessingAction>AFTER_PROCESSING</afterProcessingAction>')['postAction']).toBe('NONE');
      expect(source('<afterProcessingAction>Shred</afterProcessingAction>')['postAction']).toBe('NONE');
    });

    it('keeps the file in place, as Mirth does, for a Move with no move-to folder and no new name', () => {
      const blank = convert('<afterProcessingAction>MOVE</afterProcessingAction><moveToDirectory></moveToDirectory><moveToFileName></moveToFileName>');
      expect(blank.channels[0]?.sourceConnectorProperties['postAction']).toBe('NONE');
      expect(validateConnectorProperties('FILE', 'source', blank.channels[0]?.sourceConnectorProperties ?? {})).toMatchObject({ ok: true });
    });

    it('keeps a rename in place as a Move the deploy refuses until a folder is set, since leaving the file would read it again every poll', () => {
      const rename = convert('<afterProcessingAction>MOVE</afterProcessingAction><moveToDirectory></moveToDirectory><moveToFileName>${originalFilename}.done</moveToFileName>');
      expect(rename.channels[0]?.sourceConnectorProperties['postAction']).toBe('MOVE');
      expect(validateConnectorProperties('FILE', 'source', rename.channels[0]?.sourceConnectorProperties ?? {})).toMatchObject({ ok: false, error: { message: expect.stringContaining('moveToDirectory') } });
      const warning = rename.warnings.find((w) => w.includes('${originalFilename}.done'));
      expect(warning).toContain('will not deploy');
      expect(convert('<afterProcessingAction>DELETE</afterProcessingAction><moveToFileName>left.over</moveToFileName>').warnings.some((w) => w.includes('left.over'))).toBe(false);
    });

    it('says a Reader or Writer on Mirth\'s default charset read the server\'s default, and GalvaniGraph reads UTF-8', () => {
      const result = convert('<charsetEncoding>DEFAULT_ENCODING</charsetEncoding>', '<outputPattern>a.txt</outputPattern><charsetEncoding>DEFAULT_ENCODING</charsetEncoding>');
      expect(result.warnings.filter((w) => w.includes('windows-1252'))).toHaveLength(2);
      expect(convert('<charsetEncoding>DEFAULT_ENCODING</charsetEncoding><binary>true</binary>').warnings.some((w) => w.includes('windows-1252'))).toBe(false);
      expect(convert('<charsetEncoding>UTF-8</charsetEncoding>').warnings.some((w) => w.includes('windows-1252'))).toBe(false);
    });

    it('reads an empty scheme as the file scheme', () => {
      const result = MirthImportService.convertXml(loadFixture('mirth-4x-channel.xml').replace(
        /<properties class="com\.mirth\.connect\.connectors\.tcp\.TcpReceiverProperties"[\s\S]*?<\/properties>\s*<transformer/,
        '<properties class="com.mirth.connect.connectors.file.FileReceiverProperties" version="4.5.0"><scheme></scheme><host>/data/in</host></properties><transformer',
      ));
      if (!result.ok) throw result.error;
      expect(result.value.channels[0]?.sourceConnectorProperties['directory']).toBe('/data/in');
    });

    it('says a file name value that cannot be filled stops the deploy unless it names a configuration map entry', () => {
      const warning = convert('', '<outputPattern>${site}.hl7</outputPattern>').warnings.find((w) => w.includes('${site}'));
      expect(warning).toContain('unless it names a configuration map entry');
    });

    it.each([
      ['UTF-8', 'utf-8'],
      ['ISO-8859-1', 'latin1'],
      ['US-ASCII', 'ascii'],
      ['UTF-16LE', 'utf16le'],
    ])('carries the charset %s as %s on the Reader and Writer', (java, charset) => {
      const result = convert(`<charsetEncoding>${java}</charsetEncoding>`, `<outputPattern>a.txt</outputPattern><charsetEncoding>${java}</charsetEncoding>`);
      expect(result.channels[0]?.sourceConnectorProperties['charset']).toBe(charset);
      expect(result.channels[0]?.destinations[0]?.properties['charset']).toBe(charset);
      expect(validateConnectorProperties('FILE', 'source', result.channels[0]?.sourceConnectorProperties ?? {})).toMatchObject({ ok: true });
    });

    it('leaves Mirth\'s DEFAULT_ENCODING to the FILE default, and keeps a charset it cannot map so the deploy refuses it, with a warning', () => {
      expect(source('<charsetEncoding>DEFAULT_ENCODING</charsetEncoding>')['charset']).toBeUndefined();
      const odd = convert('<charsetEncoding>windows-1252</charsetEncoding>');
      expect(odd.channels[0]?.sourceConnectorProperties['charset']).toBe('windows-1252');
      expect(validateConnectorProperties('FILE', 'source', odd.channels[0]?.sourceConnectorProperties ?? {})).toMatchObject({ ok: false });
      expect(odd.warnings.some((w) => w.includes('windows-1252'))).toBe(true);
    });

    it('carries the Writer\'s temporary-file setting, off as in Mirth when absent', () => {
      expect(dest('<outputPattern>a.txt</outputPattern><temporary>true</temporary>')['tempFileEnabled']).toBe(true);
      expect(dest('<outputPattern>a.txt</outputPattern>')['tempFileEnabled']).toBe(false);
    });

    it('imports the channel disabled, with a warning, when a Writer must fail rather than overwrite an existing file', () => {
      const result = convert('', '<outputPattern>a.txt</outputPattern><outputAppend>false</outputAppend><errorOnExists>true</errorOnExists>');
      expect(result.channels[0]?.enabled).toBe(false);
      expect(result.warnings.some((w) => w.includes('File Writer "Try then queue"') && w.includes('already exists'))).toBe(true);
      expect(result.warnings.some((w) => w.includes('imported disabled'))).toBe(true);
      // Appending never overwrites, so Mirth's check never fires.
      const appending = convert('', '<outputPattern>a.txt</outputPattern><outputAppend>true</outputAppend><errorOnExists>true</errorOnExists>');
      expect(appending.channels[0]?.enabled).toBe(true);
      expect(appending.warnings.some((w) => w.includes('already exists'))).toBe(false);
    });

    it('leaves the channel enabled when the Writer that must not overwrite is itself disabled in Mirth (#171)', () => {
      const result = MirthImportService.convertXml(loadFixture('mirth-4x-channel.xml')
        .replace(/<properties class="com\.mirth\.connect\.connectors\.js\.JavaScriptDispatcherProperties"[\s\S]*?<\/properties>/, writer('<outputPattern>a.txt</outputPattern><outputAppend>false</outputAppend><errorOnExists>true</errorOnExists>'))
        .replace(/(<mode>DESTINATION<\/mode>\s*)<enabled>true<\/enabled>/, '$1<enabled>false</enabled>'));
      if (!result.ok) throw result.error;
      expect(result.value.channels[0]?.destinations[0]?.enabled).toBe(false);
      expect(result.value.channels[0]?.enabled).toBe(true);
    });

    it.each([
      ['<directoryRecursion>true</directoryRecursion>', 'subfolders'],
      ['<fileSizeMinimum>10</fileSizeMinimum>', 'file size'],
      ['<fileSizeMaximum>1000</fileSizeMaximum><ignoreFileSizeMaximum>false</ignoreFileSizeMaximum>', 'file size'],
      ['<errorReadingAction>MOVE</errorReadingAction><errorMoveToDirectory>/err</errorMoveToDirectory>', 'error'],
      ['<errorResponseAction>MOVE</errorResponseAction><errorMoveToDirectory>/err</errorMoveToDirectory>', 'error'],
    ])('warns about a Reader setting with no equivalent: %s', (inner, needle) => {
      const warnings = convert(inner).warnings.filter((w) => w.includes('File Reader'));
      expect(warnings.some((w) => w.includes(needle))).toBe(true);
    });

    it('says nothing about Mirth\'s default Reader settings', () => {
      const defaults = '<regex>false</regex><directoryRecursion>false</directoryRecursion><afterProcessingAction>NONE</afterProcessingAction><moveToDirectory></moveToDirectory><moveToFileName></moveToFileName><errorReadingAction>NONE</errorReadingAction><errorResponseAction>AFTER_PROCESSING</errorResponseAction><errorMoveToDirectory></errorMoveToDirectory><errorMoveToFileName></errorMoveToFileName><checkFileAge>true</checkFileAge><fileAge>1000</fileAge><fileSizeMinimum>0</fileSizeMinimum><fileSizeMaximum></fileSizeMaximum><ignoreFileSizeMaximum>true</ignoreFileSizeMaximum><sortBy>date</sortBy><binary>false</binary><charsetEncoding>DEFAULT_ENCODING</charsetEncoding>';
      // Only the server-default charset is worth a word (see the DEFAULT_ENCODING test).
      expect(convert(defaults).warnings.filter((w) => w.includes('File Reader') && !w.includes('windows-1252'))).toEqual([]);
    });

    it('warns that a comma-separated file filter, which Mirth splits, is one glob here', () => {
      const withFilter = (filter: string): MirthConvertResult => {
        const result = MirthImportService.convertXml(loadFixture('mirth-4x-channel.xml').replace(
          /<properties class="com\.mirth\.connect\.connectors\.tcp\.TcpReceiverProperties"[\s\S]*?<\/properties>\s*<transformer/,
          `<properties class="com.mirth.connect.connectors.file.FileReceiverProperties" version="4.5.0"><scheme>FILE</scheme><host>/data/in</host><fileFilter>${filter}</fileFilter></properties><transformer`,
        ));
        if (!result.ok) throw result.error;
        return result.value;
      };
      expect(withFilter('*.hl7').warnings.some((w) => w.includes('comma'))).toBe(false);
      expect(withFilter('*.hl7,*.txt').warnings.some((w) => w.includes('comma'))).toBe(true);
    });
  });

  // The importer maps a DICOM Listener and Sender to the DICOM keys (#171), so both validate as imported.
  it('imports a DICOM Sender that deploys, and a DICOM Listener that deploys once its port and folder are filled', () => {
    const listener = '<properties class="com.mirth.connect.connectors.dimse.DICOMReceiverProperties" version="4.5.0"><pluginProperties/><listenerConnectorProperties version="4.5.0"><host>0.0.0.0</host><port>104</port></listenerConnectorProperties><sourceConnectorProperties version="4.5.0"><responseVariable>None</responseVariable></sourceConnectorProperties><applicationEntity>MIRTH</applicationEntity><localHost></localHost><localPort></localPort><localApplicationEntity></localApplicationEntity><soCloseDelay>50</soCloseDelay><releaseTo>5</releaseTo><requestTo>5</requestTo><idleTo>60</idleTo><reaper>10</reaper><rspDelay>0</rspDelay><pdv1>false</pdv1><sndpdulen>16</sndpdulen><rcvpdulen>16</rcvpdulen><async>0</async><bigEndian>false</bigEndian><bufSize>1</bufSize><defts>false</defts><dest>/mirth/dicom</dest><nativeData>false</nativeData><sorcvbuf>0</sorcvbuf><sosndbuf>0</sosndbuf><tcpDelay>true</tcpDelay><keyPW></keyPW><keyStore></keyStore><keyStorePW></keyStorePW><noClientAuth>true</noClientAuth><nossl2>true</nossl2><tls>notls</tls><trustStore></trustStore><trustStorePW></trustStorePW></properties><transformer';
    const sender = '<properties class="com.mirth.connect.connectors.dimse.DICOMDispatcherProperties" version="4.5.0"><pluginProperties/><destinationConnectorProperties version="4.5.0"><queueEnabled>false</queueEnabled></destinationConnectorProperties><host>pacs.example</host><port>104</port><applicationEntity>PACS1</applicationEntity><localHost></localHost><localPort></localPort><localApplicationEntity></localApplicationEntity><template>${DICOMMESSAGE}</template><acceptTo>5000</acceptTo><async>0</async><bufSize>1</bufSize><connectTo>0</connectTo><priority>med</priority><passcode></passcode><pdv1>false</pdv1><rcvpdulen>16</rcvpdulen><reaper>10</reaper><releaseTo>5</releaseTo><rspTo>60</rspTo><shutdownDelay>1000</shutdownDelay><sndpdulen>16</sndpdulen><soCloseDelay>50</soCloseDelay><sorcvbuf>0</sorcvbuf><sosndbuf>0</sosndbuf><stgcmt>false</stgcmt><tcpDelay>true</tcpDelay><ts1>false</ts1><uidnegrsp>false</uidnegrsp><username></username><keyPW></keyPW><keyStore></keyStore><keyStorePW></keyStorePW><noClientAuth>true</noClientAuth><nossl2>true</nossl2><tls>notls</tls><trustStore></trustStore><trustStorePW></trustStorePW></properties>';
    const channel = convert4x((x) => x
      .replace(/<properties class="com\.mirth\.connect\.connectors\.tcp\.TcpReceiverProperties"[\s\S]*?<\/properties>\s*<transformer/, listener)
      .replace('<transportName>TCP Listener</transportName>', '<transportName>DICOM Listener</transportName>')
      .replace(/<properties class="com\.mirth\.connect\.connectors\.js\.JavaScriptDispatcherProperties"[\s\S]*?<\/properties>/, sender)
      .replace('<transportName>JavaScript Writer</transportName>', '<transportName>DICOM Sender</transportName>'));
    expect(channel.sourceConnectorType).toBe('DICOM');
    expect(channel.destinations[0]?.connectorType).toBe('DICOM');
    expect(validateConnectorProperties('DICOM', 'destination', channel.destinations[0]?.properties ?? {})).toMatchObject({ ok: true });
    expect(validateConnectorProperties('DICOM', 'source', channel.sourceConnectorProperties)).toMatchObject({ ok: true });
    expect(validateConnectorProperties('DICOM', 'source', { ...channel.sourceConnectorProperties, port: 104, storageDir: '/dicom/in' })).toMatchObject({ ok: true });
  });

  describe('a File connector with a remote scheme', () => {
    const reader = (scheme: string, hostKeyChecking: string): string => `<properties class="com.mirth.connect.connectors.file.FileReceiverProperties" version="4.5.0"><scheme>${scheme}</scheme><schemeProperties class="com.mirth.connect.connectors.file.SftpSchemeProperties"><hostKeyChecking>${hostKeyChecking}</hostKeyChecking></schemeProperties><host>sftp.partner.org:2222/out/orders</host><fileFilter>*.hl7</fileFilter><username>svc</username><password>pw</password><afterProcessingAction>DELETE</afterProcessingAction><moveToDirectory></moveToDirectory></properties><transformer`;
    const writer = '<properties class="com.mirth.connect.connectors.file.FileDispatcherProperties" version="4.5.0"><scheme>SFTP</scheme><schemeProperties class="com.mirth.connect.connectors.file.SftpSchemeProperties"><hostKeyChecking>no</hostKeyChecking></schemeProperties><host>sftp.partner.org/in</host><outputPattern>${messageId}.hl7</outputPattern><outputAppend>false</outputAppend><username>svc</username><password>pw</password></properties>';
    const convert = (scheme: string, hostKeyChecking = 'no'): MirthConvertResult => {
      const xml = loadFixture('mirth-4x-channel.xml')
        .replace(/<properties class="com\.mirth\.connect\.connectors\.tcp\.TcpReceiverProperties"[\s\S]*?<\/properties>\s*<transformer/, reader(scheme, hostKeyChecking))
        .replace(/<properties class="com\.mirth\.connect\.connectors\.js\.JavaScriptDispatcherProperties"[\s\S]*?<\/properties>/, writer);
      const result = MirthImportService.convertXml(xml);
      if (!result.ok) throw result.error;
      return result.value;
    };

    it('runs an SFTP File Reader and Writer on the SFTP connector', () => {
      const { channels } = convert('SFTP');
      expect(channels[0]?.sourceConnectorType).toBe('SFTP');
      expect(channels[0]?.sourceConnectorProperties).toEqual({
        host: 'sftp.partner.org', port: 2222, remoteDirectory: '/out/orders', username: 'svc', password: 'pw',
        strictHostKey: false, filePattern: '*.hl7', afterProcessing: 'DELETE', moveToDirectory: '',
      });
      expect(channels[0]?.destinations[0]).toMatchObject({
        connectorType: 'SFTP',
        properties: { host: 'sftp.partner.org', remoteDirectory: '/in', fileNameTemplate: '${messageId}.hl7', appendMode: false, strictHostKey: false },
      });
      expect(validateConnectorProperties('SFTP', 'source', channels[0]?.sourceConnectorProperties ?? {})).toMatchObject({ ok: true });
      expect(validateConnectorProperties('SFTP', 'destination', channels[0]?.destinations[0]?.properties ?? {})).toMatchObject({ ok: true });
    });

    it('keeps a File Reader reading dotfiles when Mirth had ignoreDot off, local and SFTP alike (#244)', () => {
      const withDots = (scheme: string, host: string): string => `<properties class="com.mirth.connect.connectors.file.FileReceiverProperties" version="4.5.0"><scheme>${scheme}</scheme><schemeProperties class="com.mirth.connect.connectors.file.SftpSchemeProperties"><hostKeyChecking>no</hostKeyChecking></schemeProperties><host>${host}</host><fileFilter>*</fileFilter><ignoreDot>false</ignoreDot><username>svc</username><password>pw</password></properties><transformer`;
      const source = (scheme: string, host: string): ChannelExportEntry => convert4x((x) => x
        .replace(/<properties class="com\.mirth\.connect\.connectors\.tcp\.TcpReceiverProperties"[\s\S]*?<\/properties>\s*<transformer/, withDots(scheme, host)));

      const local = source('FILE', '/data/in');
      expect(local.sourceConnectorProperties['ignoreDot']).toBe(false);
      expect(validateConnectorProperties('FILE', 'source', local.sourceConnectorProperties)).toMatchObject({ ok: true });
      const sftp = source('SFTP', 'sftp.partner.org/out');
      expect(sftp.sourceConnectorType).toBe('SFTP');
      expect(sftp.sourceConnectorProperties['ignoreDot']).toBe(false);
      expect(validateConnectorProperties('SFTP', 'source', sftp.sourceConnectorProperties)).toMatchObject({ ok: true });
    });

    const sftp = (readerExtra: string, writerExtra: string): MirthConvertResult => {
      const result = MirthImportService.convertXml(loadFixture('mirth-4x-channel.xml')
        .replace(/<properties class="com\.mirth\.connect\.connectors\.tcp\.TcpReceiverProperties"[\s\S]*?<\/properties>\s*<transformer/, reader('SFTP', 'no').replace('</properties><transformer', `${readerExtra}</properties><transformer`))
        .replace(/<properties class="com\.mirth\.connect\.connectors\.js\.JavaScriptDispatcherProperties"[\s\S]*?<\/properties>/, writer.replace(/<outputAppend>false<\/outputAppend>/, '').replace('</properties>', `${writerExtra}</properties>`)));
      if (!result.ok) throw result.error;
      return result.value;
    };

    it('carries an SFTP Reader\'s charset, and warns about a Writer charset or binary files the SFTP connector cannot handle', () => {
      const result = sftp('<charsetEncoding>ISO-8859-1</charsetEncoding><binary>true</binary>', '<outputAppend>true</outputAppend><charsetEncoding>ISO-8859-1</charsetEncoding>');
      expect(result.channels[0]?.sourceConnectorProperties['charset']).toBe('latin1');
      // The strict SFTP schema (charsetSchema, like FILE) takes the carried charset.
      expect(validateConnectorProperties('SFTP', 'source', result.channels[0]?.sourceConnectorProperties ?? {})).toMatchObject({ ok: true });
      expect(result.warnings.some((w) => w.includes('SFTP Writer writes UTF-8 only'))).toBe(true);
      expect(result.warnings.some((w) => w.includes('File Reader') && w.includes('binary'))).toBe(true);
      const plain = sftp('<charsetEncoding>UTF-8</charsetEncoding>', '<outputAppend>true</outputAppend><charsetEncoding>UTF-8</charsetEncoding>');
      expect(plain.warnings.some((w) => w.includes('UTF-8 only') || w.includes('binary'))).toBe(false);
    });

    it('keeps an SFTP rename in place as a Move the strict SFTP schema refuses until a folder is set', () => {
      const result = MirthImportService.convertXml(loadFixture('mirth-4x-channel.xml')
        .replace(/<properties class="com\.mirth\.connect\.connectors\.tcp\.TcpReceiverProperties"[\s\S]*?<\/properties>\s*<transformer/, reader('SFTP', 'no')
          .replace('<afterProcessingAction>DELETE</afterProcessingAction>', '<afterProcessingAction>MOVE</afterProcessingAction><moveToFileName>${originalFilename}.done</moveToFileName>')));
      if (!result.ok) throw result.error;
      const props = result.value.channels[0]?.sourceConnectorProperties ?? {};
      expect(props['afterProcessing']).toBe('MOVE');
      expect(validateConnectorProperties('SFTP', 'source', props)).toMatchObject({ ok: false, error: { message: expect.stringContaining('moveToDirectory') } });
    });

    it('imports the channel disabled when an SFTP Writer must fail rather than overwrite an existing file', () => {
      const result = sftp('', '<outputAppend>false</outputAppend><errorOnExists>true</errorOnExists>');
      expect(result.channels[0]?.destinations[0]?.connectorType).toBe('SFTP');
      expect(result.channels[0]?.enabled).toBe(false);
      expect(result.warnings.some((w) => w.includes('already exists'))).toBe(true);
    });

    it('keeps host key checking on, and says the key must be entered', () => {
      const result = convert('SFTP', 'yes');
      expect(result.channels[0]?.sourceConnectorProperties['strictHostKey']).toBe(true);
      expect(result.warnings.some((w) => w.includes('host key'))).toBe(true);
    });

    it('warns that a scheme with no connector here will not deploy', () => {
      expect(convert('FTP').warnings.some((w) => w.includes('FTP file scheme is not supported'))).toBe(true);
    });

    it.each(['FTP', 'SMB', 'S3', 'WEBDAV'])('gives a %s File Reader and Writer no local folder, so they refuse to deploy instead of using a folder named after the server (#227)', (scheme) => {
      const ftpWriter = writer.replace('<scheme>SFTP</scheme>', `<scheme>${scheme}</scheme>`).replace('sftp.partner.org/in', 'ftp.partner.org/in');
      const result = MirthImportService.convertXml(loadFixture('mirth-4x-channel.xml')
        .replace(/<properties class="com\.mirth\.connect\.connectors\.tcp\.TcpReceiverProperties"[\s\S]*?<\/properties>\s*<transformer/, reader(scheme, 'no'))
        .replace(/<properties class="com\.mirth\.connect\.connectors\.js\.JavaScriptDispatcherProperties"[\s\S]*?<\/properties>/, ftpWriter));
      if (!result.ok) throw result.error;
      const channel = result.value.channels[0];
      expect(channel?.sourceConnectorType).toBe('FILE');
      expect(channel?.sourceConnectorProperties['directory']).toBeUndefined();
      expect(validateConnectorProperties('FILE', 'source', channel?.sourceConnectorProperties ?? {})).toMatchObject({ ok: false });
      expect(channel?.destinations[0]?.connectorType).toBe('FILE');
      expect(channel?.destinations[0]?.properties['directory']).toBeUndefined();
      expect(validateConnectorProperties('FILE', 'destination', channel?.destinations[0]?.properties ?? {})).toMatchObject({ ok: false });
    });

    it('does not carry a remote Reader\'s move to a folder on the partner\'s server as a local move', () => {
      const moving = reader('FTP', 'no').replace('<afterProcessingAction>DELETE</afterProcessingAction><moveToDirectory></moveToDirectory>', '<afterProcessingAction>MOVE</afterProcessingAction><moveToDirectory>/out/done</moveToDirectory>');
      const result = MirthImportService.convertXml(loadFixture('mirth-4x-channel.xml')
        .replace(/<properties class="com\.mirth\.connect\.connectors\.tcp\.TcpReceiverProperties"[\s\S]*?<\/properties>\s*<transformer/, moving));
      if (!result.ok) throw result.error;
      const props = result.value.channels[0]?.sourceConnectorProperties ?? {};
      expect(props['moveToDirectory']).toBeUndefined();
      expect(props['postAction']).not.toBe('MOVE');
    });
  });

  describe('settings the import used to drop without a word (#171)', () => {
    const SOURCE = /<properties class="com\.mirth\.connect\.connectors\.tcp\.TcpReceiverProperties"[\s\S]*?<\/properties>\s*<transformer/;
    const FIRST_DEST = /<properties class="com\.mirth\.connect\.connectors\.js\.JavaScriptDispatcherProperties"[\s\S]*?<\/properties>/;
    const convertXml = (edit: (x: string) => string): MirthConvertResult => {
      const result = MirthImportService.convertXml(edit(loadFixture('mirth-4x-channel.xml')));
      if (!result.ok) throw result.error;
      return result.value;
    };
    const warningsWith = (result: MirthConvertResult, needle: string): string[] => result.warnings.filter((w) => w.includes(needle));

    describe('DICOM Listener and Sender', () => {
      const listener = (dest: string, tls = 'notls'): string => `<properties class="com.mirth.connect.connectors.dimse.DICOMReceiverProperties" version="4.5.0"><pluginProperties/><listenerConnectorProperties version="4.5.0"><host>0.0.0.0</host><port>11104</port></listenerConnectorProperties><sourceConnectorProperties version="4.5.0"><responseVariable>None</responseVariable></sourceConnectorProperties><soCloseDelay>50</soCloseDelay><releaseTo>5</releaseTo><requestTo>5</requestTo><idleTo>60</idleTo><reaper>10</reaper><rspDelay>0</rspDelay><pdv1>false</pdv1><sndpdulen>16</sndpdulen><rcvpdulen>16</rcvpdulen><async>0</async><bigEndian>false</bigEndian><bufSize>1</bufSize><defts>false</defts><dest>${dest}</dest><nativeData>false</nativeData><sorcvbuf>0</sorcvbuf><sosndbuf>0</sosndbuf><tcpDelay>true</tcpDelay><keyPW></keyPW><keyStore></keyStore><keyStorePW></keyStorePW><noClientAuth>true</noClientAuth><nossl2>true</nossl2><tls>${tls}</tls><trustStore></trustStore><trustStorePW></trustStorePW><applicationEntity>HUB_SCP</applicationEntity><localHost></localHost><localPort></localPort><localApplicationEntity></localApplicationEntity></properties><transformer`;
      const sender = (extra = ''): string => `<properties class="com.mirth.connect.connectors.dimse.DICOMDispatcherProperties" version="4.5.0"><pluginProperties/><host>pacs.example.org</host><port>11112</port><template>\${DICOMMESSAGE}</template><acceptTo>5000</acceptTo><async>0</async><bufSize>1</bufSize><connectTo>0</connectTo><priority>med</priority><passcode></passcode><pdv1>false</pdv1><rcvpdulen>16</rcvpdulen><reaper>10</reaper><releaseTo>5</releaseTo><rspTo>60</rspTo><shutdownDelay>1000</shutdownDelay><sndpdulen>16</sndpdulen><soCloseDelay>50</soCloseDelay><sorcvbuf>0</sorcvbuf><sosndbuf>0</sosndbuf><stgcmt>false</stgcmt><tcpDelay>true</tcpDelay><ts1>false</ts1><uidnegrsp>false</uidnegrsp><username></username><applicationEntity>PACS_MAIN</applicationEntity><keyPW></keyPW><keyStore></keyStore><keyStorePW></keyStorePW><noClientAuth>true</noClientAuth><nossl2>true</nossl2><tls>notls</tls><trustStore></trustStore><trustStorePW></trustStorePW><localHost></localHost><localPort></localPort><localApplicationEntity>HUB_SCU</localApplicationEntity>${extra}</properties>`;
      const dicom = (src: string, dst: string) => (x: string): string => x
        .replace(SOURCE, src)
        .replace('<transportName>TCP Listener</transportName>', '<transportName>DICOM Listener</transportName>')
        .replace(FIRST_DEST, dst);

      it('carries the Listener\'s port, AE title and storage folder, keeping stored files as Mirth does', () => {
        const result = convertXml(dicom(listener('/data/dicom'), sender()));
        const channel = result.channels[0];
        expect(channel?.sourceConnectorType).toBe('DICOM');
        expect(channel?.sourceConnectorProperties).toEqual({ port: 11104, storageDir: '/data/dicom', postAction: 'NONE', aeTitle: 'HUB_SCP' });
        expect(validateConnectorProperties('DICOM', 'source', channel?.sourceConnectorProperties ?? {})).toMatchObject({ ok: true });
        // The class names DICOM, so nothing says it falls back to JavaScript.
        expect(warningsWith(result, 'JAVASCRIPT')).toEqual([]);
      });

      it('carries the Sender\'s host, port and both AE titles', () => {
        const dest = convertXml(dicom(listener('/data/dicom'), sender())).channels[0]?.destinations[0];
        expect(dest?.connectorType).toBe('DICOM');
        expect(dest?.properties).toEqual({ host: 'pacs.example.org', port: 11112, calledAETitle: 'PACS_MAIN', callingAETitle: 'HUB_SCU' });
        expect(validateConnectorProperties('DICOM', 'destination', dest?.properties ?? {})).toMatchObject({ ok: true });
      });

      it('writes the Sender\'s AE titles Mirth uses when they are blank, not GalvaniGraph\'s defaults', () => {
        const blank = sender().replace('<applicationEntity>PACS_MAIN</applicationEntity>', '<applicationEntity></applicationEntity>').replace('<localApplicationEntity>HUB_SCU</localApplicationEntity>', '<localApplicationEntity></localApplicationEntity>');
        const dest = convertXml(dicom(listener('/data/dicom'), blank)).channels[0]?.destinations[0];
        expect(dest?.properties).toMatchObject({ calledAETitle: 'DCMRCV', callingAETitle: 'DCMSND' });
      });

      it('says messages are file paths here, and that a Listener with no storage folder needs one, still keeping its files', () => {
        const result = convertXml(dicom(listener(''), sender()));
        expect(result.channels[0]?.sourceConnectorProperties['storageDir']).toBeUndefined();
        // Mirth's default folder is blank; the files must still stay, or a queued Sender finds none.
        expect(result.channels[0]?.sourceConnectorProperties['postAction']).toBe('NONE');
        expect(warningsWith(result, 'storageDir')).toHaveLength(1);
        expect(warningsWith(result, 'file path')).toHaveLength(1);
      });

      it('warns that TLS, user identity and storage commitment do not carry', () => {
        const result = convertXml(dicom(listener('/d', 'aes'), sender().replace('<stgcmt>false</stgcmt>', '<stgcmt>true</stgcmt>').replace('<username></username>', '<username>svc</username>')));
        expect(warningsWith(result, 'TLS')).toHaveLength(1);
        const sending = warningsWith(result, 'DICOM Sender "Try then queue"').join(' ');
        expect(sending).toContain('user identity');
        expect(sending).toContain('storage commitment');
      });

      it('keeps Mirth\'s TLS setting so the deploy refuses a channel it would otherwise run in plaintext', () => {
        const tlsSender = sender().replace('<tls>notls</tls>', '<tls>aes</tls>');
        const result = convertXml(dicom(listener('/d', 'aes'), tlsSender));
        const channel = result.channels[0];
        expect(validateConnectorProperties('DICOM', 'source', channel?.sourceConnectorProperties ?? {})).toMatchObject({ ok: false, error: { message: expect.stringContaining('tls') } });
        expect(validateConnectorProperties('DICOM', 'destination', channel?.destinations[0]?.properties ?? {})).toMatchObject({ ok: false, error: { message: expect.stringContaining('tls') } });
        expect(warningsWith(result, 'TLS').join(' ')).toContain('will not deploy');
        // Without TLS both directions validate as imported.
        const plain = convertXml(dicom(listener('/d'), sender())).channels[0];
        expect(validateConnectorProperties('DICOM', 'source', plain?.sourceConnectorProperties ?? {})).toMatchObject({ ok: true });
        expect(validateConnectorProperties('DICOM', 'destination', plain?.destinations[0]?.properties ?? {})).toMatchObject({ ok: true });
      });
    });

    describe('polling schedules', () => {
      const poll = (inner: string): string => `<properties class="com.mirth.connect.connectors.js.JavaScriptReceiverProperties" version="4.5.0"><pluginProperties/><pollConnectorProperties version="4.5.0">${inner}</pollConnectorProperties><script>return 1;</script></properties><transformer`;
      const advanced = (weekly: string, inactive: string, allDay: string): string => `<pollConnectorPropertiesAdvanced><weekly>${weekly}</weekly><inactiveDays>${inactive}</inactiveDays><dayOfMonth>1</dayOfMonth><allDay>${allDay}</allDay><startingHour>8</startingHour><startingMinute>0</startingMinute><endingHour>17</endingHour><endingMinute>0</endingMinute></pollConnectorPropertiesAdvanced>`;
      const days = (sunday: string): string => `<boolean>false</boolean><boolean>${sunday}</boolean>${'<boolean>false</boolean>'.repeat(6)}`;
      const reader = (inner: string): MirthConvertResult => convertXml((x) => x
        .replace(SOURCE, poll(inner))
        .replace('<transportName>TCP Listener</transportName>', '<transportName>JavaScript Reader</transportName>'));

      it('warns, naming the channel and the time, that a time-of-day schedule becomes an interval', () => {
        const warnings = warningsWith(reader('<pollingType>TIME</pollingType><pollingFrequency>5000</pollingFrequency><pollingHour>2</pollingHour><pollingMinute>5</pollingMinute>'), '02:05');
        expect(warnings).toHaveLength(1);
        expect(warnings[0]).toContain('Channel "4x Listener"');
        expect(warnings[0]).toContain('interval');
      });

      it('warns with the cron expressions that a cron schedule becomes an interval', () => {
        const result = reader('<pollingType>CRON</pollingType><cronJobs><cronProperty><description>nightly</description><expression>0 30 1 * * ?</expression></cronProperty></cronJobs>');
        expect(warningsWith(result, '0 30 1 * * ?')).toHaveLength(1);
      });

      it('imports a channel polled by time of day or cron disabled, so it does not run every few seconds once deployed', () => {
        for (const type of ['TIME', 'CRON']) {
          const result = reader(`<pollingType>${type}</pollingType><pollingHour>2</pollingHour><pollingMinute>0</pollingMinute>`);
          expect(result.channels[0]?.enabled).toBe(false);
          expect(warningsWith(result, 'imported disabled')).toHaveLength(1);
          // The reason travels with the channel, so the editor shows it and an export keeps it.
          expect(result.channels[0]?.description).toContain('0123');
          expect(result.channels[0]?.description).toContain('Imported disabled from Mirth: its source polls on a schedule');
        }
        const interval = reader('<pollingType>INTERVAL</pollingType><pollingFrequency>5000</pollingFrequency>').channels[0];
        expect(interval?.enabled).toBe(true);
        expect(interval?.description).toBe('0123');
      });

      it('reads the polling type in lower case, as Mirth 3.0 to 3.2 write it', () => {
        const time = reader('<pollingType>time</pollingType><pollingHour>2</pollingHour><pollingMinute>0</pollingMinute>');
        expect(time.channels[0]?.enabled).toBe(false);
        expect(warningsWith(time, '02:00')).toHaveLength(1);
        expect(reader('<pollingType>interval</pollingType><pollingFrequency>7000</pollingFrequency>').channels[0]?.sourceConnectorProperties['pollingIntervalMs']).toBe(7000);
      });

      it('warns when interval polling was limited to some days or hours', () => {
        const base = '<pollingType>INTERVAL</pollingType><pollingFrequency>5000</pollingFrequency>';
        expect(warningsWith(reader(base + advanced('true', days('false'), 'true')), 'days or hours')).toEqual([]);
        expect(warningsWith(reader(base + advanced('true', days('true'), 'true')), 'days or hours')).toHaveLength(1);
        expect(warningsWith(reader(base + advanced('true', days('false'), 'false')), 'days or hours')).toHaveLength(1);
        expect(warningsWith(reader(base + advanced('false', days('false'), 'true')), 'days or hours')).toHaveLength(1);
      });

      it('says nothing about plain interval polling', () => {
        expect(warningsWith(reader('<pollingType>INTERVAL</pollingType><pollingFrequency>5000</pollingFrequency>'), 'poll')).toEqual([]);
      });
    });

    describe('pruning', () => {
      const pruning = (settings: string) => (x: string): string => x.replace('</properties>\n</channel>', `</properties>\n  <exportData><metadata><enabled>true</enabled><pruningSettings>${settings}</pruningSettings></metadata></exportData>\n</channel>`);

      it('reads the age from exportData/metadata/pruningSettings, where Mirth 3.5+ keeps it', () => {
        const result = convertXml(pruning('<pruneMetaDataDays>30</pruneMetaDataDays><archiveEnabled>false</archiveEnabled><pruneErroredMessages>true</pruneErroredMessages>'));
        expect(result.channels[0]).toMatchObject({ pruningEnabled: true, pruningMaxAgeDays: 30, pruningArchiveEnabled: false });
        expect(warningsWith(result, 'prun')).toEqual([]);
      });

      it('reads the age from the channel properties of a pre-3.5 export', () => {
        const old = convertXml((x) => x.replace('<initialState>STARTED</initialState>', '<initialState>STARTED</initialState><pruneMetaDataDays>14</pruneMetaDataDays><archiveEnabled>false</archiveEnabled><pruneErroredMessages>true</pruneErroredMessages>'));
        expect(old.channels[0]).toMatchObject({ pruningEnabled: true, pruningMaxAgeDays: 14 });
      });

      it('leaves pruning off when Mirth keeps messages for good', () => {
        const result = convertXml(pruning('<archiveEnabled>true</archiveEnabled><pruneErroredMessages>false</pruneErroredMessages>'));
        expect(result.channels[0]).toMatchObject({ pruningEnabled: false, pruningMaxAgeDays: null });
        expect(warningsWith(result, 'prun')).toEqual([]);
      });

      it('leaves pruning off, and says why, when Mirth keeps errored messages, which GalvaniGraph would prune', () => {
        const result = convertXml(pruning('<pruneMetaDataDays>30</pruneMetaDataDays><archiveEnabled>false</archiveEnabled><pruneErroredMessages>false</pruneErroredMessages>'));
        expect(result.channels[0]).toMatchObject({ pruningEnabled: false, pruningMaxAgeDays: 30 });
        const warning = warningsWith(result, 'prun');
        expect(warning).toHaveLength(1);
        expect(warning[0]).toContain('errored');
        // Mirth's default is to keep them, so an export without the flag does the same.
        expect(convertXml(pruning('<pruneMetaDataDays>30</pruneMetaDataDays><archiveEnabled>false</archiveEnabled>')).channels[0]?.pruningEnabled).toBe(false);
      });

      it('warns that nothing is archived here when Mirth archived before pruning', () => {
        const result = convertXml(pruning('<pruneMetaDataDays>30</pruneMetaDataDays><archiveEnabled>true</archiveEnabled><pruneErroredMessages>true</pruneErroredMessages>'));
        expect(result.channels[0]?.pruningEnabled).toBe(true);
        expect(warningsWith(result, 'archive')).toHaveLength(1);
      });

      it('warns that content-only pruning keeps the content until the whole message is pruned', () => {
        const contentOnly = convertXml(pruning('<pruneContentDays>7</pruneContentDays><archiveEnabled>false</archiveEnabled><pruneErroredMessages>true</pruneErroredMessages>'));
        expect(contentOnly.channels[0]?.pruningEnabled).toBe(false);
        expect(warningsWith(contentOnly, 'content after 7 days')).toHaveLength(1);
        const both = convertXml(pruning('<pruneMetaDataDays>90</pruneMetaDataDays><pruneContentDays>7</pruneContentDays><archiveEnabled>false</archiveEnabled><pruneErroredMessages>true</pruneErroredMessages>'));
        expect(both.channels[0]?.pruningMaxAgeDays).toBe(90);
        expect(warningsWith(both, 'content after 7 days')).toHaveLength(1);
      });
    });

    describe('Rule Builder filter rules', () => {
      const ruleBuilder = (field: string, condition: string, values: string): string => `<filter version="4.5.0">
        <elements>
          <com.mirth.connect.plugins.rulebuilder.RuleBuilderRule version="4.5.0">
            <name>Only orders</name>
            <sequenceNumber>0</sequenceNumber>
            <enabled>true</enabled>
            <operator>NONE</operator>
            <field>${field}</field>
            <condition>${condition}</condition>
            <values>${values}</values>
          </com.mirth.connect.plugins.rulebuilder.RuleBuilderRule>
        </elements>
      </filter>`;
      const rule = (field: string, condition: string, values: string): MirthConvertResult => convertXml((x) => x.replace(/<filter version="4\.5\.0">[\s\S]*?<\/filter>/, ruleBuilder(field, condition, values)));
      const sourceRule = (result: MirthConvertResult): Record<string, unknown> | undefined => result.channels[0]?.filters.find((f) => (f.metaDataId ?? null) === null)?.rules[0];
      const HL7_FIELD = 'msg[&apos;MSH&apos;][&apos;MSH.9&apos;][&apos;MSH.9.1&apos;].toString()';

      it.each([
        ['EQUALS', 'EQUALS'],
        ['NOT_EQUAL', 'NOT_EQUALS'],
        ['CONTAINS', 'CONTAINS'],
        ['NOT_CONTAIN', 'NOT_CONTAINS'],
      ])('turns an HL7 field compared with quoted text (%s) into a Rule Builder rule the engine runs (%s)', (condition, mapped) => {
        const result = rule(HL7_FIELD, condition, '<string>&quot;ORM&quot;</string><string>&apos;OML&apos;</string>');
        expect(sourceRule(result)).toMatchObject({ type: 'RULE_BUILDER', field: 'MSH.9.1', condition: mapped, values: ['ORM', 'OML'] });
        expect(warningsWith(result, 'Rule Builder')).toEqual([]);
      });

      it('maps Mirth\'s EXISTS and NOT_EXIST, which take no values', () => {
        expect(sourceRule(rule(HL7_FIELD, 'EXISTS', ''))).toMatchObject({ type: 'RULE_BUILDER', condition: 'EXISTS', values: [] });
        expect(sourceRule(rule(HL7_FIELD, 'NOT_EXIST', ''))).toMatchObject({ type: 'RULE_BUILDER', condition: 'NOT_EXISTS' });
      });

      it('builds the JavaScript Mirth would run when a value is an expression, and the script check names what to rewrite', () => {
        const result = rule(HL7_FIELD, 'EQUALS', '<string>$(&apos;expected&apos;)</string>');
        expect(sourceRule(result)).toMatchObject({
          type: 'JAVASCRIPT',
          script: "if(msg['MSH']['MSH.9']['MSH.9.1'].toString() == $('expected')) {\n\treturn true;\n}\nreturn false;",
        });
        expect(warningsWith(result, 'Mirth-only constructs')).toHaveLength(1);
      });

      it('gives the engine rules it compiles, and refuses only the one it cannot read', () => {
        const compiled = (result: MirthConvertResult): boolean => {
          const imported = result.channels[0]?.filters.find((f) => (f.metaDataId ?? null) === null)?.rules ?? [];
          return compileFilterRulesToScript(imported.map((r) => ({ ...r, enabled: r.enabled ?? true, operator: r.operator ?? 'AND', type: r.type ?? 'JAVASCRIPT', script: r.script ?? null }))).ok;
        };
        expect(compiled(rule(HL7_FIELD, 'EQUALS', '<string>&quot;ORM&quot;</string>'))).toBe(true);
        expect(compiled(rule(HL7_FIELD, 'NOT_EXIST', ''))).toBe(true);
        expect(compiled(rule(HL7_FIELD, 'EQUALS', '<string>$(&apos;expected&apos;)</string>'))).toBe(true);
        expect(compiled(rule('', 'EQUALS', '<string>&quot;ORM&quot;</string>'))).toBe(false);
      });

      it('keeps the script an older Rule Builder rule carries in place of a field', () => {
        const legacy = convertXml((x) => x.replace(/<filter version="4\.5\.0">[\s\S]*?<\/filter>/, '<filter><rules><rule><sequenceNumber>0</sequenceNumber><name>Old</name><type>Rule Builder</type><script>return msg.get(&apos;MSH.9.1&apos;) == &apos;ORM&apos;;</script><operator>NONE</operator></rule></rules></filter>'));
        expect(sourceRule(legacy)).toMatchObject({ type: 'JAVASCRIPT', script: "return msg.get('MSH.9.1') == 'ORM';" });
      });

      it('compares with empty text when a rule has no values, as Mirth does', () => {
        expect(sourceRule(rule(HL7_FIELD, 'EQUALS', ''))).toMatchObject({ type: 'RULE_BUILDER', condition: 'EQUALS', values: [''] });
        expect(sourceRule(rule(HL7_FIELD, 'CONTAINS', ''))).toMatchObject({ condition: 'CONTAINS', values: [''] });
      });

      it('keeps Mirth\'s generated JavaScript for a field outside MSH, where a segment or field can repeat', () => {
        const obx = 'msg[&apos;OBX&apos;][&apos;OBX.3&apos;][&apos;OBX.3.1&apos;].toString()';
        const result = rule(obx, 'EQUALS', '<string>&quot;GLU&quot;</string>');
        expect(sourceRule(result)).toMatchObject({ type: 'JAVASCRIPT', script: "if(msg['OBX']['OBX.3']['OBX.3.1'].toString() == \"GLU\") {\n\treturn true;\n}\nreturn false;" });
        expect(warningsWith(result, 'Mirth-only constructs')).toHaveLength(1);
      });

      it('does not warn about a disabled rule with no field, which never runs', () => {
        const result = convertXml((x) => x.replace(/<filter version="4\.5\.0">[\s\S]*?<\/filter>/, ruleBuilder('', 'EQUALS', '').replace('<enabled>true</enabled>', '<enabled>false</enabled>')));
        expect(warningsWith(result, 'Rule Builder')).toEqual([]);
      });

      it('keeps a rule it cannot read as a Rule Builder rule the deploy refuses, and warns', () => {
        const result = rule('', 'EQUALS', '<string>&quot;ORM&quot;</string>');
        expect(sourceRule(result)).toMatchObject({ type: 'RULE_BUILDER', field: '' });
        const warning = warningsWith(result, 'Rule Builder');
        expect(warning).toHaveLength(1);
        expect(warning[0]).toContain('"Only orders"');
      });
    });

    it('warns that an HTTP Sender\'s Digest credentials are dropped', () => {
      const http = (type: string): string => `<properties class="com.mirth.connect.connectors.http.HttpDispatcherProperties" version="4.5.0"><host>http://api/orders</host><method>post</method><useAuthentication>true</useAuthentication><authenticationType>${type}</authenticationType><usePreemptiveAuthentication>false</usePreemptiveAuthentication><username>mirth</username><password>s3cret</password></properties>`;
      const digest = convertXml((x) => x.replace(FIRST_DEST, http('Digest')));
      expect(digest.channels[0]?.destinations[0]?.properties['basicAuth']).toBeUndefined();
      const warning = warningsWith(digest, 'Digest');
      expect(warning).toHaveLength(1);
      expect(warning[0]).toContain('HTTP Sender "Try then queue"');
      expect(warning[0]).not.toContain('s3cret');
      expect(warningsWith(convertXml((x) => x.replace(FIRST_DEST, http('Basic'))), 'Digest')).toEqual([]);
    });
  });

  it('leaves a Channel Writer set to "none" without a target', () => {
    const channel = convert4x((x) => x.replace(/<properties class="com\.mirth\.connect\.connectors\.js\.JavaScriptDispatcherProperties"[\s\S]*?<\/properties>/, '<properties class="com.mirth.connect.connectors.vm.VmDispatcherProperties" version="4.5.0"><channelId>none</channelId></properties>'));
    expect(channel.destinations[0]?.properties).toEqual({ targetChannelId: '' });
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
    const result = await MirthImportService.importFromXml(xml, { collisionMode: 'SKIP', dryRun: false });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.convertResult.channels).toHaveLength(1);
    expect(result.value.importResult.created).toBe(1);
  });

  it('returns preview without saving on dry run', async () => {
    const xml = loadFixture('mirth-channel-basic.xml');
    const result = await MirthImportService.importFromXml(xml, { collisionMode: 'SKIP', dryRun: true });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.convertResult.channels).toHaveLength(1);
    expect(result.value.importResult.created).toBe(0);
    expect(result.value.importResult.updated).toBe(0);
    expect(result.value.importResult.skipped).toBe(0);
  });

  it('returns error for invalid XML input', async () => {
    const result = await MirthImportService.importFromXml('<foo>bar</foo>', { collisionMode: 'SKIP', dryRun: false });

    expect(result.ok).toBe(false);
  });

  it('leaves code templates untouched when a channel in the backup fails to import (regression)', async () => {
    const channel = loadFixture('mirth-4x-channel.xml');
    const backup = `<serverConfiguration version="4.5.0"><channels>${channel}</channels><codeTemplateLibraries><codeTemplateLibrary version="4.5.0"><id>l1</id><name>Globals</name><includeNewChannels>true</includeNewChannels><enabledChannelIds/><disabledChannelIds/><codeTemplates><codeTemplate version="4.5.0"><id>t1</id><name>f</name><contextSet><delegate><contextType>SOURCE_FILTER_TRANSFORMER</contextType></delegate></contextSet><properties class="com.mirth.connect.model.codetemplates.BasicCodeTemplateProperties"><type>FUNCTION</type><code>function f() {}</code></properties></codeTemplate></codeTemplates></codeTemplateLibrary></codeTemplateLibraries></serverConfiguration>`;
    const imports = vi.spyOn(ChannelImportService, 'importChannels').mockResolvedValueOnce({
      ok: true, value: { created: 0, updated: 0, skipped: 0, errors: ['Error importing "4x Listener": db down'] }, error: null,
    } as never);
    const listLibraries = vi.spyOn(CodeTemplateService, 'listLibraries');
    try {
      const result = await MirthImportService.importFromXml(backup, { collisionMode: 'OVERWRITE', dryRun: false });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(listLibraries).not.toHaveBeenCalled();
      expect(result.value.codeTemplates).toEqual({ created: 0, updated: 0, skipped: 0 });
      expect(result.value.importResult.errors).toContain('Code template libraries were not imported because 1 channel(s) failed; fix them and import again');
    } finally {
      imports.mockRestore();
      listLibraries.mockRestore();
    }
  });

  it('maps RENAME collision mode to CREATE_NEW', async () => {
    const xml = loadFixture('mirth-channel-basic.xml');
    const result = await MirthImportService.importFromXml(xml, { collisionMode: 'RENAME', dryRun: false });

    // Should succeed — the internal mapping to CREATE_NEW is transparent
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.importResult.created).toBe(1);
  });
});
