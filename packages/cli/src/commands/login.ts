// ===========================================
// Login Command
// ===========================================
// CLI command for authenticating with the Mirthless server.

import { Command } from 'commander';
import { createInterface } from 'node:readline/promises';
import type { ApiClient } from '../lib/api.js';
import { printError, printSuccess } from '../lib/output.js';

interface LoginResponse {
  readonly token: string;
}

interface CliConfig {
  url?: string;
  token?: string;
}

/** Register the login command on the program. */
export function registerLoginCommand(
  program: Command,
  getClient: () => ApiClient,
  saveConfig: (config: CliConfig) => void,
): void {
  program
    .command('login')
    .description('Authenticate with the Mirthless server')
    .action(async () => {
      const rl = createInterface({
        input: process.stdin,
        output: process.stderr,
      });

      try {
        const username = await rl.question('Username: ');
        const password = await rl.question('Password: ');

        const client = getClient();
        const result = await client.post<LoginResponse>(
          '/api/v1/auth/login',
          { username, password },
        );

        if (!result.success || !result.data) {
          printError(result.error?.message ?? 'Login failed');
          process.exitCode = 1;
          return;
        }

        const opts = program.opts<{ url?: string }>();
        const config: CliConfig = { token: result.data.token };
        if (opts.url) {
          config.url = opts.url;
        }
        saveConfig(config);
        printSuccess('Login successful. Token saved.');
      } finally {
        rl.close();
      }
    });
}
