import type { ChangeEvent } from 'react';

type Props = Readonly<Record<string, unknown>>;

export function getStr(props: Props, key: string, fallback: string): string {
  const val = props[key];
  return typeof val === 'string' ? val : fallback;
}

export function getNum(props: Props, key: string, fallback: number): number {
  const val = props[key];
  return typeof val === 'number' && Number.isFinite(val) ? val : fallback;
}

export function getBool(props: Props, key: string, fallback: boolean): boolean {
  const val = props[key];
  return typeof val === 'boolean' ? val : fallback;
}

export function getTls(props: Props): Record<string, unknown> {
  const tls = props['tls'];
  return tls !== null && typeof tls === 'object' ? tls as Record<string, unknown> : {};
}

export function getTlsStr(props: Props, key: string): string {
  const val = getTls(props)[key];
  return typeof val === 'string' ? val : '';
}

export function getTlsBool(props: Props, key: string, fallback: boolean): boolean {
  const val = getTls(props)[key];
  return typeof val === 'boolean' ? val : fallback;
}

export interface PropertyUpdaters {
  readonly update: (key: string, value: unknown) => void;
  readonly updateTls: (key: string, value: unknown) => void;
  readonly handleText: (key: string) => (e: ChangeEvent<HTMLInputElement>) => void;
  /** An empty or non-numeric field stores 0. */
  readonly handleNumber: (key: string) => (e: ChangeEvent<HTMLInputElement>) => void;
  readonly handleBool: (key: string) => (e: ChangeEvent<HTMLInputElement>, checked: boolean) => void;
}

export function propertyUpdaters(
  properties: Props,
  onChange: (properties: Record<string, unknown>) => void,
): PropertyUpdaters {
  const update = (key: string, value: unknown): void => {
    onChange({ ...properties, [key]: value });
  };
  return {
    update,
    updateTls: (key, value): void => { update('tls', { ...getTls(properties), [key]: value }); },
    handleText: (key) => (e): void => { update(key, e.target.value); },
    handleNumber: (key) => (e): void => {
      const parsed = parseInt(e.target.value, 10);
      update(key, Number.isNaN(parsed) ? 0 : parsed);
    },
    handleBool: (key) => (_e, checked): void => { update(key, checked); },
  };
}
