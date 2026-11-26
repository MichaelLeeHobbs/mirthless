import { describe, it, expect } from 'vitest';
import { batchRefusal } from '../batch-source.js';

const channel = (sourceConnectorType: string, props: Record<string, unknown> = {}, inboundDataType = 'HL7V2') =>
  ({ sourceConnectorType, inboundDataType, sourceConnectorProperties: { processBatch: true, ...props } });

describe('batchRefusal', () => {
  it.each([
    ['TCP_MLLP', {}],
    ['FILE', { binary: false }],
    ['SFTP', {}],
    ['HTTP', { bodyCharset: 'utf-8' }],
    ['KAFKA', { charset: 'latin1' }],
    ['AMQP', {}],
    ['JAVASCRIPT', {}],
    ['CHANNEL', {}],
  ])('lets a %s source that hands over text split HL7 v2 batches', (type, props) => {
    expect(batchRefusal(channel(type, props))).toBeNull();
  });

  it.each([
    ['DATABASE', {}, 'a Database source hands over each row as a JSON object'],
    ['DICOM', {}, 'a DICOM source hands over the path of a stored file'],
    ['EMAIL', {}, 'an Email source hands over the whole email, headers first'],
    ['FILE', { binary: true }, 'a File source with binary on hands over each file as base64'],
    ['HTTP', { bodyCharset: 'base64' }, 'this source hands over its content as base64'],
    ['KAFKA', { charset: 'base64' }, 'this source hands over its content as base64'],
    ['AMQP', { charset: 'base64' }, 'this source hands over its content as base64'],
  ])('refuses a %s source whose content is never an HL7 batch (#441)', (type, props, why) => {
    expect(batchRefusal(channel(type, props))).toBe(`batch processing splits HL7 v2 text, and ${why}`);
  });

  it('refuses a data type it cannot split', () => {
    expect(batchRefusal(channel('TCP_MLLP', {}, 'JSON'))).toBe('batch processing is only supported for HL7V2, not JSON');
  });

  it('names the source first, which no data type can make readable', () => {
    expect(batchRefusal(channel('DATABASE', {}, 'JSON'))).toContain('Database source');
  });

  it('refuses nothing when batch processing is off', () => {
    expect(batchRefusal({ ...channel('DATABASE', {}, 'JSON'), sourceConnectorProperties: { processBatch: false } })).toBeNull();
    expect(batchRefusal({ ...channel('DICOM'), sourceConnectorProperties: {} })).toBeNull();
  });
});
