import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

type Jurisdiction = "DE" | "AT" | "CH" | "EU";
type EuDocumentType = "R" | "L" | "D";
type MatchKind = "exact-alias" | "title-prefix" | "title-contains" | "eu-technical";

interface SearchEntry {
  jurisdiction: Jurisdiction;
  canonicalInput: string;
  title: string;
  aliases?: readonly string[];
  alternateTitles?: readonly string[];
  celex?: string;
  documentType?: EuDocumentType;
  year?: string;
  number?: string;
}

interface SearchSuggestion extends SearchEntry {
  matchKind: MatchKind;
  matchedTitle?: string;
}

const { searchLawMetadata } = require("../src/law/lawMetadataSearch") as {
  searchLawMetadata(params: {
    query: string;
    jurisdiction: Jurisdiction;
    entries: readonly SearchEntry[];
    limit?: number;
  }): SearchSuggestion[];
};

const jurisdictionEntries: SearchEntry[] = [
  {
    jurisdiction: "DE",
    canonicalInput: "BDSG",
    title: "Bundesdatenschutzgesetz",
    aliases: ["BDSG"],
  },
  {
    jurisdiction: "AT",
    canonicalInput: "DSG",
    title: "Datenschutzgesetz",
    aliases: ["DSG"],
  },
  {
    jurisdiction: "CH",
    canonicalInput: "DSG",
    title: "Bundesgesetz über den Datenschutz (Datenschutzgesetz, DSG)",
    aliases: ["DSG"],
    alternateTitles: [
      "Loi fédérale sur la protection des données",
      "Legge federale sulla protezione dei dati",
    ],
  },
  {
    jurisdiction: "EU",
    canonicalInput: "32024R1689",
    title: "Regulation (EU) 2024/1689",
    aliases: ["AIACT", "AI ACT", "EU AI ACT", "KI-VO"],
    alternateTitles: [
      "Artificial Intelligence Act",
      "Verordnung über künstliche Intelligenz",
      "Règlement sur l’intelligence artificielle",
    ],
    celex: "32024R1689",
    documentType: "R",
    year: "2024",
    number: "1689",
  },
];

describe("law metadata autocomplete", () => {
  it("returns no suggestions before two trimmed characters", () => {
    assert.deepEqual(searchLawMetadata({ query: "", jurisdiction: "DE", entries: jurisdictionEntries }), []);
    assert.deepEqual(searchLawMetadata({ query: " d ", jurisdiction: "DE", entries: jurisdictionEntries }), []);
  });

  it("strictly isolates suggestions to the selected jurisdiction", () => {
    assert.deepEqual(
      searchLawMetadata({ query: "datenschutz", jurisdiction: "DE", entries: jurisdictionEntries }).map((entry) => entry.canonicalInput),
      ["BDSG"],
    );
    assert.deepEqual(
      searchLawMetadata({ query: "datenschutz", jurisdiction: "AT", entries: jurisdictionEntries }).map((entry) => entry.canonicalInput),
      ["DSG"],
    );
    assert.deepEqual(
      searchLawMetadata({ query: "datenschutz", jurisdiction: "CH", entries: jurisdictionEntries }).map((entry) => entry.canonicalInput),
      ["DSG"],
    );
    assert.deepEqual(
      searchLawMetadata({ query: "datenschutz", jurisdiction: "EU", entries: jurisdictionEntries }),
      [],
    );
  });

  it("searches all supplied EU title languages", () => {
    const english = searchLawMetadata({ query: "artificial", jurisdiction: "EU", entries: jurisdictionEntries });
    assert.equal(english[0]?.canonicalInput, "32024R1689");
    assert.equal(english[0]?.matchedTitle, "Artificial Intelligence Act");

    const german = searchLawMetadata({ query: "künstliche", jurisdiction: "EU", entries: jurisdictionEntries });
    assert.equal(german[0]?.canonicalInput, "32024R1689");
    assert.equal(german[0]?.matchedTitle, "Verordnung über künstliche Intelligenz");
  });

  it("matches curated EU aliases by prefix and contains when the production index has no titles", () => {
    const titleLessEntries: SearchEntry[] = [{
      jurisdiction: "EU",
      canonicalInput: "32024R1689",
      title: "32024R1689",
      aliases: ["AI ACT", "Artificial Intelligence Act"],
      celex: "32024R1689",
      documentType: "R",
      year: "2024",
      number: "1689",
    }];

    const prefix = searchLawMetadata({ query: "artificial", jurisdiction: "EU", entries: titleLessEntries });
    assert.equal(prefix[0]?.canonicalInput, "32024R1689");
    assert.equal(prefix[0]?.matchedTitle, "Artificial Intelligence Act");

    const contains = searchLawMetadata({ query: "intelligence", jurisdiction: "EU", entries: titleLessEntries });
    assert.equal(contains[0]?.canonicalInput, "32024R1689");
    assert.equal(contains[0]?.matchedTitle, "Artificial Intelligence Act");
  });

  it("matches compact year-number forms without title metadata", () => {
    const titleLessEntries: SearchEntry[] = [{
      jurisdiction: "EU",
      canonicalInput: "32024R1689",
      title: "32024R1689",
      celex: "32024R1689",
      documentType: "R",
      year: "2024",
      number: "1689",
    }];

    for (const query of ["2024/1689", "2024 1689", "2024-1689"]) {
      const results = searchLawMetadata({ query, jurisdiction: "EU", entries: titleLessEntries });
      assert.deepEqual(results.map((entry) => entry.canonicalInput), ["32024R1689"], query);
    }
  });

  it("matches localized document classes and German VO/RL abbreviations", () => {
    const titleLessEntries: SearchEntry[] = [
      {
        jurisdiction: "EU",
        canonicalInput: "32024R1689",
        title: "32024R1689",
        celex: "32024R1689",
        documentType: "R",
        year: "2024",
        number: "1689",
      },
      {
        jurisdiction: "EU",
        canonicalInput: "32022L2555",
        title: "32022L2555",
        celex: "32022L2555",
        documentType: "L",
        year: "2022",
        number: "2555",
      },
    ];

    for (const query of [
      "Verordnung 2024/1689",
      "Regulation 2024/1689",
      "VO 2024/1689",
      "VO 2024 1689",
      "VO 2024",
    ]) {
      const results = searchLawMetadata({ query, jurisdiction: "EU", entries: titleLessEntries });
      assert.deepEqual(results.map((entry) => entry.canonicalInput), ["32024R1689"], query);
    }

    for (const query of [
      "Richtlinie 2022/2555",
      "Directive 2022/2555",
      "RL 2022/2555",
      "RL 2022 2555",
      "RL 2022",
    ]) {
      const results = searchLawMetadata({ query, jurisdiction: "EU", entries: titleLessEntries });
      assert.deepEqual(results.map((entry) => entry.canonicalInput), ["32022L2555"], query);
    }
  });

  it("keeps year-number ambiguity fail-safe and lets VO/RL filter by document type", () => {
    const ambiguousEntries: SearchEntry[] = [
      { jurisdiction: "EU", canonicalInput: "32024R0042", title: "32024R0042", celex: "32024R0042", documentType: "R", year: "2024", number: "0042" },
      { jurisdiction: "EU", canonicalInput: "32024L0042", title: "32024L0042", celex: "32024L0042", documentType: "L", year: "2024", number: "0042" },
      { jurisdiction: "EU", canonicalInput: "32024D0042", title: "32024D0042", celex: "32024D0042", documentType: "D", year: "2024", number: "0042" },
    ];

    const generic = searchLawMetadata({ query: "2024 42", jurisdiction: "EU", entries: ambiguousEntries });
    assert.deepEqual(
      new Set(generic.map((entry) => entry.canonicalInput)),
      new Set(["32024R0042", "32024L0042", "32024D0042"]),
    );

    assert.deepEqual(
      searchLawMetadata({ query: "VO 2024 42", jurisdiction: "EU", entries: ambiguousEntries }).map((entry) => entry.canonicalInput),
      ["32024R0042"],
    );
    assert.deepEqual(
      searchLawMetadata({ query: "RL 2024 42", jurisdiction: "EU", entries: ambiguousEntries }).map((entry) => entry.canonicalInput),
      ["32024L0042"],
    );
  });

  it("ranks exact aliases before title prefixes, title contains, and EU technical identity", () => {
    const entries: SearchEntry[] = [
      { jurisdiction: "EU", canonicalInput: "ALIAS", title: "Unrelated", aliases: ["42"] },
      { jurisdiction: "EU", canonicalInput: "PREFIX", title: "42 Regulation" },
      { jurisdiction: "EU", canonicalInput: "CONTAINS", title: "Regulation number 42" },
      { jurisdiction: "EU", canonicalInput: "TECH", title: "Unrelated technical act", celex: "32024R0042", year: "2024", number: "42" },
    ];

    const results = searchLawMetadata({ query: "42", jurisdiction: "EU", entries });
    assert.deepEqual(results.map((entry) => entry.canonicalInput), ["ALIAS", "PREFIX", "CONTAINS", "TECH"]);
    assert.deepEqual(results.map((entry) => entry.matchKind), ["exact-alias", "title-prefix", "title-contains", "eu-technical"]);
  });

  it("caps results at eight suggestions by default", () => {
    const entries = Array.from({ length: 12 }, (_, index): SearchEntry => ({
      jurisdiction: "DE",
      canonicalInput: `D${index}`,
      title: `Data law ${String(index).padStart(2, "0")}`,
    }));
    assert.equal(searchLawMetadata({ query: "da", jurisdiction: "DE", entries }).length, 8);
  });

  it("does not fuzzy-match misspellings", () => {
    assert.deepEqual(
      searchLawMetadata({ query: "datnschutz", jurisdiction: "DE", entries: jurisdictionEntries }),
      [],
    );
  });
});

type Listener = (event?: { key?: string }) => void;

class FakeElement {
  parent: FakeElement | null = null;
  children: FakeElement[] = [];
  listeners: Record<string, Listener[]> = {};
  text = "";
  value = "";
  cls = "";
  tagName = "";
  attributes: Record<string, string> = {};

  createEl(tag: string, options?: { text?: string; value?: string; cls?: string; attr?: Record<string, string> }): FakeElement {
    const child = new FakeElement();
    child.tagName = tag.toUpperCase();
    child.text = options?.text ?? "";
    child.value = options?.value ?? "";
    child.cls = options?.cls ?? "";
    child.attributes = { ...options?.attr };
    child.parent = this;
    this.children.push(child);
    return child;
  }

  createDiv(options?: { text?: string; cls?: string }): FakeElement {
    const child = new FakeElement();
    child.text = options?.text ?? "";
    child.cls = options?.cls ?? "";
    child.parent = this;
    this.children.push(child);
    return child;
  }

  addClass(_cls: string): void {}
  setAttribute(name: string, value: string): void { this.attributes[name] = value; }
  insertBefore(child: FakeElement, reference: FakeElement): void {
    const currentIndex = this.children.indexOf(child);
    if (currentIndex >= 0) this.children.splice(currentIndex, 1);
    child.parent = this;
    this.children.splice(this.children.indexOf(reference), 0, child);
  }
  remove(): void {
    if (!this.parent) return;
    const index = this.parent.children.indexOf(this);
    if (index >= 0) this.parent.children.splice(index, 1);
    this.parent = null;
  }
  setText(text: string): void { this.text = text; }
  empty(): void { this.children = []; this.text = ""; }
  addEventListener(type: string, listener: Listener): void { (this.listeners[type] ??= []).push(listener); }
  fire(type: string, event?: { key?: string }): void { for (const listener of this.listeners[type] ?? []) listener(event); }
}

class FakeModal { contentEl = new FakeElement(); constructor(_app?: unknown) {} }
class FakeNotice { constructor(_message: string) {} }
class FakeMarkdownView {}

interface FakeDropdown {
  value: string;
  addOption(value: string, text: string): void;
  setValue(value: string): FakeDropdown;
  onChange(listener: (value: string) => void | Promise<void>): void;
  trigger(value: string): Promise<void>;
}

interface FakeToggle {
  value: boolean;
  setValue(value: boolean): FakeToggle;
  onChange(listener: (value: boolean) => void | Promise<void>): void;
  trigger(value: boolean): Promise<void>;
}

class FakeSetting {
  static instances: FakeSetting[] = [];
  name = "";
  dropdowns: FakeDropdown[] = [];
  toggles: FakeToggle[] = [];

  constructor(_element: FakeElement) { FakeSetting.instances.push(this); }
  setName(name: string): FakeSetting { this.name = name; return this; }
  addDropdown(configure: (dropdown: FakeDropdown) => void): FakeSetting {
    let listener: ((value: string) => void | Promise<void>) | undefined;
    const dropdown: FakeDropdown = {
      value: "",
      addOption: () => {},
      setValue: (value) => { dropdown.value = value; return dropdown; },
      onChange: (nextListener) => { listener = nextListener; },
      trigger: async (value) => { dropdown.value = value; await listener?.(value); },
    };
    this.dropdowns.push(dropdown);
    configure(dropdown);
    return this;
  }
  addToggle(configure: (toggle: FakeToggle) => void): FakeSetting {
    let listener: ((value: boolean) => void | Promise<void>) | undefined;
    const toggle: FakeToggle = {
      value: false,
      setValue: (value) => { toggle.value = value; return toggle; },
      onChange: (nextListener) => { listener = nextListener; },
      trigger: async (value) => { toggle.value = value; await listener?.(value); },
    };
    this.toggles.push(toggle);
    configure(toggle);
    return this;
  }
}

const obsidianStubPath = "/tmp/opencode/law-metadata-autocomplete-obsidian-stub.cjs";
const NodeModule = require("node:module") as typeof import("node:module");
const moduleHooks = NodeModule as unknown as {
  _resolveFilename?: (request: string, ...rest: unknown[]) => string;
  _cache: Record<string, unknown>;
};

function loadWithObsidianStub<T>(load: () => T): T {
  const originalResolveFilename = moduleHooks._resolveFilename;
  const originalStubCacheEntry = moduleHooks._cache[obsidianStubPath];
  const stubModule = new NodeModule(obsidianStubPath);
  stubModule.exports = {
    Modal: FakeModal,
    Notice: FakeNotice,
    Setting: FakeSetting,
    MarkdownView: FakeMarkdownView,
  };
  stubModule.loaded = true;
  moduleHooks._resolveFilename = function (request: string, ...rest: unknown[]) {
    if (request === "obsidian") return obsidianStubPath;
    return originalResolveFilename
      ? originalResolveFilename.call(this, request, ...rest)
      : request;
  };
  moduleHooks._cache[obsidianStubPath] = stubModule;
  try {
    return load();
  } finally {
    if (originalResolveFilename === undefined) delete moduleHooks._resolveFilename;
    else moduleHooks._resolveFilename = originalResolveFilename;
    if (originalStubCacheEntry === undefined) delete moduleHooks._cache[obsidianStubPath];
    else moduleHooks._cache[obsidianStubPath] = originalStubCacheEntry;
  }
}

const { LawLookupModal, composeSplitLookupInput, decomposeOneLineLookupInput } = loadWithObsidianStub(
  () => require("../src/ui/LawLookupModal"),
) as {
  LawLookupModal: new (...args: unknown[]) => { onOpen(): void; setInputLayout(layout: string): boolean; contentEl: FakeElement };
  composeSplitLookupInput: (law: string, reference: string) => string;
  decomposeOneLineLookupInput: (input: string, jurisdiction: Jurisdiction) => { law: string; reference: string } | null;
};

const ui = new Proxy({}, {
  get: (_target, property) => property === "selectedLawContinueWithReference"
    ? "{law} selected. Now enter {reference}."
    : property === "articleReferences"
      ? "Article references"
      : property === "sectionReferences"
        ? "Section references"
        : String(property),
}) as Record<string, string>;

function makeAutocompleteEuIndex() {
  return {
    schemaVersion: 1,
    lastSyncCheckpoint: null,
    entries: new Map([
      ["32024R1689", {
        celex: "32024R1689",
        documentType: "R",
        year: "2024",
        number: "1689",
        titlesByLanguage: {},
        availableLanguages: [
          "bul", "spa", "ces", "dan", "deu", "est", "ell", "eng",
          "fra", "gle", "hrv", "ita", "lav", "lit", "hun", "mlt",
          "nld", "pol", "por", "ron", "slk", "slv", "fin", "swe",
        ],
      }],
    ]),
  };
}

function buildAutocompleteModalHarness(
  jurisdiction: Jurisdiction,
  inputLayout = "single",
  defaultJurisdiction: Jurisdiction = "EU",
) {
  FakeSetting.instances = [];
  const requests: unknown[] = [];
  let defaultSourceVariant = "official-de";
  let persistedEuLanguage = "en";
  let persistedChLanguage = "de";
  const providerRegistry = {
    getSection: async (reference: unknown) => {
      requests.push(reference);
      throw new Error("probe-provider-unavailable");
    },
  };
  const settingsStore = {
    getDefaultLawSourceVariant: () => defaultSourceVariant,
    setDefaultLawSourceVariant: async (value: string) => { defaultSourceVariant = value; },
    getDefaultJurisdiction: () => defaultJurisdiction,
    getDefaultEuLawLanguage: () => persistedEuLanguage,
    setDefaultEuLawLanguage: async (value: string) => { persistedEuLanguage = value; },
    getDefaultChLawLanguage: () => persistedChLanguage,
    setDefaultChLawLanguage: async (value: string) => { persistedChLanguage = value; },
    getShowInsertedSourceMetadata: () => true,
    setShowInsertedSourceMetadata: async () => {},
    getInputLayout: () => inputLayout,
  };
  const indexProvider = { getEuActIndex: () => makeAutocompleteEuIndex() };
  const modal = new LawLookupModal({}, providerRegistry, settingsStore, ui, indexProvider);
  modal.onOpen();
  const formEl = modal.contentEl.children[1];
  const inputEl = formEl.children.find((child) => child.tagName === "INPUT" && child.cls === "")!;
  const jurisdictionSelect = formEl.children.find((child) => child.tagName === "SELECT")!;
  if (jurisdiction !== defaultJurisdiction) {
    jurisdictionSelect.value = jurisdiction;
    jurisdictionSelect.fire("change");
  }
  return { requests, formEl, inputEl, jurisdictionSelect, modal, settingsStore };
}

function suggestionsFor(formEl: FakeElement): FakeElement {
  const suggestions = formEl.children.find((child) => child.cls === "de-law-lookup-suggestions");
  assert.ok(suggestions, "expected autocomplete suggestions container");
  return suggestions;
}

function selectedLawStatusFor(formEl: FakeElement): FakeElement {
  const status = formEl.children.find((child) => child.cls === "de-law-selected-law-status");
  assert.ok(status, "expected selected-law status container");
  return status;
}

describe("LawLookupModal metadata autocomplete integration", () => {
  it("persists the DE source choice and restores it in a fresh modal", async () => {
    const harness = buildAutocompleteModalHarness("DE", "single", "DE");
    const sourceSetting = FakeSetting.instances.find((setting) => setting.name === "useEnglishTranslationWhenAvailable");
    assert.ok(sourceSetting?.toggles[0], "expected DE source toggle");

    await sourceSetting.toggles[0].trigger(true);
    assert.equal(harness.settingsStore.getDefaultLawSourceVariant(), "translation-en");
    assert.equal(harness.requests.length, 0);

    FakeSetting.instances = [];
    const reopened = new LawLookupModal(
      {},
      { getSection: async () => { throw new Error("provider must not be called"); } },
      harness.settingsStore,
      ui,
      { getEuActIndex: () => makeAutocompleteEuIndex() },
    );
    reopened.onOpen();
    const reopenedSetting = FakeSetting.instances.find((setting) => setting.name === "useEnglishTranslationWhenAvailable");
    assert.equal(reopenedSetting?.toggles[0]?.value, true);
  });

  it("persists EU language selection directly through the settings setter", async () => {
    const harness = buildAutocompleteModalHarness("EU");
    const languageSetting = FakeSetting.instances.find((setting) => setting.name === "euTextLanguage");
    assert.ok(languageSetting?.dropdowns[0], "expected EU language dropdown");

    await languageSetting.dropdowns[0].trigger("fra");
    assert.equal(harness.settingsStore.getDefaultEuLawLanguage(), "fr");
    assert.equal(harness.requests.length, 0);
  });

  it("opens with the persisted jurisdiction and keeps the required option order without lookup", () => {
    const harness = buildAutocompleteModalHarness("CH", "single", "CH");
    assert.deepEqual(harness.jurisdictionSelect.children.map((option) => option.value), ["EU", "DE", "AT", "CH", "ES"]);
    assert.equal(harness.jurisdictionSelect.value, "CH");
    assert.equal(harness.requests.length, 0);
  });

  it("shows language controls only for jurisdictions with multiple choices", () => {
    const controlsFor = (jurisdiction: Jurisdiction): { dropdowns: number; toggles: number } => {
      const harness = buildAutocompleteModalHarness("EU");
      if (jurisdiction !== "EU") {
        FakeSetting.instances = [];
        harness.jurisdictionSelect.value = jurisdiction;
        harness.jurisdictionSelect.fire("change");
      }
      const latestByName = new Map<string, FakeSetting>();
      for (const setting of FakeSetting.instances) {
        if (["euTextLanguage", "swissOfficialTextLanguage", "useEnglishTranslationWhenAvailable"].includes(setting.name)) {
          latestByName.set(setting.name, setting);
        }
      }
      const languageControls = [...latestByName.values()];
      return {
        dropdowns: languageControls.reduce((count, setting) => count + setting.dropdowns.length, 0),
        toggles: languageControls.reduce((count, setting) => count + setting.toggles.length, 0),
      };
    };

    assert.deepEqual(controlsFor("EU"), { dropdowns: 1, toggles: 0 });
    assert.deepEqual(controlsFor("DE"), { dropdowns: 0, toggles: 1 });
    assert.deepEqual(controlsFor("AT"), { dropdowns: 0, toggles: 0 });
    assert.deepEqual(controlsFor("CH"), { dropdowns: 1, toggles: 0 });
  });

  it("renders EU title suggestions while typing without calling a provider", () => {
    const harness = buildAutocompleteModalHarness("EU");
    harness.inputEl.value = "artificial";
    harness.inputEl.fire("input");

    const suggestions = suggestionsFor(harness.formEl);
    assert.equal(harness.requests.length, 0);
    assert.equal(suggestions.children.length, 1);
    assert.match(suggestions.children[0].text, /Artificial Intelligence Act/i);
    assert.match(suggestions.children[0].text, /32024R1689/);
  });

  it("selects a suggestion by canonicalizing the input without triggering lookup", () => {
    const harness = buildAutocompleteModalHarness("EU");
    harness.inputEl.value = "artificial";
    harness.inputEl.fire("input");
    const suggestions = suggestionsFor(harness.formEl);

    suggestions.children[0].fire("click");

    assert.equal(harness.inputEl.value, "32024R1689 ");
    assert.equal(harness.requests.length, 0);
    assert.equal(suggestions.children.length, 0);
  });

  it("shows the selected human-readable EU law title and reference guidance", () => {
    const harness = buildAutocompleteModalHarness("EU");
    harness.inputEl.value = "artificial";
    harness.inputEl.fire("input");
    suggestionsFor(harness.formEl).children[0].fire("click");

    const status = selectedLawStatusFor(harness.formEl);
    assert.equal(harness.inputEl.value, "32024R1689 ");
    assert.match(status.text, /✓/u);
    assert.match(status.text, /Artificial Intelligence Act/u);
    assert.match(status.text, /Article references/u);
    assert.equal(status.cls, "de-law-selected-law-status");
    assert.equal(harness.requests.length, 0);
  });

  it("keeps the selected-law confirmation while appending an article", () => {
    const harness = buildAutocompleteModalHarness("EU");
    harness.inputEl.value = "artificial";
    harness.inputEl.fire("input");
    suggestionsFor(harness.formEl).children[0].fire("click");

    harness.inputEl.value = "32024R1689 Art. 1";
    harness.inputEl.fire("input");

    assert.match(selectedLawStatusFor(harness.formEl).text, /Artificial Intelligence Act/u);
    assert.equal(harness.requests.length, 0);
  });

  it("clears the selected-law confirmation when the canonical prefix changes", () => {
    const harness = buildAutocompleteModalHarness("EU");
    harness.inputEl.value = "artificial";
    harness.inputEl.fire("input");
    suggestionsFor(harness.formEl).children[0].fire("click");

    harness.inputEl.value = "32024R0001 Art. 1";
    harness.inputEl.fire("input");

    assert.equal(selectedLawStatusFor(harness.formEl).text, "");
  });

  it("clears the selected-law confirmation when jurisdiction changes", () => {
    const harness = buildAutocompleteModalHarness("EU");
    harness.inputEl.value = "artificial";
    harness.inputEl.fire("input");
    suggestionsFor(harness.formEl).children[0].fire("click");

    harness.jurisdictionSelect.value = "DE";
    harness.jurisdictionSelect.fire("change");

    assert.equal(selectedLawStatusFor(harness.formEl).text, "");
  });

  it("recomputes suggestions on jurisdiction change instead of retaining stale EU results", () => {
    const harness = buildAutocompleteModalHarness("EU");
    harness.inputEl.value = "artificial";
    harness.inputEl.fire("input");
    assert.equal(suggestionsFor(harness.formEl).children.length, 1);

    harness.jurisdictionSelect.value = "DE";
    harness.jurisdictionSelect.fire("change");

    assert.equal(suggestionsFor(harness.formEl).children.length, 0);
    assert.equal(harness.requests.length, 0);
  });

  it("uses the existing DACH metadata catalogs for jurisdiction-specific title suggestions", () => {
    const cases: Array<{ jurisdiction: Jurisdiction; expected: RegExp }> = [
      { jurisdiction: "DE", expected: /Bundesdatenschutzgesetz.*BDSG/i },
      { jurisdiction: "AT", expected: /Datenschutzgesetz.*DSG/i },
      { jurisdiction: "CH", expected: /Datenschutz.*DSG/i },
    ];

    for (const entry of cases) {
      const harness = buildAutocompleteModalHarness(entry.jurisdiction);
      harness.inputEl.value = "datenschutz";
      harness.inputEl.fire("input");
      const suggestions = suggestionsFor(harness.formEl);
      assert.equal(harness.requests.length, 0);
      assert.ok(suggestions.children.length > 0);
      assert.match(suggestions.children[0].text, entry.expected);
    }
  });
});

describe("LawLookupModal configurable input layout", () => {
  it("converts an existing single-line modal state to split without lookup", () => {
    const harness = buildAutocompleteModalHarness("EU");
    harness.inputEl.value = "artificial";
    harness.inputEl.fire("input");
    suggestionsFor(harness.formEl).children[0].fire("click");
    harness.inputEl.value = "32024R1689 Art. 1";
    harness.inputEl.fire("input");

    assert.equal(harness.modal.setInputLayout("split"), true);
    const lawInput = harness.formEl.children.find((child) => child.cls === "de-law-law-input");
    const referenceInput = harness.formEl.children.find((child) => child.cls === "de-law-reference-input");
    assert.equal(lawInput?.value, "32024R1689");
    assert.equal(referenceInput?.value, "Art. 1");
    assert.match(selectedLawStatusFor(harness.formEl).text, /Artificial Intelligence Act/u);
    assert.equal(harness.requests.length, 0);
  });

  it("converts an empty single-line modal to split without lookup", () => {
    const harness = buildAutocompleteModalHarness("EU");

    assert.equal(harness.modal.setInputLayout("split"), true);
    const lawInput = harness.formEl.children.find((child) => child.cls === "de-law-law-input");
    const referenceInput = harness.formEl.children.find((child) => child.cls === "de-law-reference-input");
    assert.equal(lawInput?.value, "");
    assert.equal(referenceInput?.value, "");
    assert.equal(harness.requests.length, 0);
  });

  it("keeps repeated empty layout transitions lossless and request-free", () => {
    const harness = buildAutocompleteModalHarness("EU");

    assert.equal(harness.modal.setInputLayout("split"), true);
    assert.equal(harness.modal.setInputLayout("single"), true);
    assert.equal(harness.modal.setInputLayout("split"), true);
    assert.equal(harness.formEl.children.filter((child) => child.tagName === "INPUT").length, 2);
    assert.equal(harness.formEl.children.find((child) => child.cls === "de-law-law-input")?.value, "");
    assert.equal(harness.formEl.children.find((child) => child.cls === "de-law-reference-input")?.value, "");
    assert.equal(harness.requests.length, 0);
  });

  it("converts split state to one line without lookup", () => {
    const harness = buildAutocompleteModalHarness("EU", "split");
    const lawInput = harness.formEl.children.find((child) => child.cls === "de-law-law-input");
    const referenceInput = harness.formEl.children.find((child) => child.cls === "de-law-reference-input");
    assert.ok(lawInput);
    assert.ok(referenceInput);
    lawInput.value = "artificial";
    lawInput.fire("input");
    suggestionsFor(harness.formEl).children[0].fire("click");
    referenceInput.value = "Art. 1";

    assert.equal(harness.modal.setInputLayout("single"), true);
    const input = harness.formEl.children.find((child) => child.tagName === "INPUT");
    assert.equal(input?.value, "32024R1689 Art. 1");
    assert.match(selectedLawStatusFor(harness.formEl).text, /Artificial Intelligence Act/u);
    assert.equal(harness.requests.length, 0);
  });

  it("rejects ambiguous single-line conversion without discarding input or inventing selection", () => {
    const harness = buildAutocompleteModalHarness("EU");
    harness.inputEl.value = "free-form citation without a safe law boundary";

    assert.equal(harness.modal.setInputLayout("split"), false);
    assert.equal(harness.inputEl.value, "free-form citation without a safe law boundary");
    assert.equal(harness.formEl.children.filter((child) => child.tagName === "INPUT").length, 1);
    assert.equal(selectedLawStatusFor(harness.formEl).text, "");
    assert.equal(harness.requests.length, 0);
  });

  it("renders separate law and reference controls in split mode", () => {
    const harness = buildAutocompleteModalHarness("EU", "split");
    const inputs = harness.formEl.children.filter((child) => child.tagName === "INPUT");
    assert.equal(inputs.length, 2);
    assert.equal(inputs[0].cls, "de-law-law-input");
    assert.equal(inputs[1].cls, "de-law-reference-input");
  });

  it("associates each split-mode visible label with its corresponding input", () => {
    const harness = buildAutocompleteModalHarness("EU", "split");
    const labels = harness.formEl.children.filter((child) => child.tagName === "LABEL");
    const inputs = harness.formEl.children.filter((child) => child.tagName === "INPUT");
    assert.equal(labels.length, 2);
    assert.equal(inputs.length, 2);
    assert.equal(labels[0].attributes.for, inputs[0].attributes.id);
    assert.equal(labels[1].attributes.for, inputs[1].attributes.id);
    assert.notEqual(inputs[0].attributes.id, inputs[1].attributes.id);
  });

  it("selecting a split-mode law keeps provider requests at zero", () => {
    const harness = buildAutocompleteModalHarness("EU", "split");
    const lawInput = harness.formEl.children.find((child) => child.cls === "de-law-law-input");
    assert.ok(lawInput);
    lawInput.value = "artificial";
    lawInput.fire("input");
    suggestionsFor(harness.formEl).children[0].fire("click");
    assert.equal(harness.requests.length, 0);
    assert.match(selectedLawStatusFor(harness.formEl).text, /Artificial Intelligence Act/u);
  });

  it("typing a split reference does not request a provider until explicit lookup", () => {
    const harness = buildAutocompleteModalHarness("EU", "split");
    const lawInput = harness.formEl.children.find((child) => child.cls === "de-law-law-input");
    const referenceInput = harness.formEl.children.find((child) => child.cls === "de-law-reference-input");
    assert.ok(lawInput);
    assert.ok(referenceInput);
    lawInput.value = "artificial";
    lawInput.fire("input");
    suggestionsFor(harness.formEl).children[0].fire("click");
    referenceInput.value = "Art. 1";
    referenceInput.fire("input");
    assert.equal(harness.requests.length, 0);
    const lookupButton = harness.formEl.children.find((child) => child.text === "lookUpLawButton");
    assert.ok(lookupButton);
    lookupButton.fire("click");
    assert.equal(harness.requests.length, 1);
  });

  it("composes split references through the existing parser grammar for EU, DE, and CH", () => {
    assert.equal(composeSplitLookupInput("32024R1689", "Art. 1"), "32024R1689 Art. 1");
    assert.equal(composeSplitLookupInput("BGB", "§ 823"), "BGB § 823");
    assert.equal(composeSplitLookupInput("OR", "Art. 1"), "OR Art. 1");
  });

  it("preserves safely decomposable input and rejects unsafe conversion", () => {
    assert.deepEqual(decomposeOneLineLookupInput("32024R1689 Art. 1", "EU"), {
      law: "32024R1689",
      reference: "Art. 1",
    });
    assert.deepEqual(decomposeOneLineLookupInput("§ 823 BGB", "DE"), {
      law: "BGB",
      reference: "§ 823",
    });
    assert.equal(decomposeOneLineLookupInput("free-form citation without a safe law boundary", "EU"), null);
  });

  it("clears selected-law state when the jurisdiction changes in split mode", () => {
    const harness = buildAutocompleteModalHarness("EU", "split");
    const lawInput = harness.formEl.children.find((child) => child.cls === "de-law-law-input");
    assert.ok(lawInput);
    lawInput.value = "artificial";
    lawInput.fire("input");
    suggestionsFor(harness.formEl).children[0].fire("click");
    harness.jurisdictionSelect.value = "DE";
    harness.jurisdictionSelect.fire("change");
    assert.equal(selectedLawStatusFor(harness.formEl).text, "");
  });
});
