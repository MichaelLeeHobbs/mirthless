// The test-run service scopes a run to the channel being edited and audits it
// without recording the sample. The engine's test run is real here; the
// database-backed services are stubbed.

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Each run starts a worker thread and compiles with esbuild, and one test waits
// out the 5 s test-run limit, so the 5 s default is too short.
vi.setConfig({ testTimeout: 30_000 });

const mockChannelService = { getById: vi.fn() };
const mockTemplates = { listTemplatesForChannel: vi.fn(), listTemplates: vi.fn() };
const emitAuditEvent = vi.fn();
const recordOrRefuse = vi.fn(async () => ({ ok: true, value: undefined }));
const getResource = vi.fn(async () => 'from-resource');

vi.mock('../channel.service.js', () => ({ ChannelService: mockChannelService }));
vi.mock('../code-template.service.js', () => ({ CodeTemplateService: mockTemplates }));
vi.mock('../../lib/event-emitter.js', () => ({ emitAuditEvent }));
vi.mock('../audit.service.js', () => ({ AuditService: { recordOrRefuse } }));
vi.mock('../../engine.js', () => ({
  createResourceBridge: () => getResource,
  createCollectionBridge: () => ({ find: vi.fn(async () => []) }),
}));

const { ScriptTestRunService, TEST_RUN_TIMEOUT_MS } = await import('../script-test-run.service.js');

const ADT = 'MSH|^~\\&|EPIC|HOSP|GF|HOSP|20261115093000||ADT^A01|MSG1|P|2.5.1\rPID|1||4821193^^^HOSP^MR||NGUYEN^AVERY';
const CHANNEL_ID = '00000000-0000-0000-0000-000000000001';

function ok<T>(value: T): { ok: true; value: T; error: null } {
  return { ok: true, value, error: null };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockChannelService.getById.mockResolvedValue(ok({
    id: CHANNEL_ID, scriptTimeoutSeconds: 5, destinations: [{ name: 'To EHR', metaDataId: 1 }, { name: 'Archive', metaDataId: 2 }],
  }));
  mockTemplates.listTemplatesForChannel.mockResolvedValue(ok([
    { type: 'FUNCTION', contexts: ['SOURCE_FILTER_TRANSFORMER'], code: "function family(m: any): string { return m.get('PID.5.1'); }" },
  ]));
  mockTemplates.listTemplates.mockResolvedValue(ok([]));
});

describe('ScriptTestRunService.run', () => {
  it("runs with the channel's templates and destinations and returns the result", async () => {
    const result = await ScriptTestRunService.run({
      kind: 'transformer', dataType: 'HL7V2', templateContext: 'SOURCE_FILTER_TRANSFORMER', destinationSet: true,
      channelId: CHANNEL_ID, sample: ADT,
      script: "logger.info(family(msg));\nlogger.info(await getResource('codes'));\ndestinationSet.remove('Archive');",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.outcome).toBe('completed');
    expect(result.value.logs.map((l) => l.message)).toEqual(['NGUYEN', 'from-resource']);
    expect(result.value.destinations).toEqual(['To EHR']);
    expect(mockTemplates.listTemplatesForChannel).toHaveBeenCalledWith(CHANNEL_ID);
  });

  it('audits who ran a script for which channel, never the sample', async () => {
    await ScriptTestRunService.run(
      { kind: 'filter', dataType: 'HL7V2', destinationSet: false, channelId: CHANNEL_ID, sample: ADT, script: 'return true;' },
      { userId: 'u1', ipAddress: '10.0.0.1' },
    );

    expect(recordOrRefuse).toHaveBeenCalledTimes(1);
    const event = (recordOrRefuse.mock.calls[0] as unknown[])[0] as Record<string, unknown>;
    expect(event).toMatchObject({ action: 'SCRIPT_TEST_RUN', outcome: 'SUCCESS', userId: 'u1', channelId: CHANNEL_ID });
    expect(JSON.stringify(event)).not.toContain('NGUYEN');
  });

  it('withholds the result, with AUDIT_UNAVAILABLE, when the run cannot be recorded', async () => {
    recordOrRefuse.mockResolvedValueOnce({ ok: false, error: Object.assign(new Error('audit down'), { name: 'ServiceError', code: 'AUDIT_UNAVAILABLE' }) } as never);

    const result = await ScriptTestRunService.run({ kind: 'script', destinationSet: false, sample: '', script: 'return 1;' }, { userId: 'u1', ipAddress: null });

    expect(result.ok).toBe(false);
    expect(result.error).toMatchObject({ code: 'AUDIT_UNAVAILABLE' });
  });

  it('stops an endless loop at the test-run limit, even for a channel that allows longer', async () => {
    mockChannelService.getById.mockResolvedValue(ok({ id: CHANNEL_ID, scriptTimeoutSeconds: 600, destinations: [] }));
    const started = Date.now();
    const result = await ScriptTestRunService.run({
      kind: 'script', dataType: 'HL7V2', destinationSet: false, channelId: CHANNEL_ID, sample: ADT, script: 'while (true) {}',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.outcome).toBe('error');
    expect(result.value.error).toMatch(new RegExp(`${String(TEST_RUN_TIMEOUT_MS)} ?ms`));
    expect(Date.now() - started).toBeLessThan(TEST_RUN_TIMEOUT_MS + 3_000);
  });

  it('runs one test at a time per server, refusing the second instead of queueing it', async () => {
    const first = ScriptTestRunService.run({ kind: 'script', destinationSet: false, sample: '', script: 'while (true) {}' });
    const second = await ScriptTestRunService.run({ kind: 'script', destinationSet: false, sample: '', script: 'return 1;' });
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.error).toHaveProperty('code', 'CONFLICT');
    await first;
    // Once the first finishes, the next run is accepted.
    expect((await ScriptTestRunService.run({ kind: 'script', destinationSet: false, sample: '', script: 'return 1;' })).ok).toBe(true);
  });

  it('audits a run whose script fails, as well as one that succeeds', async () => {
    await ScriptTestRunService.run({ kind: 'script', destinationSet: false, sample: '', script: "throw new Error('bad');" }, { userId: 'u1', ipAddress: null });
    expect(recordOrRefuse).toHaveBeenCalledTimes(1);
    expect((recordOrRefuse.mock.calls[0] as unknown[])[0]).toMatchObject({ action: 'SCRIPT_TEST_RUN', outcome: 'FAILURE', userId: 'u1' });
  });

  it('refuses a channel that does not exist', async () => {
    mockChannelService.getById.mockResolvedValue({ ok: false, value: null, error: new Error('missing') });
    const result = await ScriptTestRunService.run({
      kind: 'script', destinationSet: false, channelId: CHANNEL_ID, sample: '', script: 'return 1;',
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toHaveProperty('code', 'NOT_FOUND');
    expect(recordOrRefuse).not.toHaveBeenCalled();
    expect(emitAuditEvent).not.toHaveBeenCalled();
  });

  it('uses every template when no channel is given', async () => {
    await ScriptTestRunService.run({ kind: 'script', destinationSet: false, sample: '', script: 'return 1;' });
    expect(mockTemplates.listTemplates).toHaveBeenCalled();
    expect(mockChannelService.getById).not.toHaveBeenCalled();
  });
});
