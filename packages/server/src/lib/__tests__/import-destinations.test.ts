import { describe, expect, it } from 'vitest';
import type { ChannelExportEntry } from '@galvanigraph/core-models';
import { numberError, planImport, type ImportTarget, type StoredDestination } from '../import-destinations.js';

type FileDestination = ChannelExportEntry['destinations'][number];

const A = '00000000-0000-4000-8000-00000000000a';
const B = '00000000-0000-4000-8000-00000000000b';
const C = '00000000-0000-4000-8000-00000000000c';
const DB = { host: 'db.example.org', username: 'svc', password: 'secret', query: 'SELECT 1' };

function dest(metaDataId: number, name: string, id?: string, properties: Record<string, unknown> = DB): FileDestination {
  return {
    ...(id === undefined ? {} : { id }), metaDataId, name, properties, connectorType: 'DATABASE', enabled: true, queueMode: 'NEVER',
    retryCount: 0, retryIntervalMs: 0, rotateQueue: false, queueThreadCount: 1, waitForPrevious: false,
  };
}

function entry(destinations: readonly FileDestination[], sourceScript = ''): ChannelExportEntry {
  return {
    name: 'Labs', destinations: [...destinations], scripts: [], filters: [], sourceConnectorProperties: {},
    transformers: sourceScript === '' ? [] : [{
      connectorId: null, inboundDataType: 'RAW', outboundDataType: 'RAW', inboundProperties: {}, outboundProperties: {}, inboundTemplate: null, outboundTemplate: null,
      steps: [{ enabled: true, name: null, type: 'JAVASCRIPT', script: sourceScript, sourceField: null, targetField: null, defaultValue: null, mapping: null }],
    }],
  } as unknown as ChannelExportEntry;
}

const row = (metaDataId: number, name: string, id: string, properties: Record<string, unknown> = DB): StoredDestination =>
  ({ id, metaDataId, name, connectorType: 'DATABASE', properties });

function target(stored: readonly StoredDestination[], over: Partial<ImportTarget> = {}): ImportTarget {
  return { stored, next: Math.max(0, ...stored.map((s) => s.metaDataId)) + 1, waiting: new Set(), takenIds: new Set(), ...over };
}

function planned(file: ChannelExportEntry, to: ImportTarget): unknown {
  const plan = planImport(file, to);
  return typeof plan === 'string' ? plan : { rows: plan.rows.map((r) => [r.metaDataId, r.id, r.stored?.name]), next: plan.next };
}

const ROUTES = 'destinationSet.remove(1);';

describe('planImport', () => {
  it('keeps the numbers and the ids of the file in a new channel', () => {
    expect(planned(entry([dest(2, 'Clinic', B), dest(7, 'Lab', A)], ROUTES), target([]))).toEqual({ rows: [[2, B, undefined], [7, A, undefined]], next: 8 });
  });

  it('makes an id when the file has none, or one that another channel has', () => {
    const plan = planImport(entry([dest(1, 'Lab'), dest(2, 'Clinic', B)]), target([], { takenIds: new Set([B]) }));
    if (typeof plan === 'string') throw new Error(plan);
    for (const { id } of plan.rows) expect(id).toMatch(/^[0-9a-f-]{36}$/);
    expect(plan.rows[1]!.id).not.toBe(B);
  });

  describe('over a channel', () => {
    const stored = [row(1, 'Lab', A), row(2, 'Clinic', B)];

    it('a destination is the one with its id, whatever it is called and wherever it goes now', () => {
      const file = entry([dest(2, 'Clinic 2', B, { host: 'elsewhere' }), dest(1, 'Lab', A)], ROUTES);
      expect(planned(file, target(stored, { waiting: new Set([1, 2]) }))).toEqual({ rows: [[2, B, 'Clinic'], [1, A, 'Lab']], next: 3 });
    });

    it('one that another of the file\'s is by its id is not found again by number and name', () => {
      const file = entry([dest(2, 'Lab 2', A), dest(1, 'Lab', C)]);
      expect(planned(file, target([row(1, 'Lab', A)], { next: 5 }))).toEqual({ rows: [[1, A, 'Lab'], [5, C, undefined]], next: 6 });
    });

    it('a name that another of the file\'s has too finds none, also when that one is found by its id', () => {
      const file = entry([dest(1, 'Clinic', A), dest(2, 'Clinic')]);
      expect(planned(file, target(stored))).toMatchObject({ rows: [[1, A, 'Lab'], [3, expect.not.stringMatching(B), undefined]] });
    });

    it('a new one keeps its number when the channel has not used it', () => {
      expect(planned(entry([dest(1, 'Lab', A), dest(5, 'Ward', C)], ROUTES), target(stored))).toEqual({ rows: [[1, A, 'Lab'], [5, C, undefined]], next: 6 });
    });

    it.each([
      ['that another destination has', stored, 3],
      ['that a removed one had', [row(1, 'Lab', A)], 3],
    ])('a new one does not get a number %s, but the next one', (_what, now, next) => {
      const file = entry([dest(1, 'Lab', A), dest(2, 'Ward', C)]);
      expect(planned(file, target(now, { next }))).toEqual({ rows: [[1, A, 'Lab'], [3, C, undefined]], next: 4 });
    });

    it('two new ones do not get one number', () => {
      const file = entry([dest(1, 'Ward', C), dest(3, 'Store')]);
      const plan = planImport(file, target(stored));
      expect(typeof plan === 'string' ? plan : [plan.rows.map((r) => r.metaDataId), plan.next]).toEqual([[4, 3], 5]);
    });

    it.each([
      ['destinationSet in a transformer', entry([dest(1, 'Lab', A), dest(2, 'Ward', C)], ROUTES)],
      ['metaDataId in a destination script', entry([dest(1, 'Lab', A), { ...dest(2, 'Ward', C), properties: { script: 'return connectorMessage.metaDataId;' } }])],
      ['destinationSet in a filter', { ...entry([dest(1, 'Lab', A), dest(2, 'Ward', C)]), filters: [{ connectorId: null, rules: [{ script: ROUTES }] }] } as unknown as ChannelExportEntry],
      ['destinationSet in the preprocessor', { ...entry([dest(1, 'Lab', A), dest(2, 'Ward', C)]), scripts: [{ scriptType: 'PREPROCESSOR', script: ROUTES }] } as ChannelExportEntry],
      ['metaDataId in a response transformer', entry([dest(1, 'Lab', A), { ...dest(2, 'Ward', C), responseTransformer: 'metaDataId' }])],
      ['metaDataId in a JavaScript source', { ...entry([dest(1, 'Lab', A), dest(2, 'Ward', C)]), sourceConnectorProperties: { script: 'metaDataId' } } as ChannelExportEntry],
    ])('is refused when a number has to change and the file has %s', (_what, file) => {
      expect(planImport(file, target(stored))).toMatch(/^"Ward" \(2\) cannot have the metaDataId .*Give it 3 or more/);
    });

    it('is refused too when a destination that keeps its own number has another in the file', () => {
      expect(planImport(entry([dest(4, 'Lab', A)], ROUTES), target(stored))).toMatch(/^"Lab" \(4\) cannot have/);
      expect(planned(entry([dest(4, 'Lab', A)]), target(stored))).toEqual({ rows: [[1, A, 'Lab']], next: 3 });
    });

    it('gives a file that brings back a removed destination a new number for it', () => {
      expect(planned(entry([dest(1, 'Lab', A), dest(2, 'Clinic', B)]), target([row(2, 'Clinic', B)], { next: 3 }))).toEqual({ rows: [[3, A, undefined], [2, B, 'Clinic']], next: 4 });
    });

    it('goes past numbers that were written without counting them', () => {
      expect(planned(entry([dest(1, 'Lab', A), dest(2, 'Clinic', B), dest(9, 'Ward', C)]), target(stored, { next: 1 }))).toMatchObject({ next: 10 });
      expect(planned(entry([dest(1, 'Ward', C)]), target(stored, { next: 1 }))).toEqual({ rows: [[3, C, undefined]], next: 4 });
    });
  });

  describe('a file without ids, or with those of another server', () => {
    const stored = [row(1, 'Lab', A), row(2, 'Clinic', B)];
    const OTHER = '00000000-0000-4000-8000-0000000000ff';

    it.each([['no id', undefined, A], ['another id, which it has from then on', OTHER, OTHER]])('is matched by number and name together: %s', (_what, id, expected) => {
      expect(planned(entry([dest(1, 'Lab', id)], ROUTES), target(stored))).toEqual({ rows: [[1, expected, 'Lab']], next: 3 });
    });

    it('keeps the row\'s id when the other one is taken', () => {
      expect(planned(entry([dest(1, 'Lab', OTHER)]), target(stored, { takenIds: new Set([OTHER]) }))).toEqual({ rows: [[1, A, 'Lab']], next: 3 });
    });

    it.each([
      ['name alone', dest(3, 'Lab')],
      ['number alone', dest(1, 'Ward')],
    ])('is not matched by %s', (_what, file) => {
      const plan = planImport(entry([file]), target(stored));
      expect(typeof plan === 'string' ? plan : plan.rows.map((r) => [r.metaDataId, r.stored])).toEqual([[3, undefined]]);
    });

    it('is not matched by a name that two have', () => {
      const twins = [row(1, 'Lab', A), row(2, 'Lab', B)];
      const plan = planImport(entry([dest(1, 'Lab'), dest(2, 'Lab')]), target(twins));
      expect(typeof plan === 'string' ? plan : plan.rows.map((r) => [r.metaDataId, r.stored])).toEqual([[3, undefined], [4, undefined]]);
    });

    it('does not take a destination that the file has by id', () => {
      const plan = planImport(entry([dest(1, 'Ward', A), dest(3, 'Lab')]), target(stored));
      expect(typeof plan === 'string' ? plan : plan.rows.map((r) => [r.metaDataId, r.stored?.name])).toEqual([[1, 'Lab'], [3, undefined]]);
    });

    it('is refused when messages wait for the one here and the file has other settings for it', () => {
      const moved = entry([dest(1, 'Lab', undefined, { ...DB, host: 'elsewhere' })]);
      expect(planImport(moved, target(stored, { waiting: new Set([1]) }))).toMatch(/^messages wait on the queue of "Lab"/);
      expect(planned(moved, target(stored, { waiting: new Set([2]) }))).toMatchObject({ rows: [[1, A, 'Lab']] });
    });

    it.each([
      ['the same', DB],
      ['the same with the password masked', { ...DB, password: '__REDACTED__' }],
      ['the same with another password', { ...DB, password: 'rotated' }],
    ])('is taken while messages wait when its settings are %s', (_what, properties) => {
      expect(planned(entry([dest(1, 'Lab', undefined, properties)]), target(stored, { waiting: new Set([1]) }))).toMatchObject({ rows: [[1, A, 'Lab']] });
    });

    it('counts another connector type as other settings', () => {
      const file = entry([{ ...dest(1, 'Lab'), connectorType: 'HTTP' }]);
      expect(planImport(file, target(stored, { waiting: new Set([1]) }))).toMatch(/^messages wait/);
    });
  });
});

describe('numberError', () => {
  it.each([
    ['0, the source\'s', [dest(0, 'Lab')], 'has the metaDataId 0'],
    ['a fraction', [dest(1.5, 'Lab')], 'has the metaDataId 1.5'],
    ['a negative one', [dest(-1, 'Lab')], 'has the metaDataId -1'],
    ['one that leaves none to give out', [dest(2_147_483_647, 'Lab')], 'has the metaDataId 2147483647'],
    ['one that two have', [dest(1, 'Lab'), dest(1, 'Clinic')], 'two destinations have the metaDataId 1'],
    ['an id that two have', [dest(1, 'Lab', A), dest(2, 'Clinic', A)], `two destinations have the id ${A}`],
  ])('names the channel and what is wrong with %s', (_what, destinations, message) => {
    const error = numberError(entry(destinations));
    expect(error).toMatch(/^Channel "Labs": .*not imported$/);
    expect(error).toContain(message);
  });

  it('is null for the numbers and ids of an ordinary file', () => {
    expect(numberError(entry([dest(1, 'Lab', A), dest(1_000_000, 'Clinic'), dest(3, 'Ward')]))).toBeNull();
    expect(numberError(entry([]))).toBeNull();
  });
});
