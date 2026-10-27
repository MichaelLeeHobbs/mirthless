// ===========================================
// CLI Config Location
// ===========================================
// Where the CLI keeps its saved URL and token.

import { existsSync } from 'node:fs';
import { join } from 'node:path';

/** Config directory name in the user's home directory. */
const CONFIG_DIR_NAME = '.galvaniflow';
/** Directory used before the rename to GalvaniFlow. Read only, never written. */
const LEGACY_CONFIG_DIR_NAME = '.mirthless';

/**
 * Directory the CLI writes its config to.
 *
 * @param home - The user's home directory.
 */
export function configDir(home: string): string {
  return join(home, CONFIG_DIR_NAME);
}

/**
 * Config file to read. Uses ~/.galvaniflow, or ~/.mirthless when only the
 * pre-rename directory exists, so a saved login keeps working.
 *
 * @param home - The user's home directory.
 */
export function configFileToRead(home: string): string {
  const current = configDir(home);
  const legacy = join(home, LEGACY_CONFIG_DIR_NAME);
  const dir = !existsSync(current) && existsSync(legacy) ? legacy : current;
  return join(dir, 'config.json');
}
