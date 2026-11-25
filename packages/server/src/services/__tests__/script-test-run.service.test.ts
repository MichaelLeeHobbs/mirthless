import { describe, it, expect, vi, beforeEach } from 'vitest';

// Longer than a run's own limits (30 s to start, then up to 15 s), so that a test on a
// loaded machine sees what the run answered (D-368).
vi.setConfig({ testTimeout: 120_000 });

const mockChannelService = { getById: vi.fn() };
const mockTemplates = { listTemplatesForChannel: vi.fn(), listTemplates: vi.fn() };
const emitAuditEvent = vi.fn();
const recordOrRefuse = vi.fn(async () => ({ ok: true, value: undefined }));
const getResource = vi.fn(async () => 'from-resource');
const collectionFind = vi.fn(async () => []);

vi.mock('../channel.service.js', () => ({ ChannelService: mockChannelService }));
vi.mock('../code-template.service.js', () => ({ CodeTemplateService: mockTemplates }));
vi.mock('../../lib/event-emitter.js', () => ({ emitAuditEvent }));
vi.mock('../audit.service.js', () => ({ AuditService: { recordOrRefuse } }));
vi.mock('../../engine.js', () => ({
  createResourceBridge: () => getResource,
  createCollectionBridge: () => ({ find: collectionFind }),
}));

const { ScriptTestRunService, TEST_RUN_TIMEOUT_MS } = await import('../script-test-run.service.js');
const { ServiceError } = await import('../../lib/service-error.js');

const ADT = 'MSH|^~\\&|EPIC|HOSP|GF|HOSP|20261115093000||ADT^A01|MSG1|P|2.5.1\rPID|1||4821193^^^HOSP^MR||NGUYEN^AVERY';
const CHANNEL_ID = '00000000-0000-0000-0000-000000000001';
const BOTH_READS = { resources: true, collections: true } as const;

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
    }, undefined, BOTH_READS);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.error).toBeNull();
    expect(result.value.outcome).toBe('completed');
    expect(result.value.logs.map((l) => l.message)).toEqual(['NGUYEN', 'from-resource']);
    expect(result.value.destinations).toEqual(['To EHR']);
    expect(mockTemplates.listTemplatesForChannel).toHaveBeenCalledWith(CHANNEL_ID);
  });

  it.each([
    ['resources:read', { resources: false, collections: true }, "await getCollection('orders').find({}); await getResource('codes');", collectionFind, getResource],
    ['collections:read', { resources: true, collections: false }, "await getResource('codes'); await getCollection('orders').find({});", getResource, collectionFind],
  ] as const)('wires a read only for a caller holding its read permission, and names the one missing (D-310): %s', async (missing, reads, script, held, refused) => {
    const result = await ScriptTestRunService.run({ kind: 'script', destinationSet: false, sample: '', script }, { userId: 'u1', ipAddress: null }, reads);

    expect(held).toHaveBeenCalledOnce();
    expect(refused).not.toHaveBeenCalled();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.outcome).toBe('error');
    expect(result.value.error).toContain(missing);
  });

  it('audits who ran a script for which channel, never the sample', async () => {
    await ScriptTestRunService.run(
      { kind: 'filter', dataType: 'HL7V2', destinationSet: false, channelId: CHANNEL_ID, sample: ADT, script: 'return true;' },
      { userId: 'u1', ipAddress: '10.0.0.1' },
      BOTH_READS,
    );

    expect(recordOrRefuse).toHaveBeenCalledTimes(1);
    const event = (recordOrRefuse.mock.calls[0] as unknown[])[0] as Record<string, unknown>;
    expect(event).toMatchObject({ action: 'SCRIPT_TEST_RUN', outcome: 'SUCCESS', userId: 'u1', channelId: CHANNEL_ID });
    expect(JSON.stringify(event)).not.toContain('NGUYEN');
  });

  it('withholds the result, with AUDIT_UNAVAILABLE, when the run cannot be recorded', async () => {
    recordOrRefuse.mockResolvedValueOnce({ ok: false, error: Object.assign(new Error('audit down'), { name: 'ServiceError', code: 'AUDIT_UNAVAILABLE' }) } as never);

    const result = await ScriptTestRunService.run({ kind: 'script', destinationSet: false, sample: '', script: 'return 1;' }, { userId: 'u1', ipAddress: null }, BOTH_READS);

    expect(result.ok).toBe(false);
    expect(result.error).toMatchObject({ code: 'AUDIT_UNAVAILABLE' });
  });

  it('stops an endless loop at the test-run limit, even for a channel that allows longer', async () => {
    // Short enough that a run given this limit by mistake ends, and reports it, before the test times out.
    const channelLimitSeconds = 4 * (TEST_RUN_TIMEOUT_MS / 1_000);
    mockChannelService.getById.mockResolvedValue(ok({ id: CHANNEL_ID, scriptTimeoutSeconds: channelLimitSeconds, destinations: [] }));
    const result = await ScriptTestRunService.run({
      kind: 'script', dataType: 'HL7V2', destinationSet: false, channelId: CHANNEL_ID, sample: ADT, script: 'while (true) {}',
    }, undefined, BOTH_READS);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.outcome).toBe('error');
    // The sandbox's own words. The worker's backstop, 2 x the limit + 5 s, says "was stopped after" the same limit.
    expect(result.value.error).toBe(`Script execution timed out after ${String(TEST_RUN_TIMEOUT_MS)}ms`);
  });

  it('runs one test at a time per server, refusing the second instead of queueing it', async () => {
    const first = ScriptTestRunService.run({ kind: 'script', destinationSet: false, sample: '', script: 'while (true) {}' }, undefined, BOTH_READS);
    const second = await ScriptTestRunService.run({ kind: 'script', destinationSet: false, sample: '', script: 'return 1;' }, undefined, BOTH_READS);
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.error).toHaveProperty('code', 'CONFLICT');
    await first;
    expect((await ScriptTestRunService.run({ kind: 'script', destinationSet: false, sample: '', script: 'return 1;' }, undefined, BOTH_READS)).ok).toBe(true);
  });

  it('audits a run whose script fails, as well as one that succeeds', async () => {
    await ScriptTestRunService.run({ kind: 'script', destinationSet: false, sample: '', script: "throw new Error('bad');" }, { userId: 'u1', ipAddress: null }, BOTH_READS);
    expect(recordOrRefuse).toHaveBeenCalledTimes(1);
    expect((recordOrRefuse.mock.calls[0] as unknown[])[0]).toMatchObject({ action: 'SCRIPT_TEST_RUN', outcome: 'FAILURE', userId: 'u1' });
  });

  it('refuses a channel that does not exist', async () => {
    mockChannelService.getById.mockResolvedValue({ ok: false, value: null, error: new ServiceError('NOT_FOUND', 'Channel not found') });
    const result = await ScriptTestRunService.run({
      kind: 'script', destinationSet: false, channelId: CHANNEL_ID, sample: '', script: 'return 1;',
    }, undefined, BOTH_READS);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toHaveProperty('code', 'NOT_FOUND');
    expect(recordOrRefuse).not.toHaveBeenCalled();
    expect(emitAuditEvent).not.toHaveBeenCalled();
  });

  it('reports a channel that could not be read as the read failure, not as missing', async () => {
    mockChannelService.getById.mockResolvedValue({ ok: false, value: null, error: new Error('connection refused') });
    const result = await ScriptTestRunService.run({
      kind: 'script', destinationSet: false, channelId: CHANNEL_ID, sample: '', script: 'return 1;',
    }, undefined, BOTH_READS);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).toBe('connection refused');
    expect(result.error).not.toHaveProperty('code', 'NOT_FOUND');
    expect(recordOrRefuse).not.toHaveBeenCalled();
  });

  it('uses every template when no channel is given', async () => {
    const template = (code: string): object => ({ type: 'FUNCTION', contexts: ['SOURCE_FILTER_TRANSFORMER'], code });
    mockTemplates.listTemplates.mockResolvedValue(ok([
      template("function one(): string { return 'one'; }"), template("function two(): string { return 'two'; }"),
    ]));

    const result = await ScriptTestRunService.run({
      kind: 'script', templateContext: 'SOURCE_FILTER_TRANSFORMER', destinationSet: false, sample: '', script: 'logger.info(one() + two());',
    }, undefined, BOTH_READS);

    expect(result.ok && result.value.logs.map((l) => l.message)).toEqual(['onetwo']);
    expect(mockChannelService.getById).not.toHaveBeenCalled();
  });
});
