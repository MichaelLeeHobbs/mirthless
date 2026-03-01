// ===========================================
// Deploy Commands
// ===========================================
// CLI commands for deploying, starting, stopping, and managing channel state.

import { Command } from 'commander';
import type { ApiClient } from '../lib/api.js';
import { formatTable, formatJson, printError, printSuccess } from '../lib/output.js';

interface ChannelStatus {
  readonly channelId: string;
  readonly channelName: string;
  readonly state: string;
}

/** Register deployment management commands on the program. */
export function registerDeployCommands(
  program: Command,
  getClient: () => ApiClient,
): void {
  program
    .command('deploy <id>')
    .description('Deploy a channel')
    .action(async (id: string) => {
      const client = getClient();
      const result = await client.post(`/api/v1/channels/${id}/deploy`);
      if (!result.success) {
        printError(result.error?.message ?? 'Deploy failed');
        process.exitCode = 1;
        return;
      }
      printSuccess(`Channel ${id} deployed.`);
    });

  program
    .command('undeploy <id>')
    .description('Undeploy a channel')
    .action(async (id: string) => {
      const client = getClient();
      const result = await client.post(`/api/v1/channels/${id}/undeploy`);
      if (!result.success) {
        printError(result.error?.message ?? 'Undeploy failed');
        process.exitCode = 1;
        return;
      }
      printSuccess(`Channel ${id} undeployed.`);
    });

  program
    .command('start <id>')
    .description('Start a channel')
    .action(async (id: string) => {
      const client = getClient();
      const result = await client.post(`/api/v1/channels/${id}/start`);
      if (!result.success) {
        printError(result.error?.message ?? 'Start failed');
        process.exitCode = 1;
        return;
      }
      printSuccess(`Channel ${id} started.`);
    });

  program
    .command('stop <id>')
    .description('Stop a channel')
    .action(async (id: string) => {
      const client = getClient();
      const result = await client.post(`/api/v1/channels/${id}/stop`);
      if (!result.success) {
        printError(result.error?.message ?? 'Stop failed');
        process.exitCode = 1;
        return;
      }
      printSuccess(`Channel ${id} stopped.`);
    });

  program
    .command('halt <id>')
    .description('Halt a channel (immediate stop)')
    .action(async (id: string) => {
      const client = getClient();
      const result = await client.post(`/api/v1/channels/${id}/halt`);
      if (!result.success) {
        printError(result.error?.message ?? 'Halt failed');
        process.exitCode = 1;
        return;
      }
      printSuccess(`Channel ${id} halted.`);
    });

  program
    .command('pause <id>')
    .description('Pause a channel')
    .action(async (id: string) => {
      const client = getClient();
      const result = await client.post(`/api/v1/channels/${id}/pause`);
      if (!result.success) {
        printError(result.error?.message ?? 'Pause failed');
        process.exitCode = 1;
        return;
      }
      printSuccess(`Channel ${id} paused.`);
    });

  program
    .command('resume <id>')
    .description('Resume a paused channel')
    .action(async (id: string) => {
      const client = getClient();
      const result = await client.post(`/api/v1/channels/${id}/resume`);
      if (!result.success) {
        printError(result.error?.message ?? 'Resume failed');
        process.exitCode = 1;
        return;
      }
      printSuccess(`Channel ${id} resumed.`);
    });

  program
    .command('status [id]')
    .description('Get deployment status for one or all channels')
    .option('--json', 'Output as JSON')
    .action(async (id: string | undefined, opts: { json?: true }) => {
      const client = getClient();
      const path = id
        ? `/api/v1/channels/${id}/status`
        : '/api/v1/channels/status';
      const result = await client.get<
        ChannelStatus | ReadonlyArray<ChannelStatus>
      >(path);
      if (!result.success || !result.data) {
        printError(result.error?.message ?? 'Failed to get status');
        process.exitCode = 1;
        return;
      }
      if (opts.json) {
        process.stdout.write(formatJson(result.data) + '\n');
        return;
      }
      const statuses = Array.isArray(result.data)
        ? result.data
        : [result.data];
      const rows = statuses.map((s) => [
        s.channelId.slice(0, 8),
        s.channelName,
        s.state,
      ]);
      process.stdout.write(
        formatTable(['ID', 'Name', 'State'], rows) + '\n',
      );
    });
}
