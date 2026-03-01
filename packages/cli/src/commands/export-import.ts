// ===========================================
// Export/Import Commands
// ===========================================
// CLI commands for exporting and importing channel configurations.

import { Command } from 'commander';
import { readFileSync, writeFileSync } from 'node:fs';
import type { ApiClient } from '../lib/api.js';
import { formatJson, printError, printSuccess } from '../lib/output.js';

/** Register export and import commands on the program. */
export function registerExportImportCommands(
  program: Command,
  getClient: () => ApiClient,
): void {
  program
    .command('export [id]')
    .description('Export channels (all or single by ID)')
    .option('-o, --output <file>', 'Write output to file instead of stdout')
    .action(async (id: string | undefined, opts: { output?: string }) => {
      const client = getClient();
      const path = id
        ? `/api/v1/channels/${id}/export`
        : '/api/v1/channels/export';
      const result = await client.get<unknown>(path);
      if (!result.success || !result.data) {
        printError(result.error?.message ?? 'Export failed');
        process.exitCode = 1;
        return;
      }
      const json = formatJson(result.data);
      if (opts.output) {
        writeFileSync(opts.output, json + '\n', 'utf-8');
        printSuccess(`Exported to ${opts.output}`);
        return;
      }
      process.stdout.write(json + '\n');
    });

  program
    .command('import <file>')
    .description('Import channels from a JSON file')
    .action(async (file: string) => {
      let content: string;
      try {
        content = readFileSync(file, 'utf-8');
      } catch {
        printError(`Cannot read file: ${file}`);
        process.exitCode = 1;
        return;
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(content);
      } catch {
        printError('File is not valid JSON');
        process.exitCode = 1;
        return;
      }

      const body = isImportPayload(parsed)
        ? parsed
        : { channels: Array.isArray(parsed) ? parsed : [parsed] };

      const client = getClient();
      const result = await client.post<unknown>(
        '/api/v1/channels/import',
        body,
      );
      if (!result.success) {
        printError(result.error?.message ?? 'Import failed');
        process.exitCode = 1;
        return;
      }
      printSuccess('Channels imported successfully.');
    });
}

function isImportPayload(
  value: unknown,
): value is { channels: ReadonlyArray<unknown> } {
  return (
    typeof value === 'object' &&
    value !== null &&
    'channels' in value &&
    Array.isArray((value as Record<string, unknown>)['channels'])
  );
}
