// ===========================================
// HL7v2 ACK Tests
// ===========================================

import { describe, it, expect } from 'vitest';
import { Hl7Message } from '../hl7-message.js';
import { createAck } from '../hl7-ack.js';

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

    // MSA segment
    expect(ack.get('MSH.9.1')).toBe('ACK');
    expect(ack.get('MSH.10')).toBe('MSG001');
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
