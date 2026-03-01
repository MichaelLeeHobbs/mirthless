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

  /** Remove a specific destination by name. */
  remove(connectorName: string): void {
    this.active.delete(connectorName);
  }

  /** Remove all destinations except the named one. */
  removeAllExcept(connectorName: string): void {
    const keep = this.active.has(connectorName);
    this.active.clear();
    if (keep) {
      this.active.add(connectorName);
    }
  }

  /** Add a destination back by name (must be a known destination). */
  add(connectorName: string): void {
    const known = this.allDestinations.some((d) => d.name === connectorName);
    if (known) {
      this.active.add(connectorName);
    }
  }

  /** Check if a destination is currently active. */
  contains(connectorName: string): boolean {
    return this.active.has(connectorName);
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
    remove(connectorName: string): void { set.remove(connectorName); },
    removeAllExcept(connectorName: string): void { set.removeAllExcept(connectorName); },
    add(connectorName: string): void { set.add(connectorName); },
    contains(connectorName: string): boolean { return set.contains(connectorName); },
    getConnectorNames(): ReadonlyArray<string> { return set.getConnectorNames(); },
  };
}
