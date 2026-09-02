import type {
  CellarDiscoveredWorkRecord,
  CellarMetadataClient,
  CellarWorkCursor,
  CellarWorkRecord,
} from "./providers/CellarMetadataClient";
import {
  addOrReplaceEntry,
  emptyEuActIndex,
  EU_ACT_INDEX_SCHEMA_VERSION,
  parseStoredEuActIndex,
  serializeEuActIndex,
  validateEuActIndexEntry,
  type EuActIndex,
  type StoredEuActIndex,
} from "./euActIndex";

export interface RawEuActIndexStorage {
  loadRaw(): Promise<unknown>;
  loadCandidateRaw(): Promise<unknown>;
  saveCandidateRaw(raw: StoredEuActIndex): Promise<void>;
  activateRaw(raw: StoredEuActIndex): Promise<void>;
  discardCandidate(): Promise<void>;
}

export interface EuActIndexSyncOptions {
  now?: () => Date;
  pageSize?: number;
  maxPages?: number;
}

export class EuActIndexSyncError extends Error {}

class TraversalIdentityGuard {
  private readonly workByCelex = new Map<string, string>();
  private readonly celexByWork = new Map<string, string>();

  observe(record: CellarDiscoveredWorkRecord): void {
    const knownWork = this.workByCelex.get(record.celex);
    if (knownWork !== undefined && knownWork !== record.workUri) {
      throw new EuActIndexSyncError(
        `CELLAR traversal mapped CELEX "${record.celex}" to Work URI "${record.workUri}" after previously observing Work URI "${knownWork}".`,
      );
    }
    const knownCelex = this.celexByWork.get(record.workUri);
    if (knownCelex !== undefined && knownCelex !== record.celex) {
      throw new EuActIndexSyncError(
        `CELLAR traversal mapped Work URI "${record.workUri}" to CELEX "${record.celex}" after previously observing CELEX "${knownCelex}".`,
      );
    }
    this.workByCelex.set(record.celex, record.workUri);
    this.celexByWork.set(record.workUri, record.celex);
  }
}

function nowIso(options: EuActIndexSyncOptions): string {
  return (options.now ?? (() => new Date()))().toISOString();
}

async function loadLastKnownGood(storage: RawEuActIndexStorage): Promise<EuActIndex | null> {
  const raw = await storage.loadRaw();
  if (raw === null || raw === undefined) return null;
  try {
    return parseStoredEuActIndex(raw);
  } catch {
    return null;
  }
}

async function buildCandidateFromRecords(
  client: CellarMetadataClient,
  options: EuActIndexSyncOptions,
): Promise<EuActIndex> {
  let index = emptyEuActIndex();
  const pageSize = options.pageSize ?? client.pageSize;
  const maxPages = options.maxPages ?? Number.POSITIVE_INFINITY;
  const guard = new TraversalIdentityGuard();
  let cursor: CellarWorkCursor | null = null;
  let previousCursor: CellarWorkCursor | null = null;
  let pages = 0;
  for (;;) {
    const page = await client.fetchTargetWorksPage(cursor, pageSize);
    for (const record of page.records) {
      guard.observe(record);
      const entry = validateEuActIndexEntry(record);
      index = addOrReplaceEntry(index, entry);
    }
    pages++;
    if (page.records.length === 0) break;
    if (!page.nextCursor || (previousCursor && compareCursors(page.nextCursor, previousCursor) <= 0)) {
      throw new EuActIndexSyncError("CELLAR bootstrap returned a missing or regressed continuation cursor.");
    }
    previousCursor = page.nextCursor;
    cursor = page.nextCursor;
    if (pages >= maxPages) throw new EuActIndexSyncError("CELLAR bootstrap reached its page limit before completion.");
  }
  return {
    schemaVersion: EU_ACT_INDEX_SCHEMA_VERSION,
    lastSyncCheckpoint: nowIso(options),
    entries: index.entries,
  };
}

function compareCursors(left: CellarWorkCursor, right: CellarWorkCursor): number {
  if (left.workId < right.workId) return -1;
  if (left.workId > right.workId) return 1;
  if (left.workUri < right.workUri) return -1;
  if (left.workUri > right.workUri) return 1;
  return 0;
}

export async function bootstrapEuActIndex(
  client: CellarMetadataClient,
  storage: RawEuActIndexStorage,
  options: EuActIndexSyncOptions = {},
): Promise<EuActIndex> {
  const candidate = await buildCandidateFromRecords(client, options);
  if (candidate.entries.size === 0) {
    throw new EuActIndexSyncError("CELLAR bootstrap produced an empty EU act index; refusing to activate.");
  }
  await storage.saveCandidateRaw(serializeEuActIndex(candidate, nowIso(options)));
  await storage.activateRaw(serializeEuActIndex(candidate, nowIso(options)));
  await storage.discardCandidate();
  return candidate;
}

export async function reconcileEuActIndex(
  client: CellarMetadataClient,
  storage: RawEuActIndexStorage,
  options: EuActIndexSyncOptions = {},
): Promise<EuActIndex> {
  const current = await loadLastKnownGood(storage);
  if (!current) {
    return bootstrapEuActIndex(client, storage, options);
  }
  let index: EuActIndex = {
    schemaVersion: current.schemaVersion,
    lastSyncCheckpoint: current.lastSyncCheckpoint,
    entries: new Map(current.entries),
  };
  const pageSize = options.pageSize ?? client.pageSize;
  const maxPages = options.maxPages ?? Number.POSITIVE_INFINITY;
  const guard = new TraversalIdentityGuard();
  let cursor: CellarWorkCursor | null = null;
  let previousCursor: CellarWorkCursor | null = null;
  let pages = 0;
  for (;;) {
    const page = await client.fetchTargetWorksPage(cursor, pageSize);
    for (const record of page.records) {
      guard.observe(record);
      const entry = validateEuActIndexEntry(record);
      index = addOrReplaceEntry(index, entry);
    }
    pages++;
    if (page.records.length === 0) break;
    if (!page.nextCursor || (previousCursor && compareCursors(page.nextCursor, previousCursor) <= 0)) {
      throw new EuActIndexSyncError("CELLAR reconciliation returned a missing or regressed continuation cursor.");
    }
    previousCursor = page.nextCursor;
    cursor = page.nextCursor;
    if (pages >= maxPages) throw new EuActIndexSyncError("CELLAR reconciliation reached its page limit before completion.");
  }
  const candidate: EuActIndex = {
    schemaVersion: EU_ACT_INDEX_SCHEMA_VERSION,
    lastSyncCheckpoint: nowIso(options),
    entries: index.entries,
  };
  if (candidate.entries.size === 0) {
    throw new EuActIndexSyncError("CELLAR reconciliation produced an empty EU act index; keeping last-known-good.");
  }
  await storage.saveCandidateRaw(serializeEuActIndex(candidate, nowIso(options)));
  await storage.activateRaw(serializeEuActIndex(candidate, nowIso(options)));
  await storage.discardCandidate();
  return candidate;
}

export async function revalidateWork(
  client: CellarMetadataClient,
  storage: RawEuActIndexStorage,
  celex: string,
  options: EuActIndexSyncOptions = {},
): Promise<EuActIndex> {
  const current = await loadLastKnownGood(storage);
  const base: EuActIndex = current ?? emptyEuActIndex();
  const record: CellarWorkRecord | null = await client.fetchWorkRecord(celex);
  if (!record) {
    return base;
  }
  const updated = addOrReplaceEntry(base, validateEuActIndexEntry(record));
  const candidate: EuActIndex = {
    schemaVersion: EU_ACT_INDEX_SCHEMA_VERSION,
    lastSyncCheckpoint: base.lastSyncCheckpoint,
    entries: updated.entries,
  };
  await storage.saveCandidateRaw(serializeEuActIndex(candidate, nowIso(options)));
  await storage.activateRaw(serializeEuActIndex(candidate, nowIso(options)));
  await storage.discardCandidate();
  return candidate;
}

export function isIndexFresh(index: EuActIndex | null, freshnessMs: number, now: Date = new Date()): boolean {
  if (!index || index.lastSyncCheckpoint === null) return false;
  const ms = Date.parse(index.lastSyncCheckpoint);
  if (!Number.isFinite(ms)) return false;
  return now.getTime() - ms <= freshnessMs;
}
