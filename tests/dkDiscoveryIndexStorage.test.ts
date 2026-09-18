import assert from "node:assert/strict";
import { test } from "node:test";
import {
  parseStoredRetsinformationIndex,
  type RetsinformationIndex,
} from "../src/law/providers/RetsinformationDiscoveryIndex";
import {
  type RetsinformationDiscoveryIndexMetadata,
  RetsinformationDiscoveryIndexStorage,
  type RetsinformationIndexTextAdapter,
} from "../src/law/providers/RetsinformationDiscoveryIndexStorage";

const entry = {
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

const index: RetsinformationIndex = {
  schemaVersion: 1,
  source: "retsinformation-eli",
  generatedAt: "2024-05-04T03:04:05Z",
  lastSuccessfulRefresh: "2024-05-04T03:05:05Z",
  lastSuccessfulIncrementalRefresh: "2024-05-04T03:06:05Z",
  lastSuccessfulFullReconciliation: "2024-05-04T03:07:05Z",
  feedWatermark: "urn:atom:433",
  entries: [entry],
};

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
  return structuredClone(index);
}

test("initial loadActive returns null when no active slot exists", async () => {
  const { storage } = makeStorage();
  assert.equal(await storage.loadActive(), null);
});

test("saveCandidate isolates the candidate from active state", async () => {
  const { storage } = makeStorage();
  await storage.saveCandidate(index);
  assert.equal(await storage.loadActive(), null);
  assert.deepEqual(await storage.loadCandidate(), index);
});

test("activation promotes only a semantically equal existing candidate", async () => {
  const { storage } = makeStorage();
  await storage.saveCandidate(index);
  await storage.activateCandidate(cloneIndex());
  assert.deepEqual(await storage.loadActive(), index);
  assert.equal(await storage.loadCandidate(), null);
});

test("activation rejects changes to any index metadata or entry field", async () => {
  const metadataFields: Array<keyof RetsinformationIndex> = [
    "schemaVersion",
    "source",
    "generatedAt",
    "lastSuccessfulRefresh",
    "lastSuccessfulIncrementalRefresh",
    "lastSuccessfulFullReconciliation",
    "feedWatermark",
  ];
  for (const field of metadataFields) {
    const { storage } = makeStorage();
    await storage.saveCandidate(index);
    const mismatched = cloneIndex();
    const mutable = mismatched as unknown as Record<string, unknown>;
    mutable[field] = field === "schemaVersion" ? 2 : field === "source" ? "wrong" : "changed";
    await assert.rejects(storage.activateCandidate(mismatched));
    assert.equal(await storage.loadActive(), null);
  }

  const fields = Object.keys(entry) as Array<keyof typeof entry>;
  for (const field of fields) {
    const { storage } = makeStorage();
    await storage.saveCandidate(index);
    const mismatched = cloneIndex();
    const changed = field === "endDate" ? "changed" : `${String(entry[field])}-changed`;
    mismatched.entries[0] = { ...mismatched.entries[0], [field]: changed };
    await assert.rejects(storage.activateCandidate(mismatched));
    assert.equal(await storage.loadActive(), null);
  }
});

test("persisted candidate read-back must be valid and semantically equal", async () => {
  const adapter = new MemoryAdapter();
  const { storage } = makeStorage(adapter);
  const originalWrite = adapter.write.bind(adapter);
  adapter.write = async (path, data) => {
    await originalWrite(path, JSON.stringify({ ...JSON.parse(data), source: "wrong" }));
  };
  await assert.rejects(storage.saveCandidate(index));
  assert.equal(await storage.loadActive(), null);
  assert.equal(await storage.loadCandidate(), null);
});

test("parser enforces the exact schema, types, identity cross-checks, and duplicate rejection", () => {
  assert.deepEqual(parseStoredRetsinformationIndex(index), index);
  for (const raw of [
    { ...index, schemaVersion: 2 },
    { ...index, schemaVersion: undefined },
    { ...index, source: "other" },
    { ...index, entries: {} },
    { ...index, generatedAt: null },
    { ...index, entries: [{ ...entry, canonicalEli: "/eli/lta/2014/433/" }] },
    { ...index, entries: [{ ...entry, pubMedia: "lbk" }] },
    { ...index, entries: [{ ...entry }, { ...entry }] },
  ]) {
    assert.throws(() => parseStoredRetsinformationIndex(raw));
  }
});

test("parser round-trips every accepted nullable and non-nullable entry field", () => {
  const allNullable: RetsinformationIndex = {
    ...cloneIndex(),
    lastSuccessfulRefresh: null,
    lastSuccessfulIncrementalRefresh: null,
    lastSuccessfulFullReconciliation: null,
    feedWatermark: null,
    entries: [{
      ...entry,
      popularTitle: null,
      status: null,
      startDate: null,
      endDate: null,
      changeDate: null,
      accessionNumber: null,
      ministry: null,
      announcedIn: null,
      sourceUpdateTimestamp: null,
      sitemapLastModified: null,
    }],
  };
  assert.deepEqual(parseStoredRetsinformationIndex(allNullable), allNullable);
});

test("semantic equality is deterministic by canonicalEli rather than persisted array position", async () => {
  const second = { ...entry, canonicalEli: "/eli/lov/2015/9", pubMedia: "lov", year: "2015", number: "9" };
  const candidate = { ...cloneIndex(), entries: [entry, second] };
  const { storage } = makeStorage();
  await storage.saveCandidate(candidate);
  await storage.activateCandidate({ ...candidate, entries: [second, entry] });
  assert.deepEqual((await storage.loadActive())?.entries, [entry, second]);
});

test("discardCandidate clears candidate state without changing active state", async () => {
  const { storage } = makeStorage();
  await storage.saveCandidate(index);
  await storage.discardCandidate();
  assert.equal(await storage.loadActive(), null);
  assert.equal(await storage.loadCandidate(), null);
});

test("malformed or incompatible referenced slots fail closed and remain distinct from missing state", async () => {
  const { adapter, metadata, storage } = makeStorage();
  assert.equal(await storage.loadActive(), null);
  metadata.value = { activeSlot: "a", candidateSlot: null };
  adapter.files.set("data/retsinformation-index-a.json", "not-json");
  await assert.rejects(storage.loadActive());
  metadata.value = { activeSlot: null, candidateSlot: "b" };
  adapter.files.set("data/retsinformation-index-b.json", JSON.stringify({ ...index, schemaVersion: 2 }));
  await assert.rejects(storage.loadCandidate());
});

test("overlapping mutations execute in order through the mutation tail", async () => {
  const adapter = new MemoryAdapter();
  const { storage } = makeStorage(adapter);
  adapter.blockNextWrite();
  const first = storage.saveCandidate(index);
  const secondIndex = { ...cloneIndex(), generatedAt: "2024-06-04T03:04:05Z" };
  const second = storage.saveCandidate(secondIndex);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(adapter.writes.length, 1);
  adapter.releaseWrite();
  await Promise.all([first, second]);
  assert.deepEqual(await storage.loadCandidate(), secondIndex);
  assert.equal(adapter.writes.length, 2);
});

test("a rejected mutation does not poison the mutation tail", async () => {
  const adapter = new MemoryAdapter();
  const { storage } = makeStorage(adapter);
  adapter.failNextWrite = new Error("controlled write failure");

  await assert.rejects(storage.saveCandidate(index), /controlled write failure/);

  const replacement = { ...cloneIndex(), generatedAt: "2024-07-04T03:04:05Z" };
  await storage.saveCandidate(replacement);
  assert.deepEqual(await storage.loadCandidate(), replacement);
});

test("loads wait for a pending candidate mutation", async () => {
  const adapter = new MemoryAdapter();
  const { storage } = makeStorage(adapter);
  adapter.blockNextWrite();
  const save = storage.saveCandidate(index);
  await new Promise((resolve) => setImmediate(resolve));

  let candidateLoadSettled = false;
  let activeLoadSettled = false;
  const candidateLoad = storage.loadCandidate().then(() => {
    candidateLoadSettled = true;
  });
  const activeLoad = storage.loadActive().then(() => {
    activeLoadSettled = true;
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(candidateLoadSettled, false);
  assert.equal(activeLoadSettled, false);

  adapter.releaseWrite();
  await save;
  await Promise.all([candidateLoad, activeLoad]);
  assert.deepEqual(await storage.loadCandidate(), index);
  assert.equal(await storage.loadActive(), null);
});

test("activation cannot overtake a pending candidate save", async () => {
  const adapter = new MemoryAdapter();
  const { storage } = makeStorage(adapter);
  adapter.blockNextWrite();
  const save = storage.saveCandidate(index);
  await new Promise((resolve) => setImmediate(resolve));

  let activationSettled = false;
  const activation = storage.activateCandidate(index).then(() => {
    activationSettled = true;
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(activationSettled, false);

  adapter.releaseWrite();
  await save;
  assert.equal(activationSettled, false);
  await activation;
  assert.deepEqual(await storage.loadActive(), index);
});

test("invalid or aliased slot metadata fails closed", async () => {
  const { metadata, storage } = makeStorage();
  const mutable = metadata as unknown as { value: unknown };

  mutable.value = { activeSlot: "c", candidateSlot: null };
  await assert.rejects(storage.loadActive(), /metadata is malformed/);

  mutable.value = { activeSlot: "a", candidateSlot: "a" };
  await assert.rejects(storage.loadCandidate(), /aliases active and candidate slots/);
});
