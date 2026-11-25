// Which destinations of a channel an imported file's are, and the numbers they get (D-348).

import { randomUUID } from 'node:crypto';
import type { ChannelExportEntry } from '@galvanigraph/core-models';
import { nextNumber, type DestinationRow } from './destination-numbers.js';
import { sameDestination, sameSettings, type ConnectorSettings } from './stored-credentials.js';

type FileDestination = ChannelExportEntry['destinations'][number];

/** Above it a number is a mistake, or meant to leave the channel none to give out: they end at 2,147,483,647. */
const MAX_NUMBER = 2_000_000_000;

export interface StoredDestination extends DestinationRow, ConnectorSettings {
  readonly name: string;
}

export interface ImportTarget {
  readonly stored: readonly StoredDestination[];
  /** The channel's nextMetaDataId. */
  readonly next: number;
  /** The numbers that messages wait on a queue for. */
  readonly waiting: ReadonlySet<number>;
  /** Ids in the file that rows of other channels have. */
  readonly takenIds: ReadonlySet<string>;
}

export interface ImportedRow extends DestinationRow {
  /** The destination it replaces. */
  readonly stored: StoredDestination | undefined;
}

export interface ImportPlan {
  /** In the order of the file. */
  readonly rows: readonly ImportedRow[];
  readonly next: number;
}

/** Why the file's numbers cannot be used at all, or null. */
export function numberError(entry: ChannelExportEntry): string | null {
  const numbers = entry.destinations.map((d) => d.metaDataId);
  const bad = entry.destinations.find((d) => !Number.isInteger(d.metaDataId) || d.metaDataId < 1 || d.metaDataId > MAX_NUMBER);
  if (bad) return `Channel "${entry.name}": destination "${bad.name}" has the metaDataId ${String(bad.metaDataId)}, which is not a whole number from 1 to ${String(MAX_NUMBER)}; not imported`;
  const twice = numbers.find((n, i) => numbers.indexOf(n) !== i);
  if (twice !== undefined) return `Channel "${entry.name}": two destinations have the metaDataId ${String(twice)}; not imported`;
  const ids = entry.destinations.flatMap((d) => d.id ?? []);
  const sameId = ids.find((id, i) => ids.indexOf(id) !== i);
  return sameId === undefined ? null : `Channel "${entry.name}": two destinations have the id ${sameId}; not imported`;
}

/** Whether a script of the file may go by a destination's number. Code templates are not in the file. */
function mayUseNumbers(entry: ChannelExportEntry): boolean {
  const scripts: unknown[] = [
    ...entry.scripts.map((s) => s.script),
    ...entry.filters.flatMap((f) => f.rules.map((r) => r.script)),
    ...entry.transformers.flatMap((t) => t.steps.map((s) => s.script)),
    entry.sourceConnectorProperties['script'],
    ...entry.destinations.flatMap((d) => [d.properties['script'], d.responseTransformer]),
  ];
  return scripts.some((script) => typeof script === 'string' && /destinationSet|metaDataId/.test(script));
}

/** By id; a file without ids, or from a server that gave other ones, by number and name together. */
function destinationsOf(entry: ChannelExportEntry, stored: readonly StoredDestination[]): ReadonlyArray<StoredDestination | undefined> {
  const byId = entry.destinations.map((d) => stored.find((s) => s.id === d.id));
  return entry.destinations.map((d, i) => {
    if (byId[i]) return byId[i];
    const same = sameDestination(d, entry.destinations, stored);
    return same && !byId.includes(same) ? same : undefined;
  });
}

function newId(file: FileDestination, target: ImportTarget, stored: StoredDestination | undefined): string {
  if (file.id !== undefined && !target.takenIds.has(file.id)) return file.id;
  return stored?.id ?? randomUUID();
}

export function planImport(entry: ChannelExportEntry, target: ImportTarget): ImportPlan | string {
  const matches = destinationsOf(entry, target.stored);
  const moved = entry.destinations.find((d, i) => {
    const stored = matches[i];
    return stored !== undefined && stored.id !== d.id && target.waiting.has(stored.metaDataId) && !sameSettings('destination', d, stored);
  });
  if (moved) {
    return `messages wait on the queue of "${moved.name}", and the file has other settings for it without saying that it is the same destination. Let the queue empty, or import it as a new channel`;
  }

  const first = nextNumber(target.next, target.stored);
  const keeps = (d: FileDestination, i: number): boolean => matches[i] === undefined && d.metaDataId >= first;
  let next = Math.max(first, ...entry.destinations.filter(keeps).map((d) => d.metaDataId + 1));
  const rows = entry.destinations.map((d, i) => {
    const stored = matches[i];
    const metaDataId = stored?.metaDataId ?? (keeps(d, i) ? d.metaDataId : next++);
    return { id: newId(d, target, stored), metaDataId, stored };
  });

  const changed = entry.destinations.filter((d, i) => d.metaDataId !== rows[i]!.metaDataId);
  if (changed.length > 0 && mayUseNumbers(entry)) {
    const names = changed.map((d) => `"${d.name}" (${String(d.metaDataId)})`).join(', ');
    return `${names} cannot have the metaDataId it has in the file, because this channel has used it for another destination, and the file's scripts may go by it. `
      + `Give it ${String(first)} or more in the file, and in the scripts, or import it as a new channel`;
  }
  return { rows, next };
}
