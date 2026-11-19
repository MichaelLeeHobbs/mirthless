// ===========================================
// filterTransformerDataOf: a deploy's filters and transformers come from the
// channel it deploys, not the database (#225)
// ===========================================

import { describe, it, expect } from 'vitest';
import { filterTransformerDataOf } from '../engine.js';
import type { ChannelDetail, ChannelFilterRuleDetail, ChannelTransformerStepDetail } from '../services/channel.service.js';

const DEST = '00000000-0000-4000-8000-0000000000d1';

function rule(sequenceNumber: number, script: string, extra: Partial<ChannelFilterRuleDetail> = {}): ChannelFilterRuleDetail {
  return {
    id: `r${String(sequenceNumber)}`, sequenceNumber, enabled: true, name: null, operator: 'AND', type: 'JAVASCRIPT',
    script, language: 'JAVASCRIPT', field: null, condition: null, values: null, ...extra,
  };
}

function step(sequenceNumber: number, script: string, enabled = true): ChannelTransformerStepDetail {
  return {
    id: `s${String(sequenceNumber)}`, sequenceNumber, enabled, name: null, type: 'JAVASCRIPT', script,
    language: 'JAVASCRIPT', sourceField: null, targetField: null, defaultValue: null, mapping: null,
  };
}

function transformer(connectorId: string | null, steps: ChannelTransformerStepDetail[]): ChannelDetail['transformers'][number] {
  return {
    id: `t-${connectorId ?? 'src'}`, connectorId, inboundDataType: 'RAW', outboundDataType: 'RAW',
    inboundProperties: {}, outboundProperties: {}, inboundTemplate: null, outboundTemplate: null, steps,
  };
}

function channelWith(parts: Pick<ChannelDetail, 'filters' | 'transformers'>): ChannelDetail {
  return { filters: parts.filters, transformers: parts.transformers } as unknown as ChannelDetail;
}

describe('filterTransformerDataOf', () => {
  it('puts connector-less filters and transformers on the source, in sequence order', () => {
    const data = filterTransformerDataOf(channelWith({
      filters: [{ id: 'f1', connectorId: null, rules: [rule(2, 'second'), rule(1, 'first', { operator: 'OR' })] }],
      transformers: [transformer(null, [step(5, 'b'), step(3, 'a', false)])],
    }));

    expect(data.sourceFilterRules.map((r) => [r.script, r.operator])).toEqual([['first', 'OR'], ['second', 'AND']]);
    expect(data.sourceTransformerSteps).toEqual([
      { enabled: false, type: 'JAVASCRIPT', script: 'a' },
      { enabled: true, type: 'JAVASCRIPT', script: 'b' },
    ]);
    expect(data.destinationFilterRules.size).toBe(0);
    expect(data.destinationTransformerSteps.size).toBe(0);
  });

  it('keys a destination\'s filter and transformer by the destination id, with every rule field the compiler reads', () => {
    const builder = rule(1, '', { type: 'RULE_BUILDER', field: 'PID.3', condition: 'EQUALS', values: ['123'] });
    const data = filterTransformerDataOf(channelWith({
      filters: [{ id: 'f2', connectorId: DEST, rules: [builder] }],
      transformers: [transformer(DEST, [step(1, 'd')])],
    }));

    expect(data.destinationFilterRules.get(DEST)).toEqual([
      { enabled: true, operator: 'AND', type: 'RULE_BUILDER', script: '', field: 'PID.3', condition: 'EQUALS', values: ['123'] },
    ]);
    expect(data.destinationTransformerSteps.get(DEST)).toEqual([{ enabled: true, type: 'JAVASCRIPT', script: 'd' }]);
    expect(data.sourceFilterRules).toEqual([]);
  });

  it('returns nothing for a channel with no filters or transformers', () => {
    const data = filterTransformerDataOf(channelWith({ filters: [], transformers: [] }));

    expect(data.sourceFilterRules).toEqual([]);
    expect(data.sourceTransformerSteps).toEqual([]);
  });
});
