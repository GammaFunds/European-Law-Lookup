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
  children: FakeElement[] = [];
  listeners: Record<string, Listener[]> = {};
  text = "";
  value = "";
  cls = "";

  createEl(_tag: string, options?: { text?: string; value?: string; cls?: string }): FakeElement {
    const child = new FakeElement();
    child.text = options?.text ?? "";
    child.value = options?.value ?? "";
    child.cls = options?.cls ?? "";
    this.children.push(child);
    return child;
  }

  createDiv(options?: { text?: string; cls?: string }): FakeElement {
    const child = new FakeElement();
    child.text = options?.text ?? "";
    child.cls = options?.cls ?? "";
    this.children.push(child);
    return child;
  }

  addClass(_cls: string): void {}
  setText(text: string): void { this.text = text; }
  empty(): void { this.children = []; this.text = ""; }
  addEventListener(type: string, listener: Listener): void { (this.listeners[type] ??= []).push(listener); }
  fire(type: string, event?: { key?: string }): void { for (const listener of this.listeners[type] ?? []) listener(event); }
}

class FakeModal { contentEl = new FakeElement(); constructor(_app?: unknown) {} }
class FakeNotice { constructor(_message: string) {} }
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

const { LawLookupModal } = loadWithObsidianStub(
  () => require("../src/ui/LawLookupModal"),
) as {
  LawLookupModal: new (...args: unknown[]) => { onOpen(): void; contentEl: FakeElement };
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

function buildAutocompleteModalHarness(jurisdiction: Jurisdiction) {
  const requests: unknown[] = [];
  const providerRegistry = {
    getSection: async (reference: unknown) => {
      requests.push(reference);
      throw new Error("probe-provider-unavailable");
    },
  };
  const settingsStore = {
    getDefaultLawSourceVariant: () => "official-de",
    getDefaultEuLawLanguage: () => "en",
    setDefaultEuLawLanguage: async () => {},
    getDefaultChLawLanguage: () => "de",
    setDefaultChLawLanguage: async () => {},
    getShowInsertedSourceMetadata: () => true,
    setShowInsertedSourceMetadata: async () => {},
  };
  const indexProvider = { getEuActIndex: () => makeAutocompleteEuIndex() };
  const modal = new LawLookupModal({}, providerRegistry, settingsStore, ui, indexProvider);
  modal.onOpen();
  const formEl = modal.contentEl.children[1];
  const inputEl = formEl.children[0];
  const jurisdictionSelect = formEl.children[1];
  jurisdictionSelect.value = jurisdiction;
  jurisdictionSelect.fire("change");
  return { requests, formEl, inputEl, jurisdictionSelect };
}

function suggestionsFor(formEl: FakeElement): FakeElement {
  const suggestions = formEl.children[3];
  assert.ok(suggestions, "expected autocomplete suggestions container");
  return suggestions;
}

function selectedLawStatusFor(formEl: FakeElement): FakeElement {
  const status = formEl.children[4];
  assert.ok(status, "expected selected-law status container");
  return status;
}

describe("LawLookupModal metadata autocomplete integration", () => {
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
