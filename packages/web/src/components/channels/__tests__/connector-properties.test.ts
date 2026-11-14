import { describe, it, expect, vi } from 'vitest';
import type { ChangeEvent } from 'react';
import { getBool, getNum, getStr, getTls, getTlsBool, getTlsStr, propertyUpdaters } from '../common/connector-properties.js';

function input(value: string): ChangeEvent<HTMLInputElement> {
  return { target: { value } } as ChangeEvent<HTMLInputElement>;
}

describe('property getters', () => {
  const props = { host: 'h', port: 6661, keepOpen: true, tls: { enabled: true, caCertificateId: 'c1' } };

  it('return the value when it has the expected type', () => {
    expect(getStr(props, 'host', 'x')).toBe('h');
    expect(getNum(props, 'port', 0)).toBe(6661);
    expect(getBool(props, 'keepOpen', false)).toBe(true);
  });

  it('return the fallback when the key is missing or has another type', () => {
    expect(getStr(props, 'port', 'x')).toBe('x');
    expect(getNum(props, 'host', 7)).toBe(7);
    expect(getBool(props, 'missing', false)).toBe(false);
  });

  it('read inside tls and tolerate a missing or invalid tls value', () => {
    expect(getTlsStr(props, 'caCertificateId')).toBe('c1');
    expect(getTlsBool(props, 'enabled', false)).toBe(true);
    expect(getTls({ tls: null })).toEqual({});
    expect(getTls({ tls: 'yes' })).toEqual({});
    expect(getTlsStr({}, 'caCertificateId')).toBe('');
    expect(getTlsBool({}, 'enabled', true)).toBe(true);
  });
});

describe('propertyUpdaters', () => {
  const properties = { host: 'h', port: 1 };

  it('writes one key and keeps the rest', () => {
    const onChange = vi.fn();
    propertyUpdaters(properties, onChange).update('host', 'new');
    expect(onChange).toHaveBeenCalledWith({ host: 'new', port: 1 });
  });

  it('stores text as typed', () => {
    const onChange = vi.fn();
    propertyUpdaters(properties, onChange).handleText('host')(input('db.local'));
    expect(onChange).toHaveBeenCalledWith({ host: 'db.local', port: 1 });
  });

  it('stores an integer, and 0 for an empty or non-numeric field', () => {
    const onChange = vi.fn();
    const { handleNumber } = propertyUpdaters(properties, onChange);
    handleNumber('port')(input('8080'));
    handleNumber('port')(input(''));
    handleNumber('port')(input('abc'));
    expect(onChange.mock.calls.map((c: unknown[]) => (c[0] as { port: number }).port)).toEqual([8080, 0, 0]);
  });

  it('stores the switch state', () => {
    const onChange = vi.fn();
    propertyUpdaters(properties, onChange).handleBool('keepOpen')(input(''), true);
    expect(onChange).toHaveBeenCalledWith({ host: 'h', port: 1, keepOpen: true });
  });
});
