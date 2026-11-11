// ===========================================
// CLI Config Store
// ===========================================
// Saves the server URL and login token. The token is a credential, so the
// file and its directory are readable by the owner only.

import { chmodSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** What the CLI remembers between runs. */
export interface CliConfig {
  url?: string;
  token?: string;
}

const OWNER_ONLY_FILE = 0o600;
const OWNER_ONLY_DIR = 0o700;

/**
 * Write the config file, owner-readable only.
 *
 * @param dir - The CLI config directory.
 * @param config - What to save.
 */
export function saveConfig(dir: string, config: CliConfig): void {
  mkdirSync(dir, { recursive: true, mode: OWNER_ONLY_DIR });
  const file = join(dir, 'config.json');
  writeFileSync(file, JSON.stringify(config, null, 2), { mode: OWNER_ONLY_FILE });
  // `mode` only applies when the file or directory is created, so tighten
  // ones an older version left readable by others.
  chmodSync(file, OWNER_ONLY_FILE);
  chmodSync(dir, OWNER_ONLY_DIR);
}
