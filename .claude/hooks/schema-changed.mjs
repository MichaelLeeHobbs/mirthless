#!/usr/bin/env node
// PostToolUse hook. After an edit to a file whose facts other files restate,
// remind the agent what else must change before the work is finished. One
// entry per kind of file; the first match wins.

import { readFileSync } from 'node:fs';

/** Which edited file triggers which reminder. */
const REMINDERS = [
  {
    match: (file) => file.includes('packages/server/src/db/schema/'),
    text:
      'You edited the database schema. Before finishing: run `pnpm db:generate`, commit the new file in ' +
      'packages/server/src/db/migrations with its meta snapshot, and run `pnpm test:integration` against Postgres ' +
      '(see the verification matrix in AGENTS.md).',
  },
  {
    match: (file) =>
      file.endsWith('packages/connectors/src/registry.ts') ||
      file.endsWith('packages/core-models/src/schemas/queue-connector.schema.ts'),
    text:
      'You edited what a connector reads. If a property was added, renamed or removed, or its security changed, ' +
      "update docs/user/connector-reference.md (the connector's property table, and its matrix row for direction or " +
      'transport security). The docs guard in pnpm gate checks connector types and headings, not property keys (#115).',
  },
  {
    match: (file) =>
      file.endsWith('packages/server/src/db/seeds/roles.ts') ||
      file.endsWith('packages/core-models/src/constants.ts') ||
      file.includes('packages/server/src/routes/') ||
      file.endsWith('packages/server/src/lib/socket.ts'),
    text:
      'If you changed a role, a permission, which permission a route or socket room checks, or added a route with no ' +
      'permission check, update docs/user/access-control.md (the role matrix, "Also allows", or the list of endpoints ' +
      'anyone signed in can call) and the ENDPOINTS table in packages/server/src/routes/__tests__/role-access.test.ts for ' +
      'PHI or destructive endpoints. If you changed connector types, update docs/user/connector-reference.md.',
  },
];

let input = {};
try {
  input = JSON.parse(readFileSync(0, 'utf8'));
} catch {
  process.exit(0);
}

const file = String(input?.tool_input?.file_path ?? '').replaceAll('\\', '/');
const reminder = REMINDERS.find((r) => r.match(file));
if (!reminder) process.exit(0);

console.log(JSON.stringify({
  hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: reminder.text },
}));
