import { describe, it, expect } from 'vitest';
import { buildEventQueryString } from '../use-events.js';
import { buildExportUrl } from '../use-event-export.js';

const START = '2026-01-01T00:00:00.000Z';
const END = '2026-01-02T00:00:00.000Z';
const START_QS = 'startDate=2026-01-01T00%3A00%3A00.000Z';
const END_QS = 'endDate=2026-01-02T00%3A00%3A00.000Z';

const BLANK_FILTERS = { level: '', name: '', outcome: '', startDate: '', endDate: '' } as const;

describe('buildEventQueryString', () => {
  it('serialises paging and every filter in a fixed order', () => {
    const qs = buildEventQueryString({
      page: 2, pageSize: 50, level: 'ERROR', name: 'USER_LOGIN', outcome: 'FAILURE',
      userId: 'u-1', channelId: 'c 1', startDate: START, endDate: END,
    });
    expect(qs).toBe(
      `?page=2&pageSize=50&level=ERROR&name=USER_LOGIN&outcome=FAILURE&userId=u-1&channelId=c+1&${START_QS}&${END_QS}`,
    );
  });

  it('returns an empty string when nothing is set', () => {
    expect(buildEventQueryString({})).toBe('');
  });

  it('returns an empty string when every filter is an empty string', () => {
    expect(buildEventQueryString({ ...BLANK_FILTERS, userId: '', channelId: '' })).toBe('');
  });

  it('keeps a zero page and drops the empty filters', () => {
    expect(buildEventQueryString({ page: 0, level: 'WARN', name: '', startDate: START })).toBe(
      `?page=0&level=WARN&${START_QS}`,
    );
  });
});

describe('buildExportUrl', () => {
  it('serialises the format, every filter and maxRows in a fixed order', () => {
    const url = buildExportUrl({
      format: 'json', startDate: START, endDate: END, level: 'ERROR', name: 'USER_LOGIN',
      outcome: 'FAILURE', maxRows: 1000, reason: 'Incident 42',
    });
    expect(url).toBe(
      `/api/v1/events/export?format=json&${START_QS}&${END_QS}&level=ERROR&name=USER_LOGIN&outcome=FAILURE&maxRows=1000&reason=Incident+42`,
    );
  });

  it('sends only the format when no filter is set', () => {
    expect(buildExportUrl({ format: 'csv', ...BLANK_FILTERS, reason: 'x' })).toBe('/api/v1/events/export?format=csv&reason=x');
  });

  it('keeps a zero maxRows and drops the empty filters', () => {
    expect(buildExportUrl({ format: 'csv', name: 'A B', level: '', maxRows: 0, reason: 'x' })).toBe(
      '/api/v1/events/export?format=csv&name=A+B&maxRows=0&reason=x',
    );
  });
});
