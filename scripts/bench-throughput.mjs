#!/usr/bin/env node
// ===========================================
// End-to-End Channel Throughput Benchmark
// ===========================================
// Drives real HL7v2 messages through the REAL engine pipeline
// (@mirthless/engine MessageProcessor + VmSandboxExecutor) to measure sustained
// throughput (messages/sec) and per-message latency percentiles.
//
// Two storage modes:
//   (default)  in-memory MessageStore — measures the pipeline + sandbox cost
//              alone (parse -> filter -> route -> persist-calls), no DB/network.
//              Runs anywhere; reproducible baseline for the engine hot path.
//   --db       real Postgres MessageStore via @mirthless/server's MessageService
//              (reads DATABASE_URL from your .env). Measures true end-to-end
//              persistence cost against the dev database. Requires the server
//              package to be built (`pnpm --filter @mirthless/server build`).
//
// Usage:
//   node scripts/bench-throughput.mjs [--messages N] [--concurrency C]
//                                     [--warmup W] [--no-sandbox] [--db]
//
// Examples:
//   node scripts/bench-throughput.mjs                       # 5000 msgs, in-memory
//   node scripts/bench-throughput.mjs --db --messages 2000  # against dev Postgres
//
// Requires packages to be built first: `pnpm build` (or at least
// `pnpm --filter @mirthless/engine build`).

import { performance } from 'node:perf_hooks';
import { randomUUID } from 'node:crypto';
// Import from the built dist directly so the script works when run from the repo
// root (the workspace package name isn't resolvable from root node_modules).
// Requires: pnpm --filter @mirthless/engine build (or pnpm build).
import {
  MessageProcessor,
  VmSandboxExecutor,
  compileScript,
  DEFAULT_EXECUTION_OPTIONS,
} from '../packages/engine/dist/index.js';

// ----- CLI args -----

function parseArgs(argv) {
  const args = { messages: 5000, concurrency: 16, warmup: 250, sandbox: true, db: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--messages') args.messages = Number(argv[++i]);
    else if (a === '--concurrency') args.concurrency = Number(argv[++i]);
    else if (a === '--warmup') args.warmup = Number(argv[++i]);
    else if (a === '--no-sandbox') args.sandbox = false;
    else if (a === '--db') args.db = true;
    else if (a === '--help' || a === '-h') {
      process.stdout.write(
        'Usage: node scripts/bench-throughput.mjs [--messages N] [--concurrency C] [--warmup W] [--no-sandbox] [--db]\n',
      );
      process.exit(0);
    }
  }
  return args;
}

// ----- Sample message (well-formed HL7v2 ADT^A01) -----

const SAMPLE_HL7 = [
  'MSH|^~\\&|BENCH|BENCHFAC|RCV|RCVFAC|20260712000000||ADT^A01|MSG00001|P|2.5',
  'EVN|A01|20260712000000',
  'PID|1||100001^^^HOSP^MR||DOE^JOHN^Q||19800101|M|||1 MAIN ST^^METROPOLIS^NY^10001',
  'PV1|1|I|WARD^101^1|||||||MED',
].join('\r');

// ----- Result helpers -----

const OK_VOID = { ok: true, value: undefined, error: null };
const ok = (value) => ({ ok: true, value, error: null });

// ----- Stores -----

function createInMemoryStore() {
  let nextId = 0;
  return {
    initializeMessage: (_c, _s, _n, _rows, corr) =>
      Promise.resolve(ok({ messageId: ++nextId, correlationId: corr ?? randomUUID() })),
    finalizeMessage: () => Promise.resolve(OK_VOID),
    createMessage: (_c, _s, corr) =>
      Promise.resolve(ok({ messageId: ++nextId, correlationId: corr ?? randomUUID() })),
    createConnectorMessage: () => Promise.resolve(OK_VOID),
    updateConnectorMessageStatus: () => Promise.resolve(OK_VOID),
    storeContent: () => Promise.resolve(OK_VOID),
    markProcessed: () => Promise.resolve(OK_VOID),
    enqueue: () => Promise.resolve(OK_VOID),
    loadContent: () => Promise.resolve(ok(null)),
    dequeue: () => Promise.resolve(ok([])),
    release: () => Promise.resolve(OK_VOID),
    incrementStats: () => Promise.resolve(OK_VOID),
    storeAttachment: () => Promise.resolve(OK_VOID),
  };
}

async function createDbStore() {
  // Import the built server MessageService and adapt it to the MessageStore
  // interface (a thin delegation — the same mapping the server uses internally).
  const url = new URL('../packages/server/dist/services/message.service.js', import.meta.url);
  const { MessageService: MS } = await import(url.href);
  return {
    initializeMessage: (c, s, n, rows, corr) => MS.initializeMessage(c, s, n, rows, corr),
    finalizeMessage: (c, m, s) => MS.finalizeMessage(c, m, s),
    createMessage: (c, s, corr) => MS.createMessage(c, s, corr),
    createConnectorMessage: (c, m, md, n, st) => MS.createConnectorMessage(c, m, md, n, st),
    updateConnectorMessageStatus: (c, m, md, st, ec) =>
      MS.updateConnectorMessageStatus(c, m, md, st, ec),
    storeContent: (c, m, md, ct, content, dt) => MS.storeContent(c, m, md, ct, content, dt),
    markProcessed: (c, m) => MS.markProcessed(c, m),
    enqueue: (c, m, md) => MS.enqueue(c, m, md),
    loadContent: (c, m, md, ct) => MS.loadContent(c, m, md, ct),
    dequeue: (c, md, bs) => MS.dequeue(c, md, bs),
    release: (c, m, md, st) => MS.release(c, m, md, st),
    incrementStats: (c, md, s, f) => MS.incrementStats(c, md, s, f),
    storeAttachment: (c, m, a, mt, content, sz) => MS.storeAttachment(c, m, a, mt, content, sz),
  };
}

// ----- Percentiles -----

function percentile(sortedAsc, p) {
  if (sortedAsc.length === 0) return 0;
  const rank = Math.ceil((p / 100) * sortedAsc.length) - 1;
  return sortedAsc[Math.min(Math.max(rank, 0), sortedAsc.length - 1)];
}

// ----- Runner -----

async function run() {
  const args = parseArgs(process.argv.slice(2));
  const channelId = randomUUID();

  const store = args.db ? await createDbStore() : createInMemoryStore();

  const scripts = {};
  if (args.sandbox) {
    const compiled = await compileScript('return true;'); // exercises the sandbox
    if (!compiled.ok) throw new Error(`Failed to compile filter: ${compiled.error.message}`);
    scripts.sourceFilter = compiled.value;
  }

  const config = {
    channelId,
    serverId: 'bench',
    dataType: 'HL7V2',
    scripts,
    destinations: [{ metaDataId: 1, name: 'bench-dest', enabled: true, scripts: {}, queueEnabled: false }],
  };

  const sandbox = new VmSandboxExecutor();
  const sendFn = (_metaDataId, content) => Promise.resolve(ok({ status: 'SENT', content }));
  const processor = new MessageProcessor(sandbox, store, sendFn, config, DEFAULT_EXECUTION_OPTIONS);

  const controller = new AbortController();
  const processOne = async () => {
    const r = await processor.processMessage({ rawContent: SAMPLE_HL7, sourceMap: {} }, controller.signal);
    return r.ok && r.value.status !== 'ERROR';
  };

  process.stdout.write(
    `Mirthless throughput benchmark\n` +
      `  store=${args.db ? 'postgres (dev DB)' : 'in-memory'} sandbox=${args.sandbox} ` +
      `concurrency=${args.concurrency} warmup=${args.warmup} messages=${args.messages}\n`,
  );

  // Warmup (not measured) — lets V8 + the VM sandbox reach steady state.
  await runPool(args.warmup, args.concurrency, processOne);

  // Measured run.
  const latencies = new Array(args.messages);
  let errors = 0;
  let cursor = 0;
  const wallStart = performance.now();

  const worker = async () => {
    for (;;) {
      const i = cursor++;
      if (i >= args.messages) return;
      const t0 = performance.now();
      const okResult = await processOne();
      latencies[i] = performance.now() - t0;
      if (!okResult) errors++;
    }
  };
  await Promise.all(Array.from({ length: args.concurrency }, worker));

  const wallMs = performance.now() - wallStart;
  sandbox.dispose();

  const sorted = latencies.slice(0, args.messages).sort((a, b) => a - b);
  const mean = sorted.reduce((s, v) => s + v, 0) / sorted.length;
  const throughput = (args.messages / wallMs) * 1000;

  process.stdout.write(
    `\nResults\n` +
      `  messages:    ${args.messages} (errors: ${errors})\n` +
      `  wall time:   ${wallMs.toFixed(1)} ms\n` +
      `  throughput:  ${throughput.toFixed(0)} msgs/sec\n` +
      `  latency ms:  mean ${mean.toFixed(3)}  p50 ${percentile(sorted, 50).toFixed(3)}  ` +
      `p95 ${percentile(sorted, 95).toFixed(3)}  p99 ${percentile(sorted, 99).toFixed(3)}  ` +
      `max ${sorted[sorted.length - 1].toFixed(3)}\n`,
  );

  if (args.db) {
    process.stdout.write(
      `\nNote: --db inserted rows under channel_id ${channelId} in your dev DB.\n` +
        `Prune with the data pruner or drop the test rows when done.\n`,
    );
  }

  // The DB pool (if any) keeps the event loop alive; exit explicitly.
  process.exit(errors > 0 && args.messages > 0 && errors === args.messages ? 1 : 0);
}

async function runPool(count, concurrency, task) {
  let cursor = 0;
  const worker = async () => {
    for (;;) {
      const i = cursor++;
      if (i >= count) return;
      await task();
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, Math.max(count, 1)) }, worker));
}

run().catch((err) => {
  process.stderr.write(`Benchmark failed: ${err instanceof Error ? err.stack : String(err)}\n`);
  process.exit(1);
});
