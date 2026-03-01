#!/usr/bin/env node
// ===========================================
// @mirthless/cli
// ===========================================
// CLI for Mirthless server management.

import { Command } from 'commander';
import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { ApiClient } from './lib/api.js';
import { registerChannelCommands } from './commands/channels.js';
import { registerDeployCommands } from './commands/deploy.js';
import { registerExportImportCommands } from './commands/export-import.js';
import { registerUserCommands } from './commands/users.js';
import { registerLoginCommand } from './commands/login.js';

/** Config file location in the user's home directory. */
const CONFIG_DIR = join(homedir(), '.mirthless');
const CONFIG_FILE = join(CONFIG_DIR, 'config.json');

interface CliConfig {
  url?: string;
  token?: string;
}

/** Load CLI configuration from disk. */
function loadConfig(): CliConfig {
  if (!existsSync(CONFIG_FILE)) return {};
  try {
    return JSON.parse(readFileSync(CONFIG_FILE, 'utf-8')) as CliConfig;
  } catch {
    return {};
  }
}

/** Persist CLI configuration to disk. */
export function saveConfig(config: CliConfig): void {
  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, { recursive: true });
  }
  writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
}

const program = new Command();
program
  .name('mirthless')
  .description('Mirthless CLI — Healthcare Integration Engine')
  .version('0.0.1')
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
registerLoginCommand(program, getClient, saveConfig);

program.parse();
