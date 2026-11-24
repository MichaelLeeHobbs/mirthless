// TCP/MLLP + Channel connectors are covered in real-messaging.e2e.test.ts.
// This file adds File and HTTP. Each new connector added here is a small,
// self-contained block following the same shape.

import { describe, it, expect, afterEach, vi } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import * as http from 'node:http';
import { gzipSync } from 'node:zlib';
import {
  FileReceiver,
  FileDispatcher,
  FILE_SORT_BY,
  FILE_POST_ACTION,
  HttpReceiver,
  HttpDispatcher,
  FhirDispatcher,
} from '../../index.js';
import { deployChannel, teardownAll, type DeployedChannel } from './support/e2e-harness.js';
import { mllpSource, sendMllp } from './support/tcp-helpers.js';
import { freePort } from '../../__fixtures__/free-port.js';

/** Inside each test's 15 s budget, so a miss names the wait. */
const DELIVERY_WAIT = { timeout: 10_000, interval: 10 } as const;

let deployed: DeployedChannel[] = [];
const tempDirs: string[] = [];
const servers: http.Server[] = [];

afterEach(async () => {
  await teardownAll(deployed);
  deployed = [];
  for (const s of servers.splice(0)) await new Promise<void>((r) => s.close(() => { r(); }));
  for (const d of tempDirs.splice(0)) await fs.rm(d, { recursive: true, force: true });
});

describe('File connector (drop a file in → transform → write a file out)', () => {
  it('picks up a dropped file, transforms it, and writes the result to the destination dir', async () => {
    const srcDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mless-file-src-'));
    const destDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mless-file-dst-'));
    tempDirs.push(srcDir, destDir);

    const channel = await deployChannel({
      channelId: '00000000-0000-0000-0000-connfile0001',
      dataType: 'RAW',
      source: new FileReceiver({
        directory: srcDir,
        fileFilter: '*.hl7',
        pollingIntervalMs: 100,
        sortBy: FILE_SORT_BY.NAME,
        charset: 'utf-8',
        binary: false,
        checkFileAge: false,
        fileAgeMs: 0,
        postAction: FILE_POST_ACTION.DELETE,
        moveToDirectory: '',
        ignoreDot: true,
        roots: { allowed: [srcDir, destDir], denied: [] },
      }),
      transformer: "return String(msg) + '::processed';",
      destinations: [{
        metaDataId: 1,
        name: 'File Out',
        connector: new FileDispatcher({
          directory: destDir,
          outputPattern: '${messageId}.out',
          charset: 'utf-8',
          binary: false,
          tempFileEnabled: false,
          appendMode: false,
          roots: { allowed: [srcDir, destDir], denied: [] },
        }),
      }],
    });
    deployed.push(channel);

    await fs.writeFile(path.join(srcDir, 'input.hl7'), 'MSH|^~\\&|FILE|IN');

    const outPath = path.join(destDir, '1.out');
    await vi.waitFor(async () => { await fs.access(outPath); }, DELIVERY_WAIT);

    const written = await fs.readFile(outPath, 'utf-8');
    expect(written).toBe('MSH|^~\\&|FILE|IN::processed');
    expect(channel.store.messageCount()).toBe(1);

    const remaining = await fs.readdir(srcDir);
    expect(remaining).not.toContain('input.hl7');
  }, 15_000);
});

describe('HTTP connector (POST in → transform → POST out to a downstream server)', () => {
  it('receives HTTP POSTs, gzip included, transforms the body, delivers it to a downstream HTTP server, and refuses a binary body', async () => {
    const received: string[] = [];
    const downstream = http.createServer((req, res) => {
      let body = '';
      req.on('data', (chunk) => { body += String(chunk); });
      req.on('end', () => { received.push(body); res.writeHead(200); res.end('OK'); });
    });
    await listen(downstream, DOWNSTREAM_PORT);
    servers.push(downstream);

    const channel = await deployChannel({
      channelId: '00000000-0000-0000-0000-connhttp0001',
      dataType: 'RAW',
      source: new HttpReceiver({
        host: '127.0.0.1',
        port: HTTP_SRC_PORT,
        path: '/in',
        method: 'POST',
        responseContentType: 'text/plain',
        responseStatusCode: 200,
        errorStatusCode: 500,
        maxBodyBytes: 1_000_000,
        bodyCharset: 'utf-8',
      }),
      transformer: 'return String(msg).toUpperCase();',
      destinations: [{
        metaDataId: 1,
        name: 'HTTP Out',
        connector: new HttpDispatcher({
          url: `http://127.0.0.1:${String(DOWNSTREAM_PORT)}/out`,
          method: 'POST',
          headers: {},
          contentType: 'text/plain',
          responseTimeout: 5_000,
        }),
      }],
    });
    deployed.push(channel);

    const response = await httpPost(HTTP_SRC_PORT, '/in', 'hello world');
    expect(response.status).toBe(200);

    await vi.waitFor(() => { expect(received).toHaveLength(1); }, DELIVERY_WAIT);
    expect(received[0]).toBe('HELLO WORLD');
    expect(channel.store.messageCount()).toBe(1);

    const compressed = await httpPost(HTTP_SRC_PORT, '/in', gzipSync('müller'), { 'Content-Encoding': 'gzip' });
    expect(compressed.status).toBe(200);
    await vi.waitFor(() => { expect(received).toEqual(['HELLO WORLD', 'MÜLLER']); }, DELIVERY_WAIT);
    expect(channel.store.messageCount()).toBe(2);

    // Not UTF-8, so it is refused before a message exists.
    const binary = await httpPost(HTTP_SRC_PORT, '/in', Buffer.from([0x25, 0x50, 0x44, 0x46, 0xe2, 0xe3]));
    expect(binary.status).toBe(415);
    expect(channel.store.messageCount()).toBe(2);
  }, 15_000);
});

describe('FHIR connector (POST a resource in → transform to FHIR → POST to a FHIR server)', () => {
  it('transforms the message into a FHIR Patient and POSTs it to a FHIR endpoint', async () => {
    const received: { path: string; contentType: string; body: string }[] = [];
    const fhirServer = http.createServer((req, res) => {
      let body = '';
      req.on('data', (chunk) => { body += String(chunk); });
      req.on('end', () => {
        received.push({ path: req.url ?? '', contentType: req.headers['content-type'] ?? '', body });
        res.writeHead(201, { 'Content-Type': 'application/fhir+json', Location: '/Patient/123' });
        res.end(body);
      });
    });
    await listen(fhirServer, FHIR_PORT);
    servers.push(fhirServer);

    const channel = await deployChannel({
      channelId: '00000000-0000-0000-0000-connfhir0001',
      dataType: 'RAW',
      source: mllpSource(FHIR_SRC_PORT, { maxConnections: 10 }),
      transformer: [
        "const pid = String(msg).split(String.fromCharCode(13)).find((l) => l.indexOf('PID') === 0) || '';",
        "const name = (pid.split('|')[5] || '').split('^');",
        'const patient = { resourceType: "Patient", name: [{ family: name[0] || "", given: [name[1] || ""] }] };',
        'return JSON.stringify(patient);',
      ].join('\n'),
      destinations: [{
        metaDataId: 1,
        name: 'FHIR Out',
        connector: new FhirDispatcher({
          baseUrl: `http://127.0.0.1:${String(FHIR_PORT)}`,
          resourceType: 'Patient',
          method: 'POST',
          authType: 'NONE',
          authConfig: {},
          format: 'json',
          timeout: 5_000,
          headers: {},
        }),
      }],
    });
    deployed.push(channel);

    await sendMllp(FHIR_SRC_PORT, [
      'MSH|^~\\&|S|F|R|F|20260101||ADT^A01|1|P|2.5',
      'PID|||1^^^MRN||DOE^JOHN',
    ].join('\r'));

    await vi.waitFor(() => { expect(received).toHaveLength(1); }, DELIVERY_WAIT);
    const posted = received[0];
    expect(posted?.path).toBe('/Patient');
    expect(posted?.contentType).toContain('application/fhir+json');
    const resource = JSON.parse(posted?.body ?? '{}') as { resourceType: string; name: { family: string; given: string[] }[] };
    expect(resource.resourceType).toBe('Patient');
    expect(resource.name[0]?.family).toBe('DOE');
    expect(resource.name[0]?.given[0]).toBe('JOHN');
  });
});

const HTTP_SRC_PORT = await freePort();
const DOWNSTREAM_PORT = await freePort();
const FHIR_PORT = await freePort();
const FHIR_SRC_PORT = await freePort();

async function listen(server: http.Server, port: number): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => { resolve(); });
  });
}

interface HttpResult { readonly status: number; readonly body: string; }

async function httpPost(port: number, urlPath: string, body: string | Buffer, headers: Record<string, string> = {}): Promise<HttpResult> {
  return new Promise<HttpResult>((resolve, reject) => {
    const req = http.request(
      { host: '127.0.0.1', port, path: urlPath, method: 'POST', headers: { 'Content-Type': 'text/plain', 'Content-Length': Buffer.byteLength(body), ...headers } },
      (res) => {
        let data = '';
        res.on('data', (chunk) => { data += String(chunk); });
        res.on('end', () => { resolve({ status: res.statusCode ?? 0, body: data }); });
      },
    );
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}
