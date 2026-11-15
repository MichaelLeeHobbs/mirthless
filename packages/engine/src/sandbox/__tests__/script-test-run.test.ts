// A test run must behave like the pipeline (same compile, same filter rule,
// same transformer output) and must never send, write or route anything.

import { describe, it, expect, vi } from 'vitest';
import { runScriptTest, type ScriptTestInput, type ScriptTestResult } from '../script-test-run.js';

const ADT = [
  'MSH|^~\\&|EPIC|HOSP|GF|HOSP|20261115093000||ADT^A01|MSG1|P|2.5.1',
  'PID|1||4821193^^^HOSP^MR||NGUYEN^AVERY',
  'PV1|1|I',
].join('\r');

const SOURCE = { dataType: 'HL7V2', destinationSet: true, templateContext: 'SOURCE_FILTER_TRANSFORMER' } as const;

async function run(overrides: Partial<ScriptTestInput>): Promise<ScriptTestResult> {
  const result = await runScriptTest({
    script: 'return true;', kind: 'filter', surface: SOURCE, templates: [], sample: ADT, timeoutMs: 5000,
    destinations: [{ name: 'To EHR', metaDataId: 1 }, { name: 'To Archive', metaDataId: 2 }],
    ...overrides,
  });
  if (!result.ok) throw result.error;
  return result.value;
}

describe('runScriptTest', () => {
  it('accepts a filter that returns true and filters one that returns false, like the pipeline', async () => {
    expect((await run({ script: "return msg.get('PV1.2') === 'I';" })).outcome).toBe('accepted');
    expect((await run({ script: "return msg.get('PV1.2') === 'O';" })).outcome).toBe('filtered');
  });

  it('fails a filter rule that returns something other than true or false, as deploy-time rules do', async () => {
    const result = await run({ script: "return 'yes';" });
    expect(result.outcome).toBe('error');
    expect(result.error).toContain('Filter rule 1 returned a string. A filter rule must return true or false.');
  });

  it('returns the transformed message, serialized as the pipeline would', async () => {
    const result = await run({ kind: 'transformer', script: "msg.set('PID.5.1', 'SMITH');" });
    expect(result.outcome).toBe('completed');
    expect(result.output?.split('\r')[1]).toBe('PID|1||4821193^^^HOSP^MR||SMITH^AVERY');
    // The compiled steps hand back msg itself; that is the output, not a returned value.
    expect(result.returned).toBeNull();
  });

  it('reports logger output, map changes and the destinations a source script left', async () => {
    const result = await run({
      kind: 'transformer',
      script: "logger.info('mrn ' + msg.get('PID.3.1'));\nchannelMap['mrn'] = msg.get('PID.3.1');\ndestinationSet.remove('To Archive');",
    });
    expect(result.logs).toEqual([{ level: 'INFO', message: 'mrn 4821193' }]);
    expect(result.maps).toEqual({ channelMap: { mrn: '4821193' } });
    expect(result.destinations).toEqual(['To EHR']);
  });

  it('calls code templates enabled for the context', async () => {
    const template = {
      type: 'FUNCTION', contexts: ['SOURCE_FILTER_TRANSFORMER'],
      code: "function familyName(m: any): string { return m.get('PID.5.1') ?? ''; }",
    };
    const result = await run({ kind: 'transformer', script: "logger.info(familyName(msg));", templates: [template] });
    expect(result.logs).toEqual([{ level: 'INFO', message: 'NGUYEN' }]);
  });

  it('refuses every call with a side effect and names it, sending nothing', async () => {
    for (const [script, call] of [
      ["await httpFetch('https://ehr.example.test/api');", 'httpFetch https://ehr.example.test/api'],
      ["await dbQuery('billing', 'delete from x');", 'dbQuery on "billing"'],
      ["await routeMessage('Archive', rawData);", 'routeMessage to "Archive"'],
      ["await getCollection('orders').store({ k: 'v' }, 'x');", 'collection "orders" store'],
    ] as const) {
      const result = await run({ kind: 'script', script });
      expect(result.outcome, script).toBe('error');
      expect(result.skipped, script).toEqual([call]);
      expect(result.error, script).toContain('a test run does not send, write or route anything');
    }
  });

  it('lets reads through when the caller provides them', async () => {
    const getResource = vi.fn(async () => 'lookup-table');
    const result = await run({ kind: 'script', script: "logger.info(await getResource('codes'));", readers: { getResource } });
    expect(getResource).toHaveBeenCalledWith('codes');
    expect(result.logs).toEqual([{ level: 'INFO', message: 'lookup-table' }]);
  });

  it('reports a sample that does not parse as the channel data type', async () => {
    const result = await run({ sample: 'not hl7 at all' });
    expect(result.outcome).toBe('error');
    expect(result.error).toMatch(/^The sample is not valid HL7V2: /);
  });

  it('reports a script error and a compile error as outcomes, not failures', async () => {
    expect((await run({ kind: 'script', script: "throw new Error('bad MRN');" })).error).toContain('bad MRN');
    expect((await run({ kind: 'script', script: 'function (' })).outcome).toBe('error');
  });

  it('stops a script that runs past the timeout', async () => {
    const result = await run({ kind: 'script', script: 'while (true) {}', timeoutMs: 200 });
    expect(result.outcome).toBe('error');
  });
});
