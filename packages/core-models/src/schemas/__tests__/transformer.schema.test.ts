import { describe, it, expect } from 'vitest';
import { transformerStepInputSchema, transformerInputSchema, delimitedOptionsSchema } from '../transformer.schema.js';

describe('delimitedOptionsSchema', () => {
  it('fills every setting from {} with comma-separated, double-quoted lines', () => {
    expect(delimitedOptionsSchema.parse({})).toEqual({
      columnDelimiter: ',', recordDelimiter: '\n', quote: '"', escapeWithDoubleQuote: true,
      quoteEscape: '\\', columnNames: [], ignoreCR: true,
    });
  });

  it('refuses the same column and record delimiter, an empty delimiter and an empty column name', () => {
    expect(delimitedOptionsSchema.safeParse({ columnDelimiter: '\n' }).success).toBe(false);
    expect(delimitedOptionsSchema.safeParse({ columnDelimiter: '' }).success).toBe(false);
    expect(delimitedOptionsSchema.safeParse({ columnNames: ['mrn', ''] }).success).toBe(false);
  });

  it('refuses an empty quote or quote escape, a quote that is a delimiter, and a repeated column name', () => {
    expect(delimitedOptionsSchema.safeParse({ quote: '' }).success).toBe(false);
    expect(delimitedOptionsSchema.safeParse({ quoteEscape: '' }).success).toBe(false);
    expect(delimitedOptionsSchema.safeParse({ quote: ',' }).success).toBe(false);
    const repeated = delimitedOptionsSchema.safeParse({ columnNames: ['a', 'b', 'a'] });
    expect(repeated.success).toBe(false);
    expect(repeated.error?.issues[0]?.message).toBe('Column names must be unique');
  });

  // Reading such a row would keep only the later of the two (#372).
  it.each([
    [['column2'], '2'], [['a', 'column3'], '3'], [['column1', 'column9'], '9'], [['column3', 'b'], '3'], [['column10', 'b'], '10'], [['column9007199254740993'], '9007199254740993'],
  ])('refuses a name that a later column without a name has: %j', (columnNames, n) => {
    const { error } = delimitedOptionsSchema.safeParse({ columnNames });
    expect(error?.issues.map((i) => i.message)).toEqual([`"column${n}" is what column ${n} is called without a name, so it cannot name an earlier column`]);
  });

  it.each([[['column1']], [['a', 'column1']], [['column2', 'b']], [['column02']], [['column']], [['mycolumn9']], [['column9x']], [['Column9']], [['2', '1', '__proto__']]])('accepts %j, where no two columns have one name', (columnNames) => {
    expect(delimitedOptionsSchema.safeParse({ columnNames }).success).toBe(true);
  });
});

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

  it('accepts the id a request gives a destination that is not saved yet', () => {
    expect(transformerInputSchema.parse({ connectorId: 'new-1' }).connectorId).toBe('new-1');
  });

  it('rejects an empty connectorId', () => {
    expect(transformerInputSchema.safeParse({ connectorId: '' }).success).toBe(false);
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
