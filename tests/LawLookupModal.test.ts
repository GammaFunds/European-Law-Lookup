import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import type { App } from "obsidian";
import type { EuActIndex, EuActIndexEntry } from "../src/law/euActIndex";
import type { ProviderRegistry } from "../src/law/ProviderRegistry";
import type { EuLawLanguage, LawReference } from "../src/law/types";
import type { LawLookupModalIndexProvider } from "../src/ui/LawLookupModal";
import type { UiStrings } from "../src/ui/i18n";

type Listener = (event?: unknown) => void;

class FakeElement {
  children: FakeElement[] = [];
  listeners: Record<string, Listener[]> = {};
  text = "";
  value = "";

  createEl(tag: string, options?: { text?: string; value?: string }): FakeElement {
    const child = new FakeElement();
    child.text = options?.text ?? "";
    child.value = options?.value ?? "";
    this.children.push(child);
    return child;
  }

  createDiv(): FakeElement {
    const child = new FakeElement();
    this.children.push(child);
    return child;
  }

  addClass(_cls: string): void {}

  empty(): void {
    this.children = [];
  }

  addEventListener(type: string, listener: Listener): void {
    (this.listeners[type] ??= []).push(listener);
  }

  fire(type: string, event?: unknown): void {
    for (const listener of this.listeners[type] ?? []) listener(event);
  }
}

class FakeModal {
  contentEl = new FakeElement();
}

class FakeNotice {
  constructor(public message: string) {}
}

class FakeMarkdownView {}

interface FakeDropdown {
  options: Array<{ value: string; text: string }>;
  value: string;
  addOption(value: string, text: string): void;
  setValue(value: string): FakeDropdown;
  onChange(listener: (value: string) => void | Promise<void>): void;
  select(value: string): Promise<void>;
}

function makeFakeDropdown(): FakeDropdown {
  const dropdown: FakeDropdown = {
    options: [],
    value: "",
    addOption(value, text) {
      dropdown.options.push({ value, text });
    },
    setValue(value) {
      dropdown.value = value;
      return dropdown;
    },
    onChange(listener) {
      dropdown.select = async (value: string) => {
        await listener(value);
      };
    },
    select: async () => {},
  };
  return dropdown;
}

interface FakeToggle {
  value: boolean;
  setValue(value: boolean): FakeToggle;
  onChange(listener: (value: boolean) => void | Promise<void>): void;
  toggle(value: boolean): Promise<void>;
}

function makeFakeToggle(): FakeToggle {
  const toggle: FakeToggle = {
    value: false,
    setValue(value) {
      toggle.value = value;
      return toggle;
    },
    onChange(listener) {
      toggle.toggle = async (value: boolean) => {
        await listener(value);
      };
    },
    toggle: async () => {},
  };
  return toggle;
}

class FakeSetting {
  static instances: FakeSetting[] = [];

  dropdowns: FakeDropdown[] = [];
  toggles: FakeToggle[] = [];

  constructor(_element: FakeElement) {
    FakeSetting.instances.push(this);
  }

  setName(_name: string): FakeSetting {
    return this;
  }

  addDropdown(configure: (dropdown: FakeDropdown) => void): FakeSetting {
    const dropdown = makeFakeDropdown();
    this.dropdowns.push(dropdown);
    configure(dropdown);
    return this;
  }

  addToggle(configure: (toggle: FakeToggle) => void): FakeSetting {
    const toggle = makeFakeToggle();
    this.toggles.push(toggle);
    configure(toggle);
    return this;
  }
}

const obsidianStubPath = "/tmp/opencode/obsidian-virtual-stub.cjs";
const obsidianStub: Record<string, unknown> = {
  Modal: FakeModal,
  Notice: FakeNotice,
  Setting: FakeSetting,
  MarkdownView: FakeMarkdownView,
};

type ResolveFilename = (request: string, ...rest: unknown[]) => string;
const NodeModule = require("node:module") as typeof import("node:module");
const moduleWithHooks = NodeModule as unknown as {
  _resolveFilename?: ResolveFilename;
  _cache: Record<string, unknown>;
};
const preHarnessResolveFilename = moduleWithHooks._resolveFilename;
const preHarnessStubCacheEntry = moduleWithHooks._cache[obsidianStubPath];

// Loads `load()` with the obsidian stub installed in the Node module system and
// unconditionally restores the exact pre-harness global state afterwards:
// Module._resolveFilename is restored to its exact original value, and the stub
// require.cache entry is restored to the exact original entry if one pre-existed
// (CASE B) or deleted if the harness created it (CASE A).
function loadWithObsidianStub<T>(load: () => T): T {
  const originalResolveFilename = moduleWithHooks._resolveFilename;
  const originalStubCacheEntry = moduleWithHooks._cache[obsidianStubPath];
  const stubModule = new NodeModule(obsidianStubPath);
  stubModule.exports = obsidianStub;
  stubModule.loaded = true;
  moduleWithHooks._resolveFilename = function (request: string, ...rest: unknown[]) {
    if (request === "obsidian") {
      return obsidianStubPath;
    }
    return originalResolveFilename
      ? originalResolveFilename.call(this, request, ...rest)
      : request;
  };
  moduleWithHooks._cache[obsidianStubPath] = stubModule;
  try {
    return load();
  } finally {
    if (originalResolveFilename === undefined) {
      delete moduleWithHooks._resolveFilename;
    } else {
      moduleWithHooks._resolveFilename = originalResolveFilename;
    }
    if (originalStubCacheEntry === undefined) {
      delete moduleWithHooks._cache[obsidianStubPath];
    } else {
      moduleWithHooks._cache[obsidianStubPath] = originalStubCacheEntry;
    }
  }
}

interface LawLookupModalLike {
  onOpen(): void;
}

type LawLookupModalConstructor = new (
  app: App,
  providerRegistry: ProviderRegistry,
  settingsStore: {
    getDefaultLawSourceVariant(): string;
    getDefaultEuLawLanguage(): EuLawLanguage;
    setDefaultEuLawLanguage(value: EuLawLanguage): Promise<void>;
    getShowInsertedSourceMetadata(): boolean;
    setShowInsertedSourceMetadata(value: boolean): Promise<void>;
  },
  ui: UiStrings,
  indexProvider: LawLookupModalIndexProvider,
) => LawLookupModalLike;

const { LawLookupModal } = loadWithObsidianStub(
  () => require("../src/ui/LawLookupModal"),
) as {
  LawLookupModal: LawLookupModalConstructor;
};
const { getUiStrings } = require("../src/ui/i18n") as {
  getUiStrings: (languageCode: unknown) => UiStrings;
};

const GDPR_CELEX = "32016R0679";
const GDPR_INPUT = "32016R0679 Art. 5";

function makeEuActIndex(entries: Array<{ celex: string; availableLanguages: string[] }>): EuActIndex {
  const indexEntries = new Map<string, EuActIndexEntry>();
  for (const entry of entries) {
    indexEntries.set(entry.celex, {
      celex: entry.celex,
      documentType: "R",
      year: "2016",
      number: "679",
      titlesByLanguage: {},
      availableLanguages: entry.availableLanguages,
    });
  }
  return {
    schemaVersion: 1,
    lastSyncCheckpoint: null,
    entries: indexEntries,
  };
}

interface CapturedRequest {
  language?: string;
  euCelex?: string;
}

interface ModalHarness {
  requests: CapturedRequest[];
  inputEl: FakeElement;
  jurisdictionSelect: FakeElement;
  lastRequest(): CapturedRequest;
}

function settle(): Promise<void> {
  return new Promise<void>((resolve) => setImmediate(() => resolve()));
}

function buildModalHarness(index: EuActIndex | null): ModalHarness {
  FakeSetting.instances = [];
  const requests: CapturedRequest[] = [];
  const providerRegistry = {
    getSection: async (reference: LawReference): Promise<never> => {
      requests.push({ language: reference.language, euCelex: reference.euCelex });
      throw new Error("probe-provider-unavailable");
    },
  };
  const settingsStore = {
    getDefaultLawSourceVariant: () => "official-de",
    getDefaultEuLawLanguage: () => "fr" as EuLawLanguage,
    setDefaultEuLawLanguage: async (_value: EuLawLanguage): Promise<void> => {},
    getShowInsertedSourceMetadata: () => true,
    setShowInsertedSourceMetadata: async (_value: boolean): Promise<void> => {},
  };
  const indexProvider: LawLookupModalIndexProvider = { getEuActIndex: () => index };
  const modal = new LawLookupModal(
    {} as App,
    providerRegistry as unknown as ProviderRegistry,
    settingsStore,
    getUiStrings("en"),
    indexProvider,
  );
  modal.onOpen();
  const contentEl = (modal as unknown as { contentEl: FakeElement }).contentEl;
  const formEl = contentEl.children[1];
  const inputEl = formEl.children[0];
  const jurisdictionSelect = formEl.children[1];
  jurisdictionSelect.value = "EU";
  jurisdictionSelect.fire("change");
  return { requests, inputEl, jurisdictionSelect, lastRequest: () => requests[requests.length - 1] };
}

async function runLookup(harness: ModalHarness, input: string): Promise<void> {
  harness.inputEl.value = input;
  harness.inputEl.fire("keydown", { key: "Enter" });
  await settle();
}

function languageDropdown(): FakeDropdown {
  const settingsWithDropdowns = FakeSetting.instances.filter(
    (setting) => setting.dropdowns.length > 0,
  );
  assert.ok(settingsWithDropdowns.length > 0, "expected a language dropdown Setting");
  return settingsWithDropdowns[settingsWithDropdowns.length - 1].dropdowns[0];
}

describe("LawLookupModal EU requested language preservation", () => {
  it("C1: stale advisory index must not rewrite the requested language", async () => {
    const harness = buildModalHarness(makeEuActIndex([
      { celex: GDPR_CELEX, availableLanguages: ["deu"] },
    ]));
    await runLookup(harness, GDPR_INPUT);
    assert.equal(harness.requests.length, 1);
    assert.equal(harness.lastRequest().language, "fra");
    assert.equal(harness.lastRequest().euCelex, GDPR_CELEX);
    assert.ok(
      languageDropdown().options.some((option) => option.value === "deu"),
      "advisory index must still populate the dropdown",
    );
  });

  it("C2: missing advisory index must not rewrite the requested language", async () => {
    const harness = buildModalHarness(null);
    await runLookup(harness, GDPR_INPUT);
    assert.equal(harness.requests.length, 1);
    assert.equal(harness.lastRequest().language, "fra");
    assert.equal(harness.lastRequest().euCelex, GDPR_CELEX);
  });

  it("C3: CELEX absent from local index must not rewrite the requested language", async () => {
    const harness = buildModalHarness(makeEuActIndex([
      { celex: "32024R1689", availableLanguages: ["deu"] },
    ]));
    await runLookup(harness, GDPR_INPUT);
    assert.equal(harness.requests.length, 1);
    assert.equal(harness.lastRequest().language, "fra");
    assert.equal(harness.lastRequest().euCelex, GDPR_CELEX);
  });

  it("C4: requested language listed by the index is preserved", async () => {
    const harness = buildModalHarness(makeEuActIndex([
      { celex: GDPR_CELEX, availableLanguages: ["deu", "fra"] },
    ]));
    await runLookup(harness, GDPR_INPUT);
    assert.equal(harness.requests.length, 1);
    assert.equal(harness.lastRequest().language, "fra");
    assert.equal(harness.lastRequest().euCelex, GDPR_CELEX);
  });

  it("C5: exactly one provider request carries the requested language, no fallback request", async () => {
    const harness = buildModalHarness(makeEuActIndex([
      { celex: GDPR_CELEX, availableLanguages: ["deu"] },
    ]));
    await runLookup(harness, GDPR_INPUT);
    assert.equal(harness.requests.length, 1);
    assert.equal(harness.lastRequest().language, "fra");
    const deuRequests = harness.requests.filter(
      (request) => request.language === "deu",
    );
    assert.equal(deuRequests.length, 0);
  });

  it("C6: explicit user language selection remains authoritative", async () => {
    const harness = buildModalHarness(makeEuActIndex([
      { celex: GDPR_CELEX, availableLanguages: ["deu"] },
    ]));
    await runLookup(harness, GDPR_INPUT);
    assert.equal(harness.lastRequest().language, "fra");
    const dropdown = languageDropdown();
    await dropdown.select("deu");
    await settle();
    assert.equal(harness.requests.length, 2);
    assert.equal(harness.lastRequest().language, "deu");
    assert.equal(harness.lastRequest().euCelex, GDPR_CELEX);
  });
});

describe("LawLookupModal test harness module-state isolation", () => {
  it("restores Module._resolveFilename to the exact original function after the harness lifecycle", () => {
    assert.equal(
      moduleWithHooks._resolveFilename,
      preHarnessResolveFilename,
      "harness must restore the original Module._resolveFilename identity",
    );
  });

  it("restores require.cache state for the stub entry after the harness lifecycle", () => {
    // CASE A: the stub key did not exist in require.cache before harness setup,
    // so after teardown the key must be absent again.
    // CASE B: if the key had pre-existed, the exact original entry object must
    // be restored instead of deleted.
    assert.equal(
      moduleWithHooks._cache[obsidianStubPath],
      preHarnessStubCacheEntry,
      "harness must not leave the obsidian stub in the global require.cache",
    );
  });

  it("restores module state when stubbed loading throws", () => {
    const resolveBefore = moduleWithHooks._resolveFilename;
    const cacheBefore = moduleWithHooks._cache[obsidianStubPath];
    assert.throws(
      () =>
        loadWithObsidianStub(() => {
          throw new Error("probe-stub-load-failure");
        }),
      /probe-stub-load-failure/,
    );
    assert.equal(moduleWithHooks._resolveFilename, resolveBefore);
    assert.equal(moduleWithHooks._cache[obsidianStubPath], cacheBefore);
  });
});
