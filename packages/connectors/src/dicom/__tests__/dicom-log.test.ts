// No UID of an instance is in a log line of a DICOM connector, or in a text that reaches the log
// or an alert later (#321): each step fails as the file system makes it fail, on real associations.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { format, inspect } from 'node:util';
import pkg from 'dcmjs-dimse';
import { stderr, type Result } from '@galvanigraph/core-util';
import type { ConnectorResponse, DispatchResult, MessageDispatcher, RawMessage } from '../../base.js';
import { DicomDispatcher } from '../dicom-dispatcher.js';
import { DicomReceiver, type DicomReceiverConfig } from '../dicom-receiver.js';
import { fileHeader } from '../dicom-file.js';
import { freePort } from '../../__fixtures__/free-port.js';
import { startFakeScp, type FakeScp, type ScpBehaviour } from '../../__fixtures__/fake-scp.js';

type Failing = 'open' | 'rm' | 'unlink' | 'rename' | 'mkdir' | 'realpath' | 'appendFile' | 'readFile' | 'readdir' | 'access';

/** The file operations that fail, as Node's fail, on a path that holds the text (or ends with it, after a `$`). `flag` limits it to files opened so. */
const failing = vi.hoisted((): { readonly on: Map<string, string>; flag: string | undefined } => ({ on: new Map(), flag: undefined }));
vi.mock('node:fs/promises', async (importActual) => {
  const actual = await importActual<typeof import('node:fs/promises')>();
  const wrap = (syscall: Failing) => (target: string, ...rest: unknown[]): Promise<unknown> => {
    const text = failing.on.get(syscall);
    const meant = text !== undefined && (text.endsWith('$') ? target.endsWith(text.slice(0, -1)) : target.includes(text));
    if (meant && (failing.flag === undefined || rest[0] === failing.flag)) {
      const dest = syscall === 'rename' ? String(rest[0]) : undefined;
      const message = `EBUSY: resource busy or locked, ${syscall} '${target}'${dest === undefined ? '' : ` -> '${dest}'`}`;
      return Promise.reject(Object.assign(new Error(message), { errno: -16, code: 'EBUSY', syscall, path: target, ...(dest === undefined ? {} : { dest }) }));
    }
    return (actual[syscall] as (path: string, ...args: unknown[]) => Promise<unknown>)(target, ...rest);
  };
  return {
    ...actual,
    ...Object.fromEntries((['open', 'rm', 'unlink', 'rename', 'mkdir', 'realpath', 'appendFile', 'readFile', 'readdir', 'access'] as const).map((name) => [name, wrap(name)])),
  };
});

/** What the DICOM libraries print. They take console's methods when they load. */
const printed = vi.hoisted((): unknown[][] => {
  const calls: unknown[][] = [];
  for (const method of ['log', 'info', 'warn', 'error', 'debug', 'trace'] as const) {
    // eslint-disable-next-line no-console
    console[method] = (...args: unknown[]): void => { calls.push(args); };
  }
  return calls;
});

const logged = vi.hoisted((): Record<string, unknown>[] => []);
vi.mock('../../logger.js', async (importActual) => {
  const actual = await importActual<typeof import('../../logger.js')>();
  const line = (fields: Readonly<Record<string, unknown>>, msg: string): void => { logged.push({ ...fields, msg }); };
  return { ...actual, createConnectorLogger: () => ({ error: line, warn: line, info: line, debug: line }) };
});

const { Client, Dataset, constants, requests } = pkg;
const { CStoreRequest } = requests;
const { AbortReason, AbortSource, Status, StorageClass, TransferSyntax } = constants;
type CStoreResponseType = InstanceType<typeof pkg.responses.CStoreResponse>;

/** Every UID of the instance starts with it. */
const ROOT = '1.2.840.99999.7';
const SOP = `${ROOT}.1`;
const NAME = `${SOP}.dcm`;
/** printf %s 1.2.840.99999.7.1.dcm | sha256sum | cut -c1-12 */
const HASH = '2b7b59d38673';
const CT = StorageClass.CtImageStorage;
const SAMPLE_DCM = fileURLToPath(new URL('../../__tests__/e2e/fixtures/sample.dcm', import.meta.url));
const SWEEP_MS = 100;
const PROCESSED: Result<DispatchResult> = { ok: true, value: { messageId: 41, status: 'PROCESSED' }, error: null };
const STORE_DOWN: Result<DispatchResult> = { ok: false, value: null, error: stderr('the store is down') };

let dir: string;
let port: number;
let listener: DicomReceiver | null = null;

beforeEach(async () => {
  failing.on.clear();
  failing.flag = undefined;
  logged.length = 0;
  printed.length = 0;
  dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'dicom-log-')));
  port = await freePort();
});

afterEach(async () => {
  failing.on.clear();
  failing.flag = undefined;
  await listener?.onStop();
  await listener?.onUndeploy();
  listener = null;
  await fs.rm(dir, { recursive: true, force: true });
  expect(lines()).not.toContain(ROOT);
});

const waitFor = <T>(check: () => T | Promise<T>): Promise<T> => vi.waitFor(check, 15_000);

function lines(): string {
  return [...logged.map((entry) => inspect(entry, { depth: 5 })), ...printed.map((args) => format(...args))].join('\n');
}

/** A log line with this message, once there is one. */
async function line(msg: RegExp): Promise<Record<string, unknown>> {
  return waitFor(() => {
    const found = logged.find((entry) => msg.test(String(entry['msg'])));
    if (found === undefined) throw new Error(`No such line in ${JSON.stringify(logged)}`);
    return found;
  });
}

type Pipeline = (raw: RawMessage) => Promise<Result<DispatchResult>>;

async function listen(pipeline: Pipeline, overrides: Partial<DicomReceiverConfig> = {}): Promise<DicomReceiver> {
  const receiver = new DicomReceiver({
    port, storageDir: dir, aeTitle: 'LISTENER', connectionTimeoutMs: 10_000, dispatchMode: 'PER_FILE',
    postAction: 'NONE', moveToDirectory: '', channelId: 'channel-1', roots: { allowed: [dir], denied: [] }, ...overrides,
  }, undefined, SWEEP_MS);
  receiver.setDispatcher(pipeline as MessageDispatcher);
  // What an alert of the source's health says.
  receiver.setHealthHandler((failure) => { if (failure !== null) logged.push({ msg: 'health', health: failure.message }); });
  const started = await receiver.onStart();
  if (!started.ok) throw started.error;
  listener = receiver;
  return receiver;
}

type CStoreRequestType = InstanceType<typeof CStoreRequest>;

/** Give a C-STORE's command this UID as it is: the library cuts one short that is too long. */
function nameInstance(request: CStoreRequestType, uid: string): void {
  const command = request.getCommandDataset();
  const written = command.getDenaturalizedCommandDataset.bind(command);
  command.getDenaturalizedCommandDataset = (): Buffer => {
    const bytes = written();
    // (0000,1000), implicit VR little endian, is the last element.
    const at = bytes.lastIndexOf(Buffer.from([0x00, 0x00, 0x00, 0x10]));
    const header = Buffer.from(bytes.subarray(at, at + 8));
    header.writeUInt32LE(uid.length, 4);
    const elements = Buffer.concat([bytes.subarray(12, at), header, Buffer.from(uid, 'latin1'), bytes.subarray(at + 8 + bytes.readUInt32LE(at + 4))]);
    const length = Buffer.from(bytes.subarray(0, 12));
    length.writeUInt32LE(elements.length, 8);
    return Buffer.concat([length, elements]);
  };
}

/** Store one image; the status it was answered with. */
interface Stored {
  readonly commandUid?: string;
  readonly change?: (dataset: InstanceType<typeof Dataset>) => void;
  readonly abort?: boolean;
  readonly transferSyntax?: string;
}

function store({ commandUid, change, abort = false, transferSyntax = TransferSyntax.ImplicitVRLittleEndian }: Stored = {}): Promise<number | undefined> {
  return new Promise((resolve, reject) => {
    let status: number | undefined;
    const client = new Client();
    const dataset = new Dataset({
      SOPClassUID: CT, SOPInstanceUID: SOP, StudyInstanceUID: `${ROOT}.2`, SeriesInstanceUID: `${ROOT}.3`, PatientName: 'TEST^PATIENT',
    }, transferSyntax);
    const request = new CStoreRequest(dataset);
    change?.(dataset);
    if (commandUid !== undefined) nameInstance(request, commandUid);
    request.on('response', (response: CStoreResponseType) => {
      status = response.getStatus();
      if (abort) client.abort(AbortSource.ServiceUser, AbortReason.NotSpecified);
    });
    client.addRequest(request);
    client.on('networkError', reject);
    client.on('closed', () => { resolve(status); });
    client.send('127.0.0.1', port, 'SCANNER', 'LISTENER', { connectTimeout: 10_000, associationTimeout: 10_000, pduTimeout: 10_000, associationLingerTimeout: abort ? 10_000 : 0 });
  });
}

/** A file the Listener stored before, as the message of it names it. */
async function storedFile(): Promise<string> {
  const file = path.join(dir, NAME);
  await fs.writeFile(file, 'DICM');
  return file;
}

describe('the Listener, while it takes an image', () => {
  it.each<[string, Failing, Pipeline, object]>([
    ['the file cannot be made', 'open', async () => PROCESSED, {}],
    ['the file of a message that was not stored cannot be removed', 'rm', async () => STORE_DOWN, { file: HASH }],
  ])('%s', async (_case, operation, pipeline, named) => {
    failing.on.set(operation, NAME);
    await listen(pipeline);

    expect(await store()).toBe(Status.ProcessingFailure);

    expect(logged.filter((entry) => entry['msg'] === 'DICOM receiver error')).toHaveLength(1);
    expect(await line(/^DICOM receiver error$/)).toMatchObject({
      errMsg: `${operation} failed: EBUSY`, directory: dir, associationId: expect.stringMatching(/^assoc-/) as string, ...named,
    });
  });

  it('its dataset has an element of a wrong length', async () => {
    await listen(async () => PROCESSED);
    // The UID is longer than its element says, so its next bytes are taken for a tag, a VR and a length.
    const explicit = Buffer.concat([Buffer.from([0x08, 0x00, 0x18, 0x00]), Buffer.from('UI'), Buffer.from([0x04, 0x00]), Buffer.from(SOP)]);

    await store({ change: (dataset) => { dataset.getDenaturalizedDataset = (): Buffer => explicit; }, transferSyntax: TransferSyntax.JpegBaseline });

    await line(/^DICOM receiver error$/);
    expect(printed).toEqual([]);
  });

  it('its file cannot be written, which is not kept', async () => {
    failing.on.set('open', NAME);
    failing.flag = 'w';
    await listen(async () => PROCESSED);

    expect(await store()).toBe(Status.ProcessingFailure);

    expect(await line(/^DICOM receiver error$/)).toMatchObject({ errMsg: 'open failed: EBUSY', file: HASH });
    expect(await fs.readdir(dir)).toEqual([]);
  });

  it('the storage directory cannot be made, which the line names', async () => {
    const storageDir = path.join(dir, 'images');
    failing.on.set('mkdir', 'images');
    await listen(async () => PROCESSED, { storageDir });

    expect(await store()).toBe(Status.ProcessingFailure);

    expect(await line(/^DICOM receiver error$/)).toMatchObject({ errMsg: `mkdir failed: EBUSY ${storageDir}`, directory: storageDir });
  });

  it('its dataset cannot be read', async () => {
    await listen(async () => PROCESSED);

    expect(await store({ change: (dataset) => { dataset.getDenaturalizedDataset = (): Buffer => Buffer.from(`${ROOT} is no dataset`); } })).toBe(0xc000);

    expect(await line(/^DICOM receiver error$/)).toMatchObject({ directory: dir, associationId: expect.stringMatching(/^assoc-/) as string });
  });

  it.each([`${ROOT}.${'1'.repeat(64)}`, `${ROOT}.${'1'.repeat(64)}\\1.2`])('the command names the instance by what DICOM does not allow', async (uid) => {
    await listen(async () => PROCESSED);

    expect(await store({ commandUid: uid })).toBe(Status.Success);
  });

  it('its UID is not a DICOM UID', async () => {
    await listen(async () => PROCESSED);

    expect(await store({ change: (dataset) => { dataset.setElement('SOPInstanceUID', `${ROOT}.x`); } })).toBe(Status.ProcessingFailure);

    expect(await line(/^DICOM receiver error$/)).toMatchObject({ errMsg: expect.stringContaining('is not a DICOM UID') as string, directory: dir });
  });

  it('its dataset has no SOP Class UID', async () => {
    await listen(async () => PROCESSED);

    expect(await store({ change: (dataset) => { dataset.setElement('SOPClassUID', ''); } })).toBe(0xc000);

    await line(/^DICOM receiver error$/);
  });

  it('a hundred copies of it wait', async () => {
    const names = Array.from({ length: 100 }, (_, i) => (i === 0 ? NAME : `${SOP}_${String(i + 1)}.dcm`));
    await Promise.all(names.map((name) => fs.writeFile(path.join(dir, name), 'DICM')));
    await listen(async () => PROCESSED);

    expect(await store()).toBe(Status.ProcessingFailure);

    expect(await line(/^DICOM receiver error$/)).toMatchObject({ errMsg: expect.stringContaining('100 copies') as string });
  });

  it('another of the roots cannot be resolved, which the line names', async () => {
    const other = path.join(dir, 'other-root');
    failing.on.set('realpath', 'other-root');
    await listen(async () => PROCESSED, { roots: { allowed: [dir, other], denied: [] } });

    expect(await store()).toBe(Status.ProcessingFailure);

    expect(await line(/^DICOM receiver error$/)).toMatchObject({ errMsg: `realpath failed: EBUSY ${other}`, directory: dir });
  });

  it('the message fails after it was stored', async () => {
    await listen(async (raw) => { raw.onStored?.({ recoverable: true }); return { ok: true, value: { messageId: 41, status: 'ERROR' }, error: null }; });

    expect(await store()).toBe(Status.Success);

    expect(await line(/^DICOM message failed/)).toMatchObject({ directory: dir, associationId: expect.stringMatching(/^assoc-/) as string, file: HASH, messageId: 41 });
  });

  it('a destination fails', async () => {
    await listen(async () => ({ ok: true, value: { messageId: 41, destinationFailed: true }, error: null }));

    await store();

    expect(await line(/had a destination fail/)).toMatchObject({ directory: dir, messageId: 41, file: HASH });
  });

  it.each<[string, Failing, () => string]>([
    ['its line cannot be written to the list of its association', 'appendFile', () => 'appendFile failed: EBUSY'],
    ['the directory of the lists cannot be made, which the line names', 'mkdir', () => `mkdir failed: EBUSY ${path.join(dir, '.galvanigraph-pending', 'channel-1')}`],
  ])('%s', async (_case, operation, errMsg) => {
    failing.on.set(operation, '.galvanigraph-pending');
    await listen(async () => PROCESSED, { dispatchMode: 'PER_ASSOCIATION' });

    expect(await store()).toBe(Status.ProcessingFailure);

    expect(await line(/^DICOM receiver error$/)).toMatchObject({ errMsg: errMsg(), directory: dir, file: HASH });
  });

  it('the message of an association cannot be stored', async () => {
    await listen(async () => STORE_DOWN, { dispatchMode: 'PER_ASSOCIATION' });

    expect(await store()).toBe(Status.Success);

    expect(await line(/could not be stored as a message/)).toMatchObject({ directory: dir, fileCount: 1, errMsg: 'the store is down' });
  });

  it('its association ends without a release', async () => {
    await listen(async () => PROCESSED, { dispatchMode: 'PER_ASSOCIATION' });

    await store({ abort: true });

    expect(await line(/ended without a release/)).toMatchObject({ associationId: expect.stringMatching(/^assoc-/) as string, fileCount: 1 });
  });

  it('its file is gone when its association is recovered', async () => {
    let gone = false;
    await listen(async (raw) => {
      if (!gone) await fs.rm(path.join(dir, NAME));
      gone = true;
      expect(raw.content).toContain(SOP);
      return STORE_DOWN;
    }, { dispatchMode: 'PER_ASSOCIATION' });

    await store();

    expect(await line(/is recovered without images/)).toMatchObject({ missing: 1 });
  });

  it('the associations that wait cannot be listed, whose directory the line names', async () => {
    failing.on.set('readdir', '.galvanigraph-pending');
    await listen(async () => PROCESSED);

    expect(await line(/^health$/)).toMatchObject({ health: `Associations waiting for their message could not be listed (readdir failed: EBUSY ${path.join(dir, '.galvanigraph-pending', 'channel-1')})` });
    expect(await line(/could not be listed/)).toMatchObject({ errMsg: `readdir failed: EBUSY ${path.join(dir, '.galvanigraph-pending', 'channel-1')}`, directory: dir });
  });

  it.each<[string, Failing, string]>([
    ['the list cannot be read', 'readFile', '.jsonl'],
    ['the file on the list cannot be looked up', 'access', NAME],
  ])('%s', async (_case, operation, text) => {
    failing.on.set(operation, text);
    await listen(async () => STORE_DOWN, { dispatchMode: 'PER_ASSOCIATION' });

    await store();

    expect(await line(/^health$/)).toMatchObject({ health: `An association waiting for its message could not be read (${operation} failed: EBUSY)` });
    expect(await line(/could not be read; tried again/)).toMatchObject({ directory: dir, errMsg: `${operation} failed: EBUSY`, associationId: expect.stringMatching(/^assoc-/) as string });
  });
});

describe('the Listener, when it acts on a file after its message', () => {
  const MOVE = (): Partial<DicomReceiverConfig> => ({ postAction: 'MOVE', moveToDirectory: path.join(dir, 'moved') });

  it.each<[string, Failing, string, string, () => Partial<DicomReceiverConfig>]>([
    ['it cannot be deleted', 'unlink', NAME, 'unlink failed: EBUSY', () => ({ postAction: 'DELETE' })],
    ['it cannot be moved', 'rename', NAME, 'rename failed: EBUSY', MOVE],
    ['it cannot be resolved', 'realpath', NAME, `DICOM file ${HASH} could not be checked against FILE_CONNECTOR_ROOTS: realpath failed: EBUSY`, () => ({ postAction: 'DELETE' })],
    ['the directory it is moved to cannot be made, which the line names', 'mkdir', 'moved', 'mkdir failed: EBUSY <moved>', MOVE],
  ])('%s', async (_case, operation, text, errMsg, config) => {
    failing.on.set(operation, text);
    await listen(async () => PROCESSED, config());

    expect(await store()).toBe(Status.Success);

    expect(await line(/^DICOM post-action failed/)).toMatchObject({ errMsg: errMsg.replace('<moved>', path.join(dir, 'moved')), directory: dir, file: HASH, messageId: 41, associationId: expect.stringMatching(/^assoc-/) as string, ...config() });
  });

  it('its directory cannot be made, after its queues have delivered: the alert names it', async () => {
    const filePath = await storedFile();
    failing.on.set('mkdir', 'moved');
    const receiver = await listen(async () => PROCESSED, MOVE());

    await expect(receiver.onMessageDelivered(filePath, 41)).rejects.toThrow(`${HASH} (mkdir failed: EBUSY ${path.join(dir, 'moved')})`);
  });

  it.each<[string, Failing | null, () => Promise<string>, string]>([
    ['it cannot be deleted', 'unlink', storedFile, 'unlink failed: EBUSY'],
    ['it is outside the roots', null, async () => path.join(os.homedir(), ROOT, NAME), `The path of DICOM file ${HASH} is outside FILE_CONNECTOR_ROOTS`],
    ['its path is not absolute', null, async () => NAME, `The path of DICOM file ${HASH} must be absolute`],
    ['it is not in the storage directory', null, async () => path.join(dir, ROOT, NAME), `DICOM file ${HASH} is not a file in the DICOM storage directory`],
  ])('%s, after its queues have delivered: the alert and the log', async (_case, operation, file, text) => {
    const filePath = await file();
    if (operation !== null) failing.on.set(operation, NAME);
    const receiver = await listen(async () => PROCESSED, { postAction: 'DELETE' });

    const alert = await receiver.onMessageDelivered(filePath, 41).then(() => null, (err: unknown) => (err as Error).message);

    expect(alert).toBe(`DICOM post-action failed for 1 file(s), left in place: ${HASH} (${text})`);
    expect(await line(/^DICOM post-action failed/)).toMatchObject({ errMsg: text, directory: dir, file: HASH, messageId: 41 });
  });
});

describe('the Sender, whose ERROR text is stored, logged and put in alerts', () => {
  let scp: FakeScp | null = null;

  afterEach(() => {
    scp?.close();
    scp = null;
  });

  async function send(content: string, behaviour: ScpBehaviour = { answer: 0 }, roots = [dir]): Promise<ConnectorResponse> {
    scp = await startFakeScp(behaviour);
    const dispatcher = new DicomDispatcher({
      host: '127.0.0.1', port: scp.port, calledAETitle: 'ARCHIVE', callingAETitle: 'SCU',
      maxRetries: 0, retryDelayMs: 0, timeoutMs: 5_000, roots: { allowed: roots, denied: [path.join(dir, 'denied')] },
    });
    await dispatcher.onStart();
    const result = await dispatcher.send({ channelId: 'ch', messageId: 1, metaDataId: 1, content, dataType: 'RAW' }, new AbortController().signal);
    if (!result.ok) throw result.error;
    return result.value;
  }

  /** An image whose dataset gives this SOP Instance UID. */
  async function image(uid: string): Promise<string> {
    const element = (group: number, number: number, value: string): Buffer => {
      const bytes = Buffer.from(value.length % 2 === 0 ? value : `${value}\0`, 'latin1');
      const header = Buffer.alloc(8);
      header.writeUInt16LE(group, 0);
      header.writeUInt16LE(number, 2);
      header.writeUInt32LE(bytes.length, 4);
      return Buffer.concat([header, bytes]);
    };
    const file = path.join(dir, NAME);
    const header = fileHeader({ sopClass: CT, sopInstance: SOP, transferSyntax: TransferSyntax.ImplicitVRLittleEndian, implementationClass: '1.2.3', implementationVersion: 'TEST' });
    await fs.writeFile(file, Buffer.concat([header, element(0x0008, 0x0016, CT), element(0x0008, 0x0018, uid)]));
    return file;
  }

  it.each<[string, () => string, string]>([
    ['outside the roots', () => path.join(os.homedir(), ROOT, NAME), `The path of DICOM file ${HASH} is outside FILE_CONNECTOR_ROOTS`],
    ['relative', () => `${ROOT}/${NAME}`, 'The message content is not the absolute path of a DICOM file'],
    ['in a list, as a Listener\'s association is', () => JSON.stringify([path.join(dir, NAME)]), 'The message content is not the absolute path of a DICOM file'],
    ['in a denied directory', () => path.join(dir, 'denied', ROOT, NAME), `The path of DICOM file ${HASH} is in one of the server's own directories, which File connectors may not use`],
    ['of a file that is not there', () => path.join(dir, ROOT, NAME), `DICOM file ${HASH} cannot be read: open failed: ENOENT`],
    ['with a U+0000 in it', () => path.join(dir, `${ROOT}\0`, NAME), `DICOM file ${HASH} could not be checked against FILE_CONNECTOR_ROOTS: file operation failed: ERR_INVALID_ARG_VALUE`],
  ])('a path %s', async (_case, content, errorMessage) => {
    expect(await send(content())).toEqual({ status: 'ERROR', content: '', errorMessage });
  });

  it.each<[Failing, string]>([
    ['realpath', `DICOM file ${HASH} could not be checked against FILE_CONNECTOR_ROOTS: realpath failed: EBUSY`],
    ['readFile', `DICOM file ${HASH} cannot be read: readFile failed: EBUSY`],
  ])('a file that cannot be read (%s)', async (operation, errorMessage) => {
    const file = await storedFile();
    failing.on.set(operation, NAME);

    expect(await send(file)).toEqual({ status: 'ERROR', content: '', errorMessage });
  });

  it.each<ScpBehaviour>(['reject-contexts', 'reject-association', 'abort', 'close', { answer: 0xa700 }])('an archive that does not take the image (%j)', async (behaviour) => {
    const response = await send(await image(SOP), behaviour);

    expect(response.status).toBe('ERROR');
    expect(response.errorMessage).not.toContain(ROOT);
  });

  it('what the library prints is seen here', async () => {
    await send(await image(SOP), 'reject-contexts');

    expect(lines()).toContain('Could not find an accepted presentation context');
  });

  it('a denied directory that cannot be resolved is named', async () => {
    failing.on.set('realpath', 'denied');

    expect((await send(await storedFile())).errorMessage).toContain(`realpath failed: EBUSY ${path.join(dir, 'denied')}`);
  });

  it('what a root is in is named, when that cannot be resolved', async () => {
    failing.on.set('realpath', 'drive$');

    const { errorMessage } = await send(await storedFile(), { answer: 0 }, [path.join(dir, 'drive', 'root'), dir]);

    expect(errorMessage).toContain(`realpath failed: EBUSY ${path.join(dir, 'drive')}`);
  });

  it('a root that cannot be resolved is named', async () => {
    const other = path.join(dir, 'other-root');
    failing.on.set('realpath', 'other-root');

    expect((await send(await storedFile(), { answer: 0 }, [other, dir])).errorMessage)
      .toBe(`DICOM file ${HASH} could not be checked against FILE_CONNECTOR_ROOTS: realpath failed: EBUSY ${other}`);
  });

  it('an image whose UID is longer than DICOM allows', async () => {
    await send(await image(`${ROOT}.${'1'.repeat(64)}`));

    expect(scp?.stores()).toBe(1);
  });

  it('a real image is sent without a line', async () => {
    expect((await send(SAMPLE_DCM, { answer: 0 }, [path.dirname(SAMPLE_DCM)])).status).toBe('SENT');
    expect(logged).toEqual([]);
    expect(printed).toEqual([]);
  });
});
