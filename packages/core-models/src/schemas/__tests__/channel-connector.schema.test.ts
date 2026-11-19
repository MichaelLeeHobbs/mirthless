import { describe, it, expect } from 'vitest';
import {
  channelSourcePropertiesSchema,
  channelDestinationPropertiesSchema,
} from '../channel-connector.schema.js';

describe('channelSourcePropertiesSchema', () => {
  it('accepts the id deploy sets, and the batch switch', () => {
    expect(channelSourcePropertiesSchema.parse({ channelId: 'c1', processBatch: true })).toEqual({ channelId: 'c1', processBatch: true });
  });

  // The Mirth importer copied a Channel Reader's Mirth properties from 2026-03-03 to 2026-11-12.
  it('drops the Mirth keys the old importer copied and nothing read', () => {
    expect(channelSourcePropertiesSchema.parse({
      channelId: 'c1', pluginProperties: '', sourceConnectorProperties: { responseVariable: 'None' }, responseConnectorProperties: {},
    })).toEqual({ channelId: 'c1' });
  });

  it.each([
    [{}, 'channelId'],
    [{ channelId: ' ' }, 'channelId'],
    [{ channelId: 'c1', processBatch: 'yes' }, 'processBatch'],
    [{ channelId: 'c1', targetChannelId: 'c2' }, 'targetChannelId'],
  ])('rejects %j, naming %s', (props, key) => {
    const result = channelSourcePropertiesSchema.safeParse(props);
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(JSON.stringify(result.error.issues)).toContain(key);
  });
});

describe('channelDestinationPropertiesSchema', () => {
  it('needs a target and fills waitForResponse', () => {
    expect(channelDestinationPropertiesSchema.parse({ targetChannelId: 'c2' })).toEqual({ targetChannelId: 'c2', waitForResponse: false });
  });

  // CHANNEL_DEST_DEFAULTS since 45fad27 (2026-03), a target picked; what the importer writes since ec89890.
  it.each([
    [{ targetChannelId: 'c2', waitForResponse: false }],
    [{ targetChannelId: '${route}', waitForResponse: true }],
    [{ targetChannelId: 'c2', waitForResponse: false, template: '${message.encodedData}' }],
  ])('accepts %j as it is', (saved) => {
    expect(channelDestinationPropertiesSchema.parse(saved)).toEqual(saved);
  });

  it('drops the Mirth keys the old importer copied and nothing read', () => {
    expect(channelDestinationPropertiesSchema.parse({
      targetChannelId: 'c2', waitForResponse: false, pluginProperties: '', destinationConnectorProperties: { queueEnabled: 'false' },
      queueConnectorProperties: {}, channelId: 'c2', channelTemplate: '${message.encodedData}', mapVariables: '',
    })).toEqual({ targetChannelId: 'c2', waitForResponse: false });
  });

  it.each([
    [{ targetChannelId: '' }, 'targetChannelId'],
    [{}, 'targetChannelId'],
    [{ targetChannelId: 'c2', waitForResponse: 'true' }, 'waitForResponse'],
    [{ targetChannelId: 'c2', waitForReply: true }, 'waitForReply'],
  ])('rejects %j, naming %s', (props, key) => {
    const result = channelDestinationPropertiesSchema.safeParse(props);
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(JSON.stringify(result.error.issues)).toContain(key);
  });
});
