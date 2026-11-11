// ===========================================
// Users Command Tests
// ===========================================
// Uses the response shape the server really sends from GET /users
// (packages/server/src/controllers/user.controller.ts): a plain array.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Command } from 'commander';
import { ApiClient } from '../lib/api.js';
import { registerUserCommands } from '../commands/users.js';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

const USERS = [
  { id: '11111111-2222-3333-4444-555555555555', username: 'admin', role: 'admin', enabled: true },
  { id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', username: 'viewer1', role: 'viewer', enabled: false },
];

async function runList(args: readonly string[] = []): Promise<string> {
  let out = '';
  const write = vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => { out += String(chunk); return true; });
  const program = new Command();
  registerUserCommands(program, () => new ApiClient({ baseUrl: 'http://localhost:3000', token: 't' }));
  await program.parseAsync(['node', 'cli', 'users', 'list', ...args]);
  write.mockRestore();
  return out;
}

describe('users list', () => {
  beforeEach(() => { mockFetch.mockReset(); process.exitCode = undefined; });
  afterEach(() => { process.exitCode = undefined; });

  it('prints a row for each user the server returns', async () => {
    mockFetch.mockResolvedValue({ status: 200, json: () => Promise.resolve({ success: true, data: USERS }) } as Response);

    const out = await runList();

    expect(out).toContain('admin');
    expect(out).toContain('viewer1');
    expect(out).toContain('11111111');
    expect(out).toMatch(/viewer1\s+viewer\s+No/);
  });

  it('prints the list as JSON with --json', async () => {
    mockFetch.mockResolvedValue({ status: 200, json: () => Promise.resolve({ success: true, data: USERS }) } as Response);

    expect(JSON.parse(await runList(['--json']))).toEqual(USERS);
  });

  it('reports the server error and sets a failing exit code', async () => {
    const err = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    mockFetch.mockResolvedValue({ status: 403, json: () => Promise.resolve({ success: false, error: { code: 'FORBIDDEN', message: 'Not allowed' } }) } as Response);

    await runList();

    expect(process.exitCode).toBe(1);
    err.mockRestore();
  });
});
