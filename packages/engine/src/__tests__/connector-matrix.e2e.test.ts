// ===========================================
// Connector Matrix E2E: exercise each connector by USING it
// ===========================================
// One real message pushed through a real source connector, transformed, and
// delivered through a real destination connector — asserting the payload that
// actually landed on the other side (a file on disk, an HTTP body downstream).
//
// TCP/MLLP + Channel connectors are covered in real-messaging.e2e.test.ts.
// This file adds File and HTTP. Each new connector added here is a small,
// self-contained block following the same shape.

import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import * as http from 'node:http';
import {
  FileReceiver,
  FileDispatcher,
  FILE_SORT_BY,
  FILE_POST_ACTION,
  HttpReceiver,
  HttpDispatcher,
  FhirDispatcher,
  TcpMllpReceiver,
} from '@mirthless/connectors';
import { deployChannel, teardownAll, type DeployedChannel } from './support/e2e-harness.js';
import { sendMllp } from './support/tcp-helpers.js';

let deployed: DeployedChannel[] = [];
const tempDirs: string[] = [];
const servers: http.Server[] = [];

afterEach(async () => {
  await teardownAll(deployed);
  deployed = [];
  for (const s of servers.splice(0)) await new Promise<void>((r) => s.close(() => { r(); }));
  for (const d of tempDirs.splice(0)) await fs.rm(d, { recursive: true, force: true });
});

// ----- File connector -----

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
        }),
      }],
    });
    deployed.push(channel);

    await fs.writeFile(path.join(srcDir, 'input.hl7'), 'MSH|^~\\&|FILE|IN');

    const outPath = path.join(destDir, '1.out');
    await waitForAsync(async () => {
      try { await fs.access(outPath); return true; } catch { return false; }
    });

    const written = await fs.readFile(outPath, 'utf-8');
    expect(written).toBe('MSH|^~\\&|FILE|IN::processed');
    expect(channel.store.messageCount()).toBe(1);

    // Source consumed the file (postAction DELETE).
    const remaining = await fs.readdir(srcDir);
    expect(remaining).not.toContain('input.hl7');
  }, 15_000);
});

// ----- HTTP connector -----

describe('HTTP connector (POST in → transform → POST out to a downstream server)', () => {
  it('receives an HTTP POST, transforms the body, and delivers it to a downstream HTTP server', async () => {
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

    await waitForSync(() => received.length === 1);
    expect(received[0]).toBe('HELLO WORLD');
    expect(channel.store.messageCount()).toBe(1);
  }, 15_000);
});

// ----- FHIR connector (destination) -----

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
      source: new TcpMllpReceiver({ host: '127.0.0.1', port: FHIR_SRC_PORT, maxConnections: 10 }),
      // Build a FHIR Patient from the HL7 PID-5 name.
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

    await waitForSync(() => received.length === 1);
    const posted = received[0];
    expect(posted?.path).toBe('/Patient');
    expect(posted?.contentType).toContain('application/fhir+json');
    const resource = JSON.parse(posted?.body ?? '{}') as { resourceType: string; name: { family: string; given: string[] }[] };
    expect(resource.resourceType).toBe('Patient');
    expect(resource.name[0]?.family).toBe('DOE');
    expect(resource.name[0]?.given[0]).toBe('JOHN');
  });
});

// ----- ports + helpers -----

const HTTP_SRC_PORT = 17701;
const DOWNSTREAM_PORT = 17702;
const FHIR_PORT = 17703;
const FHIR_SRC_PORT = 17704;

async function listen(server: http.Server, port: number): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => { resolve(); });
  });
}

interface HttpResult { readonly status: number; readonly body: string; }

async function httpPost(port: number, urlPath: string, body: string): Promise<HttpResult> {
  return new Promise<HttpResult>((resolve, reject) => {
    const req = http.request(
      { host: '127.0.0.1', port, path: urlPath, method: 'POST', headers: { 'Content-Type': 'text/plain', 'Content-Length': Buffer.byteLength(body) } },
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

async function waitForSync(predicate: () => boolean, timeoutMs = 10_000): Promise<void> {
  const start = Date.now();
  for (;;) {
    if (predicate()) return;
    if (Date.now() - start > timeoutMs) throw new Error('waitForSync: condition not met in time');
    await new Promise((r) => setTimeout(r, 10));
  }
}

async function waitForAsync(predicate: () => Promise<boolean>, timeoutMs = 10_000): Promise<void> {
  const start = Date.now();
  for (;;) {
    if (await predicate()) return;
    if (Date.now() - start > timeoutMs) throw new Error('waitForAsync: condition not met in time');
    await new Promise((r) => setTimeout(r, 20));
  }
}
