// Answers each request's jobs in order.

import { parentPort } from 'node:worker_threads';
import { checkScriptTypes } from './script-type-check.js';
import type { TypeCheckReply, TypeCheckRequest } from './script-type-checker.js';

if (!parentPort) throw new Error('script-type-worker must run in a worker thread');
const port = parentPort;

port.on('message', (request: TypeCheckRequest) => {
  void (async (): Promise<void> => {
    const results = [];
    for (const job of request.jobs) {
      const result = await checkScriptTypes(job.code, job.surface, request.templates);
      if (!result.ok) {
        const reply: TypeCheckReply = { id: request.id, ok: false, error: result.error.message };
        port.postMessage(reply);
        return;
      }
      results.push(result.value);
    }
    const reply: TypeCheckReply = { id: request.id, ok: true, results };
    port.postMessage(reply);
  })();
});
