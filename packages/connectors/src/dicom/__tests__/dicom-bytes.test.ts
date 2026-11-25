// An image's bytes go through as they came: private attributes, tags nobody knows and number text
// included (#410). The datasets are built here byte by byte, and go over real associations.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { deflateRawSync } from 'node:zlib';
import pkg from 'dcmjs-dimse';
import { createDimseReceiver } from '../dcmjs-dimse-adapter.js';
import { createDimseSender } from '../dimse-sender.js';
import { explicitToImplicit, fileHeader, readDicomFile } from '../dicom-file.js';
import type { DcmtkFileData, DcmtkReceiver } from '../dicom-receiver.js';
import { startFakeScp, type FakeScp } from '../../__fixtures__/fake-scp.js';
import { freePort } from '../../__fixtures__/free-port.js';

const { Client, Dataset, association, constants, requests } = pkg;
const { PresentationContext } = association;
const { CStoreRequest } = requests;
const { Status, StorageClass } = constants;

const IMPLICIT = '1.2.840.10008.1.2';
const EXPLICIT = '1.2.840.10008.1.2.1';
const DEFLATED = '1.2.840.10008.1.2.1.99';
const JPEG_BASELINE = '1.2.840.10008.1.2.4.50';
const UNDEFINED = 0xffffffff;
const SOP_CLASS = StorageClass.MrImageStorage;
const SOP_INSTANCE = '1.2.840.99.7';

const LONG = new Set(['OB', 'OW', 'SQ', 'UN', 'UT']);

type Value = string | Buffer | readonly Element[];
/** A sequence's value is its one item's elements. `length` says how a sequence and its item are ended. */
interface Element {
  readonly tag: readonly [number, number];
  readonly vr: string;
  readonly value: Value;
  readonly length?: 'defined' | 'undefined';
}

function header(tag: readonly [number, number], vr: string | null, length: number): Buffer {
  const long = vr !== null && LONG.has(vr);
  const bytes = Buffer.alloc(long ? 12 : 8);
  bytes.writeUInt16LE(tag[0], 0);
  bytes.writeUInt16LE(tag[1], 2);
  if (vr === null) bytes.writeUInt32LE(length, 4);
  else {
    bytes.write(vr, 4, 'latin1');
    if (long) bytes.writeUInt32LE(length, 8);
    else bytes.writeUInt16LE(length, 6);
  }
  return bytes;
}

const ITEM: readonly [number, number] = [0xfffe, 0xe000];
const ITEM_END: readonly [number, number] = [0xfffe, 0xe00d];
const SEQUENCE_END: readonly [number, number] = [0xfffe, 0xe0dd];

/** In explicit VR, or in implicit VR with every sequence ended by a delimiter, as the conversion writes it. */
function encode(elements: readonly Element[], explicit: boolean): Buffer {
  return Buffer.concat(elements.map(({ tag, vr, value, length }) => {
    if (typeof value === 'string' || Buffer.isBuffer(value)) {
      const bytes = Buffer.from(value);
      return Buffer.concat([header(tag, explicit ? vr : null, bytes.length), bytes]);
    }
    const item = encode(value, explicit);
    if (explicit && length === 'defined') {
      return Buffer.concat([header(tag, vr, item.length + 8), header(ITEM, null, item.length), item]);
    }
    return Buffer.concat([
      header(tag, explicit ? vr : null, UNDEFINED), header(ITEM, null, UNDEFINED), item, header(ITEM_END, null, 0), header(SEQUENCE_END, null, 0),
    ]);
  }));
}

const ELEMENTS: readonly Element[] = [
  { tag: [0x0008, 0x0016], vr: 'UI', value: `${SOP_CLASS}\0` },
  { tag: [0x0008, 0x0018], vr: 'UI', value: SOP_INSTANCE },
  { tag: [0x0008, 0x1140], vr: 'SQ', length: 'defined', value: [
    { tag: [0x0008, 0x1150], vr: 'UI', value: '1.2.34' },
    { tag: [0x0009, 0x0010], vr: 'LO', value: 'ACME' },
    { tag: [0x0009, 0x1001], vr: 'DS', value: '0.10' },
  ] },
  { tag: [0x0009, 0x0010], vr: 'LO', value: 'ACME 1.0' },
  { tag: [0x0009, 0x1001], vr: 'UN', value: Buffer.from([1, 2, 3, 0xff]) },
  { tag: [0x0009, 0x1002], vr: 'SQ', length: 'undefined', value: [
    { tag: [0x0009, 0x0010], vr: 'LO', value: 'ACME' },
    { tag: [0x0009, 0x1003], vr: 'SQ', length: 'defined', value: [{ tag: [0x0009, 0x1004], vr: 'OB', value: Buffer.from([9, 9]) }] },
  ] },
  { tag: [0x0010, 0x0010], vr: 'PN', value: 'DOE^JOHN^' + ' ' },
  // A standard group and an element no dictionary has.
  { tag: [0x0018, 0xfffe], vr: 'LO', value: 'no such tag ' },
  { tag: [0x0018, 0x0050], vr: 'DS', value: '1.50' },
  { tag: [0x0020, 0x0013], vr: 'IS', value: '007 ' },
];
const NATIVE: readonly Element[] = [...ELEMENTS, { tag: [0x7fe0, 0x0010], vr: 'OW', value: Buffer.from([0, 1, 2, 3]) }];

const EXPLICIT_BYTES = encode(NATIVE, true);
const ENCAPSULATED = Buffer.concat([
  encode(ELEMENTS, true),
  header([0x7fe0, 0x0010], 'OB', UNDEFINED), header(ITEM, null, 0), header(ITEM, null, 4), Buffer.from([0xff, 0xd8, 0xff, 0xd9]), header(SEQUENCE_END, null, 0),
]);
const DATASETS: readonly (readonly [string, string, Buffer])[] = [
  ['explicit VR', EXPLICIT, EXPLICIT_BYTES],
  ['implicit VR', IMPLICIT, encode(NATIVE, false)],
  ['compressed', JPEG_BASELINE, ENCAPSULATED],
  ['deflated', DEFLATED, deflateRawSync(EXPLICIT_BYTES)],
];

let dir: string;
let port: number;
let receiver: DcmtkReceiver | null = null;
let received: DcmtkFileData[] = [];
let scp: FakeScp | null = null;

beforeEach(async () => {
  dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'dicom-bytes-')));
  port = await freePort();
  received = [];
});

afterEach(async () => {
  await receiver?.stop();
  receiver = null;
  scp?.close();
  scp = null;
  await fs.rm(dir, { recursive: true, force: true });
});

async function startListener(): Promise<void> {
  const created = createDimseReceiver({ port, storageDir: path.join(dir, 'in'), aeTitle: 'SCP', connectionTimeoutMs: 10_000, roots: { allowed: [dir], denied: [] } });
  if (!created.ok) throw created.error;
  receiver = created.value;
  receiver.onFileReceived(async (data) => { received.push(data); });
  const started = await receiver.start();
  if (!started.ok) throw started.error;
}

class RawDataset extends Dataset {
  constructor(private readonly bytes: Buffer, transferSyntax: string) {
    super({ SOPClassUID: SOP_CLASS, SOPInstanceUID: SOP_INSTANCE }, transferSyntax);
  }
  override getDenaturalizedDataset(): Buffer { return this.bytes; }
}

/** C-STORE these bytes on one association with a sender that is not ours; the statuses. */
function store(datasets: readonly (readonly [string, Buffer])[]): Promise<number[]> {
  return new Promise((resolve, reject) => {
    const statuses: number[] = [];
    const client = new Client();
    for (const [transferSyntax, bytes] of datasets) {
      const request = new CStoreRequest(new RawDataset(bytes, transferSyntax));
      request.on('response', (response: { getStatus(): number }) => { statuses.push(response.getStatus()); });
      client.addRequest(request);
      // Alone in a context, so the listener takes these bytes and not another encoding of them.
      client.addAdditionalPresentationContext(new PresentationContext(0, SOP_CLASS, transferSyntax), true);
    }
    client.on('networkError', reject);
    client.on('closed', () => { resolve(statuses); });
    client.send('127.0.0.1', port, 'SCU', 'SCP', { connectTimeout: 10_000, associationTimeout: 10_000, pduTimeout: 10_000 });
  });
}

async function fileOf(dataset: Buffer, transferSyntax: string): Promise<string> {
  const file = path.join(dir, 'image.dcm');
  const meta = fileHeader({ sopClass: SOP_CLASS, sopInstance: SOP_INSTANCE, transferSyntax, implementationClass: '1.2.3', implementationVersion: 'TEST' });
  await fs.writeFile(file, Buffer.concat([meta, dataset]));
  return file;
}

/** Send a file with this dataset to an archive that takes these transfer syntaxes, in its order; null: the first proposed. */
async function send(dataset: Buffer, transferSyntax: string, accepts: readonly string[] | null): Promise<string> {
  scp = await startFakeScp({ answer: 0x0000 }, accepts);
  const sender = createDimseSender({ host: '127.0.0.1', port: scp.port, calledAETitle: 'A', callingAETitle: 'B', maxRetries: 0, retryDelayMs: 0, timeoutMs: 10_000 });
  if (!sender.ok) throw sender.error;
  const result = await sender.value.send([await fileOf(dataset, transferSyntax)]);
  return result.ok ? 'sent' : result.error.message;
}

describe('a received image', () => {
  it.each(DATASETS)('is stored with its dataset byte for byte: %s', async (_case, transferSyntax, bytes) => {
    await startListener();

    expect(await store([[transferSyntax, bytes]])).toEqual([Status.Success]);

    const file = await fs.readFile(path.join(dir, 'in', `${SOP_INSTANCE}.dcm`));
    const read = readDicomFile(file);
    expect(read.transferSyntax).toBe(transferSyntax);
    expect(read.dataset.equals(bytes)).toBe(true);
    // The library reads it as the DICOM file it is.
    const meta = Dataset.fromFile(path.join(dir, 'in', `${SOP_INSTANCE}.dcm`));
    expect(meta?.getElement('SOPInstanceUID')).toBe(SOP_INSTANCE);
  });

  it.each(DATASETS)('gives its attributes to the source map: %s', async (_case, transferSyntax, bytes) => {
    await startListener();

    await store([[transferSyntax, bytes]]);

    expect(received[0]?.instance.dataset).toMatchObject({ SOPInstanceUID: SOP_INSTANCE, SliceThickness: 1.5 });
  });

  it('is refused as not understood when its dataset cannot be read, and the next one is stored', async () => {
    await startListener();

    expect(await store([[DEFLATED, EXPLICIT_BYTES], [EXPLICIT, EXPLICIT_BYTES]])).toEqual([0xc000, Status.Success]);

    expect(await fs.readdir(path.join(dir, 'in'))).toEqual([`${SOP_INSTANCE}.dcm`]);
  });
});

describe('a sent image', () => {
  it.each(DATASETS.flatMap(([name, transferSyntax, bytes]) => [
    [name, 'takes what is proposed first', transferSyntax, bytes, null] as const,
    [name, 'prefers explicit VR', transferSyntax, bytes, [EXPLICIT, IMPLICIT, transferSyntax]] as const,
    [name, 'prefers implicit VR', transferSyntax, bytes, [IMPLICIT, EXPLICIT, transferSyntax]] as const,
  ]))('arrives byte for byte: %s, at an archive that %s', async (_name, _archive, transferSyntax, bytes, accepts) => {
    expect(await send(bytes, transferSyntax, accepts)).toBe('sent');

    expect(scp?.received).toHaveLength(1);
    expect(scp?.received[0]?.transferSyntax).toBe(transferSyntax);
    expect(scp?.received[0]?.dataset.equals(bytes)).toBe(true);
  });

  it('arrives with every element and value at an archive that takes only implicit VR', async () => {
    expect(await send(EXPLICIT_BYTES, EXPLICIT, [IMPLICIT])).toBe('sent');

    expect(scp?.received[0]?.transferSyntax).toBe(IMPLICIT);
    expect(scp?.received[0]?.dataset.equals(encode(NATIVE, false))).toBe(true);
  });

  it.each([
    ['compressed', JPEG_BASELINE, ENCAPSULATED, [EXPLICIT, IMPLICIT]],
    ['deflated', DEFLATED, deflateRawSync(EXPLICIT_BYTES), [EXPLICIT, IMPLICIT]],
    ['implicit VR', IMPLICIT, encode(NATIVE, false), [EXPLICIT]],
  ] as const)('is refused, with the reason, rather than changed: %s, at an archive that does not take it', async (_name, transferSyntax, bytes, accepts) => {
    const outcome = await send(bytes, transferSyntax, accepts);

    expect(outcome).toContain(`does not accept the image's transfer syntax ${transferSyntax}`);
    expect(scp?.stores()).toBe(0);
  });

  it.each([
    ['is not DICOM', Buffer.from('not a DICOM file')],
    ['names no transfer syntax', Buffer.concat([Buffer.alloc(128), Buffer.from('DICM')])],
    ['has no SOP instance', null],
  ])('is an error when the file %s', async (_case, content) => {
    scp = await startFakeScp({ answer: 0x0000 });
    const sender = createDimseSender({ host: '127.0.0.1', port: scp.port, calledAETitle: 'A', callingAETitle: 'B', maxRetries: 0, retryDelayMs: 0, timeoutMs: 10_000 });
    if (!sender.ok) throw sender.error;
    const file = await fileOf(encode([{ tag: [0x0010, 0x0010], vr: 'PN', value: 'DOE^' }], true), EXPLICIT);
    if (content) await fs.writeFile(file, content);

    expect((await sender.value.send([file])).ok).toBe(false);
    expect(scp.stores()).toBe(0);
  });
});

describe('explicitToImplicit', () => {
  it('keeps a sequence of unknown VR and undefined length as it is, which is implicit VR already', () => {
    const inner = encode([{ tag: [0x0009, 0x1004], vr: 'SQ', value: [{ tag: [0x0009, 0x1005], vr: 'LO', value: 'ab' }] }], false);
    const rest = Buffer.concat([header(ITEM, null, UNDEFINED), inner, header(ITEM_END, null, 0), header(SEQUENCE_END, null, 0)]);
    const after = { tag: [0x0010, 0x0010], vr: 'PN', value: 'DOE^' } as const;

    const converted = explicitToImplicit(Buffer.concat([header([0x0009, 0x1003], 'UN', UNDEFINED), rest, encode([after], true)]));

    expect(converted.equals(Buffer.concat([header([0x0009, 0x1003], null, UNDEFINED), rest, encode([after], false)]))).toBe(true);
  });

  it('keeps empty sequences and items', () => {
    const empty = Buffer.concat([header([0x0008, 0x1140], 'SQ', 0), header([0x0009, 0x1002], 'SQ', 8), header(ITEM, null, 0)]);

    expect(explicitToImplicit(empty).equals(Buffer.concat([
      header([0x0008, 0x1140], null, 0), header([0x0009, 0x1002], null, UNDEFINED), header(ITEM, null, 0), header(SEQUENCE_END, null, 0),
    ]))).toBe(true);
  });

  it('leaves out group lengths, which count the bytes of the other encoding', () => {
    const length = Buffer.from([4, 0, 0, 0]);
    expect(explicitToImplicit(Buffer.concat([header([0x0008, 0x0000], 'UL', 4), length])).length).toBe(0);
  });

  it.each([
    ['a value', EXPLICIT_BYTES.subarray(0, EXPLICIT_BYTES.length - 1)],
    ['a header', EXPLICIT_BYTES.subarray(0, EXPLICIT_BYTES.length - 10)],
    ['a sequence', Buffer.concat([header([0x0009, 0x1002], 'SQ', UNDEFINED), header(ITEM, null, UNDEFINED)])],
  ])('refuses a dataset cut short in %s', (_case, bytes) => {
    expect(() => explicitToImplicit(bytes)).toThrow();
  });

  it('refuses compressed pixel data', () => {
    expect(() => explicitToImplicit(ENCAPSULATED)).toThrow('compressed');
  });
});
