// ===========================================
// HL7v2 ACK Tests
// ===========================================

import { describe, it, expect, vi, afterEach } from 'vitest';
import { Hl7Message } from '../hl7-message.js';
import { createAck, newControlId } from '../hl7-ack.js';

// ----- Helpers -----

const ADT_A01 = [
  'MSH|^~\\&|SENDER|SFAC|RECV|RFAC|20260101120000||ADT^A01|MSG001|P|2.5.1',
  'PID|1||12345^^^MRN||Doe^John||19800101|M',
].join('\r');

function parseAck(ackStr: string): Hl7Message {
  return Hl7Message.parse(ackStr);
}

// ----- Tests -----

describe('createAck', () => {
  it('generates AA ack with swapped sender/receiver', () => {
    const original = Hl7Message.parse(ADT_A01);
    const ackStr = createAck(original, { ackCode: 'AA' });
    const ack = parseAck(ackStr);

    // Sender/receiver swapped
    expect(ack.get('MSH.3')).toBe('RECV');
    expect(ack.get('MSH.4')).toBe('RFAC');
    expect(ack.get('MSH.5')).toBe('SENDER');
    expect(ack.get('MSH.6')).toBe('SFAC');

    expect(ack.get('MSH.9.1')).toBe('ACK');
    expect(ack.get('MSA.2')).toBe('MSG001');
  });

  it('gives the ACK a control id of its own that fits MSH-10 (#187)', () => {
    const ack = parseAck(createAck(Hl7Message.parse(ADT_A01), { ackCode: 'AA' }));
    const id = ack.get('MSH.10')!;
    expect(id).not.toBe('MSG001');
    expect(id).toMatch(/^GF\d+$/);
    expect(id.length).toBeLessThanOrEqual(20);
  });

  it('includes MSA with ack code and control ID', () => {
    const original = Hl7Message.parse(ADT_A01);
    const ackStr = createAck(original, { ackCode: 'AA' });

    // Parse the raw string to check MSA
    const segments = ackStr.split('\r');
    const msaParts = segments[1]!.split('|');
    expect(msaParts[0]).toBe('MSA');
    expect(msaParts[1]).toBe('AA');
    expect(msaParts[2]).toBe('MSG001');
  });

  it('echoes the whole inbound MSH-10 in MSA-2, not just its first component (#187)', () => {
    const original = Hl7Message.parse('MSH|^~\\&|S|SF|R|RF|20260101||ADT^A01|ID^X\\T\\Y|P|2.5.1');
    const ack = Hl7Message.parse(createAck(original, { ackCode: 'AA' }));
    expect(ack.getRaw('MSA.2')).toBe('ID^X\\T\\Y');
  });

  it('includes text message in MSA for AE ack', () => {
    const original = Hl7Message.parse(ADT_A01);
    const ackStr = createAck(original, { ackCode: 'AE', textMessage: 'Validation failed' });

    const segments = ackStr.split('\r');
    const msaParts = segments[1]!.split('|');
    expect(msaParts[1]).toBe('AE');
    expect(msaParts[3]).toBe('Validation failed');
  });

  it('includes ERR segment for AR ack with error code', () => {
    const original = Hl7Message.parse(ADT_A01);
    const ackStr = createAck(original, { ackCode: 'AR', errorCode: '207' });

    const segments = ackStr.split('\r');
    expect(segments).toHaveLength(3);
    const errParts = segments[2]!.split('|');
    expect(errParts[0]).toBe('ERR');
    expect(errParts[1]).toBe('207');
  });

  it('preserves encoding characters from original', () => {
    const original = Hl7Message.parse(ADT_A01);
    const ackStr = createAck(original, { ackCode: 'AA' });
    const ack = parseAck(ackStr);

    expect(ack.encoding.fieldSep).toBe('|');
    expect(ack.encoding.componentSep).toBe('^');
  });

  it('preserves HL7 version from original', () => {
    const original = Hl7Message.parse(ADT_A01);
    const ackStr = createAck(original, { ackCode: 'AA' });
    const ack = parseAck(ackStr);

    expect(ack.get('MSH.12')).toBe('2.5.1');
  });

  it('does not mutate original message', () => {
    const original = Hl7Message.parse(ADT_A01);
    const originalStr = original.toString();

    createAck(original, { ackCode: 'AA' });

    expect(original.toString()).toBe(originalStr);
  });
});

describe('createAck text escaping', () => {
  const ORIGINAL = 'MSH|^~\\&|SEND|FAC|RECV|FAC|20260101120000||ADT^A01|CTRL1|P|2.5.1\rPID|1||123';

  it('escapes delimiters in the MSA text so it stays one field', () => {
    const ack = createAck(Hl7Message.parse(ORIGINAL), { ackCode: 'AE', textMessage: 'Bad value a|b^c & d\rnext line' });
    const parsed = Hl7Message.parse(ack);

    expect(parsed.get('MSA.1')).toBe('AE');
    expect(parsed.get('MSA.2')).toBe('CTRL1');
    expect(ack.split('\r')).toHaveLength(2);
    expect(ack.split('\r')[1]!.split('|')).toHaveLength(4);
    expect(ack).toContain('a\\F\\b\\S\\c \\T\\ d\\X0D\\next line');
  });

  it('escapes delimiters in the ERR code', () => {
    const ack = createAck(Hl7Message.parse(ORIGINAL), { ackCode: 'AR', errorCode: 'x|y' });
    expect(ack.split('\r')[2]).toBe('ERR|x\\F\\y');
  });
});

describe('createAck with composite header fields', () => {
  it('swaps the whole sending and receiving application and facility, not just the first component', () => {
    const original = Hl7Message.parse('MSH|^~\\&|LAB^1.2.3^ISO|FAC^4.5^ISO|EHR^9.9^ISO|HOSP^8.8^ISO|20260101||ORU^R01|42|P^T|2.5');

    const ack = createAck(original, { ackCode: 'AA' });

    expect(ack.split('\r')[0]).toMatch(/^MSH\|\^~\\&\|EHR\^9\.9\^ISO\|HOSP\^8\.8\^ISO\|LAB\^1\.2\.3\^ISO\|FAC\^4\.5\^ISO\|/);
    expect(ack.split('\r')[0]).toContain('|P^T|2.5');
    expect(ack.split('\r')[1]).toBe('MSA|AA|42');
  });
});

describe('newControlId', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('gives different ids to ACKs made in the same millisecond', () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_800_000_000_000);
    const ids = new Set([newControlId(), newControlId(), newControlId()]);
    expect(ids.size).toBe(3);
    for (const id of ids) {
      expect(id.startsWith('GF1800000000000')).toBe(true);
      expect(id.length).toBe(20);
    }
  });
});
