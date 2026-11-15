// ===========================================
// Registry: factory types match the core-models lists
// ===========================================
// The channel API validates source and destination types against
// SOURCE_CONNECTOR_TYPES / DESTINATION_CONNECTOR_TYPES. A type the registry
// cannot build would save and then fail at deploy, so the lists and the
// registry's factories must name exactly the same types.

import { describe, it, expect } from 'vitest';
import {
  CONNECTOR_TYPES,
  SOURCE_CONNECTOR_TYPES,
  DESTINATION_CONNECTOR_TYPES,
} from '@galvaniflow/core-models';
import { createSourceConnector, createDestinationConnector } from '../registry.js';

/** True when the registry has a factory for the type; a factory that rejects empty properties still counts. */
function hasFactory(create: (type: string, props: Record<string, unknown>) => unknown, type: string): boolean {
  try {
    create(type, {});
    return true;
  } catch (err: unknown) {
    return !(err instanceof Error && /^Unknown (source|destination) connector type/.test(err.message));
  }
}

function typesWithFactory(create: (type: string, props: Record<string, unknown>) => unknown): string[] {
  return CONNECTOR_TYPES.filter((t) => hasFactory(create, t)).sort();
}

describe('connector registry types', () => {
  it('has a source factory for exactly SOURCE_CONNECTOR_TYPES', () => {
    expect(typesWithFactory(createSourceConnector)).toEqual([...SOURCE_CONNECTOR_TYPES].sort());
  });

  it('has a destination factory for exactly DESTINATION_CONNECTOR_TYPES', () => {
    expect(typesWithFactory(createDestinationConnector)).toEqual([...DESTINATION_CONNECTOR_TYPES].sort());
  });

  it('reports a type it has no factory for as unknown', () => {
    expect(hasFactory(createSourceConnector, 'SMTP')).toBe(false);
    expect(hasFactory(createDestinationConnector, 'EMAIL')).toBe(false);
  });
});
