// ===========================================
// Bridge Functions Tests
// ===========================================

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createBridgeFunctions, type BridgeFunctions } from '../bridge-functions.js';
import { VmSandboxExecutor, DEFAULT_EXECUTION_OPTIONS, type CompiledScript } from '../sandbox-executor.js';
import { createSandboxContext } from '../sandbox-context.js';

// ----- Test Data -----

const HL7_ADT = [
  'MSH|^~\\&|SENDER|FACILITY|RECEIVER|FACILITY|20260228120000||ADT^A01|12345|P|2.5',
  'EVN|A01|20260228120000',
  'PID|||12345^^^MRN||DOE^JOHN||19800101|M',
  'PV1||I|ICU^101^A',
].join('\r');

// ----- Tests -----

describe('createBridgeFunctions', () => {
  let bridges: BridgeFunctions;

  beforeEach(() => {
    bridges = createBridgeFunctions();
  });

  it('returns object with parseHL7 and createACK', () => {
    expect(typeof bridges.parseHL7).toBe('function');
    expect(typeof bridges.createACK).toBe('function');
  });

  describe('parseHL7', () => {
    it('parses valid HL7 and returns proxy with get/set/delete/toString', () => {
      const proxy = bridges.parseHL7(HL7_ADT);
      expect(typeof proxy.get).toBe('function');
      expect(typeof proxy.set).toBe('function');
      expect(typeof proxy.delete).toBe('function');
      expect(typeof proxy.toString).toBe('function');
    });

    it('proxy.get reads field values correctly', () => {
      const proxy = bridges.parseHL7(HL7_ADT);
      // MSH.9 auto-resolves to first subcomponent (ADT), MSH.9.2 gets A01
      expect(proxy.get('MSH.9')).toBe('ADT');
      expect(proxy.get('MSH.9.2')).toBe('A01');
      expect(proxy.get('MSH.10')).toBe('12345');
      expect(proxy.get('PID.5')).toBe('DOE');
      expect(proxy.get('PID.3.1')).toBe('12345');
    });

    it('proxy.messageType returns MSH.9 first component', () => {
      const proxy = bridges.parseHL7(HL7_ADT);
      // messageType calls get('MSH.9') which auto-resolves to first subcomponent
      expect(proxy.messageType).toBe('ADT');
    });

    it('proxy.messageControlId returns MSH.10', () => {
      const proxy = bridges.parseHL7(HL7_ADT);
      expect(proxy.messageControlId).toBe('12345');
    });

    it('proxy.set modifies fields and toString reflects changes', () => {
      const proxy = bridges.parseHL7(HL7_ADT);
      proxy.set('PID.5.1', 'SMITH');
      const result = proxy.toString();
      expect(result).toContain('SMITH^JOHN');
      expect(result).not.toContain('DOE^JOHN');
    });

    it('proxy.delete removes a field', () => {
      const proxy = bridges.parseHL7(HL7_ADT);
      expect(proxy.get('PID.8')).toBe('M');
      proxy.delete('PID.8');
      expect(proxy.get('PID.8')).toBeUndefined();
    });

    it('proxy.getSegmentCount returns correct count', () => {
      const proxy = bridges.parseHL7(HL7_ADT);
      expect(proxy.getSegmentCount('PID')).toBe(1);
      expect(proxy.getSegmentCount('MSH')).toBe(1);
      expect(proxy.getSegmentCount('ZZZ')).toBe(0);
    });

    it('proxy.getSegmentString returns segment as string', () => {
      const proxy = bridges.parseHL7(HL7_ADT);
      const pidStr = proxy.getSegmentString('PID');
      expect(pidStr).toContain('PID');
      expect(pidStr).toContain('DOE^JOHN');
    });
  });

  describe('createACK', () => {
    it('generates AA ack from raw HL7', () => {
      const ack = bridges.createACK(HL7_ADT, 'AA');
      expect(ack).toContain('MSA|AA|12345');
      expect(ack).toContain('ACK');
    });

    it('generates AE ack from raw HL7', () => {
      const ack = bridges.createACK(HL7_ADT, 'AE');
      expect(ack).toContain('MSA|AE|12345');
    });

    it('includes text message in MSA segment', () => {
      const ack = bridges.createACK(HL7_ADT, 'AA', 'Message accepted');
      expect(ack).toContain('MSA|AA|12345|Message accepted');
    });
  });
});

describe('Bridge functions in sandbox', () => {
  let executor: VmSandboxExecutor;

  beforeEach(() => {
    executor = new VmSandboxExecutor();
  });

  afterEach(() => {
    executor.dispose();
  });

  it('sandbox script can call parseHL7() and use result.get()', async () => {
    const script: CompiledScript = {
      code: `var hl7 = parseHL7(rawData); return hl7.get('PID.5.1');`,
    };
    const context = createSandboxContext(HL7_ADT, HL7_ADT);

    const result = await executor.execute(script, context, DEFAULT_EXECUTION_OPTIONS);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.returnValue).toBe('DOE');
  });

  it('sandbox script can call createACK()', async () => {
    const script: CompiledScript = {
      code: `return createACK(rawData, 'AA');`,
    };
    const context = createSandboxContext(HL7_ADT, HL7_ADT);

    const result = await executor.execute(script, context, DEFAULT_EXECUTION_OPTIONS);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.returnValue).toContain('MSA|AA|12345');
  });

  it('sandbox script parses HL7, modifies field, returns toString (round-trip)', async () => {
    const script: CompiledScript = {
      code: `
        var parsed = parseHL7(rawData);
        parsed.set('PID.5.1', 'SMITH');
        return parsed.toString();
      `,
    };
    const context = createSandboxContext(HL7_ADT, HL7_ADT);

    const result = await executor.execute(script, context, DEFAULT_EXECUTION_OPTIONS);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const output = result.value.returnValue as string;
    expect(output).toContain('SMITH^JOHN');
    expect(output).not.toContain('DOE^JOHN');
  });
});
