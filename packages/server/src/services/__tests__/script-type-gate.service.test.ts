// Which scripts deploy type-checks, on which surface, and how a refusal reads.
// The type checker is real (a worker thread), so these also prove the checks
// match what the engine runs.

import { describe, it, expect, afterAll, vi } from 'vitest';
import { stopTypeChecker } from '@galvaniflow/engine';
import {
  findTypeFailures, formatTypeFailures, typeScriptGlobalScripts, typeScriptScripts, MAX_LISTED_TYPE_ERRORS,
} from '../script-type-gate.service.js';
import type { ChannelDetail } from '../channel.service.js';
import type { GlobalScriptsData } from '../global-script.service.js';

vi.setConfig({ testTimeout: 60_000 });
afterAll(async () => { await stopTypeChecker(); });

function channel(overrides: Partial<ChannelDetail> = {}): ChannelDetail {
  return {
    id: 'c1', name: 'ADT', inboundDataType: 'HL7V2', scripts: [], destinations: [], filters: [], transformers: [],
    ...overrides,
  } as unknown as ChannelDetail;
}

type Step = ChannelDetail['transformers'][number]['steps'][number];
function step(name: string, script: string, language: 'TYPESCRIPT' | 'JAVASCRIPT' = 'TYPESCRIPT', enabled = true): Step {
  return { id: name, sequenceNumber: 0, enabled, name, type: 'JAVASCRIPT', script, language, sourceField: null, targetField: null, defaultValue: null, mapping: null } as Step;
}
function sourceTransformer(steps: Step[]): Partial<ChannelDetail> {
  return { transformers: [{ id: 't', connectorId: null, inboundDataType: 'HL7V2', outboundDataType: 'HL7V2', inboundProperties: {}, outboundProperties: {}, inboundTemplate: null, outboundTemplate: null, steps }] } as Partial<ChannelDetail>;
}
const labels = (scripts: ReturnType<typeof typeScriptScripts>): string[] => scripts.flatMap((s) => s.segments.filter((g) => g.typescript).map((g) => g.label));

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
    } as Partial<ChannelDetail>);
    expect(labels(typeScriptScripts(c))).toEqual(['Channel deploy script', 'Source filter rule "Inpatient"']);
  });

  it('checks each script on the surface the editor uses, and never the global scripts', () => {
    const c = channel({
      scripts: [
        { id: '1', scriptType: 'DEPLOY', script: 'x', language: 'TYPESCRIPT' },
        { id: '2', scriptType: 'PREPROCESSOR', script: 'x', language: 'TYPESCRIPT' },
      ],
      destinations: [{ id: 'd1', name: 'To EHR', responseTransformer: 'x', responseTransformerLanguage: 'TYPESCRIPT' }] as never,
      transformers: [{
        id: 't', connectorId: 'd1', inboundDataType: 'HL7V2', outboundDataType: 'HL7V2', inboundProperties: {}, outboundProperties: {},
        inboundTemplate: null, outboundTemplate: null, steps: [step('Step 1', 'x')],
      }],
    } as Partial<ChannelDetail>);
    expect(typeScriptScripts(c).map((s) => [s.segments[0]!.label, s.surface])).toEqual([
      ['Channel deploy script', { message: false, templateContext: 'CHANNEL_DEPLOY' }],
      ['Channel preprocessor', { dataType: 'HL7V2', templateContext: 'CHANNEL_PREPROCESSOR' }],
      ['Destination "To EHR" transformer step "Step 1"', { dataType: 'HL7V2', templateContext: 'DESTINATION_FILTER_TRANSFORMER' }],
      ['Response transformer of destination "To EHR"', { dataType: 'HL7V2', templateContext: 'DESTINATION_RESPONSE_TRANSFORMER' }],
    ]);
  });
});

describe('transformer steps are checked as the engine runs them: joined', () => {
  it('lets a step use what an earlier step declared', async () => {
    const c = channel(sourceTransformer([step('Read PID', "const pid = msg.get('PID.3.1');"), step('Log PID', 'logger.info(pid);')]));
    expect(await findTypeFailures(typeScriptScripts(c), [])).toEqual([]);
  });

  it("reports an error on the step it is in, on that step's own line", async () => {
    const c = channel(sourceTransformer([
      step('Read PID', "const pid = msg.get('PID.3.1');\nlogger.info(pid);"),
      step('Bad', "logger.info('ok');\nconst n: number = pid;"),
    ]));
    const failures = await findTypeFailures(typeScriptScripts(c), []);
    expect(failures).toHaveLength(1);
    expect(failures[0]!.label).toBe('Source transformer step "Bad"');
    expect(failures[0]!.errors.map((e) => e.line)).toEqual([2]);
  });

  it('refuses two steps that declare the same name, which the engine cannot run either', async () => {
    const c = channel(sourceTransformer([step('A', 'const hl7 = msg;'), step('B', 'const hl7 = msg;')]));
    const failures = await findTypeFailures(typeScriptScripts(c), []);
    expect(failures.flatMap((f) => f.errors.map((e) => e.code))).toContain(2451);
  });

  it('reports nothing for a JavaScript step, and skips a transformer with no TypeScript step', async () => {
    const mixed = channel(sourceTransformer([step('Loose', 'const x: number = "a";', 'JAVASCRIPT'), step('Typed', 'logger.info(String(x));')]));
    expect(await findTypeFailures(typeScriptScripts(mixed), [])).toEqual([]);
    expect(typeScriptScripts(channel(sourceTransformer([step('Loose', 'x', 'JAVASCRIPT')])))).toEqual([]);
  });

  it('leaves out disabled steps, as the engine does', async () => {
    const c = channel(sourceTransformer([step('Off', 'const pid = 1;', 'TYPESCRIPT', false), step('Uses', 'logger.info(pid);')]));
    const failures = await findTypeFailures(typeScriptScripts(c), []);
    expect(failures[0]!.errors[0]!.message).toContain("Cannot find name 'pid'");
  });
});

describe('typeScriptGlobalScripts', () => {
  const globals: GlobalScriptsData = {
    deploy: "logger.info('up');", undeploy: '', preprocessor: "logger.info(msg.get('MSH.9'));", postprocessor: 'x',
    languages: { deploy: 'TYPESCRIPT', undeploy: 'TYPESCRIPT', preprocessor: 'TYPESCRIPT', postprocessor: 'JAVASCRIPT' },
  };

  it('checks only the scripts being saved, on their surface', () => {
    expect(typeScriptGlobalScripts(globals, ['deploy', 'preprocessor', 'postprocessor']).map((s) => [s.segments[0]!.label, s.surface])).toEqual([
      ['Global deploy script', { message: false, templateContext: 'GLOBAL_DEPLOY' }],
      ['Global preprocessor', { templateContext: 'GLOBAL_PREPROCESSOR' }],
    ]);
    expect(typeScriptGlobalScripts(globals, ['postprocessor'])).toEqual([]);
  });

  it("accepts msg in a global preprocessor, whose type depends on each channel's data type", async () => {
    expect(await findTypeFailures(typeScriptGlobalScripts(globals, ['preprocessor']), [])).toEqual([]);
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