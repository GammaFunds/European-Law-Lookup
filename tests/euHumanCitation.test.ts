import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { EU_LANGUAGES } from "../src/law/euLanguages";
import type { EuLawLanguage } from "../src/law/types";
import {
  addOrReplaceEntry,
  emptyEuActIndex,
  type EuActIndex,
  type EuActIndexEntry,
} from "../src/law/euActIndex";
import {
  resolveEuHumanCitation,
  supportedEuHumanCitationLanguages,
  normalizeEuCitationTitle,
} from "../src/law/euHumanCitation";
import { parseLawReferenceWithSelectedJurisdiction } from "../src/parser";
import type { App } from "obsidian";
import type { ProviderRegistry } from "../src/law/ProviderRegistry";
import type { LawReference } from "../src/law/types";
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
  message: string;
  constructor(message: string) {
    this.message = message;
  }
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

const obsidianStubPath = "/tmp/opencode/obsidian-human-citation-stub.cjs";
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

function settle(): Promise<void> {
  return new Promise<void>((resolve) => setImmediate(() => resolve()));
}

const MULTILINGUAL_CASES: Array<{
  language: EuLawLanguage;
  citation: string;
  expectedCelex: string;
  expectedType: "R" | "L" | "D";
  section: string;
}> = [
  { language: "bg", citation: "чл. 1 Регламент (ЕС) 2024/1689", expectedCelex: "32024R1689", expectedType: "R", section: "1" },
  { language: "es", citation: "Art. 1 Reglamento (UE) 2024/1689", expectedCelex: "32024R1689", expectedType: "R", section: "1" },
  { language: "cs", citation: "čl. 1 Nařízení (EU) 2024/1689", expectedCelex: "32024R1689", expectedType: "R", section: "1" },
  { language: "da", citation: "Art. 1 Forordning (EU) 2024/1689", expectedCelex: "32024R1689", expectedType: "R", section: "1" },
  { language: "de", citation: "Art. 1 Verordnung (EU) 2024/1689", expectedCelex: "32024R1689", expectedType: "R", section: "1" },
  { language: "et", citation: "Art. 1 Määrus (EL) 2024/1689", expectedCelex: "32024R1689", expectedType: "R", section: "1" },
  { language: "el", citation: "Άρθ. 1 Κανονισμός (ΕΕ) 2024/1689", expectedCelex: "32024R1689", expectedType: "R", section: "1" },
  { language: "en", citation: "Art. 1 Regulation (EU) 2024/1689", expectedCelex: "32024R1689", expectedType: "R", section: "1" },
  { language: "fr", citation: "Art. 1 Règlement (UE) 2024/1689", expectedCelex: "32024R1689", expectedType: "R", section: "1" },
  { language: "ga", citation: "Alt. 1 Rialachán (AE) 2024/1689", expectedCelex: "32024R1689", expectedType: "R", section: "1" },
  { language: "hr", citation: "čl. 1 Uredba (EU) 2024/1689", expectedCelex: "32024R1689", expectedType: "R", section: "1" },
  { language: "it", citation: "Art. 1 Regolamento (UE) 2024/1689", expectedCelex: "32024R1689", expectedType: "R", section: "1" },
  { language: "lv", citation: "p. 1 Regula (ES) 2024/1689", expectedCelex: "32024R1689", expectedType: "R", section: "1" },
  { language: "lt", citation: "str. 1 Reglamentas (ES) 2024/1689", expectedCelex: "32024R1689", expectedType: "R", section: "1" },
  { language: "hu", citation: "c. 1 Rendelet (EU) 2024/1689", expectedCelex: "32024R1689", expectedType: "R", section: "1" },
  { language: "mt", citation: "Art. 1 Regolament (UE) 2024/1689", expectedCelex: "32024R1689", expectedType: "R", section: "1" },
  { language: "nl", citation: "Art. 1 Verordening (EU) 2024/1689", expectedCelex: "32024R1689", expectedType: "R", section: "1" },
  { language: "pl", citation: "Art. 1 Rozporządzenie (UE) 2024/1689", expectedCelex: "32024R1689", expectedType: "R", section: "1" },
  { language: "pt", citation: "Art. 1 Regulamento (UE) 2024/1689", expectedCelex: "32024R1689", expectedType: "R", section: "1" },
  { language: "ro", citation: "Art. 1 Regulament (UE) 2024/1689", expectedCelex: "32024R1689", expectedType: "R", section: "1" },
  { language: "sk", citation: "čl. 1 Nariadenie (EÚ) 2024/1689", expectedCelex: "32024R1689", expectedType: "R", section: "1" },
  { language: "sl", citation: "čl. 1 Uredba (EU) 2024/1689", expectedCelex: "32024R1689", expectedType: "R", section: "1" },
  { language: "fi", citation: "Art. 1 Asetus (EU) 2024/1689", expectedCelex: "32024R1689", expectedType: "R", section: "1" },
  { language: "sv", citation: "Art. 1 Förordning (EU) 2024/1689", expectedCelex: "32024R1689", expectedType: "R", section: "1" },

  { language: "bg", citation: "чл. 1 Директива 2011/61/ЕС", expectedCelex: "32011L0061", expectedType: "L", section: "1" },
  { language: "es", citation: "Art. 1 Directiva 2011/61/UE", expectedCelex: "32011L0061", expectedType: "L", section: "1" },
  { language: "cs", citation: "čl. 1 Směrnice 2011/61/EU", expectedCelex: "32011L0061", expectedType: "L", section: "1" },
  { language: "da", citation: "Art. 1 Direktiv 2011/61/EU", expectedCelex: "32011L0061", expectedType: "L", section: "1" },
  { language: "de", citation: "Art. 1 Richtlinie 2011/61/EU", expectedCelex: "32011L0061", expectedType: "L", section: "1" },
  { language: "et", citation: "Art. 1 Direktiiv 2011/61/EL", expectedCelex: "32011L0061", expectedType: "L", section: "1" },
  { language: "el", citation: "Άρθ. 1 Οδηγία 2011/61/ΕΕ", expectedCelex: "32011L0061", expectedType: "L", section: "1" },
  { language: "en", citation: "Article 1 Directive 2011/61/EU", expectedCelex: "32011L0061", expectedType: "L", section: "1" },
  { language: "fr", citation: "Article 1 Directive 2011/61/UE", expectedCelex: "32011L0061", expectedType: "L", section: "1" },
  { language: "ga", citation: "Alt. 1 Treoir 2011/61/AE", expectedCelex: "32011L0061", expectedType: "L", section: "1" },
  { language: "hr", citation: "čl. 1 Direktiva 2011/61/EU", expectedCelex: "32011L0061", expectedType: "L", section: "1" },
  { language: "it", citation: "Articolo 1 Direttiva 2011/61/UE", expectedCelex: "32011L0061", expectedType: "L", section: "1" },
  { language: "lv", citation: "p. 1 Direktīva 2011/61/ES", expectedCelex: "32011L0061", expectedType: "L", section: "1" },
  { language: "lt", citation: "str. 1 Direktyva 2011/61/ES", expectedCelex: "32011L0061", expectedType: "L", section: "1" },
  { language: "hu", citation: "c. 1 Irányelv 2011/61/EU", expectedCelex: "32011L0061", expectedType: "L", section: "1" },
  { language: "mt", citation: "Art. 1 Direttiva 2011/61/UE", expectedCelex: "32011L0061", expectedType: "L", section: "1" },
  { language: "nl", citation: "Art. 1 Richtlijn 2011/61/EU", expectedCelex: "32011L0061", expectedType: "L", section: "1" },
  { language: "pl", citation: "Art. 1 Dyrektywa 2011/61/UE", expectedCelex: "32011L0061", expectedType: "L", section: "1" },
  { language: "pt", citation: "Art. 1 Diretiva 2011/61/UE", expectedCelex: "32011L0061", expectedType: "L", section: "1" },
  { language: "ro", citation: "Art. 1 Directiva 2011/61/UE", expectedCelex: "32011L0061", expectedType: "L", section: "1" },
  { language: "sk", citation: "čl. 1 Smernica 2011/61/EÚ", expectedCelex: "32011L0061", expectedType: "L", section: "1" },
  { language: "sl", citation: "čl. 1 Direktiva 2011/61/EU", expectedCelex: "32011L0061", expectedType: "L", section: "1" },
  { language: "fi", citation: "Art. 1 Direktiivi 2011/61/EU", expectedCelex: "32011L0061", expectedType: "L", section: "1" },
  { language: "sv", citation: "Art. 1 Direktiv 2011/61/EU", expectedCelex: "32011L0061", expectedType: "L", section: "1" },

  { language: "bg", citation: "чл. 1 Решение (ЕС) 2024/1234", expectedCelex: "32024D1234", expectedType: "D", section: "1" },
  { language: "de", citation: "Art. 1 Beschluss (EU) 2024/1234", expectedCelex: "32024D1234", expectedType: "D", section: "1" },
  { language: "en", citation: "Article 1 Decision (EU) 2024/1234", expectedCelex: "32024D1234", expectedType: "D", section: "1" },
  { language: "fr", citation: "Article 1 Décision (UE) 2024/1234", expectedCelex: "32024D1234", expectedType: "D", section: "1" },
  { language: "it", citation: "Articolo 1 Decisione (UE) 2024/1234", expectedCelex: "32024D1234", expectedType: "D", section: "1" },
  { language: "es", citation: "Artículo 1 Decisión (UE) 2024/1234", expectedCelex: "32024D1234", expectedType: "D", section: "1" },
  { language: "pl", citation: "Art. 1 Decyzja (UE) 2024/1234", expectedCelex: "32024D1234", expectedType: "D", section: "1" },
  { language: "ro", citation: "Art. 1 Decizie (UE) 2024/1234", expectedCelex: "32024D1234", expectedType: "D", section: "1" },
  { language: "cs", citation: "čl. 1 Rozhodnutí (EU) 2024/1234", expectedCelex: "32024D1234", expectedType: "D", section: "1" },
  { language: "el", citation: "Άρθ. 1 Απόφαση (ΕΕ) 2024/1234", expectedCelex: "32024D1234", expectedType: "D", section: "1" },
];

function entry(overrides: Partial<EuActIndexEntry> = {}): EuActIndexEntry {
  return {
    celex: "32016R0679",
    documentType: "R",
    year: "2016",
    number: "0679",
    titlesByLanguage: { eng: "Regulation (EU) 2016/679", deu: "Verordnung (EU) 2016/679" },
    availableLanguages: ["deu", "eng"],
    ...overrides,
  };
}

function makeEuActIndex(entries: Array<{ celex: string; availableLanguages: string[] }>): EuActIndex {
  const indexEntries = new Map<string, EuActIndexEntry>();
  for (const entrySpec of entries) {
    indexEntries.set(entrySpec.celex, {
      celex: entrySpec.celex,
      documentType: "R",
      year: "2016",
      number: "679",
      titlesByLanguage: {},
      availableLanguages: entrySpec.availableLanguages,
    });
  }
  return {
    schemaVersion: 1,
    lastSyncCheckpoint: null,
    entries: indexEntries,
  };
}

describe("EU human citation resolver language registry coverage", () => {
  it("covers every language in EU_LANGUAGES", () => {
    const covered = new Set(supportedEuHumanCitationLanguages());
    const expected = new Set(EU_LANGUAGES.map((language) => language.code));
    assert.equal(covered.size, 24, `EU_LANGUAGES_COVERED=${covered.size}`);
    assert.equal(expected.size, 24, "EU_LANGUAGES_EXPECTED=24");
    for (const language of expected) {
      assert.ok(covered.has(language), `missing human-citation coverage for ${language}`);
    }
  });

  it("exposes explicit automated evidence for all 24 languages", () => {
    const tested = new Set(MULTILINGUAL_CASES.map((c) => c.language));
    assert.equal(tested.size, 24);
    for (const language of EU_LANGUAGES.map((l) => l.code)) {
      assert.ok(tested.has(language), `no automated citation evidence for ${language}`);
    }
  });
});

describe("EU human citation resolver multilingual positive coverage", () => {
  for (const testCase of MULTILINGUAL_CASES) {
    it(`resolves ${testCase.language}: ${testCase.citation}`, () => {
      const result = resolveEuHumanCitation(testCase.citation, null);
      assert.ok(result, `expected resolution for ${testCase.citation}`);
      assert.equal(result!.euCelex, testCase.expectedCelex);
      assert.equal(result!.euDocumentType, testCase.expectedType);
      assert.equal(result!.section, testCase.section);
      assert.equal(result!.referenceType, "article");
      assert.equal(result!.jurisdiction, "EU");
    });
  }

  it("supports act-first ordering", () => {
    const result = resolveEuHumanCitation("Richtlinie 2011/61/EU Art. 1", null);
    assert.ok(result);
    assert.equal(result!.euCelex, "32011L0061");
    assert.equal(result!.section, "1");
  });

  it("supports act-first ordering in English", () => {
    const result = resolveEuHumanCitation("Regulation (EU) 2024/1689 Article 1", null);
    assert.ok(result);
    assert.equal(result!.euCelex, "32024R1689");
    assert.equal(result!.section, "1");
  });
});

describe("EU human citation resolver required identity examples", () => {
  it("Art. 1 Richtlinie 2011/61/EU", () => {
    const result = resolveEuHumanCitation("Art. 1 Richtlinie 2011/61/EU", null);
    assert.ok(result);
    assert.equal(result!.euCelex, "32011L0061");
    assert.equal(result!.euDocumentType, "L");
    assert.equal(result!.section, "1");
    assert.equal(result!.referenceType, "article");
    assert.equal(result!.jurisdiction, "EU");
  });

  it("Richtlinie 2011/61/EU Art. 1", () => {
    const result = resolveEuHumanCitation("Richtlinie 2011/61/EU Art. 1", null);
    assert.ok(result);
    assert.equal(result!.euCelex, "32011L0061");
  });

  it("Article 1 Directive 2011/61/EU", () => {
    const result = resolveEuHumanCitation("Article 1 Directive 2011/61/EU", null);
    assert.ok(result);
    assert.equal(result!.euCelex, "32011L0061");
  });

  it("Art. 1 Verordnung (EU) 2024/1689", () => {
    const result = resolveEuHumanCitation("Art. 1 Verordnung (EU) 2024/1689", null);
    assert.ok(result);
    assert.equal(result!.euCelex, "32024R1689");
    assert.equal(result!.euDocumentType, "R");
  });

  it("Regulation (EU) 2024/1689 Article 1", () => {
    const result = resolveEuHumanCitation("Regulation (EU) 2024/1689 Article 1", null);
    assert.ok(result);
    assert.equal(result!.euCelex, "32024R1689");
  });

  it("Art. 1 Beschluss (EU) 2024/1234", () => {
    const result = resolveEuHumanCitation("Art. 1 Beschluss (EU) 2024/1234", null);
    assert.ok(result);
    assert.equal(result!.euCelex, "32024D1234");
    assert.equal(result!.euDocumentType, "D");
  });

  it("Article 1 Decision (EU) 2024/1234", () => {
    const result = resolveEuHumanCitation("Article 1 Decision (EU) 2024/1234", null);
    assert.ok(result);
    assert.equal(result!.euCelex, "32024D1234");
  });
});

describe("EU human citation resolver number handling", () => {
  const numberCases: Array<{ number: string; padded: string; type: "R" | "L" | "D" }> = [
    { number: "7", padded: "0007", type: "R" },
    { number: "61", padded: "0061", type: "L" },
    { number: "999", padded: "0999", type: "D" },
    { number: "1689", padded: "1689", type: "R" },
    { number: "12345", padded: "12345", type: "L" },
    { number: "123456", padded: "123456", type: "R" },
  ];

  for (const { number, padded, type } of numberCases) {
    it(`pads ${number} to ${padded}`, () => {
      const label = type === "R" ? "Verordnung" : type === "L" ? "Richtlinie" : "Beschluss";
      const result = resolveEuHumanCitation(`Art. 1 ${label} (EU) 2024/${number}`, null);
      assert.ok(result);
      assert.equal(result!.euCelex, `32024${type}${padded}`);
    });
  }

  it("rejects number 0", () => {
    assert.equal(resolveEuHumanCitation("Art. 1 Verordnung (EU) 2024/0", null), null);
  });

  it("rejects more than six digits", () => {
    assert.equal(resolveEuHumanCitation("Art. 1 Verordnung (EU) 2024/1234567", null), null);
  });

  it("rejects negative numbers", () => {
    assert.equal(resolveEuHumanCitation("Art. 1 Verordnung (EU) 2024/-1", null), null);
  });

  it("rejects non-numeric number", () => {
    assert.equal(resolveEuHumanCitation("Art. 1 Verordnung (EU) 2024/abc", null), null);
  });

  it("rejects malformed year", () => {
    assert.equal(resolveEuHumanCitation("Art. 1 Verordnung (EU) 24/1689", null), null);
  });

  it("rejects year outside parseEuCelex admission range", () => {
    assert.equal(resolveEuHumanCitation("Art. 1 Verordnung (EU) 1850/1689", null), null);
    assert.equal(resolveEuHumanCitation("Art. 1 Verordnung (EU) 2100/1689", null), null);
  });
});

describe("EU human citation resolver fail-closed behavior", () => {
  it("rejects unsupported act label", () => {
    assert.equal(resolveEuHumanCitation("Art. 1 Treaty (EU) 2024/1689", null), null);
  });

  it("rejects unsupported document class", () => {
    assert.equal(resolveEuHumanCitation("Art. 1 Recommendation (EU) 2024/1689", null), null);
  });

  it("rejects bare year/number with no document type", () => {
    assert.equal(resolveEuHumanCitation("Art. 1 2024/1689", null), null);
    assert.equal(resolveEuHumanCitation("2024/1689 Art. 1", null), null);
  });

  it("rejects malformed citation", () => {
    assert.equal(resolveEuHumanCitation("Verordnung 2024 Art. 1", null), null);
  });

  it("rejects unsupported CELEX suffix", () => {
    assert.equal(resolveEuHumanCitation("Art. 1 Verordnung (EU) 2024/1689R(01)", null), null);
  });

  it("rejects partial official title", () => {
    const index = addOrReplaceEntry(
      emptyEuActIndex(),
      entry({ titlesByLanguage: { eng: GDPR_FULL_TITLE } }),
    );
    assert.equal(resolveEuHumanCitation("Art. 1 Regulation 2016/679", index), null);
  });

  it("rejects fuzzy official title", () => {
    const index = addOrReplaceEntry(
      emptyEuActIndex(),
      entry({ titlesByLanguage: { eng: GDPR_FULL_TITLE } }),
    );
    assert.equal(resolveEuHumanCitation("Art. 1 EU data regulation", index), null);
  });

  it("rejects ambiguous exact normalized official title", () => {
    const index = addOrReplaceEntry(
      emptyEuActIndex(),
      entry({ celex: "32016R0679", titlesByLanguage: { eng: "Same Title" } }),
    );
    const index2 = addOrReplaceEntry(
      index,
      entry({ celex: "32022R2065", titlesByLanguage: { eng: "Same Title" } }),
    );
    assert.equal(resolveEuHumanCitation("Art. 1 Same Title", index2), null);
  });

  it("rejects mismatched org code for the detected language", () => {
    assert.equal(resolveEuHumanCitation("Art. 1 Verordnung (UE) 2024/1689", null), null);
  });

  it("rejects invalid year", () => {
    assert.equal(resolveEuHumanCitation("Art. 1 Verordnung (EU) abcd/1689", null), null);
  });

  it("rejects invalid number", () => {
    assert.equal(resolveEuHumanCitation("Art. 1 Verordnung (EU) 2024/", null), null);
  });
});

const GDPR_FULL_TITLE = "Regulation (EU) 2016/679 of the European Parliament and of the Council";

describe("EU human citation resolver exact official-title resolution", () => {
  it("resolves a unique exact official title", () => {
    const index = addOrReplaceEntry(
      emptyEuActIndex(),
      entry({ titlesByLanguage: { eng: GDPR_FULL_TITLE } }),
    );
    const result = resolveEuHumanCitation(`Art. 1 ${GDPR_FULL_TITLE}`, index);
    assert.ok(result);
    assert.equal(result!.euCelex, "32016R0679");
    assert.equal(result!.section, "1");
  });

  it("resolves case variation", () => {
    const index = addOrReplaceEntry(
      emptyEuActIndex(),
      entry({ titlesByLanguage: { eng: GDPR_FULL_TITLE } }),
    );
    const result = resolveEuHumanCitation(`ART. 1 ${GDPR_FULL_TITLE.toUpperCase()}`, index);
    assert.ok(result);
    assert.equal(result!.euCelex, "32016R0679");
  });

  it("resolves whitespace variation", () => {
    const index = addOrReplaceEntry(
      emptyEuActIndex(),
      entry({ titlesByLanguage: { eng: GDPR_FULL_TITLE } }),
    );
    const result = resolveEuHumanCitation(`  Art.   1   ${GDPR_FULL_TITLE.replace(/\s+/g, "   ")}  `, index);
    assert.ok(result);
    assert.equal(result!.euCelex, "32016R0679");
  });

  it("treats multiple languages of one entry as one identity", () => {
    const index = addOrReplaceEntry(
      emptyEuActIndex(),
      entry({ titlesByLanguage: { eng: "Same Title", deu: "Same Title" } }),
    );
    const result = resolveEuHumanCitation("Art. 1 Same Title", index);
    assert.ok(result);
    assert.equal(result!.euCelex, "32016R0679");
  });

  it("returns null when the same normalized title identifies two CELEX entries", () => {
    const index = addOrReplaceEntry(
      emptyEuActIndex(),
      entry({ celex: "32016R0679", titlesByLanguage: { eng: "Same Title" } }),
    );
    const index2 = addOrReplaceEntry(
      index,
      entry({ celex: "32022R2065", titlesByLanguage: { eng: "Same Title" } }),
    );
    assert.equal(resolveEuHumanCitation("Same Title", index2), null);
  });

  it("returns null for a partial title", () => {
    const index = addOrReplaceEntry(
      emptyEuActIndex(),
      entry({ titlesByLanguage: { eng: GDPR_FULL_TITLE } }),
    );
    assert.equal(resolveEuHumanCitation("Art. 1 Regulation (EU)", index), null);
  });

  it("returns null for a fuzzy title", () => {
    const index = addOrReplaceEntry(
      emptyEuActIndex(),
      entry({ titlesByLanguage: { eng: GDPR_FULL_TITLE } }),
    );
    assert.equal(resolveEuHumanCitation("Art. 1 GDPR regulation", index), null);
  });

  it("returns null only for index-dependent title lookup when no index is provided", () => {
    const title = "Regulation (EU) 2016/679 of the European Parliament and of the Council";
    assert.equal(resolveEuHumanCitation(`Art. 1 ${title}`, null), null);
    assert.ok(resolveEuHumanCitation("Art. 1 Verordnung (EU) 2024/1689", null));
  });
});

describe("EU human citation resolver existing regressions", () => {
  it("preserves direct generic CELEX parsing", () => {
    const result = parseLawReferenceWithSelectedJurisdiction("CELEX 32016R0679 Art. 6", "EU");
    assert.ok(result);
    assert.equal(result!.euCelex, "32016R0679");
  });

  it("preserves six-digit CELEX parsing", () => {
    const result = parseLawReferenceWithSelectedJurisdiction("Art. 1 CELEX 32016R123456", "EU");
    assert.ok(result);
    assert.equal(result!.euCelex, "32016R123456");
  });

  it("preserves curated aliases", () => {
    const result = parseLawReferenceWithSelectedJurisdiction("DSGVO Art. 6", "EU");
    assert.ok(result);
    assert.equal(result!.euCelex, "32016R0679");
  });

  it("rejects unsupported CELEX", () => {
    assert.equal(parseLawReferenceWithSelectedJurisdiction("CELEX 02016R0679 Art. 1", "EU"), null);
  });

  it("does not resolve German references as EU", () => {
    const result = parseLawReferenceWithSelectedJurisdiction("BGB § 823", "DE");
    assert.ok(result);
    assert.equal(result!.jurisdiction, undefined);
  });

  it("does not resolve Austrian references as EU", () => {
    const result = parseLawReferenceWithSelectedJurisdiction("AT ABGB § 1295", "AT");
    assert.ok(result);
    assert.equal(result!.jurisdiction, "AT");
  });

  it("does not resolve Swiss references as EU", () => {
    const result = parseLawReferenceWithSelectedJurisdiction("BV Art. 1", "CH");
    assert.ok(result);
    assert.equal(result!.jurisdiction, "CH");
  });

  it("preserves existing EU language selection", () => {
    const result = parseLawReferenceWithSelectedJurisdiction("DSGVO Art. 6", "EU");
    assert.ok(result);
    assert.equal(result!.euCelex, "32016R0679");
  });

  it("does not fall back to another language when index is stale", () => {
    const index = addOrReplaceEntry(
      emptyEuActIndex(),
      entry({ availableLanguages: ["deu"] }),
    );
    const result = parseLawReferenceWithSelectedJurisdiction("32016R0679 Art. 6", "EU", index);
    assert.ok(result);
    assert.equal(result!.euCelex, "32016R0679");
  });
});

describe("EU human citation resolver modal integration", () => {
  const GDPR_CELEX = "32016R0679";

  function buildHarness(index: EuActIndex | null) {
    FakeSetting.instances = [];
    const requests: Array<{ language?: string; euCelex?: string }> = [];
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
    return { requests, inputEl, jurisdictionSelect };
  }

  async function runLookup(harness: ReturnType<typeof buildHarness>, input: string): Promise<void> {
    harness.inputEl.value = input;
    harness.inputEl.fire("keydown", { key: "Enter" });
    await settle();
  }

  it("passes the current EuActIndex to EU human citation resolution", async () => {
    const index = addOrReplaceEntry(
      emptyEuActIndex(),
      entry({ titlesByLanguage: { eng: "Human Title" } }),
    );
    const harness = buildHarness(index);
    await runLookup(harness, "Art. 1 Human Title");
    assert.equal(harness.requests.length, 1);
    assert.equal(harness.requests[0].euCelex, GDPR_CELEX);
  });

  it("uses the same index-aware resolution for available-language derivation", async () => {
    const index = addOrReplaceEntry(
      emptyEuActIndex(),
      entry({ titlesByLanguage: { eng: "Human Title" }, availableLanguages: ["fra", "deu"] }),
    );
    const harness = buildHarness(index);
    await runLookup(harness, "Art. 1 Human Title");
    const settingsWithDropdowns = FakeSetting.instances.filter((s) => s.dropdowns.length > 0);
    assert.ok(settingsWithDropdowns.length > 0);
    const dropdown = settingsWithDropdowns[settingsWithDropdowns.length - 1].dropdowns[0];
    assert.ok(dropdown.options.some((option) => option.value === "fra"));
  });

  it("generates exactly one provider request for a unique official-title citation", async () => {
    const index = addOrReplaceEntry(
      emptyEuActIndex(),
      entry({ titlesByLanguage: { eng: "Human Title" } }),
    );
    const harness = buildHarness(index);
    await runLookup(harness, "Art. 1 Human Title");
    assert.equal(harness.requests.length, 1);
    assert.equal(harness.requests[0].euCelex, GDPR_CELEX);
  });

  it("generates zero provider requests for an ambiguous title", async () => {
    let index = addOrReplaceEntry(
      emptyEuActIndex(),
      entry({ celex: "32016R0679", titlesByLanguage: { eng: "Same Title" } }),
    );
    index = addOrReplaceEntry(
      index,
      entry({ celex: "32022R2065", documentType: "R", year: "2022", number: "2065", titlesByLanguage: { eng: "Same Title" } }),
    );
    const harness = buildHarness(index);
    await runLookup(harness, "Art. 1 Same Title");
    assert.equal(harness.requests.length, 0);
  });

  it("preserves selected official text language", async () => {
    const index = addOrReplaceEntry(
      emptyEuActIndex(),
      entry({ titlesByLanguage: { eng: "Human Title" } }),
    );
    const harness = buildHarness(index);
    await runLookup(harness, "Art. 1 Human Title");
    assert.equal(harness.requests.length, 1);
    assert.equal(harness.requests[0].language, "fra");
    assert.equal(harness.requests[0].euCelex, GDPR_CELEX);
  });
});
