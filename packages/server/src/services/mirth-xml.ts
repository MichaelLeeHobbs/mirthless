// Reads of a parsed Mirth export, whose shape nothing guarantees.

import { isPlainObject } from '@galvanigraph/core-util';

export function getString(obj: unknown, key: string): string | null {
  if (!isPlainObject(obj)) return null;
  const val = obj[key];
  if (typeof val === 'string') return val;
  if (typeof val === 'number' || typeof val === 'boolean') return String(val);
  return null;
}

export function getBoolean(obj: unknown, key: string, defaultValue: boolean): boolean {
  const val = getString(obj, key);
  if (val === null) return defaultValue;
  return val === 'true';
}

export function getNumber(obj: unknown, key: string, defaultValue: number): number {
  if (!isPlainObject(obj)) return defaultValue;
  const val = obj[key];
  if (typeof val === 'number') return val;
  if (typeof val === 'string') {
    const parsed = Number(val);
    return Number.isFinite(parsed) ? parsed : defaultValue;
  }
  return defaultValue;
}

export function getNestedRecord(obj: Record<string, unknown>, key: string): Record<string, unknown> | null {
  const val = obj[key];
  return isPlainObject(val) ? val : null;
}

export function toRecordList(node: unknown): readonly Record<string, unknown>[] {
  if (Array.isArray(node)) return node.filter(isPlainObject);
  return isPlainObject(node) ? [node] : [];
}

/** A Mirth string list (`<values><string>a</string></values>`) or a bare array. */
export function stringList(node: unknown): string[] {
  if (Array.isArray(node)) return node.map(String);
  if (!isPlainObject(node)) return [];
  const raw = node['string'];
  const list: readonly unknown[] = Array.isArray(raw) ? raw : raw == null ? [] : [raw];
  return list.map(String);
}
