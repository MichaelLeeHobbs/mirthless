// Which scripts deploy type-checks, on which surface, and how a refusal reads.

import { describe, it, expect } from 'vitest';
import { formatTypeFailures, typeScriptScripts, MAX_LISTED_TYPE_ERRORS } from '../script-type-gate.service.js';
import type { ChannelDetail } from '../channel.service.js';
import type { GlobalScriptsData } from '../global-script.service.js';

const JS_GLOBALS: GlobalScriptsData = {
  deploy: '', undeploy: '', preprocessor: 'return rawData;', postprocessor: '',
  languages: { deploy: 'JAVASCRIPT', undeploy: 'JAVASCRIPT', preprocessor: 'JAVASCRIPT', postprocessor: 'JAVASCRIPT' },
};

function channel(overrides: Partial<ChannelDetail> = {}): ChannelDetail {
  return {
    id: 'c1', name: 'ADT', inboundDataType: 'HL7V2', scripts: [], destinations: [], filters: [], transformers: [],
    ...overrides,
  } as unknown as ChannelDetail;
}

describe('typeScriptScripts', () => {
  it('lists only enabled TypeScript scripts that have code', () => {
    const c = channel({
      scripts: [
        { id: '1', scriptType: 'DEPLOY', script: 'logger.info("x");', language: 'TYPESCRIPT' },
        { id: '2', scriptType: 'PREPROCESSOR', script: 'return rawData;', language: 'JAVASCRIPT' },
        { id: '3', scriptType: 'POSTPROCESSOR', script: '   ', language: 'TYPESCRIPT' },
      ],
      filters: [{
        id: 'f', connectorId: null, rules: [
          { id: 'r1', sequenceNumber: 0, enabled: true, name: 'Inpatient', operator: 'AND', type: 'JAVASCRIPT', script: 'return true;', language: 'TYPESCRIPT', field: null, condition: null, values: null },
          { id: 'r2', sequenceNumber: 1, enabled: false, name: 'Off', operator: 'AND', type: 'JAVASCRIPT', script: 'return true;', language: 'TYPESCRIPT', field: null, condition: null, values: null },
        ],
      }],
    });
    expect(typeScriptScripts(c, JS_GLOBALS).map((s) => s.label)).toEqual(['Channel deploy script', 'Source filter rule "Inpatient"']);
  });

  it('checks each script on the surface the editor uses', () => {
    const c = channel({
      scripts: [
        { id: '1', scriptType: 'DEPLOY', script: 'x', language: 'TYPESCRIPT' },
        { id: '2', scriptType: 'PREPROCESSOR', script: 'x', language: 'TYPESCRIPT' },
      ],
      destinations: [{ id: 'd1', name: 'To EHR', responseTransformer: 'x', responseTransformerLanguage: 'TYPESCRIPT' }] as never,
      transformers: [{
        id: 't', connectorId: 'd1', inboundDataType: 'HL7V2', outboundDataType: 'HL7V2', inboundProperties: {}, outboundProperties: {},
        inboundTemplate: null, outboundTemplate: null,
        steps: [{ id: 's', sequenceNumber: 0, enabled: true, name: null, type: 'JAVASCRIPT', script: 'x', language: 'TYPESCRIPT', sourceField: null, targetField: null, defaultValue: null, mapping: null }],
      }],
    });
    const globals = { ...JS_GLOBALS, languages: { ...JS_GLOBALS.languages, preprocessor: 'TYPESCRIPT' as const } };
    expect(typeScriptScripts(c, globals).map((s) => [s.label, s.surface])).toEqual([
      ['Channel deploy script', { templateContext: 'CHANNEL_DEPLOY' }],
      ['Channel preprocessor', { dataType: 'HL7V2', templateContext: 'CHANNEL_PREPROCESSOR' }],
      ['Destination "To EHR" transformer step "Step 1"', { dataType: 'HL7V2', templateContext: 'DESTINATION_FILTER_TRANSFORMER' }],
      ['Response transformer of destination "To EHR"', { dataType: 'HL7V2', templateContext: 'DESTINATION_RESPONSE_TRANSFORMER' }],
      ['Global preprocessor', { templateContext: 'GLOBAL_PREPROCESSOR' }],
    ]);
  });
});

describe('formatTypeFailures', () => {
  it('names the channel, each script and line, and says how to proceed', () => {
    const text = formatTypeFailures('ADT', [{ label: 'Channel deploy script', errors: [{ line: 3, column: 1, code: 2304, message: "Cannot find name 'x'." }] }]);
    expect(text).toBe([
      '"ADT" was not deployed: a TypeScript script has type errors. Fix them, or switch the script to JavaScript to deploy without type checks.',
      "- Channel deploy script, line 3: Cannot find name 'x'.",
    ].join('\n'));
  });

  it('lists at most the first errors and counts the rest', () => {
    const errors = Array.from({ length: MAX_LISTED_TYPE_ERRORS + 3 }, (_, i) => ({ line: i + 1, column: 1, code: 2304, message: 'x' }));
    const text = formatTypeFailures('ADT', [{ label: 'A', errors }, { label: 'B', errors: [errors[0]!] }]);
    expect(text.split('\n')).toHaveLength(1 + MAX_LISTED_TYPE_ERRORS + 1);
    expect(text).toContain('2 TypeScript scripts have type errors');
    expect(text.endsWith('- and 4 more')).toBe(true);
  });
});
