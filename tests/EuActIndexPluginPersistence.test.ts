import { strict as assert } from "node:assert";
import { afterEach, describe, it } from "node:test";
import { resolve } from "node:path";

const NodeModule = require("node:module") as typeof import("node:module");
const moduleHooks = NodeModule as unknown as {
  _resolveFilename: (request: string, ...rest: unknown[]) => string;
  _cache: Record<string, unknown>;
};

interface StoredIndex {
  schemaVersion: number;
  lastSyncCheckpoint: string;
  generatedAt: string;
  entries: Array<{
    celex: string;
    documentType: string;
    year: string;
    number: string;
    titlesByLanguage: Record<string, string>;
    availableLanguages: string[];
  }>;
}

function storedIndex(celex: string, title: string): StoredIndex {
  return {
    schemaVersion: 1,
    lastSyncCheckpoint: "2026-09-05T10:00:00.000Z",
    generatedAt: "2026-09-05T10:00:00.000Z",
    entries: [{
      celex,
      documentType: celex[5],
      year: celex.slice(1, 5),
      number: celex.slice(6),
      titlesByLanguage: { eng: title },
      availableLanguages: ["eng"],
    }],
  };
}

class ProbeAdapter {
  files = new Map<string, string>();
  writes: Array<{ path: string; data: string }> = [];
  reads: string[] = [];
  removes: string[] = [];
  failReadOnce = new Set<string>();

  async exists(path: string): Promise<boolean> {
    return this.files.has(path);
  }

  async read(path: string): Promise<string> {
    this.reads.push(path);
    if (this.failReadOnce.has(path)) {
      this.failReadOnce.delete(path);
      throw new Error(`transient read failure: ${path}`);
    }
    const value = this.files.get(path);
    if (value === undefined) throw new Error(`missing file: ${path}`);
    return value;
  }

  async write(path: string, data: string): Promise<void> {
    this.writes.push({ path, data });
    this.files.set(path, data);
  }

  async remove(path: string): Promise<void> {
    this.removes.push(path);
    this.files.delete(path);
  }
}

class StubPlugin {
  app: {
    vault: {
      configDir: string;
      adapter: ProbeAdapter;
    };
  };
  manifest = { id: "german-law-lookup" };
  storedData: Record<string, unknown> | null = null;
  savedDataSnapshots: Array<Record<string, unknown>> = [];
  failSaveCount = 0;

  constructor(app?: { vault: { configDir: string; adapter: ProbeAdapter } }) {
    this.app = app ?? {
      vault: {
        configDir: ".obsidian",
        adapter: new ProbeAdapter(),
      },
    };
  }

  async loadData(): Promise<Record<string, unknown> | null> {
    return this.storedData;
  }

  async saveData(data: Record<string, unknown>): Promise<void> {
    if (this.failSaveCount > 0) {
      this.failSaveCount -= 1;
      throw new Error("injected saveData failure");
    }
    this.storedData = structuredClone(data);
    this.savedDataSnapshots.push(structuredClone(data));
  }

  addSettingTab(): void {}
  addCommand(): void {}
  registerEvent(): void {}
}

class StubPluginSettingTab {
  constructor(
    public readonly app: unknown,
    public readonly plugin: unknown,
  ) {}
}

class StubSetting {
  setName(): StubSetting { return this; }
  setDesc(): StubSetting { return this; }
  setHeading(): StubSetting { return this; }
  addToggle(): StubSetting { return this; }
  addDropdown(): StubSetting { return this; }
  addText(): StubSetting { return this; }
}

const stubPath = "/tmp/obsidian-eu-index-plugin-persistence-stub.cjs";
const originalResolve = moduleHooks._resolveFilename;
const originalStubCache = moduleHooks._cache[stubPath];

function installObsidianStub(): void {
  const stub = new NodeModule(stubPath);
  stub.exports = {
    Plugin: StubPlugin,
    PluginSettingTab: StubPluginSettingTab,
    Modal: class {},
    Notice: class {},
    MarkdownView: class {},
    Setting: StubSetting,
    moment: { locale: () => "en" },
    requestUrl: async () => {
      throw new Error("mixed-state persistence test must not perform network I/O");
    },
  };
  stub.loaded = true;
  moduleHooks._resolveFilename = function (request: string, ...rest: unknown[]): string {
    if (request === "obsidian") return stubPath;
    return originalResolve.call(this, request, ...rest);
  };
  moduleHooks._cache[stubPath] = stub;
}

function restoreObsidianStub(): void {
  moduleHooks._resolveFilename = originalResolve;
  if (originalStubCache === undefined) delete moduleHooks._cache[stubPath];
  else moduleHooks._cache[stubPath] = originalStubCache;
}

interface RuntimePlugin extends StubPlugin {
  pluginData: Record<string, unknown>;
  euActIndexStorage: {
    saveCandidateRaw(raw: StoredIndex): Promise<void>;
    activateRaw(raw: StoredIndex): Promise<void>;
  };
  createEuActIndexStorage(): RuntimePlugin["euActIndexStorage"];
  loadEuActIndex(storage: RuntimePlugin["euActIndexStorage"]): Promise<{
    entries: Map<string, { celex: string }>;
  } | null>;
  mutatePluginData(
    transform: (current: Record<string, unknown>) => Record<string, unknown>,
  ): Promise<void>;
}

function loadPlugin(
  adapter: ProbeAdapter,
  pluginData: Record<string, unknown>,
): RuntimePlugin {
  installObsidianStub();
  const bundlePath = resolve(__dirname, "../../main.js");
  delete require.cache[require.resolve(bundlePath)];
  const PluginConstructor = require(bundlePath).default as new (
    app: { vault: { configDir: string; adapter: ProbeAdapter } },
  ) => RuntimePlugin;

  const plugin = new PluginConstructor({
    vault: {
      configDir: ".obsidian",
      adapter,
    },
  });
  plugin.storedData = structuredClone(pluginData);
  plugin.pluginData = structuredClone(pluginData);
  plugin.euActIndexStorage = plugin.createEuActIndexStorage();
  return plugin;
}

afterEach(() => {
  restoreObsidianStub();
});

const pluginDir = ".obsidian/plugins/german-law-lookup";
const slotA = `${pluginDir}/eu-act-index-a.json`;
const slotB = `${pluginDir}/eu-act-index-b.json`;

describe("EU act index plugin mixed-state persistence", () => {
  it("does not republish lingering legacy when a recorded dedicated active slot has a transient read failure", async () => {
    const dedicated = storedIndex("32024R1689", "dedicated newer");
    const legacy = storedIndex("32016R0679", "legacy older");
    const adapter = new ProbeAdapter();
    adapter.files.set(slotA, JSON.stringify(dedicated));
    adapter.failReadOnce.add(slotA);

    const plugin = loadPlugin(adapter, {
      euActIndex: legacy,
      euActIndexStore: { activeSlot: "a", candidateSlot: null },
    });

    const loaded = await plugin.loadEuActIndex(plugin.euActIndexStorage);

    assert.equal(loaded, null, "transient dedicated read failure must fail closed for this session");
    assert.deepEqual(
      plugin.pluginData.euActIndexStore,
      { activeSlot: "a", candidateSlot: null },
      "dedicated pointer must remain authoritative",
    );
    assert.equal(adapter.files.has(slotB), false, "legacy must not be republished to the inactive slot");
    assert.equal(adapter.writes.length, 0, "no dedicated payload write is allowed on fallback");
    assert.ok(plugin.pluginData.euActIndex, "legacy data remains untouched until dedicated authority is validated");
  });

  it("uses a valid dedicated active slot and removes both lingering legacy fields", async () => {
    const dedicated = storedIndex("32024R1689", "dedicated newer");
    const legacy = storedIndex("32016R0679", "legacy older");
    const legacyCandidate = storedIndex("32022L2555", "legacy candidate");
    const adapter = new ProbeAdapter();
    adapter.files.set(slotA, JSON.stringify(dedicated));

    const plugin = loadPlugin(adapter, {
      euActIndex: legacy,
      euActIndexCandidate: legacyCandidate,
      euActIndexStore: { activeSlot: "a", candidateSlot: null },
    });

    const loaded = await plugin.loadEuActIndex(plugin.euActIndexStorage);

    assert.ok(loaded);
    assert.equal(loaded.entries.get("32024R1689")?.celex, "32024R1689");
    assert.equal(plugin.pluginData.euActIndex, undefined);
    assert.equal(plugin.pluginData.euActIndexCandidate, undefined);
    assert.deepEqual(plugin.pluginData.euActIndexStore, { activeSlot: "a", candidateSlot: null });
    assert.equal(adapter.files.has(slotB), false);
  });

  it("removes candidate-only legacy state after a validated dedicated candidate is activated", async () => {
    const legacyCandidate = storedIndex("32016R0679", "legacy candidate");
    const nextDedicated = storedIndex("32022L2555", "next dedicated");
    const adapter = new ProbeAdapter();

    const plugin = loadPlugin(adapter, {
      euActIndexCandidate: legacyCandidate,
      euActIndexStore: { activeSlot: null, candidateSlot: null },
    });

    await plugin.euActIndexStorage.saveCandidateRaw(nextDedicated);
    assert.ok(
      plugin.pluginData.euActIndexCandidate,
      "candidate publication alone must not authorize legacy cleanup",
    );

    await plugin.euActIndexStorage.activateRaw(nextDedicated);

    assert.deepEqual(plugin.pluginData.euActIndexStore, { activeSlot: "a", candidateSlot: null });
    assert.equal(plugin.pluginData.euActIndexCandidate, undefined);
    assert.equal(plugin.pluginData.euActIndex, undefined);
    assert.equal(JSON.parse(adapter.files.get(slotA)!).entries[0].celex, "32022L2555");
  });

  it("preserves ordinary legacy migration when no dedicated active authority exists", async () => {
    const legacy = storedIndex("32016R0679", "legacy active");
    const legacyCandidate = storedIndex("32022L2555", "legacy candidate");
    const adapter = new ProbeAdapter();

    const plugin = loadPlugin(adapter, {
      euActIndex: legacy,
      euActIndexCandidate: legacyCandidate,
      euActIndexStore: { activeSlot: null, candidateSlot: null },
    });

    const loaded = await plugin.loadEuActIndex(plugin.euActIndexStorage);

    assert.ok(loaded);
    assert.equal(loaded.entries.get("32016R0679")?.celex, "32016R0679");
    assert.deepEqual(plugin.pluginData.euActIndexStore, { activeSlot: "a", candidateSlot: null });
    assert.equal(plugin.pluginData.euActIndex, undefined);
    assert.equal(plugin.pluginData.euActIndexCandidate, undefined);
    assert.equal(JSON.parse(adapter.files.get(slotA)!).entries[0].celex, "32016R0679");
  });

  it("does not fall back to legacy when a recorded dedicated active slot is missing", async () => {
    const legacy = storedIndex("32016R0679", "legacy active");
    const adapter = new ProbeAdapter();

    const plugin = loadPlugin(adapter, {
      euActIndex: legacy,
      euActIndexStore: { activeSlot: "a", candidateSlot: null },
    });

    const loaded = await plugin.loadEuActIndex(plugin.euActIndexStorage);

    assert.equal(loaded, null);
    assert.deepEqual(plugin.pluginData.euActIndexStore, { activeSlot: "a", candidateSlot: null });
    assert.equal(adapter.writes.length, 0);
    assert.equal(adapter.files.has(slotB), false);
  });

  it("keeps validated dedicated authority when cleanup save fails and strips legacy on the next normal plugin-data write", async () => {
    const dedicated = storedIndex("32024R1689", "dedicated newer");
    const legacy = storedIndex("32016R0679", "legacy older");
    const legacyCandidate = storedIndex("32022L2555", "legacy candidate");
    const adapter = new ProbeAdapter();
    adapter.files.set(slotA, JSON.stringify(dedicated));

    const plugin = loadPlugin(adapter, {
      euActIndex: legacy,
      euActIndexCandidate: legacyCandidate,
      euActIndexStore: { activeSlot: "a", candidateSlot: null },
    });
    plugin.failSaveCount = 1;

    const loaded = await plugin.loadEuActIndex(plugin.euActIndexStorage);

    assert.ok(loaded, "cleanup failure must not discard the validated dedicated session authority");
    assert.equal(loaded.entries.get("32024R1689")?.celex, "32024R1689");
    assert.ok(plugin.pluginData.euActIndex, "failed cleanup leaves the in-memory snapshot unchanged");
    assert.ok(plugin.pluginData.euActIndexCandidate);

    await plugin.mutatePluginData((current) => ({
      ...current,
      settings: { marker: "later normal save" },
    }));

    assert.equal(plugin.pluginData.euActIndex, undefined);
    assert.equal(plugin.pluginData.euActIndexCandidate, undefined);
    assert.deepEqual(plugin.pluginData.euActIndexStore, { activeSlot: "a", candidateSlot: null });
    assert.deepEqual(plugin.pluginData.settings, { marker: "later normal save" });
  });
});
