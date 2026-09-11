import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it } from "node:test";
import type { App } from "obsidian";
import type { EuActIndex, EuActIndexEntry } from "../src/law/euActIndex";
import type { ProviderRegistry } from "../src/law/ProviderRegistry";
import type { EuLawLanguage, LawReference, LawSection } from "../src/law/types";
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

  createEl(tag: string, options?: { text?: string; value?: string; cls?: string; attr?: Record<string, string> }): FakeElement {
    const child = new FakeElement();
    child.tag = tag;
    child.text = options?.text ?? "";
    child.value = options?.value ?? "";
    child.applyOptions(options);
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
): ModalHarness {
  FakeSetting.instances = [];
  const requests: CapturedRequest[] = [];
  const providerRegistry = {
    getSection: async (reference: LawReference): Promise<LawSection | null> => {
      requests.push({ language: reference.language, euCelex: reference.euCelex });
      return getSection(reference);
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
  return { requests, inputEl, jurisdictionSelect, modal, lastRequest: () => requests[requests.length - 1] };
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
  it("does not look up when switching to Spain with a valid BOE citation", async () => {
    const harness = buildModalHarness(null);
    harness.inputEl.value = "BOE-A-2015-10566 Art. 1";
    harness.jurisdictionSelect.value = "ES";
    harness.jurisdictionSelect.fire("change");
    await settle();
    assert.equal(harness.requests.length, 0);

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

    harness.inputEl.fire("keydown", { key: "Enter" });
    await settle();
    assert.equal(harness.requests.length, 1);
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
    assert.equal(harness.requests.length, 1);
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
