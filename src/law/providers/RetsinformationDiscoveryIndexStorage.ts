import {
  parseStoredRetsinformationIndex,
  type RetsinformationIndex,
  type RetsinformationIndexEntry,
} from "./RetsinformationDiscoveryIndex";
import { parseDkCanonicalEli } from "./retsinformationIdentity";
import type { RetsinformationSitemapEntry } from "./RetsinformationSitemap";

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

export interface RetsinformationBootstrapCheckpoint {
  schemaVersion: 1;
  startedAt: string;
  sitemapEntries: RetsinformationSitemapEntry[];
  nextEntryIndex: number;
  validatedEntries: RetsinformationIndexEntry[];
}

const CHECKPOINT_FILENAME = "dk-discovery-bootstrap.json";

const checkpointFields: readonly string[] = [
  "schemaVersion",
  "startedAt",
  "sitemapEntries",
  "nextEntryIndex",
  "validatedEntries",
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireExactCheckpointFields(raw: Record<string, unknown>): void {
  const actual = Object.keys(raw).sort();
  const expected = [...checkpointFields].sort();
  if (actual.length !== expected.length || actual.some((field, index) => field !== expected[index])) {
    throw new Error("Retsinformation bootstrap checkpoint has an invalid field shape.");
  }
}

class RetsinformationBootstrapCheckpointError extends Error {}

function parseStoredBootstrapCheckpoint(raw: unknown): RetsinformationBootstrapCheckpoint {
  if (!isRecord(raw)) {
    throw new RetsinformationBootstrapCheckpointError("Retsinformation bootstrap checkpoint must be an object.");
  }
  requireExactCheckpointFields(raw);

  if (raw.schemaVersion !== 1) {
    throw new RetsinformationBootstrapCheckpointError("Unsupported Retsinformation bootstrap checkpoint schema version.");
  }

  if (typeof raw.startedAt !== "string") {
    throw new RetsinformationBootstrapCheckpointError("startedAt must be a string.");
  }

  if (!Array.isArray(raw.sitemapEntries)) {
    throw new RetsinformationBootstrapCheckpointError("sitemapEntries must be an array.");
  }

  const seenEli = new Set<string>();
  const sitemapEntries: RetsinformationSitemapEntry[] = raw.sitemapEntries.map((rawEntry, index) => {
    if (!isRecord(rawEntry)) {
      throw new RetsinformationBootstrapCheckpointError(`sitemapEntries[${index}] must be an object.`);
    }
    if (Object.keys(rawEntry).length !== 2 || !("canonicalEli" in rawEntry) || !("sitemapLastModified" in rawEntry)) {
      throw new RetsinformationBootstrapCheckpointError(`sitemapEntries[${index}] has an invalid field shape.`);
    }
    if (typeof rawEntry.canonicalEli !== "string") {
      throw new RetsinformationBootstrapCheckpointError(`sitemapEntries[${index}] canonicalEli must be a string.`);
    }
    const parsed = parseDkCanonicalEli(rawEntry.canonicalEli);
    if (!parsed || parsed.canonicalEli !== rawEntry.canonicalEli) {
      throw new RetsinformationBootstrapCheckpointError(`sitemapEntries[${index}] canonicalEli is not canonical.`);
    }
    if (seenEli.has(rawEntry.canonicalEli)) {
      throw new RetsinformationBootstrapCheckpointError(`Duplicate canonicalEli in sitemapEntries: "${rawEntry.canonicalEli}".`);
    }
    seenEli.add(rawEntry.canonicalEli);

    const sitemapLastModified = rawEntry.sitemapLastModified;
    if (sitemapLastModified !== null && typeof sitemapLastModified !== "string") {
      throw new RetsinformationBootstrapCheckpointError(`sitemapEntries[${index}] sitemapLastModified must be a string or null.`);
    }

    return { canonicalEli: rawEntry.canonicalEli, sitemapLastModified };
  });

  if (typeof raw.nextEntryIndex !== "number" || !Number.isInteger(raw.nextEntryIndex) || raw.nextEntryIndex < 0) {
    throw new RetsinformationBootstrapCheckpointError("nextEntryIndex must be a non-negative integer.");
  }
  if (raw.nextEntryIndex > sitemapEntries.length) {
    throw new RetsinformationBootstrapCheckpointError("nextEntryIndex must not exceed sitemapEntries length.");
  }

  if (!Array.isArray(raw.validatedEntries)) {
    throw new RetsinformationBootstrapCheckpointError("validatedEntries must be an array.");
  }

  if (raw.validatedEntries.length !== raw.nextEntryIndex) {
    throw new RetsinformationBootstrapCheckpointError("validatedEntries length must equal nextEntryIndex.");
  }

  const validatedEntries: RetsinformationIndexEntry[] = raw.validatedEntries.map((rawEntry, index) => {
    if (!isRecord(rawEntry)) {
      throw new RetsinformationBootstrapCheckpointError(`validatedEntries[${index}] must be an object.`);
    }

    const parsed = parseStoredRetsinformationIndex({
      schemaVersion: 1,
      source: "retsinformation-eli",
      generatedAt: "placeholder",
      lastSuccessfulRefresh: null,
      lastSuccessfulIncrementalRefresh: null,
      lastSuccessfulFullReconciliation: null,
      feedWatermark: null,
      entries: [rawEntry],
    });
    return parsed.entries[0];
  });

  for (let i = 0; i < validatedEntries.length; i++) {
    if (validatedEntries[i].canonicalEli !== sitemapEntries[i].canonicalEli) {
      throw new RetsinformationBootstrapCheckpointError(
        `validatedEntries[${i}] canonicalEli does not match sitemapEntries[${i}] canonicalEli.`,
      );
    }
  }

  return {
    schemaVersion: 1,
    startedAt: raw.startedAt,
    sitemapEntries,
    nextEntryIndex: raw.nextEntryIndex,
    validatedEntries,
  };
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

  async loadBootstrapCheckpoint(): Promise<RetsinformationBootstrapCheckpoint | null> {
    await this.mutationTail;
    const path = this.checkpointPath();
    if (!await this.adapter.exists(path)) {
      return null;
    }
    const raw = JSON.parse(await this.adapter.read(path)) as unknown;
    return parseStoredBootstrapCheckpoint(raw);
  }

  saveBootstrapCheckpoint(checkpoint: RetsinformationBootstrapCheckpoint): Promise<void> {
    return this.enqueueMutation(async () => {
      parseStoredBootstrapCheckpoint(checkpoint);
      await this.adapter.write(this.checkpointPath(), JSON.stringify(checkpoint));
    });
  }

  clearBootstrapCheckpoint(): Promise<void> {
    return this.enqueueMutation(async () => {
      const path = this.checkpointPath();
      if (await this.adapter.exists(path)) {
        await this.adapter.remove(path);
      }
    });
  }

  private checkpointPath(): string {
    return `${this.baseDir}/${CHECKPOINT_FILENAME}`;
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
