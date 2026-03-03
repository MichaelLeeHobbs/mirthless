// ===========================================
// HL7v2 Message Generator Tests
// ===========================================

import { describe, it, expect } from 'vitest';
import { generateHL7Messages } from '../hl7-generator.js';
import { Hl7Message } from '../hl7-message.js';

// ----- ADT^A01 -----

describe('generateHL7Messages — ADT_A01', () => {
  it('generates a single ADT^A01 message', () => {
    const messages = generateHL7Messages({ messageType: 'ADT_A01', seed: 42 });
    expect(messages).toHaveLength(1);
  });

  it('generated ADT^A01 parses correctly', () => {
    const messages = generateHL7Messages({ messageType: 'ADT_A01', seed: 42 });
    const parsed = Hl7Message.parse(messages[0]!);
    expect(parsed.get('MSH.9.1')).toBe('ADT');
    expect(parsed.get('MSH.9.2')).toBe('A01');
  });

  it('ADT^A01 contains required segments', () => {
    const messages = generateHL7Messages({ messageType: 'ADT_A01', seed: 42 });
    const parsed = Hl7Message.parse(messages[0]!);
    expect(parsed.getSegmentCount('MSH')).toBe(1);
    expect(parsed.getSegmentCount('EVN')).toBe(1);
    expect(parsed.getSegmentCount('PID')).toBe(1);
    expect(parsed.getSegmentCount('PV1')).toBe(1);
  });

  it('ADT^A01 has patient name in PID.5', () => {
    const messages = generateHL7Messages({ messageType: 'ADT_A01', seed: 42 });
    const parsed = Hl7Message.parse(messages[0]!);
    const pid5 = parsed.get('PID.5');
    expect(pid5).toBeTruthy();
    expect(pid5!.length).toBeGreaterThan(0);
  });
});

// ----- ORM^O01 -----

describe('generateHL7Messages — ORM_O01', () => {
  it('generates ORM^O01 with correct message type', () => {
    const messages = generateHL7Messages({ messageType: 'ORM_O01', seed: 100 });
    const parsed = Hl7Message.parse(messages[0]!);
    expect(parsed.get('MSH.9.1')).toBe('ORM');
    expect(parsed.get('MSH.9.2')).toBe('O01');
  });

  it('ORM^O01 contains ORC and OBR segments', () => {
    const messages = generateHL7Messages({ messageType: 'ORM_O01', seed: 100 });
    const parsed = Hl7Message.parse(messages[0]!);
    expect(parsed.getSegmentCount('ORC')).toBe(1);
    expect(parsed.getSegmentCount('OBR')).toBe(1);
  });
});

// ----- ORU^R01 -----

describe('generateHL7Messages — ORU_R01', () => {
  it('generates ORU^R01 with correct message type', () => {
    const messages = generateHL7Messages({ messageType: 'ORU_R01', seed: 200 });
    const parsed = Hl7Message.parse(messages[0]!);
    expect(parsed.get('MSH.9.1')).toBe('ORU');
    expect(parsed.get('MSH.9.2')).toBe('R01');
  });

  it('ORU^R01 contains OBX segment', () => {
    const messages = generateHL7Messages({ messageType: 'ORU_R01', seed: 200 });
    const parsed = Hl7Message.parse(messages[0]!);
    expect(parsed.getSegmentCount('OBX')).toBe(1);
  });
});

// ----- SIU^S12 -----

describe('generateHL7Messages — SIU_S12', () => {
  it('generates SIU^S12 with correct message type', () => {
    const messages = generateHL7Messages({ messageType: 'SIU_S12', seed: 300 });
    const parsed = Hl7Message.parse(messages[0]!);
    expect(parsed.get('MSH.9.1')).toBe('SIU');
    expect(parsed.get('MSH.9.2')).toBe('S12');
  });

  it('SIU^S12 contains SCH and AIG segments', () => {
    const messages = generateHL7Messages({ messageType: 'SIU_S12', seed: 300 });
    const parsed = Hl7Message.parse(messages[0]!);
    expect(parsed.getSegmentCount('SCH')).toBe(1);
    expect(parsed.getSegmentCount('AIG')).toBe(1);
  });
});

// ----- Count -----

describe('generateHL7Messages — count', () => {
  it('generates multiple messages', () => {
    const messages = generateHL7Messages({ messageType: 'ADT_A01', count: 5, seed: 42 });
    expect(messages).toHaveLength(5);
  });

  it('each generated message parses correctly', () => {
    const messages = generateHL7Messages({ messageType: 'ADT_A01', count: 10, seed: 42 });
    for (const msg of messages) {
      const parsed = Hl7Message.parse(msg);
      expect(parsed.get('MSH.9.1')).toBe('ADT');
    }
  });

  it('clamps count to 1 minimum', () => {
    const messages = generateHL7Messages({ messageType: 'ADT_A01', count: 0, seed: 42 });
    expect(messages).toHaveLength(1);
  });

  it('clamps count to 100 maximum', () => {
    const messages = generateHL7Messages({ messageType: 'ADT_A01', count: 200, seed: 42 });
    expect(messages).toHaveLength(100);
  });
});

// ----- Seed determinism -----

describe('generateHL7Messages — seed determinism', () => {
  it('same seed produces same output', () => {
    const a = generateHL7Messages({ messageType: 'ADT_A01', count: 3, seed: 12345 });
    const b = generateHL7Messages({ messageType: 'ADT_A01', count: 3, seed: 12345 });
    expect(a).toEqual(b);
  });

  it('different seeds produce different output', () => {
    const a = generateHL7Messages({ messageType: 'ADT_A01', seed: 1 });
    const b = generateHL7Messages({ messageType: 'ADT_A01', seed: 2 });
    expect(a[0]).not.toBe(b[0]);
  });
});

// ----- Common fields -----

describe('generateHL7Messages — common fields', () => {
  it('MSH.12 version is 2.5.1', () => {
    const messages = generateHL7Messages({ messageType: 'ADT_A01', seed: 42 });
    const parsed = Hl7Message.parse(messages[0]!);
    expect(parsed.get('MSH.12')).toBe('2.5.1');
  });

  it('MSH.11 processing ID is P', () => {
    const messages = generateHL7Messages({ messageType: 'ADT_A01', seed: 42 });
    const parsed = Hl7Message.parse(messages[0]!);
    expect(parsed.get('MSH.11')).toBe('P');
  });

  it('MSH.3 sending application is MIRTHLESS', () => {
    const messages = generateHL7Messages({ messageType: 'ADT_A01', seed: 42 });
    const parsed = Hl7Message.parse(messages[0]!);
    expect(parsed.get('MSH.3')).toBe('MIRTHLESS');
  });

  it('MSH.10 control ID is non-empty', () => {
    const messages = generateHL7Messages({ messageType: 'ADT_A01', seed: 42 });
    const parsed = Hl7Message.parse(messages[0]!);
    expect(parsed.get('MSH.10')).toBeTruthy();
  });
});
