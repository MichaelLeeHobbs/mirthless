// ===========================================
// Registry ↔ core-models connector lists
// ===========================================
// The registry's map keys are typed by the core-models lists, so the compiler
// rejects a factory for a type the lists don't name. These tests cover the other
// direction: every type the lists name has a factory, so the UI and the API never
// offer a connector the engine can't build.

import { describe, it, expect } from 'vitest';
import { SOURCE_CONNECTOR_TYPES, DESTINATION_CONNECTOR_TYPES } from '@galvanigraph/core-models';
import { createSourceConnector, createDestinationConnector } from '../registry.js';

/** The error a create call threw, or undefined. A factory may reject empty props; that still proves it exists. */
function errorOf(create: () => unknown): string | undefined {
  try {
    create();
    return undefined;
  } catch (err: unknown) {
    return err instanceof Error ? err.message : String(err);
  }
}

describe('connector registry matches the core-models connector lists', () => {
  it.each(SOURCE_CONNECTOR_TYPES)('has a source factory for %s', (type) => {
    expect(errorOf(() => createSourceConnector(type, {})) ?? '').not.toMatch(/Unknown source connector type/);
  });

  it.each(DESTINATION_CONNECTOR_TYPES)('has a destination factory for %s', (type) => {
    expect(errorOf(() => createDestinationConnector(type, {})) ?? '').not.toMatch(/Unknown destination connector type/);
  });

  it('rejects a type in neither list', () => {
    expect(errorOf(() => createSourceConnector('FTP', {}))).toMatch(/Unknown source connector type: FTP/);
    expect(errorOf(() => createDestinationConnector('FTP', {}))).toMatch(/Unknown destination connector type: FTP/);
  });

  it('keeps the one-direction connectors one-directional', () => {
    expect(errorOf(() => createSourceConnector('SMTP', {}))).toMatch(/Unknown source connector type/);
    expect(errorOf(() => createSourceConnector('FHIR', {}))).toMatch(/Unknown source connector type/);
    expect(errorOf(() => createDestinationConnector('EMAIL', {}))).toMatch(/Unknown destination connector type/);
  });
});
