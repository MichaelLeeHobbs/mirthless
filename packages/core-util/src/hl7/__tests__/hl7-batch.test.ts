// ===========================================
// HL7v2 batch splitting tests
// ===========================================

import { describe, it, expect } from 'vitest';
import { splitHl7Batch } from '../hl7-batch.js';

const MSG1 = 'MSH|^~\\&|LAB|A|VNS|V|20261110||ORU^R01|1|P|2.5\rPID|||MRN1';
const MSG2 = 'MSH|^~\\&|LAB|A|VNS|V|20261110||ORU^R01|2|P|2.5\rPID|||MRN2\rOBX|1|NM|GLU||90';

describe('splitHl7Batch', () => {
  it('gives one message per MSH with the segments that follow it', () => {
    expect(splitHl7Batch(`${MSG1}\r${MSG2}`)).toEqual([MSG1, MSG2]);
  });

  it('drops the file and batch envelope and blank lines, whatever the line endings', () => {
    const batch = ['FHS|^~\\&|LAB', 'BHS|^~\\&|LAB', ...MSG1.split('\r'), '', ...MSG2.split('\r'), 'BTS|2', 'FTS|1'].join('\r\n');
    expect(splitHl7Batch(batch)).toEqual([MSG1, MSG2]);
  });

  it('refuses a segment before the first MSH rather than losing it', () => {
    expect(() => splitHl7Batch(`PID|||ORPHAN\r${MSG1}`)).toThrow('PID segment before its first MSH');
  });

  it('gives nothing for an empty batch', () => {
    expect(splitHl7Batch('\r\n')).toEqual([]);
  });
});
