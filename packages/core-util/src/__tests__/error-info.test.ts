import { describe, it, expect } from 'vitest';
import { errorInfo } from '../error-info.js';

describe('errorInfo', () => {
  it('keeps message, name and stack of an Error', () => {
    const err = new TypeError('bad type');
    expect(errorInfo(err)).toEqual({ errMsg: 'bad type', name: 'TypeError', stack: err.stack });
  });

  it('keeps the message, name and stack of a plain error-shaped object', () => {
    expect(errorInfo({ message: 'socket hang up', name: 'FetchError', stack: 'at x', code: 'ECONNRESET' }))
      .toEqual({ errMsg: 'socket hang up', name: 'FetchError', stack: 'at x' });
    expect(errorInfo({ message: 'm' })).toEqual({ errMsg: 'm' });
  });

  it('turns any other value into a message string', () => {
    expect(errorInfo('plain text')).toEqual({ errMsg: 'plain text' });
    expect(errorInfo(42)).toEqual({ errMsg: '42' });
    expect(errorInfo(null)).toEqual({ errMsg: 'null' });
    expect(errorInfo(undefined)).toEqual({ errMsg: 'undefined' });
    expect(errorInfo({ message: 7 })).toEqual({ errMsg: '[object Object]' });
  });

  it('never throws, even for a value whose toString throws', () => {
    const hostile = { toString(): string { throw new Error('no'); } };
    expect(errorInfo(hostile)).toEqual({ errMsg: 'Unprintable error value' });
  });

  it('never throws for an Error subclass whose message getter throws', () => {
    class LazyError extends Error {
      override get message(): string { throw new Error('getter'); }
    }
    expect(errorInfo(new LazyError())).toEqual({ errMsg: 'Unprintable error value' });
  });

  it('never throws for a Proxy whose get trap throws', () => {
    const hostile = new Proxy({}, { get(): never { throw new Error('trap'); } });
    expect(errorInfo(hostile)).toEqual({ errMsg: 'Unprintable error value' });
  });

  it('falls back to the string form when only a field read throws', () => {
    const odd = {
      get message(): string { throw new Error('getter'); },
      toString(): string { return 'odd value'; },
    };
    expect(errorInfo(odd)).toEqual({ errMsg: 'odd value' });
  });

  it('never throws for a Proxy whose getPrototypeOf trap throws', () => {
    const hostile = new Proxy({}, { getPrototypeOf(): never { throw new Error('proto'); } });
    expect(errorInfo(hostile)).toEqual({ errMsg: '[object Object]' });
  });
});
