// ===========================================
// Registry: SFTP source properties as the factory reads them
// ===========================================

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { SourceConnectorRuntime } from '../base.js';
import { RemoteState, makeMockSftpClient } from '../__fixtures__/mock-sftp-client.js';

/** The remote folder the registry-built receiver lists; reset per test. */
let remote = new RemoteState();

// The registry builds the receiver with the real ssh2 client; serve it the in-memory one instead.
vi.mock('../sftp/sftp-client.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../sftp/sftp-client.js')>()),
  createSsh2SftpClient: () => makeMockSftpClient(remote),
}));

const { createSourceConnector } = await import('../registry.js');

/** Source properties as a channel saved before ignoreDot existed (#244): no ignoreDot key. */
const SAVED = {
  host: 'sftp.lab.example', username: 'lab', password: 'pw', remoteDirectory: '/inbound',
  filePattern: '*', pollingIntervalMs: 5_000, minFileAgeMs: 0, afterProcessing: 'NONE', strictHostKey: false,
};

let source: SourceConnectorRuntime | null = null;

beforeEach(() => {
  vi.useFakeTimers();
  remote = new RemoteState();
});

afterEach(async () => {
  vi.useRealTimers();
  if (source) await source.onStop();
  source = null;
});

/** Build the SFTP source through the registry, poll once, and return the names it dispatched. */
async function pollOnce(props: Record<string, unknown>): Promise<string[]> {
  remote.addFile('.lock', 'x', Date.now() - 10_000);
  remote.addFile('a.hl7', 'MSH|^~\\&|X', Date.now() - 10_000);
  const dispatched: string[] = [];
  source = createSourceConnector('SFTP', props);
  source.setDispatcher(async (raw) => {
    dispatched.push(String(raw.sourceMap['originalFilename']));
    return { ok: true as const, value: { messageId: dispatched.length }, error: null };
  });
  expect((await source.onStart()).ok).toBe(true);
  await vi.advanceTimersByTimeAsync(5_000);
  return dispatched;
}

describe('registry SFTP source (#244)', () => {
  it('skips dotfiles when the saved properties have no ignoreDot', async () => {
    expect(await pollOnce(SAVED)).toEqual(['a.hl7']);
  });

  it('reads dotfiles when ignoreDot is false', async () => {
    expect(await pollOnce({ ...SAVED, ignoreDot: false })).toEqual(['.lock', 'a.hl7']);
  });
});
