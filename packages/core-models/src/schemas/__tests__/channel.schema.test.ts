// Real UI payloads, to catch frontend/backend contract mismatches.

import { describe, it, expect } from 'vitest';
import {
  createChannelSchema,
  updateChannelSchema,
  channelListQuerySchema,
  patchChannelEnabledSchema,
  channelPropertiesSchema,
  destinationInputSchema,
  metadataColumnInputSchema,
} from '../channel.schema.js';
import { SOURCE_CONNECTOR_TYPES, DESTINATION_CONNECTOR_TYPES } from '../../constants.js';

describe('createChannelSchema', () => {
  it('accepts payload from NewChannelDialog', () => {
    const payload = {
      name: 'Test HL7 Channel',
      description: 'Routes lab results',
      enabled: false,
      inboundDataType: 'HL7V2',
      outboundDataType: 'HL7V2',
      sourceConnectorType: 'TCP_MLLP',
      sourceConnectorProperties: {},
      responseMode: 'AUTO_AFTER_DESTINATIONS',
    };

    const result = createChannelSchema.safeParse(payload);

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.name).toBe('Test HL7 Channel');
    expect(result.data.sourceConnectorProperties).toEqual({});
    expect(result.data.enabled).toBe(false);
  });

  it('accepts payload from ChannelEditorPage create mode', () => {
    const payload = {
      name: 'New Editor Channel',
      description: '',
      enabled: true,
      inboundDataType: 'JSON',
      outboundDataType: 'XML',
      sourceConnectorType: 'HTTP',
      sourceConnectorProperties: {},
      responseMode: 'NONE',
    };

    const result = createChannelSchema.safeParse(payload);

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.enabled).toBe(true);
    expect(result.data.inboundDataType).toBe('JSON');
  });

  it('applies defaults when optional fields are omitted', () => {
    const payload = {
      name: 'Minimal Channel',
      inboundDataType: 'HL7V2',
      outboundDataType: 'HL7V2',
      sourceConnectorType: 'TCP_MLLP',
      sourceConnectorProperties: {},
    };

    const result = createChannelSchema.safeParse(payload);

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.description).toBe('');
    expect(result.data.enabled).toBe(false);
    expect(result.data.responseMode).toBe('AUTO_AFTER_DESTINATIONS');
  });

  it('accepts sourceConnectorProperties with content', () => {
    const payload = {
      name: 'MLLP Channel',
      inboundDataType: 'HL7V2',
      outboundDataType: 'HL7V2',
      sourceConnectorType: 'TCP_MLLP',
      sourceConnectorProperties: { port: 6661, host: '0.0.0.0' },
    };

    const result = createChannelSchema.safeParse(payload);

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.sourceConnectorProperties).toEqual({ port: 6661, host: '0.0.0.0' });
  });

  it('accepts optional properties block', () => {
    const payload = {
      name: 'Full Channel',
      inboundDataType: 'HL7V2',
      outboundDataType: 'HL7V2',
      sourceConnectorType: 'TCP_MLLP',
      sourceConnectorProperties: {},
      properties: {
        initialState: 'STARTED',
        messageStorageMode: 'PRODUCTION',
        encryptData: true,
        removeContentOnCompletion: true,
        removeAttachmentsOnCompletion: false,
      },
    };

    const result = createChannelSchema.safeParse(payload);

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.properties?.initialState).toBe('STARTED');
    expect(result.data.properties?.encryptData).toBe(true);
    expect(result.data.properties?.removeContentOnCompletion).toBe(true);
  });

  it('rejects missing required name', () => {
    const payload = {
      inboundDataType: 'HL7V2',
      outboundDataType: 'HL7V2',
      sourceConnectorType: 'TCP_MLLP',
      sourceConnectorProperties: {},
    };

    const result = createChannelSchema.safeParse(payload);
    expect(result.success).toBe(false);
  });

  it('rejects empty name', () => {
    const payload = {
      name: '',
      inboundDataType: 'HL7V2',
      outboundDataType: 'HL7V2',
      sourceConnectorType: 'TCP_MLLP',
      sourceConnectorProperties: {},
    };

    const result = createChannelSchema.safeParse(payload);
    expect(result.success).toBe(false);
  });

  it('rejects name exceeding 255 characters', () => {
    const payload = {
      name: 'A'.repeat(256),
      inboundDataType: 'HL7V2',
      outboundDataType: 'HL7V2',
      sourceConnectorType: 'TCP_MLLP',
      sourceConnectorProperties: {},
    };

    const result = createChannelSchema.safeParse(payload);
    expect(result.success).toBe(false);
  });

  it('rejects invalid inbound data type', () => {
    const payload = {
      name: 'Bad Channel',
      inboundDataType: 'INVALID_TYPE',
      outboundDataType: 'HL7V2',
      sourceConnectorType: 'TCP_MLLP',
      sourceConnectorProperties: {},
    };

    const result = createChannelSchema.safeParse(payload);
    expect(result.success).toBe(false);
  });

  it('rejects invalid source connector type', () => {
    const payload = {
      name: 'Bad Channel',
      inboundDataType: 'HL7V2',
      outboundDataType: 'HL7V2',
      sourceConnectorType: 'INVALID_CONNECTOR',
      sourceConnectorProperties: {},
    };

    const result = createChannelSchema.safeParse(payload);
    expect(result.success).toBe(false);
  });

  it('rejects invalid response mode', () => {
    const payload = {
      name: 'Bad Channel',
      inboundDataType: 'HL7V2',
      outboundDataType: 'HL7V2',
      sourceConnectorType: 'TCP_MLLP',
      sourceConnectorProperties: {},
      responseMode: 'INVALID_MODE',
    };

    const result = createChannelSchema.safeParse(payload);
    expect(result.success).toBe(false);
  });

  it('accepts all valid data type combinations', () => {
    const dataTypes = ['RAW', 'HL7V2', 'HL7V3', 'XML', 'JSON', 'DICOM', 'DELIMITED', 'FHIR'] as const;

    for (const dt of dataTypes) {
      const payload = {
        name: `Channel ${dt}`,
        inboundDataType: dt,
        outboundDataType: dt,
        sourceConnectorType: 'TCP_MLLP' as const,
        sourceConnectorProperties: {},
      };

      const result = createChannelSchema.safeParse(payload);
      expect(result.success, `Expected ${dt} to be valid`).toBe(true);
    }
  });

  it('accepts all valid source connector types', () => {
    for (const ct of SOURCE_CONNECTOR_TYPES) {
      const payload = {
        name: `Channel ${ct}`,
        inboundDataType: 'HL7V2' as const,
        outboundDataType: 'HL7V2' as const,
        sourceConnectorType: ct,
        sourceConnectorProperties: {},
      };

      const result = createChannelSchema.safeParse(payload);
      expect(result.success, `Expected ${ct} to be valid`).toBe(true);
    }
  });

  it.each(['SMTP', 'FHIR'])('rejects destination-only connector %s as the source', (ct) => {
    const result = createChannelSchema.safeParse({
      name: `Channel ${ct}`,
      inboundDataType: 'HL7V2',
      outboundDataType: 'HL7V2',
      sourceConnectorType: ct,
      sourceConnectorProperties: {},
    });
    expect(result.success).toBe(false);
  });
});

describe('updateChannelSchema', () => {
  it('accepts payload from ChannelEditorPage save', () => {
    const payload = {
      name: 'Updated Channel',
      description: 'Updated description',
      enabled: true,
      inboundDataType: 'HL7V2',
      outboundDataType: 'HL7V2',
      sourceConnectorType: 'TCP_MLLP',
      sourceConnectorProperties: { port: 6661 },
      responseMode: 'AUTO_AFTER_DESTINATIONS',
      properties: {
        initialState: 'STOPPED',
        messageStorageMode: 'DEVELOPMENT',
        encryptData: false,
        removeContentOnCompletion: false,
        removeAttachmentsOnCompletion: false,
      },
      revision: 1,
    };

    const result = updateChannelSchema.safeParse(payload);

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.revision).toBe(1);
    expect(result.data.properties?.initialState).toBe('STOPPED');
  });

  it('requires revision field', () => {
    const payload = {
      name: 'Updated Channel',
    };

    const result = updateChannelSchema.safeParse(payload);
    expect(result.success).toBe(false);
  });

  it('rejects non-positive revision', () => {
    const result1 = updateChannelSchema.safeParse({ revision: 0 });
    expect(result1.success).toBe(false);

    const result2 = updateChannelSchema.safeParse({ revision: -1 });
    expect(result2.success).toBe(false);
  });

  // #400: what it fills in, the server writes over what is stored.
  it.each([
    {}, { name: 'Just rename' }, { properties: {} }, { properties: { pruningEnabled: true } }, { scripts: {} }, { scripts: { deploy: 'return;' } },
    { scripts: { languages: { undeploy: 'TYPESCRIPT' } } }, { destinations: [{ id: 'new-1', name: 'D', enabled: true, connectorType: 'HTTP', properties: {} }] },
  ])('fills nothing in: %j', (body) => {
    expect(updateChannelSchema.parse({ revision: 5, ...body })).toEqual({ revision: 5, ...body });
  });

  it('does not take a group, which changes through its own route', () => {
    expect(updateChannelSchema.parse({ revision: 5, groupId: '550e8400-e29b-41d4-a716-446655440000' })).toEqual({ revision: 5 });
  });
});

describe('filters, transformers and metadata columns on update, which are replaced (#400)', () => {
  const rule = { enabled: false, operator: 'OR', type: 'JAVASCRIPT', script: null, field: null, condition: null, values: null };
  const step = { enabled: false, type: 'MAPPER', script: null, sourceField: null, targetField: null, defaultValue: null, mapping: null };
  const filter = { connectorId: null, rules: [rule] };
  const transformer = {
    connectorId: null, inboundDataType: 'JSON', outboundDataType: 'XML', inboundProperties: {}, outboundProperties: {}, inboundTemplate: null, outboundTemplate: null, steps: [step],
  };
  const column = { name: 'PatientId', dataType: 'STRING', mappingExpression: null };

  function without(whole: Record<string, unknown>, key: string): Record<string, unknown> {
    const { [key]: _left, ...rest } = whole;
    return rest;
  }

  function issues(body: Record<string, unknown>): ReadonlyArray<readonly PropertyKey[]> {
    return updateChannelSchema.safeParse({ revision: 1, ...body }).error?.issues.map((i) => i.path) ?? [];
  }

  it('accepts them whole', () => {
    expect(issues({ filters: [filter], transformers: [transformer], metadataColumns: [column] })).toEqual([]);
  });

  it.each(Object.keys(rule))('refuses a rule without its %s', (key) => {
    expect(issues({ filters: [{ ...filter, rules: [rule, without(rule, key)] }] })).toEqual([['filters', 0, 'rules', 1, key]]);
  });

  it.each(Object.keys(filter))('refuses a filter without its %s', (key) => {
    expect(issues({ filters: [filter, without(filter, key)] })).toEqual([['filters', 1, key]]);
  });

  it.each(Object.keys(step))('refuses a step without its %s', (key) => {
    expect(issues({ transformers: [{ ...transformer, steps: [step, without(step, key)] }] })).toEqual([['transformers', 0, 'steps', 1, key]]);
  });

  it.each(Object.keys(transformer))('refuses a transformer without its %s', (key) => {
    expect(issues({ transformers: [without(transformer, key)] })).toEqual([['transformers', 0, key]]);
  });

  it('refuses a metadata column without its mapping', () => {
    expect(issues({ metadataColumns: [without(column, 'mappingExpression')] })).toEqual([['metadataColumns', 0, 'mappingExpression']]);
  });

  it('takes a rule and a step without a name as a read returns them', () => {
    expect(issues({ filters: [{ ...filter, rules: [{ ...rule, name: null }] }], transformers: [{ ...transformer, steps: [{ ...step, name: null }] }] })).toEqual([]);
  });

  it('create needs none of it', () => {
    const { data } = createChannelSchema.safeParse({
      name: 'C', inboundDataType: 'RAW', outboundDataType: 'RAW', sourceConnectorType: 'TCP_MLLP', sourceConnectorProperties: {},
      filters: [{ rules: [{ type: 'JAVASCRIPT', script: 'return true;' }] }], transformers: [{ steps: [{ type: 'MAPPER' }] }], metadataColumns: [{ name: 'PatientId', dataType: 'STRING' }],
    });
    expect(data?.filters?.[0]?.rules[0]).toMatchObject({ enabled: true, operator: 'AND' });
    expect(data?.transformers?.[0]).toMatchObject({ inboundDataType: 'HL7V2', outboundDataType: 'HL7V2', steps: [{ enabled: true }] });
    expect(data?.metadataColumns?.[0]).toMatchObject({ mappingExpression: null });
  });
});

describe('channelListQuerySchema', () => {
  it('applies defaults when no params provided', () => {
    const result = channelListQuerySchema.safeParse({});

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.page).toBe(1);
    expect(result.data.pageSize).toBe(25);
  });

  it('coerces string query params to numbers', () => {
    const result = channelListQuerySchema.safeParse({ page: '2', pageSize: '50' });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.page).toBe(2);
    expect(result.data.pageSize).toBe(50);
  });

  it('rejects page size above 100', () => {
    const result = channelListQuerySchema.safeParse({ page: '1', pageSize: '101' });
    expect(result.success).toBe(false);
  });

  it('rejects non-positive page', () => {
    const result = channelListQuerySchema.safeParse({ page: '0' });
    expect(result.success).toBe(false);
  });
});

describe('patchChannelEnabledSchema', () => {
  it('accepts true', () => {
    const result = patchChannelEnabledSchema.safeParse({ enabled: true });
    expect(result.success).toBe(true);
  });

  it('accepts false', () => {
    const result = patchChannelEnabledSchema.safeParse({ enabled: false });
    expect(result.success).toBe(true);
  });

  it('rejects missing enabled', () => {
    const result = patchChannelEnabledSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it('rejects non-boolean enabled', () => {
    const result = patchChannelEnabledSchema.safeParse({ enabled: 'yes' });
    expect(result.success).toBe(false);
  });
});

describe('channelPropertiesSchema', () => {
  it('applies all defaults when empty object provided', () => {
    const result = channelPropertiesSchema.safeParse({});

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.initialState).toBe('STOPPED');
    expect(result.data.messageStorageMode).toBe('DEVELOPMENT');
    expect(result.data.encryptData).toBe(false);
    expect(result.data.removeContentOnCompletion).toBe(false);
    expect(result.data.removeAttachmentsOnCompletion).toBe(false);
    expect(result.data.pruningEnabled).toBe(false);
    expect(result.data.pruningMaxAgeDays).toBeNull();
    expect(result.data.pruningArchiveEnabled).toBe(false);
  });

  it('accepts all valid initial states', () => {
    const states = ['UNDEPLOYED', 'STARTED', 'PAUSED', 'STOPPED'] as const;

    for (const state of states) {
      const result = channelPropertiesSchema.safeParse({ initialState: state });
      expect(result.success, `Expected ${state} to be valid`).toBe(true);
    }
  });

  it('rejects invalid initial state', () => {
    const result = channelPropertiesSchema.safeParse({ initialState: 'RUNNING' });
    expect(result.success).toBe(false);
  });

  it('accepts all valid message storage modes', () => {
    const modes = ['DEVELOPMENT', 'PRODUCTION', 'RAW', 'METADATA', 'DISABLED'] as const;

    for (const mode of modes) {
      const result = channelPropertiesSchema.safeParse({ messageStorageMode: mode });
      expect(result.success, `Expected ${mode} to be valid`).toBe(true);
    }
  });

  it('accepts pruning fields', () => {
    const result = channelPropertiesSchema.safeParse({
      pruningEnabled: true,
      pruningMaxAgeDays: 30,
      pruningArchiveEnabled: true,
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.pruningEnabled).toBe(true);
    expect(result.data.pruningMaxAgeDays).toBe(30);
    expect(result.data.pruningArchiveEnabled).toBe(true);
  });

  it('rejects non-positive pruningMaxAgeDays', () => {
    const result = channelPropertiesSchema.safeParse({ pruningMaxAgeDays: 0 });
    expect(result.success).toBe(false);

    const result2 = channelPropertiesSchema.safeParse({ pruningMaxAgeDays: -5 });
    expect(result2.success).toBe(false);
  });

  it('accepts null pruningMaxAgeDays', () => {
    const result = channelPropertiesSchema.safeParse({ pruningMaxAgeDays: null });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.pruningMaxAgeDays).toBeNull();
  });
});

describe('destinationInputSchema', () => {
  const VALID_DESTINATION = {
    name: 'Send to Lab',
    connectorType: 'TCP_MLLP',
    properties: { host: 'lab.example.com', port: 6661 },
  };

  it('accepts valid destination with defaults', () => {
    const result = destinationInputSchema.safeParse(VALID_DESTINATION);

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.name).toBe('Send to Lab');
    expect(result.data.enabled).toBe(true);
    expect(result.data.queueMode).toBe('NEVER');
    expect(result.data.retryCount).toBe(0);
    expect(result.data.retryIntervalMs).toBe(10000);
    expect(result.data.rotateQueue).toBe(false);
    expect(result.data.queueThreadCount).toBe(1);
    expect(result.data.waitForPrevious).toBe(false);
  });

  it('accepts full destination with all fields', () => {
    const result = destinationInputSchema.safeParse({
      ...VALID_DESTINATION,
      enabled: false,
      queueMode: 'ON_FAILURE',
      retryCount: 3,
      retryIntervalMs: 5000,
      rotateQueue: true,
      queueThreadCount: 2,
      waitForPrevious: true,
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.enabled).toBe(false);
    expect(result.data.queueMode).toBe('ON_FAILURE');
    expect(result.data.retryCount).toBe(3);
  });

  it('rejects missing name', () => {
    const result = destinationInputSchema.safeParse({
      connectorType: 'TCP_MLLP',
      properties: {},
    });
    expect(result.success).toBe(false);
  });

  it('rejects empty name', () => {
    const result = destinationInputSchema.safeParse({
      name: '',
      connectorType: 'TCP_MLLP',
      properties: {},
    });
    expect(result.success).toBe(false);
  });

  it('rejects invalid connector type', () => {
    const result = destinationInputSchema.safeParse({
      name: 'Bad',
      connectorType: 'INVALID',
      properties: {},
    });
    expect(result.success).toBe(false);
  });

  it('rejects source-only connector EMAIL as a destination', () => {
    const result = destinationInputSchema.safeParse({ name: 'Bad', connectorType: 'EMAIL', properties: {} });
    expect(result.success).toBe(false);
  });

  it('accepts all valid connector types', () => {
    for (const ct of DESTINATION_CONNECTOR_TYPES) {
      const result = destinationInputSchema.safeParse({
        name: `Dest ${ct}`,
        connectorType: ct,
        properties: {},
      });
      expect(result.success, `Expected ${ct} to be valid`).toBe(true);
    }
  });

  it('accepts all valid queue modes', () => {
    const modes = ['NEVER', 'ON_FAILURE', 'ALWAYS'] as const;

    for (const mode of modes) {
      const result = destinationInputSchema.safeParse({
        ...VALID_DESTINATION,
        queueMode: mode,
      });
      expect(result.success, `Expected ${mode} to be valid`).toBe(true);
    }
  });

  it('rejects negative retryCount', () => {
    const result = destinationInputSchema.safeParse({
      ...VALID_DESTINATION,
      retryCount: -1,
    });
    expect(result.success).toBe(false);
  });

  it('rejects non-positive queueThreadCount', () => {
    const result = destinationInputSchema.safeParse({
      ...VALID_DESTINATION,
      queueThreadCount: 0,
    });
    expect(result.success).toBe(false);
  });
});

describe('metadataColumnInputSchema', () => {
  it('accepts valid metadata column', () => {
    const result = metadataColumnInputSchema.safeParse({
      name: 'PatientId',
      dataType: 'STRING',
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.name).toBe('PatientId');
    expect(result.data.dataType).toBe('STRING');
    expect(result.data.mappingExpression).toBeNull();
  });

  it('accepts metadata column with mapping expression', () => {
    const result = metadataColumnInputSchema.safeParse({
      name: 'PatientId',
      dataType: 'STRING',
      mappingExpression: "msg['PID']['PID.3']['PID.3.1'].toString()",
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.mappingExpression).toBe("msg['PID']['PID.3']['PID.3.1'].toString()");
  });

  it('accepts all valid data types', () => {
    const types = ['STRING', 'NUMBER', 'BOOLEAN', 'TIMESTAMP'] as const;

    for (const dt of types) {
      const result = metadataColumnInputSchema.safeParse({ name: 'Col', dataType: dt });
      expect(result.success, `Expected ${dt} to be valid`).toBe(true);
    }
  });

  it('rejects missing name', () => {
    const result = metadataColumnInputSchema.safeParse({ dataType: 'STRING' });
    expect(result.success).toBe(false);
  });

  it('rejects invalid data type', () => {
    const result = metadataColumnInputSchema.safeParse({ name: 'Col', dataType: 'INVALID' });
    expect(result.success).toBe(false);
  });
});

describe('createChannelSchema — destinations array', () => {
  const BASE_PAYLOAD = {
    name: 'Channel with destinations',
    inboundDataType: 'HL7V2' as const,
    outboundDataType: 'HL7V2' as const,
    sourceConnectorType: 'TCP_MLLP' as const,
    sourceConnectorProperties: {},
  };

  it('accepts channel with destinations array', () => {
    const result = createChannelSchema.safeParse({
      ...BASE_PAYLOAD,
      destinations: [
        { name: 'Dest 1', connectorType: 'TCP_MLLP', properties: { host: 'lab', port: 6661 } },
        { name: 'Dest 2', connectorType: 'HTTP', properties: { url: 'http://example.com' } },
      ],
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.destinations).toHaveLength(2);
  });

  it('accepts channel with empty destinations array', () => {
    const result = createChannelSchema.safeParse({
      ...BASE_PAYLOAD,
      destinations: [],
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.destinations).toHaveLength(0);
  });

  it('accepts channel without destinations (optional)', () => {
    const result = createChannelSchema.safeParse(BASE_PAYLOAD);

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.destinations).toBeUndefined();
  });

  it('rejects destinations with invalid entries', () => {
    const result = createChannelSchema.safeParse({
      ...BASE_PAYLOAD,
      destinations: [{ name: '', connectorType: 'INVALID', properties: {} }],
    });
    expect(result.success).toBe(false);
  });

  it('accepts channel with metadataColumns array', () => {
    const result = createChannelSchema.safeParse({
      ...BASE_PAYLOAD,
      metadataColumns: [
        { name: 'PatientId', dataType: 'STRING' },
        { name: 'OrderDate', dataType: 'TIMESTAMP', mappingExpression: 'msg.orderDate' },
      ],
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.metadataColumns).toHaveLength(2);
  });
});

// #395: what waits on a destination's queue goes by which destination it is.
describe('destinations on update', () => {
  const dest = { id: '550e8400-e29b-41d4-a716-446655440000', name: 'D', enabled: false, connectorType: 'HTTP', properties: {} };
  const issues = (input: Record<string, unknown>): unknown[] => updateChannelSchema.safeParse({ revision: 1, ...input }).error?.issues.map((i) => i.path) ?? [];

  it('accepts the stored ones and new ones, each with an id of its own', () => {
    const { destinations } = updateChannelSchema.parse({ revision: 1, destinations: [dest, { ...dest, id: 'new-1' }] });
    expect(destinations!.map((d) => [d.id, d.enabled])).toEqual([[dest.id, false], ['new-1', false]]);
  });

  it('reads ids in capitals as the stored ids, which are in lower case', () => {
    const { destinations, filters } = updateChannelSchema.parse({ revision: 1, destinations: [{ ...dest, id: dest.id.toUpperCase() }], filters: [{ connectorId: dest.id.toUpperCase(), rules: [] }] });
    expect([destinations![0]!.id, filters![0]!.connectorId]).toEqual([dest.id, dest.id]);
  });

  it.each(['id', 'enabled'])('refuses one without its %s, which cannot be guessed', (key) => {
    const { [key as 'id']: _left, ...rest } = dest;
    expect(issues({ destinations: [dest, rest] })).toEqual([['destinations', 1, key]]);
  });

  it('create needs neither', () => {
    const { id: _id, enabled: _enabled, ...rest } = dest;
    const input = createChannelSchema.parse({ name: 'C', inboundDataType: 'RAW', outboundDataType: 'RAW', sourceConnectorType: 'TCP_MLLP', sourceConnectorProperties: {}, destinations: [rest] });
    expect(input.destinations).toEqual([expect.objectContaining({ name: 'D', enabled: true })]);
  });

  it('refuses a filter or transformer that names its destination by a place in the list', () => {
    const filter = { connectorId: null, rules: [] };
    const transformer = { connectorId: null, inboundDataType: 'RAW', outboundDataType: 'RAW', inboundProperties: {}, outboundProperties: {}, inboundTemplate: null, outboundTemplate: null, steps: [] };
    expect(issues({ destinations: [dest], filters: [filter, { ...filter, metaDataId: 1 }], transformers: [{ ...transformer, metaDataId: 1 }] }))
      .toEqual([['filters', 1, 'metaDataId'], ['transformers', 0, 'metaDataId']]);
  });
});

// #183: a client that leaves languages out must not turn TypeScript scripts into
// JavaScript on save, which would switch off their deploy type check.
describe('script languages on update', () => {
  const rule = { enabled: true, operator: 'AND', type: 'JAVASCRIPT', script: 'return true;', field: null, condition: null, values: null };
  const step = { enabled: true, type: 'JAVASCRIPT', script: 'msg = msg;', sourceField: null, targetField: null, defaultValue: null, mapping: null };
  const transformer = { connectorId: null, inboundDataType: 'RAW', outboundDataType: 'RAW', inboundProperties: {}, outboundProperties: {}, inboundTemplate: null, outboundTemplate: null };
  const dest = { id: 'new', name: 'D', enabled: true, connectorType: 'HTTP', properties: {} };

  it('refuses a filter rule script with no language', () => {
    const result = updateChannelSchema.safeParse({ revision: 1, filters: [{ connectorId: null, rules: [rule] }] });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues[0]?.path).toEqual(['filters', 0, 'rules', 0, 'language']);
  });

  it('refuses a transformer step script with no language', () => {
    const result = updateChannelSchema.safeParse({ revision: 1, transformers: [{ ...transformer, steps: [step] }] });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues[0]?.path).toEqual(['transformers', 0, 'steps', 0, 'language']);
  });

  it('refuses a response transformer with no language', () => {
    const result = updateChannelSchema.safeParse({ revision: 1, destinations: [{ ...dest, responseTransformer: 'x;' }] });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues[0]?.path).toEqual(['destinations', 0, 'responseTransformerLanguage']);
  });

  it('accepts items with no script and no language', () => {
    const result = updateChannelSchema.safeParse({
      revision: 1,
      filters: [{ connectorId: null, rules: [{ ...rule, type: 'RULE_BUILDER', script: null, field: 'PID.3', condition: 'EXISTS' }] }],
      transformers: [{ ...transformer, steps: [{ ...step, type: 'MAPPER', script: null, sourceField: 'a', targetField: 'b' }] }],
      destinations: [dest],
    });
    expect(result.success).toBe(true);
  });

  it('accepts scripts that carry their language', () => {
    const result = updateChannelSchema.safeParse({
      revision: 1,
      filters: [{ connectorId: null, rules: [{ ...rule, language: 'TYPESCRIPT' }] }],
      transformers: [{ ...transformer, steps: [{ ...step, language: 'TYPESCRIPT' }] }],
      destinations: [{ ...dest, responseTransformer: 'x;', responseTransformerLanguage: 'TYPESCRIPT' }],
    });
    expect(result.success).toBe(true);
  });

  it('leaves an omitted channel script language unset, so the stored one is kept', () => {
    const result = updateChannelSchema.safeParse({ revision: 1, scripts: { deploy: 'return;' } });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.scripts).toEqual({ deploy: 'return;' });
  });

  it('still lets create leave languages out (the service stores JavaScript)', () => {
    const result = createChannelSchema.safeParse({
      name: 'C', inboundDataType: 'HL7V2', outboundDataType: 'HL7V2',
      sourceConnectorType: 'TCP_MLLP', sourceConnectorProperties: {},
      filters: [{ rules: [rule] }],
    });
    expect(result.success).toBe(true);
  });
});
