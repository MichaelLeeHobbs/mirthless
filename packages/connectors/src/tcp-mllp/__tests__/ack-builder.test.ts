// ===========================================
// ACK Builder Tests
// ===========================================

import { describe, it, expect } from 'vitest';
import { buildAck, classifyAckResponse } from '../ack-builder.js';

const VALID_HL7 = 'MSH|^~\\&|SEND|FAC|RECV|RFAC|20240101||ADT^A01|CTRL42|P|2.5.1';

describe('buildAck', () => {
  it('builds an AA ACK echoing the control id and swapping sender/receiver', () => {
    const ack = buildAck(VALID_HL7, 'AA');
    expect(ack.startsWith('MSH')).toBe(true);
    expect(ack).toContain('MSA|AA|CTRL42');
    // Receiver becomes the sender in the ACK MSH.
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
