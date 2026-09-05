import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { getSupportedFedlexLaws } from "../src/law/providers/fedlexMapping";
import {
  chOfficialLawTitles,
  EXPECTED_CH_OFFICIAL_TITLE_TUPLES,
} from "./fixtures/chOfficialLawTitles";

type Child = FakeElement;

class FakeElement {
  children: Child[] = [];
  attributes = new Map<string, string>();
  className = "";
  textContent = "";
  tabIndex = 0;
  id = "";

  createDiv(options?: { cls?: string; text?: string }): FakeElement {
    return this.createElement("div", options);
  }

  createEl(tag: string, options?: { cls?: string; text?: string; attr?: Record<string, string> }): FakeElement {
    return this.createElement(tag, options);
  }

  createSpan(options?: { cls?: string; text?: string }): FakeElement {
    return this.createElement("span", options);
  }

  private createElement(tag: string, options?: { cls?: string; text?: string; attr?: Record<string, string> }): FakeElement {
    const child = new FakeElement();
    child.tagName = tag.toUpperCase();
    child.className = options?.cls ?? "";
    child.textContent = options?.text ?? "";
    for (const [name, value] of Object.entries(options?.attr ?? {})) child.setAttribute(name, value);
    this.children.push(child);
    return child;
  }

  tagName = "DIV";

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }

  removeAttribute(name: string): void {
    this.attributes.delete(name);
  }

  empty(): void {
    this.children = [];
  }

  addEventListener(): void {}

  focus(): void {}
}

class FakeSetting {
  constructor(_container: FakeElement) {}
  setName(): FakeSetting { return this; }
  setDesc(): FakeSetting { return this; }
  setHeading(): FakeSetting { return this; }
  addToggle(configure: (toggle: FakeToggle) => void): FakeSetting {
    configure(new FakeToggle());
    return this;
  }
  addDropdown(configure: (dropdown: FakeDropdown) => void): FakeSetting {
    configure(new FakeDropdown());
    return this;
  }
  addText(configure: (text: FakeText) => void): FakeSetting {
    configure(new FakeText());
    return this;
  }
}

class FakeToggle {
  setValue(): FakeToggle { return this; }
  onChange(): FakeToggle { return this; }
}

class FakeDropdown {
  addOption(): FakeDropdown { return this; }
  setValue(): FakeDropdown { return this; }
  onChange(): FakeDropdown { return this; }
}

class FakeText {
  inputEl = { type: "" };
  setDisabled(): FakeText { return this; }
  setPlaceholder(): FakeText { return this; }
  setValue(): FakeText { return this; }
  onChange(): FakeText { return this; }
}

class FakePlugin {
  app = { vault: {
    configDir: ".obsidian",
    adapter: {
      async exists(): Promise<boolean> { return false; },
      async read(): Promise<string> { throw new Error("settings test index file must not be read"); },
      async write(): Promise<void> {},
      async remove(): Promise<void> {},
    },
  } };
  manifest = { id: "german-law-lookup" };
  settingsTab?: { containerEl: FakeElement; display(): void };
  storedData: Record<string, unknown> | null = null;
  addSettingTab(tab: { containerEl: FakeElement; display(): void }): void {
    tab.containerEl = new FakeElement();
    this.settingsTab = tab;
  }
  async loadData(): Promise<Record<string, unknown> | null> { return this.storedData; }
  async saveData(): Promise<void> {}
  addCommand(): void {}
  registerEvent(): void {}
}

class FakePluginSettingTab {
  containerEl = new FakeElement();
  constructor(public app: unknown, public plugin: unknown) {}
}

class FakeModal {}
class FakeNotice {}
class FakeMarkdownView {}

function loadPlugin(
  locale = "de",
  storedData: Record<string, unknown> | null = null,
): { plugin: FakePlugin; container: FakeElement } {
  const stubPath = "/tmp/obsidian-settings-layout-stub.cjs";
  const nodeModule = require("node:module") as typeof import("node:module");
  const moduleWithHooks = nodeModule as unknown as {
    _resolveFilename: (request: string, ...rest: unknown[]) => string;
    _cache: Record<string, unknown>;
  };
  const originalResolve = moduleWithHooks._resolveFilename;
  const originalCache = moduleWithHooks._cache[stubPath];
  const stub = new nodeModule(stubPath);
  stub.exports = {
    Plugin: FakePlugin,
    PluginSettingTab: FakePluginSettingTab,
    Modal: FakeModal,
    Notice: FakeNotice,
    MarkdownView: FakeMarkdownView,
    Setting: FakeSetting,
    requestUrl: async () => ({ status: 200, text: "", json: async () => ({}) }),
    moment: { locale: () => locale },
  };
  stub.loaded = true;
  moduleWithHooks._resolveFilename = function (request: string, ...rest: unknown[]) {
    return request === "obsidian" ? stubPath : originalResolve.call(this, request, ...rest);
  };
  moduleWithHooks._cache[stubPath] = stub;
  try {
    delete require.cache[require.resolve("../../main.js")];
    const PluginConstructor = require("../../main.js").default as new (app: unknown) => FakePlugin;
    const plugin = new PluginConstructor({} );
    plugin.storedData = storedData;
    return { plugin, container: (plugin as FakePlugin).settingsTab?.containerEl ?? new FakeElement() };
  } finally {
    moduleWithHooks._resolveFilename = originalResolve;
    if (originalCache === undefined) delete moduleWithHooks._cache[stubPath];
    else moduleWithHooks._cache[stubPath] = originalCache;
  }
}

describe("EU Settings input-format presentation", () => {
  it("renders each accepted EU input separately in a structured row", async () => {
    const { plugin } = loadPlugin();
    await (plugin as unknown as { onload(): Promise<void> }).onload();
    const container = (plugin as FakePlugin).settingsTab!.containerEl;
    (plugin as FakePlugin).settingsTab!.display();

    const euPanel = container.children.find((child) => child.id === "de-law-jurisdiction-panel-eu")!;
    const table = euPanel.children.find((child) => child.className === "de-law-settings-supported-table")!;
    const rows = table.children.filter((child) => child.className.includes("de-law-settings-supported-row"));
    assert.equal(rows.length, 5);
    assert.deepEqual(rows.map((row) => row.children[0].textContent), [
      "Direkte CELEX-Fundstelle",
      "Strukturierte Fundstelle — Artikel zuerst",
      "Strukturierte Fundstelle — Rechtsakt zuerst",
      "Bekanntes Alias",
      "Exakter amtlicher Titel",
    ]);
    assert.deepEqual(rows.slice(1, 4).map((row) => row.children[1].children.map((example) => example.textContent)), [
      ["Art. 1 Verordnung (EU) 2016/679"],
      ["Verordnung (EU) 2016/679 Art. 1"],
      ["Art. 1 AI Act", "AI Act Art. 1", "Art. 1 Data Act"],
    ]);

    const firstRow = rows[0];
    assert.equal(firstRow.children.length, 2);
    assert.equal(firstRow.children[0].className, "de-law-settings-supported-format-label");
    assert.equal(firstRow.children[1].className, "de-law-settings-supported-example-list");
    const examples = firstRow.children[1].children;
    assert.deepEqual(examples.map((example) => example.textContent), [
      "Art. 1 32016R0679",
      "32016R0679 Art. 1",
      "CELEX: 32016R0679 Art. 1",
    ]);
    assert.deepEqual(examples.map((example) => example.tagName), ["CODE", "CODE", "CODE"]);
    assert.ok(!examples.some((example) => example.textContent.includes(";")));

    const exactTitleRow = rows[4];
    assert.equal(exactTitleRow.children[1].children.length, 1);
    assert.equal(exactTitleRow.children[1].children[0].textContent, "Art. 1 Verordnung (EU) 2016/679 des Europäischen Parlaments und des Rates vom 27. April 2016 zum Schutz natürlicher Personen bei der Verarbeitung personenbezogener Daten, zum freien Datenverkehr und zur Aufhebung der Richtlinie 95/46/EG (Datenschutz-Grundverordnung) (Text von Bedeutung für den EWR)");

    const tabs = container.children.find((child) => child.className === "de-law-settings-jurisdiction-tabs")!;
    assert.equal(tabs.attributes.get("role"), "tablist");
    assert.deepEqual(tabs.children.map((tab) => tab.attributes.get("role")), ["tab", "tab", "tab", "tab"]);
  });
});

const legacyLawTitles: Record<string, string> = {
  AIG: "Ausländer- und Integrationsgesetz",
  AHVG: "Bundesgesetz über die Alters- und Hinterlassenenversicherung",
  ArG: "Bundesgesetz über die Arbeit in Industrie, Gewerbe und Handel",
  ATSG: "Bundesgesetz über den Allgemeinen Teil des Sozialversicherungsrechts",
  BGG: "Bundesgerichtsgesetz",
  BV: "Bundesverfassung der Schweizerischen Eidgenossenschaft",
  DBG: "Bundesgesetz über die direkte Bundessteuer",
  DSG: "Datenschutzgesetz",
  IPRG: "Bundesgesetz über das Internationale Privatrecht",
  IVG: "Bundesgesetz über die Invalidenversicherung",
  KG: "Bundesgesetz über Kartelle und andere Wettbewerbsbeschränkungen",
  MSchG: "Bundesgesetz über den Schutz von Marken und Herkunftsangaben",
  OR: "Obligationenrecht",
  PatG: "Bundesgesetz über die Erfindungspatente",
  SchKG: "Bundesgesetz über Schuldbetreibung und Konkurs",
  StGB: "Schweizerisches Strafgesetzbuch",
  StPO: "Schweizerische Strafprozessordnung",
  StHG: "Bundesgesetz über die Harmonisierung der direkten Steuern der Kantone und Gemeinden",
  SVG: "Strassenverkehrsgesetz",
  URG: "Bundesgesetz über das Urheberrecht und verwandte Schutzrechte",
  VwVG: "Verwaltungsverfahrensgesetz",
  ZGB: "Zivilgesetzbuch",
  ZPO: "Schweizerische Zivilprozessordnung",
};

describe("Swiss official Settings titles", () => {
  it("requires all 23 production entries to expose independent official titles", () => {
    const laws = getSupportedFedlexLaws() as unknown as ReadonlyArray<{
      displayLawCode: string;
      lawTitle: string;
      workUri: string;
      officialTitlesByLanguage: { de: string; fr: string; it: string };
    }>;
    assert.equal(laws.length, 23);
    assert.equal(Object.keys(chOfficialLawTitles).length, 23);
    assert.equal(EXPECTED_CH_OFFICIAL_TITLE_TUPLES, 69);
    assert.equal(
      Object.values(chOfficialLawTitles).flatMap((titles) => [titles.de, titles.fr, titles.it]).length,
      69,
    );
    for (const law of laws) {
      assert.ok(chOfficialLawTitles[law.workUri], `missing fixture identity for ${law.displayLawCode}`);
      assert.deepEqual(law.officialTitlesByLanguage, chOfficialLawTitles[law.workUri]);
    }
  });

  it("preserves every legacy lawTitle independently of official titles", () => {
    const laws = getSupportedFedlexLaws();
    assert.equal(laws.length, Object.keys(legacyLawTitles).length);
    for (const law of laws) assert.equal(law.lawTitle, legacyLawTitles[law.displayLawCode]);
  });

  for (const [locale, language] of [["de", "de"], ["fr", "fr"], ["it", "it"], ["en", "de"]] as const) {
    it(`${locale} UI renders the ${language} official Swiss title`, async () => {
      const { plugin } = loadPlugin(locale, { defaultChLawLanguage: "fr" });
      await (plugin as unknown as { onload(): Promise<void> }).onload();
      plugin.settingsTab!.display();
      const panel = plugin.settingsTab!.containerEl.children.find(
        (child) => child.id === "de-law-jurisdiction-panel-switzerland",
      )!;
      const table = panel.children.find((child) => child.className === "de-law-settings-supported-table")!;
      const rows = table.children.filter((child) => child.className === "de-law-settings-supported-row");
      const bvRow = rows.find((row) => row.children[0].textContent === "BV")!;
      assert.equal(bvRow.children[1].textContent, chOfficialLawTitles["https://fedlex.data.admin.ch/eli/cc/1999/404"][language]);
    });
  }

  it("keeps Settings title language independent from the selected Swiss text language", async () => {
    for (const [locale, textLanguage, titleLanguage] of [
      ["fr", "it", "fr"],
      ["it", "de", "it"],
      ["en", "fr", "de"],
    ] as const) {
      const { plugin } = loadPlugin(locale, { defaultChLawLanguage: textLanguage });
      await (plugin as unknown as { onload(): Promise<void> }).onload();
      assert.equal((plugin as unknown as { getSettings(): { defaultChLawLanguage: string } }).getSettings().defaultChLawLanguage, textLanguage);
      plugin.settingsTab!.display();
      const panel = plugin.settingsTab!.containerEl.children.find(
        (child) => child.id === "de-law-jurisdiction-panel-switzerland",
      )!;
      const table = panel.children.find((child) => child.className === "de-law-settings-supported-table")!;
      const rows = table.children.filter((child) => child.className === "de-law-settings-supported-row");
      const bvRow = rows.find((row) => row.children[0].textContent === "BV")!;
      assert.equal(bvRow.children[1].textContent, chOfficialLawTitles["https://fedlex.data.admin.ch/eli/cc/1999/404"][titleLanguage]);
    }
  });
});
