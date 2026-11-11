#!/usr/bin/env node
// ===========================================
// @galvaniflow/cli
// ===========================================
// CLI for GalvaniFlow server management.

import { Command } from 'commander';
import { readFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { ApiClient } from './lib/api.js';
import { configDir, configFileToRead } from './lib/config-path.js';
import { saveConfig, type CliConfig } from './lib/config-store.js';
import { registerChannelCommands } from './commands/channels.js';
import { registerDeployCommands } from './commands/deploy.js';
import { registerExportImportCommands } from './commands/export-import.js';
import { registerUserCommands } from './commands/users.js';
import { registerLoginCommand } from './commands/login.js';

/** Config file location in the user's home directory. */
const CONFIG_DIR = configDir(homedir());

/** Load CLI configuration from disk. */
function loadConfig(): CliConfig {
  const file = configFileToRead(homedir());
  if (!existsSync(file)) return {};
  try {
    return JSON.parse(readFileSync(file, 'utf-8')) as CliConfig;
  } catch {
    return {};
  }
}

const program = new Command();
program
  .name('galvaniflow')
  .description('GalvaniFlow CLI — Healthcare Integration Engine')
  .version('0.1.0')
  .option('--url <url>', 'Server URL')
  .option('--token <token>', 'Auth token');

/** Create an API client from CLI options and saved config. */
function getClient(): ApiClient {
  const opts = program.opts<{ url?: string; token?: string }>();
  const config = loadConfig();
  const baseUrl = opts.url ?? config.url ?? 'http://localhost:3000';
  const token = opts.token ?? config.token ?? null;
  return new ApiClient({ baseUrl, token });
}

registerChannelCommands(program, getClient);
registerDeployCommands(program, getClient);
registerExportImportCommands(program, getClient);
registerUserCommands(program, getClient);
// Merge so a login without --url keeps the server URL saved earlier.
registerLoginCommand(program, getClient, (config) => { saveConfig(CONFIG_DIR, { ...loadConfig(), ...config }); });

program.parse();
