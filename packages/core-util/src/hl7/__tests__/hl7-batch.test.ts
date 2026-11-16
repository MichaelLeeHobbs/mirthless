// ===========================================
// HL7v2 batch splitting tests
// ===========================================

import { describe, it, expect } from 'vitest';
import { splitHl7Batch } from '../hl7-batch.js';
import { Hl7Message } from '../hl7-message.js';

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

  it('keeps a line feed inside free text in its field, as the parser does (#187)', () => {
    const raw = 'MSH|^~\\&|SND|SF|RCV|RF|20260101120000||ORU^R01|CTL1|P|2.5\rOBX|1|TX|NOTE||line one\nline two||||||F\r';
    const [message] = splitHl7Batch(raw);
    expect(message).toBe(raw.replace(/\r$/, ''));
    expect(Hl7Message.parse(message!).get('OBX.11')).toBe('F');
  });

  it('splits a batch whose every line ends in a bare line feed, envelope included', () => {
    const lines = ['FHS|^~\\&|LAB', 'BHS|^~\\&|LAB', ...MSG1.split('\r'), ...MSG2.split('\r'), 'BTS|2', 'FTS|1'];
    expect(splitHl7Batch(`${lines.join('\n')}\n`)).toEqual([MSG1, MSG2]);
  });

  it('keeps a free-text line feed when the batch uses bare line feeds', () => {
    const note = 'MSH|^~\\&|LAB|A|VNS|V|20261110||ORU^R01|3|P|2.5\nOBX|1|TX|NOTE||line one\nline two||||||F';
    const batch = ['BHS|^~\\&|LAB', note, 'BTS|1'].join('\n');
    const [message] = splitHl7Batch(batch);
    expect(Hl7Message.parse(message!).getRaw('OBX.5')).toBe('line one\nline two');
    expect(Hl7Message.parse(message!).get('OBX.11')).toBe('F');
  });

  it('uses the field separator the batch header declares', () => {
    const msg = 'MSH#^~\\&#LAB#A#VNS#V#20261110##ORU^R01#4#P#2.5\rOBX#1#TX#NOTE##a\nb######F';
    const [message] = splitHl7Batch(`BHS#^~\\&#LAB\n${msg}\nBTS#1`);
    expect(Hl7Message.parse(message!).get('OBX.11')).toBe('F');
  });

  it('gives nothing for an empty batch', () => {
    expect(splitHl7Batch('\r\n')).toEqual([]);
  });
});
