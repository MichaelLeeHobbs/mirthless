// ===========================================
// User Commands
// ===========================================
// CLI commands for managing users.

import { Command } from 'commander';
import type { ApiClient } from '../lib/api.js';
import { formatTable, formatJson, printError } from '../lib/output.js';

interface UserSummary {
  readonly id: string;
  readonly username: string;
  readonly role: string;
  readonly enabled: boolean;
}

interface UserListResponse {
  readonly data: ReadonlyArray<UserSummary>;
}

/** Register user management commands on the program. */
export function registerUserCommands(
  program: Command,
  getClient: () => ApiClient,
): void {
  const users = program
    .command('users')
    .description('Manage users');

  users
    .command('list')
    .description('List all users')
    .option('--json', 'Output as JSON')
    .action(async (opts: { json?: true }) => {
      const client = getClient();
      const result = await client.get<UserListResponse>(
        '/api/v1/users?page=1&pageSize=100',
      );
      if (!result.success || !result.data) {
        printError(result.error?.message ?? 'Failed to list users');
        process.exitCode = 1;
        return;
      }
      if (opts.json) {
        process.stdout.write(formatJson(result.data) + '\n');
        return;
      }
      const rows = result.data.data.map((u) => [
        u.id.slice(0, 8),
        u.username,
        u.role,
        u.enabled ? 'Yes' : 'No',
      ]);
      process.stdout.write(
        formatTable(['ID', 'Username', 'Role', 'Enabled'], rows) + '\n',
      );
    });
}
