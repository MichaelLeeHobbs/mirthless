interface DestinationInfo {
  readonly name: string;
  readonly metaDataId: number;
}

export class DestinationSet {
  private readonly allDestinations: ReadonlyArray<DestinationInfo>;
  private readonly active: Set<number>;

  constructor(destinations: ReadonlyArray<DestinationInfo>) {
    this.allDestinations = destinations;
    this.active = new Set(destinations.map((d) => d.metaDataId));
  }

  removeAll(): void {
    this.active.clear();
  }

  /** Takes what Mirth's does: a name, a metaDataId, or a list of either. */
  remove(target: unknown): void {
    for (const id of this.resolve(target)) this.active.delete(id);
  }

  removeAllExcept(target: unknown): void {
    const keep = this.resolve(target).filter((id) => this.active.has(id));
    this.active.clear();
    for (const id of keep) this.active.add(id);
  }

  add(target: unknown): void {
    for (const id of this.resolve(target)) this.active.add(id);
  }

  contains(target: unknown): boolean {
    const ids = this.resolve(target);
    return ids.length > 0 && ids.every((id) => this.active.has(id));
  }

  /** Unknown names and ids are ignored. A name stands for every destination that has it. */
  private resolve(target: unknown): number[] {
    const items: readonly unknown[] = Array.isArray(target) ? target : [target];
    return items.flatMap((item) => this.allDestinations
      .filter((d) => (typeof item === 'number' ? d.metaDataId === item : d.name === String(item)))
      .map((d) => d.metaDataId));
  }

  getConnectorNames(): ReadonlyArray<string> {
    const names = [...this.active].map((id) => this.allDestinations.find((d) => d.metaDataId === id)!.name);
    return [...new Set(names)];
  }

  getActiveMetaDataIds(): ReadonlySet<number> {
    return new Set(this.allDestinations.map((d) => d.metaDataId).filter((id) => this.active.has(id)));
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
