// ===========================================
// isSourceConnectorType
// ===========================================

import { describe, it, expect } from 'vitest';
import { isSourceConnectorType, SOURCE_CONNECTOR_TYPES } from '../constants.js';

describe('isSourceConnectorType', () => {
  it.each(SOURCE_CONNECTOR_TYPES)('accepts the source type %s', (type) => {
    expect(isSourceConnectorType(type)).toBe(true);
  });

  it.each(['SMTP', 'FHIR'])('rejects the send-only type %s', (type) => {
    expect(isSourceConnectorType(type)).toBe(false);
  });

  it('rejects a name that is no connector type', () => {
    expect(isSourceConnectorType('FTP')).toBe(false);
    expect(isSourceConnectorType('')).toBe(false);
  });
});
