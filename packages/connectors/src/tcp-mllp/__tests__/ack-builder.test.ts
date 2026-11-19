import { describe, it, expect } from 'vitest';
import { buildAck, classifyAckResponse, controlIdOf } from '../ack-builder.js';

const VALID_HL7 = 'MSH|^~\\&|SEND|FAC|RECV|RFAC|20240101||ADT^A01|CTRL42|P|2.5.1';

describe('buildAck', () => {
  it('builds an AA ACK echoing the control id and swapping sender/receiver', () => {
    const ack = buildAck(VALID_HL7, 'AA');
    expect(ack.startsWith('MSH')).toBe(true);
    expect(ack).toContain('MSA|AA|CTRL42');
    expect(ack).toContain('RECV|RFAC|SEND|FAC');
  });

  it('builds an AE NAK for a processing error', () => {
    expect(buildAck(VALID_HL7, 'AE')).toContain('MSA|AE|CTRL42');
  });

  it('builds an AR NAK for a rejected message', () => {
    expect(buildAck(VALID_HL7, 'AR')).toContain('MSA|AR|CTRL42');
  });

  it('never frames arbitrary content — falls back to a well-formed ACK for non-HL7 input', () => {
    const ack = buildAck('/var/data/out/patient-123.txt', 'AA');
    expect(ack.startsWith('MSH')).toBe(true);
    expect(ack).toContain('MSA|AA|');
    expect(ack).not.toContain('/var/data/out');
  });

  it('answers a message with an invalid MSH-2 with the fallback ACK, not one built from misread delimiters', () => {
    const ack = buildAck('MSH|^~|SEND|FAC|RECV|RFAC|20240101||ADT^A01|CTRL42|P|2.5.1', 'AE');
    expect(ack).toMatch(/^MSH\|\^~\\&\|\|\|\|\|/);
    expect(ack).toContain('MSA|AE|GF');
  });

  it('acknowledges a sender whose MSH-2 has no subcomponent character with its own encoding characters', () => {
    const ack = buildAck('MSH|^~\\|SEND|FAC|RECV|RFAC|20240101||ADT^A01|CTRL42|P|2.3', 'AA');
    expect(ack.startsWith('MSH|^~\\|RECV|RFAC|SEND|FAC|')).toBe(true);
    expect(ack.split('\r')[1]).toBe('MSA|AA|CTRL42');
  });

  it('includes MSA-3 diagnostic text when provided', () => {
    expect(buildAck(VALID_HL7, 'AE', 'DB timeout')).toContain('MSA|AE|CTRL42|DB timeout');
  });
});

describe('classifyAckResponse', () => {
  it('accepts AA', () => {
    expect(classifyAckResponse('MSH|^~\\&|A\rMSA|AA|1').accepted).toBe(true);
  });

  it('accepts CA (commit accept)', () => {
    expect(classifyAckResponse('MSH|^~\\&|A\rMSA|CA|1').accepted).toBe(true);
  });

  it('rejects AE with a descriptive error', () => {
    const c = classifyAckResponse('MSH|^~\\&|A\rMSA|AE|1|bad field');
    expect(c.accepted).toBe(false);
    expect(c.errorMessage).toContain('AE');
    expect(c.errorMessage).toContain('bad field');
  });

  it('rejects AR', () => {
    expect(classifyAckResponse('MSH|^~\\&|A\rMSA|AR|1').accepted).toBe(false);
  });

  it('rejects an unparseable response with a clear message', () => {
    const c = classifyAckResponse('total-garbage');
    expect(c.accepted).toBe(false);
    expect(c.errorMessage).toContain('Unparseable');
  });

  it('tolerates a bare MSA segment without an MSH', () => {
    expect(classifyAckResponse('MSA|AA|123').accepted).toBe(true);
  });
});

describe('fallback ACK', () => {
  it('uses a control id that fits the 20 character limit of MSH-10', () => {
    const ack = buildAck('not hl7 at all', 'AE');
    const controlId = ack.split('\r')[0]!.split('|')[9]!;
    expect(controlId.length).toBeGreaterThan(0);
    expect(controlId.length).toBeLessThanOrEqual(20);
    expect(ack.split('\r')[1]!.split('|')[2]).toBe(controlId);
  });

  it('stamps MSH-7 with its UTC offset', () => {
    const ack = buildAck('not hl7 at all', 'AE');
    expect(ack.split('\r')[0]!.split('|')[6]).toMatch(/^\d{14}[+-]\d{4}$/);
  });

  it('escapes delimiters in the text', () => {
    const ack = buildAck('not hl7 at all', 'AE', 'bad|text\rMSA|AA');
    const lines = ack.split('\r');
    expect(lines).toHaveLength(2);
    expect(lines[1]!.split('|')).toHaveLength(4);
  });
});

describe('classifyAckResponse control id check', () => {
  const ack = (code: string, id: string): string =>
    `MSH|^~\\&|R|F|S|F|20260101||ACK|X1|P|2.5.1\rMSA|${code}|${id}`;
  const sent = (id: string, encodingChars = '^~\\&'): ReturnType<typeof controlIdOf> =>
    controlIdOf(`MSH|${encodingChars}|S|F|R|F|20260101||ADT^A01|${id}|P|2.5.1`);

  it('accepts a positive acknowledgement for the message that was sent', () => {
    expect(classifyAckResponse(ack('AA', 'CTRL1'), sent('CTRL1')).accepted).toBe(true);
  });

  it('rejects a positive acknowledgement for a different message', () => {
    const result = classifyAckResponse(ack('AA', 'OTHER'), sent('CTRL1'));
    expect(result.accepted).toBe(false);
    expect(result.errorMessage).toContain('OTHER');
    expect(result.errorMessage).toContain('CTRL1');
  });

  describe('a control id with components (#197)', () => {
    const sentId = sent('ID^X');

    it('accepts an acknowledgement that echoes the whole control id', () => {
      expect(classifyAckResponse(ack('AA', 'ID^X'), sentId).accepted).toBe(true);
    });

    it('accepts one that echoes only its first component, so the message is not resent', () => {
      expect(classifyAckResponse(ack('AA', 'ID'), sentId).accepted).toBe(true);
    });

    it('rejects one whose later component differs', () => {
      expect(classifyAckResponse(ack('AA', 'ID^Y'), sentId).accepted).toBe(false);
    });

    it('rejects one for another message', () => {
      expect(classifyAckResponse(ack('AA', 'OTHER'), sentId).accepted).toBe(false);
    });

    it('takes the first component with the sent message\'s separators, which encoded the id', () => {
      // Sent with @ as the component separator; the partner answers with the standard ^.
      expect(classifyAckResponse(ack('AA', 'ID'), sent('ID@X', '@~\\&')).accepted).toBe(true);
      expect(classifyAckResponse(ack('AA', 'ID@X'), sent('ID@X', '@~\\&')).accepted).toBe(true);
      expect(classifyAckResponse(ack('AA', 'ID@Y'), sent('ID@X', '@~\\&')).accepted).toBe(false);
      // Sent with ^; the partner answers with @ as its own component separator.
      const atAck = (id: string): string => `MSH|@~\\&|R|F|S|F|20260101||ACK|X1|P|2.5.1\rMSA|AA|${id}`;
      expect(classifyAckResponse(atAck('ID'), sentId).accepted).toBe(true);
    });

    it('compares a bare MSA with no MSH the same way', () => {
      expect(classifyAckResponse('MSA|AA|ID', sentId).accepted).toBe(true);
      expect(classifyAckResponse('MSA|AA|IDX', sentId).accepted).toBe(false);
    });

    it('keeps the subcomponents of the first component', () => {
      expect(sent('ID&1^X')).toEqual({ whole: 'ID&1^X', first: 'ID&1' });
    });
  });

  it('accepts the acknowledgement createAck builds for the message sent', () => {
    const sent = 'MSH|^~\\&|S|F|R|F|20260101||ADT^A01|ID^X|P|2.5.1';
    expect(classifyAckResponse(buildAck(sent, 'AA'), controlIdOf(sent)).accepted).toBe(true);
  });

  it('accepts when the acknowledgement carries no control id', () => {
    expect(classifyAckResponse(ack('AA', ''), sent('CTRL1')).accepted).toBe(true);
  });

  it('accepts when the sent content had no control id to compare', () => {
    expect(sent('')).toBeUndefined();
    expect(controlIdOf('not hl7')).toBeUndefined();
    expect(classifyAckResponse(ack('AA', 'ANY')).accepted).toBe(true);
    expect(classifyAckResponse(ack('AA', 'ANY'), sent('')).accepted).toBe(true);
  });
});
