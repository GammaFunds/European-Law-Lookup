import {
  parseStoredRetsinformationIndex,
  type RetsinformationIndex,
  type RetsinformationIndexEntry,
} from "./RetsinformationDiscoveryIndex";

export type RetsinformationIndexSlot = "a" | "b";

export interface RetsinformationDiscoveryIndexMetadata {
  activeSlot: RetsinformationIndexSlot | null;
  candidateSlot: RetsinformationIndexSlot | null;
}

export interface RetsinformationIndexTextAdapter {
  exists(path: string): Promise<boolean>;
  read(path: string): Promise<string>;
  write(path: string, data: string): Promise<void>;
  remove(path: string): Promise<void>;
}

export interface RetsinformationDiscoveryIndexMetadataPersistence {
  read(): RetsinformationDiscoveryIndexMetadata;
  save(metadata: RetsinformationDiscoveryIndexMetadata): Promise<void>;
}

const indexEntryFields: readonly (keyof RetsinformationIndexEntry)[] = [
  "canonicalEli",
  "popularTitle",
  "documentTitle",
  "documentType",
  "pubMedia",
  "year",
  "number",
  "status",
  "startDate",
  "endDate",
  "changeDate",
  "accessionNumber",
  "ministry",
  "announcedIn",
  "sourceUpdateTimestamp",
  "sitemapLastModified",
];

function isSlot(value: unknown): value is RetsinformationIndexSlot {
  return value === "a" || value === "b";
}

function sameEntry(left: RetsinformationIndexEntry, right: RetsinformationIndexEntry): boolean {
  return indexEntryFields.every((field) => left[field] === right[field]);
}

function sameIndex(left: RetsinformationIndex, right: RetsinformationIndex): boolean {
  if (
    left.schemaVersion !== right.schemaVersion
    || left.source !== right.source
    || left.generatedAt !== right.generatedAt
    || left.lastSuccessfulRefresh !== right.lastSuccessfulRefresh
    || left.lastSuccessfulIncrementalRefresh !== right.lastSuccessfulIncrementalRefresh
    || left.lastSuccessfulFullReconciliation !== right.lastSuccessfulFullReconciliation
    || left.feedWatermark !== right.feedWatermark
    || left.entries.length !== right.entries.length
  ) return false;
  const rightEntries = new Map(right.entries.map((entry) => [entry.canonicalEli, entry]));
  return [...left.entries]
    .sort((a, b) => a.canonicalEli.localeCompare(b.canonicalEli))
    .every((entry) => {
      const matching = rightEntries.get(entry.canonicalEli);
      return matching !== undefined && sameEntry(entry, matching);
    });
}

export class RetsinformationDiscoveryIndexStorage {
  private mutationTail: Promise<void> = Promise.resolve();

  constructor(
    private readonly baseDir: string,
    private readonly adapter: RetsinformationIndexTextAdapter,
    private readonly metadata: RetsinformationDiscoveryIndexMetadataPersistence,
  ) {}

  async loadActive(): Promise<RetsinformationIndex | null> {
    await this.mutationTail;
    const slot = this.readMetadata().activeSlot;
    return slot ? this.readValidatedSlot(slot) : null;
  }

  async loadCandidate(): Promise<RetsinformationIndex | null> {
    await this.mutationTail;
    const slot = this.readMetadata().candidateSlot;
    return slot ? this.readValidatedSlot(slot) : null;
  }

  saveCandidate(index: RetsinformationIndex): Promise<void> {
    return this.enqueueMutation(async () => {
      const intended = parseStoredRetsinformationIndex(index);
      const current = this.readMetadata();
      const slot: RetsinformationIndexSlot = current.activeSlot === "a" ? "b" : "a";
      await this.adapter.write(this.pathForSlot(slot), JSON.stringify(index));
      const readBack = await this.readValidatedSlot(slot);
      if (!readBack || !sameIndex(intended, readBack)) {
        throw new Error("Retsinformation index candidate read-back validation failed.");
      }
      await this.metadata.save({ activeSlot: current.activeSlot, candidateSlot: slot });
    });
  }

  activateCandidate(index: RetsinformationIndex): Promise<void> {
    return this.enqueueMutation(async () => {
      const intended = parseStoredRetsinformationIndex(index);
      const current = this.readMetadata();
      if (!current.candidateSlot) {
        throw new Error("Retsinformation index activation requires a validated candidate slot.");
      }
      const candidate = await this.readValidatedSlot(current.candidateSlot);
      if (!candidate || !sameIndex(intended, candidate)) {
        throw new Error("Retsinformation index activation candidate does not match the intended index.");
      }
      await this.metadata.save({ activeSlot: current.candidateSlot, candidateSlot: null });
    });
  }

  discardCandidate(): Promise<void> {
    return this.enqueueMutation(async () => {
      const current = this.readMetadata();
      if (!current.candidateSlot) return;
      const candidateSlot = current.candidateSlot;
      await this.metadata.save({ activeSlot: current.activeSlot, candidateSlot: null });
      await this.adapter.remove(this.pathForSlot(candidateSlot));
    });
  }

  private enqueueMutation<T>(operation: () => Promise<T>): Promise<T> {
    const run = this.mutationTail.then(operation);
    this.mutationTail = run.then(() => undefined, () => undefined);
    return run;
  }

  private readMetadata(): RetsinformationDiscoveryIndexMetadata {
    const value = this.metadata.read();
    if (typeof value !== "object" || value === null || !("activeSlot" in value) || !("candidateSlot" in value)) {
      throw new Error("Retsinformation index metadata is malformed.");
    }
    const activeSlot = value.activeSlot;
    const candidateSlot = value.candidateSlot;
    if ((activeSlot !== null && !isSlot(activeSlot)) || (candidateSlot !== null && !isSlot(candidateSlot))) {
      throw new Error("Retsinformation index metadata is malformed.");
    }
    if (activeSlot !== null && activeSlot === candidateSlot) {
      throw new Error("Retsinformation index metadata aliases active and candidate slots.");
    }
    return { activeSlot, candidateSlot };
  }

  private pathForSlot(slot: RetsinformationIndexSlot): string {
    return `${this.baseDir}/retsinformation-index-${slot}.json`;
  }

  private async readValidatedSlot(slot: RetsinformationIndexSlot): Promise<RetsinformationIndex> {
    const path = this.pathForSlot(slot);
    if (!await this.adapter.exists(path)) {
      throw new Error(`Retsinformation index metadata references missing slot ${slot}.`);
    }
    const raw = JSON.parse(await this.adapter.read(path)) as unknown;
    return parseStoredRetsinformationIndex(raw);
  }
}
