// ===========================================
// HL7v2 Path Tests
// ===========================================

import { describe, it, expect } from 'vitest';
import { parsePath } from '../hl7-path.js';

describe('parsePath', () => {
  it('parses simple path with defaults', () => {
    const p = parsePath('PID.3');

    expect(p.segment).toBe('PID');
    expect(p.segmentIndex).toBe(1);
    expect(p.field).toBe(3);
    expect(p.fieldRepetition).toBe(1);
    expect(p.component).toBe(1);
    expect(p.subComponent).toBe(1);
  });

  it('parses full path with all indices', () => {
    const p = parsePath('PID[2].3[1].1.1');

    expect(p.segment).toBe('PID');
    expect(p.segmentIndex).toBe(2);
    expect(p.field).toBe(3);
    expect(p.fieldRepetition).toBe(1);
    expect(p.component).toBe(1);
    expect(p.subComponent).toBe(1);
  });

  it('parses field repetition', () => {
    const p = parsePath('PID.3[2].1.1');

    expect(p.fieldRepetition).toBe(2);
  });

  it('parses segment-only path', () => {
    const p = parsePath('MSH');

    expect(p.segment).toBe('MSH');
    expect(p.segmentIndex).toBe(1);
    expect(p.field).toBeUndefined();
  });

  it('parses segment with numbers like ZZ1', () => {
    const p = parsePath('ZZ1.5');

    expect(p.segment).toBe('ZZ1');
    expect(p.field).toBe(5);
  });

  it('auto-resolves missing indices when autoResolve=true', () => {
    const p = parsePath('OBX.5', true);

    expect(p.segmentIndex).toBe(1);
    expect(p.fieldRepetition).toBe(1);
    expect(p.component).toBe(1);
    expect(p.subComponent).toBe(1);
  });

  it('does not auto-resolve when autoResolve=false', () => {
    const p = parsePath('OBX.5', false);

    expect(p.segmentIndex).toBe(1); // Still 1 because field is present
    expect(p.field).toBe(5);
    expect(p.fieldRepetition).toBeUndefined();
    expect(p.component).toBeUndefined();
    expect(p.subComponent).toBeUndefined();
  });

  it('throws for empty string', () => {
    expect(() => parsePath('')).toThrow('non-empty string');
  });

  it('throws for invalid path format', () => {
    expect(() => parsePath('invalid')).toThrow('Invalid HL7 path');
    expect(() => parsePath('AB.3')).toThrow('Invalid HL7 path');
    expect(() => parsePath('123.3')).toThrow('Invalid HL7 path');
  });

  it('handles component without subcomponent', () => {
    const p = parsePath('PID.3.1');

    expect(p.component).toBe(1);
    expect(p.subComponent).toBe(1); // auto-resolved
  });
});
