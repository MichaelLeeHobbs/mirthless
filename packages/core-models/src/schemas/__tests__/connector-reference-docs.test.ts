// ===========================================
// Connector Reference Docs Guard
// ===========================================
// docs/user/connector-reference.md must list exactly the keys each connector
// schema accepts: a key the schema gained but the table lacks fails, and so
// does a table row for a key the schema does not have. Add a connector here
// when its properties move into a core-models schema (#115).

import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { sourceCommonProperties, destinationCommonProperties } from '../connector-property-fields.js';
import { tcpMllpSourceObjectSchema, tcpMllpDestinationObjectSchema } from '../tcp-mllp-connector.schema.js';
import { httpSourceObjectSchema, httpDestinationObjectSchema } from '../http-connector.schema.js';
import { databaseSourceObjectSchema, databaseDestinationObjectSchema } from '../database-connector.schema.js';

const DOC = readFileSync(new URL('../../../../../docs/user/connector-reference.md', import.meta.url), 'utf-8');

/** The `### <heading>` section's table: every backticked key in its first column, `tls.cert`-style rows read as their top-level key. */
function documentedKeys(heading: string): string[] {
  const lines = DOC.split(/\r?\n/);
  const start = lines.findIndex((line) => line.trim() === `### ${heading}`);
  if (start === -1) throw new Error(`docs/user/connector-reference.md has no "### ${heading}" section`);
  const keys: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (line.startsWith('#')) break;
    const firstCell = line.startsWith('|') ? line.split('|')[1] ?? '' : '';
    for (const match of firstCell.matchAll(/`([^`]+)`/g)) keys.push((match[1] ?? '').split('.')[0] ?? '');
  }
  return [...new Set(keys)].sort();
}

const COMMON = {
  source: Object.keys(sourceCommonProperties),
  destination: Object.keys(destinationCommonProperties),
} as const;

/** Connectors whose properties have a core-models schema, by doc heading. */
const SCHEMAS = [
  ['TCP_MLLP as a source', 'source', tcpMllpSourceObjectSchema.shape],
  ['TCP_MLLP as a destination', 'destination', tcpMllpDestinationObjectSchema.shape],
  ['HTTP as a source', 'source', httpSourceObjectSchema.shape],
  ['HTTP as a destination', 'destination', httpDestinationObjectSchema.shape],
  ['DATABASE as a source', 'source', databaseSourceObjectSchema.shape],
  ['DATABASE as a destination', 'destination', databaseDestinationObjectSchema.shape],
] as const;

describe('docs/user/connector-reference.md property tables', () => {
  it('list the keys every source and every destination accepts', () => {
    expect(documentedKeys('Every source')).toEqual([...COMMON.source].sort());
    expect(documentedKeys('Every destination')).toEqual([...COMMON.destination].sort());
  });

  it.each(SCHEMAS)('%s lists exactly the schema keys', (heading, direction, shape) => {
    const own = Object.keys(shape).filter((key) => !COMMON[direction].includes(key));
    expect(documentedKeys(heading)).toEqual(own.sort());
  });
});
