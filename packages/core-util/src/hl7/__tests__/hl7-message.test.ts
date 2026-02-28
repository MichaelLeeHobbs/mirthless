// ===========================================
// HL7v2 Message Tests
// ===========================================

import { describe, it, expect } from 'vitest';
import { Hl7Message } from '../hl7-message.js';

// ----- Sample Messages -----

const ADT_A01 = [
  'MSH|^~\\&|SENDER|SFAC|RECV|RFAC|20260101120000||ADT^A01|MSG001|P|2.5.1',
  'EVN|A01|20260101120000',
  'PID|1||12345^^^MRN||Doe^John^Q||19800101|M',
  'PV1|1|I|ICU^101^A',
].join('\r');

const MINIMAL_MSG = 'MSH|^~\\&';

const MULTI_OBX = [
  'MSH|^~\\&|LAB|LFAC|EMR|EFAC|20260101||ORU^R01|MSG002|P|2.5.1',
  'OBX|1|NM|WBC||7.5|10*3/uL',
  'OBX|2|NM|RBC||4.5|10*6/uL',
  'OBX|3|NM|HGB||14.2|g/dL',
].join('\r');

// ----- Tests -----

describe('Hl7Message.parse', () => {
  it('parses a simple ADT^A01 message', () => {
    const msg = Hl7Message.parse(ADT_A01);

    expect(msg.encoding.fieldSep).toBe('|');
    expect(msg.encoding.componentSep).toBe('^');
  });

  it('throws for non-MSH message', () => {
    expect(() => Hl7Message.parse('PID|1||12345')).toThrow('must start with MSH');
  });

  it('throws for empty input', () => {
    expect(() => Hl7Message.parse('')).toThrow('non-empty string');
  });

  it('parses minimal message (just MSH)', () => {
    const msg = Hl7Message.parse(MINIMAL_MSG);

    expect(msg.get('MSH.1')).toBe('|');
    expect(msg.get('MSH.2')).toBe('^~\\&');
  });
});

describe('get', () => {
  it('gets a simple field value', () => {
    const msg = Hl7Message.parse(ADT_A01);

    expect(msg.get('MSH.3')).toBe('SENDER');
    expect(msg.get('MSH.4')).toBe('SFAC');
    expect(msg.get('MSH.5')).toBe('RECV');
  });

  it('gets MSH.1 (field separator)', () => {
    const msg = Hl7Message.parse(ADT_A01);

    expect(msg.get('MSH.1')).toBe('|');
  });

  it('gets MSH.2 (encoding characters)', () => {
    const msg = Hl7Message.parse(ADT_A01);

    expect(msg.get('MSH.2')).toBe('^~\\&');
  });

  it('gets a component value', () => {
    const msg = Hl7Message.parse(ADT_A01);

    // PID.5 = Doe^John^Q → PID.5.1 = Doe, PID.5.2 = John
    expect(msg.get('PID.5.1')).toBe('Doe');
    expect(msg.get('PID.5.2')).toBe('John');
    expect(msg.get('PID.5.3')).toBe('Q');
  });

  it('gets a subcomponent value', () => {
    const msg = Hl7Message.parse(ADT_A01);

    // PID.3 = 12345^^^MRN → PID.3.4 = MRN
    expect(msg.get('PID.3.1.1')).toBe('12345');
    expect(msg.get('PID.3.4.1')).toBe('MRN');
  });

  it('returns undefined for non-existent path', () => {
    const msg = Hl7Message.parse(ADT_A01);

    expect(msg.get('ZZZ.1')).toBeUndefined();
    expect(msg.get('PID.99')).toBeUndefined();
    expect(msg.get('PID.3.99')).toBeUndefined();
  });

  it('gets message type convenience property', () => {
    const msg = Hl7Message.parse(ADT_A01);

    expect(msg.messageType).toBe('ADT');
  });

  it('gets message control ID convenience property', () => {
    const msg = Hl7Message.parse(ADT_A01);

    expect(msg.messageControlId).toBe('MSG001');
  });

  it('gets from specific segment index (OBX[2])', () => {
    const msg = Hl7Message.parse(MULTI_OBX);

    expect(msg.get('OBX[1].3')).toBe('WBC');
    expect(msg.get('OBX[2].3')).toBe('RBC');
    expect(msg.get('OBX[3].3')).toBe('HGB');
  });

  it('gets value from field with empty components', () => {
    const msg = Hl7Message.parse(ADT_A01);

    // PID.3 = 12345^^^MRN → PID.3.2 and PID.3.3 are empty
    expect(msg.get('PID.3.2')).toBe('');
    expect(msg.get('PID.3.3')).toBe('');
  });
});

describe('set', () => {
  it('modifies an existing value', () => {
    const msg = Hl7Message.parse(ADT_A01);
    msg.set('PID.5.1', 'Smith');

    expect(msg.get('PID.5.1')).toBe('Smith');
    expect(msg.get('PID.5.2')).toBe('John'); // Other components unchanged
  });

  it('sets a new value on an existing segment', () => {
    const msg = Hl7Message.parse(ADT_A01);
    msg.set('PID.30', 'NEW');

    expect(msg.get('PID.30')).toBe('NEW');
  });

  it('creates intermediate levels as needed', () => {
    const msg = Hl7Message.parse(MINIMAL_MSG);
    msg.set('PID.3.1.1', '12345');

    expect(msg.get('PID.3.1.1')).toBe('12345');
  });

  it('creates a new segment if it does not exist', () => {
    const msg = Hl7Message.parse(MINIMAL_MSG);
    msg.set('ZZ1.1', 'test');

    expect(msg.get('ZZ1.1')).toBe('test');
    expect(msg.getSegmentCount('ZZ1')).toBe(1);
  });
});

describe('delete', () => {
  it('deletes a field value', () => {
    const msg = Hl7Message.parse(ADT_A01);
    msg.delete('PID.5');

    expect(msg.get('PID.5')).toBeUndefined();
  });

  it('deletes an entire segment', () => {
    const msg = Hl7Message.parse(ADT_A01);
    msg.delete('EVN');

    expect(msg.getSegmentCount('EVN')).toBe(0);
  });

  it('does not throw for non-existent path', () => {
    const msg = Hl7Message.parse(ADT_A01);

    expect(() => msg.delete('ZZZ.1')).not.toThrow();
  });
});

describe('getSegmentString', () => {
  it('returns full segment as string', () => {
    const msg = Hl7Message.parse(ADT_A01);
    const evn = msg.getSegmentString('EVN');

    expect(evn).toBe('EVN|A01|20260101120000');
  });

  it('returns undefined for non-existent segment', () => {
    const msg = Hl7Message.parse(ADT_A01);

    expect(msg.getSegmentString('ZZZ')).toBeUndefined();
  });
});

describe('getSegmentCount', () => {
  it('counts multiple segments of same type', () => {
    const msg = Hl7Message.parse(MULTI_OBX);

    expect(msg.getSegmentCount('OBX')).toBe(3);
  });

  it('returns 0 for non-existent segment type', () => {
    const msg = Hl7Message.parse(ADT_A01);

    expect(msg.getSegmentCount('OBX')).toBe(0);
  });
});

describe('toString', () => {
  it('round-trips a parsed message back to original', () => {
    const msg = Hl7Message.parse(ADT_A01);

    expect(msg.toString()).toBe(ADT_A01);
  });

  it('round-trips minimal message', () => {
    const msg = Hl7Message.parse(MINIMAL_MSG);

    expect(msg.toString()).toBe(MINIMAL_MSG);
  });

  it('round-trips multi-OBX message', () => {
    const msg = Hl7Message.parse(MULTI_OBX);

    expect(msg.toString()).toBe(MULTI_OBX);
  });

  it('preserves custom delimiters', () => {
    const custom = 'MSH#@!$%#SENDER#SFAC#RECV#RFAC#20260101120000##ADT@A01#MSG001#P#2.5.1';
    const msg = Hl7Message.parse(custom);

    expect(msg.toString()).toBe(custom);
  });

  it('includes modifications in output', () => {
    const msg = Hl7Message.parse(ADT_A01);
    msg.set('PID.5.1', 'Smith');

    const output = msg.toString();
    expect(output).toContain('Smith^John^Q');
  });

  it('handles trailing segment delimiter', () => {
    const withTrailing = ADT_A01 + '\r';
    const msg = Hl7Message.parse(withTrailing);

    // Should parse without the trailing empty segment
    expect(msg.getSegmentCount('PV1')).toBe(1);
  });
});

describe('field repetitions', () => {
  it('parses and retrieves repetitions', () => {
    const raw = [
      'MSH|^~\\&|SENDER|SFAC|RECV|RFAC|20260101||ADT^A01|MSG001|P|2.5.1',
      'PID|1||ID1~ID2||Doe^John',
    ].join('\r');

    const msg = Hl7Message.parse(raw);

    expect(msg.get('PID.3[1].1.1')).toBe('ID1');
    expect(msg.get('PID.3[2].1.1')).toBe('ID2');
  });
});
