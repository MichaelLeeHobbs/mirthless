// ===========================================
// Channel Commands
// ===========================================
// CLI commands for listing and inspecting channels.

import { Command } from 'commander';
import type { ApiClient } from '../lib/api.js';
import { formatTable, formatJson, printError } from '../lib/output.js';

interface ChannelSummary {
  readonly id: string;
  readonly name: string;
  readonly enabled: boolean;
  readonly sourceConnectorType: string;
  readonly revision: number;
}

interface ChannelListResponse {
  readonly data: ReadonlyArray<ChannelSummary>;
}

/** Register channel management commands on the program. */
export function registerChannelCommands(
  program: Command,
  getClient: () => ApiClient,
): void {
  const channels = program
    .command('channels')
    .description('Manage channels');

  channels
    .command('list')
    .description('List all channels')
    .option('--json', 'Output as JSON')
    .action(async (opts: { json?: true }) => {
      const client = getClient();
      const result = await client.get<ChannelListResponse>(
        '/api/v1/channels?page=1&pageSize=100',
      );
      if (!result.success || !result.data) {
        printError(result.error?.message ?? 'Failed to list channels');
        process.exitCode = 1;
        return;
      }
      if (opts.json) {
        process.stdout.write(formatJson(result.data) + '\n');
        return;
      }
      const rows = result.data.data.map((ch) => [
        ch.id.slice(0, 8),
        ch.name,
        ch.enabled ? 'Yes' : 'No',
        ch.sourceConnectorType,
        String(ch.revision),
      ]);
      process.stdout.write(
        formatTable(['ID', 'Name', 'Enabled', 'Source', 'Rev'], rows) + '\n',
      );
    });

  channels
    .command('get <id>')
    .description('Get channel details')
    .option('--json', 'Output as JSON')
    .action(async (id: string) => {
      const client = getClient();
      const result = await client.get<Record<string, unknown>>(
        `/api/v1/channels/${id}`,
      );
      if (!result.success || !result.data) {
        printError(result.error?.message ?? 'Channel not found');
        process.exitCode = 1;
        return;
      }
      process.stdout.write(formatJson(result.data) + '\n');
    });
}
