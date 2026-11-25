import { describe, it, expect } from 'vitest';
import { deleteNotice } from '../message-delete.js';

describe('deleteNotice', () => {
  it('says how many were deleted', () => {
    expect(deleteNotice({ deletedCount: 3, refusedIds: [] })).toEqual(['Deleted 3 message(s)', 'success']);
  });

  it('warns about those that were not, and names them', () => {
    expect(deleteNotice({ deletedCount: 1, refusedIds: [7, 9] })).toEqual(['Deleted 1 message(s). Still being processed or sent, so not deleted: #7, #9', 'warning']);
  });

  it('names five of many', () => {
    expect(deleteNotice({ deletedCount: 1, refusedIds: [1, 2, 3, 4, 5, 6, 7] })[0]).toMatch(/: #1, #2, #3, #4, #5 and 2 more$/);
  });
});
