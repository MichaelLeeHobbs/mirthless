#!/usr/bin/env node
// Session start hook. In cloud sessions only (a fresh container with no
// node_modules), install dependencies and build core-models so the other
// packages typecheck. Local sessions are left alone.

import { execSync } from 'node:child_process';

if (process.env.CLAUDE_CODE_REMOTE !== 'true') process.exit(0);

const root = process.env.CLAUDE_PROJECT_DIR ?? process.cwd();
const run = (command) => execSync(command, { cwd: root, stdio: 'inherit' });

try {
  run('pnpm install --frozen-lockfile');
  run('pnpm --filter @galvaniflow/core-models build');
} catch (error) {
  // Say so and carry on: a failed install must not block the session, but the
  // agent needs to know checks will fail until it is fixed.
  console.error(`session-start: setup failed: ${error instanceof Error ? error.message : String(error)}`);
}
