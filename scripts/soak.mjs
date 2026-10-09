#!/usr/bin/env node
// ===========================================
// Soak Test Driver
// ===========================================
// Runs steady HL7v2 traffic through a REAL running server for a long time and
// checks that every message arrives downstream exactly once.
//
// What it sets up (through the API):
//   MLLP sender --> [Soak channel: TCP/MLLP source -> JS transformer
//                    -> TCP/MLLP destination] --> MLLP sink (in this process)
//
// Every minute it prints one JSON line with throughput, ACK latency
// percentiles, ACK codes, sink counts, the server's stored message total and,
// when --server-pid is given, the server's resident memory. At the end it
// drains, compares what was ACKed with what the sink received, and exits 1 if
// any message was lost, duplicated, untransformed or not stored.
//
// Usage (server already running, admin password already changed):
//   node scripts/soak.mjs [--minutes M] [--rate R] [--connections C]
//                         [--api URL] [--server-pid PID] [--keep]
// Credentials come from SOAK_USERNAME / SOAK_PASSWORD (default admin/Admin123!).
// It logs in once, so start the server with JWT_ACCESS_EXPIRES_IN longer than
// the run (e.g. 12h) or the per-minute stored-message count starts failing.

import * as net from 'node:net';
import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';

const SOURCE_PORT = 16901;
const SINK_PORT = 16900;
const CHANNEL_NAME = 'Soak Test Channel';
const VT = 0x0b;
const FS = 0x1c;
const CR = 0x0d;

function parseArgs(argv) {
  const args = { minutes: 180, rate: 50, connections: 4, api: 'http://localhost:3000/api/v1', serverPid: null, keep: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--minutes') args.minutes = Number(argv[++i]);
    else if (a === '--rate') args.rate = Number(argv[++i]);
    else if (a === '--connections') args.connections = Number(argv[++i]);
    else if (a === '--api') args.api = argv[++i];
    else if (a === '--server-pid') args.serverPid = Number(argv[++i]);
    else if (a === '--keep') args.keep = true;
    else if (a === '--') continue;
    else throw new Error(`Unknown argument: ${a}`);
  }
  return args;
}

// ----- MLLP framing -----

function frame(text) {
  return Buffer.concat([Buffer.from([VT]), Buffer.from(text), Buffer.from([FS, CR])]);
}

/** Splits a byte stream into MLLP payloads; returns [payloads, leftover]. */
function unframe(buffer) {
  const payloads = [];
  let rest = buffer;
  let end = rest.indexOf(FS);
  while (end !== -1 && end + 1 < rest.length) {
    const start = rest.indexOf(VT);
    payloads.push(rest.subarray(start + 1, end).toString());
    rest = rest.subarray(end + 2);
    end = rest.indexOf(FS);
  }
  return [payloads, rest];
}

function hl7(controlId) {
  return [
    `MSH|^~\\&|SOAK|SOAKFAC|MIRTHLESS|FAC|20261009000000||ADT^A01|${controlId}|P|2.5`,
    'EVN|A01|20261009000000',
    `PID|1||${controlId}^^^HOSP^MR||DOE^JANE^Q||19800101|F|||1 MAIN ST^^METROPOLIS^NY^10001`,
    'PV1|1|I|WARD^101^1|||||||MED',
  ].join('\r');
}

function field(message, segment, index) {
  const line = message.split('\r').find((s) => s.startsWith(`${segment}|`));
  return line?.split('|')[index] ?? '';
}

// ----- API -----

async function api(args, token, method, path, body) {
  const res = await fetch(`${args.api}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(30_000),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${JSON.stringify(json)}`);
  return json.data;
}

async function login(args) {
  const data = await api(args, null, 'POST', '/auth/login', {
    username: process.env.SOAK_USERNAME ?? 'admin',
    password: process.env.SOAK_PASSWORD ?? 'Admin123!',
  });
  if (data.user.mustChangePassword) throw new Error('Change the admin password before running the soak test.');
  return data.accessToken;
}

const TRANSFORMER_SCRIPT = "channelMap.mrn = msg.get('PID.3.1');\nmsg.set('PID.8', 'U');";

async function createChannel(args, token) {
  const list = await api(args, token, 'GET', '/channels?pageSize=100');
  for (const ch of list.data.filter((c) => c.name === CHANNEL_NAME)) await removeChannel(args, token, ch.id);
  const created = await api(args, token, 'POST', '/channels', {
    name: CHANNEL_NAME,
    enabled: true,
    inboundDataType: 'HL7V2',
    outboundDataType: 'HL7V2',
    sourceConnectorType: 'TCP_MLLP',
    sourceConnectorProperties: { host: '127.0.0.1', port: SOURCE_PORT, maxConnections: 50, charset: 'utf-8', maxFrameBytes: 1_048_576 },
    responseMode: 'AUTO_AFTER_DESTINATIONS',
    transformers: [{ steps: [{ type: 'JAVASCRIPT', name: 'Normalize', script: TRANSFORMER_SCRIPT }] }],
    destinations: [{
      name: 'Sink',
      connectorType: 'TCP_MLLP',
      properties: { host: '127.0.0.1', port: SINK_PORT, maxConnections: 5, responseTimeout: 10_000, acquireTimeoutMs: 10_000, charset: 'utf-8' },
      queueMode: 'ON_FAILURE',
      retryCount: 3,
      retryIntervalMs: 1000,
    }],
  });
  await api(args, token, 'POST', `/channels/${created.id}/deploy`);
  const status = await api(args, token, 'GET', `/channels/${created.id}/status`);
  if (status.state !== 'STARTED') await api(args, token, 'POST', `/channels/${created.id}/start`);
  return created.id;
}

async function removeChannel(args, token, id) {
  for (const step of ['stop', 'undeploy']) {
    await api(args, token, 'POST', `/channels/${id}/${step}`).catch(() => undefined);
  }
  await api(args, token, 'DELETE', `/channels/${id}`);
}

// ----- Sink -----

function startSink(stats) {
  const server = net.createServer((socket) => {
    let pending = Buffer.alloc(0);
    socket.on('data', (chunk) => {
      const [payloads, rest] = unframe(Buffer.concat([pending, chunk]));
      pending = rest;
      for (const p of payloads) {
        const id = field(p, 'MSH', 9);
        if (stats.sinkIds.has(id)) stats.duplicates++;
        stats.sinkIds.add(id);
        if (field(p, 'PID', 8) !== 'U') stats.untransformed++;
        socket.write(frame(`MSH|^~\\&|SINK|F|SOAK|F|20261009000000||ACK|${id}|P|2.5\rMSA|AA|${id}`));
      }
    });
    socket.on('error', () => undefined);
  });
  return new Promise((resolve) => server.listen(SINK_PORT, '127.0.0.1', () => resolve(server)));
}

// ----- Sender -----

/** One persistent MLLP connection that sends a message and awaits its ACK. */
function openSender() {
  const socket = net.createConnection({ host: '127.0.0.1', port: SOURCE_PORT });
  let pending = Buffer.alloc(0);
  let waiter = null;
  socket.on('data', (chunk) => {
    const [payloads, rest] = unframe(Buffer.concat([pending, chunk]));
    pending = rest;
    for (const p of payloads) waiter?.resolve(p);
  });
  socket.on('error', (err) => waiter?.reject(err));
  socket.on('close', () => waiter?.reject(new Error('connection closed')));
  const ready = new Promise((resolve, reject) => { socket.once('connect', resolve); socket.once('error', reject); });
  const send = (text) => new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('ACK timeout')), 30_000);
    waiter = {
      resolve: (v) => { clearTimeout(timer); waiter = null; resolve(v); },
      reject: (e) => { clearTimeout(timer); waiter = null; reject(e); },
    };
    socket.write(frame(text));
  });
  return { ready, send, close: () => socket.destroy() };
}

async function senderLoop(args, stats, deadline, slot) {
  let conn = openSender();
  await conn.ready;
  const intervalMs = (1000 * args.connections) / args.rate;
  let next = performance.now() + slot * (intervalMs / args.connections);
  while (performance.now() < deadline) {
    const wait = next - performance.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    next += intervalMs;
    const id = `SOAK${String(++stats.seq).padStart(9, '0')}`;
    const t0 = performance.now();
    stats.sent++;
    try {
      const ack = await conn.send(hl7(id));
      stats.latencies.push(performance.now() - t0);
      const code = field(ack, 'MSA', 1);
      stats.ackCodes[code] = (stats.ackCodes[code] ?? 0) + 1;
      if (code === 'AA') stats.ackedIds.add(id);
    } catch (err) {
      stats.errors++;
      stats.lastError = String(err.message ?? err);
      conn.close();
      conn = openSender();
      await conn.ready.catch(() => undefined);
    }
  }
  conn.close();
}

// ----- Sampling -----

function percentile(sorted, p) {
  return sorted.length === 0 ? null : Math.round(sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] * 10) / 10;
}

function rssMb(pid) {
  if (!pid) return null;
  const line = readFileSync(`/proc/${pid}/status`, 'utf8').split('\n').find((l) => l.startsWith('VmRSS:'));
  return line ? Math.round(Number(line.split(/\s+/)[1]) / 1024) : null;
}

async function storedTotal(args, token, channelId) {
  const page = await api(args, token, 'GET', `/channels/${channelId}/messages?pageSize=1`);
  return page.total;
}

async function sample(args, ctx, startedAt) {
  const { stats } = ctx;
  const lat = stats.latencies.splice(0).sort((a, b) => a - b);
  const line = {
    minute: Math.round((Date.now() - startedAt) / 60_000),
    sent: stats.sent,
    acked: stats.ackedIds.size,
    ackCodes: stats.ackCodes,
    errors: stats.errors,
    sinkReceived: stats.sinkIds.size,
    duplicates: stats.duplicates,
    untransformed: stats.untransformed,
    stored: await storedTotal(args, ctx.token, ctx.channelId).catch((e) => `error: ${e.message}`),
    rateLastMin: lat.length / 60,
    latencyMs: { p50: percentile(lat, 0.5), p95: percentile(lat, 0.95), p99: percentile(lat, 0.99), max: percentile(lat, 1) },
    serverRssMb: rssMb(args.serverPid),
    lastError: stats.lastError,
  };
  process.stdout.write(`${JSON.stringify(line)}\n`);
}

// ----- Verdict -----

async function verdict(args, ctx) {
  const { stats } = ctx;
  const drainDeadline = Date.now() + 120_000;
  while (Date.now() < drainDeadline && [...stats.ackedIds].some((id) => !stats.sinkIds.has(id))) {
    await new Promise((r) => setTimeout(r, 1000));
  }
  const missing = [...stats.ackedIds].filter((id) => !stats.sinkIds.has(id));
  const stored = await storedTotal(args, ctx.token, ctx.channelId);
  const summary = {
    sent: stats.sent,
    acked: stats.ackedIds.size,
    errors: stats.errors,
    sinkReceived: stats.sinkIds.size,
    missingDownstream: missing.length,
    missingSample: missing.slice(0, 10),
    duplicates: stats.duplicates,
    untransformed: stats.untransformed,
    stored,
    pass: missing.length === 0 && stats.duplicates === 0 && stats.untransformed === 0 && stored >= stats.ackedIds.size,
  };
  process.stdout.write(`SUMMARY ${JSON.stringify(summary)}\n`);
  return summary.pass;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const stats = { seq: 0, sent: 0, errors: 0, lastError: null, latencies: [], ackCodes: {}, ackedIds: new Set(), sinkIds: new Set(), duplicates: 0, untransformed: 0 };
  const sink = await startSink(stats);
  const token = await login(args);
  const channelId = await createChannel(args, token);
  const ctx = { stats, token, channelId };
  process.stderr.write(`soak: channel ${channelId}, ${args.rate} msg/s over ${args.connections} connections for ${args.minutes} min\n`);

  const startedAt = Date.now();
  const deadline = performance.now() + args.minutes * 60_000;
  const sampler = setInterval(() => { sample(args, ctx, startedAt).catch((e) => process.stderr.write(`sample failed: ${e.message}\n`)); }, 60_000);
  await Promise.all(Array.from({ length: args.connections }, (_, slot) => senderLoop(args, stats, deadline, slot)));
  clearInterval(sampler);
  await sample(args, ctx, startedAt);

  ctx.token = await login(args); // the access token may have expired during a long run
  const pass = await verdict(args, ctx);
  if (!args.keep) await removeChannel(args, ctx.token, channelId);
  sink.close();
  process.exit(pass ? 0 : 1);
}

main().catch((err) => {
  process.stderr.write(`soak failed: ${err.stack ?? err}\n`);
  process.exit(1);
});
