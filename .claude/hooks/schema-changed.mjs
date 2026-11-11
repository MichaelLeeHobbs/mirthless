#!/usr/bin/env node
// PostToolUse hook. After an edit under packages/server/src/db/schema, remind
// the agent that a schema change is not finished until its migration is
// generated, committed and exercised against Postgres.

import { readFileSync } from 'node:fs';

let input = {};
try {
  input = JSON.parse(readFileSync(0, 'utf8'));
} catch {
  process.exit(0);
}

const file = String(input?.tool_input?.file_path ?? '').replaceAll('\\', '/');
if (!file.includes('packages/server/src/db/schema/')) process.exit(0);

console.log(JSON.stringify({
  hookSpecificOutput: {
    hookEventName: 'PostToolUse',
    additionalContext:
      'You edited the database schema. Before finishing: run `pnpm db:generate`, commit the new file in ' +
      'packages/server/src/db/migrations with its meta snapshot, and run `pnpm test:integration` against Postgres ' +
      '(see the verification matrix in AGENTS.md).',
  },
}));
