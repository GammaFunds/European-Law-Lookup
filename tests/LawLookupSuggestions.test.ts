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

  createEl(_tag: string, options?: { text?: string; value?: string }): FakeElement {
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
  addOption(value: string, text: string): void;
  setValue(value: string): FakeDropdown;
  onChange(listener: (value: string) => void | Promise<void>): void;
}

interface FakeToggle {
  setValue(value: boolean): FakeToggle;
  onChange(listener: (value: boolean) => void | Promise<void>): void;
}

class FakeSetting {
  constructor(_element: FakeElement) {}
  setName(_name: string): FakeSetting { return this; }
  addDropdown(configure: (dropdown: FakeDropdown) => void): FakeSetting {
    const dropdown: FakeDropdown = {
      addOption: () => {},
      setValue: () => dropdown,
      onChange: () => {},
    };
    configure(dropdown);
    return this;
  }
  addToggle(configure: (toggle: FakeToggle) => void): FakeSetting {
    const toggle: FakeToggle = {
      setValue: () => toggle,
      onChange: () => {},
    };
    configure(toggle);
    return this;
  }
}

const obsidianStubPath = "/tmp/european-law-lookup-suggestions-obsidian-stub.cjs";
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

function loadWithObsidianStub<T>(load: () => T): T {
  const originalResolveFilename = moduleWithHooks._resolveFilename;
  const originalStubCacheEntry = moduleWithHooks._cache[obsidianStubPath];
  const stubModule = new NodeModule(obsidianStubPath);
  stubModule.exports = obsidianStub;
  stubModule.loaded = true;
  moduleWithHooks._resolveFilename = function (request: string, ...rest: unknown[]) {
    if (request === "obsidian") return obsidianStubPath;
    return originalResolveFilename
      ? originalResolveFilename.call(this, request, ...rest)
      : request;
  };
  moduleWithHooks._cache[obsidianStubPath] = stubModule;
  try {
    return load();
  } finally {
    if (originalResolveFilename === undefined) delete moduleWithHooks._resolveFilename;
    else moduleWithHooks._resolveFilename = originalResolveFilename;
    if (originalStubCacheEntry === undefined) delete moduleWithHooks._cache[obsidianStubPath];
    else moduleWithHooks._cache[obsidianStubPath] = originalStubCacheEntry;
  }
}

type LawLookupModalConstructor = new (
  app: App,
  providerRegistry: ProviderRegistry,
  settingsStore: {
    getDefaultLawSourceVariant(): string;
    getDefaultEuLawLanguage(): EuLawLanguage;
    setDefaultEuLawLanguage(value: EuLawLanguage): Promise<void>;
    getDefaultChLawLanguage(): "de" | "fr" | "it";
    setDefaultChLawLanguage(value: "de" | "fr" | "it"): Promise<void>;
    getShowInsertedSourceMetadata(): boolean;
    setShowInsertedSourceMetadata(value: boolean): Promise<void>;
  },
  ui: UiStrings,
  indexProvider: LawLookupModalIndexProvider,
) => { onOpen(): void };

const { LawLookupModal } = loadWithObsidianStub(
  () => require("../src/ui/LawLookupModal"),
) as { LawLookupModal: LawLookupModalConstructor };
const { getUiStrings } = require("../src/ui/i18n") as {
  getUiStrings: (languageCode: unknown) => UiStrings;
};

function makeIndex(): EuActIndex {
  const aiAct: EuActIndexEntry = {
    celex: "32024R1689",
    documentType: "R",
    year: "2024",
    number: "1689",
    titlesByLanguage: {
      eng: "Artificial Intelligence Act",
      fra: "Règlement sur l’intelligence artificielle",
      deu: "Verordnung über künstliche Intelligenz",
    },
    availableLanguages: ["deu", "eng", "fra"],
  };
  return {
    schemaVersion: 1,
    lastSyncCheckpoint: null,
    entries: new Map([[aiAct.celex, aiAct]]),
  };
}

function collectText(element: FakeElement): string[] {
  return [element.text, ...element.children.flatMap(collectText)].filter(Boolean);
}

function findByText(element: FakeElement, expected: string): FakeElement | undefined {
  if (element.text === expected) return element;
  for (const child of element.children) {
    const found = findByText(child, expected);
    if (found) return found;
  }
  return undefined;
}

function buildHarness(index: EuActIndex | null = makeIndex()) {
  const providerRequests: LawReference[] = [];
  const providerRegistry = {
    getSection: async (reference: LawReference): Promise<never> => {
      providerRequests.push(reference);
      throw new Error("unexpected-provider-call");
    },
  };
  const settingsStore = {
    getDefaultLawSourceVariant: () => "official-de",
    getDefaultEuLawLanguage: () => "en" as EuLawLanguage,
    setDefaultEuLawLanguage: async (_value: EuLawLanguage): Promise<void> => {},
    getDefaultChLawLanguage: () => "de" as const,
    setDefaultChLawLanguage: async (_value: "de" | "fr" | "it"): Promise<void> => {},
    getShowInsertedSourceMetadata: () => true,
    setShowInsertedSourceMetadata: async (_value: boolean): Promise<void> => {},
  };
  const modal = new LawLookupModal(
    {} as App,
    providerRegistry as unknown as ProviderRegistry,
    settingsStore,
    getUiStrings("en"),
    { getEuActIndex: () => index },
  );
  modal.onOpen();
  const contentEl = (modal as unknown as { contentEl: FakeElement }).contentEl;
  const formEl = contentEl.children[1];
  return {
    formEl,
    inputEl: formEl.children[0],
    jurisdictionSelect: formEl.children[1],
    providerRequests,
  };
}

function typeQuery(harness: ReturnType<typeof buildHarness>, query: string): void {
  harness.inputEl.value = query;
  harness.inputEl.fire("input");
}

function selectJurisdiction(
  harness: ReturnType<typeof buildHarness>,
  jurisdiction: "DE" | "AT" | "CH" | "EU",
): void {
  harness.jurisdictionSelect.value = jurisdiction;
  harness.jurisdictionSelect.fire("change");
}

describe("LawLookupModal title suggestions", () => {
  it("suggests German laws locally after two characters without a provider request", () => {
    const harness = buildHarness();
    typeQuery(harness, "bundesdaten");
    assert.ok(collectText(harness.formEl).includes("Bundesdatenschutzgesetz (BDSG)"));
    assert.equal(harness.providerRequests.length, 0);
  });

  it("respects the selected jurisdiction", () => {
    const harness = buildHarness();
    selectJurisdiction(harness, "AT");
    typeQuery(harness, "datenschutz");
    const text = collectText(harness.formEl);
    assert.ok(text.includes("Datenschutzgesetz (DSG)"));
    assert.equal(text.includes("Bundesdatenschutzgesetz (BDSG)"), false);
  });

  it("matches Swiss official titles in French while Switzerland is selected", () => {
    const harness = buildHarness();
    selectJurisdiction(harness, "CH");
    typeQuery(harness, "protection des données");
    assert.ok(
      collectText(harness.formEl).some((text) =>
        text.includes("Loi fédérale du 25 septembre 2020 sur la protection des données") && text.includes("DSG"),
      ),
    );
  });

  it("matches multilingual EU titles and shows CELEX identity", () => {
    const harness = buildHarness();
    selectJurisdiction(harness, "EU");
    typeQuery(harness, "intelligence artificielle");
    assert.ok(
      collectText(harness.formEl).includes(
        "Règlement sur l’intelligence artificielle · CELEX 32024R1689",
      ),
    );
  });

  it("requires two characters and caps suggestions at eight", () => {
    const harness = buildHarness();
    typeQuery(harness, "g");
    assert.equal(collectText(harness.formEl).some((text) => text.includes("gesetz")), false);
    typeQuery(harness, "gesetz");
    const suggestionTexts = collectText(harness.formEl).filter((text) => /\([A-Za-zÄÖÜäöüß0-9 /-]+\)$/.test(text));
    assert.ok(suggestionTexts.length <= 8);
  });

  it("fills a canonical starter citation when a suggestion is selected", () => {
    const harness = buildHarness();
    typeQuery(harness, "bundesdaten");
    const suggestion = findByText(harness.formEl, "Bundesdatenschutzgesetz (BDSG)");
    assert.ok(suggestion, "expected BDSG suggestion button");
    suggestion.fire("click");
    assert.equal(harness.inputEl.value, "BDSG § ");
    assert.equal(harness.providerRequests.length, 0);
  });
});
