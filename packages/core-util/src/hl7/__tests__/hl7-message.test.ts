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

describe('delete removes everything at the depth the path names', () => {
  const RAW = [
    'MSH|^~\\&|A|B|C|D|20260101||ADT^A01|1|P|2.5',
    'PID|1||111^^^MRN~222^^^SSN||DOE^JOHN^Q&JR||19800101|M|||1 MAIN ST^APT 2^BOSTON^MA^02134',
  ].join('\r');

  it('removes a whole composite field, not just its first component', () => {
    const msg = Hl7Message.parse(RAW);
    msg.delete('PID.5');

    expect(msg.get('PID.5')).toBeUndefined();
    expect(msg.get('PID.5.2')).toBeUndefined();
    expect(msg.getSegmentString('PID')).toBe('PID|1||111^^^MRN~222^^^SSN||||19800101|M|||1 MAIN ST^APT 2^BOSTON^MA^02134');
  });

  it('removes every repetition of a repeating field', () => {
    const msg = Hl7Message.parse(RAW);
    msg.delete('PID.3');

    expect(msg.toString()).not.toContain('111');
    expect(msg.toString()).not.toContain('222');
  });

  it('removes a whole address', () => {
    const msg = Hl7Message.parse(RAW);
    msg.delete('PID.11');

    expect(msg.getSegmentString('PID')).toBe('PID|1||111^^^MRN~222^^^SSN||DOE^JOHN^Q&JR||19800101|M');
  });

  it('removes one repetition and leaves the others', () => {
    const msg = Hl7Message.parse(RAW);
    msg.delete('PID.3[2]');

    expect(msg.get('PID.3[1].1')).toBe('111');
    expect(msg.get('PID.3[2].1')).toBeUndefined();
    expect(msg.toString()).not.toContain('SSN');
  });

  it('removes one component, including its subcomponents', () => {
    const msg = Hl7Message.parse(RAW);
    msg.delete('PID.5.3');

    expect(msg.getSegmentString('PID')).toContain('|DOE^JOHN|');
  });

  it('removes one subcomponent and leaves its siblings', () => {
    const msg = Hl7Message.parse(RAW);
    msg.delete('PID.5.3.2');

    expect(msg.getSegmentString('PID')).toContain('|DOE^JOHN^Q|');
  });

  it('removes a component of a named repetition', () => {
    const msg = Hl7Message.parse(RAW);
    msg.delete('PID.3[2].4');

    expect(msg.getSegmentString('PID')).toContain('|111^^^MRN~222|');
  });

  it.each(['PID.40', 'PID.3[9]', 'PID.5.9', 'PID.5.3.9', 'PID[2].5', 'ZZZ.1.1'])(
    'does nothing for %s, which is not in the message',
    (path) => {
      const msg = Hl7Message.parse(RAW);
      msg.delete(path);
      expect(msg.toString()).toBe(RAW);
    },
  );
});

describe('parse accepts the line endings real feeds use', () => {
  const SEGMENTS = ['MSH|^~\\&|A|B|C|D|20260101||ADT^A01|1|P|2.5', 'PID|1||000123||DOE^JOHN', 'PV1|1|I'];

  it.each([
    ['carriage return (the standard)', '\r'],
    ['CRLF (Windows files)', '\r\n'],
    ['line feed (Unix files)', '\n'],
  ])('reads segments separated by %s', (_name, separator) => {
    const msg = Hl7Message.parse(SEGMENTS.join(separator));

    expect(msg.get('MSH.12')).toBe('2.5');
    expect(msg.get('PID.5.2')).toBe('JOHN');
    expect(msg.get('PV1.2')).toBe('I');
    expect(msg.getSegmentCount('PID')).toBe(1);
  });

  it('reads a message with mixed line endings and a trailing newline', () => {
    const msg = Hl7Message.parse(`${SEGMENTS[0]!}\r\n${SEGMENTS[1]!}\n${SEGMENTS[2]!}\r\r\n`);

    expect(msg.get('PV1.2')).toBe('I');
    expect(msg.toString()).toBe(SEGMENTS.join('\r'));
  });

  it('always writes the standard carriage return', () => {
    expect(Hl7Message.parse(SEGMENTS.join('\n')).toString()).toBe(SEGMENTS.join('\r'));
  });

  it('ignores a byte order mark and leading blank lines', () => {
    const msg = Hl7Message.parse(`${String.fromCharCode(0xFEFF)}\r\n  ${SEGMENTS.join('\r')}`);

    expect(msg.messageControlId).toBe('1');
    expect(msg.get('PID.3')).toBe('000123');
  });

  it('keeps a line feed that is inside a field when segments end in carriage returns', () => {
    // Some senders put raw line breaks in free text. With CR segment ends the
    // LF can only be field content, so it must not start a new segment.
    const msg = Hl7Message.parse(`${SEGMENTS[0]!}\rNTE|1||line one\nline two\r${SEGMENTS[2]!}`);

    expect(msg.get('NTE.3')).toBe('line one\nline two');
    expect(msg.getSegmentCount('PV1')).toBe(1);
  });

  it('rejects text that is not an HL7 message', () => {
    expect(() => Hl7Message.parse('PID|1')).toThrow('HL7 message must start with MSH');
    expect(() => Hl7Message.parse('   ')).toThrow('HL7 message must start with MSH');
  });
});

describe('Hl7Message escaping', () => {
  const RAW = 'MSH|^~\\&|APP|FAC|||20260101||ORU^R01|C1|P|2.5.1\rOBX|1|TX|NOTE||Smith \\T\\ Sons\\F\\Ltd';

  it('get returns the field as encoded in the message', () => {
    expect(Hl7Message.parse(RAW).get('OBX.5')).toBe('Smith \\T\\ Sons\\F\\Ltd');
  });

  it('getText returns the decoded text', () => {
    expect(Hl7Message.parse(RAW).getText('OBX.5')).toBe('Smith & Sons|Ltd');
  });

  it('getText is undefined for a missing path', () => {
    expect(Hl7Message.parse(RAW).getText('ZZZ.1')).toBeUndefined();
  });

  it('setText encodes every delimiter so the value stays one field', () => {
    const msg = Hl7Message.parse(RAW);
    msg.setText('OBX.5', 'a|b^c&d~e\\f\r\ng');

    const out = msg.toString();
    expect(out.split('\r')).toHaveLength(2);
    expect(Hl7Message.parse(out).getText('OBX.5')).toBe('a|b^c&d~e\\f\r\ng');
    expect(Hl7Message.parse(out).get('OBX.6')).toBeUndefined();
  });

  it('set keeps component separators (a composite can be set in one call)', () => {
    const msg = Hl7Message.parse(RAW);
    msg.set('OBX.3', 'CODE^Text^L');
    expect(Hl7Message.parse(msg.toString()).get('OBX.3.2')).toBe('Text');
  });

  it('set never lets a value add a field or a segment', () => {
    const msg = Hl7Message.parse(RAW);
    msg.set('OBX.5', 'one|two\rPID|1||999\nZZZ|x');

    const out = msg.toString();
    expect(out.split('\r')).toHaveLength(2);
    expect(Hl7Message.parse(out).getSegmentCount('PID')).toBe(0);
    expect(Hl7Message.parse(out).getText('OBX.5')).toBe('one|two\rPID|1||999\nZZZ|x');
  });
});

describe('Hl7Message MSH-2', () => {
  it('keeps the truncation character of HL7 2.7 and later', () => {
    const raw = 'MSH|^~\\&#|APP|FAC|||20260101||ADT^A01|C1|P|2.7\rPID|1';
    const msg = Hl7Message.parse(raw);

    expect(msg.get('MSH.2')).toBe('^~\\&#');
    expect(msg.get('MSH.3')).toBe('APP');
    expect(msg.toString()).toBe(raw);
  });
});
