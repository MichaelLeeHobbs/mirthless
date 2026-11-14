// ===========================================
// Data type settings at deploy
// ===========================================

import { describe, it, expect } from 'vitest';
import { dataTypeOptionsFor, parsedOrRaw } from '../engine.js';
import type { ChannelDetail } from '../services/channel.service.js';

function channel(inboundDataType: string, inboundProperties: Record<string, unknown>, connectorId: string | null = null): ChannelDetail {
  return {
    name: 'Census',
    inboundDataType,
    transformers: [{ connectorId, inboundDataType, inboundProperties }],
  } as unknown as ChannelDetail;
}

describe('dataTypeOptionsFor', () => {
  it('reads the source transformer delimited settings, filling defaults', () => {
    const options = dataTypeOptionsFor(channel('DELIMITED', { delimited: { columnDelimiter: '|', columnNames: ['mrn'] } }));
    expect(options.delimited).toMatchObject({ columnDelimiter: '|', recordDelimiter: '\n', columnNames: ['mrn'] });
  });

  it('uses the defaults when the channel has no source transformer settings', () => {
    expect(dataTypeOptionsFor(channel('DELIMITED', {}, 'dest-1')).delimited).toMatchObject({ columnDelimiter: ',', columnNames: [] });
  });

  it('refuses to deploy settings that do not validate', () => {
    expect(() => dataTypeOptionsFor(channel('DELIMITED', { delimited: { columnDelimiter: '\n' } })))
      .toThrow(/Census: Delimited settings are invalid: Column and record delimiters must differ/);
  });

  it('has no settings for other data types', () => {
    expect(dataTypeOptionsFor(channel('HL7V2', { delimited: { columnDelimiter: '\n' } }))).toEqual({});
  });
});

describe('parsedOrRaw', () => {
  it('parses with the settings it is given, and falls back to the text when parsing fails', () => {
    const { delimited } = dataTypeOptionsFor(channel('DELIMITED', { delimited: { columnNames: ['mrn'] } }));
    expect(parsedOrRaw('1\n', 'DELIMITED', { delimited })).toEqual([{ mrn: '1' }]);
    expect(parsedOrRaw('"1', 'DELIMITED', { delimited })).toBe('"1');
  });
});
