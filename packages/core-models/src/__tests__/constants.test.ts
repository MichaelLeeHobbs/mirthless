import { describe, it, expect } from 'vitest';
import { CONTENT_TYPE } from '../constants.js';

describe('CONTENT_TYPE', () => {
  // A changed number makes every message already stored unreadable, or read as another kind of content.
  it('keeps the numbers stored messages are keyed by', () => {
    expect(CONTENT_TYPE).toEqual({
      RAW: 1, PROCESSED: 2, TRANSFORMED: 3, ENCODED: 4, SENT: 5, RESPONSE: 6, RESPONSE_TRANSFORMED: 7,
      RESPONSE_SENT: 8, SOURCE_MAP: 9, CHANNEL_MAP: 10, ERROR: 11, RESPONSE_ERROR: 12, PROCESSING_ERROR: 13,
      SCRIPT_LOG: 14,
    });
  });
});
