// A C-STORE is delivered only when the remote AE answers that it stored the instance (#410).
// SENT is what a source's delete or move goes by, so these run a real association with an
// archive that answers as told.

import { describe, it, expect, afterEach } from 'vitest';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Result } from '@galvanigraph/core-util';
import type { ConnectorResponse } from '../../base.js';
import { createDimseSender } from '../dimse-sender.js';
import { DicomDispatcher, type DcmtkSendResult } from '../dicom-dispatcher.js';
import { startFakeScp, type FakeScp, type ScpBehaviour } from '../../__fixtures__/fake-scp.js';
import { freePort } from '../../__fixtures__/free-port.js';

const SAMPLE_DCM = fileURLToPath(new URL('../../__tests__/e2e/fixtures/sample.dcm', import.meta.url));

interface SendOptions {
  readonly maxRetries?: number;
  readonly timeoutMs?: number;
}

let scp: FakeScp | null = null;

afterEach(() => {
  scp?.close();
  scp = null;
});

async function sendFile(file: string, port: number, options: SendOptions = {}): Promise<Result<DcmtkSendResult>> {
  const sender = createDimseSender({
    host: '127.0.0.1',
    port,
    calledAETitle: 'ARCHIVE',
    callingAETitle: 'SCU',
    maxRetries: options.maxRetries ?? 0,
    retryDelayMs: 0,
    timeoutMs: options.timeoutMs ?? 5_000,
  });
  if (!sender.ok) throw sender.error;
  return sender.value.send([file]);
}

async function sendTo(behaviour: ScpBehaviour, options: SendOptions = {}): Promise<Result<DcmtkSendResult>> {
  scp = await startFakeScp(behaviour);
  return sendFile(SAMPLE_DCM, scp.port, options);
}

/** Through the destination, whose status is what the pipeline records. */
async function dispatchTo(behaviour: ScpBehaviour): Promise<ConnectorResponse> {
  scp = await startFakeScp(behaviour);
  const dispatcher = new DicomDispatcher({
    host: '127.0.0.1',
    port: scp.port,
    calledAETitle: 'ARCHIVE',
    callingAETitle: 'SCU',
    maxRetries: 0,
    retryDelayMs: 0,
    timeoutMs: 5_000,
    roots: { allowed: [path.dirname(SAMPLE_DCM)], denied: [] },
  });
  await dispatcher.onStart();
  const result = await dispatcher.send(
    { channelId: 'ch', messageId: 1, metaDataId: 1, content: SAMPLE_DCM, dataType: 'DICOM' },
    new AbortController().signal,
  );
  if (!result.ok) throw result.error;
  return result.value;
}

function outcomeOf(result: Result<DcmtkSendResult>): string {
  return result.ok ? 'sent' : result.error.message;
}

describe('a C-STORE the remote AE stored', () => {
  it('is sent when the answer is success', async () => {
    const result = await sendTo({ answer: 0x0000 });

    expect(outcomeOf(result)).toBe('sent');
    expect(result.ok && result.value.warnings).toEqual([]);
    expect(scp?.stores()).toBe(1);
  });

  // PS3.4 B.2.3: stored, with elements coerced (B000) or left out (B006), or not matching the SOP class (B007).
  it.each([[0xB000], [0xB006], [0xB007]])('is sent with a warning when the answer is warning status %i', async (status) => {
    const result = await sendTo({ answer: status });

    expect(outcomeOf(result)).toBe('sent');
    expect(result.ok && result.value.warnings).toEqual([status]);
  });

  it('is sent, and not sent again, when the association is aborted after the answer', async () => {
    const result = await sendTo({ answerThenAbort: 0x0000 }, { maxRetries: 2 });

    expect(outcomeOf(result)).toBe('sent');
    expect(scp?.stores()).toBe(1);
  });

  it('is sent when the release is never answered', async () => {
    const result = await sendTo({ answerThenHang: 0x0000 }, { timeoutMs: 2_000, maxRetries: 2 });

    expect(outcomeOf(result)).toBe('sent');
    expect(scp?.stores()).toBe(1);
  });

  it('is sent when a pending status comes before the answer', async () => {
    expect(outcomeOf(await sendTo({ answers: [0xFF00, 0x0000] }))).toBe('sent');
  });

  it('shows a warning status in the destination response', async () => {
    const response = await dispatchTo({ answer: 0xB000 });

    expect(response.status).toBe('SENT');
    expect(response.content).toContain('0xB000');
  });
});

describe('a C-STORE the remote AE did not store', () => {
  it.each([
    ['0x0110', 0x0110, 'processing failure'],
    ['0x0111', 0x0111, 'duplicate SOP instance'],
    ['0x0122', 0x0122, 'SOP class not supported'],
    ['0x0124', 0x0124, 'not authorized'],
    ['0xA700', 0xA700, 'out of resources'],
    ['0xA7FF', 0xA7FF, 'out of resources'],
    ['0xA900', 0xA900, 'does not match'],
    ['0xC000', 0xC000, 'cannot understand'],
    ['0xCFFF', 0xCFFF, 'cannot understand'],
    // Not C-STORE answers: cancel, and the general warnings PS3.7 Annex C keeps for the N- services.
    ['0xFE00', 0xFE00, 'unknown reason'],
    ['0x0001', 0x0001, 'unknown reason'],
    ['0x0107', 0x0107, 'unknown reason'],
  ])('fails when the answer is %s', async (text, status, reason) => {
    const result = await sendTo({ answer: status });

    expect(scp?.stores()).toBe(1);
    expect(outcomeOf(result)).toContain(reason);
    expect(outcomeOf(result)).toContain(text);
  });

  it('fails when the presentation context is rejected, so nothing was sent', async () => {
    const result = await sendTo('reject-contexts');

    expect(scp?.stores()).toBe(0);
    expect(outcomeOf(result)).toContain('presentation context');
  });

  it('fails when the association is rejected', async () => {
    expect(outcomeOf(await sendTo('reject-association'))).toContain('association rejected');
  });

  it('fails when the association is aborted before the answer', async () => {
    const result = await sendTo('abort');

    expect(scp?.stores()).toBe(1);
    expect(outcomeOf(result)).toContain('aborted the association');
  });

  it('fails when the connection is closed before the answer', async () => {
    const result = await sendTo('close');

    expect(scp?.stores()).toBe(1);
    expect(outcomeOf(result)).toContain('closed before the remote AE answered');
  });

  it('fails when no answer comes in time', async () => {
    const result = await sendTo('never-answer', { timeoutMs: 3_000 });

    expect(scp?.stores()).toBe(1);
    expect(result.ok).toBe(false);
  });

  it('fails when nothing listens', async () => {
    expect((await sendFile(SAMPLE_DCM, await freePort())).ok).toBe(false);
  });

  it('fails when the file is not DICOM', async () => {
    scp = await startFakeScp({ answer: 0x0000 });

    expect((await sendFile(fileURLToPath(import.meta.url), scp.port)).ok).toBe(false);
    expect(scp.stores()).toBe(0);
  });

  it('stays a failure when a success follows the refusal', async () => {
    expect(outcomeOf(await sendTo({ answers: [0xA700, 0x0000] }))).toContain('0xA700');
  });

  it('is retried as often as configured', async () => {
    const result = await sendTo({ answer: 0xA700 }, { maxRetries: 2 });

    expect(scp?.stores()).toBe(3);
    expect(result.ok).toBe(false);
  });

  it.each<[string, ScpBehaviour]>([
    ['a refusal', { answer: 0xA700 }],
    ['a rejected presentation context', 'reject-contexts'],
    ['an abort', 'abort'],
    ['a closed connection', 'close'],
  ])('reads ERROR at the destination after %s', async (_case, behaviour) => {
    const response = await dispatchTo(behaviour);

    expect(response.status).toBe('ERROR');
    expect(response.errorMessage).toBeTruthy();
  });
});
