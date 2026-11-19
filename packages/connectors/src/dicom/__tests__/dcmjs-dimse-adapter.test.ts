// ===========================================
// dcmjs-dimse adapter: where the SCP writes (#313)
// ===========================================
// A real SCP on a local port, fed C-STOREs by a real dcmjs-dimse client, so
// the SOP Instance UID that names the file comes off the wire.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import pkg from 'dcmjs-dimse';
import { createDimseReceiver } from '../dcmjs-dimse-adapter.js';
import type { DcmtkFileData, DcmtkReceiver } from '../dicom-receiver.js';
import type { FileRoots } from '../../file/file-roots.js';

const { Client, Dataset, constants, requests } = pkg;
const { CStoreRequest } = requests;
const { TransferSyntax, Status } = constants;

const PORT = 11121;
const SECONDARY_CAPTURE = '1.2.840.10008.5.1.4.1.1.7';

let base: string;
let storageDir: string;
let receiver: DcmtkReceiver | null = null;
let received: DcmtkFileData[] = [];

beforeEach(async () => {
  base = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'dicom-adapter-')));
  storageDir = path.join(base, 'in');
  received = [];
});

afterEach(async () => {
  await receiver?.stop();
  receiver = null;
  await fs.rm(base, { recursive: true, force: true });
});

async function startScp(roots: FileRoots, dir = storageDir): Promise<void> {
  const created = createDimseReceiver({ port: PORT, storageDir: dir, aeTitle: 'SCP', connectionTimeoutMs: 5_000, roots });
  if (!created.ok) throw created.error;
  receiver = created.value;
  receiver.onFileReceived((data) => { received.push(data); });
  const started = await receiver.start();
  if (!started.ok) throw started.error;
}

/** C-STORE one instance with this SOP Instance UID; resolves the response status. */
function store(sopInstanceUid: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const dataset = new Dataset({
      SOPClassUID: SECONDARY_CAPTURE,
      SOPInstanceUID: sopInstanceUid,
      PatientName: 'TEST^PATIENT',
      Modality: 'OT',
    }, TransferSyntax.ImplicitVRLittleEndian);
    const request = new CStoreRequest(dataset);
    let status = -1;
    request.on('response', (response: { getStatus(): number }) => { status = response.getStatus(); });
    const client = new Client();
    client.addRequest(request);
    client.on('networkError', reject);
    client.on('closed', () => { resolve(status); });
    client.send('127.0.0.1', PORT, 'SCU', 'SCP', { connectTimeout: 5_000, associationTimeout: 5_000, pduTimeout: 5_000 });
  });
}

async function filesUnder(dir: string): Promise<string[]> {
  const entries = await fs.readdir(dir, { recursive: true }).catch(() => [] as string[]);
  return entries.map(String).sort();
}

describe('DICOM SCP storage', () => {
  it('writes <SOPInstanceUID>.dcm inside the storage directory', async () => {
    await startScp({ allowed: [base], denied: [] });

    expect(await store('1.2.840.113619.2.55.3')).toBe(Status.Success);

    expect(await filesUnder(storageDir)).toEqual(['1.2.840.113619.2.55.3.dcm']);
    expect(received[0]?.filePath).toBe(path.join(storageDir, '1.2.840.113619.2.55.3.dcm'));
  });

  // dcmjs drops every character but digits and dots when it reads a UI value,
  // so these are what reaches the SCP from inputs a sender could craft.
  it.each([
    ['a path that climbs out', '../../escaped'],
    ['only dots', '..'],
    ['letters', '1.2.abc'],
    ['an empty component', '1..2'],
    ['a trailing dot', '1.2.'],
  ])('refuses a SOP Instance UID with %s and writes nothing', async (_case, uid) => {
    await startScp({ allowed: [base], denied: [] });

    expect(await store(uid)).toBe(Status.ProcessingFailure);

    expect(await filesUnder(base)).toEqual([]);
    expect(received).toEqual([]);
  });

  it('refuses to write when the storage directory is outside the roots', async () => {
    const roots = path.join(base, 'roots');
    await fs.mkdir(roots);
    await startScp({ allowed: [roots], denied: [] });

    expect(await store('1.2.3')).toBe(Status.ProcessingFailure);

    expect(await filesUnder(base)).toEqual(['roots']);
    expect(received).toEqual([]);
  });

  it('refuses to write once the storage directory has been swapped for a link out of the roots', async () => {
    const roots = path.join(base, 'roots');
    const outside = path.join(base, 'outside');
    const dir = path.join(roots, 'in');
    await fs.mkdir(dir, { recursive: true });
    await fs.mkdir(outside);
    await startScp({ allowed: [roots], denied: [] }, dir);
    expect(await store('1.2.3')).toBe(Status.Success);

    await fs.rm(dir, { recursive: true });
    await fs.symlink(outside, dir, 'junction');

    expect(await store('1.2.4')).toBe(Status.ProcessingFailure);
    expect(await filesUnder(outside)).toEqual([]);
  });
});
