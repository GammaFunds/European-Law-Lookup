import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  EuActIndexFileStorage,
  type EuActIndexMetadataPersistence,
  type EuActIndexStoreMetadata,
  type EuActIndexTextAdapter,
} from "../src/law/EuActIndexFileStorage";
import type { StoredEuActIndex } from "../src/law/euActIndex";

function storedIndex(celex = "32016R0679"): StoredEuActIndex {
  return {
    schemaVersion: 1,
    lastSyncCheckpoint: "2026-09-05T08:00:00.000Z",
    generatedAt: "2026-09-05T08:00:00.000Z",
    entries: [{
      celex,
      documentType: celex[5] as "R" | "L" | "D",
      year: celex.slice(1, 5),
      number: celex.slice(6),
      titlesByLanguage: { eng: `Title ${celex}` },
      availableLanguages: ["eng"],
    }],
  };
}

class MemoryAdapter implements EuActIndexTextAdapter {
  readonly files = new Map<string, string>();
  readonly reads: string[] = [];
  readonly writes: Array<{ path: string; data: string }> = [];
  readonly removes: string[] = [];
  failWrite = false;
  readOverride: ((path: string, data: string) => string) | null = null;

  async exists(path: string): Promise<boolean> {
    return this.files.has(path);
  }

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
  }

  async remove(path: string): Promise<void> {
    this.removes.push(path);
    this.files.delete(path);
  }
}

class MemoryMetadata implements EuActIndexMetadataPersistence {
  current: EuActIndexStoreMetadata = { activeSlot: null, candidateSlot: null };
  readonly saves: EuActIndexStoreMetadata[] = [];
  readonly migrationSaves: EuActIndexStoreMetadata[] = [];

  read(): EuActIndexStoreMetadata {
    return { ...this.current };
  }

  async save(metadata: EuActIndexStoreMetadata): Promise<void> {
    this.current = { ...metadata };
    this.saves.push({ ...metadata });
  }

  async saveMigration(metadata: EuActIndexStoreMetadata): Promise<void> {
    this.current = { ...metadata };
    this.migrationSaves.push({ ...metadata });
  }
}

const BASE = ".obsidian/plugins/german-law-lookup";
const SLOT_A = `${BASE}/eu-act-index-a.json`;
const SLOT_B = `${BASE}/eu-act-index-b.json`;

describe("EuActIndexFileStorage candidate lifecycle", () => {
  it("writes a compact candidate to the inactive slot and publishes only after read-back validation", async () => {
    const adapter = new MemoryAdapter();
    const metadata = new MemoryMetadata();
    metadata.current = { activeSlot: "a", candidateSlot: null };
    adapter.files.set(SLOT_A, JSON.stringify(storedIndex("32022L2555")));
    const storage = new EuActIndexFileStorage(BASE, adapter, metadata);

    await storage.saveCandidateRaw(storedIndex());

    assert.equal(adapter.writes.length, 1);
    assert.equal(adapter.writes[0].path, SLOT_B);
    assert.equal(adapter.writes[0].data.includes("\n"), false, "index file must use compact JSON");
    assert.ok(adapter.reads.includes(SLOT_B), "candidate must be read back before publication");
    assert.deepEqual(metadata.current, { activeSlot: "a", candidateSlot: "b" });
  });

  it("preserves the active pointer when candidate writing fails", async () => {
    const adapter = new MemoryAdapter();
    adapter.failWrite = true;
    const metadata = new MemoryMetadata();
    metadata.current = { activeSlot: "a", candidateSlot: null };
    const storage = new EuActIndexFileStorage(BASE, adapter, metadata);

    await assert.rejects(() => storage.saveCandidateRaw(storedIndex()));
    assert.deepEqual(metadata.current, { activeSlot: "a", candidateSlot: null });
    assert.equal(metadata.saves.length, 0);
  });

  it("preserves the active pointer when candidate read-back validation fails", async () => {
    const adapter = new MemoryAdapter();
    adapter.readOverride = (path, data) => path === SLOT_B ? "{}" : data;
    const metadata = new MemoryMetadata();
    metadata.current = { activeSlot: "a", candidateSlot: null };
    const storage = new EuActIndexFileStorage(BASE, adapter, metadata);

    await assert.rejects(() => storage.saveCandidateRaw(storedIndex()));
    assert.deepEqual(metadata.current, { activeSlot: "a", candidateSlot: null });
    assert.equal(metadata.saves.length, 0);
  });

  it("activates only the validated recorded candidate and does not rewrite index payloads", async () => {
    const adapter = new MemoryAdapter();
    const metadata = new MemoryMetadata();
    metadata.current = { activeSlot: "a", candidateSlot: null };
    adapter.files.set(SLOT_A, JSON.stringify(storedIndex("32022L2555")));
    const storage = new EuActIndexFileStorage(BASE, adapter, metadata);
    const raw = storedIndex();
    await storage.saveCandidateRaw(raw);
    adapter.writes.length = 0;

    await storage.activateRaw({ ...raw, generatedAt: "2026-09-05T08:00:01.000Z" });

    assert.deepEqual(metadata.current, { activeSlot: "b", candidateSlot: null });
    assert.equal(adapter.writes.length, 0, "activation must flip metadata only");
  });

  it("refuses activation when the requested raw index differs from the recorded candidate", async () => {
    const adapter = new MemoryAdapter();
    const metadata = new MemoryMetadata();
    const storage = new EuActIndexFileStorage(BASE, adapter, metadata);
    await storage.saveCandidateRaw(storedIndex());

    await assert.rejects(() => storage.activateRaw(storedIndex("32022L2555")));
    assert.deepEqual(metadata.current, { activeSlot: null, candidateSlot: "a" });
  });

  it("never deletes an active slot while discarding a malformed same-slot candidate pointer", async () => {
    const adapter = new MemoryAdapter();
    adapter.files.set(SLOT_A, JSON.stringify(storedIndex()));
    const metadata = new MemoryMetadata();
    metadata.current = { activeSlot: "a", candidateSlot: "a" };
    const storage = new EuActIndexFileStorage(BASE, adapter, metadata);

    await storage.discardCandidate();

    assert.deepEqual(metadata.current, { activeSlot: "a", candidateSlot: null });
    assert.deepEqual(adapter.removes, []);
    assert.equal(adapter.files.has(SLOT_A), true);
  });

  it("reads only the slot named by active or candidate metadata and never promotes a candidate", async () => {
    const adapter = new MemoryAdapter();
    adapter.files.set(SLOT_A, JSON.stringify(storedIndex()));
    adapter.files.set(SLOT_B, JSON.stringify(storedIndex("32022L2555")));
    const metadata = new MemoryMetadata();
    metadata.current = { activeSlot: "a", candidateSlot: "b" };
    const storage = new EuActIndexFileStorage(BASE, adapter, metadata);

    await storage.loadRaw();
    assert.deepEqual(adapter.reads, [SLOT_A]);
    adapter.reads.length = 0;
    await storage.loadCandidateRaw();
    assert.deepEqual(adapter.reads, [SLOT_B]);
    assert.deepEqual(metadata.current, { activeSlot: "a", candidateSlot: "b" });
  });
});

describe("EuActIndexFileStorage legacy migration", () => {
  it("writes and validates a compact dedicated slot before publishing migration metadata", async () => {
    const adapter = new MemoryAdapter();
    const metadata = new MemoryMetadata();
    const storage = new EuActIndexFileStorage(BASE, adapter, metadata);

    const migrated = await storage.migrateLegacy(storedIndex());

    assert.equal(migrated.entries.size, 1);
    assert.equal(adapter.writes[0].path, SLOT_A);
    assert.equal(adapter.writes[0].data.includes("\n"), false);
    assert.ok(adapter.reads.includes(SLOT_A));
    assert.equal(metadata.saves.length, 0);
    assert.deepEqual(metadata.migrationSaves, [{ activeSlot: "a", candidateSlot: null }]);
  });

  it("does not publish migration metadata when read-back validation fails", async () => {
    const adapter = new MemoryAdapter();
    adapter.readOverride = () => "{}";
    const metadata = new MemoryMetadata();
    const storage = new EuActIndexFileStorage(BASE, adapter, metadata);

    await assert.rejects(() => storage.migrateLegacy(storedIndex()));
    assert.equal(metadata.migrationSaves.length, 0);
    assert.deepEqual(metadata.current, { activeSlot: null, candidateSlot: null });
  });
});

describe("main plugin persistence boundary", () => {
  const source = readFileSync("src/main.ts", "utf8");

  it("loads Obsidian plugin data once during startup and migrates only legacy euActIndex", () => {
    const onloadStart = source.indexOf("  async onload()");
    const providerStart = source.indexOf("  private createIndexProvider()", onloadStart);
    const onload = source.slice(onloadStart, providerStart);
    assert.equal((onload.match(/this\.loadData\(\)/g) ?? []).length, 1);

    const loadStart = source.indexOf("  private async loadEuActIndex(");
    const nextMethod = source.indexOf("  private createCellarTransport()", loadStart);
    const loadMethod = source.slice(loadStart, nextMethod);
    assert.ok(loadMethod.includes("this.pluginData.euActIndex"));
    assert.equal(loadMethod.includes("migrateLegacy(this.pluginData.euActIndexCandidate"), false);
  });

  it("normal settings and law-cache saves never load or touch dedicated index payloads", () => {
    const saveSettingsStart = source.indexOf("  private async saveSettings()");
    const cacheStart = source.indexOf("  private createLawSectionCacheStorage()", saveSettingsStart);
    const saveSettings = source.slice(saveSettingsStart, cacheStart);
    assert.equal(saveSettings.includes("loadData"), false);
    assert.equal(saveSettings.includes("euActIndexStorage"), false);

    const cacheEnd = source.indexOf("\n}\n\nclass DeLawSettingsTab", cacheStart);
    const cacheStorage = source.slice(cacheStart, cacheEnd);
    assert.equal(cacheStorage.includes("loadData"), false);
    assert.equal(cacheStorage.includes("euActIndexStorage"), false);
  });

  it("successful migration metadata save removes both legacy large-index fields", () => {
    const storageStart = source.indexOf("  private createEuActIndexStorage()");
    const storageEnd = source.indexOf("  private async loadEuActIndex(", storageStart);
    const storageFactory = source.slice(storageStart, storageEnd);
    assert.ok(storageFactory.includes("delete next.euActIndex;"));
    assert.ok(storageFactory.includes("delete next.euActIndexCandidate;"));
  });
});

class ActivationSaveBarrierMetadata extends MemoryMetadata {
  private releaseActivation!: () => void;
  private markActivationEntered!: () => void;
  private readonly releasePromise: Promise<void>;
  readonly activationEntered: Promise<void>;
  private blockActivationOnce = true;

  constructor() {
    super();
    this.activationEntered = new Promise<void>((resolve) => {
      this.markActivationEntered = resolve;
    });
    this.releasePromise = new Promise<void>((resolve) => {
      this.releaseActivation = resolve;
    });
  }

  override async save(metadata: EuActIndexStoreMetadata): Promise<void> {
    if (
      this.blockActivationOnce
      && metadata.activeSlot === "b"
      && metadata.candidateSlot === null
    ) {
      this.blockActivationOnce = false;
      this.markActivationEntered();
      await this.releasePromise;
    }
    await super.save(metadata);
  }

  release(): void {
    this.releaseActivation();
  }
}

describe("EuActIndexFileStorage concurrent authority lifecycle", () => {
  it("serializes candidate replacement behind activation so the validated active payload cannot change", async () => {
    const adapter = new MemoryAdapter();
    const metadata = new ActivationSaveBarrierMetadata();
    const oldRaw = storedIndex("32016R0679");
    const intended = storedIndex("32022L2555");
    const replacement = storedIndex("32024R1689");

    metadata.current = { activeSlot: "a", candidateSlot: "b" };
    adapter.files.set(SLOT_A, JSON.stringify(oldRaw));
    adapter.files.set(SLOT_B, JSON.stringify(intended));

    const storage = new EuActIndexFileStorage(BASE, adapter, metadata);
    const activation = storage.activateRaw(intended);
    await metadata.activationEntered;

    const replacementSave = storage.saveCandidateRaw(replacement);
    const activePayloadBeforeRelease = JSON.parse(adapter.files.get(SLOT_B)!) as StoredEuActIndex;

    metadata.release();
    const results = await Promise.allSettled([activation, replacementSave]);
    assert.deepEqual(results.map((result) => result.status), ["fulfilled", "fulfilled"]);

    assert.equal(
      activePayloadBeforeRelease.entries[0].celex,
      intended.entries[0].celex,
      "a candidate save must not overwrite the slot whose activation is in progress",
    );
    assert.deepEqual(metadata.current, { activeSlot: "b", candidateSlot: "a" });

    const activePayload = JSON.parse(adapter.files.get(SLOT_B)!) as StoredEuActIndex;
    const pendingPayload = JSON.parse(adapter.files.get(SLOT_A)!) as StoredEuActIndex;
    assert.equal(activePayload.entries[0].celex, intended.entries[0].celex);
    assert.equal(pendingPayload.entries[0].celex, replacement.entries[0].celex);
  });

  it("serializes discard behind activation so an active slot can never be deleted", async () => {
    const adapter = new MemoryAdapter();
    const metadata = new ActivationSaveBarrierMetadata();
    const oldRaw = storedIndex("32016R0679");
    const candidate = storedIndex("32022L2555");

    metadata.current = { activeSlot: "a", candidateSlot: "b" };
    adapter.files.set(SLOT_A, JSON.stringify(oldRaw));
    adapter.files.set(SLOT_B, JSON.stringify(candidate));

    const storage = new EuActIndexFileStorage(BASE, adapter, metadata);
    const activation = storage.activateRaw(candidate);
    await metadata.activationEntered;

    const discard = storage.discardCandidate();
    await Promise.resolve();
    await Promise.resolve();
    const candidateExistsBeforeRelease = adapter.files.has(SLOT_B);

    metadata.release();
    const results = await Promise.allSettled([activation, discard]);
    assert.deepEqual(results.map((result) => result.status), ["fulfilled", "fulfilled"]);

    assert.equal(
      candidateExistsBeforeRelease,
      true,
      "discard must not remove the candidate while activation owns the authority transaction",
    );
    assert.deepEqual(metadata.current, { activeSlot: "b", candidateSlot: null });
    assert.equal(adapter.files.has(SLOT_B), true, "active slot payload must still exist");
    assert.equal(adapter.removes.includes(SLOT_B), false, "active slot must never be removed");
  });

  it("makes loadRaw wait for an in-flight authority mutation before selecting the active slot", async () => {
    const adapter = new MemoryAdapter();
    const metadata = new ActivationSaveBarrierMetadata();
    const oldRaw = storedIndex("32016R0679");
    const candidate = storedIndex("32022L2555");

    metadata.current = { activeSlot: "a", candidateSlot: "b" };
    adapter.files.set(SLOT_A, JSON.stringify(oldRaw));
    adapter.files.set(SLOT_B, JSON.stringify(candidate));

    const storage = new EuActIndexFileStorage(BASE, adapter, metadata);
    const activation = storage.activateRaw(candidate);
    await metadata.activationEntered;

    const loadDuringActivation = storage.loadRaw();
    metadata.release();

    const [, loadedRaw] = await Promise.all([activation, loadDuringActivation]);
    assert.ok(loadedRaw);
    const loaded = loadedRaw as StoredEuActIndex;
    assert.equal(
      loaded.entries[0].celex,
      candidate.entries[0].celex,
      "loadRaw must observe the post-activation authority after waiting for the mutation",
    );
  });
});
