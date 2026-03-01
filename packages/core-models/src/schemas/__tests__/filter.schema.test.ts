// ===========================================
// Filter Schema Validation Tests
// ===========================================

import { describe, it, expect } from 'vitest';
import { filterRuleInputSchema, filterInputSchema } from '../filter.schema.js';

describe('filterRuleInputSchema', () => {
  it('accepts valid JavaScript filter rule', () => {
    const result = filterRuleInputSchema.safeParse({
      type: 'JAVASCRIPT',
      script: 'return msg.getField("MSH.9") === "ADT";',
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.type).toBe('JAVASCRIPT');
    expect(result.data.script).toBe('return msg.getField("MSH.9") === "ADT";');
    expect(result.data.enabled).toBe(true);
    expect(result.data.operator).toBe('AND');
  });

  it('accepts valid Rule Builder filter rule', () => {
    const result = filterRuleInputSchema.safeParse({
      type: 'RULE_BUILDER',
      field: 'MSH.9.1',
      condition: 'EQUALS',
      values: ['ADT'],
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.type).toBe('RULE_BUILDER');
    expect(result.data.field).toBe('MSH.9.1');
    expect(result.data.condition).toBe('EQUALS');
    expect(result.data.values).toEqual(['ADT']);
  });

  it('applies defaults for optional fields', () => {
    const result = filterRuleInputSchema.safeParse({ type: 'JAVASCRIPT' });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.enabled).toBe(true);
    expect(result.data.operator).toBe('AND');
    expect(result.data.script).toBeNull();
    expect(result.data.field).toBeNull();
    expect(result.data.condition).toBeNull();
    expect(result.data.values).toBeNull();
  });

  it('rejects invalid type', () => {
    const result = filterRuleInputSchema.safeParse({ type: 'INVALID' });
    expect(result.success).toBe(false);
  });

  it('rejects missing type', () => {
    const result = filterRuleInputSchema.safeParse({ script: 'return true;' });
    expect(result.success).toBe(false);
  });

  it('accepts all valid operators', () => {
    for (const op of ['AND', 'OR'] as const) {
      const result = filterRuleInputSchema.safeParse({ type: 'JAVASCRIPT', operator: op });
      expect(result.success, `Expected ${op} to be valid`).toBe(true);
    }
  });

  it('rejects invalid operator', () => {
    const result = filterRuleInputSchema.safeParse({ type: 'JAVASCRIPT', operator: 'XOR' });
    expect(result.success).toBe(false);
  });

  it('rejects name exceeding 255 characters', () => {
    const result = filterRuleInputSchema.safeParse({
      type: 'JAVASCRIPT',
      name: 'A'.repeat(256),
    });
    expect(result.success).toBe(false);
  });
});

describe('filterInputSchema', () => {
  it('accepts valid filter with rules', () => {
    const result = filterInputSchema.safeParse({
      connectorId: null,
      rules: [
        { type: 'JAVASCRIPT', script: 'return true;' },
        { type: 'RULE_BUILDER', field: 'PID.3', condition: 'EXISTS', values: [] },
      ],
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.connectorId).toBeNull();
    expect(result.data.rules).toHaveLength(2);
  });

  it('defaults to empty rules array', () => {
    const result = filterInputSchema.safeParse({});

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.rules).toEqual([]);
    expect(result.data.connectorId).toBeNull();
  });

  it('accepts destination connector UUID', () => {
    const result = filterInputSchema.safeParse({
      connectorId: '550e8400-e29b-41d4-a716-446655440000',
      rules: [],
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.connectorId).toBe('550e8400-e29b-41d4-a716-446655440000');
  });

  it('rejects invalid connectorId format', () => {
    const result = filterInputSchema.safeParse({
      connectorId: 'not-a-uuid',
      rules: [],
    });
    expect(result.success).toBe(false);
  });
});
