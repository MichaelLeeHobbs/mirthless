import { describe, it, expect, vi } from 'vitest';
import { MAX_SCRIPT_LOG_LINES, delimitedOptionsSchema } from '@galvanigraph/core-models';
import {
  runScriptTest, MAX_TEST_OUTPUT_CHARS, type ScriptTestInput, type ScriptTestResult,
} from '../script-test-run.js';

const ADT = [
  'MSH|^~\\&|EPIC|HOSP|GF|HOSP|20261115093000||ADT^A01|MSG1|P|2.5.1',
  'PID|1||4821193^^^HOSP^MR||NGUYEN^AVERY',
  'PV1|1|I',
].join('\r');

const SOURCE = { dataType: 'HL7V2', destinationSet: true, templateContext: 'SOURCE_FILTER_TRANSFORMER' } as const;

async function run(overrides: Partial<ScriptTestInput>): Promise<ScriptTestResult> {
  const result = await runScriptTest({
    script: 'return true;', kind: 'filter', surface: SOURCE, templates: [], sample: ADT, timeoutMs: 10_000,
    destinations: [{ name: 'To EHR', metaDataId: 1 }, { name: 'To Archive', metaDataId: 2 }],
    ...overrides,
  });
  if (!result.ok) throw result.error;
  return result.value;
}

describe('runScriptTest', () => {
  it('accepts a filter that returns true and filters one that returns false, like the pipeline', async () => {
    expect(await run({ script: "return msg.get('PV1.2') === 'I';" })).toMatchObject({ error: null, outcome: 'accepted' });
    expect(await run({ script: "return msg.get('PV1.2') === 'O';" })).toMatchObject({ error: null, outcome: 'filtered' });
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

  it('reads and writes the sample with the channel data type settings it is given, as the pipeline does (#474)', async () => {
    const delimited = delimitedOptionsSchema.parse({ columnDelimiter: '|', columnNames: ['mrn', 'name'] });
    const result = await run({
      kind: 'transformer', surface: { dataType: 'DELIMITED' }, sample: '1|Test\n', dataTypeOptions: { delimited },
      script: "logger.info(JSON.stringify(msg)); msg[0].name = 'Doe|Jr';",
    });
    expect(result.logs[0]?.message).toBe('[{"mrn":"1","name":"Test"}]');
    expect(result.output).toBe('1|"Doe|Jr"\n');
  });

  it('reads HL7 v2 hex escapes as code points when the channel settings say so (#194)', async () => {
    const sample = `${ADT}\rNTE|1||it\\X2019\\s`;
    const script = "return msg.getText('NTE.3') === 'it’s';";
    expect((await run({ sample, script, dataTypeOptions: { hl7: { hexCodePoints: true } } })).outcome).toBe('accepted');
    expect((await run({ sample, script })).outcome).toBe('filtered');
  });

  it("DATA-HL7-13: a response transformer's test run reads the sample answer by its own MSH-18, as the pipeline does (#492)", async () => {
    const readIn = async (templateContext: 'DESTINATION_RESPONSE_TRANSFORMER' | 'DESTINATION_FILTER_TRANSFORMER'): Promise<string | undefined> => (await run({
      kind: 'transformer', surface: { dataType: 'HL7V2', templateContext },
      sample: `${ADT}\rNTE|1||it\\X2019\\s`, dataTypeOptions: { hl7: { hexCodePoints: true } },
      script: "logger.info(JSON.stringify(msg.getText('NTE.3')));",
    })).logs[0]?.message;
    expect(await readIn('DESTINATION_RESPONSE_TRANSFORMER')).toBe(JSON.stringify('it \x19s'));
    expect(await readIn('DESTINATION_FILTER_TRANSFORMER')).toBe(JSON.stringify('it’s'));
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
      ["await getCollection('orders').update('id-1', { k: 'v' });", 'collection "orders" update'],
      ["await getCollection('orders').delete('id-1');", 'collection "orders" delete'],
      // Reads are refused too when the caller gives no reader.
      ["await getResource('codes');", 'getResource "codes"'],
      ["await getCollection('orders').find({ k: 'v' });", 'collection "orders" find'],
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

  it('reports what a script returned as text, and nothing when it returned nothing', async () => {
    expect((await run({ kind: 'script', script: 'return 42;' })).returned).toBe('42');
    expect((await run({ kind: 'script', script: "return { mrn: '0004821193' };" })).returned).toBe('{"mrn":"0004821193"}');
    expect((await run({ kind: 'script', script: "logger.info('x');" })).returned).toBeNull();
  });

  it('uses a returned string as the transformer output, as the pipeline does', async () => {
    const replaced = 'MSH|^~\\&|EPIC|HOSP|GF|HOSP|20261115093000||ADT^A08|MSG2|P|2.5.1';
    const result = await run({ kind: 'transformer', script: `return ${JSON.stringify(replaced)};` });
    expect(result.output).toBe(replaced);
    expect(result.returned).toBe(replaced);
  });

  it('passes the sample through as text when the script has no data type', async () => {
    const result = await run({ kind: 'transformer', script: "logger.info(typeof msg + ' ' + msg.length);", surface: { templateContext: 'GLOBAL_PREPROCESSOR' }, sample: 'abc' });
    expect(result.logs).toEqual([{ level: 'INFO', message: 'string 3' }]);
    expect(result.output).toBeNull();
    expect(result.destinations).toBeNull();
  });

  it('caps logger lines and output size, and says what it cut', async () => {
    const chatty = await run({ kind: 'script', script: 'for (let i = 0; i < 1000; i++) logger.info(String(i));' });
    expect(chatty.error).toBeNull();
    expect(chatty.logs).toHaveLength(MAX_SCRIPT_LOG_LINES + 1);
    expect(chatty.logs.at(-1)?.message).toBe(`${String(1000 - MAX_SCRIPT_LOG_LINES)} more logger lines not shown`);

    const big = await run({ kind: 'transformer', script: `return 'x'.repeat(${String(MAX_TEST_OUTPUT_CHARS + 10)});` });
    expect(big.error).toBeNull();
    expect(big.output).toHaveLength(MAX_TEST_OUTPUT_CHARS);
    expect(big.logs.at(-1)?.message).toBe(`Output cut to the first ${String(MAX_TEST_OUTPUT_CHARS)} characters`);
  });

  it('has what a script logged before it failed', async () => {
    const result = await run({ kind: 'script', script: 'logger.warn("got this far"); throw new Error("broke");' });
    expect(result.outcome).toBe('error');
    expect(result.logs).toEqual([{ level: 'WARN', message: 'got this far' }]);
  });

  it('reports a sample that does not parse as the channel data type', async () => {
    const result = await run({ sample: 'not hl7 at all' });
    expect(result.outcome).toBe('error');
    expect(result.error).toMatch(/^The sample is not valid HL7V2: /);
  });

  it('gives a preprocessor such a sample as text, as the pipeline does, so that it can repair it', async () => {
    const result = await run({
      kind: 'script', surface: { dataType: 'HL7V2', templateContext: 'CHANNEL_PREPROCESSOR' },
      sample: `junk ${ADT}`, script: "logger.info(typeof msg); return rawData.slice(rawData.indexOf('MSH'));",
    });
    expect(result).toMatchObject({ outcome: 'completed', error: null, output: ADT, logs: [{ message: 'string' }] });
  });

  it('reports a script error and a compile error as outcomes, not failures', async () => {
    expect((await run({ kind: 'script', script: "throw new Error('bad MRN');" })).error).toContain('bad MRN');
    expect((await run({ kind: 'script', script: 'function (' })).outcome).toBe('error');
  });

  it('stops a script that runs past the timeout', async () => {
    const result = await run({ kind: 'script', script: 'while (true) {}', timeoutMs: 200 });
    expect(result.outcome).toBe('error');
  });

  it('says when the script is compiled, before it runs, so a worker can start its time limit there (#188)', async () => {
    const order: string[] = [];
    const onCompiled = vi.fn(() => { order.push('compiled'); });
    const getResource = vi.fn(async () => { order.push('ran'); return 'x'; });
    const result = await run({ kind: 'script', script: "await getResource('codes');", readers: { getResource }, onCompiled });
    expect(result.error).toBeNull();
    expect(order).toEqual(['compiled', 'ran']);
  });

  it('does not say a script that fails to compile is compiled', async () => {
    const onCompiled = vi.fn();
    const result = await run({ kind: 'script', script: 'function (', onCompiled });
    expect(result.outcome).toBe('error');
    expect(onCompiled).not.toHaveBeenCalled();
  });
});
