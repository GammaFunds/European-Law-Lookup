import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { resolve } from "node:path";
import { getSupportedFedlexLaws } from "../src/law/providers/fedlexMapping";
import {
  chOfficialLawTitles,
  EXPECTED_CH_OFFICIAL_TITLE_TUPLES,
} from "./fixtures/chOfficialLawTitles";

type Child = FakeElement;

class FakeElement {
  parent: FakeElement | null = null;
  children: Child[] = [];
  attributes = new Map<string, string>();
  className = "";
  textContent = "";
  value = "";
  tabIndex = 0;
  id = "";

  createDiv(options?: { cls?: string; text?: string }): FakeElement {
    return this.createElement("div", options);
  }

  createEl(tag: string, options?: { cls?: string; text?: string; value?: string; attr?: Record<string, string> }): FakeElement {
    return this.createElement(tag, options);
  }

  createSpan(options?: { cls?: string; text?: string }): FakeElement {
    return this.createElement("span", options);
  }

  private createElement(tag: string, options?: { cls?: string; text?: string; value?: string; attr?: Record<string, string> }): FakeElement {
    const child = new FakeElement();
    child.tagName = tag.toUpperCase();
    child.parent = this;
    child.className = options?.cls ?? "";
    child.textContent = options?.text ?? "";
    child.value = options?.value ?? "";
    for (const [name, value] of Object.entries(options?.attr ?? {})) child.setAttribute(name, value);
    this.children.push(child);
    return child;
  }

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
  addClass(className: string): void {
    this.className = this.className ? `${this.className} ${className}` : className;
  }
}

class FakeSetting {
  constructor(public readonly containerEl: FakeElement) {}
  settingEl = this.containerEl;
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
  static requestUrlCalls = 0;
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
  settingsTab?: { containerEl: FakeElement; getSettingDefinitions(): Array<{ render?: (setting: FakeSetting, group: unknown) => void }> };
  commands: Array<{ callback?: () => void }> = [];
  storedData: Record<string, unknown> | null = null;
  addSettingTab(tab: { containerEl: FakeElement; getSettingDefinitions(): Array<{ render?: (setting: FakeSetting, group: unknown) => void }> }): void {
    tab.containerEl = new FakeElement();
    this.settingsTab = tab;
  }
  async loadData(): Promise<Record<string, unknown> | null> { return this.storedData; }
  async saveData(data: Record<string, unknown>): Promise<void> { this.storedData = data; }
  addCommand(command: { callback?: () => void }): void { this.commands.push(command); }
  registerEvent(): void {}
}

class FakePluginSettingTab {
  containerEl = new FakeElement();
  constructor(public app: unknown, public plugin: unknown) {}
}

class FakeModal {
  static instances: FakeModal[] = [];
  contentEl = new FakeElement();

  constructor(_app?: unknown) {
    FakeModal.instances.push(this);
  }

  open(): void { (this as FakeModal & { onOpen?: () => void }).onOpen?.(); }
  close(): void { (this as FakeModal & { onClose?: () => void }).onClose?.(); }
}
class FakeNotice {}
class FakeMarkdownView {}

function loadPlugin(
  locale = "de",
  storedData: Record<string, unknown> | null = null,
): { plugin: FakePlugin; container: FakeElement } {
  FakeModal.instances = [];
  FakePlugin.requestUrlCalls = 0;
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
    requestUrl: async () => {
      FakePlugin.requestUrlCalls += 1;
      return { status: 200, text: "", json: async () => ({}) };
    },
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

function renderSettingsTab(tab: FakePlugin["settingsTab"]): FakeElement {
  assert.ok(tab);
  const definition = tab.getSettingDefinitions().find((candidate) => candidate.render);
  assert.ok(definition?.render);
  const container = new FakeElement();
  definition.render(new FakeSetting(container), {});
  return container;
}

describe("EU Settings input-format presentation", () => {
  it("defaults a missing jurisdiction to EU and exposes the required order", async () => {
    const { plugin } = loadPlugin("en", {});
    await (plugin as unknown as { onload(): Promise<void> }).onload();
    const settings = (plugin as unknown as { getSettings(): { defaultJurisdiction: string } }).getSettings();
    assert.equal(settings.defaultJurisdiction, "EU");

    const tab = plugin.settingsTab as unknown as {
      getSettingDefinitions(): Array<{ control?: { key?: string; options?: Record<string, string> } }>;
    };
    const definition = tab.getSettingDefinitions().find((candidate) => candidate.control?.key === "defaultJurisdiction");
    assert.deepEqual(Object.keys(definition?.control?.options ?? {}), ["EU", "DE", "AT", "CH"]);
  });

  it("uses persisted default jurisdiction through the production command without provider requests", async () => {
    const { plugin } = loadPlugin("en", { defaultJurisdiction: "CH" });
    await (plugin as unknown as { onload(): Promise<void> }).onload();
    await new Promise<void>((resolve) => setImmediate(resolve));
    FakePlugin.requestUrlCalls = 0;

    plugin.commands[0]?.callback?.();

    const modal = FakeModal.instances[0];
    assert.ok(modal, "expected the law lookup modal");
    const form = modal.contentEl.children[1];
    const jurisdictionSelect = form.children.find((child) => child.tagName === "SELECT");
    assert.equal(jurisdictionSelect?.value, "CH");
    assert.equal(FakePlugin.requestUrlCalls, 0);
  });

  it("round-trips supported jurisdiction values and fails malformed data back to EU", async () => {
    for (const jurisdiction of ["EU", "DE", "AT", "CH"] as const) {
      const { plugin } = loadPlugin("en", { defaultJurisdiction: jurisdiction });
      await (plugin as unknown as { onload(): Promise<void> }).onload();
      assert.equal(
        (plugin as unknown as { getSettings(): { defaultJurisdiction: string } }).getSettings().defaultJurisdiction,
        jurisdiction,
      );
    }

    const { plugin } = loadPlugin("en", { defaultJurisdiction: "invalid" });
    await (plugin as unknown as { onload(): Promise<void> }).onload();
    assert.equal(
      (plugin as unknown as { getSettings(): { defaultJurisdiction: string } }).getSettings().defaultJurisdiction,
      "EU",
    );
  });

  it("persists a changed default jurisdiction without changing existing language settings", async () => {
    const { plugin } = loadPlugin("en", { defaultEuLawLanguage: "fr", defaultChLawLanguage: "it" });
    await (plugin as unknown as { onload(): Promise<void> }).onload();
    const tab = plugin.settingsTab as unknown as { setControlValue(key: string, value: unknown): Promise<void> };
    await tab.setControlValue("defaultJurisdiction", "CH");
    const settings = (plugin as unknown as { getSettings(): { defaultJurisdiction: string; defaultEuLawLanguage: string; defaultChLawLanguage: string } }).getSettings();
    assert.equal(settings.defaultJurisdiction, "CH");
    assert.equal(settings.defaultEuLawLanguage, "fr");
    assert.equal(settings.defaultChLawLanguage, "it");
  });

  it("keeps the documentation block in a full-width vertical settings flow", () => {
    const styles = readFileSync(resolve(__dirname, "../../styles.css"), "utf8");
    assert.match(
      styles,
      /\.de-law-settings-supported-setting\s*\{[^}]*display:\s*flex;[^}]*flex-direction:\s*column;[^}]*align-items:\s*stretch;/s,
    );
    assert.doesNotMatch(styles, /:has\(/);
  });

  it("defaults missing input layout data to one-line mode", async () => {
    const { plugin } = loadPlugin("en", {});
    await (plugin as unknown as { onload(): Promise<void> }).onload();
    assert.equal((plugin as unknown as { getSettings(): { inputLayout: string } }).getSettings().inputLayout, "single");
  });

  it("persists the two-field input layout through plugin settings", async () => {
    const { plugin } = loadPlugin("en", {});
    await (plugin as unknown as { onload(): Promise<void> }).onload();
    const tab = plugin.settingsTab as unknown as {
      getSettingDefinitions(): Array<{ control?: { key?: string; options?: Record<string, string> } }>;
      setControlValue(key: string, value: unknown): Promise<void>;
    };
    const layoutDefinition = tab.getSettingDefinitions().find((definition) => definition.control?.key === "inputLayout");
    assert.deepEqual(layoutDefinition?.control?.options, {
      single: "One line",
      split: "Two fields",
    });
    await tab.setControlValue("inputLayout", "split");
    assert.equal((plugin as unknown as { getSettings(): { inputLayout: string } }).getSettings().inputLayout, "split");
    assert.equal((plugin as unknown as { storedData: Record<string, unknown> }).storedData.inputLayout, "split");
  });

  it("transitions an empty active modal through the real settings path", async () => {
    const { plugin } = loadPlugin("en", {});
    await (plugin as unknown as { onload(): Promise<void> }).onload();
    plugin.commands[0]?.callback?.();
    assert.equal(FakeModal.instances.length, 1);

    const modal = FakeModal.instances[0];
    const form = modal.contentEl.children[1];
    assert.equal(form.children.filter((child) => child.className.includes("de-law-law-input")).length, 0);

    const tab = plugin.settingsTab as unknown as { setControlValue(key: string, value: unknown): Promise<void> };
    await tab.setControlValue("inputLayout", "split");

    assert.equal(form.children.filter((child) => child.className === "de-law-law-input").length, 1);
    assert.equal(form.children.filter((child) => child.className === "de-law-reference-input").length, 1);
  });

  it("cleans up the active modal across close and replacement cycles", async () => {
    const { plugin } = loadPlugin("en", {});
    await (plugin as unknown as { onload(): Promise<void> }).onload();
    const tab = plugin.settingsTab as unknown as { setControlValue(key: string, value: unknown): Promise<void> };

    plugin.commands[0]?.callback?.();
    const firstModal = FakeModal.instances[0] as FakeModal & { setInputLayout: (layout: string) => boolean };
    firstModal.close();
    let firstCalls = 0;
    firstModal.setInputLayout = () => { firstCalls += 1; return true; };
    await tab.setControlValue("inputLayout", "split");
    assert.equal(firstCalls, 0);

    plugin.commands[0]?.callback?.();
    const secondModal = FakeModal.instances[1] as FakeModal & { setInputLayout: (layout: string) => boolean };
    let secondCalls = 0;
    secondModal.setInputLayout = () => { secondCalls += 1; return true; };
    await tab.setControlValue("inputLayout", "single");
    assert.equal(secondCalls, 1);
  });

  it("renders the supported-laws presentation through the declarative definition", async () => {
    const { plugin } = loadPlugin();
    await (plugin as unknown as { onload(): Promise<void> }).onload();
    const container = renderSettingsTab(plugin.settingsTab);
    assert.equal(container.className, "de-law-settings-supported-setting");
    const euPanel = container.children.find((child) => child.id === "de-law-jurisdiction-panel-eu");
    assert.ok(euPanel);
    assert.equal(euPanel.children.find((child) => child.className === "de-law-settings-supported-table")?.children.length, 5);
    assert.equal(container.children.find((child) => child.className === "de-law-settings-jurisdiction-tabs")?.attributes.get("role"), "tablist");

    const french = loadPlugin("fr", { defaultChLawLanguage: "it" });
    await (french.plugin as unknown as { onload(): Promise<void> }).onload();
    const frenchContainer = renderSettingsTab(french.plugin.settingsTab);
    const swissPanel = frenchContainer.children.find((child) => child.id === "de-law-jurisdiction-panel-switzerland")!;
    const swissTable = swissPanel.children.find((child) => child.className === "de-law-settings-supported-table")!;
    const bvRow = swissTable.children.find((row) => row.children[0].textContent === "BV")!;
    assert.equal(bvRow.children[1].textContent, chOfficialLawTitles["https://fedlex.data.admin.ch/eli/cc/1999/404"].fr);
  });

  it("renders each accepted EU input separately in a structured row", async () => {
    const { plugin } = loadPlugin();
    await (plugin as unknown as { onload(): Promise<void> }).onload();
    const container = renderSettingsTab(plugin.settingsTab);

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
      const container = renderSettingsTab(plugin.settingsTab);
      const panel = container.children.find(
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
      const container = renderSettingsTab(plugin.settingsTab);
      const panel = container.children.find(
        (child) => child.id === "de-law-jurisdiction-panel-switzerland",
      )!;
      const table = panel.children.find((child) => child.className === "de-law-settings-supported-table")!;
      const rows = table.children.filter((child) => child.className === "de-law-settings-supported-row");
      const bvRow = rows.find((row) => row.children[0].textContent === "BV")!;
      assert.equal(bvRow.children[1].textContent, chOfficialLawTitles["https://fedlex.data.admin.ch/eli/cc/1999/404"][titleLanguage]);
    }
  });
});
