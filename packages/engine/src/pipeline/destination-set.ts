// ===========================================
// Destination Set
// ===========================================
// Controls which destinations receive a message.
// Available in source filter and source transformer scripts.

// ----- Types -----

interface DestinationInfo {
  readonly name: string;
  readonly metaDataId: number;
}

/** A destination name, a metaDataId, or a list of either, as a script passes them. */
export type DestinationTarget = unknown;

// ----- DestinationSet -----

/** Tracks which destinations are active for the current message. */
export class DestinationSet {
  private readonly allDestinations: ReadonlyArray<DestinationInfo>;
  private readonly active: Set<string>;

  constructor(destinations: ReadonlyArray<DestinationInfo>) {
    this.allDestinations = destinations;
    this.active = new Set(destinations.map((d) => d.name));
  }

  /** Remove all destinations. */
  removeAll(): void {
    this.active.clear();
  }

  /** Remove destinations. Takes what Mirth's does: a name, a metaDataId, or a list of either. */
  remove(target: DestinationTarget): void {
    for (const name of this.resolve(target)) this.active.delete(name);
  }

  /** Keep only the given destinations (a name, a metaDataId, or a list of either). */
  removeAllExcept(target: DestinationTarget): void {
    const keep = this.resolve(target).filter((name) => this.active.has(name));
    this.active.clear();
    for (const name of keep) this.active.add(name);
  }

  /** Add destinations back (must be known destinations). */
  add(target: DestinationTarget): void {
    for (const name of this.resolve(target)) this.active.add(name);
  }

  /** Check if a destination (by name or metaDataId) is currently active. */
  contains(target: DestinationTarget): boolean {
    const names = this.resolve(target);
    return names.length > 0 && names.every((name) => this.active.has(name));
  }

  /** The known destination names a target refers to. Unknown names and ids are ignored. */
  private resolve(target: DestinationTarget): string[] {
    const items: readonly unknown[] = Array.isArray(target) ? target : [target];
    const names: string[] = [];
    for (const item of items) {
      const dest = this.allDestinations.find((d) =>
        typeof item === 'number' ? d.metaDataId === item : d.name === String(item));
      if (dest) names.push(dest.name);
    }
    return names;
  }

  /** Get all active destination names. */
  getConnectorNames(): ReadonlyArray<string> {
    return [...this.active];
  }

  /** Get the metaDataIds of active destinations. */
  getActiveMetaDataIds(): ReadonlySet<number> {
    const ids = new Set<number>();
    for (const dest of this.allDestinations) {
      if (this.active.has(dest.name)) {
        ids.add(dest.metaDataId);
      }
    }
    return ids;
  }
}

// ----- Proxy -----

/** Create a plain-object proxy with closures for sandbox injection. */
export function createDestinationSetProxy(set: DestinationSet): Record<string, unknown> {
  return {
    removeAll(): void { set.removeAll(); },
    remove(target: DestinationTarget): void { set.remove(target); },
    removeAllExcept(target: DestinationTarget): void { set.removeAllExcept(target); },
    add(target: DestinationTarget): void { set.add(target); },
    contains(target: DestinationTarget): boolean { return set.contains(target); },
    getConnectorNames(): ReadonlyArray<string> { return set.getConnectorNames(); },
  };
}
