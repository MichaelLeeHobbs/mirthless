// ===========================================
// Login Command
// ===========================================
// CLI command for authenticating with the GalvaniFlow server.

import { Command } from 'commander';
import type { ApiClient } from '../lib/api.js';
import type { CliConfig } from '../lib/config-store.js';
import { ask } from '../lib/prompt.js';
import { printError, printSuccess } from '../lib/output.js';

/** What POST /auth/login returns (the refresh token travels as a cookie the CLI does not keep). */
interface LoginResponse {
  readonly accessToken?: unknown;
}

/** The outcome of a login attempt. */
export type LoginOutcome =
  | { readonly ok: true; readonly token: string }
  | { readonly ok: false; readonly message: string };

/**
 * Sign in and return the access token.
 *
 * @param client - API client for the server to sign in to.
 * @param username - Account name.
 * @param password - Account password.
 */
export async function login(client: ApiClient, username: string, password: string): Promise<LoginOutcome> {
  const result = await client.post<LoginResponse>('/api/v1/auth/login', { username, password });
  if (!result.success || !result.data) {
    return { ok: false, message: result.error?.message ?? 'Login failed' };
  }
  const token = result.data.accessToken;
  if (typeof token !== 'string' || token === '') {
    return { ok: false, message: 'The server did not return an access token' };
  }
  return { ok: true, token };
}

/** Register the login command on the program. */
export function registerLoginCommand(
  program: Command,
  getClient: () => ApiClient,
  saveConfig: (config: CliConfig) => void,
): void {
  program
    .command('login')
    .description('Authenticate with the GalvaniFlow server')
    .action(async () => {
      const io = { input: process.stdin, output: process.stderr };
      const username = await ask('Username: ', { ...io, hidden: false });
      const password = await ask('Password: ', { ...io, hidden: true });

      const outcome = await login(getClient(), username, password);
      if (!outcome.ok) {
        printError(outcome.message);
        process.exitCode = 1;
        return;
      }

      const opts = program.opts<{ url?: string }>();
      const config: CliConfig = { token: outcome.token };
      if (opts.url) {
        config.url = opts.url;
      }
      saveConfig(config);
      printSuccess('Login successful. Token saved.');
    });
}
