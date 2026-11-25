/**
 * What `vi.useFakeTimers` fakes here. Not `process.hrtime`: the metrics read it on an interval of their
 * own, which is real in a test that fakes timers later, and make up, observation by observation, for
 * the days between a faked time and the real one (#487).
 */
export const FAKED_TIMERS: readonly ('setTimeout' | 'clearTimeout' | 'setInterval' | 'clearInterval' | 'setImmediate' | 'clearImmediate' | 'Date' | 'performance')[] = [
  'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'setImmediate', 'clearImmediate', 'Date', 'performance',
];
