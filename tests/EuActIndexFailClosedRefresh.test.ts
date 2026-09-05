import { strict as assert } from "node:assert";
import { afterEach, beforeEach, describe, it } from "node:test";
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
  failReadOnce = new Set<string>();
  writes: string[] = [];

  async exists(path: string): Promise<boolean> {
    return this.files.has(path);
  }

  async read(path: string): Promise<string> {
    if (this.failReadOnce.has(path)) {
      this.failReadOnce.delete(path);
      throw new Error(`transient read failure: ${path}`);
    }
    const value = this.files.get(path);
    if (value === undefined) throw new Error(`missing file: ${path}`);
    return value;
  }

  async write(path: string, data: string): Promise<void> {
    this.writes.push(path);
    this.files.set(path, data);
  }

  async remove(path: string): Promise<void> {
    this.files.delete(path);
  }
}

class StubPlugin {
  app: {
    vault: { configDir: string; adapter: ProbeAdapter };
    workspace: { on: () => object };
  };
  manifest = { id: "german-law-lookup" };
  storedData: Record<string, unknown> | null = null;

  constructor(app?: {
    vault: { configDir: string; adapter: ProbeAdapter };
    workspace: { on: () => object };
  }) {
    this.app = app ?? {
      vault: { configDir: ".obsidian", adapter: new ProbeAdapter() },
      workspace: { on: () => ({}) },
    };
  }

  async loadData(): Promise<Record<string, unknown> | null> {
    return this.storedData;
  }

  async saveData(data: Record<string, unknown>): Promise<void> {
    this.storedData = structuredClone(data);
  }

  addSettingTab(): void {}
  addCommand(): void {}
  registerEvent(): void {}
  registerInterval(): void {}
}

class StubPluginSettingTab {
  constructor(public readonly app: unknown, public readonly plugin: unknown) {}
}

class StubSetting {
  setName(): StubSetting { return this; }
  setDesc(): StubSetting { return this; }
  setHeading(): StubSetting { return this; }
  addToggle(): StubSetting { return this; }
  addDropdown(): StubSetting { return this; }
  addText(): StubSetting { return this; }
}

let requestCalls = 0;
let requestObserved: Promise<void>;
let resolveRequestObserved: () => void;

function resetTransport(): void {
  requestCalls = 0;
  requestObserved = new Promise<void>((resolve) => {
    resolveRequestObserved = resolve;
  });
}

async function transportReachedWithin(ms: number): Promise<boolean> {
  return Promise.race([
    requestObserved.then(() => true),
    new Promise<boolean>((resolve) => setTimeout(() => resolve(false), ms)),
  ]);
}

const emptyCellarResponse = {
  head: { vars: [] },
  results: { bindings: [] },
};

async function requestUrlStub() {
  requestCalls += 1;
  resolveRequestObserved();
  return {
    status: 200,
    headers: {},
    text: JSON.stringify(emptyCellarResponse),
    json: emptyCellarResponse,
  };
}

const stubPath = "/tmp/obsidian-eu-index-refresh-guard-stub.cjs";
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
    requestUrl: requestUrlStub,
  };
  stub.loaded = true;

  moduleHooks._resolveFilename = function (
    request: string,
    ...rest: unknown[]
  ): string {
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
  pluginData: Record<string, any>;
  euActIndex: unknown;
  euActIndexStorage: unknown;
  createEuActIndexStorage(): unknown;
  loadEuActIndex(storage: unknown): Promise<unknown>;
  refreshEuActIndex(): Promise<void>;
  refreshEuActIndexIfStale(): Promise<void>;
  onload(): Promise<void>;
}

function makePlugin(
  adapter: ProbeAdapter,
  pluginData: Record<string, unknown>,
): RuntimePlugin {
  installObsidianStub();
  const bundlePath = resolve(__dirname, "../../main.js");
  delete require.cache[require.resolve(bundlePath)];

  const PluginConstructor = require(bundlePath).default as new (
    app: {
      vault: { configDir: string; adapter: ProbeAdapter };
      workspace: { on: () => object };
    },
    manifest: { id: string },
  ) => RuntimePlugin;

  const plugin = new PluginConstructor(
    {
      vault: { configDir: ".obsidian", adapter },
      workspace: { on: () => ({}) },
    },
    { id: "german-law-lookup" },
  );

  plugin.storedData = structuredClone(pluginData);
  return plugin;
}

const pluginDir = ".obsidian/plugins/german-law-lookup";
const slotA = `${pluginDir}/eu-act-index-a.json`;
const slotB = `${pluginDir}/eu-act-index-b.json`;

beforeEach(() => {
  resetTransport();
});

afterEach(() => {
  restoreObsidianStub();
});

describe("EU act index fail-closed refresh guard", () => {
  it("does not let automatic startup refresh reach CELLAR after a recorded active slot read fails", async () => {
    const adapter = new ProbeAdapter();
    adapter.files.set(
      slotA,
      JSON.stringify(storedIndex("32024R1689", "dedicated active")),
    );
    adapter.failReadOnce.add(slotA);

    const plugin = makePlugin(adapter, {
      euActIndex: storedIndex("32016R0679", "lingering legacy"),
      euActIndexStore: { activeSlot: "a", candidateSlot: null },
    });

    await plugin.onload();

    const reached = await transportReachedWithin(100);

    assert.equal(plugin.euActIndex, null);
    assert.equal(reached, false, "fail-closed startup must suppress automatic CELLAR refresh");
    assert.equal(requestCalls, 0);
    assert.equal(plugin.pluginData.euActIndexStore.activeSlot, "a");
    assert.equal(adapter.files.has(slotB), false);
    assert.deepEqual(adapter.writes, []);
  });

  it("does not let manual refresh reach CELLAR after the same fail-closed dedicated read", async () => {
    const adapter = new ProbeAdapter();
    adapter.files.set(
      slotA,
      JSON.stringify(storedIndex("32024R1689", "dedicated active")),
    );
    adapter.failReadOnce.add(slotA);

    const plugin = makePlugin(adapter, {
      euActIndex: storedIndex("32016R0679", "lingering legacy"),
      euActIndexStore: { activeSlot: "a", candidateSlot: null },
    });

    const originalAutoRefresh = plugin.refreshEuActIndexIfStale.bind(plugin);
    plugin.refreshEuActIndexIfStale = async () => undefined;
    await plugin.onload();
    plugin.refreshEuActIndexIfStale = originalAutoRefresh;

    assert.equal(plugin.euActIndex, null);
    resetTransport();

    await plugin.refreshEuActIndex();
    const reached = await transportReachedWithin(100);

    assert.equal(reached, false, "manual refresh must not bypass fail-closed dedicated authority");
    assert.equal(requestCalls, 0);
    assert.equal(plugin.pluginData.euActIndexStore.activeSlot, "a");
    assert.equal(adapter.files.has(slotB), false);
    assert.deepEqual(adapter.writes, []);
  });
});
