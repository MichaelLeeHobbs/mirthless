import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import type { Result } from '@galvanigraph/core-util';
import { CONTENT_TYPE } from '@galvanigraph/core-models';
import { MessageProcessor } from '../message-processor.js';
import type { DestinationConfig, MessageStore, PipelineConfig, ProcessedMessage } from '../message-processor.js';
import { VmSandboxExecutor, DEFAULT_EXECUTION_OPTIONS } from '../../sandbox/sandbox-executor.js';

const CHANNEL = '00000000-0000-0000-0000-000000000012';
const MESSAGE = 3;
const PARTNER = 1;
const ANSWER = 'MSA|AA|1';

function ok<T>(value: T): Result<T> {
  return { ok: true, value, error: null } as Result<T>;
}

function fail(message: string): Result<never> {
  return { ok: false, value: null, error: new Error(message) } as unknown as Result<never>;
}

const store = {
  createMessage: vi.fn(),
  createConnectorMessage: vi.fn(),
  updateConnectorMessageStatus: vi.fn(),
  storeContent: vi.fn(),
  markProcessed: vi.fn(),
  enqueue: vi.fn(),
  loadContent: vi.fn(),
  incrementStats: vi.fn(),
  dequeue: vi.fn(),
  release: vi.fn(),
  removeCompletedContent: vi.fn(),
} satisfies MessageStore;
const send = vi.fn();
const onError = vi.fn();
const onStoreFailure = vi.fn();
let sandbox: VmSandboxExecutor;

beforeEach(() => {
  vi.resetAllMocks();
  for (const fn of Object.values(store)) fn.mockResolvedValue(ok(undefined));
  store.createMessage.mockResolvedValue(ok({ messageId: MESSAGE, correlationId: '00000000-0000-0000-0000-000000000099' }));
  send.mockResolvedValue(ok({ status: 'SENT', content: ANSWER }));
  onError.mockResolvedValue(undefined);
  sandbox = new VmSandboxExecutor();
});

afterEach(() => { sandbox.dispose(); });

function refuseContent(refused: number): void {
  store.storeContent.mockImplementation(async (_c: string, _m: number, _d: number, contentType: number) =>
    (contentType === refused ? fail('db refused it') : ok(undefined)));
}

async function run(scripts: DestinationConfig['scripts'] = {}, overrides: Partial<PipelineConfig> = {}): Promise<ProcessedMessage> {
  const config: PipelineConfig = {
    channelId: CHANNEL, serverId: 'server-01', dataType: 'RAW', scripts: {},
    destinations: [{ metaDataId: PARTNER, name: 'Partner', enabled: true, scripts, queueMode: 'NEVER' }],
    onError, onStoreFailure, ...overrides,
  };
  const result = await new MessageProcessor(sandbox, store, send, config, DEFAULT_EXECUTION_OPTIONS)
    .processMessage({ rawContent: 'x', sourceMap: {} }, AbortSignal.timeout(5_000));
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}

const failure = (metaDataId: number, what: string): unknown => ({ channelId: CHANNEL, messageId: MESSAGE, metaDataId, what, errorMessage: 'db refused it' });

describe('a delivered destination whose answer cannot be stored', () => {
  it.each([
    ['its response', CONTENT_TYPE.RESPONSE, {}, 'the response of a delivered destination', ANSWER],
    ['its transformed response', CONTENT_TYPE.RESPONSE_TRANSFORMED, { responseTransformer: { code: 'return "SHORT";' } }, 'the transformed response of a delivered destination', 'SHORT'],
    ['why its response transformer failed', CONTENT_TYPE.PROCESSING_ERROR, { responseTransformer: { code: 'throw new Error("boom");' } }, 'why the response transformer of a delivered destination failed', ANSWER],
  ])('%s: it is reported, and the destination stays SENT and still answers the sender', async (_what, contentType, scripts, what, response) => {
    refuseContent(contentType);

    const processed = await run(scripts);

    expect(onStoreFailure).toHaveBeenCalledExactlyOnceWith(failure(PARTNER, what));
    expect(processed).toMatchObject({ status: 'SENT', response, destinationResults: [{ metaDataId: PARTNER, status: 'SENT' }] });
    expect(store.updateConnectorMessageStatus).toHaveBeenCalledWith(CHANNEL, MESSAGE, PARTNER, 'SENT');
    expect(store.incrementStats).toHaveBeenCalledWith(CHANNEL, PARTNER, 'server-01', 'sent');
  });

  it('still raises the alert for a response transformer that failed', async () => {
    refuseContent(CONTENT_TYPE.PROCESSING_ERROR);

    await run({ responseTransformer: { code: 'throw new Error("boom");' } });

    expect(onError).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ errorMessage: expect.stringContaining('boom') as unknown as string }));
  });
});

describe('a destination that refused the message', () => {
  it.each([
    ['the answer it refused with', CONTENT_TYPE.RESPONSE, 'the response of a failed destination'],
    ['why it failed', CONTENT_TYPE.ERROR, 'why a destination failed'],
  ])('%s cannot be stored: the report names it, and the destination ends in ERROR', async (_what, contentType, what) => {
    send.mockResolvedValue(ok({ status: 'ERROR', content: 'MSA|AE', errorMessage: 'refused' }));
    refuseContent(contentType);

    expect(await run()).toMatchObject({ status: 'ERROR', errorStage: 'DESTINATION' });

    expect(onStoreFailure).toHaveBeenCalledExactlyOnceWith(failure(PARTNER, what));
  });
});

describe('a message that was not sent', () => {
  const refuseStatus = (status: string): void => {
    store.updateConnectorMessageStatus.mockImplementation(async (_c: string, _m: number, _d: number, s: string) => (s === status ? fail('db refused it') : ok(undefined)));
  };

  it('reports the FILTERED status of a message when it cannot be saved', async () => {
    refuseStatus('FILTERED');

    expect(await run({}, { scripts: { sourceFilter: { code: 'return false;' } } })).toMatchObject({ status: 'FILTERED' });

    expect(onStoreFailure).toHaveBeenCalledExactlyOnceWith(failure(0, 'the FILTERED status of a message'));
  });

  it('reports the FILTERED status of a destination when it cannot be saved', async () => {
    refuseStatus('FILTERED');

    expect(await run({ filter: { code: 'return false;' } })).toMatchObject({ destinationResults: [{ metaDataId: PARTNER, status: 'FILTERED' }] });

    expect(onStoreFailure).toHaveBeenCalledExactlyOnceWith(failure(PARTNER, 'the FILTERED status of a destination'));
  });

  it('reports the ERROR status of a message that is not valid when it cannot be saved', async () => {
    refuseStatus('ERROR');

    expect(await run({}, { dataType: 'JSON' })).toMatchObject({ status: 'ERROR', errorStage: 'SOURCE' });

    expect(onStoreFailure).toHaveBeenCalledExactlyOnceWith(failure(0, 'the ERROR status of a failed message'));
  });
});

describe('why something failed, when it cannot be stored', () => {
  const failing = { code: 'throw new Error("boom");' };

  it.each([
    ['is not valid', {}, { dataType: 'JSON' }, 0, 'why a message failed'],
    ['fails in a source script', {}, { scripts: { sourceTransformer: failing } }, 0, 'why a message failed'],
    ['fails in a destination script', { transformer: failing }, {}, PARTNER, 'why a destination failed'],
  ] as const)('is reported by that name and not as a lost status, for a message that %s', async (_what, scripts, overrides, metaDataId, what) => {
    refuseContent(CONTENT_TYPE.PROCESSING_ERROR);

    expect(await run(scripts, overrides)).toMatchObject({ status: 'ERROR' });

    expect(onStoreFailure).toHaveBeenCalledExactlyOnceWith(failure(metaDataId, what));
    expect(store.updateConnectorMessageStatus).toHaveBeenCalledWith(CHANNEL, MESSAGE, metaDataId, 'ERROR');
  });
});

it('reports content that was to be removed once a message was done, and could not be', async () => {
  store.removeCompletedContent.mockResolvedValue(fail('db refused it'));

  expect(await run()).toMatchObject({ status: 'SENT' });

  expect(onStoreFailure).toHaveBeenCalledExactlyOnceWith(failure(0, 'the removal of the content of a completed message'));
});
