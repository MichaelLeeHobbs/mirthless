// ===========================================
// Connector Properties
// ===========================================
// Typed reads from a connector's free-form property bag, and the change
// handlers every source and destination form wires to its fields.

import type { ChangeEvent } from 'react';

type Props = Readonly<Record<string, unknown>>;

/** The string at `key`, or `fallback` when it is missing or not a string. */
export function getStr(props: Props, key: string, fallback: string): string {
  const val = props[key];
  return typeof val === 'string' ? val : fallback;
}

/** The number at `key`, or `fallback` when it is missing or not a number. */
export function getNum(props: Props, key: string, fallback: number): number {
  const val = props[key];
  return typeof val === 'number' ? val : fallback;
}

/** The boolean at `key`, or `fallback` when it is missing or not a boolean. */
export function getBool(props: Props, key: string, fallback: boolean): boolean {
  const val = props[key];
  return typeof val === 'boolean' ? val : fallback;
}

/** The nested `tls` object, or `{}` when it is missing or not an object. */
export function getTls(props: Props): Record<string, unknown> {
  const tls = props['tls'];
  return tls !== null && typeof tls === 'object' ? tls as Record<string, unknown> : {};
}

/** A string inside `tls`, or `''`. */
export function getTlsStr(props: Props, key: string): string {
  const val = getTls(props)[key];
  return typeof val === 'string' ? val : '';
}

/** A boolean inside `tls`, or `fallback`. */
export function getTlsBool(props: Props, key: string, fallback: boolean): boolean {
  const val = getTls(props)[key];
  return typeof val === 'boolean' ? val : fallback;
}

/** Change handlers that write one property and pass the whole bag to `onChange`. */
export interface PropertyUpdaters {
  readonly update: (key: string, value: unknown) => void;
  readonly handleText: (key: string) => (e: ChangeEvent<HTMLInputElement>) => void;
  /** Parses an integer; an empty or non-numeric field stores 0. */
  readonly handleNumber: (key: string) => (e: ChangeEvent<HTMLInputElement>) => void;
  readonly handleBool: (key: string) => (e: ChangeEvent<HTMLInputElement>, checked: boolean) => void;
}

/** Builds the handlers for one render of a connector form. */
export function propertyUpdaters(
  properties: Props,
  onChange: (properties: Record<string, unknown>) => void,
): PropertyUpdaters {
  const update = (key: string, value: unknown): void => {
    onChange({ ...properties, [key]: value });
  };
  return {
    update,
    handleText: (key) => (e): void => { update(key, e.target.value); },
    handleNumber: (key) => (e): void => {
      const parsed = parseInt(e.target.value, 10);
      update(key, Number.isNaN(parsed) ? 0 : parsed);
    },
    handleBool: (key) => (_e, checked): void => { update(key, checked); },
  };
}
