import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

type Jurisdiction = "DE" | "AT" | "CH" | "EU";
type MatchKind = "exact-alias" | "title-prefix" | "title-contains" | "eu-technical";

interface SearchEntry {
  jurisdiction: Jurisdiction;
  canonicalInput: string;
  title: string;
  aliases?: readonly string[];
  alternateTitles?: readonly string[];
  celex?: string;
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
  empty(): void { this.children = []; }
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
  get: (_target, property) => String(property),
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
        titlesByLanguage: {
          eng: "Artificial Intelligence Act",
          deu: "Verordnung über künstliche Intelligenz",
        },
        availableLanguages: ["eng", "deu"],
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
