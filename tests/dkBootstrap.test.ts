import { strict as assert } from "node:assert";
import { test } from "node:test";
import { bootstrapRetsinformationIndex } from "../src/law/providers/RetsinformationBootstrap";
import type {
  RetsinformationIndex,
} from "../src/law/providers/RetsinformationDiscoveryIndex";
import type {
  RetsinformationDiscoveryIndexMetadata,
  RetsinformationBootstrapCheckpoint,
  RetsinformationIndexTextAdapter,
} from "../src/law/providers/RetsinformationDiscoveryIndexStorage";
import {
  RetsinformationDiscoveryIndexStorage,
} from "../src/law/providers/RetsinformationDiscoveryIndexStorage";
import type { LawProviderHttpResponse, LawProviderHttpTransport } from "../src/law/httpTransport";

const ORIGIN = "https://www.retsinformation.dk";
const SITEMAP_INDEX = `${ORIGIN}/eli/sitemap.xml`;
const PAGE = `${ORIGIN}/eli/sitemap-page-1.xml`;
const ELI_A = "/eli/lta/2014/433";
const ELI_B = "/eli/lov/2015/9";
const URL_A = `${ORIGIN}${ELI_A}.json`;
const URL_B = `${ORIGIN}${ELI_B}.json`;
const ELI_NS = "http://data.europa.eu/eli/ontology#";
type BootstrapStorage = Pick<
  RetsinformationDiscoveryIndexStorage,
  "loadBootstrapCheckpoint" | "saveBootstrapCheckpoint" | "saveCandidate" |
  "activateCandidate" | "clearBootstrapCheckpoint" | "loadActive"
>;

function response(body: unknown, status = 200): LawProviderHttpResponse {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => typeof body === "string" ? body : JSON.stringify(body),
    json: async () => body,
  };
}

function sitemap(): { index: string; page: string } {
  return {
    index: `<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><sitemap><loc>${PAGE}</loc></sitemap></sitemapindex>`,
    page: `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>${ORIGIN}${ELI_A}</loc><lastmod>2024-05-01T00:00:00Z</lastmod></url><url><loc>${ORIGIN}${ELI_B}</loc></url></urlset>`,
  };
}

function metadata(eli: string, title: string): unknown[] {
  const resourceId = `${ORIGIN.replace("www.", "")}${eli}`;
  const number = eli.endsWith("433") ? "433" : "9";
  return [
    {
      "@id": resourceId,
      "@type": [`${ELI_NS}LegalResource`],
      [`${ELI_NS}number`]: [{ "@value": number }],
      [`${ELI_NS}type_document`]: [{ "@id": "http://www.retsinformation.dk/eli/resource/authority/type_document#LOV" }],
    },
    {
      "@id": `${resourceId}/dan`,
      "@type": [`${ELI_NS}LegalExpression`],
      [`${ELI_NS}realizes`]: [{ "@id": resourceId }],
      [`${ELI_NS}title`]: [{ "@value": title }],
    },
  ];
}

class MemoryAdapter implements RetsinformationIndexTextAdapter {
  readonly files = new Map<string, string>();
  async exists(path: string): Promise<boolean> { return this.files.has(path); }
  async read(path: string): Promise<string> {
    const value = this.files.get(path);
    if (value === undefined) throw new Error(`missing file: ${path}`);
    return value;
  }
  async write(path: string, data: string): Promise<void> { this.files.set(path, data); }
  async remove(path: string): Promise<void> { this.files.delete(path); }
}

class MemoryMetadata {
  value: RetsinformationDiscoveryIndexMetadata = { activeSlot: null, candidateSlot: null };
  read(): RetsinformationDiscoveryIndexMetadata { return { ...this.value }; }
  async save(value: RetsinformationDiscoveryIndexMetadata): Promise<void> { this.value = { ...value }; }
}

function storageParts(): {
  adapter: MemoryAdapter;
  metadata: MemoryMetadata;
  storage: RetsinformationDiscoveryIndexStorage;
} {
  const adapter = new MemoryAdapter();
  const metadata = new MemoryMetadata();
  return { adapter, metadata, storage: new RetsinformationDiscoveryIndexStorage("data", adapter, metadata) };
}

function scriptedTransport(
  responses: Map<string, LawProviderHttpResponse | Error>,
): { fetchFn: LawProviderHttpTransport; calls: string[]; counts: Map<string, number> } {
  const calls: string[] = [];
  const counts = new Map<string, number>();
  const fetchFn: LawProviderHttpTransport = async (url) => {
    calls.push(url);
    counts.set(url, (counts.get(url) ?? 0) + 1);
    const outcome = responses.get(url);
    if (outcome === undefined) throw new Error(`unexpected URL: ${url}`);
    if (outcome instanceof Error) throw outcome;
    return outcome;
  };
  return { fetchFn, calls, counts };
}

function baseResponses(): Map<string, LawProviderHttpResponse | Error> {
  const maps = sitemap();
  return new Map([
    [SITEMAP_INDEX, response(maps.index)],
    [PAGE, response(maps.page)],
    [URL_A, response(metadata(ELI_A, "First law"))],
    [URL_B, response(metadata(ELI_B, "Second law"))],
  ]);
}

function assertIndexShape(index: RetsinformationIndex): void {
  assert.equal(index.schemaVersion, 1);
  assert.equal(index.source, "retsinformation-eli");
  assert.equal(index.lastSuccessfulIncrementalRefresh, null);
  assert.equal(index.lastSuccessfulFullReconciliation, null);
  assert.equal(index.feedWatermark, null);
}

function validatedEntry(
  canonicalEli: string,
  documentTitle: string,
  sourceUpdateTimestamp: string,
  sitemapLastModified: string | null,
): RetsinformationIndex["entries"][number] {
  const match = canonicalEli.match(/^\/eli\/(lta|lov)\/(\d{4})\/(\d+)$/u);
  assert.ok(match);
  return {
    canonicalEli,
    popularTitle: null,
    documentTitle,
    documentType: "LOV",
    pubMedia: match[1],
    year: match[2],
    number: match[3],
    status: null,
    startDate: null,
    endDate: null,
    changeDate: null,
    accessionNumber: null,
    ministry: null,
    announcedIn: null,
    sourceUpdateTimestamp,
    sitemapLastModified,
  };
}

async function bootstrap(
  storage: BootstrapStorage,
  responses = baseResponses(),
  nowValues = ["2026-09-19T10:00:00.000Z", "2026-09-19T10:01:00.000Z"],
): Promise<{ index: RetsinformationIndex; calls: string[]; counts: Map<string, number> }> {
  const transport = scriptedTransport(responses);
  let nowIndex = 0;
  const index = await bootstrapRetsinformationIndex(storage, transport.fetchFn, {
    now: () => nowValues[Math.min(nowIndex++, nowValues.length - 1)],
    sleep: async () => {},
  });
  return { index, calls: transport.calls, counts: transport.counts };
}

test("clean bootstrap is sequential, exact-URL, checkpointed, and all-or-nothing", async () => {
  const { storage } = storageParts();
  const result = await bootstrap(storage);
  assert.deepEqual(result.calls, [SITEMAP_INDEX, PAGE, URL_B, URL_A]);
  assert.equal(result.counts.get(URL_A), 1);
  assert.equal(result.counts.get(URL_B), 1);
  assert.equal(result.index.entries.length, 2);
  assert.equal(result.index.entries.find((entry) => entry.canonicalEli === ELI_A)?.sitemapLastModified, "2024-05-01T00:00:00Z");
  assertIndexShape(result.index);
  assert.equal(result.index.generatedAt, "2026-09-19T10:01:00.000Z");
  assert.equal(await storage.loadBootstrapCheckpoint(), null);
  assert.deepEqual(await storage.loadActive(), result.index);
});

test("clean bootstrap records the complete causal lifecycle and exact initial checkpoint", async () => {
  const { storage } = storageParts();
  const events: Array<{ name: string; checkpoint?: RetsinformationBootstrapCheckpoint }> = [];
  const initialSitemapEntries = [
    { canonicalEli: ELI_B, sitemapLastModified: null },
    { canonicalEli: ELI_A, sitemapLastModified: "2024-05-01T00:00:00Z" },
  ];
  const observed: BootstrapStorage = {
    loadBootstrapCheckpoint: () => storage.loadBootstrapCheckpoint(),
    saveBootstrapCheckpoint: async (checkpoint) => {
      await storage.saveBootstrapCheckpoint(checkpoint);
      events.push({
        name: `checkpoint:${checkpoint.nextEntryIndex}`,
        checkpoint: JSON.parse(JSON.stringify(checkpoint)) as RetsinformationBootstrapCheckpoint,
      });
    },
    saveCandidate: async (index) => {
      await storage.saveCandidate(index);
      events.push({ name: "saveCandidate" });
    },
    activateCandidate: async (index) => {
      await storage.activateCandidate(index);
      events.push({ name: "activateCandidate" });
    },
    clearBootstrapCheckpoint: async () => {
      await storage.clearBootstrapCheckpoint();
      events.push({ name: "clearBootstrapCheckpoint" });
    },
    loadActive: async () => {
      const active = await storage.loadActive();
      events.push({ name: "loadActive" });
      return active;
    },
  };
  const transport = scriptedTransport(baseResponses());
  const fetchFn: LawProviderHttpTransport = async (url, options) => {
    if (url === URL_A || url === URL_B) {
      assert.equal(events.some((event) => event.name === "saveCandidate"), false);
      events.push({ name: url === URL_B ? "metadata:0" : "metadata:1" });
    }
    const result = await transport.fetchFn(url, options);
    if (url === PAGE) {
      return {
        ...result,
        text: async () => {
          const text = await result.text();
          events.push({ name: "sitemapEnumerationComplete" });
          return text;
        },
      };
    }
    return result;
  };

  const result = await bootstrapRetsinformationIndex(observed, fetchFn, {
    now: () => "2026-09-19T08:00:00.000Z",
    sleep: async () => {},
  });
  events.push({ name: "return" });

  assert.deepEqual(events.map((event) => event.name), [
    "sitemapEnumerationComplete",
    "checkpoint:0",
    "metadata:0",
    "checkpoint:1",
    "metadata:1",
    "checkpoint:2",
    "saveCandidate",
    "activateCandidate",
    "clearBootstrapCheckpoint",
    "loadActive",
    "return",
  ]);
  assert.deepEqual(events[1].checkpoint, {
    schemaVersion: 1,
    startedAt: "2026-09-19T08:00:00.000Z",
    sitemapEntries: initialSitemapEntries,
    nextEntryIndex: 0,
    validatedEntries: [],
  });
  assert.equal(events.findIndex((event) => event.name === "metadata:0") < events.findIndex((event) => event.name === "saveCandidate"), true);
  assert.equal(events.findIndex((event) => event.name === "metadata:1") < events.findIndex((event) => event.name === "saveCandidate"), true);
  assert.equal(events.findIndex((event) => event.name === "checkpoint:2") < events.findIndex((event) => event.name === "saveCandidate"), true);
  assert.equal(events.findIndex((event) => event.name === "saveCandidate") < events.findIndex((event) => event.name === "activateCandidate"), true);
  assert.equal(events.findIndex((event) => event.name === "activateCandidate") < events.findIndex((event) => event.name === "clearBootstrapCheckpoint"), true);
  assert.equal(events.findIndex((event) => event.name === "clearBootstrapCheckpoint") < events.findIndex((event) => event.name === "loadActive"), true);
  assert.deepEqual(result, await storage.loadActive());
});

test("clean bootstrap preserves distinct observation and completion timestamps", async () => {
  const { storage } = storageParts();
  let initialCheckpoint: RetsinformationBootstrapCheckpoint | undefined;
  const observed: BootstrapStorage = {
    loadBootstrapCheckpoint: () => storage.loadBootstrapCheckpoint(),
    saveBootstrapCheckpoint: async (checkpoint) => {
      if (checkpoint.nextEntryIndex === 0) initialCheckpoint = JSON.parse(JSON.stringify(checkpoint)) as RetsinformationBootstrapCheckpoint;
      await storage.saveBootstrapCheckpoint(checkpoint);
    },
    saveCandidate: (index) => storage.saveCandidate(index),
    activateCandidate: (index) => storage.activateCandidate(index),
    clearBootstrapCheckpoint: () => storage.clearBootstrapCheckpoint(),
    loadActive: () => storage.loadActive(),
  };
  const timestamps = [
    "2026-09-19T08:00:00.000Z",
    "2026-09-19T08:01:00.000Z",
    "2026-09-19T08:02:00.000Z",
    "2026-09-19T08:03:00.000Z",
  ];
  let nowIndex = 0;
  const result = await bootstrapRetsinformationIndex(observed, scriptedTransport(baseResponses()).fetchFn, {
    now: () => timestamps[nowIndex++],
    sleep: async () => {},
  });

  assert.equal(initialCheckpoint?.startedAt, timestamps[0]);
  assert.equal(result.entries[0].sourceUpdateTimestamp, timestamps[1]);
  assert.equal(result.entries[1].sourceUpdateTimestamp, timestamps[2]);
  assert.equal(result.generatedAt, timestamps[3]);
  assert.equal(result.lastSuccessfulRefresh, timestamps[3]);
  assert.equal(result.lastSuccessfulIncrementalRefresh, null);
  assert.equal(result.lastSuccessfulFullReconciliation, null);
  assert.equal(result.feedWatermark, null);
});

test("completed checkpoint resumes without sitemap or metadata refetch", async () => {
  const { storage } = storageParts();
  const sitemapEntries = [
    { canonicalEli: ELI_B, sitemapLastModified: null },
    { canonicalEli: ELI_A, sitemapLastModified: "2024-05-01T00:00:00Z" },
  ];
  await storage.saveBootstrapCheckpoint({
    schemaVersion: 1,
    startedAt: "2026-09-19T07:00:00.000Z",
    sitemapEntries,
    nextEntryIndex: sitemapEntries.length,
    validatedEntries: [
      validatedEntry(ELI_B, "Second law", "2026-09-19T07:01:00.000Z", null),
      validatedEntry(ELI_A, "First law", "2026-09-19T07:02:00.000Z", "2024-05-01T00:00:00Z"),
    ],
  });
  const events: string[] = [];
  const observed: BootstrapStorage = {
    loadBootstrapCheckpoint: () => storage.loadBootstrapCheckpoint(),
    saveBootstrapCheckpoint: (checkpoint) => storage.saveBootstrapCheckpoint(checkpoint),
    saveCandidate: async (index) => { await storage.saveCandidate(index); events.push("saveCandidate"); },
    activateCandidate: async (index) => { await storage.activateCandidate(index); events.push("activateCandidate"); },
    clearBootstrapCheckpoint: async () => { await storage.clearBootstrapCheckpoint(); events.push("clearBootstrapCheckpoint"); },
    loadActive: async () => { const active = await storage.loadActive(); events.push("loadActive"); return active; },
  };
  const transport = scriptedTransport(baseResponses());
  const completedAt = "2026-09-19T08:03:00.000Z";
  const result = await bootstrapRetsinformationIndex(observed, transport.fetchFn, {
    now: () => completedAt,
    sleep: async () => {},
  });

  assert.deepEqual(transport.calls, []);
  assert.equal(transport.counts.get(SITEMAP_INDEX) ?? 0, 0);
  assert.equal(transport.counts.get(PAGE) ?? 0, 0);
  assert.equal(transport.counts.get(URL_A) ?? 0, 0);
  assert.equal(transport.counts.get(URL_B) ?? 0, 0);
  assert.deepEqual(events, ["saveCandidate", "activateCandidate", "clearBootstrapCheckpoint", "loadActive"]);
  assert.equal(result.generatedAt, completedAt);
  assert.equal(result.lastSuccessfulRefresh, completedAt);
  assert.notEqual(result.generatedAt, "2026-09-19T07:00:00.000Z");
  assert.notEqual(result.generatedAt, "2026-09-19T07:01:00.000Z");
  assert.notEqual(result.generatedAt, "2026-09-19T07:02:00.000Z");
  assert.equal(await storage.loadBootstrapCheckpoint(), null);
  assert.deepEqual(result, await storage.loadActive());
});

test("optional JSON-LD fields remain nullable and no legal-time state is inferred", async () => {
  const { storage } = storageParts();
  const result = await bootstrap(storage);
  for (const entry of result.index.entries) {
    assert.equal(entry.popularTitle, null);
    assert.equal(entry.status, null);
    assert.equal(entry.startDate, null);
    assert.equal(entry.endDate, null);
    assert.equal(entry.changeDate, null);
    assert.equal(entry.announcedIn, null);
  }
});

test("failure after a successful prefix preserves previous active and checkpoint prefix", async () => {
  const { storage } = storageParts();
  const previous = await bootstrap(storage, new Map([
    [SITEMAP_INDEX, response(sitemap().index)], [PAGE, response(`<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>${ORIGIN}${ELI_B}</loc></url></urlset>`)],
    [URL_B, response(metadata(ELI_B, "Old active"))],
  ])).then((x) => x.index);
  const responses = baseResponses();
  responses.set(URL_A, new Error("metadata acquisition failed"));
  const transport = scriptedTransport(responses);
  await assert.rejects(
    bootstrapRetsinformationIndex(storage, transport.fetchFn, { sleep: async () => {} }),
    /metadata acquisition failed/,
  );
  assert.deepEqual(await storage.loadActive(), previous);
  const checkpoint = await storage.loadBootstrapCheckpoint();
  assert.equal(checkpoint?.nextEntryIndex, 1);
  assert.equal(checkpoint?.validatedEntries.length, 1);
  assert.equal((await storage.loadCandidate()), null);
});

test("failure with no active leaves active unavailable and persists prefix", async () => {
  const { storage } = storageParts();
  const responses = baseResponses();
  responses.set(URL_A, new Error("required metadata failed"));
  const transport = scriptedTransport(responses);
  await assert.rejects(bootstrapRetsinformationIndex(storage, transport.fetchFn, { sleep: async () => {} }), /required metadata failed/);
  assert.equal(await storage.loadActive(), null);
  assert.equal((await storage.loadBootstrapCheckpoint())?.nextEntryIndex, 1);
});

test("resume does not refetch sitemap or validated metadata", async () => {
  const { storage } = storageParts();
  const first = baseResponses();
  first.set(URL_A, new Error("interrupt"));
  const firstTransport = scriptedTransport(first);
  await assert.rejects(bootstrapRetsinformationIndex(storage, firstTransport.fetchFn, { sleep: async () => {} }), /interrupt/);
  const second = scriptedTransport(baseResponses());
  const index = await bootstrapRetsinformationIndex(storage, second.fetchFn, { sleep: async () => {} });
  assert.deepEqual(second.calls, [URL_A]);
  assert.deepEqual(await storage.loadActive(), index);
});

test("checkpoint save completes before the next metadata request begins", async () => {
  const { storage } = storageParts();
  const events: string[] = [];
  let release: (() => void) | undefined;
  let saved = false;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const wrapped: BootstrapStorage = {
    loadBootstrapCheckpoint: () => storage.loadBootstrapCheckpoint(),
    saveBootstrapCheckpoint: async (checkpoint) => {
      await storage.saveBootstrapCheckpoint(checkpoint);
      saved = true;
      events.push(`checkpoint:${checkpoint.nextEntryIndex}`);
      if (checkpoint.nextEntryIndex === 1) await gate;
    },
    saveCandidate: (index) => storage.saveCandidate(index),
    activateCandidate: (index) => storage.activateCandidate(index),
    clearBootstrapCheckpoint: () => storage.clearBootstrapCheckpoint(),
    loadActive: () => storage.loadActive(),
  };
  const transport = scriptedTransport(baseResponses());
  const pending = bootstrapRetsinformationIndex(wrapped, async (url: string, options?: { headers?: Record<string, string> }) => {
    if (url === URL_A || url === URL_B) {
      events.push(url === URL_A ? "request:A" : "request:B");
    }
    if (url === URL_A) {
      assert.equal(saved, true);
    }
    return transport.fetchFn(url, options);
  }, { sleep: async () => {} });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(events, ["checkpoint:0", "request:B", "checkpoint:1"]);
  release?.();
  await pending;
  assert.deepEqual(events, ["checkpoint:0", "request:B", "checkpoint:1", "request:A", "checkpoint:2"]);
});

test("invalid required JSON-LD fails closed without advancing or activating", async () => {
  const { storage } = storageParts();
  const responses = baseResponses();
  responses.set(URL_A, response({ "@graph": [] }));
  const transport = scriptedTransport(responses);
  await assert.rejects(bootstrapRetsinformationIndex(storage, transport.fetchFn, { sleep: async () => {} }), /metadata validation failed/);
  assert.equal((await storage.loadBootstrapCheckpoint())?.nextEntryIndex, 1);
  assert.equal(await storage.loadActive(), null);
});

test("non-success metadata HTTP fails closed without advancing or activating", async () => {
  const { storage } = storageParts();
  const responses = baseResponses();
  responses.set(URL_A, response("unavailable", 404));
  const transport = scriptedTransport(responses);
  await assert.rejects(bootstrapRetsinformationIndex(storage, transport.fetchFn, { sleep: async () => {} }), /HTTP 404/);
  assert.equal((await storage.loadBootstrapCheckpoint())?.nextEntryIndex, 1);
  assert.equal(await storage.loadActive(), null);
});

test("candidate is saved only after every metadata item validates and activation follows save", async () => {
  const { storage } = storageParts();
  const events: string[] = [];
  const observed: BootstrapStorage = {
    loadBootstrapCheckpoint: () => storage.loadBootstrapCheckpoint(),
    saveBootstrapCheckpoint: (checkpoint) => storage.saveBootstrapCheckpoint(checkpoint),
    saveCandidate: async (index) => { events.push("save"); await storage.saveCandidate(index); },
    activateCandidate: async (index) => { events.push("activate"); await storage.activateCandidate(index); },
    clearBootstrapCheckpoint: async () => { events.push("clear"); await storage.clearBootstrapCheckpoint(); },
    loadActive: () => storage.loadActive(),
  };
  await bootstrapRetsinformationIndex(observed, scriptedTransport(baseResponses()).fetchFn, { sleep: async () => {} });
  assert.deepEqual(events, ["save", "activate", "clear"]);
});

test("corrupt active state rejects, then fresh bootstrap rebuilds a valid active index", async () => {
  const { storage, adapter, metadata } = storageParts();
  metadata.value = { activeSlot: "a", candidateSlot: null };
  adapter.files.set("data/retsinformation-index-a.json", JSON.stringify({
    schemaVersion: 999,
    source: "retsinformation-eli",
    generatedAt: "2026-01-01T00:00:00Z",
    lastSuccessfulRefresh: null,
    lastSuccessfulIncrementalRefresh: null,
    lastSuccessfulFullReconciliation: null,
    feedWatermark: null,
    entries: [],
  }));
  await assert.rejects(storage.loadActive(), /Unsupported Retsinformation index schema version/);
  const result = await bootstrap(storage);
  assert.deepEqual(await storage.loadActive(), result.index);
});

test("corrupt checkpoint rejects without silently enumerating or activating", async () => {
  const { storage, adapter } = storageParts();
  adapter.files.set("data/dk-discovery-bootstrap.json", JSON.stringify({
    schemaVersion: 999,
    startedAt: "2026-01-01T00:00:00Z",
    sitemapEntries: [],
    nextEntryIndex: 0,
    validatedEntries: [],
  }));
  const transport = scriptedTransport(baseResponses());
  await assert.rejects(
    bootstrapRetsinformationIndex(storage, transport.fetchFn, { sleep: async () => {} }),
    /Unsupported Retsinformation bootstrap checkpoint schema version/,
  );
  assert.deepEqual(transport.calls, []);
  assert.equal(await storage.loadActive(), null);
});

test("save, activation, and checkpoint clear are ordered", async () => {
  const { storage } = storageParts();
  const events: string[] = [];
  const wrapped: BootstrapStorage = {
    loadBootstrapCheckpoint: () => storage.loadBootstrapCheckpoint(),
    saveBootstrapCheckpoint: (checkpoint) => storage.saveBootstrapCheckpoint(checkpoint),
    saveCandidate: async (index) => { events.push("save"); await storage.saveCandidate(index); },
    activateCandidate: async (index) => { events.push("activate"); await storage.activateCandidate(index); },
    clearBootstrapCheckpoint: async () => { events.push("clear"); await storage.clearBootstrapCheckpoint(); },
    loadActive: () => storage.loadActive(),
  };
  await bootstrapRetsinformationIndex(wrapped, scriptedTransport(baseResponses()).fetchFn, { sleep: async () => {} });
  assert.equal(events.indexOf("save") < events.indexOf("activate"), true);
  assert.equal(events.indexOf("activate") < events.indexOf("clear"), true);
});

test("saveCandidate failure leaves the active index unavailable and checkpoint intact", async () => {
  const { storage } = storageParts();
  const wrapped: BootstrapStorage = {
    loadBootstrapCheckpoint: () => storage.loadBootstrapCheckpoint(),
    saveBootstrapCheckpoint: (checkpoint) => storage.saveBootstrapCheckpoint(checkpoint),
    saveCandidate: async () => { throw new Error("candidate save failed"); },
    activateCandidate: (index) => storage.activateCandidate(index),
    clearBootstrapCheckpoint: () => storage.clearBootstrapCheckpoint(),
    loadActive: () => storage.loadActive(),
  };
  await assert.rejects(
    bootstrapRetsinformationIndex(wrapped, scriptedTransport(baseResponses()).fetchFn, { sleep: async () => {} }),
    /candidate save failed/,
  );
  assert.equal(await storage.loadActive(), null);
  assert.equal((await storage.loadBootstrapCheckpoint())?.nextEntryIndex, 2);
});

test("activation failure leaves checkpoint intact and does not claim success", async () => {
  const { storage } = storageParts();
  const wrapped: BootstrapStorage = {
    loadBootstrapCheckpoint: () => storage.loadBootstrapCheckpoint(),
    saveBootstrapCheckpoint: (checkpoint) => storage.saveBootstrapCheckpoint(checkpoint),
    saveCandidate: (index) => storage.saveCandidate(index),
    activateCandidate: async () => { throw new Error("activation failed"); },
    clearBootstrapCheckpoint: () => storage.clearBootstrapCheckpoint(),
    loadActive: () => storage.loadActive(),
  };
  await assert.rejects(
    bootstrapRetsinformationIndex(wrapped, scriptedTransport(baseResponses()).fetchFn, { sleep: async () => {} }),
    /activation failed/,
  );
  assert.equal(await storage.loadActive(), null);
  assert.equal((await storage.loadBootstrapCheckpoint())?.nextEntryIndex, 2);
});

test("checkpoint clear failure propagates after the valid candidate is active", async () => {
  const { storage } = storageParts();
  const wrapped: BootstrapStorage = {
    loadBootstrapCheckpoint: () => storage.loadBootstrapCheckpoint(),
    saveBootstrapCheckpoint: (checkpoint) => storage.saveBootstrapCheckpoint(checkpoint),
    saveCandidate: (index) => storage.saveCandidate(index),
    activateCandidate: (index) => storage.activateCandidate(index),
    clearBootstrapCheckpoint: async () => { throw new Error("checkpoint clear failed"); },
    loadActive: () => storage.loadActive(),
  };
  await assert.rejects(
    bootstrapRetsinformationIndex(wrapped, scriptedTransport(baseResponses()).fetchFn, { sleep: async () => {} }),
    /checkpoint clear failed/,
  );
  assert.ok(await storage.loadActive());
  assert.equal((await storage.loadBootstrapCheckpoint())?.nextEntryIndex, 2);
});
