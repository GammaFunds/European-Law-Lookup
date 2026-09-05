import {
  parseStoredEuActIndex,
  type EuActIndex,
  type EuActIndexEntry,
  type StoredEuActIndex,
} from "./euActIndex";
import type { RawEuActIndexStorage } from "./euActIndexSync";

export type EuActIndexSlot = "a" | "b";

export interface EuActIndexStoreMetadata {
  activeSlot: EuActIndexSlot | null;
  candidateSlot: EuActIndexSlot | null;
}

export interface EuActIndexTextAdapter {
  exists(path: string): Promise<boolean>;
  read(path: string): Promise<string>;
  write(path: string, data: string): Promise<void>;
  remove(path: string): Promise<void>;
}

export interface EuActIndexMetadataPersistence {
  read(): EuActIndexStoreMetadata;
  save(metadata: EuActIndexStoreMetadata): Promise<void>;
  saveMigration(metadata: EuActIndexStoreMetadata): Promise<void>;
}

const EMPTY_METADATA: EuActIndexStoreMetadata = {
  activeSlot: null,
  candidateSlot: null,
};

function isSlot(value: unknown): value is EuActIndexSlot {
  return value === "a" || value === "b";
}

export function normalizeEuActIndexStoreMetadata(raw: unknown): EuActIndexStoreMetadata {
  if (typeof raw !== "object" || raw === null) return { ...EMPTY_METADATA };
  const candidate = raw as Record<string, unknown>;
  const activeSlot = isSlot(candidate.activeSlot) ? candidate.activeSlot : null;
  const rawCandidate = isSlot(candidate.candidateSlot) ? candidate.candidateSlot : null;
  return {
    activeSlot,
    candidateSlot: rawCandidate === activeSlot ? null : rawCandidate,
  };
}

function sameStringRecord(left: Record<string, string>, right: Record<string, string>): boolean {
  const leftKeys = Object.keys(left).sort();
  const rightKeys = Object.keys(right).sort();
  if (leftKeys.length !== rightKeys.length) return false;
  return leftKeys.every((key, index) => key === rightKeys[index] && left[key] === right[key]);
}

function sameEntry(left: EuActIndexEntry, right: EuActIndexEntry): boolean {
  return left.celex === right.celex
    && left.documentType === right.documentType
    && left.year === right.year
    && left.number === right.number
    && sameStringRecord(left.titlesByLanguage, right.titlesByLanguage)
    && left.availableLanguages.length === right.availableLanguages.length
    && left.availableLanguages.every((language, index) => language === right.availableLanguages[index]);
}

function sameIndex(left: EuActIndex, right: EuActIndex): boolean {
  if (left.schemaVersion !== right.schemaVersion
      || left.lastSyncCheckpoint !== right.lastSyncCheckpoint
      || left.entries.size !== right.entries.size) {
    return false;
  }
  for (const [celex, leftEntry] of left.entries) {
    const rightEntry = right.entries.get(celex);
    if (!rightEntry || !sameEntry(leftEntry, rightEntry)) return false;
  }
  return true;
}

export class EuActIndexFileStorage implements RawEuActIndexStorage {
  private mutationTail: Promise<void> = Promise.resolve();

  constructor(
    private readonly baseDir: string,
    private readonly adapter: EuActIndexTextAdapter,
    private readonly metadata: EuActIndexMetadataPersistence,
  ) {}

  async loadRaw(): Promise<unknown> {
    await this.mutationTail;
    const slot = this.metadata.read().activeSlot;
    return slot ? this.readValidatedRaw(slot) : null;
  }

  async loadCandidateRaw(): Promise<unknown> {
    await this.mutationTail;
    const slot = this.metadata.read().candidateSlot;
    return slot ? this.readValidatedRaw(slot) : null;
  }

  saveCandidateRaw(raw: StoredEuActIndex): Promise<void> {
    return this.enqueueMutation(async () => {
      const intended = parseStoredEuActIndex(raw);
      const current = this.metadata.read();
      const slot: EuActIndexSlot = current.activeSlot === "a" ? "b" : "a";
      const path = this.pathForSlot(slot);
      await this.adapter.write(path, JSON.stringify(raw));
      const readBack = await this.readValidatedRaw(slot);
      if (!readBack || !sameIndex(intended, parseStoredEuActIndex(readBack))) {
        throw new Error("EU act index candidate read-back validation failed.");
      }
      await this.metadata.save({
        activeSlot: current.activeSlot,
        candidateSlot: slot,
      });
    });
  }

  activateRaw(raw: StoredEuActIndex): Promise<void> {
    return this.enqueueMutation(async () => {
      const current = this.metadata.read();
      if (!current.candidateSlot) {
        throw new Error("EU act index activation requires a validated candidate slot.");
      }
      const candidateRaw = await this.readValidatedRaw(current.candidateSlot);
      if (!candidateRaw || !sameIndex(parseStoredEuActIndex(raw), parseStoredEuActIndex(candidateRaw))) {
        throw new Error("EU act index activation candidate does not match the intended index.");
      }
      await this.metadata.save({
        activeSlot: current.candidateSlot,
        candidateSlot: null,
      });
    });
  }

  discardCandidate(): Promise<void> {
    return this.enqueueMutation(async () => {
      const current = this.metadata.read();
      const candidateSlot = current.candidateSlot;
      if (!candidateSlot) return;
      await this.metadata.save({ activeSlot: current.activeSlot, candidateSlot: null });
      if (candidateSlot === current.activeSlot) return;
      const path = this.pathForSlot(candidateSlot);
      if (await this.adapter.exists(path)) await this.adapter.remove(path);
    });
  }

  migrateLegacy(raw: StoredEuActIndex): Promise<EuActIndex> {
    return this.enqueueMutation(async () => {
      const intended = parseStoredEuActIndex(raw);
      const current = this.metadata.read();
      const slot: EuActIndexSlot = current.activeSlot === "a" ? "b" : "a";
      const path = this.pathForSlot(slot);
      await this.adapter.write(path, JSON.stringify(raw));
      const readBack = await this.readValidatedRaw(slot);
      if (!readBack || !sameIndex(intended, parseStoredEuActIndex(readBack))) {
        throw new Error("Legacy EU act index migration read-back validation failed.");
      }
      await this.metadata.saveMigration({ activeSlot: slot, candidateSlot: null });
      return parseStoredEuActIndex(readBack);
    });
  }

  private enqueueMutation<T>(operation: () => Promise<T>): Promise<T> {
    const run = this.mutationTail.then(operation);
    this.mutationTail = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  private pathForSlot(slot: EuActIndexSlot): string {
    return `${this.baseDir}/eu-act-index-${slot}.json`;
  }

  private async readValidatedRaw(slot: EuActIndexSlot): Promise<StoredEuActIndex | null> {
    const path = this.pathForSlot(slot);
    if (!await this.adapter.exists(path)) return null;
    const raw = JSON.parse(await this.adapter.read(path)) as unknown;
    parseStoredEuActIndex(raw);
    return raw as StoredEuActIndex;
  }
}
