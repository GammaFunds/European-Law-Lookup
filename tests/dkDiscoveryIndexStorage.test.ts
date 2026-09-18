import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import {
  parseStoredRetsinformationIndex,
  type RetsinformationIndex,
} from "../src/law/providers/RetsinformationDiscoveryIndex";
import {
  RetsinformationDiscoveryIndexStorage,
  type RetsinformationIndexMetadataPersistence,
  type RetsinformationIndexStoreMetadata,
  type RetsinformationIndexTextAdapter,
} from "../src/law/providers/RetsinformationDiscoveryIndexStorage";

function entry(canonicalEli = "/eli/lta/2024/1"): RetsinformationIndex["entries"][number] {
  return {
    canonicalEli,
    popularTitle: "Popular title",
    documentTitle: "Document title",
    documentType: "LTA",
    pubMedia: "lta",
    year: "2024",
    number: canonicalEli.endsWith("/2") ? "2" : "1",
    status: null,
    startDate: null,
    endDate: null,
    changeDate: null,
    accessionNumber: null,
    ministry: "Ministry",
    announcedIn: null,
    sourceUpdateTimestamp: null,
    sitemapLastModified: null,
  };
}

function index(overrides: Partial<RetsinformationIndex> = {}): RetsinformationIndex {
  return {
    schemaVersion: 1,
    source: "retsinformation-eli",
    generatedAt: "2026-09-17T10:00:00.000Z",
    lastSuccessfulRefresh: null,
    lastSuccessfulIncrementalRefresh: null,
    lastSuccessfulFullReconciliation: null,
    feedWatermark: null,
    entries: [entry()],
    ...overrides,
  };
}

class MemoryAdapter implements RetsinformationIndexTextAdapter {
  readonly files = new Map<string, string>();
  readonly reads: string[] = [];
  readonly writes: Array<{ path: string; data: string }> = [];
  readonly removes: string[] = [];
  failWrite = false;
  readOverride: ((path: string, data: string) => string) | null = null;
  afterWrite: ((path: string) => void) | null = null;

  async exists(path: string): Promise<boolean> { return this.files.has(path); }
  async read(path: string): Promise<string> {
    this.reads.push(path);
    const data = this.files.get(path);
    if (data === undefined) throw new Error(`missing ${path}`);
    return this.readOverride ? this.readOverride(path, data) : data;
  }
  async write(path: string, data: string): Promise<void> {
    if (this.failWrite) throw new Error("write failed");
    this.writes.push({ path, data });
    this.files.set(path, data);
    this.afterWrite?.(path);
  }
  async remove(path: string): Promise<void> { this.removes.push(path); this.files.delete(path); }
}

class FailingRemoveAdapter extends MemoryAdapter {
  override async remove(path: string): Promise<void> {
    this.removes.push(path);
    throw new Error("remove failed");
  }
}

class MemoryMetadata implements RetsinformationIndexMetadataPersistence {
  current: RetsinformationIndexStoreMetadata = { activeSlot: null, candidateSlot: null };
  readonly saves: RetsinformationIndexStoreMetadata[] = [];
  failNextSave = false;
  read(): RetsinformationIndexStoreMetadata { return { ...this.current }; }
  async save(metadata: RetsinformationIndexStoreMetadata): Promise<void> {
    if (this.failNextSave) {
      this.failNextSave = false;
      throw new Error("metadata save failed");
    }
    this.current = { ...metadata };
    this.saves.push({ ...metadata });
  }
}

class ActivationBarrierMetadata extends MemoryMetadata {
  readonly entered = new Promise<void>((resolve) => { this.resolveEntered = resolve; });
  private resolveEntered!: () => void;
  private releasePromise: Promise<void> | null = null;
  private resolveRelease: (() => void) | null = null;

  blockNextActivation(): void {
    this.releasePromise = new Promise<void>((resolve) => { this.resolveRelease = resolve; });
  }

  override async save(metadata: RetsinformationIndexStoreMetadata): Promise<void> {
    if (this.releasePromise && metadata.activeSlot !== this.current.activeSlot && metadata.candidateSlot === null) {
      const release = this.releasePromise;
      this.releasePromise = null;
      this.resolveEntered();
      await release;
    }
    await super.save(metadata);
  }

  release(): void { this.resolveRelease?.(); }
}

class CandidatePublicationBarrierMetadata extends MemoryMetadata {
  readonly entered = new Promise<void>((resolve) => { this.resolveEntered = resolve; });
  private resolveEntered!: () => void;
  private releasePromise: Promise<void> | null = null;
  private resolveRelease: (() => void) | null = null;

  blockNextCandidatePublication(): void {
    this.releasePromise = new Promise<void>((resolve) => { this.resolveRelease = resolve; });
  }

  override async save(metadata: RetsinformationIndexStoreMetadata): Promise<void> {
    if (this.releasePromise && this.current.candidateSlot === null && metadata.candidateSlot !== null) {
      const release = this.releasePromise;
      this.releasePromise = null;
      this.resolveEntered();
      await release;
    }
    await super.save(metadata);
  }

  release(): void { this.resolveRelease?.(); }
}

const BASE = ".obsidian/plugins/german-law-lookup";
const SLOT_A = `${BASE}/dk-discovery-index-a.json`;
const SLOT_B = `${BASE}/dk-discovery-index-b.json`;

describe("Retsinformation stored index parser", () => {
  it("parses a valid index", () => assert.deepEqual(parseStoredRetsinformationIndex(index()), index()));
  it("rejects inherited root schema fields", () => {
    const rootFields = [
      "schemaVersion", "source", "generatedAt", "lastSuccessfulRefresh",
      "lastSuccessfulIncrementalRefresh", "lastSuccessfulFullReconciliation", "feedWatermark", "entries",
    ] as const;
    for (const field of rootFields) {
      const prototype = { [field]: index()[field] };
      const raw = Object.assign(Object.create(prototype), index());
      delete raw[field];
      assert.throws(() => parseStoredRetsinformationIndex(raw), field);
    }
  });
  it("rejects inherited entry schema fields", () => {
    const entryFields = [
      "canonicalEli", "popularTitle", "documentTitle", "documentType", "pubMedia", "year", "number",
      "status", "startDate", "endDate", "changeDate", "accessionNumber", "ministry", "announcedIn",
      "sourceUpdateTimestamp", "sitemapLastModified",
    ] as const;
    for (const field of entryFields) {
      const validEntry = entry();
      const prototype = { [field]: validEntry[field] };
      const inheritedEntry = Object.assign(Object.create(prototype), validEntry);
      delete inheritedEntry[field];
      assert.throws(() => parseStoredRetsinformationIndex(index({ entries: [inheritedEntry] })), field);
    }
  });
  it("rejects canonical identity component mismatches", () => {
    for (const field of ["pubMedia", "year", "number"] as const) {
      assert.throws(() => parseStoredRetsinformationIndex(index({
        entries: [{ ...entry(), [field]: "mismatch" }],
      })), field);
    }
  });
  it("rejects malformed root, schema, source, metadata, and entries", () => {
    for (const malformed of [null, [], { ...index(), schemaVersion: 2 }, { ...index(), source: "other" },
      { ...index(), generatedAt: undefined }, { ...index(), feedWatermark: 3 }, { ...index(), entries: "bad" },
      { ...index(), entries: [{ ...entry(), status: 3 }] }]) {
      assert.throws(() => parseStoredRetsinformationIndex(malformed));
    }
  });
  it("rejects a non-canonical or duplicate ELI identity", () => {
    assert.throws(() => parseStoredRetsinformationIndex(index({ entries: [entry("https://www.retsinformation.dk/eli/lta/2024/1")] })));
    assert.throws(() => parseStoredRetsinformationIndex(index({ entries: [entry(), entry()] })));
  });
});

describe("Retsinformation discovery index A/B storage", () => {
  it("starts with no active or candidate index", async () => {
    const storage = new RetsinformationDiscoveryIndexStorage(BASE, new MemoryAdapter(), new MemoryMetadata());
    assert.equal(await storage.loadActive(), null);
    assert.equal(await storage.loadCandidate(), null);
  });

  it("reads only the recorded slot and never promotes a candidate", async () => {
    const adapter = new MemoryAdapter();
    const metadata = new MemoryMetadata();
    metadata.current = { activeSlot: "a", candidateSlot: "b" };
    adapter.files.set(SLOT_A, JSON.stringify(index()));
    adapter.files.set(SLOT_B, JSON.stringify(index({ generatedAt: "candidate" })));
    const storage = new RetsinformationDiscoveryIndexStorage(BASE, adapter, metadata);
    await storage.loadActive();
    assert.deepEqual(adapter.reads, [SLOT_A]);
    adapter.reads.length = 0;
    await storage.loadCandidate();
    assert.deepEqual(adapter.reads, [SLOT_B]);
    assert.deepEqual(metadata.current, { activeSlot: "a", candidateSlot: "b" });
  });

  it("writes compact candidate data to the inactive slot and reads it back", async () => {
    const adapter = new MemoryAdapter();
    const metadata = new MemoryMetadata();
    metadata.current = { activeSlot: "a", candidateSlot: null };
    const storage = new RetsinformationDiscoveryIndexStorage(BASE, adapter, metadata);
    const intended = index();
    await storage.saveCandidate(intended);
    assert.equal(adapter.writes[0].path, SLOT_B);
    assert.equal(adapter.writes[0].data.includes("\n"), false);
    assert.deepEqual(await storage.loadCandidate(), intended);
    assert.deepEqual(metadata.current, { activeSlot: "a", candidateSlot: "b" });
  });

  it("rejects corruption and semantic read-back mismatch without publishing", async () => {
    for (const readBack of ["{}", JSON.stringify(index({ generatedAt: "different" }))]) {
      const adapter = new MemoryAdapter();
      adapter.readOverride = () => readBack;
      const metadata = new MemoryMetadata();
      const storage = new RetsinformationDiscoveryIndexStorage(BASE, adapter, metadata);
      await assert.rejects(() => storage.saveCandidate(index()));
      assert.deepEqual(metadata.current, { activeSlot: null, candidateSlot: null });
    }
  });

  it("rejects when the candidate file disappears during read-back", async () => {
    const adapter = new MemoryAdapter();
    adapter.afterWrite = (path) => { adapter.files.delete(path); };
    const metadata = new MemoryMetadata();
    metadata.current = { activeSlot: "a", candidateSlot: null };
    const storage = new RetsinformationDiscoveryIndexStorage(BASE, adapter, metadata);
    await assert.rejects(() => storage.saveCandidate(index()));
    assert.deepEqual(metadata.current, { activeSlot: "a", candidateSlot: null });
    assert.deepEqual(metadata.saves, []);
  });

  it("rejects malformed JSON during read-back before publishing candidate metadata", async () => {
    const adapter = new MemoryAdapter();
    adapter.readOverride = () => "{malformed";
    const metadata = new MemoryMetadata();
    const storage = new RetsinformationDiscoveryIndexStorage(BASE, adapter, metadata);
    await assert.rejects(() => storage.saveCandidate(index()));
    assert.deepEqual(metadata.current, { activeSlot: null, candidateSlot: null });
    assert.deepEqual(metadata.saves, []);
  });

  it("keeps authority unchanged when candidate metadata save fails", async () => {
    const adapter = new MemoryAdapter();
    const metadata = new MemoryMetadata();
    metadata.current = { activeSlot: "a", candidateSlot: null };
    metadata.failNextSave = true;
    const storage = new RetsinformationDiscoveryIndexStorage(BASE, adapter, metadata);
    await assert.rejects(() => storage.saveCandidate(index()));
    assert.deepEqual(metadata.current, { activeSlot: "a", candidateSlot: null });
    assert.equal(adapter.files.has(SLOT_B), true);
  });

  it("activates only a matching candidate and does not rewrite its payload", async () => {
    const adapter = new MemoryAdapter();
    const metadata = new MemoryMetadata();
    const storage = new RetsinformationDiscoveryIndexStorage(BASE, adapter, metadata);
    const intended = index();
    await storage.saveCandidate(intended);
    adapter.writes.length = 0;
    await storage.activateCandidate(intended);
    assert.deepEqual(metadata.current, { activeSlot: "a", candidateSlot: null });
    assert.equal(adapter.writes.length, 0);
  });

  it("rejects activation without a candidate and preserves authority on mismatch", async () => {
    const adapter = new MemoryAdapter();
    const metadata = new MemoryMetadata();
    const storage = new RetsinformationDiscoveryIndexStorage(BASE, adapter, metadata);
    await assert.rejects(() => storage.activateCandidate(index()));
    await storage.saveCandidate(index());
    await assert.rejects(() => storage.activateCandidate(index({ generatedAt: "wrong" })));
    assert.deepEqual(metadata.current, { activeSlot: null, candidateSlot: "a" });
  });

  it("keeps the old active slot and candidate payload when activation metadata save fails", async () => {
    const adapter = new MemoryAdapter();
    const metadata = new MemoryMetadata();
    metadata.current = { activeSlot: "a", candidateSlot: "b" };
    const candidate = index();
    adapter.files.set(SLOT_A, JSON.stringify(index({ generatedAt: "active" })));
    adapter.files.set(SLOT_B, JSON.stringify(candidate));
    const before = adapter.files.get(SLOT_B);
    metadata.failNextSave = true;
    const storage = new RetsinformationDiscoveryIndexStorage(BASE, adapter, metadata);
    await assert.rejects(() => storage.activateCandidate(candidate));
    assert.deepEqual(metadata.current, { activeSlot: "a", candidateSlot: "b" });
    assert.equal(adapter.files.get(SLOT_B), before);
    assert.equal(adapter.writes.length, 0);
  });

  it("selects only an inactive slot across the candidate save matrix", async () => {
    for (const scenario of [
      { activeSlot: null, candidateSlot: null, expected: SLOT_A },
      { activeSlot: "a", candidateSlot: null, expected: SLOT_B },
      { activeSlot: "b", candidateSlot: null, expected: SLOT_A },
      { activeSlot: "a", candidateSlot: "b", expected: SLOT_B },
      { activeSlot: "b", candidateSlot: "a", expected: SLOT_A },
    ] as const) {
      const adapter = new MemoryAdapter();
      const metadata = new MemoryMetadata();
      metadata.current = { activeSlot: scenario.activeSlot, candidateSlot: scenario.candidateSlot };
      const storage = new RetsinformationDiscoveryIndexStorage(BASE, adapter, metadata);
      await storage.saveCandidate(index());
      const writtenPath = adapter.writes[adapter.writes.length - 1]?.path;
      assert.equal(writtenPath, scenario.expected);
      if (scenario.activeSlot !== null) {
        assert.notEqual(writtenPath, scenario.activeSlot === "a" ? SLOT_A : SLOT_B);
      }
      assert.deepEqual(metadata.current, {
        activeSlot: scenario.activeSlot,
        candidateSlot: scenario.expected === SLOT_A ? "a" : "b",
      });
    }
  });

  it("compares metadata, every entry field, and ignores entry array order", async () => {
    const adapter = new MemoryAdapter();
    const metadata = new MemoryMetadata();
    const storage = new RetsinformationDiscoveryIndexStorage(BASE, adapter, metadata);
    const first = index({ entries: [entry("/eli/lta/2024/2"), entry()] });
    await storage.saveCandidate(first);
    await storage.activateCandidate({ ...first, entries: [first.entries[1], first.entries[0]] });
    for (const field of [
      "schemaVersion", "source", "generatedAt", "lastSuccessfulRefresh",
      "lastSuccessfulIncrementalRefresh", "lastSuccessfulFullReconciliation", "feedWatermark",
    ] as const) {
      const candidate = index();
      await storage.saveCandidate(candidate);
      const changed = field === "schemaVersion" ? 2 : field === "source" ? "other" : "different";
      await assert.rejects(() => storage.activateCandidate({ ...candidate, [field]: changed } as unknown as RetsinformationIndex));
      await storage.discardCandidate();
    }
    for (const field of [
      "canonicalEli", "popularTitle", "documentTitle", "documentType", "pubMedia", "year", "number",
      "status", "startDate", "endDate", "changeDate", "accessionNumber", "ministry", "announcedIn",
      "sourceUpdateTimestamp", "sitemapLastModified",
    ] as const) {
      const candidate = index();
      await storage.saveCandidate(candidate);
      const changedEntry = { ...candidate.entries[0], [field]: field === "canonicalEli" ? "/eli/lta/2024/2" : "changed" };
      await assert.rejects(() => storage.activateCandidate({ ...candidate, entries: [changedEntry] }));
      await storage.discardCandidate();
    }
  });

  it("discards safely and never removes an active slot", async () => {
    const adapter = new MemoryAdapter();
    const metadata = new MemoryMetadata();
    metadata.current = { activeSlot: "a", candidateSlot: "a" };
    adapter.files.set(SLOT_A, JSON.stringify(index()));
    const storage = new RetsinformationDiscoveryIndexStorage(BASE, adapter, metadata);
    await storage.discardCandidate();
    assert.equal(adapter.files.has(SLOT_A), true);
    assert.deepEqual(adapter.removes, []);
  });

  it("rejects candidate discard when physical removal fails after clearing authority", async () => {
    const adapter = new FailingRemoveAdapter();
    const metadata = new MemoryMetadata();
    metadata.current = { activeSlot: "a", candidateSlot: "b" };
    const activePayload = JSON.stringify(index({ generatedAt: "active" }));
    const candidatePayload = JSON.stringify(index({ generatedAt: "candidate" }));
    adapter.files.set(SLOT_A, activePayload);
    adapter.files.set(SLOT_B, candidatePayload);
    const storage = new RetsinformationDiscoveryIndexStorage(BASE, adapter, metadata);

    await assert.rejects(() => storage.discardCandidate(), /remove failed/);
    assert.deepEqual(metadata.current, { activeSlot: "a", candidateSlot: null });
    assert.equal(adapter.files.get(SLOT_A), activePayload);
    assert.equal(adapter.files.get(SLOT_B), candidatePayload);
    assert.deepEqual(adapter.removes, [SLOT_B]);
    assert.deepEqual(await storage.loadActive(), parseStoredRetsinformationIndex(JSON.parse(activePayload)));
    assert.equal(await storage.loadCandidate(), null);
  });

  it("blocks candidate reads behind an in-flight candidate publication", async () => {
    const adapter = new MemoryAdapter();
    const metadata = new CandidatePublicationBarrierMetadata();
    const storage = new RetsinformationDiscoveryIndexStorage(BASE, adapter, metadata);
    const candidate = index({ generatedAt: "published-after-barrier" });
    metadata.blockNextCandidatePublication();
    const save = storage.saveCandidate(candidate);
    await metadata.entered;

    let readResolved = false;
    const read = storage.loadCandidate().then((value) => {
      readResolved = true;
      return value;
    });
    assert.equal(await Promise.race([read.then(() => true), Promise.resolve(false)]), false);
    assert.equal(readResolved, false);

    metadata.release();
    await save;
    assert.deepEqual(await read, candidate);
    assert.equal(readResolved, true);
  });

  it("recovers after a failed mutation", async () => {
    const adapter = new MemoryAdapter();
    const metadata = new MemoryMetadata();
    const storage = new RetsinformationDiscoveryIndexStorage(BASE, adapter, metadata);
    adapter.failWrite = true;
    await assert.rejects(() => storage.saveCandidate(index()));
    adapter.failWrite = false;
    await storage.saveCandidate(index());
    assert.ok(await storage.loadCandidate());
  });

  it("serializes candidate replacement behind activation", async () => {
    const adapter = new MemoryAdapter();
    const metadata = new ActivationBarrierMetadata();
    const storage = new RetsinformationDiscoveryIndexStorage(BASE, adapter, metadata);
    const candidate = index();
    await storage.saveCandidate(candidate);
    metadata.blockNextActivation();
    const activation = storage.activateCandidate(candidate);
    await metadata.entered;
    const replacement = storage.saveCandidate(index({ generatedAt: "replacement" }));
    metadata.release();
    await Promise.all([activation, replacement]);
    assert.equal(JSON.parse(adapter.files.get(SLOT_A)!).generatedAt, candidate.generatedAt);
    assert.equal(JSON.parse(adapter.files.get(SLOT_B)!).generatedAt, "replacement");
    assert.deepEqual(metadata.current, { activeSlot: "a", candidateSlot: "b" });
  });

  it("serializes discard behind activation and cannot delete the new active slot", async () => {
    const adapter = new MemoryAdapter();
    const metadata = new ActivationBarrierMetadata();
    const storage = new RetsinformationDiscoveryIndexStorage(BASE, adapter, metadata);
    const candidate = index();
    await storage.saveCandidate(candidate);
    metadata.blockNextActivation();
    const activation = storage.activateCandidate(candidate);
    await metadata.entered;
    const discard = storage.discardCandidate();
    metadata.release();
    await Promise.all([activation, discard]);
    assert.equal(adapter.files.has(SLOT_A), true);
    assert.equal(adapter.removes.includes(SLOT_A), false);
    assert.deepEqual(metadata.current, { activeSlot: "a", candidateSlot: null });
  });
});
