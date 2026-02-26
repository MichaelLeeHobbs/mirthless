// ===========================================
// Channel Schema Validation Tests
// ===========================================
// Tests Zod schemas with real UI payloads to catch frontend/backend contract mismatches.

import { describe, it, expect } from 'vitest';
import {
  createChannelSchema,
  updateChannelSchema,
  channelListQuerySchema,
  patchChannelEnabledSchema,
  channelPropertiesSchema,
} from '../channel.schema.js';

describe('createChannelSchema', () => {
  it('accepts payload from NewChannelDialog', () => {
    // Exact payload sent by NewChannelDialog.tsx
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
    // Exact payload sent by ChannelEditorPage.tsx in create mode
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
    const connectorTypes = ['TCP_MLLP', 'HTTP', 'FILE', 'DATABASE', 'JAVASCRIPT', 'CHANNEL', 'DICOM', 'FHIR'] as const;

    for (const ct of connectorTypes) {
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
});

describe('updateChannelSchema', () => {
  it('accepts payload from ChannelEditorPage save', () => {
    // Exact payload sent by ChannelEditorPage.tsx in edit mode
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

  it('accepts partial updates with only revision', () => {
    const payload = {
      name: 'Just rename',
      revision: 5,
    };

    const result = updateChannelSchema.safeParse(payload);

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.name).toBe('Just rename');
    expect(result.data.revision).toBe(5);
    // description has .default('') on createChannelSchema; .partial() makes it optional
    // but when provided, Zod still applies the default. When omitted entirely, it remains undefined.
    // However, since the base schema has .default(''), partial still applies it.
    expect(result.data.description).toBe('');
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
});
