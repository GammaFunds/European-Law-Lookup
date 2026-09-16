import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it } from "node:test";
import type { App } from "obsidian";
import type { EuActIndex, EuActIndexEntry } from "../src/law/euActIndex";
import type { ProviderRegistry } from "../src/law/ProviderRegistry";
import type { EuLawLanguage, LawJurisdiction, LawReference, LawSection } from "../src/law/types";
import type { LawDiscoveryProvider } from "../src/law/LawDiscovery";
import { LawDiscoveryMalformedResponseError } from "../src/law/LawDiscovery";
import { LawProviderUnavailableError } from "../src/law/errors";
import { LawSectionNotFoundError } from "../src/law/ProviderRegistry";
import { NormattivaLawProvider, NormattivaSourceContractError } from "../src/law/providers/NormattivaLawProvider";
import type { LawLookupModalIndexProvider } from "../src/ui/LawLookupModal";
import type { UiStrings } from "../src/ui/i18n";

type Listener = (event?: unknown) => void;

class FakeElement {
  children: FakeElement[] = [];
  listeners: Record<string, Listener[]> = {};
  attributes: Record<string, string> = {};
  text = "";
  value = "";
  tag = "";
  parentElement: FakeElement | null = null;
  private readonly classes = new Set<string>();

  createEl(tag: string, options?: { text?: string; value?: string; cls?: string; placeholder?: string; attr?: Record<string, string> }): FakeElement {
    const child = new FakeElement();
    child.tag = tag;
    child.text = options?.text ?? "";
    child.value = options?.value ?? "";
    child.applyOptions(options);
    if (options?.placeholder !== undefined) child.setAttribute("placeholder", options.placeholder);
    child.parentElement = this;
    this.children.push(child);
    return child;
  }

  createDiv(options?: { text?: string; cls?: string; attr?: Record<string, string> }): FakeElement {
    const child = new FakeElement();
    child.text = options?.text ?? "";
    child.applyOptions(options);
    child.parentElement = this;
    this.children.push(child);
    return child;
  }

  private applyOptions(options?: { cls?: string; attr?: Record<string, string> }): void {
    if (options?.cls) this.addClass(options.cls);
    for (const [name, value] of Object.entries(options?.attr ?? {})) {
      this.setAttribute(name, value);
    }
  }

  addClass(cls: string): void { this.classes.add(cls); }
  removeClass(cls: string): void { this.classes.delete(cls); }
  hasClass(cls: string): boolean { return this.classes.has(cls); }
  classCount(): number { return this.classes.size; }
  setText(value: string): void { this.text = value; }

  empty(): void {
    this.children = [];
  }

  remove(): void {
    if (!this.parentElement) return;
    this.parentElement.children = this.parentElement.children.filter((child) => child !== this);
    this.parentElement = null;
  }

  setAttribute(name: string, value: string): void { this.attributes[name] = value; }
  getAttribute(name: string): string | null { return this.attributes[name] ?? null; }

  insertBefore(child: FakeElement, _reference: FakeElement): void {
    this.children.unshift(child);
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
  modalEl = new FakeElement();
  modalContainerEl = new FakeElement();

  constructor() {
    this.modalEl.parentElement = this.modalContainerEl;
  }
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
Object.defineProperty(globalThis, "window", {
  configurable: true,
  value: { setTimeout, clearTimeout },
});
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
  onClose(): void;
  setInputLayout(layout: "single" | "split"): boolean;
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
  discoveryProvider?: ReadonlyMap<LawJurisdiction, LawDiscoveryProvider> | LawDiscoveryProvider | null,
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
  lawCode?: string;
  section?: string;
  jurisdiction?: string;
  referenceType?: string;
}

interface ModalHarness {
  requests: CapturedRequest[];
  inputEl: FakeElement;
  jurisdictionSelect: FakeElement;
  modal: LawLookupModalLike;
  lastRequest(): CapturedRequest;
}

interface LookupDomState {
  resultEl: FakeElement;
  lookupLoadingEl?: FakeElement | null;
}

function lookupDomState(harness: ModalHarness): LookupDomState {
  return harness.modal as unknown as LookupDomState;
}

function explicitLookupSpinner(harness: ModalHarness): FakeElement | undefined {
  return lookupDomState(harness).resultEl.children.find(
    (child) => child.hasClass("de-law-lookup-loading"),
  );
}

function settle(): Promise<void> {
  return new Promise<void>((resolve) => setImmediate(() => resolve()));
}

const successfulSection: LawSection = {
  providerId: "eu-test",
  providerLabel: "EU test provider",
  sourceUrl: "https://example.test/law",
  lawCode: "32016R0679",
  lawTitle: "Test law",
  section: "1",
  referenceType: "article",
  jurisdiction: "EU",
  language: "deu",
  heading: "Article 1",
  text: "retrieved legal text",
  retrievedAt: "2026-09-08T00:00:00.000Z",
  cacheStatus: "live",
  isOfficialSource: true,
  isAuthoritativeText: false,
};

function buildModalHarness(
  index: EuActIndex | null,
  getSection: (reference: LawReference) => Promise<LawSection | null> = async () => {
    throw new Error("probe-provider-unavailable");
  },
  discoveryProvider: ReadonlyMap<LawJurisdiction, LawDiscoveryProvider> | LawDiscoveryProvider | null = null,
  ui: UiStrings = getUiStrings("en"),
  inputLayout: "single" | "split" = "single",
): ModalHarness {
  FakeSetting.instances = [];
  const requests: CapturedRequest[] = [];
  const providerRegistry = {
    getSection: async (reference: LawReference): Promise<LawSection | null> => {
      requests.push({ language: reference.language, euCelex: reference.euCelex, lawCode: reference.lawCode, section: reference.section, jurisdiction: reference.jurisdiction, referenceType: reference.referenceType });
      return getSection(reference);
    },
  };
  const settingsStore = {
    getDefaultLawSourceVariant: () => "official-de",
    getDefaultEuLawLanguage: () => "fr" as EuLawLanguage,
    setDefaultEuLawLanguage: async (_value: EuLawLanguage): Promise<void> => {},
    getDefaultFiLawLanguage: () => "fi" as const,
    setDefaultFiLawLanguage: async (_value: "fi" | "sv"): Promise<void> => {},
    getInputLayout: () => inputLayout,
    getShowInsertedSourceMetadata: () => true,
    setShowInsertedSourceMetadata: async (_value: boolean): Promise<void> => {},
  };
  const indexProvider: LawLookupModalIndexProvider = { getEuActIndex: () => index };
  const modal = new LawLookupModal(
    {} as App,
    providerRegistry as unknown as ProviderRegistry,
    settingsStore,
    ui,
    indexProvider,
    discoveryProvider,
  );
  modal.onOpen();
  const contentEl = (modal as unknown as { contentEl: FakeElement }).contentEl;
  const formEl = contentEl.children[1];
  const inputEl = formEl.children.find((child) => child.tag === "input") as FakeElement;
  const jurisdictionSelect = formEl.children.find((child) => child.tag === "select") as FakeElement;
  jurisdictionSelect.value = "EU";
  jurisdictionSelect.fire("change");
  return { requests, inputEl, jurisdictionSelect, modal, lastRequest: () => requests[requests.length - 1] };
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
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

function resultMessageText(harness: ModalHarness): string {
  const resultEl = (harness.modal as unknown as { resultEl: FakeElement }).resultEl;
  return resultEl.children.map((child) => child.text).join(" ");
}

function jurisdictionOptionValues(harness: ModalHarness): string[] {
  return harness.jurisdictionSelect.children.map((option) => option.value);
}

describe("LawLookupModal jurisdiction selector presentation order", () => {
  it("pins EU first and sorts the remaining visible English labels", () => {
    const harness = buildModalHarness(null, undefined, null, getUiStrings("en"));

    assert.deepEqual(jurisdictionOptionValues(harness), ["EU", "AT", "FI", "DE", "IT", "NL", "ES", "CH"]);
  });

  it("reorders non-EU entries when the active UI language changes to German", () => {
    const harness = buildModalHarness(null, undefined, null, getUiStrings("de"));

    assert.deepEqual(jurisdictionOptionValues(harness), ["EU", "DE", "FI", "IT", "NL", "AT", "CH", "ES"]);
  });
});

describe("LawLookupModal EU requested language preservation", () => {
  it("exposes Finland in the jurisdiction selector", () => {
    const harness = buildModalHarness(null);
    assert.ok(
      harness.jurisdictionSelect.children.some((option) => option.value === "FI"),
      "Finland must be selectable",
    );
  });

  it("does not look up when switching to Spain with a valid BOE citation", async () => {
    const harness = buildModalHarness(null);
    harness.inputEl.value = "BOE-A-2015-10566 Art. 1";
    harness.jurisdictionSelect.value = "ES";
    harness.jurisdictionSelect.fire("change");
    await settle();
    assert.equal(harness.requests.length, 0);

    harness.inputEl.value = "BOE-A-2015-10566 Art. 1";
    harness.inputEl.fire("keydown", { key: "Enter" });
    await settle();
    assert.equal(harness.requests.length, 1);
  });

  it("does not look up when switching between existing jurisdictions with a valid citation", async () => {
    const harness = buildModalHarness(null);
    harness.jurisdictionSelect.value = "CH";
    harness.jurisdictionSelect.fire("change");
    harness.inputEl.value = "Art. 1 GG";
    harness.jurisdictionSelect.value = "DE";
    harness.jurisdictionSelect.fire("change");
    await settle();
    assert.equal(harness.requests.length, 0);

    harness.inputEl.value = "Art. 1 GG";
    harness.inputEl.fire("keydown", { key: "Enter" });
    await settle();
    assert.equal(harness.requests.length, 1);
  });

  it("clears the single-field Italy citation and selection on jurisdiction change", async () => {
    const lawCode = "normattiva:2005-05-16:005G0104";
    const discoveryProvider: LawDiscoveryProvider = {
      jurisdiction: "IT",
      sourceLabel: "Normattiva",
      search: async () => ({ kind: "results", entries: [{
        jurisdiction: "IT",
        canonicalInput: lawCode,
        title: "Italian law",
        normattivaAct: {
          title: "Italian law",
          actType: "DECRETO",
          actDate: "2005-03-07",
          actNumber: 82,
          guDate: "2005-05-16",
        },
      }] }),
    };
    const harness = buildModalHarness(null, undefined, new Map([["IT", discoveryProvider]]));
    harness.jurisdictionSelect.value = "IT";
    harness.jurisdictionSelect.fire("change");
    harness.inputEl.value = "italian";
    harness.inputEl.fire("input");
    await delay(270);
    const state = harness.modal as unknown as {
      suggestionsEl: FakeElement;
      selectedLaw: { canonicalInput: string } | null;
    };
    state.suggestionsEl.children[0].fire("click");
    harness.inputEl.value = `${lawCode} Art. 20`;
    harness.jurisdictionSelect.value = "ES";
    harness.jurisdictionSelect.fire("change");
    await settle();

    assert.equal(harness.inputEl.value, "");
    assert.equal(state.selectedLaw, null);
    assert.equal(state.suggestionsEl.children.length, 0);
    assert.equal(harness.requests.length, 0);
  });

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

  it("clears a successful result and insertion action on a jurisdiction switch without requesting", async () => {
    const harness = buildModalHarness(null, async () => successfulSection);
    await runLookup(harness, GDPR_INPUT);
    const state = harness.modal as unknown as {
      currentSection: LawSection | null;
      currentMarkdown: string;
      resultEl: FakeElement;
      actionsEl: FakeElement;
    };
    assert.equal(state.currentSection?.text, "retrieved legal text");
    assert.match(state.currentMarkdown, /retrieved legal text/);
    assert.ok(state.actionsEl.children.some((child) => child.tag === "button"));
    const requestCount = harness.requests.length;

    harness.jurisdictionSelect.value = "ES";
    harness.jurisdictionSelect.fire("change");

    assert.equal(harness.requests.length, requestCount);
    assert.equal(state.currentSection, null);
    assert.equal(state.currentMarkdown, "");
    assert.equal(state.resultEl.children.length, 1);
    assert.equal(state.actionsEl.children.some((child) => child.tag === "button"), false);
  });

  it("does not publish a pending result after switching jurisdiction", async () => {
    let resolvePending!: (section: LawSection) => void;
    const pending = new Promise<LawSection>((resolve) => { resolvePending = resolve; });
    const harness = buildModalHarness(null, async () => pending);
    harness.inputEl.value = GDPR_INPUT;
    harness.inputEl.fire("keydown", { key: "Enter" });
    await settle();
    assert.equal(harness.requests.length, 1);

    harness.jurisdictionSelect.value = "ES";
    harness.jurisdictionSelect.fire("change");
    resolvePending(successfulSection);
    await settle();

    const state = harness.modal as unknown as {
      currentSection: LawSection | null;
      currentMarkdown: string;
      resultEl: FakeElement;
      actionsEl: FakeElement;
    };
    assert.equal(state.currentSection, null);
    assert.equal(state.currentMarkdown, "");
    assert.equal(state.resultEl.children.length, 1);
    assert.equal(state.actionsEl.children.some((child) => child.tag === "button"), false);
    assert.equal(harness.requests.length, 1);
  });

  it("clears Spain results when switching to an existing jurisdiction", async () => {
    const harness = buildModalHarness(null, async () => ({ ...successfulSection, jurisdiction: "ES", language: "es" }));
    harness.jurisdictionSelect.value = "ES";
    harness.jurisdictionSelect.fire("change");
    await runLookup(harness, "BOE-A-2015-10566 Art. 1");
    const state = harness.modal as unknown as { currentSection: LawSection | null };
    assert.equal(state.currentSection?.jurisdiction, "ES");

    harness.jurisdictionSelect.value = "DE";
    harness.jurisdictionSelect.fire("change");
    assert.equal(state.currentSection, null);
    assert.equal(harness.requests.length, 1);
  });

  it("clears an existing-jurisdiction result when switching to Spain and allows a fresh lookup", async () => {
    const harness = buildModalHarness(null, async () => successfulSection);
    await runLookup(harness, GDPR_INPUT);
    const state = harness.modal as unknown as { currentSection: LawSection | null };
    assert.equal(state.currentSection?.jurisdiction, "EU");

    harness.jurisdictionSelect.value = "ES";
    harness.jurisdictionSelect.fire("change");
    assert.equal(state.currentSection, null);
    assert.equal(harness.requests.length, 1);

    await runLookup(harness, "BOE-A-2015-10566 Art. 1");
    assert.equal(harness.requests.length, 2);
    const sectionAfterLookup = (harness.modal as unknown as { currentSection: LawSection | null }).currentSection;
    assert.ok(sectionAfterLookup);
    assert.equal(sectionAfterLookup.jurisdiction, "EU");
  });

  it("invalidates results on jurisdiction switch in split input layout", async () => {
    const harness = buildModalHarness(null, async () => successfulSection);
    assert.equal(harness.modal.setInputLayout("split"), true);
    harness.jurisdictionSelect.value = "ES";
    harness.jurisdictionSelect.fire("change");
    const split = harness.modal as unknown as { lawInputEl: FakeElement; referenceInputEl: FakeElement; currentSection: LawSection | null };
    split.lawInputEl.value = "BOE-A-2015-10566";
    split.referenceInputEl.value = "Art. 1";
    split.referenceInputEl.fire("keydown", { key: "Enter" });
    await settle();
    assert.equal(split.currentSection?.text, "retrieved legal text");

    harness.jurisdictionSelect.value = "DE";
    harness.jurisdictionSelect.fire("change");
    assert.equal(split.currentSection, null);
    assert.equal(split.lawInputEl.value, "");
    assert.equal(split.referenceInputEl.value, "");
    assert.equal(harness.requests.length, 1);
  });
});

describe("LawLookupModal FI discovery and explicit lookup", () => {
  it("debounces Finlex discovery, selects a law without lookup, and carries fi/sv explicitly", async () => {
    let discoveryCalls = 0;
    const discoveryProvider: LawDiscoveryProvider = {
      jurisdiction: "FI",
      sourceLabel: "Finlex",
      search: async () => {
        discoveryCalls += 1;
        return {
          kind: "results",
          entries: Array.from({ length: 9 }, (_, index) => ({
            jurisdiction: "FI" as const,
            canonicalInput: index === 0 ? "729/2018" : `${730 + index}/2018`,
            title: index === 0 ? "Tieliikennelaki" : `Tieliikennelaki ${index}`,
          })),
        };
      },
    };
    const harness = buildModalHarness(
      null,
      async (reference) => ({ ...successfulSection, jurisdiction: "FI", language: reference.language, lawCode: reference.lawCode, section: reference.section }),
      new Map([["FI", discoveryProvider]]),
    );

    harness.jurisdictionSelect.value = "FI";
    harness.jurisdictionSelect.fire("change");
    assert.equal(discoveryCalls, 0);
    harness.inputEl.value = "T";
    harness.inputEl.fire("input");
    await delay(100);
    assert.equal(discoveryCalls, 0);
    harness.inputEl.value = "Tieliikennelaki";
    harness.inputEl.fire("input");
    await delay(100);
    assert.equal(discoveryCalls, 0);
    await delay(180);
    assert.equal(discoveryCalls, 1);

    const state = harness.modal as unknown as { suggestionsEl: FakeElement; selectedLaw: { canonicalInput: string } | null; selectedLawStatusEl: FakeElement };
    assert.equal(state.suggestionsEl.children.length, 8);
    state.suggestionsEl.children[0].fire("click");
    assert.equal(state.selectedLaw?.canonicalInput, "729/2018");
    assert.match(state.selectedLawStatusEl.text, /Tieliikennelaki/);
    assert.equal(harness.requests.length, 0);

    harness.inputEl.value = "729/2018 § 1";
    harness.inputEl.fire("input");
    harness.inputEl.fire("keydown", { key: "Enter" });
    await settle();
    assert.equal(harness.lastRequest().language, "fin");
    assert.equal(harness.lastRequest().lawCode, "729/2018");
    assert.equal(harness.lastRequest().section, "1");
    assert.equal(harness.lastRequest().jurisdiction, "FI");
    assert.equal(harness.lastRequest().referenceType, "section");

    await languageDropdown().select("sv");
    assert.equal(harness.requests.length, 1);
    assert.equal(state.selectedLaw?.canonicalInput, "729/2018");
    harness.inputEl.fire("keydown", { key: "Enter" });
    await settle();
    assert.equal(harness.requests.length, 2);
    assert.equal(harness.lastRequest().language, "swe");
    assert.equal(harness.lastRequest().lawCode, "729/2018");
  });

  it("ignores a stale FI query result", async () => {
    const resolvers: Array<(result: Awaited<ReturnType<LawDiscoveryProvider["search"]>>) => void> = [];
    const discoveryProvider: LawDiscoveryProvider = {
      jurisdiction: "FI", sourceLabel: "Finlex",
      search: async () => new Promise((resolve) => { resolvers.push(resolve); }),
    };
    const harness = buildModalHarness(null, undefined, new Map([["FI", discoveryProvider]]));
    harness.jurisdictionSelect.value = "FI"; harness.jurisdictionSelect.fire("change");
    harness.inputEl.value = "old query"; harness.inputEl.fire("input"); await delay(270);
    harness.inputEl.value = "new query"; harness.inputEl.fire("input"); await delay(270);
    assert.equal(resolvers.length, 2);
    resolvers[0]({ kind: "results", entries: [{ jurisdiction: "FI", canonicalInput: "729/2018", title: "Old query law" }] });
    await settle();
    const state = harness.modal as unknown as { suggestionsEl: FakeElement };
    assert.equal(state.suggestionsEl.children.some((child) => child.text.includes("Old query law")), false);
    resolvers[1]({ kind: "results", entries: [{ jurisdiction: "FI", canonicalInput: "731/1999", title: "New query law" }] });
    await settle();
    assert.equal(state.suggestionsEl.children[0]?.text, "New query law (731/1999)");
  });

  it("ignores a stale FI discovery result after switching jurisdiction", async () => {
    let resolveDiscovery!: (result: Awaited<ReturnType<LawDiscoveryProvider["search"]>>) => void;
    const discoveryProvider: LawDiscoveryProvider = {
      jurisdiction: "FI", sourceLabel: "Finlex",
      search: async () => new Promise((resolve) => { resolveDiscovery = resolve; }),
    };
    const harness = buildModalHarness(null, undefined, new Map([["FI", discoveryProvider]]));
    harness.jurisdictionSelect.value = "FI"; harness.jurisdictionSelect.fire("change");
    harness.inputEl.value = "finland"; harness.inputEl.fire("input"); await delay(270);
    harness.jurisdictionSelect.value = "DE"; harness.jurisdictionSelect.fire("change");
    resolveDiscovery({ kind: "results", entries: [{ jurisdiction: "FI", canonicalInput: "729/2018", title: "Stale Finland" }] });
    await settle();
    const state = harness.modal as unknown as { suggestionsEl: FakeElement };
    assert.equal(state.suggestionsEl.children.some((child) => child.text.includes("Stale Finland")), false);
  });

  it("renders FI no-results, malformed, and unavailable discovery states with Finlex labels", async () => {
    const cases: Array<[string, unknown, string]> = [
      ["no-results", { kind: "no-results", entries: [] }, "no-results"],
      ["malformed", new LawDiscoveryMalformedResponseError("bad response"), "malformed"],
      ["unavailable", new Error("offline"), "unavailable"],
    ];
    for (const [_name, outcome, status] of cases) {
      const discoveryProvider: LawDiscoveryProvider = {
        jurisdiction: "FI", sourceLabel: "Finlex",
        search: async () => {
          if (outcome instanceof Error) throw outcome;
          return outcome as Awaited<ReturnType<LawDiscoveryProvider["search"]>>;
        },
      };
      const harness = buildModalHarness(null, undefined, new Map([["FI", discoveryProvider]]));
      harness.jurisdictionSelect.value = "FI"; harness.jurisdictionSelect.fire("change");
      harness.inputEl.value = "finland"; harness.inputEl.fire("input"); await delay(270); await settle();
      const state = harness.modal as unknown as { suggestionsEl: FakeElement };
      const statusEl = state.suggestionsEl.children[0];
      assert.equal(statusEl?.getAttribute("data-discovery-status"), status);
      assert.match(statusEl?.text ?? "", /Finlex/);
      harness.modal.onClose();
    }
  });
});

describe("LawLookupModal IT discovery and selection boundary", () => {
  for (const [label, error, expected, forbidden] of [
    ["not found", new LawSectionNotFoundError({ lawCode: "normattiva:test", section: "20" } as LawReference), "not found", ["unavailable", "verified"]],
    ["provider unavailable", new LawProviderUnavailableError("normattiva", "offline"), "unavailable", ["not found", "verified"]],
    ["source contract failure", new NormattivaSourceContractError('{"raw":"secret"}'), "could not be verified", ["not found", "unavailable", "secret"]],
  ] as const) {
    it(`renders a distinct Italy ${label} error state`, async () => {
      const harness = buildModalHarness(null, async () => { throw error; });
      harness.jurisdictionSelect.value = "IT";
      harness.jurisdictionSelect.fire("change");
      harness.inputEl.value = "normattiva:2005-05-16:005G0104 Art. 20";
      harness.inputEl.fire("keydown", { key: "Enter" });
      await settle();

      const message = resultMessageText(harness);
      assert.match(message, new RegExp(expected, "iu"));
      for (const fragment of forbidden) assert.doesNotMatch(message, new RegExp(fragment, "iu"));
    });
  }

  it("carries an actual malformed Normattiva HTTP-200 response into source-verification UI", async () => {
    const lawCode = "normattiva:2005-05-16:005G0104";
    const discoveryProvider: LawDiscoveryProvider = {
      jurisdiction: "IT",
      sourceLabel: "Normattiva",
      search: async () => ({ kind: "results", entries: [{
        jurisdiction: "IT",
        canonicalInput: lawCode,
        title: "DECRETO LEGISLATIVO 7 marzo 2005, n. 82",
        normattivaAct: {
          title: "DECRETO LEGISLATIVO 7 marzo 2005, n. 82",
          actType: "DECRETO LEGISLATIVO",
          actDate: "2005-03-07",
          actNumber: 82,
          guDate: "2005-05-16",
        },
      }] }),
    };
    let transportCalls = 0;
    const provider = new NormattivaLawProvider(
      "https://example.invalid",
      async () => {
        transportCalls += 1;
        return { ok: true, status: 200, text: async () => "{}", json: async () => ({}) };
      },
      () => "2026-09-12",
    );
    const harness = buildModalHarness(
      null,
      async (reference) => {
        try {
          return await provider.getSection(reference);
        } catch (error) {
          assert.equal(error instanceof NormattivaSourceContractError, true);
          assert.equal(error instanceof LawProviderUnavailableError, false);
          throw error;
        }
      },
      new Map([["IT", discoveryProvider]]),
    );

    harness.jurisdictionSelect.value = "IT";
    harness.jurisdictionSelect.fire("change");
    harness.inputEl.value = "decreto";
    harness.inputEl.fire("input");
    await delay(270);
    const state = harness.modal as unknown as { suggestionsEl: FakeElement };
    state.suggestionsEl.children[0].fire("click");
    harness.inputEl.value = `${lawCode} Art. 20`;
    harness.inputEl.fire("keydown", { key: "Enter" });
    await settle();

    assert.equal(transportCalls, 1);
    const message = resultMessageText(harness);
    assert.match(message, /could not be verified/iu);
    assert.doesNotMatch(message, /temporarily unavailable|not found|raw|secret|\{\}/iu);
  });

  it("exposes Italy, discovers Normattiva laws, and selects without looking up text", async () => {
    let discoveryCalls = 0;
    const discoveryProvider: LawDiscoveryProvider = {
      jurisdiction: "IT",
      sourceLabel: "Normattiva",
      search: async () => {
        discoveryCalls += 1;
        return {
          kind: "results",
          entries: Array.from({ length: 9 }, (_, index) => ({
            jurisdiction: "IT" as const,
            canonicalInput: `normattiva:2005-05-16:005G010${4 + index}`,
            title: index === 0 ? "DECRETO LEGISLATIVO 7 marzo 2005, n. 82" : `DECRETO LEGISLATIVO ${index}`,
            normattivaAct: {
              title: index === 0 ? "DECRETO LEGISLATIVO 7 marzo 2005, n. 82" : `DECRETO LEGISLATIVO ${index}`,
              actType: "DECRETO LEGISLATIVO",
              actDate: "2005-03-07",
              actNumber: 82 + index,
              guDate: "2005-05-16",
            },
          })),
        };
      },
    };
    const harness = buildModalHarness(null, undefined, new Map([["IT", discoveryProvider]]));

    assert.ok(harness.jurisdictionSelect.children.some((option) => option.value === "IT"));
    harness.jurisdictionSelect.value = "IT";
    harness.jurisdictionSelect.fire("change");
    harness.inputEl.value = "decreto";
    harness.inputEl.fire("input");
    await delay(270);
    await settle();

    assert.equal(discoveryCalls, 1);
    const state = harness.modal as unknown as {
      suggestionsEl: FakeElement;
      selectedLaw: { canonicalInput: string; title: string } | null;
      selectedLawStatusEl: FakeElement;
    };
    assert.equal(state.suggestionsEl.children.length, 8);
    assert.match(state.suggestionsEl.children[0]?.text ?? "", /DECRETO LEGISLATIVO/);
    assert.doesNotMatch(state.suggestionsEl.children[0]?.text ?? "", /normattiva:|005G0104/iu);
    state.suggestionsEl.children[0].fire("click");
    assert.match(harness.inputEl.value, /DECRETO LEGISLATIVO/);
    assert.ok(state.selectedLaw?.canonicalInput?.startsWith("normattiva:"));
    assert.match(state.selectedLawStatusEl.text, /DECRETO LEGISLATIVO/);
    assert.doesNotMatch(state.selectedLawStatusEl.text, /normattiva:2005-05-16:005G0104/);
    assert.equal(harness.requests.length, 0);
  });

  it("composes a split-field Italy lookup from the selected canonical identity", async () => {
    const lawCode = "normattiva:2005-05-16:005G0104";
    const title = "Codice dell'amministrazione digitale.";
    const discoveryProvider: LawDiscoveryProvider = {
      jurisdiction: "IT", sourceLabel: "Normattiva",
      search: async (query) => {
        assert.equal(query, "Codice dell'amministrazione digitale");
        return { kind: "results", entries: [{
          jurisdiction: "IT", canonicalInput: lawCode, title,
          normattivaAct: { title, actType: "DECRETO", actDate: "2005-03-07", actNumber: 82, guDate: "2005-05-16" },
        }] };
      },
    };
    const harness = buildModalHarness(
      null,
      async (reference) => ({
        ...successfulSection,
        jurisdiction: reference.jurisdiction,
        language: reference.language,
        lawCode: reference.lawCode,
        section: reference.section,
      }),
      new Map([["IT", discoveryProvider]]),
      getUiStrings("de"),
      "split",
    );
    const state = harness.modal as unknown as {
      formEl: FakeElement;
      lawInputEl: FakeElement;
      referenceInputEl: FakeElement;
      suggestionsEl: FakeElement;
      selectedLaw: { canonicalInput: string } | null;
    };

    harness.jurisdictionSelect.value = "IT";
    harness.jurisdictionSelect.fire("change");
    state.lawInputEl.value = "Codice dell'amministrazione digitale";
    state.lawInputEl.fire("input");
    await delay(270);
    await settle();

    assert.equal(state.suggestionsEl.children.length, 1);
    state.suggestionsEl.children[0].fire("click");
    assert.equal(state.lawInputEl.value, title);
    assert.equal(state.selectedLaw?.canonicalInput, lawCode);
    assert.equal(harness.requests.length, 0);

    // The runtime can retain a valid selected identity while the presentation
    // string differs from the metadata title punctuation.
    state.lawInputEl.value = "Codice dell'amministrazione digitale";
    state.referenceInputEl.value = "Art. 20";
    state.referenceInputEl.fire("input");
    const lookupButton = state.formEl.children.find((child) => child.tag === "button");
    assert.ok(lookupButton);
    lookupButton.fire("click");
    await settle();

    assert.equal(harness.requests.length, 1);
    assert.deepEqual(harness.lastRequest(), {
      euCelex: undefined,
      language: "it",
      lawCode,
      section: "20",
      jurisdiction: "IT",
      referenceType: "article",
    });
  });

  it("performs exactly one Italian article lookup only after explicit action", async () => {
    const lawCode = "normattiva:2005-05-16:005G0104";
    const discoveryProvider: LawDiscoveryProvider = {
      jurisdiction: "IT", sourceLabel: "Normattiva",
      search: async () => ({ kind: "results", entries: [{
        jurisdiction: "IT", canonicalInput: lawCode, title: "DECRETO LEGISLATIVO 7 marzo 2005, n. 82",
        normattivaAct: { title: "DECRETO LEGISLATIVO 7 marzo 2005, n. 82", actType: "DECRETO LEGISLATIVO", actDate: "2005-03-07", actNumber: 82, guDate: "2005-05-16" },
      }] }),
    };
    const harness = buildModalHarness(
      null,
      async (reference) => ({
        ...successfulSection,
        jurisdiction: "IT",
        language: reference.language,
        lawCode: reference.lawCode,
        lawTitle: "DECRETO LEGISLATIVO 7 marzo 2005, n. 82",
        section: reference.section,
      }),
      new Map([["IT", discoveryProvider]]),
    );
    harness.jurisdictionSelect.value = "IT";
    harness.jurisdictionSelect.fire("change");
    harness.inputEl.value = "decreto";
    harness.inputEl.fire("input");
    await delay(270);
    const state = harness.modal as unknown as { suggestionsEl: FakeElement; selectedLawStatusEl: FakeElement };
    state.suggestionsEl.children[0].fire("click");
    assert.equal(harness.requests.length, 0);

    harness.inputEl.value = "DECRETO LEGISLATIVO 7 marzo 2005, n. 82 Art. 20";
    harness.inputEl.fire("input");
    harness.inputEl.fire("keydown", { key: "Enter" });
    await settle();
    assert.equal(harness.requests.length, 1);
    assert.deepEqual(harness.lastRequest(), { euCelex: undefined, language: "it", lawCode, section: "20", jurisdiction: "IT", referenceType: "article" });
    assert.equal(harness.inputEl.value, "DECRETO LEGISLATIVO 7 marzo 2005, n. 82 Art. 20");
    assert.match(state.selectedLawStatusEl.text, /DECRETO LEGISLATIVO/);
    const result = harness.modal as unknown as { resultEl: FakeElement };
    const previewTitle = result.resultEl.children.find((child) => child.hasClass("de-law-lookup-preview-title"));
    assert.match(previewTitle?.text ?? "", /Art\. 20 DECRETO LEGISLATIVO 7 marzo 2005, n\. 82/);
    assert.doesNotMatch(previewTitle?.text ?? "", /normattiva:/);
    assert.match(result.resultEl.children.find((child) => child.hasClass("de-law-source-status-notice"))?.text ?? "", /Normattiva is an official public source/);
  });

  it("invalidates the hidden Italy identity on edit and uses only a newly selected law", async () => {
    const lawCode = "normattiva:2005-05-16:005G0104";
    const newLawCode = "normattiva:1942-04-04:042U0262";
    const discoveryProvider: LawDiscoveryProvider = {
      jurisdiction: "IT", sourceLabel: "Normattiva",
      search: async (query) => query.includes("civile")
        ? ({ kind: "results", entries: [{
          jurisdiction: "IT", canonicalInput: newLawCode, title: "Codice civile - REGIO DECRETO 16 marzo 1942, n. 262",
          normattivaAct: { title: "Codice civile - REGIO DECRETO 16 marzo 1942, n. 262", actType: "REGIO DECRETO", actDate: "1942-03-16", actNumber: 262, guDate: "1942-04-04" },
        }] })
        : ({ kind: "results", entries: [{
          jurisdiction: "IT", canonicalInput: lawCode, title: "Codice dell'amministrazione digitale",
          normattivaAct: { title: "Codice dell'amministrazione digitale", actType: "DECRETO", actDate: "2005-03-07", actNumber: 82, guDate: "2005-05-16" },
        }] }),
    };
    const harness = buildModalHarness(null, async (reference) => ({
      ...successfulSection,
      jurisdiction: reference.jurisdiction,
      language: reference.language,
      lawCode: reference.lawCode,
      section: reference.section,
    }), new Map([["IT", discoveryProvider]]));
    harness.jurisdictionSelect.value = "IT"; harness.jurisdictionSelect.fire("change");
    harness.inputEl.value = "codice"; harness.inputEl.fire("input"); await delay(270);
    const state = harness.modal as unknown as { suggestionsEl: FakeElement; selectedLaw: { canonicalInput: string } | null };
    state.suggestionsEl.children[0].fire("click");
    assert.deepEqual((state.selectedLaw as { canonicalInput: string }).canonicalInput, lawCode);

    harness.inputEl.value = "A different law";
    harness.inputEl.fire("input");
    assert.equal(state.selectedLaw, null);
    harness.inputEl.value = "Codice dell'amministrazione digitale Art. 20";
    harness.inputEl.fire("keydown", { key: "Enter" });
    await settle();
    assert.equal(harness.requests.length, 0);
    assert.equal(harness.requests.some((request) => request.lawCode === lawCode), false);

    harness.inputEl.value = "civile";
    harness.inputEl.fire("input");
    await delay(270);
    state.suggestionsEl.children[0].fire("click");
    const reselection = (harness.modal as unknown as { selectedLaw: { canonicalInput: string } | null }).selectedLaw;
    assert.equal(reselection?.canonicalInput, newLawCode);

    harness.inputEl.value = "Codice civile - REGIO DECRETO 16 marzo 1942, n. 262 Art. 1";
    harness.inputEl.fire("input");
    harness.inputEl.fire("keydown", { key: "Enter" });
    await settle();

    assert.equal(harness.requests.length, 1);
    assert.equal(harness.lastRequest().lawCode, newLawCode);
    assert.equal(harness.requests.some((request) => request.lawCode === lawCode), false);
  });

  it("does not look up unsupported Italian article forms", async () => {
    const lawCode = "normattiva:2005-05-16:005G0104";
    const discoveryProvider: LawDiscoveryProvider = {
      jurisdiction: "IT", sourceLabel: "Normattiva",
      search: async () => ({ kind: "results", entries: [{
        jurisdiction: "IT", canonicalInput: lawCode, title: "Italian law",
        normattivaAct: { title: "Italian law", actType: "DECRETO", actDate: "2005-03-07", actNumber: 82, guDate: "2005-05-16" },
      }] }),
    };
    const harness = buildModalHarness(null, undefined, new Map([["IT", discoveryProvider]]));
    harness.jurisdictionSelect.value = "IT"; harness.jurisdictionSelect.fire("change");
    harness.inputEl.value = "italian"; harness.inputEl.fire("input"); await delay(270);
    const state = harness.modal as unknown as { suggestionsEl: FakeElement };
    state.suggestionsEl.children[0].fire("click");
    harness.inputEl.value = `${lawCode} Art. 13-bis`;
    harness.inputEl.fire("keydown", { key: "Enter" });
    await settle();
    assert.equal(harness.requests.length, 0);
  });

  it("suppresses stale Italy results and clears selection when jurisdiction changes", async () => {
    const resolvers: Array<(result: Awaited<ReturnType<LawDiscoveryProvider["search"]>>) => void> = [];
    const discoveryProvider: LawDiscoveryProvider = {
      jurisdiction: "IT", sourceLabel: "Normattiva",
      search: async () => new Promise((resolve) => { resolvers.push(resolve); }),
    };
    const harness = buildModalHarness(null, undefined, new Map([["IT", discoveryProvider]]));
    harness.jurisdictionSelect.value = "IT"; harness.jurisdictionSelect.fire("change");
    harness.inputEl.value = "old italy"; harness.inputEl.fire("input"); await delay(270);
    harness.inputEl.value = "new italy"; harness.inputEl.fire("input"); await delay(270);
    resolvers[1]({ kind: "results", entries: [{ jurisdiction: "IT", canonicalInput: "normattiva:2005-05-16:005G0104", title: "New Italy" }] });
    await settle();
    resolvers[0]({ kind: "results", entries: [{ jurisdiction: "IT", canonicalInput: "normattiva:2005-05-16:005G0105", title: "Old Italy" }] });
    await settle();
    const state = harness.modal as unknown as { suggestionsEl: FakeElement };
    assert.equal(state.suggestionsEl.children[0]?.text, "New Italy");

    state.suggestionsEl.children[0].fire("click");
    harness.jurisdictionSelect.value = "ES"; harness.jurisdictionSelect.fire("change");
    const selectedState = harness.modal as unknown as { selectedLaw: unknown; suggestionsEl: FakeElement };
    assert.equal(selectedState.selectedLaw, null);
    assert.equal(selectedState.suggestionsEl.children.some((child) => child.text.includes("Italy")), false);
  });

  it("ignores a late Italy discovery response after switching jurisdiction", async () => {
    let resolveItaly!: (result: Awaited<ReturnType<LawDiscoveryProvider["search"]>>) => void;
    const italyProvider: LawDiscoveryProvider = {
      jurisdiction: "IT", sourceLabel: "Normattiva",
      search: async () => new Promise((resolve) => { resolveItaly = resolve; }),
    };
    const harness = buildModalHarness(null, undefined, new Map([["IT", italyProvider]]));
    harness.jurisdictionSelect.value = "IT";
    harness.jurisdictionSelect.fire("change");
    harness.inputEl.value = "italy";
    harness.inputEl.fire("input");
    await delay(270);

    harness.jurisdictionSelect.value = "ES";
    harness.jurisdictionSelect.fire("change");
    assert.equal(harness.jurisdictionSelect.value, "ES");

    resolveItaly({ kind: "results", entries: [{ jurisdiction: "IT", canonicalInput: "normattiva:2005-05-16:005G0104", title: "Italy" }] });
    await settle();

    const state = harness.modal as unknown as { suggestionsEl: FakeElement; selectedLaw: unknown };
    assert.equal(state.suggestionsEl.children.some((child) => child.text.includes("Italy")), false);
    assert.equal(state.selectedLaw, null);
    assert.equal(harness.requests.length, 0);
  });

  it("preserves the selected Italy identity when UI language changes and does not look up", async () => {
    const lawCode = "normattiva:2005-05-16:005G0104";
    const discoveryProvider: LawDiscoveryProvider = {
      jurisdiction: "IT", sourceLabel: "Normattiva",
      search: async () => ({ kind: "results", entries: [{
        jurisdiction: "IT", canonicalInput: lawCode, title: "Italian law",
        normattivaAct: { title: "Italian law", actType: "DECRETO", actDate: "2005-03-07", actNumber: 82, guDate: "2005-05-16" },
      }] }),
    };
    const harness = buildModalHarness(null, undefined, new Map([["IT", discoveryProvider]]));
    harness.jurisdictionSelect.value = "IT";
    harness.jurisdictionSelect.fire("change");
    harness.inputEl.value = "Italian";
    harness.inputEl.fire("input");
    await delay(270);
    const state = harness.modal as unknown as { suggestionsEl: FakeElement; selectedLaw: { canonicalInput: string; jurisdiction: string } | null; ui: UiStrings; renderActions(): void };
    state.suggestionsEl.children[0].fire("click");
    const selectedIdentity = state.selectedLaw?.canonicalInput;
    assert.equal(selectedIdentity, lawCode);

    Object.assign(state.ui, getUiStrings("de"));
    state.renderActions();
    await settle();

    assert.equal(state.selectedLaw?.canonicalInput, selectedIdentity);
    assert.equal(state.selectedLaw?.jurisdiction, "IT");
    assert.equal(harness.requests.length, 0);
  });

  it("renders Normattiva discovery failure states without a raw response", async () => {
    for (const [outcome, status] of [
      [{ kind: "no-results", entries: [] }, "no-results"],
      [new Error("offline"), "unavailable"],
      [new LawDiscoveryMalformedResponseError("bad response"), "malformed"],
    ] as const) {
      const discoveryProvider: LawDiscoveryProvider = {
        jurisdiction: "IT", sourceLabel: "Normattiva",
        search: async () => { if (outcome instanceof Error) throw outcome; return { ...outcome, entries: [...outcome.entries] }; },
      };
      const harness = buildModalHarness(null, undefined, new Map([["IT", discoveryProvider]]));
      harness.jurisdictionSelect.value = "IT"; harness.jurisdictionSelect.fire("change");
      harness.inputEl.value = "italy"; harness.inputEl.fire("input"); await delay(270); await settle();
      const state = harness.modal as unknown as { suggestionsEl: FakeElement };
      assert.equal(state.suggestionsEl.children[0]?.getAttribute("data-discovery-status"), status);
      assert.match(state.suggestionsEl.children[0]?.text ?? "", /Normattiva/);
      harness.modal.onClose();
    }
  });

  it("localizes Italy discovery statuses and loading labels", async () => {
    const source = readFileSync(resolve(process.cwd(), "src/ui/LawLookupModal.ts"), "utf8");
    assert.doesNotMatch(source, /no matching laws|discovery source unavailable|discovery response invalid|Loading law suggestions|Loading law text/u);

    for (const [outcome, status] of [
      [{ kind: "no-results", entries: [] }, "no-results"],
      [new Error("offline"), "unavailable"],
      [new LawDiscoveryMalformedResponseError("bad response"), "malformed"],
    ] as const) {
      const discoveryProvider: LawDiscoveryProvider = {
        jurisdiction: "IT", sourceLabel: "Normattiva",
        search: async () => { if (outcome instanceof Error) throw outcome; return { ...outcome, entries: [...outcome.entries] }; },
      };
      const harness = buildModalHarness(null, undefined, new Map([["IT", discoveryProvider]]), getUiStrings("de"));
      harness.jurisdictionSelect.value = "IT";
      harness.jurisdictionSelect.fire("change");
      harness.inputEl.value = "italy";
      harness.inputEl.fire("input");
      await delay(270);
      await settle();
      const state = harness.modal as unknown as { suggestionsEl: FakeElement };
      assert.equal(state.suggestionsEl.children[0]?.getAttribute("data-discovery-status"), status);
      assert.match(state.suggestionsEl.children[0]?.text ?? "", /Normattiva/);
      assert.doesNotMatch(state.suggestionsEl.children[0]?.text ?? "", /no matching laws|discovery source unavailable|discovery response invalid/u);
      harness.modal.onClose();
    }
  });
});

describe("LawLookupModal NL discovery and explicit selection boundary", () => {
  it("displays the human Dutch title, preserves BWBR identity, and does not look up on selection", async () => {
    const discoveryProvider: LawDiscoveryProvider = {
      jurisdiction: "NL",
      sourceLabel: "BWB / Wetten.nl",
      search: async () => ({ kind: "results", entries: [{
        jurisdiction: "NL",
        canonicalInput: "BWBR0005537",
        title: "Algemene wet bestuursrecht",
      }] }),
    };
    const harness = buildModalHarness(
      null,
      async () => ({ ...successfulSection, jurisdiction: "NL", language: "nl" }),
      new Map([["NL", discoveryProvider]]),
    );
    harness.jurisdictionSelect.value = "NL";
    harness.jurisdictionSelect.fire("change");
    harness.inputEl.value = "Algemene";
    harness.inputEl.fire("input");
    await delay(270);
    await settle();

    const state = harness.modal as unknown as {
      suggestionsEl: FakeElement;
      selectedLaw: { jurisdiction: string; canonicalInput: string; title: string; matchKind: string } | null;
      selectedLawStatusEl: FakeElement;
    };
    state.suggestionsEl.children[0].fire("click");

    assert.equal(harness.inputEl.value, "Algemene wet bestuursrecht ");
    assert.equal(state.selectedLaw?.jurisdiction, "NL");
    assert.equal(state.selectedLaw?.canonicalInput, "BWBR0005537");
    assert.equal(state.selectedLaw?.title, "Algemene wet bestuursrecht");
    assert.equal(state.selectedLaw?.matchKind, "title-prefix");
    assert.match(state.selectedLawStatusEl.text, /Algemene wet bestuursrecht/iu);
    assert.equal(harness.requests.length, 0);
  });

  it("composes the selected BWBR identity for an explicit Dutch Article lookup", async () => {
    const discoveryProvider: LawDiscoveryProvider = {
      jurisdiction: "NL", sourceLabel: "BWB / Wetten.nl",
      search: async () => ({ kind: "results", entries: [{
        jurisdiction: "NL", canonicalInput: "BWBR0005537", title: "Algemene wet bestuursrecht",
      }] }),
    };
    const harness = buildModalHarness(
      null,
      async (reference) => ({ ...successfulSection, jurisdiction: reference.jurisdiction, language: reference.language, lawCode: reference.lawCode, section: reference.section }),
      new Map([["NL", discoveryProvider]]),
    );
    harness.jurisdictionSelect.value = "NL";
    harness.jurisdictionSelect.fire("change");
    harness.inputEl.value = "Algemene";
    harness.inputEl.fire("input");
    await delay(270);
    const state = harness.modal as unknown as { suggestionsEl: FakeElement; formEl: FakeElement };
    state.suggestionsEl.children[0].fire("click");
    harness.inputEl.value = "Algemene wet bestuursrecht Art. 1:1";
    harness.inputEl.fire("input");
    const lookupButton = state.formEl.children.find((child) => child.tag === "button");
    assert.ok(lookupButton);
    lookupButton.fire("click");
    await settle();

    assert.deepEqual(harness.lastRequest(), {
      euCelex: undefined,
      language: undefined,
      lawCode: "BWBR0005537",
      section: "1:1",
      jurisdiction: "NL",
      referenceType: "article",
    });
  });

  it("clears the selected Dutch law when its visible prefix is edited", async () => {
    const discoveryProvider: LawDiscoveryProvider = {
      jurisdiction: "NL", sourceLabel: "BWB / Wetten.nl",
      search: async () => ({ kind: "results", entries: [{ jurisdiction: "NL", canonicalInput: "BWBR0005537", title: "Algemene wet bestuursrecht" }] }),
    };
    const harness = buildModalHarness(null, undefined, new Map([["NL", discoveryProvider]]));
    harness.jurisdictionSelect.value = "NL"; harness.jurisdictionSelect.fire("change");
    harness.inputEl.value = "Algemene"; harness.inputEl.fire("input"); await delay(270);
    const state = harness.modal as unknown as { suggestionsEl: FakeElement; selectedLaw: unknown };
    state.suggestionsEl.children[0].fire("click");
    harness.inputEl.value = "Andere wet "; harness.inputEl.fire("input");
    assert.equal(state.selectedLaw, null);
  });

  it("clears the selected Dutch law on jurisdiction change", async () => {
    const discoveryProvider: LawDiscoveryProvider = {
      jurisdiction: "NL", sourceLabel: "BWB / Wetten.nl",
      search: async () => ({ kind: "results", entries: [{ jurisdiction: "NL", canonicalInput: "BWBR0005537", title: "Algemene wet bestuursrecht" }] }),
    };
    const harness = buildModalHarness(null, undefined, new Map([["NL", discoveryProvider]]));
    harness.jurisdictionSelect.value = "NL"; harness.jurisdictionSelect.fire("change");
    harness.inputEl.value = "Algemene"; harness.inputEl.fire("input"); await delay(270);
    const state = harness.modal as unknown as { suggestionsEl: FakeElement; selectedLaw: unknown };
    state.suggestionsEl.children[0].fire("click");
    harness.jurisdictionSelect.value = "DE"; harness.jurisdictionSelect.fire("change");
    assert.equal(state.selectedLaw, null);
  });

  it("suppresses a stale Dutch discovery result after leaving NL", async () => {
    let resolveDiscovery!: (result: Awaited<ReturnType<LawDiscoveryProvider["search"]>>) => void;
    const discoveryProvider: LawDiscoveryProvider = {
      jurisdiction: "NL", sourceLabel: "BWB / Wetten.nl",
      search: async () => new Promise((resolve) => { resolveDiscovery = resolve; }),
    };
    const harness = buildModalHarness(null, undefined, new Map([["NL", discoveryProvider]]));
    harness.jurisdictionSelect.value = "NL"; harness.jurisdictionSelect.fire("change");
    harness.inputEl.value = "oude wet"; harness.inputEl.fire("input"); await delay(270);
    harness.jurisdictionSelect.value = "DE"; harness.jurisdictionSelect.fire("change");
    resolveDiscovery({ kind: "results", entries: [{ jurisdiction: "NL", canonicalInput: "BWBR0005537", title: "Stale Dutch law" }] });
    await settle();
    const state = harness.modal as unknown as { suggestionsEl: FakeElement };
    assert.equal(state.suggestionsEl.children.some((child) => child.text.includes("Stale Dutch law")), false);
  });

  it("does not render a language selector for NL", () => {
    const harness = buildModalHarness(null, undefined, null, getUiStrings("en"));
    FakeSetting.instances = [];
    harness.jurisdictionSelect.value = "NL";
    harness.jurisdictionSelect.fire("change");
    assert.equal(FakeSetting.instances.some((setting) => setting.dropdowns.length > 0), false);
  });

  it("ranks exact title match ahead of containing titles from discovery provider", async () => {
    const discoveryProvider: LawDiscoveryProvider = {
      jurisdiction: "NL",
      sourceLabel: "BWB / Wetten.nl",
      search: async () => ({
        kind: "results",
        entries: [
          { jurisdiction: "NL", canonicalInput: "BWBR0008120", title: "Derde tranche Algemene wet bestuursrecht" },
          { jurisdiction: "NL", canonicalInput: "BWBR0026016", title: "Vierde tranche Algemene wet bestuursrecht" },
          { jurisdiction: "NL", canonicalInput: "BWBR0005537", title: "Algemene wet bestuursrecht" },
        ],
      }),
    };
    const harness = buildModalHarness(
      null,
      async () => ({ ...successfulSection, jurisdiction: "NL", language: "nl" }),
      new Map([["NL", discoveryProvider]]),
    );
    harness.jurisdictionSelect.value = "NL";
    harness.jurisdictionSelect.fire("change");
    harness.inputEl.value = "Algemene wet bestuursrecht";
    harness.inputEl.fire("input");
    await delay(270);
    await settle();

    const state = harness.modal as unknown as { suggestionsEl: FakeElement };
    assert.equal(state.suggestionsEl.children.length, 3);
    assert.ok(
      state.suggestionsEl.children[0].text.includes("BWBR0005537"),
      `expected exact title first, got: ${state.suggestionsEl.children[0].text}`,
    );
  });

  it("ranks canonical ID match first when querying BWBR code directly", async () => {
    const discoveryProvider: LawDiscoveryProvider = {
      jurisdiction: "NL",
      sourceLabel: "BWB / Wetten.nl",
      search: async () => ({
        kind: "results",
        entries: [
          { jurisdiction: "NL", canonicalInput: "BWBR0008120", title: "Derde tranche Algemene wet bestuursrecht" },
          { jurisdiction: "NL", canonicalInput: "BWBR0026016", title: "Vierde tranche Algemene wet bestuursrecht" },
          { jurisdiction: "NL", canonicalInput: "BWBR0005537", title: "Algemene wet bestuursrecht" },
        ],
      }),
    };
    const harness = buildModalHarness(
      null,
      async () => ({ ...successfulSection, jurisdiction: "NL", language: "nl" }),
      new Map([["NL", discoveryProvider]]),
    );
    harness.jurisdictionSelect.value = "NL";
    harness.jurisdictionSelect.fire("change");
    harness.inputEl.value = "BWBR0005537";
    harness.inputEl.fire("input");
    await delay(270);
    await settle();

    const state = harness.modal as unknown as { suggestionsEl: FakeElement };
    assert.ok(state.suggestionsEl.children.length > 0, "should have suggestions");
    assert.ok(
      state.suggestionsEl.children[0].text.includes("BWBR0005537"),
      `expected canonical match first, got: ${state.suggestionsEl.children[0].text}`,
    );
  });

  it("ranks best match into top 8 even when it appears after position 8 in provider order", async () => {
    const entries = Array.from({ length: 10 }, (_, i) => ({
      jurisdiction: "NL" as const,
      canonicalInput: `BWBR${String(i).padStart(7, "0")}`,
      title: i === 8
        ? "Algemene wet bestuursrecht"
        : `Other law ${i + 1} Algemene wet bestuursrecht`,
    }));
    const discoveryProvider: LawDiscoveryProvider = {
      jurisdiction: "NL",
      sourceLabel: "BWB / Wetten.nl",
      search: async () => ({ kind: "results", entries }),
    };
    const harness = buildModalHarness(
      null,
      async () => ({ ...successfulSection, jurisdiction: "NL", language: "nl" }),
      new Map([["NL", discoveryProvider]]),
    );
    harness.jurisdictionSelect.value = "NL";
    harness.jurisdictionSelect.fire("change");
    harness.inputEl.value = "Algemene wet bestuursrecht";
    harness.inputEl.fire("input");
    await delay(270);
    await settle();

    const state = harness.modal as unknown as { suggestionsEl: FakeElement };
    assert.ok(state.suggestionsEl.children.length > 0, "should have suggestions");
    assert.ok(state.suggestionsEl.children.length <= 8, "should not exceed 8 suggestions");
    assert.ok(
      state.suggestionsEl.children[0].text.includes("BWBR0000008"),
      `expected exact match at position 9 to rank first, got: ${state.suggestionsEl.children[0].text}`,
    );
  });

  it("excludes cross-jurisdiction entries from discovery results", async () => {
    const discoveryProvider: LawDiscoveryProvider = {
      jurisdiction: "NL",
      sourceLabel: "BWB / Wetten.nl",
      search: async () => ({
        kind: "results",
        entries: [
          { jurisdiction: "NL", canonicalInput: "BWBR0005537", title: "Algemene wet bestuursrecht" },
          { jurisdiction: "DE", canonicalInput: "BBRG", title: "Bundesdatenschutzgesetz" },
        ],
      }),
    };
    const harness = buildModalHarness(
      null,
      async () => ({ ...successfulSection, jurisdiction: "NL", language: "nl" }),
      new Map([["NL", discoveryProvider]]),
    );
    harness.jurisdictionSelect.value = "NL";
    harness.jurisdictionSelect.fire("change");
    harness.inputEl.value = "Algemene";
    harness.inputEl.fire("input");
    await delay(270);
    await settle();

    const state = harness.modal as unknown as { suggestionsEl: FakeElement };
    assert.equal(state.suggestionsEl.children.length, 1);
    assert.ok(
      state.suggestionsEl.children[0].text.includes("BWBR0005537"),
      `expected only NL entry, got: ${state.suggestionsEl.children[0].text}`,
    );
    assert.equal(
      state.suggestionsEl.children.some((child) => child.text.includes("BBRG")),
      false,
      "cross-jurisdiction entry must not appear",
    );
  });

  it("contains no NL-specific ranking branch in discovery path", () => {
    const source = readFileSync(resolve(__dirname, "../../src/ui/LawLookupModal.ts"), "utf8");
    const discoveryBlock = source.substring(
      source.indexOf("loadDiscoverySuggestions"),
      source.indexOf("private renderDiscoveryLoading"),
    );
    assert.doesNotMatch(discoveryBlock, /selectedJurisdiction\s*===\s*"NL"/u);
  });
});

describe("LawLookupModal explicit lookup pending state", () => {
  it("shows a result-region spinner immediately and keeps it while retrieval is pending", async () => {
    let resolvePending!: (section: LawSection) => void;
    const pending = new Promise<LawSection>((resolve) => { resolvePending = resolve; });
    const harness = buildModalHarness(null, async () => pending);

    await runLookup(harness, GDPR_INPUT);

    assert.ok(explicitLookupSpinner(harness));
    assert.equal(lookupDomState(harness).resultEl.getAttribute("aria-busy"), "true");

    resolvePending(successfulSection);
    await settle();
    assert.equal(explicitLookupSpinner(harness), undefined);
    assert.equal(lookupDomState(harness).resultEl.getAttribute("aria-busy"), "false");
  });

  it("clears the spinner after a successful result", async () => {
    const harness = buildModalHarness(null, async () => successfulSection);
    await runLookup(harness, GDPR_INPUT);
    assert.equal(explicitLookupSpinner(harness), undefined);
  });

  it("clears the spinner after a no-result response", async () => {
    let resolveNoResult!: (section: LawSection | null) => void;
    const noResult = new Promise<LawSection | null>((resolve) => { resolveNoResult = resolve; });
    const harness = buildModalHarness(null, async () => noResult);
    harness.inputEl.value = GDPR_INPUT;
    harness.inputEl.fire("keydown", { key: "Enter" });
    await settle();
    assert.ok(explicitLookupSpinner(harness));
    resolveNoResult(null);
    await settle();
    assert.equal(explicitLookupSpinner(harness), undefined);
  });

  it("clears the spinner after provider and generic errors", async () => {
    for (const error of [new Error("provider-error"), new Error("generic-error")]) {
      let rejectLookup!: (reason: unknown) => void;
      const rejected = new Promise<LawSection>((_resolve, reject) => { rejectLookup = reject; });
      const harness = buildModalHarness(null, async () => rejected);
      harness.inputEl.value = GDPR_INPUT;
      harness.inputEl.fire("keydown", { key: "Enter" });
      await settle();
      assert.ok(explicitLookupSpinner(harness));
      rejectLookup(error);
      await settle();
      assert.equal(explicitLookupSpinner(harness), undefined);
    }
  });

  it("does not create a spinner for synchronous citation validation failure", async () => {
    const harness = buildModalHarness(null);
    await runLookup(harness, "not a citation");
    assert.equal(harness.requests.length, 0);
    assert.equal(explicitLookupSpinner(harness), undefined);
  });

  it("keeps the newer spinner and state when an older request settles", async () => {
    let resolveFirst!: (section: LawSection) => void;
    let resolveSecond!: (section: LawSection) => void;
    const first = new Promise<LawSection>((resolve) => { resolveFirst = resolve; });
    const second = new Promise<LawSection>((resolve) => { resolveSecond = resolve; });
    let call = 0;
    const harness = buildModalHarness(null, async () => (++call === 1 ? first : second));

    harness.inputEl.value = GDPR_INPUT;
    harness.inputEl.fire("keydown", { key: "Enter" });
    await settle();
    harness.inputEl.value = "32024R1689 Art. 1";
    harness.inputEl.fire("keydown", { key: "Enter" });
    await settle();
    assert.ok(explicitLookupSpinner(harness));

    resolveFirst(successfulSection);
    await settle();
    assert.ok(explicitLookupSpinner(harness));
    assert.equal((harness.modal as unknown as { currentSection: LawSection | null }).currentSection, null);

    resolveSecond({ ...successfulSection, lawCode: "32024R1689" });
    await settle();
    assert.equal(explicitLookupSpinner(harness), undefined);
    assert.equal((harness.modal as unknown as { currentSection: LawSection | null }).currentSection?.lawCode, "32024R1689");
  });

  it("clears the spinner when a pending lookup is invalidated or the modal closes", async () => {
    let resolvePending!: (section: LawSection) => void;
    const pending = new Promise<LawSection>((resolve) => { resolvePending = resolve; });
    const harness = buildModalHarness(null, async () => pending);
    await runLookup(harness, GDPR_INPUT);
    assert.ok(explicitLookupSpinner(harness));

    harness.jurisdictionSelect.value = "DE";
    harness.jurisdictionSelect.fire("change");
    assert.equal(explicitLookupSpinner(harness), undefined);

    harness.jurisdictionSelect.value = "EU";
    harness.jurisdictionSelect.fire("change");
    harness.inputEl.value = GDPR_INPUT;
    harness.inputEl.fire("keydown", { key: "Enter" });
    await settle();
    assert.ok(explicitLookupSpinner(harness));
    harness.modal.onClose();
    assert.equal(explicitLookupSpinner(harness), undefined);
    resolvePending(successfulSection);
  });
});

describe("LawLookupModal BOE discovery debounce", () => {
  it("performs one discovery after the 250 ms debounce", async () => {
    const queries: string[] = [];
    const harness = buildModalHarness(null, undefined, {
      jurisdiction: "ES",
      sourceLabel: "BOE",
      search: async (query) => {
        queries.push(query);
        return { kind: "no-results", entries: [] };
      },
    });
    harness.jurisdictionSelect.value = "ES";
    harness.jurisdictionSelect.fire("change");
    harness.inputEl.value = "ley";
    harness.inputEl.fire("input");

    await delay(300);
    assert.deepEqual(queries, ["ley"]);
    harness.modal.onClose();
  });

  it("cancels a pending discovery when the query is superseded", async () => {
    const queries: string[] = [];
    const harness = buildModalHarness(null, undefined, {
      jurisdiction: "ES",
      sourceLabel: "BOE",
      search: async (query) => {
        queries.push(query);
        return { kind: "no-results", entries: [] };
      },
    });
    harness.jurisdictionSelect.value = "ES";
    harness.jurisdictionSelect.fire("change");
    harness.inputEl.value = "old";
    harness.inputEl.fire("input");
    await delay(50);
    harness.inputEl.value = "new";
    harness.inputEl.fire("input");

    await delay(300);
    assert.deepEqual(queries, ["new"]);
    harness.modal.onClose();
  });

  it("cancels pending discovery on jurisdiction invalidation and modal close", async () => {
    const queries: string[] = [];
    const harness = buildModalHarness(null, undefined, {
      jurisdiction: "ES",
      sourceLabel: "BOE",
      search: async (query) => {
        queries.push(query);
        return { kind: "no-results", entries: [] };
      },
    });
    harness.jurisdictionSelect.value = "ES";
    harness.jurisdictionSelect.fire("change");
    harness.inputEl.value = "cancel";
    harness.inputEl.fire("input");
    harness.jurisdictionSelect.value = "DE";
    harness.jurisdictionSelect.fire("change");
    await delay(300);
    assert.deepEqual(queries, []);

    harness.jurisdictionSelect.value = "ES";
    harness.jurisdictionSelect.fire("change");
    harness.inputEl.value = "close";
    harness.inputEl.fire("input");
    harness.modal.onClose();
    await delay(300);
    assert.deepEqual(queries, []);
  });
});

describe("LawLookupModal suggestion layout contract", () => {
  it("uses content-driven button boxes for wrapped suggestions", () => {
    const styles = readFileSync(resolve(__dirname, "../../styles.css"), "utf8");
    const suggestionRule = styles.match(
      /\.de-law-lookup-suggestion\s*\{([\s\S]*?)\n\}/u,
    )?.[1] ?? "";

    assert.match(suggestionRule, /height:\s*auto\s*;/u);
    assert.match(suggestionRule, /min-height:\s*var\(--input-height\)\s*;/u);
    assert.match(suggestionRule, /line-height:\s*1\.4\s*;/u);
    assert.match(suggestionRule, /overflow-wrap:\s*anywhere\s*;/u);
    assert.match(suggestionRule, /flex:\s*0\s+0\s+auto\s*;/u);
  });

  it("applies and cleans up a scoped host class across reopen cycles", () => {
    const harness = buildModalHarness(null);
    const modalState = harness.modal as unknown as {
      modalEl: FakeElement;
    };
    const ownHost = modalState.modalEl.parentElement;
    assert.ok(ownHost);
    const unrelatedHost = new FakeModal().modalContainerEl;

    assert.equal(ownHost.hasClass("de-law-lookup-modal-container"), true);
    assert.equal(ownHost.classCount(), 1);
    assert.equal(unrelatedHost.hasClass("de-law-lookup-modal-container"), false);

    harness.modal.onClose();
    assert.equal(ownHost.hasClass("de-law-lookup-modal-container"), false);
    harness.modal.onOpen();
    assert.equal(ownHost.hasClass("de-law-lookup-modal-container"), true);
    assert.equal(ownHost.classCount(), 1);
    assert.equal(unrelatedHost.hasClass("de-law-lookup-modal-container"), false);
  });

  it("defines a scoped start-alignment contract for the modal host without :has", () => {
    const styles = readFileSync(resolve(__dirname, "../../styles.css"), "utf8");
    const hostRule = styles.match(
      /\.de-law-lookup-modal-container\s*\{([\s\S]*?)\n\}/u,
    )?.[1] ?? "";

    assert.match(hostRule, /align-items:\s*flex-start\s*;/u);
    assert.match(
      hostRule,
      /padding-block-start:\s*clamp\(\s*var\(--size-4-4\)\s*,\s*6vh\s*,\s*calc\(var\(--size-4-8\)\s*\*\s*2\)\s*\)\s*;/u,
    );
    assert.doesNotMatch(hostRule, /position\s*:\s*(?:absolute|fixed)\s*;/u);
    assert.doesNotMatch(styles, /(?:^|\n)\s*\.modal-container\s*\{/u);
    assert.doesNotMatch(styles, /:has\(/u);
  });

});

describe("LawLookupModal CH official language selection", () => {
  it("sends the selected Swiss language to Fedlex and persists it", async () => {
    FakeSetting.instances = [];
    const requests: CapturedRequest[] = [];
    let persisted: string | undefined;
    const providerRegistry = {
      getSection: async (reference: LawReference): Promise<never> => {
        requests.push({ language: reference.language });
        throw new Error("probe-provider-unavailable");
      },
    };
    const settingsStore = {
      getDefaultLawSourceVariant: () => "official-de",
      getDefaultEuLawLanguage: () => "de" as EuLawLanguage,
      setDefaultEuLawLanguage: async (_value: EuLawLanguage): Promise<void> => {},
      getDefaultChLawLanguage: () => "de" as const,
      setDefaultChLawLanguage: async (value: "de" | "fr" | "it"): Promise<void> => { persisted = value; },
      getShowInsertedSourceMetadata: () => true,
      setShowInsertedSourceMetadata: async (_value: boolean): Promise<void> => {},
    };
    const modal = new LawLookupModal(
      {} as App,
      providerRegistry as unknown as ProviderRegistry,
      settingsStore,
      getUiStrings("en"),
      { getEuActIndex: () => null },
    );
    modal.onOpen();
    const contentEl = (modal as unknown as { contentEl: FakeElement }).contentEl;
    const formEl = contentEl.children[1];
    const inputEl = formEl.children[0];
    const jurisdictionSelect = formEl.children[1];
    jurisdictionSelect.value = "CH";
    jurisdictionSelect.fire("change");
    await languageDropdown().select("fr");
    inputEl.value = "Art. 1 ZGB";
    inputEl.fire("keydown", { key: "Enter" });
    await settle();

    assert.equal(persisted, "fr");
    assert.deepEqual(requests, [{ language: "fr" }]);
  });

  it("does not attach the selected Swiss language to explicit non-CH references", async () => {
    FakeSetting.instances = [];
    const requests: CapturedRequest[] = [];
    const providerRegistry = {
      getSection: async (reference: LawReference): Promise<never> => {
        requests.push({ language: reference.language });
        throw new Error("probe-provider-unavailable");
      },
    };
    const settingsStore = {
      getDefaultLawSourceVariant: () => "official-de",
      getDefaultEuLawLanguage: () => "de" as EuLawLanguage,
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
      { getEuActIndex: () => null },
    );
    modal.onOpen();
    const contentEl = (modal as unknown as { contentEl: FakeElement }).contentEl;
    const formEl = contentEl.children[1];
    const inputEl = formEl.children[0];
    const jurisdictionSelect = formEl.children[1];
    jurisdictionSelect.value = "CH";
    jurisdictionSelect.fire("change");
    await languageDropdown().select("fr");
    inputEl.value = "AT ABGB 1295";
    inputEl.fire("keydown", { key: "Enter" });
    await settle();

    assert.deepEqual(requests, [{ language: undefined }]);

    jurisdictionSelect.value = "DE";
    jurisdictionSelect.fire("change");
    requests.length = 0;
    inputEl.value = "Art. 1 GG";
    inputEl.fire("keydown", { key: "Enter" });
    await settle();

    assert.deepEqual(requests, [{ language: undefined }]);
  });

});

describe("LawLookupModal jurisdiction-aware placeholders", () => {
  it("RED 1: split placeholders are jurisdiction-aware (DE then NL)", () => {
    const harness = buildModalHarness(null, undefined, null, getUiStrings("en"));
    assert.equal(harness.modal.setInputLayout("split"), true);
    harness.jurisdictionSelect.value = "DE";
    harness.jurisdictionSelect.fire("change");
    const split = harness.modal as unknown as { lawInputEl: FakeElement; referenceInputEl: FakeElement };
    assert.match(split.lawInputEl.attributes.placeholder ?? "", /BGB/);
    assert.match(split.referenceInputEl.attributes.placeholder ?? "", /§ 823/);

    harness.jurisdictionSelect.value = "NL";
    harness.jurisdictionSelect.fire("change");
    assert.match(split.lawInputEl.attributes.placeholder ?? "", /Algemene wet bestuursrecht/);
    assert.match(split.referenceInputEl.attributes.placeholder ?? "", /Art\. 1:1/);
    assert.doesNotMatch(split.lawInputEl.attributes.placeholder ?? "", /BGB/);
    assert.doesNotMatch(split.referenceInputEl.attributes.placeholder ?? "", /§ 823/);
  });

  it("RED 2: initial default jurisdiction NL renders correct placeholders", () => {
    const settingsStore = {
      getDefaultLawSourceVariant: () => "official-de",
      getDefaultEuLawLanguage: () => "de" as EuLawLanguage,
      setDefaultEuLawLanguage: async (_value: EuLawLanguage): Promise<void> => {},
      getDefaultJurisdiction: () => "NL" as LawJurisdiction,
      getShowInsertedSourceMetadata: () => true,
      setShowInsertedSourceMetadata: async (_value: boolean): Promise<void> => {},
      getInputLayout: () => "split" as const,
    };
    const modal = new LawLookupModal(
      {} as App,
      { getSection: async () => null } as unknown as ProviderRegistry,
      settingsStore,
      getUiStrings("en"),
      { getEuActIndex: () => null },
    );
    modal.onOpen();
    const split = modal as unknown as { lawInputEl: FakeElement; referenceInputEl: FakeElement };
    assert.match(split.lawInputEl.attributes.placeholder ?? "", /Algemene wet bestuursrecht/);
    assert.match(split.referenceInputEl.attributes.placeholder ?? "", /Art\. 1:1/);
  });

  it("RED 3: one-line example is jurisdiction-aware (NL then ES)", () => {
    const harness = buildModalHarness(null, undefined, null, getUiStrings("en"));
    harness.jurisdictionSelect.value = "NL";
    harness.jurisdictionSelect.fire("change");
    assert.match(harness.inputEl.attributes.placeholder ?? "", /Algemene wet bestuursrecht Art\. 1:1/);

    harness.jurisdictionSelect.value = "ES";
    harness.jurisdictionSelect.fire("change");
    assert.match(harness.inputEl.attributes.placeholder ?? "", /BOE-A-2015-10566 Art\. 1/);
  });

  it("RED 4: all jurisdictions return correct examples", () => {
    const cases: Array<[LawJurisdiction, string, string]> = [
      ["EU", "GDPR", "Art. 6"],
      ["DE", "BGB", "§ 823"],
      ["AT", "ABGB", "§ 1295"],
      ["CH", "OR", "Art. 41"],
      ["ES", "BOE-A-2015-10566", "Art. 1"],
      ["FI", "729/2018", "§ 1"],
      ["IT", "Codice dell'amministrazione digitale", "Art. 20"],
      ["NL", "Algemene wet bestuursrecht", "Art. 1:1"],
    ];
    for (const [jurisdiction, expectedLaw, expectedRef] of cases) {
      const harness = buildModalHarness(null, undefined, null, getUiStrings("en"));
      assert.equal(harness.modal.setInputLayout("split"), true);
      harness.jurisdictionSelect.value = jurisdiction;
      harness.jurisdictionSelect.fire("change");
      const split = harness.modal as unknown as { lawInputEl: FakeElement; referenceInputEl: FakeElement };
      assert.match(split.lawInputEl.attributes.placeholder ?? "", new RegExp(expectedLaw), `law placeholder for ${jurisdiction}`);
      assert.match(split.referenceInputEl.attributes.placeholder ?? "", new RegExp(expectedRef), `reference placeholder for ${jurisdiction}`);
    }
  });

  it("RED 5: UI language is independent of jurisdiction (German UI + NL = German prefix + Dutch example)", () => {
    const deHarness = buildModalHarness(null, undefined, null, getUiStrings("de"));
    assert.equal(deHarness.modal.setInputLayout("split"), true);
    deHarness.jurisdictionSelect.value = "NL";
    deHarness.jurisdictionSelect.fire("change");
    const deSplit = deHarness.modal as unknown as { lawInputEl: FakeElement; referenceInputEl: FakeElement };
    assert.match(deSplit.lawInputEl.attributes.placeholder ?? "", /z\. B\./);
    assert.match(deSplit.lawInputEl.attributes.placeholder ?? "", /Algemene wet bestuursrecht/);

    const enHarness = buildModalHarness(null, undefined, null, getUiStrings("en"));
    assert.equal(enHarness.modal.setInputLayout("split"), true);
    enHarness.jurisdictionSelect.value = "NL";
    enHarness.jurisdictionSelect.fire("change");
    const enSplit = enHarness.modal as unknown as { lawInputEl: FakeElement; referenceInputEl: FakeElement };
    assert.match(enSplit.lawInputEl.attributes.placeholder ?? "", /e\.g\./);
    assert.match(enSplit.lawInputEl.attributes.placeholder ?? "", /Algemene wet bestuursrecht/);

    const deDeHarness = buildModalHarness(null, undefined, null, getUiStrings("de"));
    assert.equal(deDeHarness.modal.setInputLayout("split"), true);
    deDeHarness.jurisdictionSelect.value = "DE";
    deDeHarness.jurisdictionSelect.fire("change");
    const deDeSplit = deDeHarness.modal as unknown as { lawInputEl: FakeElement; referenceInputEl: FakeElement };
    assert.match(deDeSplit.lawInputEl.attributes.placeholder ?? "", /z\. B\./);
    assert.match(deDeSplit.lawInputEl.attributes.placeholder ?? "", /BGB/);
  });

  it("RED 7: layout switch preserves correct jurisdiction examples for NL", () => {
    const harness = buildModalHarness(null, undefined, null, getUiStrings("en"));
    harness.jurisdictionSelect.value = "NL";
    harness.jurisdictionSelect.fire("change");

    assert.equal(harness.modal.setInputLayout("split"), true);
    const split = harness.modal as unknown as { lawInputEl: FakeElement; referenceInputEl: FakeElement };
    assert.match(split.lawInputEl.attributes.placeholder ?? "", /Algemene wet bestuursrecht/);
    assert.match(split.referenceInputEl.attributes.placeholder ?? "", /Art\. 1:1/);

    assert.equal(harness.modal.setInputLayout("single"), true);
    const singleModal = harness.modal as unknown as { formEl: FakeElement };
    const singleInput = singleModal.formEl.children.find((child) => child.tag === "input") as FakeElement;
    assert.match(singleInput.attributes.placeholder ?? "", /Algemene wet bestuursrecht Art\. 1:1/);

    assert.equal(harness.modal.setInputLayout("split"), true);
    const splitAgain = harness.modal as unknown as { lawInputEl: FakeElement; referenceInputEl: FakeElement };
    assert.match(splitAgain.lawInputEl.attributes.placeholder ?? "", /Algemene wet bestuursrecht/);
    assert.match(splitAgain.referenceInputEl.attributes.placeholder ?? "", /Art\. 1:1/);
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
