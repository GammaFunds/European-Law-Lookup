import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import {
  bootstrapEuActIndex,
  reconcileEuActIndex,
  isIndexFresh,
  revalidateWork,
  EuActIndexSyncError,
  type RawEuActIndexStorage,
} from "../src/law/euActIndexSync";
import type {
  CellarDiscoveredWorkRecord,
  CellarMetadataClient,
  CellarWorkCursor,
  CellarWorkRecord,
} from "../src/law/providers/CellarMetadataClient";
import { parseStoredEuActIndex } from "../src/law/euActIndex";

function record(celex: string, languages: string[], workUri = `http://example.test/${celex}`): CellarDiscoveredWorkRecord {
  return {
    celex,
    documentType: celex[5] as CellarWorkRecord["documentType"],
    year: celex.slice(1, 5),
    number: celex.slice(6),
    titlesByLanguage: { eng: `Title ${celex}` },
    availableLanguages: languages,
    workUri,
  };
}

class MemStorage implements RawEuActIndexStorage {
  current: unknown = null;
  candidate: unknown = null;
  activated: unknown[] = [];

  async loadRaw(): Promise<unknown> {
    return this.current;
  }
  async loadCandidateRaw(): Promise<unknown> {
    return this.candidate;
  }
  async saveCandidateRaw(raw: unknown): Promise<void> {
    this.candidate = raw;
  }
  async activateRaw(raw: unknown): Promise<void> {
    this.current = raw;
    this.activated.push(raw);
  }
  async discardCandidate(): Promise<void> {
    this.candidate = null;
  }
}

class StubClient {
  pageSize = 2;
  pages: CellarDiscoveredWorkRecord[][] = [];
  throwOnPage = -1;
  pageCalls = 0;

  async fetchTargetWorksPage(_cursor: CellarWorkCursor | null, _limit: number): Promise<{ records: CellarDiscoveredWorkRecord[]; nextCursor: CellarWorkCursor | null }> {
    const idx = this.pageCalls++;
    if (idx === this.throwOnPage) throw new Error("CELLAR unavailable");
    const records = this.pages.shift() ?? [];
    return {
      records,
      nextCursor: records.length === 0 ? null : { workId: records.at(-1)!.celex, workUri: records.at(-1)!.workUri },
    };
  }
  async fetchWorkRecord(): Promise<CellarWorkRecord | null> {
    return null;
  }
}

describe("euActIndexSync bootstrap", () => {
  it("builds and atomically activates a complete candidate index", async () => {
    const storage = new MemStorage();
    const client = new StubClient() as unknown as CellarMetadataClient;
    (client as unknown as StubClient).pages = [[record("32016R0679", ["deu", "eng"]), record("32022L2555", ["eng"])], [record("32024R1689", ["deu", "eng"])]];
    const index = await bootstrapEuActIndex(client, storage);
    assert.equal(index.entries.size, 3);
    assert.equal(storage.activated.length, 1);
    assert.ok(parseStoredEuActIndex(storage.current));
  });

  it("refuses to activate an empty candidate index", async () => {
    const storage = new MemStorage();
    const client = new StubClient() as unknown as CellarMetadataClient;
    (client as unknown as StubClient).pages = [[]];
    await assert.rejects(() => bootstrapEuActIndex(client, storage));
    assert.equal(storage.activated.length, 0);
  });

  it("never activates a partial sync when a page fails", async () => {
    const storage = new MemStorage();
    storage.current = { schemaVersion: 1, lastSyncCheckpoint: "2020-01-01T00:00:00.000Z", generatedAt: "x", entries: [record("31999R0001", ["eng"])] };
    const client = new StubClient() as unknown as CellarMetadataClient;
    const stub = client as unknown as StubClient;
    stub.pages = [[record("32016R0679", ["deu"]), record("32022L2555", ["eng"])], [record("32024R1689", ["deu"])]];
    stub.throwOnPage = 1;
    const before = storage.activated.length;
    await assert.rejects(() => bootstrapEuActIndex(client, storage));
    assert.equal(storage.activated.length, before, "last-known-good must be preserved");
  });

  it("rejects a malformed candidate record and does not activate", async () => {
    const storage = new MemStorage();
    const client = new StubClient() as unknown as CellarMetadataClient;
    (client as unknown as StubClient).pages = [[record("32016R0679", ["deu"]), record("02016R0679", ["deu"])]];
    await assert.rejects(() => bootstrapEuActIndex(client, storage));
    assert.equal(storage.activated.length, 0);
  });

  it("does not activate when cursor traversal regresses", async () => {
    const storage = new MemStorage();
    const client = new StubClient() as unknown as CellarMetadataClient;
    const stub = client as unknown as StubClient;
    stub.pages = [[record("32016R0679", ["deu"])], [record("32022L2555", ["eng"])]];
    (stub.fetchTargetWorksPage as unknown as (cursor: CellarWorkCursor | null, limit: number) => Promise<unknown>) = async function (this: StubClient, _cursor, _limit) {
      const records = this.pages.shift() ?? [];
      return { records, nextCursor: records.length ? { workId: "32010R0001", workUri: "http://example.test/regressed" } : null };
    };
    await assert.rejects(() => bootstrapEuActIndex(client, storage));
    assert.equal(storage.activated.length, 0);
  });
});

describe("euActIndexSync reconciliation", () => {
  it("reconciles onto an existing last-known-good index", async () => {
    const storage = new MemStorage();
    storage.current = { schemaVersion: 1, lastSyncCheckpoint: "2020-01-01T00:00:00.000Z", generatedAt: "x", entries: [record("31999R0001", ["eng"])] };
    const client = new StubClient() as unknown as CellarMetadataClient;
    (client as unknown as StubClient).pages = [[record("31999R0001", ["eng", "deu"]), record("32016R0679", ["deu"])]];
    const index = await reconcileEuActIndex(client, storage);
    assert.equal(index.entries.size, 2);
    assert.ok(index.entries.get("32016R0679"));
    assert.equal(storage.activated.length, 1);
  });

  it("bootstraps when no last-known-good index exists", async () => {
    const storage = new MemStorage();
    const client = new StubClient() as unknown as CellarMetadataClient;
    (client as unknown as StubClient).pages = [[record("32016R0679", ["deu"])]];
    const index = await reconcileEuActIndex(client, storage);
    assert.equal(index.entries.size, 1);
  });
});

describe("euActIndexSync cross-page CELEX/Work-URI injectivity", () => {
  it("rejects the same CELEX bound to a different Work URI on a later bootstrap page", async () => {
    const storage = new MemStorage();
    const client = new StubClient() as unknown as CellarMetadataClient;
    const stub = client as unknown as StubClient;
    stub.pages = [
      [record("32016R0679", ["eng"], "http://example.test/w1")],
      [record("32016R0679", ["deu"], "http://example.test/w2")],
    ];
    await assert.rejects(() => bootstrapEuActIndex(client, storage), EuActIndexSyncError);
    assert.equal(storage.activated.length, 0, "candidate must not be activated");
    assert.equal(storage.candidate, null, "candidate must not be persisted");
  });

  it("rejects the same Work URI bound to a different CELEX on a later bootstrap page", async () => {
    const storage = new MemStorage();
    const client = new StubClient() as unknown as CellarMetadataClient;
    const stub = client as unknown as StubClient;
    stub.pages = [
      [record("32016R0679", ["eng"], "http://example.test/shared")],
      [record("32022L2555", ["eng"], "http://example.test/shared")],
    ];
    await assert.rejects(() => bootstrapEuActIndex(client, storage), EuActIndexSyncError);
    assert.equal(storage.activated.length, 0, "candidate must not be activated");
    assert.equal(storage.candidate, null, "candidate must not be persisted");
  });

  it("rejects cross-page CELEX/Work-URI drift during reconciliation and preserves the last-known-good index", async () => {
    const storage = new MemStorage();
    const lkg = { schemaVersion: 1, lastSyncCheckpoint: "2020-01-01T00:00:00.000Z", generatedAt: "x", entries: [record("31999R0001", ["eng"])] };
    storage.current = lkg;
    const client = new StubClient() as unknown as CellarMetadataClient;
    const stub = client as unknown as StubClient;
    stub.pages = [
      [record("32016R0679", ["eng"], "http://example.test/w1")],
      [record("32016R0679", ["deu"], "http://example.test/w2")],
    ];
    await assert.rejects(() => reconcileEuActIndex(client, storage), EuActIndexSyncError);
    assert.equal(storage.activated.length, 0, "last-known-good must not be replaced");
    assert.equal(storage.candidate, null, "candidate must not be persisted");
    assert.equal(storage.current, lkg, "last-known-good must remain intact");
  });

  it("rejects inverse cross-page Work-URI drift during reconciliation and preserves the last-known-good index", async () => {
    const storage = new MemStorage();
    const lkg = { schemaVersion: 1, lastSyncCheckpoint: "2020-01-01T00:00:00.000Z", generatedAt: "x", entries: [record("31999R0001", ["eng"])] };
    storage.current = lkg;
    const client = new StubClient() as unknown as CellarMetadataClient;
    const stub = client as unknown as StubClient;
    stub.pages = [
      [record("32016R0679", ["eng"], "http://example.test/shared")],
      [record("32022L2555", ["eng"], "http://example.test/shared")],
    ];
    await assert.rejects(() => reconcileEuActIndex(client, storage), EuActIndexSyncError);
    assert.equal(storage.activated.length, 0, "last-known-good must not be replaced");
    assert.equal(storage.candidate, null, "candidate must not be persisted");
    assert.equal(storage.current, lkg, "last-known-good must remain intact");
  });

  it("accepts valid distinct CELEX/Work-URI identities across bootstrap pages", async () => {
    const storage = new MemStorage();
    const client = new StubClient() as unknown as CellarMetadataClient;
    const stub = client as unknown as StubClient;
    stub.pages = [
      [record("32016R0679", ["eng"], "http://example.test/w1"), record("32022L2555", ["eng"], "http://example.test/w2")],
      [record("32024R1689", ["deu"], "http://example.test/w3")],
    ];
    const index = await bootstrapEuActIndex(client, storage);
    assert.equal(index.entries.size, 3);
    assert.equal(storage.activated.length, 1);
  });

  it("accepts valid distinct CELEX/Work-URI identities across reconciliation pages", async () => {
    const storage = new MemStorage();
    storage.current = { schemaVersion: 1, lastSyncCheckpoint: "2020-01-01T00:00:00.000Z", generatedAt: "x", entries: [record("31999R0001", ["eng"], "http://example.test/w0")] };
    const client = new StubClient() as unknown as CellarMetadataClient;
    const stub = client as unknown as StubClient;
    stub.pages = [
      [record("31999R0001", ["eng", "deu"], "http://example.test/w0"), record("32016R0679", ["eng"], "http://example.test/w1")],
      [record("32022L2555", ["eng"], "http://example.test/w2")],
    ];
    const index = await reconcileEuActIndex(client, storage);
    assert.equal(index.entries.size, 3);
    assert.equal(storage.activated.length, 1);
  });
});

describe("euActIndexSync revalidation", () => {
  it("revalidates a single work and preserves the rest", async () => {
    const storage = new MemStorage();
    storage.current = { schemaVersion: 1, lastSyncCheckpoint: "2020-01-01T00:00:00.000Z", generatedAt: "x", entries: [record("31999R0001", ["eng"])] };
    const client = new StubClient() as unknown as CellarMetadataClient;
    client.fetchWorkRecord = async () => record("32024R1689", ["deu", "eng"]);
    const index = await revalidateWork(client, storage, "32024R1689");
    assert.equal(index.entries.size, 2);
    assert.ok(index.entries.get("32024R1689"));
  });
});

describe("euActIndexSync freshness", () => {
  it("treats a recent checkpoint as fresh and a stale one as not", () => {
    const now = new Date("2025-01-02T00:00:00.000Z");
    const fresh = parseStoredEuActIndex({ schemaVersion: 1, lastSyncCheckpoint: "2025-01-01T12:00:00.000Z", generatedAt: "x", entries: [] });
    const stale = parseStoredEuActIndex({ schemaVersion: 1, lastSyncCheckpoint: "2024-01-01T00:00:00.000Z", generatedAt: "x", entries: [] });
    assert.equal(isIndexFresh(fresh, 24 * 60 * 60 * 1000, now), true);
    assert.equal(isIndexFresh(stale, 24 * 60 * 60 * 1000, now), false);
    assert.equal(isIndexFresh(null, 24 * 60 * 60 * 1000, now), false);
  });
});
