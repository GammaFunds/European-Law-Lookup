import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  type RetsinformationIndex,
} from "../src/law/providers/RetsinformationDiscoveryIndex";
import {
  type RetsinformationDiscoveryIndexMetadata,
  RetsinformationDiscoveryIndexStorage,
  type RetsinformationIndexTextAdapter,
  type RetsinformationBootstrapCheckpoint,
} from "../src/law/providers/RetsinformationDiscoveryIndexStorage";
import type { RetsinformationSitemapEntry } from "../src/law/providers/RetsinformationSitemap";

const sitemapEntryA: RetsinformationSitemapEntry = {
  canonicalEli: "/eli/lta/2014/433",
  sitemapLastModified: "2024-05-01T00:00:00Z",
};

const sitemapEntryB: RetsinformationSitemapEntry = {
  canonicalEli: "/eli/lov/2015/9",
  sitemapLastModified: null,
};

const indexEntryA = {
  canonicalEli: "/eli/lta/2014/433",
  popularTitle: "Test law",
  documentTitle: "Test law title",
  documentType: "LOV",
  pubMedia: "lta",
  year: "2014",
  number: "433",
  status: "in force",
  startDate: "2014-01-01",
  endDate: null,
  changeDate: "2024-05-01",
  accessionNumber: "A-433",
  ministry: "Test ministry",
  announcedIn: "2014/433",
  sourceUpdateTimestamp: "2024-05-02T03:04:05Z",
  sitemapLastModified: "2024-05-03T03:04:05Z",
} as const;

const indexEntryB = {
  canonicalEli: "/eli/lov/2015/9",
  popularTitle: "Second law",
  documentTitle: "Second law title",
  documentType: "LOV",
  pubMedia: "lov",
  year: "2015",
  number: "9",
  status: "in force",
  startDate: "2015-01-01",
  endDate: null,
  changeDate: null,
  accessionNumber: null,
  ministry: null,
  announcedIn: null,
  sourceUpdateTimestamp: "2024-06-02T03:04:05Z",
  sitemapLastModified: null,
} as const;

function makeCheckpoint(
  overrides: Partial<RetsinformationBootstrapCheckpoint> = {},
): RetsinformationBootstrapCheckpoint {
  return {
    schemaVersion: 1,
    startedAt: "2024-05-10T00:00:00Z",
    sitemapEntries: [sitemapEntryA],
    nextEntryIndex: 1,
    validatedEntries: [indexEntryA],
    ...overrides,
  };
}

class MemoryAdapter implements RetsinformationIndexTextAdapter {
  readonly files = new Map<string, string>();
  readonly writes: string[] = [];
  blockFirstWrite: Promise<void> | null = null;
  releaseFirstWrite: (() => void) | null = null;
  failNextWrite: Error | null = null;

  async exists(path: string): Promise<boolean> {
    return this.files.has(path);
  }

  async read(path: string): Promise<string> {
    const value = this.files.get(path);
    if (value === undefined) throw new Error(`missing file: ${path}`);
    return value;
  }

  async write(path: string, data: string): Promise<void> {
    this.writes.push(path);
    if (this.failNextWrite) {
      const failure = this.failNextWrite;
      this.failNextWrite = null;
      throw failure;
    }
    if (this.blockFirstWrite) await this.blockFirstWrite;
    this.files.set(path, data);
  }

  async remove(path: string): Promise<void> {
    this.files.delete(path);
  }

  blockNextWrite(): void {
    this.blockFirstWrite = new Promise<void>((resolve) => {
      this.releaseFirstWrite = resolve;
    });
  }

  releaseWrite(): void {
    this.releaseFirstWrite?.();
    this.releaseFirstWrite = null;
    this.blockFirstWrite = null;
  }
}

class MemoryMetadata {
  value: RetsinformationDiscoveryIndexMetadata = {
    activeSlot: null,
    candidateSlot: null,
  };

  read(): RetsinformationDiscoveryIndexMetadata {
    return { ...this.value };
  }

  async save(value: RetsinformationDiscoveryIndexMetadata): Promise<void> {
    this.value = { ...value };
  }
}

function makeStorage(adapter = new MemoryAdapter(), metadata = new MemoryMetadata()) {
  return {
    adapter,
    metadata,
    storage: new RetsinformationDiscoveryIndexStorage("data", adapter, metadata),
  };
}

function cloneIndex(): RetsinformationIndex {
  return {
    schemaVersion: 1,
    source: "retsinformation-eli",
    generatedAt: "2024-05-04T03:04:05Z",
    lastSuccessfulRefresh: "2024-05-04T03:05:05Z",
    lastSuccessfulIncrementalRefresh: "2024-05-04T03:06:05Z",
    lastSuccessfulFullReconciliation: "2024-05-04T03:07:05Z",
    feedWatermark: "urn:atom:433",
    entries: [{ ...indexEntryA }],
  };
}

test("A. ABSENT STATE: fresh storage loadBootstrapCheckpoint returns null", async () => {
  const { storage } = makeStorage();
  assert.equal(await storage.loadBootstrapCheckpoint(), null);
});

test("B. ROUND TRIP: save then load equals intended checkpoint", async () => {
  const { storage } = makeStorage();
  const checkpoint = makeCheckpoint();
  await storage.saveBootstrapCheckpoint(checkpoint);
  assert.deepEqual(await storage.loadBootstrapCheckpoint(), checkpoint);
});

test("B. ROUND TRIP: dedicated path is data/dk-discovery-bootstrap.json", async () => {
  const adapter = new MemoryAdapter();
  const { storage } = makeStorage(adapter);
  await storage.saveBootstrapCheckpoint(makeCheckpoint());
  assert.ok(adapter.files.has("data/dk-discovery-bootstrap.json"));
  assert.equal(adapter.writes.filter((p) => p === "data/dk-discovery-bootstrap.json").length, 1);
});

test("B. ROUND TRIP: null sitemapLastModified entries round-trip correctly", async () => {
  const { storage } = makeStorage();
  const checkpoint = makeCheckpoint({
    sitemapEntries: [sitemapEntryB],
    validatedEntries: [indexEntryB],
  });
  await storage.saveBootstrapCheckpoint(checkpoint);
  assert.deepEqual(await storage.loadBootstrapCheckpoint(), checkpoint);
});

test("C. ISOLATION: checkpoint save does not alter activeSlot", async () => {
  const { storage, metadata } = makeStorage();
  metadata.value = { activeSlot: "a", candidateSlot: null };
  await storage.saveBootstrapCheckpoint(makeCheckpoint());
  assert.deepEqual(metadata.value.activeSlot, "a");
});

test("C. ISOLATION: checkpoint save does not alter candidateSlot", async () => {
  const { storage, metadata } = makeStorage();
  metadata.value = { activeSlot: null, candidateSlot: "b" };
  await storage.saveBootstrapCheckpoint(makeCheckpoint());
  assert.deepEqual(metadata.value.candidateSlot, "b");
});

test("C. ISOLATION: checkpoint save does not write active/candidate index files", async () => {
  const adapter = new MemoryAdapter();
  const { storage } = makeStorage(adapter);
  await storage.saveBootstrapCheckpoint(makeCheckpoint());
  const writtenPaths = new Set(adapter.writes);
  assert.ok(!writtenPaths.has("data/retsinformation-index-a.json"));
  assert.ok(!writtenPaths.has("data/retsinformation-index-b.json"));
});

test("C. ISOLATION: checkpoint load does not alter A/B state", async () => {
  const { storage, metadata } = makeStorage();
  await storage.saveBootstrapCheckpoint(makeCheckpoint());
  await storage.loadBootstrapCheckpoint();
  assert.deepEqual(metadata.value, { activeSlot: null, candidateSlot: null });
});

test("D. STRICT SCHEMA: reject schemaVersion != 1", async () => {
  const { adapter, storage } = makeStorage();
  adapter.files.set(
    "data/dk-discovery-bootstrap.json",
    JSON.stringify(makeCheckpoint({ schemaVersion: 2 as 1 })),
  );
  await assert.rejects(storage.loadBootstrapCheckpoint());
});

test("D. STRICT SCHEMA: reject missing field", async () => {
  const { adapter, storage } = makeStorage();
  const checkpoint = makeCheckpoint();
  delete (checkpoint as unknown as Record<string, unknown>).startedAt;
  adapter.files.set("data/dk-discovery-bootstrap.json", JSON.stringify(checkpoint));
  await assert.rejects(storage.loadBootstrapCheckpoint());
});

test("D. STRICT SCHEMA: reject unknown extra field", async () => {
  const { adapter, storage } = makeStorage();
  adapter.files.set(
    "data/dk-discovery-bootstrap.json",
    JSON.stringify({ ...makeCheckpoint(), extraField: "unexpected" }),
  );
  await assert.rejects(storage.loadBootstrapCheckpoint());
});

test("D. STRICT SCHEMA: reject non-object root", async () => {
  const { adapter, storage } = makeStorage();
  adapter.files.set("data/dk-discovery-bootstrap.json", JSON.stringify("not-object"));
  await assert.rejects(storage.loadBootstrapCheckpoint());
});

test("D. STRICT SCHEMA: reject malformed JSON", async () => {
  const { adapter, storage } = makeStorage();
  adapter.files.set("data/dk-discovery-bootstrap.json", "{not valid json");
  await assert.rejects(storage.loadBootstrapCheckpoint());
});

test("D. STRICT SCHEMA: reject array root", async () => {
  const { adapter, storage } = makeStorage();
  adapter.files.set("data/dk-discovery-bootstrap.json", JSON.stringify([]));
  await assert.rejects(storage.loadBootstrapCheckpoint());
});

test("E. STARTED-AT TYPE: reject non-string startedAt", async () => {
  const { adapter, storage } = makeStorage();
  adapter.files.set(
    "data/dk-discovery-bootstrap.json",
    JSON.stringify(makeCheckpoint({ startedAt: 12345 as unknown as string })),
  );
  await assert.rejects(storage.loadBootstrapCheckpoint());
});

test("F. SITEMAP ENTRIES: reject non-array sitemapEntries", async () => {
  const { adapter, storage } = makeStorage();
  adapter.files.set(
    "data/dk-discovery-bootstrap.json",
    JSON.stringify(makeCheckpoint({ sitemapEntries: "not-array" as unknown as [] })),
  );
  await assert.rejects(storage.loadBootstrapCheckpoint());
});

test("F. SITEMAP ENTRIES: reject malformed entry shape", async () => {
  const { adapter, storage } = makeStorage();
  adapter.files.set(
    "data/dk-discovery-bootstrap.json",
    JSON.stringify(makeCheckpoint({ sitemapEntries: [{ canonicalEli: "/eli/lta/2014/433" }] as unknown as [] })),
  );
  await assert.rejects(storage.loadBootstrapCheckpoint());
});

test("F. SITEMAP ENTRIES: reject non-canonical canonicalEli in sitemap entry", async () => {
  const { adapter, storage } = makeStorage();
  adapter.files.set(
    "data/dk-discovery-bootstrap.json",
    JSON.stringify(makeCheckpoint({
      sitemapEntries: [{ canonicalEli: "/eli/lta/2014/433/", sitemapLastModified: null }],
    })),
  );
  await assert.rejects(storage.loadBootstrapCheckpoint());
});

test("F. SITEMAP ENTRIES: reject wrong lastmod type in sitemap entry", async () => {
  const { adapter, storage } = makeStorage();
  adapter.files.set(
    "data/dk-discovery-bootstrap.json",
    JSON.stringify(makeCheckpoint({
      sitemapEntries: [{ canonicalEli: "/eli/lta/2014/433", sitemapLastModified: 123 as unknown as string | null }],
    })),
  );
  await assert.rejects(storage.loadBootstrapCheckpoint());
});

test("F. SITEMAP ENTRIES: reject duplicate canonicalEli in sitemap entries", async () => {
  const { adapter, storage } = makeStorage();
  adapter.files.set(
    "data/dk-discovery-bootstrap.json",
    JSON.stringify(makeCheckpoint({
      sitemapEntries: [sitemapEntryA, sitemapEntryA],
    })),
  );
  await assert.rejects(storage.loadBootstrapCheckpoint());
});

test("G. NEXT INDEX BOUNDS: reject negative nextEntryIndex", async () => {
  const { adapter, storage } = makeStorage();
  adapter.files.set(
    "data/dk-discovery-bootstrap.json",
    JSON.stringify(makeCheckpoint({ nextEntryIndex: -1 })),
  );
  await assert.rejects(storage.loadBootstrapCheckpoint());
});

test("G. NEXT INDEX BOUNDS: reject fractional nextEntryIndex", async () => {
  const { adapter, storage } = makeStorage();
  adapter.files.set(
    "data/dk-discovery-bootstrap.json",
    JSON.stringify(makeCheckpoint({ nextEntryIndex: 1.5 })),
  );
  await assert.rejects(storage.loadBootstrapCheckpoint());
});

test("G. NEXT INDEX BOUNDS: reject non-number nextEntryIndex", async () => {
  const { adapter, storage } = makeStorage();
  adapter.files.set(
    "data/dk-discovery-bootstrap.json",
    JSON.stringify(makeCheckpoint({ nextEntryIndex: "not-a-number" as unknown as number })),
  );
  await assert.rejects(storage.loadBootstrapCheckpoint());
});

test("G. NEXT INDEX BOUNDS: reject nextEntryIndex > sitemapEntries.length", async () => {
  const { adapter, storage } = makeStorage();
  adapter.files.set(
    "data/dk-discovery-bootstrap.json",
    JSON.stringify(makeCheckpoint({ nextEntryIndex: 2, sitemapEntries: [sitemapEntryA] })),
  );
  await assert.rejects(storage.loadBootstrapCheckpoint());
});

test("H. VALIDATED ENTRY STRICTNESS: reject malformed validated RetsinformationIndexEntry", async () => {
  const { adapter, storage } = makeStorage();
  adapter.files.set(
    "data/dk-discovery-bootstrap.json",
    JSON.stringify(makeCheckpoint({
      validatedEntries: [{ canonicalEli: "/eli/lta/2014/433" }] as unknown as [],
    })),
  );
  await assert.rejects(storage.loadBootstrapCheckpoint());
});

test("H. VALIDATED ENTRY STRICTNESS: reject validated entry with non-canonical ELI", async () => {
  const { adapter, storage } = makeStorage();
  adapter.files.set(
    "data/dk-discovery-bootstrap.json",
    JSON.stringify(makeCheckpoint({
      validatedEntries: [{ ...indexEntryA, canonicalEli: "/eli/lta/2014/433/" }],
    })),
  );
  await assert.rejects(storage.loadBootstrapCheckpoint());
});

test("H. VALIDATED ENTRY STRICTNESS: reject validated entry with mismatched identity fields", async () => {
  const { adapter, storage } = makeStorage();
  adapter.files.set(
    "data/dk-discovery-bootstrap.json",
    JSON.stringify(makeCheckpoint({
      validatedEntries: [{ ...indexEntryA, pubMedia: "wrong" }],
    })),
  );
  await assert.rejects(storage.loadBootstrapCheckpoint());
});

test("I. PROCESSED PREFIX: reject validatedEntries.length != nextEntryIndex", async () => {
  const { adapter, storage } = makeStorage();
  adapter.files.set(
    "data/dk-discovery-bootstrap.json",
    JSON.stringify(makeCheckpoint({
      sitemapEntries: [sitemapEntryA, sitemapEntryB],
      nextEntryIndex: 1,
      validatedEntries: [indexEntryA, indexEntryB],
    })),
  );
  await assert.rejects(storage.loadBootstrapCheckpoint());
});

test("I. PROCESSED PREFIX: reject validatedEntries.length < nextEntryIndex", async () => {
  const { adapter, storage } = makeStorage();
  adapter.files.set(
    "data/dk-discovery-bootstrap.json",
    JSON.stringify(makeCheckpoint({
      sitemapEntries: [sitemapEntryA, sitemapEntryB],
      nextEntryIndex: 2,
      validatedEntries: [indexEntryA],
    })),
  );
  await assert.rejects(storage.loadBootstrapCheckpoint());
});

test("I. PROCESSED PREFIX: reject validated identity from a future/unprocessed sitemap entry", async () => {
  const { adapter, storage } = makeStorage();
  adapter.files.set(
    "data/dk-discovery-bootstrap.json",
    JSON.stringify(makeCheckpoint({
      sitemapEntries: [sitemapEntryA, sitemapEntryB],
      nextEntryIndex: 1,
      validatedEntries: [indexEntryB],
    })),
  );
  await assert.rejects(storage.loadBootstrapCheckpoint());
});

test("I. PROCESSED PREFIX: reject reordered validated identities", async () => {
  const { adapter, storage } = makeStorage();
  adapter.files.set(
    "data/dk-discovery-bootstrap.json",
    JSON.stringify(makeCheckpoint({
      sitemapEntries: [sitemapEntryA, sitemapEntryB],
      nextEntryIndex: 2,
      validatedEntries: [indexEntryB, indexEntryA],
    })),
  );
  await assert.rejects(storage.loadBootstrapCheckpoint());
});

test("I. PROCESSED PREFIX: reject validated identity not present in sitemapEntries", async () => {
  const { adapter, storage } = makeStorage();
  adapter.files.set(
    "data/dk-discovery-bootstrap.json",
    JSON.stringify(makeCheckpoint({
      sitemapEntries: [sitemapEntryA],
      nextEntryIndex: 1,
      validatedEntries: [indexEntryB],
    })),
  );
  await assert.rejects(storage.loadBootstrapCheckpoint());
});

test("J. FAILED WRITE: saveBootstrapCheckpoint rejects on adapter write failure", async () => {
  const adapter = new MemoryAdapter();
  const { storage } = makeStorage(adapter);
  adapter.failNextWrite = new Error("controlled checkpoint write failure");
  await assert.rejects(
    storage.saveBootstrapCheckpoint(makeCheckpoint()),
    /controlled checkpoint write failure/,
  );
});

test("J. FAILED WRITE: previous checkpoint remains after failed write", async () => {
  const adapter = new MemoryAdapter();
  const { storage } = makeStorage(adapter);
  await storage.saveBootstrapCheckpoint(makeCheckpoint());
  adapter.failNextWrite = new Error("controlled checkpoint write failure");
  await assert.rejects(storage.saveBootstrapCheckpoint(makeCheckpoint()));
  assert.deepEqual(await storage.loadBootstrapCheckpoint(), makeCheckpoint());
});

test("K. CLEAR: clearBootstrapCheckpoint makes load return null", async () => {
  const { storage } = makeStorage();
  await storage.saveBootstrapCheckpoint(makeCheckpoint());
  await storage.clearBootstrapCheckpoint();
  assert.equal(await storage.loadBootstrapCheckpoint(), null);
});

test("K. CLEAR: clear does not affect active slot", async () => {
  const adapter = new MemoryAdapter();
  const { storage, metadata } = makeStorage(adapter);
  metadata.value = { activeSlot: "a", candidateSlot: null };
  adapter.files.set("data/retsinformation-index-a.json", JSON.stringify(cloneIndex()));
  await storage.saveBootstrapCheckpoint(makeCheckpoint());
  await storage.clearBootstrapCheckpoint();
  assert.equal(metadata.value.activeSlot, "a");
});

test("K. CLEAR: clear does not affect candidate slot", async () => {
  const adapter = new MemoryAdapter();
  const { storage, metadata } = makeStorage(adapter);
  metadata.value = { activeSlot: null, candidateSlot: "b" };
  adapter.files.set("data/retsinformation-index-b.json", JSON.stringify(cloneIndex()));
  await storage.saveBootstrapCheckpoint(makeCheckpoint());
  await storage.clearBootstrapCheckpoint();
  assert.equal(metadata.value.candidateSlot, "b");
});

test("K. CLEAR: clear is idempotent on absent checkpoint", async () => {
  const { storage } = makeStorage();
  await storage.clearBootstrapCheckpoint();
  await storage.clearBootstrapCheckpoint();
  assert.equal(await storage.loadBootstrapCheckpoint(), null);
});

test("L. SERIALIZATION: overlapping checkpoint saves execute in call order", async () => {
  const adapter = new MemoryAdapter();
  const { storage } = makeStorage(adapter);
  adapter.blockNextWrite();
  const first = storage.saveBootstrapCheckpoint(makeCheckpoint());
  const secondCheckpoint = makeCheckpoint({ startedAt: "2024-06-01T00:00:00Z" });
  const second = storage.saveBootstrapCheckpoint(secondCheckpoint);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(adapter.writes.length, 1);
  adapter.releaseWrite();
  await Promise.all([first, second]);
  assert.deepEqual(await storage.loadBootstrapCheckpoint(), secondCheckpoint);
  assert.equal(adapter.writes.length, 2);
});

test("L. SERIALIZATION: load waits for pending mutation", async () => {
  const adapter = new MemoryAdapter();
  const { storage } = makeStorage(adapter);
  adapter.blockNextWrite();
  const save = storage.saveBootstrapCheckpoint(makeCheckpoint());
  await new Promise((resolve) => setImmediate(resolve));

  let loadSettled = false;
  const load = storage.loadBootstrapCheckpoint().then(() => {
    loadSettled = true;
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(loadSettled, false);

  adapter.releaseWrite();
  await save;
  await load;
  assert.deepEqual(await storage.loadBootstrapCheckpoint(), makeCheckpoint());
});

test("L. SERIALIZATION: rejected mutation does not poison mutation tail", async () => {
  const adapter = new MemoryAdapter();
  const { storage } = makeStorage(adapter);
  adapter.failNextWrite = new Error("controlled failure");
  await assert.rejects(storage.saveBootstrapCheckpoint(makeCheckpoint()), /controlled failure/);

  const replacement = makeCheckpoint({ startedAt: "2024-07-01T00:00:00Z" });
  await storage.saveBootstrapCheckpoint(replacement);
  assert.deepEqual(await storage.loadBootstrapCheckpoint(), replacement);
});

test("L. SERIALIZATION: checkpoint operations participate in same queue as A/B mutations", async () => {
  const adapter = new MemoryAdapter();
  const { storage } = makeStorage(adapter);
  adapter.blockNextWrite();
  const checkpointSave = storage.saveBootstrapCheckpoint(makeCheckpoint());
  const indexSave = storage.saveCandidate(cloneIndex());
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(adapter.writes.length, 1);
  adapter.releaseWrite();
  await Promise.all([checkpointSave, indexSave]);
  assert.deepEqual(await storage.loadBootstrapCheckpoint(), makeCheckpoint());
  assert.deepEqual(await storage.loadCandidate(), cloneIndex());
});

test("ACCEPT: accept checkpoint with nextEntryIndex 0 and empty arrays", async () => {
  const { storage } = makeStorage();
  const checkpoint: RetsinformationBootstrapCheckpoint = {
    schemaVersion: 1,
    startedAt: "2024-05-10T00:00:00Z",
    sitemapEntries: [],
    nextEntryIndex: 0,
    validatedEntries: [],
  };
  await storage.saveBootstrapCheckpoint(checkpoint);
  assert.deepEqual(await storage.loadBootstrapCheckpoint(), checkpoint);
});

test("ACCEPT: accept checkpoint with multiple entries and matching prefix", async () => {
  const { storage } = makeStorage();
  const checkpoint = makeCheckpoint({
    sitemapEntries: [sitemapEntryA, sitemapEntryB],
    nextEntryIndex: 2,
    validatedEntries: [indexEntryA, indexEntryB],
  });
  await storage.saveBootstrapCheckpoint(checkpoint);
  assert.deepEqual(await storage.loadBootstrapCheckpoint(), checkpoint);
});
