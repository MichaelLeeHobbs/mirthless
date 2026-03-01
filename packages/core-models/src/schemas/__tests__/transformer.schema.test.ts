// ===========================================
// Transformer Schema Validation Tests
// ===========================================

import { describe, it, expect } from 'vitest';
import { transformerStepInputSchema, transformerInputSchema } from '../transformer.schema.js';

describe('transformerStepInputSchema', () => {
  it('accepts valid JavaScript step', () => {
    const result = transformerStepInputSchema.safeParse({
      type: 'JAVASCRIPT',
      script: 'msg.setField("PID.5", "DOE^JOHN");',
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.type).toBe('JAVASCRIPT');
    expect(result.data.script).toBe('msg.setField("PID.5", "DOE^JOHN");');
    expect(result.data.enabled).toBe(true);
  });

  it('accepts valid Mapper step', () => {
    const result = transformerStepInputSchema.safeParse({
      type: 'MAPPER',
      sourceField: 'msg["PID"]["PID.3"]["PID.3.1"]',
      targetField: 'tmp["patientId"]',
      mapping: 'COPY',
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.type).toBe('MAPPER');
    expect(result.data.sourceField).toBe('msg["PID"]["PID.3"]["PID.3.1"]');
    expect(result.data.targetField).toBe('tmp["patientId"]');
    expect(result.data.mapping).toBe('COPY');
  });

  it('accepts valid Message Builder step', () => {
    const result = transformerStepInputSchema.safeParse({
      type: 'MESSAGE_BUILDER',
      script: 'tmp["output"] = JSON.stringify({ id: msg.get("PID.3") });',
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.type).toBe('MESSAGE_BUILDER');
  });

  it('applies defaults for optional fields', () => {
    const result = transformerStepInputSchema.safeParse({ type: 'JAVASCRIPT' });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.enabled).toBe(true);
    expect(result.data.script).toBeNull();
    expect(result.data.sourceField).toBeNull();
    expect(result.data.targetField).toBeNull();
    expect(result.data.defaultValue).toBeNull();
    expect(result.data.mapping).toBeNull();
  });

  it('rejects invalid type', () => {
    const result = transformerStepInputSchema.safeParse({ type: 'INVALID' });
    expect(result.success).toBe(false);
  });

  it('rejects missing type', () => {
    const result = transformerStepInputSchema.safeParse({ script: 'return true;' });
    expect(result.success).toBe(false);
  });

  it('rejects name exceeding 255 characters', () => {
    const result = transformerStepInputSchema.safeParse({
      type: 'JAVASCRIPT',
      name: 'A'.repeat(256),
    });
    expect(result.success).toBe(false);
  });
});

describe('transformerInputSchema', () => {
  it('accepts valid transformer with steps', () => {
    const result = transformerInputSchema.safeParse({
      connectorId: null,
      inboundDataType: 'HL7V2',
      outboundDataType: 'JSON',
      steps: [
        { type: 'JAVASCRIPT', script: 'tmp["out"] = "test";' },
        { type: 'MAPPER', sourceField: 'PID.3', targetField: 'id', mapping: 'COPY' },
      ],
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.inboundDataType).toBe('HL7V2');
    expect(result.data.outboundDataType).toBe('JSON');
    expect(result.data.steps).toHaveLength(2);
  });

  it('applies data type defaults', () => {
    const result = transformerInputSchema.safeParse({});

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.inboundDataType).toBe('HL7V2');
    expect(result.data.outboundDataType).toBe('HL7V2');
    expect(result.data.inboundProperties).toEqual({});
    expect(result.data.outboundProperties).toEqual({});
    expect(result.data.inboundTemplate).toBeNull();
    expect(result.data.outboundTemplate).toBeNull();
    expect(result.data.steps).toEqual([]);
    expect(result.data.connectorId).toBeNull();
  });

  it('accepts destination connector UUID', () => {
    const result = transformerInputSchema.safeParse({
      connectorId: '550e8400-e29b-41d4-a716-446655440000',
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.connectorId).toBe('550e8400-e29b-41d4-a716-446655440000');
  });

  it('rejects invalid connectorId format', () => {
    const result = transformerInputSchema.safeParse({
      connectorId: 'not-a-uuid',
    });
    expect(result.success).toBe(false);
  });

  it('accepts custom properties', () => {
    const result = transformerInputSchema.safeParse({
      inboundProperties: { segmentDelimiter: '\r' },
      outboundProperties: { prettyPrint: true },
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.inboundProperties).toEqual({ segmentDelimiter: '\r' });
    expect(result.data.outboundProperties).toEqual({ prettyPrint: true });
  });

  it('accepts templates', () => {
    const result = transformerInputSchema.safeParse({
      inboundTemplate: 'MSH|^~\\&|...',
      outboundTemplate: '{"patient": {}}',
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.inboundTemplate).toBe('MSH|^~\\&|...');
    expect(result.data.outboundTemplate).toBe('{"patient": {}}');
  });
});
