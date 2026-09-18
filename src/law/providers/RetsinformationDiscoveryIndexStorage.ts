import {
  parseStoredRetsinformationIndex,
  type RetsinformationIndex,
  type RetsinformationIndexEntry,
} from "./RetsinformationDiscoveryIndex";

export type RetsinformationIndexSlot = "a" | "b";

export interface RetsinformationIndexStoreMetadata {
  activeSlot: RetsinformationIndexSlot | null;
  candidateSlot: RetsinformationIndexSlot | null;
}

export interface RetsinformationIndexTextAdapter {
  exists(path: string): Promise<boolean>;
  read(path: string): Promise<string>;
  write(path: string, data: string): Promise<void>;
  remove(path: string): Promise<void>;
}

export interface RetsinformationIndexMetadataPersistence {
  read(): RetsinformationIndexStoreMetadata;
  save(metadata: RetsinformationIndexStoreMetadata): Promise<void>;
}

function sameEntry(left: RetsinformationIndexEntry, right: RetsinformationIndexEntry): boolean {
  return Object.keys(left).every((field) => left[field as keyof RetsinformationIndexEntry] === right[field as keyof RetsinformationIndexEntry]);
}

function sameIndex(left: RetsinformationIndex, right: RetsinformationIndex): boolean {
  if (left.schemaVersion !== right.schemaVersion || left.source !== right.source
      || left.generatedAt !== right.generatedAt
      || left.lastSuccessfulRefresh !== right.lastSuccessfulRefresh
      || left.lastSuccessfulIncrementalRefresh !== right.lastSuccessfulIncrementalRefresh
      || left.lastSuccessfulFullReconciliation !== right.lastSuccessfulFullReconciliation
      || left.feedWatermark !== right.feedWatermark
      || left.entries.length !== right.entries.length) return false;
  const leftEntries = [...left.entries].sort((a, b) => a.canonicalEli.localeCompare(b.canonicalEli));
  const rightEntries = [...right.entries].sort((a, b) => a.canonicalEli.localeCompare(b.canonicalEli));
  return leftEntries.every((entry, index) => entry.canonicalEli === rightEntries[index].canonicalEli
    && sameEntry(entry, rightEntries[index]));
}

function requireSlot(value: unknown, field: string): RetsinformationIndexSlot | null {
  if (value === null || value === "a" || value === "b") return value;
  throw new Error(`Invalid Retsinformation index metadata field: ${field}`);
}

export class RetsinformationDiscoveryIndexStorage {
  private mutationTail: Promise<void> = Promise.resolve();

  constructor(
    private readonly baseDir: string,
    private readonly adapter: RetsinformationIndexTextAdapter,
    private readonly metadata: RetsinformationIndexMetadataPersistence,
  ) {}

  async loadActive(): Promise<RetsinformationIndex | null> {
    await this.mutationTail;
    const slot = this.currentMetadata().activeSlot;
    return slot ? this.readValidated(slot) : null;
  }

  async loadCandidate(): Promise<RetsinformationIndex | null> {
    await this.mutationTail;
    const slot = this.currentMetadata().candidateSlot;
    return slot ? this.readValidated(slot) : null;
  }

  saveCandidate(index: RetsinformationIndex): Promise<void> {
    return this.enqueue(async () => {
      const intended = parseStoredRetsinformationIndex(index);
      const current = this.currentMetadata();
      const slot: RetsinformationIndexSlot = current.activeSlot === "a" ? "b" : "a";
      const path = this.pathForSlot(slot);
      await this.adapter.write(path, JSON.stringify(intended));
      const readBack = await this.readValidated(slot);
      if (!readBack || !sameIndex(intended, readBack)) throw new Error("Retsinformation candidate read-back validation failed.");
      await this.metadata.save({ activeSlot: current.activeSlot, candidateSlot: slot });
    });
  }

  activateCandidate(index: RetsinformationIndex): Promise<void> {
    return this.enqueue(async () => {
      const intended = parseStoredRetsinformationIndex(index);
      const current = this.currentMetadata();
      if (!current.candidateSlot) throw new Error("Retsinformation activation requires a candidate slot.");
      const recorded = await this.readValidated(current.candidateSlot);
      if (!recorded || !sameIndex(intended, recorded)) throw new Error("Retsinformation activation candidate mismatch.");
      await this.metadata.save({ activeSlot: current.candidateSlot, candidateSlot: null });
    });
  }

  discardCandidate(): Promise<void> {
    return this.enqueue(async () => {
      const current = this.currentMetadata();
      if (!current.candidateSlot) return;
      const candidateSlot = current.candidateSlot;
      await this.metadata.save({ activeSlot: current.activeSlot, candidateSlot: null });
      if (candidateSlot !== current.activeSlot) {
        const path = this.pathForSlot(candidateSlot);
        if (await this.adapter.exists(path)) await this.adapter.remove(path);
      }
    });
  }

  private enqueue(operation: () => Promise<void>): Promise<void> {
    const run = this.mutationTail.then(operation);
    this.mutationTail = run.then(() => undefined, () => undefined);
    return run;
  }

  private currentMetadata(): RetsinformationIndexStoreMetadata {
    const raw = this.metadata.read();
    const activeSlot = requireSlot(raw.activeSlot, "activeSlot");
    const candidateSlot = requireSlot(raw.candidateSlot, "candidateSlot");
    return { activeSlot, candidateSlot };
  }

  private pathForSlot(slot: RetsinformationIndexSlot): string {
    return `${this.baseDir}/dk-discovery-index-${slot}.json`;
  }

  private async readValidated(slot: RetsinformationIndexSlot): Promise<RetsinformationIndex | null> {
    const path = this.pathForSlot(slot);
    if (!await this.adapter.exists(path)) return null;
    return parseStoredRetsinformationIndex(JSON.parse(await this.adapter.read(path)));
  }
}
