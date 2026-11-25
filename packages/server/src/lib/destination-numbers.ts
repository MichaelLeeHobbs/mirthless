// A destination keeps its number (metaDataId) for as long as it exists, and no other destination
// of the channel gets it afterwards: stored messages, statistics and scripts go by it (#395, D-348).

import { randomUUID } from 'node:crypto';
import { ServiceError } from './service-error.js';

export interface DestinationRow {
  readonly id: string;
  readonly metaDataId: number;
}

export interface DestinationPlan {
  /** In the order of the request. */
  readonly rows: ReadonlyArray<DestinationRow & { readonly isNew: boolean }>;
  readonly removed: readonly string[];
  /** The number after the last one given out. */
  readonly next: number;
}

/** Past each number in use too, for rows written without raising `channels.nextMetaDataId`. */
export function nextNumber(next: number, stored: readonly DestinationRow[]): number {
  return Math.max(next, ...stored.map((row) => row.metaDataId + 1));
}

function assertDistinct(ids: ReadonlyArray<string | undefined>): void {
  const twice = ids.find((id, i) => id !== undefined && ids.indexOf(id) !== i);
  if (twice !== undefined) throw new ServiceError('INVALID_INPUT', `Two destinations have the id "${twice}"`);
}

/** In braces or without dashes too. */
function isUuid(id: string): boolean {
  return /^[0-9a-f]{32}$/i.test(id.replace(/[{}-]/g, ''));
}

/** A list the caller read before another save: taken as new, each destination would get a new number and leave its queue behind. */
function assertStored(ids: readonly string[], stored: readonly DestinationRow[]): void {
  const gone = ids.find((id) => isUuid(id) && !stored.some((s) => s.id === id));
  if (gone !== undefined) {
    throw new ServiceError('INVALID_INPUT', `The channel has no destination with the id "${gone}". Read the channel again. For a new destination, send an id that is not a UUID, such as "new-1"`);
  }
}

/** `ids`: what the request calls each destination, in lower case. One that is not a UUID is new. */
export function planDestinations(ids: readonly string[], stored: readonly DestinationRow[], next: number): DestinationPlan {
  assertDistinct(ids);
  assertStored(ids, stored);
  let number = nextNumber(next, stored);
  const rows = ids.map((id) => {
    const row = stored.find((s) => s.id === id);
    return row ? { ...row, isNew: false } : { id: randomUUID(), metaDataId: number++, isNew: true };
  });
  return { rows, removed: stored.filter((s) => !ids.includes(s.id)).map((s) => s.id), next: number };
}

export interface ConnectorRef {
  readonly connectorId: string | null;
  readonly metaDataId: number | null;
}

/** The row a filter or transformer is for, null for the source. */
export type ConnectorLookup = (ref: ConnectorRef, what: string) => string | null;

/** `ids`: what the request calls each destination, with its row in the same place of `rows`. */
export function connectorLookup(ids: ReadonlyArray<string | undefined>, rows: readonly { readonly id: string }[]): ConnectorLookup {
  assertDistinct(ids);
  return ({ connectorId, metaDataId }, what) => {
    if (connectorId === null && metaDataId === null) return null;
    if (connectorId !== null && metaDataId !== null) {
      throw new ServiceError('INVALID_INPUT', `${what} names its destination twice, by connectorId and by metaDataId`);
    }
    const row = rows[connectorId !== null ? ids.indexOf(connectorId) : (metaDataId ?? 0) - 1];
    if (!row) throw new ServiceError('INVALID_INPUT', `${what} is for a destination the channel does not have`);
    return row.id;
  };
}
