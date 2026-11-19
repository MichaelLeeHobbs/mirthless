#!/usr/bin/env node
// core-models and core-util are built because the other packages import them from dist.

import { execSync } from 'node:child_process';

if (process.env.CLAUDE_CODE_REMOTE !== 'true') process.exit(0);

const root = process.env.CLAUDE_PROJECT_DIR ?? process.cwd();
const run = (command) => execSync(command, { cwd: root, stdio: 'inherit' });

try {
  run('pnpm install --frozen-lockfile');
  run('pnpm --filter @galvanigraph/core-models --filter @galvanigraph/core-util build');
} catch (error) {
  // Say so and carry on: a failed install must not block the session, but the
  // agent needs to know checks will fail until it is fixed.
  console.error(`session-start: setup failed: ${error instanceof Error ? error.message : String(error)}`);
}
