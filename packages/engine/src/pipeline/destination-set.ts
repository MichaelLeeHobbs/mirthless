interface DestinationInfo {
  readonly name: string;
  readonly metaDataId: number;
}

export class DestinationSet {
  private readonly allDestinations: ReadonlyArray<DestinationInfo>;
  private readonly active: Set<string>;

  constructor(destinations: ReadonlyArray<DestinationInfo>) {
    this.allDestinations = destinations;
    this.active = new Set(destinations.map((d) => d.name));
  }

  removeAll(): void {
    this.active.clear();
  }

  /** Takes what Mirth's does: a name, a metaDataId, or a list of either. */
  remove(target: unknown): void {
    for (const name of this.resolve(target)) this.active.delete(name);
  }

  removeAllExcept(target: unknown): void {
    const keep = this.resolve(target).filter((name) => this.active.has(name));
    this.active.clear();
    for (const name of keep) this.active.add(name);
  }

  add(target: unknown): void {
    for (const name of this.resolve(target)) this.active.add(name);
  }

  contains(target: unknown): boolean {
    const names = this.resolve(target);
    return names.length > 0 && names.every((name) => this.active.has(name));
  }

  /** Unknown names and ids are ignored. */
  private resolve(target: unknown): string[] {
    const items: readonly unknown[] = Array.isArray(target) ? target : [target];
    const names: string[] = [];
    for (const item of items) {
      const dest = this.allDestinations.find((d) =>
        typeof item === 'number' ? d.metaDataId === item : d.name === String(item));
      if (dest) names.push(dest.name);
    }
    return names;
  }

  getConnectorNames(): ReadonlyArray<string> {
    return [...this.active];
  }

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

export function createDestinationSetProxy(set: DestinationSet): Record<string, unknown> {
  return {
    removeAll(): void { set.removeAll(); },
    remove(target: unknown): void { set.remove(target); },
    removeAllExcept(target: unknown): void { set.removeAllExcept(target); },
    add(target: unknown): void { set.add(target); },
    contains(target: unknown): boolean { return set.contains(target); },
    getConnectorNames(): ReadonlyArray<string> { return set.getConnectorNames(); },
  };
}
