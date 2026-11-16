// ===========================================
// Script test worker
// ===========================================
// Worker-thread entry for runScriptTestIsolated. Runs one test run and posts
// the result back. Reads (getResource, collection find) are not available in
// the worker, so each one is asked of the main thread, which owns the database.

import { parentPort, workerData } from 'node:worker_threads';
import { runScriptTest, type ScriptTestInput, type ScriptTestReaders } from './script-test-run.js';
import type { WorkerReply, WorkerRequest, WorkerStart } from './script-test-isolated.js';

if (!parentPort) throw new Error('script-test-worker must run in a worker thread');
const port = parentPort;

const start = workerData as WorkerStart;
let nextId = 0;
const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();

port.on('message', (reply: WorkerReply) => {
  if (reply.type !== 'read-result') return;
  const waiting = pending.get(reply.id);
  if (!waiting) return;
  pending.delete(reply.id);
  if (reply.ok) waiting.resolve(reply.value);
  else waiting.reject(new Error(reply.error));
});

function ask(call: 'getResource' | 'collectionFind', args: readonly unknown[]): Promise<unknown> {
  nextId += 1;
  const id = nextId;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    const request: WorkerRequest = { type: 'read', id, call, args };
    port.postMessage(request);
  });
}

// Only the reads the caller provides are offered; the rest are refused as on the main thread.
const readers: ScriptTestReaders = {
  ...(start.readers.includes('getResource')
    ? { getResource: async (name: string) => ask('getResource', [name]) as Promise<string | null> }
    : {}),
  ...(start.readers.includes('collectionFind')
    ? { collectionFind: (async (...args: unknown[]) => ask('collectionFind', args)) as NonNullable<ScriptTestReaders['collectionFind']> }
    : {}),
};

const input: ScriptTestInput = { ...start.input, readers };
const result = await runScriptTest(input);
const done: WorkerRequest = result.ok
  ? { type: 'done', result: result.value }
  : { type: 'failed', error: result.error.message };
port.postMessage(done);
