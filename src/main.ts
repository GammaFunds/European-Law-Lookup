import {
  App,
  Plugin,
  PluginSettingTab,
  requestUrl,
  Setting,
  moment,
  type SettingDefinitionItem,
} from "obsidian";
import {
  StoredLawSectionCache,
  type LawSectionCacheStorage,
} from "./law/LawSectionCache";
import { ProviderRegistry } from "./law/ProviderRegistry";
import { buildCachedLawProviders } from "./law/cachedProviderComposition";
import {
  createCellarSparqlJsonFetcher,
  createObsidianRequestUrlTransport,
} from "./law/httpTransport";
import { buildLawProviders } from "./law/providerComposition";
import {
  getSupportedGesetzeImInternetLaws,
} from "./law/providers/gesetzeImInternetMapping";
import {
  getSupportedRisLaws,
} from "./law/providers/risMapping";
import {
  getSupportedFedlexLaws,
} from "./law/providers/fedlexMapping";
import { getSupportedBoeLaws } from "./law/providers/boeMapping";
import { BoeLawDiscovery } from "./law/providers/BoeLawDiscovery";
import {
  normalizeFedlexLanguage,
  type OfficialTitlesByLanguage,
  type FedlexLanguage,
} from "./law/providers/fedlexMapping";
import type { LawJurisdiction, LawSection, LawSourceVariant } from "./law/types";
import type { EuLawLanguage } from "./law/types";
import { defaultEuLawLanguage } from "./law/euLanguages";
import {
  defaultLawSourceVariantForLanguage,
  getUiStrings,
  type UiStrings,
} from "./ui/i18n";
import {
  LawLookupModal,
  normalizeInputLayout,
  type InputLayout,
  type LawLookupModalIndexProvider,
} from "./ui/LawLookupModal";
import {
  parseStoredEuActIndex,
  type EuActIndex,
  type StoredEuActIndex,
} from "./law/euActIndex";
import {
  EuActIndexFileStorage,
  normalizeEuActIndexStoreMetadata,
  type EuActIndexStoreMetadata,
} from "./law/EuActIndexFileStorage";
import { AsyncSingleFlight } from "./law/AsyncSingleFlight";
import {
  bootstrapEuActIndex,
  reconcileEuActIndex,
  isIndexFresh,
} from "./law/euActIndexSync";
import {
  CellarMetadataClient,
  CELLAR_WORK_RDF_ACCEPT,
  type CellarMetadataTransport,
} from "./law/providers/CellarMetadataClient";
import { createEuActIndexLanguageAuthorizer } from "./law/providers/eurLexMapping";

const EU_ACT_INDEX_FRESHNESS_MS = 24 * 60 * 60 * 1000;

interface SupportedLaw {
  displayLawCode: string;
  lawTitle: string;
  referenceType: "section" | "article";
  exampleInputs: readonly string[];
  officialTitlesByLanguage?: OfficialTitlesByLanguage;
}

interface DeLawPluginSettings {
  enableMockLawProvider: boolean;
  enableLawSectionCache: boolean;
  lawSectionCacheTtlDays: number | null;
  defaultLawSourceVariant: LawSourceVariant;
  defaultJurisdiction: LawJurisdiction;
  defaultEuLawLanguage: EuLawLanguage;
  defaultChLawLanguage: FedlexLanguage;
  showInsertedSourceMetadata: boolean;
  inputLayout: InputLayout;
}

interface DeLawPluginData extends Partial<DeLawPluginSettings> {
  lawSectionCache?: Record<string, LawSection>;
  euActIndex?: StoredEuActIndex;
  euActIndexCandidate?: StoredEuActIndex;
  euActIndexStore?: EuActIndexStoreMetadata;
}

const DEFAULT_SETTINGS: DeLawPluginSettings = {
  enableMockLawProvider: false,
  enableLawSectionCache: true,
  lawSectionCacheTtlDays: null,
  defaultLawSourceVariant: "official-de",
  defaultJurisdiction: "EU",
  defaultEuLawLanguage: "de",
  defaultChLawLanguage: "de",
  showInsertedSourceMetadata: true,
  inputLayout: "single",
};

export default class DeLawPlugin extends Plugin {
  private providerRegistry!: ProviderRegistry;
  private pluginSettings: DeLawPluginSettings = { ...DEFAULT_SETTINGS };
  private euActIndex: EuActIndex | null = null;
  private euActIndexStorage!: EuActIndexFileStorage;
  private readonly euActIndexRefreshSingleFlight = new AsyncSingleFlight<void>();
  private dedicatedEuActIndexAuthorityValidated = false;
  private dedicatedEuActIndexUnavailable = false;
  private pluginData: DeLawPluginData = {};
  private pluginDataWriteTail: Promise<void> = Promise.resolve();
  private activeLawLookupModal: LawLookupModal | null = null;
  private readonly uiStrings = getUiStrings(safeGetObsidianLanguage());

  async onload() {
    this.pluginData = ((await this.loadData()) as DeLawPluginData | null) ?? {};
    this.pluginSettings = this.loadSettingsFromData(this.pluginData);
    this.euActIndexStorage = this.createEuActIndexStorage();
    this.euActIndex = await this.loadEuActIndex(this.euActIndexStorage);
    this.rebuildProviderRegistry();

    this.addSettingTab(new DeLawSettingsTab(this.app, this));

    this.addCommand({
      id: "deutsches-gesetz-nachschlagen",
      name: this.uiStrings.commandName,
      callback: () => {
        const modal = new LawLookupModal(
          this.app,
          this.providerRegistry,
          {
            getDefaultLawSourceVariant: () =>
              this.pluginSettings.defaultLawSourceVariant,
            setDefaultLawSourceVariant: async (value) => {
              await this.updateSettings({ defaultLawSourceVariant: value });
            },
            getDefaultJurisdiction: () => this.pluginSettings.defaultJurisdiction,
            getDefaultEuLawLanguage: () => this.pluginSettings.defaultEuLawLanguage,
            setDefaultEuLawLanguage: async (value) => { await this.updateSettings({ defaultEuLawLanguage: value }); },
            getDefaultChLawLanguage: () => this.pluginSettings.defaultChLawLanguage,
            setDefaultChLawLanguage: async (value) => { await this.updateSettings({ defaultChLawLanguage: value }); },
            getShowInsertedSourceMetadata: () =>
              this.pluginSettings.showInsertedSourceMetadata,
            setShowInsertedSourceMetadata: async (value) => {
              await this.updateSettings({ showInsertedSourceMetadata: value });
            },
            getInputLayout: () => this.pluginSettings.inputLayout,
            onClose: () => {
              if (this.activeLawLookupModal === modal) this.activeLawLookupModal = null;
            },
          },
          this.uiStrings,
          this.createIndexProvider(),
          new BoeLawDiscovery(createObsidianRequestUrlTransport(requestUrl)),
        );
        this.activeLawLookupModal = modal;
        modal.open();
      },
    });

    this.addCommand({
      id: "eu-act-index-refresh",
      name: this.uiStrings.refreshEuActIndex,
      callback: () => {
        void this.refreshEuActIndex();
      },
    });

    void this.refreshEuActIndexIfStale();
  }

  private createIndexProvider(): LawLookupModalIndexProvider {
    return { getEuActIndex: () => this.euActIndex };
  }

  private withoutLegacyEuActIndexData(current: DeLawPluginData): DeLawPluginData {
    const next = { ...current };
    delete next.euActIndex;
    delete next.euActIndexCandidate;
    return next;
  }

  private async cleanupLegacyEuActIndexData(): Promise<void> {
    if (!this.pluginData.euActIndex && !this.pluginData.euActIndexCandidate) return;
    try {
      await this.mutatePluginData((current) => this.withoutLegacyEuActIndexData(current));
    } catch {
      // Dedicated authority remains valid; a later plugin-data write retries cleanup.
    }
  }

  private async mutatePluginData(
    transform: (current: DeLawPluginData) => DeLawPluginData,
  ): Promise<void> {
    const run = this.pluginDataWriteTail.then(async () => {
      const transformed = transform(this.pluginData);
      const next = this.dedicatedEuActIndexAuthorityValidated
        ? this.withoutLegacyEuActIndexData(transformed)
        : transformed;
      await this.saveData(next);
      this.pluginData = next;
    });
    this.pluginDataWriteTail = run.catch(() => undefined);
    await run;
  }

  private createEuActIndexStorage(): EuActIndexFileStorage {
    const pluginDir = `${this.app.vault.configDir}/plugins/${this.manifest.id}`;
    return new EuActIndexFileStorage(
      pluginDir,
      this.app.vault.adapter,
      {
        read: () => normalizeEuActIndexStoreMetadata(this.pluginData.euActIndexStore),
        save: async (metadata) => {
          const previous = normalizeEuActIndexStoreMetadata(this.pluginData.euActIndexStore);
          const activatesValidatedCandidate = previous.candidateSlot !== null
            && metadata.activeSlot === previous.candidateSlot
            && metadata.candidateSlot === null;

          await this.mutatePluginData((current) => ({
            ...current,
            euActIndexStore: metadata,
          }));

          if (activatesValidatedCandidate) {
            this.dedicatedEuActIndexAuthorityValidated = true;
            await this.cleanupLegacyEuActIndexData();
          }
        },
        saveMigration: async (metadata) => {
          await this.mutatePluginData((current) => {
            const next: DeLawPluginData = {
              ...current,
              euActIndexStore: metadata,
            };
            delete next.euActIndex;
            delete next.euActIndexCandidate;
            return next;
          });
        },
      },
    );
  }

  private async loadEuActIndex(storage: EuActIndexFileStorage): Promise<EuActIndex | null> {
    const metadata = normalizeEuActIndexStoreMetadata(this.pluginData.euActIndexStore);
    if (metadata.activeSlot) {
      let dedicated: EuActIndex;
      try {
        const stored = await storage.loadRaw();
        if (!stored) {
          this.dedicatedEuActIndexUnavailable = true;
          return null;
        }
        dedicated = parseStoredEuActIndex(stored);
      } catch {
        // A recorded dedicated authority dominates legacy fallback. Read or
        // validation failure therefore fails closed for this session.
        this.dedicatedEuActIndexUnavailable = true;
        return null;
      }

      this.dedicatedEuActIndexUnavailable = false;
      this.dedicatedEuActIndexAuthorityValidated = true;
      await this.cleanupLegacyEuActIndexData();
      return dedicated;
    }

    this.dedicatedEuActIndexUnavailable = false;
    if (!this.pluginData.euActIndex) return null;

    let legacy: EuActIndex;
    try {
      legacy = parseStoredEuActIndex(this.pluginData.euActIndex);
    } catch {
      return null;
    }

    try {
      const migrated = await storage.migrateLegacy(this.pluginData.euActIndex);
      this.dedicatedEuActIndexAuthorityValidated = true;
      return migrated;
    } catch {
      // Keep the validated legacy last-known-good for this session and retry
      // migration on the next startup.
      return legacy;
    }
  }

  private createCellarTransport(): CellarMetadataTransport {
    return {
      fetchSparqlJson: createCellarSparqlJsonFetcher(requestUrl),
      fetchWorkRdf: async (celex: string) => {
        const response = await requestUrl({
          url: `https://publications.europa.eu/resource/celex/${celex}`,
          method: "GET",
          headers: { Accept: CELLAR_WORK_RDF_ACCEPT },
        });
        return response.text;
      },
    };
  }

  private refreshEuActIndex(): Promise<void> {
    if (this.dedicatedEuActIndexUnavailable) return Promise.resolve();
    return this.euActIndexRefreshSingleFlight.run(async () => {
      const client = new CellarMetadataClient(this.createCellarTransport());
      const storage = this.euActIndexStorage;
      try {
        const index = this.euActIndex
          ? await reconcileEuActIndex(client, storage)
          : await bootstrapEuActIndex(client, storage);
        this.euActIndex = index;
        this.rebuildProviderRegistry();
      } catch {
        // Preserve last-known-good index; direct CELEX lookup still works.
      }
    });
  }

  private async refreshEuActIndexIfStale(): Promise<void> {
    if (this.euActIndex && isIndexFresh(this.euActIndex, EU_ACT_INDEX_FRESHNESS_MS)) return;
    await this.refreshEuActIndex();
  }

  getSettings(): DeLawPluginSettings {
    return this.pluginSettings;
  }

  getUiStrings(): UiStrings & { defaultJurisdiction: string; defaultJurisdictionDescription: string } {
    return this.uiStrings;
  }

  async updateSettings(patch: Partial<DeLawPluginSettings>): Promise<void> {
    this.pluginSettings = {
      ...this.pluginSettings,
      ...patch,
    };
    await this.saveSettings();
    this.rebuildProviderRegistry();
    if (patch.inputLayout !== undefined) {
      this.activeLawLookupModal?.setInputLayout(this.pluginSettings.inputLayout);
    }
  }

  private rebuildProviderRegistry() {
    const authorizer = createEuActIndexLanguageAuthorizer(this.euActIndex);
    const runtimeProviders = buildLawProviders({
      ...this.pluginSettings,
      httpTransport: createObsidianRequestUrlTransport(requestUrl),
      requestUrl,
      euActLanguageAuthorizer: authorizer,
    });
    const cache = new StoredLawSectionCache(this.createLawSectionCacheStorage());
    this.providerRegistry = new ProviderRegistry(
      buildCachedLawProviders(runtimeProviders, cache, this.pluginSettings),
    );
  }

  private loadSettingsFromData(storedSettings: DeLawPluginData | null): DeLawPluginSettings {
    return {
      ...DEFAULT_SETTINGS,
      enableMockLawProvider: storedSettings?.enableMockLawProvider === true,
      enableLawSectionCache: storedSettings?.enableLawSectionCache !== false,
      lawSectionCacheTtlDays: normalizeTtlDays(storedSettings?.lawSectionCacheTtlDays),
      defaultLawSourceVariant: defaultLawSourceVariantForLanguage(
        safeGetObsidianLanguage(),
        storedSettings?.defaultLawSourceVariant,
      ),
      defaultJurisdiction: normalizeJurisdiction(storedSettings?.defaultJurisdiction),
      defaultEuLawLanguage: defaultEuLawLanguage(safeGetObsidianLanguage(), storedSettings?.defaultEuLawLanguage),
      defaultChLawLanguage: normalizeFedlexLanguage(storedSettings?.defaultChLawLanguage) ?? "de",
      showInsertedSourceMetadata:
        storedSettings?.showInsertedSourceMetadata !== false,
      inputLayout: normalizeInputLayout(storedSettings?.inputLayout),
    };
  }

  private async saveSettings(): Promise<void> {
    await this.mutatePluginData((current) => ({
      ...current,
      ...this.pluginSettings,
    }));
  }

  private createLawSectionCacheStorage(): LawSectionCacheStorage {
    return {
      load: async () => this.pluginData.lawSectionCache ?? null,
      save: async (entries) => {
        await this.mutatePluginData((current) => ({
          ...current,
          lawSectionCache: entries,
        }));
      },
    };
  }

}

class DeLawSettingsTab extends PluginSettingTab {
  constructor(
    app: App,
    private readonly plugin: DeLawPlugin,
  ) {
    super(app, plugin);
  }

  getSettingDefinitions(): SettingDefinitionItem[] {
    const ui = this.plugin.getUiStrings();
    const euLanguageOptions: Record<string, string> = {
      bg: "Български",
      es: "Español",
      cs: "Čeština",
      da: "Dansk",
      de: "Deutsch",
      et: "Eesti",
      el: "Ελληνικά",
      en: "English",
      fr: "Français",
      ga: "Gaeilge",
      hr: "Hrvatski",
      it: "Italiano",
      lv: "Latviešu",
      lt: "Lietuvių",
      hu: "Magyar",
      mt: "Malti",
      nl: "Nederlands",
      pl: "Polski",
      pt: "Português",
      ro: "Română",
      sk: "Slovenčina",
      sl: "Slovenščina",
      fi: "Suomi",
      sv: "Svenska",
    };
    return [
      {
        name: ui.enableLocalLawTextCache,
        desc: ui.enableLocalLawTextCacheDescription,
        control: { type: "toggle", key: "enableLawSectionCache" },
      },
      {
        name: ui.inputLayout,
        control: {
          type: "dropdown",
          key: "inputLayout",
          options: {
            single: ui.oneLineInputLayout,
            split: ui.twoFieldInputLayout,
          },
        },
      },
      {
        name: ui.defaultJurisdiction,
        desc: ui.defaultJurisdictionDescription,
        control: {
          type: "dropdown",
          key: "defaultJurisdiction",
          options: {
            EU: ui.jurisdictionEuropeanUnion,
            DE: ui.jurisdictionGermany,
            AT: ui.jurisdictionAustria,
            CH: ui.jurisdictionSwitzerland,
            ES: ui.jurisdictionSpain,
          },
        },
      },
      {
        name: ui.defaultEuTextLanguage,
        desc: ui.defaultEuTextLanguageDescription,
        control: {
          type: "dropdown",
          key: "defaultEuLawLanguage",
          options: euLanguageOptions,
        },
      },
      {
        name: ui.defaultLawTextSource,
        control: {
          type: "dropdown",
          key: "defaultLawSourceVariant",
          options: {
            "official-de": ui.germanOfficialText,
            "translation-en": ui.englishTranslationWhenAvailable,
          },
        },
      },
      {
        name: ui.cacheExpirationInDays,
        desc: ui.cacheExpirationInDaysDescription,
        control: {
          type: "text",
          key: "lawSectionCacheTtlDays",
          placeholder: ui.noExpirationPlaceholder,
          disabled: () => !this.plugin.getSettings().enableLawSectionCache,
        },
      },
      {
        name: ui.supportedLaws,
        render: (setting) => {
          setting.settingEl.addClass("de-law-settings-supported-setting");
          this.renderSupportedLawsPresentation(setting.settingEl);
        },
      },
    ];
  }

  getControlValue(key: string): unknown {
    const settings = this.plugin.getSettings();
    switch (key) {
      case "enableLawSectionCache": return settings.enableLawSectionCache;
      case "inputLayout": return settings.inputLayout;
      case "defaultJurisdiction": return settings.defaultJurisdiction;
      case "defaultEuLawLanguage": return settings.defaultEuLawLanguage;
      case "defaultLawSourceVariant": return settings.defaultLawSourceVariant;
      case "lawSectionCacheTtlDays": return settings.lawSectionCacheTtlDays == null ? "" : String(settings.lawSectionCacheTtlDays);
      default: return undefined;
    }
  }

  async setControlValue(key: string, value: unknown): Promise<void> {
    switch (key) {
      case "enableLawSectionCache":
        await this.plugin.updateSettings({ enableLawSectionCache: value === true });
        this.refreshDomState();
        return;
      case "inputLayout":
        await this.plugin.updateSettings({ inputLayout: normalizeInputLayout(value) });
        return;
      case "defaultJurisdiction":
        await this.plugin.updateSettings({ defaultJurisdiction: normalizeJurisdiction(value) });
        return;
      case "defaultEuLawLanguage":
        await this.plugin.updateSettings({ defaultEuLawLanguage: defaultEuLawLanguage(undefined, value) });
        return;
      case "defaultLawSourceVariant":
        await this.plugin.updateSettings({
          defaultLawSourceVariant: value === "translation-en" ? "translation-en" : "official-de",
        });
        return;
      case "lawSectionCacheTtlDays":
        await this.plugin.updateSettings({ lawSectionCacheTtlDays: normalizeTtlDays(value) });
        return;
      default:
        return;
    }
  }

  private renderSupportedLawsPresentation(containerEl: HTMLElement): void {
    const ui = this.plugin.getUiStrings();
    new Setting(containerEl).setName(ui.supportedLaws).setHeading();
    containerEl.createEl("p", {
      cls: "de-law-settings-supported-description",
      text: ui.supportedLawsDescription,
    });

    const tabsContainer = containerEl.createDiv({ cls: "de-law-settings-jurisdiction-tabs" });
    tabsContainer.setAttribute("role", "tablist");

    const tabDefs = [
      { label: ui.jurisdictionEuropeanUnion, tabId: "de-law-jurisdiction-tab-eu", panelId: "de-law-jurisdiction-panel-eu" },
      { label: ui.jurisdictionGermany, tabId: "de-law-jurisdiction-tab-germany", panelId: "de-law-jurisdiction-panel-germany" },
      { label: ui.jurisdictionAustria, tabId: "de-law-jurisdiction-tab-austria", panelId: "de-law-jurisdiction-panel-austria" },
      { label: ui.jurisdictionSwitzerland, tabId: "de-law-jurisdiction-tab-switzerland", panelId: "de-law-jurisdiction-panel-switzerland" },
      { label: ui.jurisdictionSpain, tabId: "de-law-jurisdiction-tab-spain", panelId: "de-law-jurisdiction-panel-spain" },
    ];

    const tabs: HTMLButtonElement[] = [];
    const panels: HTMLDivElement[] = [];

    for (const [i, def] of tabDefs.entries()) {
      const tab = tabsContainer.createEl("button", {
        cls: "de-law-settings-jurisdiction-tab",
        text: def.label,
        attr: { type: "button" },
      });
      tab.setAttribute("role", "tab");
      tab.setAttribute("aria-selected", i === 0 ? "true" : "false");
      tab.setAttribute("aria-controls", def.panelId);
      tab.id = def.tabId;
      tab.tabIndex = i === 0 ? 0 : -1;
      tabs.push(tab);

      const panel = containerEl.createDiv({ cls: "de-law-settings-jurisdiction-panel" });
      panel.setAttribute("role", "tabpanel");
      panel.id = def.panelId;
      panel.setAttribute("aria-labelledby", def.tabId);
      if (i !== 0) panel.setAttribute("hidden", "");
      panels.push(panel);
    }

    this.renderEuInputFormats(panels[0], ui);

    const germanLaws = getSupportedGesetzeImInternetLaws();
    this.renderSupportedLawsGroup(panels[1], ui.sectionReferences, germanLaws.filter((l) => l.referenceType === "section"), ui);
    this.renderSupportedLawsGroup(panels[1], ui.articleReferences, germanLaws.filter((l) => l.referenceType === "article"), ui);

    const germanNotes = panels[1].createDiv({ cls: "de-law-settings-supported-notes" });
    germanNotes.createEl("strong", { text: ui.intentionallyUnsupportedCandidates });
    const germanNoteList = germanNotes.createEl("ul");
    germanNoteList.createEl("li", { text: ui.ggArticleOnlyNote });
    germanNoteList.createEl("li", { text: ui.unsupportedCandidatesNote });

    const austrianLaws = getSupportedRisLaws();
    this.renderSupportedLawsGroup(panels[2], ui.sectionReferences, austrianLaws.filter((l) => l.referenceType === "section"), ui);
    this.renderSupportedLawsGroup(panels[2], ui.articleReferences, austrianLaws.filter((l) => l.referenceType === "article"), ui);

    const swissLaws = getSupportedFedlexLaws();
    this.renderSupportedLawsGroup(
      panels[3],
      ui.articleReferences,
      swissLaws.filter((l) => l.referenceType === "article"),
      ui,
      selectSwissSettingsTitleLanguage(safeGetObsidianLanguage()),
    );

    this.renderSupportedLawsGroup(panels[4], ui.articleReferences, getSupportedBoeLaws(), ui);
    panels[4].createEl("p", { cls: "de-law-settings-supported-description", text: ui.spainScopeNote });
    this.renderSpainInputFormats(panels[4], ui);

    const allTabs = tabs;
    const allPanels = panels;

    function switchTab(activeIndex: number): void {
      allTabs.forEach((tab, i) => {
        const isActive = i === activeIndex;
        tab.setAttribute("aria-selected", String(isActive));
        tab.tabIndex = isActive ? 0 : -1;
      });
      allPanels.forEach((panel, i) => {
        if (i === activeIndex) {
          panel.removeAttribute("hidden");
        } else {
          panel.setAttribute("hidden", "");
        }
      });
      allTabs[activeIndex].focus();
    }

    allTabs.forEach((tab, i) => {
      tab.addEventListener("click", () => switchTab(i));
      tab.addEventListener("keydown", (e) => {
        if (e.key === "ArrowLeft") {
          e.preventDefault();
          switchTab((i - 1 + allTabs.length) % allTabs.length);
        } else if (e.key === "ArrowRight") {
          e.preventDefault();
          switchTab((i + 1) % allTabs.length);
        } else if (e.key === "Home") {
          e.preventDefault();
          switchTab(0);
        } else if (e.key === "End") {
          e.preventDefault();
          switchTab(allTabs.length - 1);
        }
      });
    });
  }

  private renderEuInputFormats(containerEl: HTMLElement, ui: UiStrings): void {
    new Setting(containerEl).setName(ui.acceptedInputFormats).setHeading();
    const table = containerEl.createDiv({ cls: "de-law-settings-supported-table" });
    const rows = [
      [ui.directCelexCitation, ui.euDirectCelexExamples],
      [ui.structuredArticleFirst, ui.euStructuredCitationExample],
      [ui.structuredActFirst, ui.euActFirstExample],
      [ui.knownAlias, ui.euAliasExamples],
      [ui.exactOfficialTitle, ui.euExactTitleExample],
    ];
    for (const [kind, example] of rows) {
      const row = table.createDiv({
        cls: "de-law-settings-supported-row de-law-settings-supported-format-row",
      });
      row.createDiv({ cls: "de-law-settings-supported-format-label", text: kind });
      const examples = row.createDiv({ cls: "de-law-settings-supported-example-list" });
      for (const acceptedExample of example.split(";").map((value) => value.trim()).filter(Boolean)) {
        examples.createEl("code", {
          cls: "de-law-settings-supported-example",
          text: acceptedExample,
        });
      }
    }
    containerEl.createEl("p", { cls: "de-law-settings-supported-description", text: ui.euScopeNote });
  }

  private renderSpainInputFormats(containerEl: HTMLElement, ui: UiStrings): void {
    new Setting(containerEl).setName(ui.spainAcceptedInputFormats).setHeading();
    const examples = containerEl.createDiv({ cls: "de-law-settings-supported-example-list" });
    for (const example of ui.spainInputExamples.split(";").map((value) => value.trim()).filter(Boolean)) {
      examples.createEl("code", { cls: "de-law-settings-supported-example", text: example });
    }
  }

  private renderSupportedLawsGroup(
    containerEl: HTMLElement,
    heading: string,
    laws: readonly SupportedLaw[],
    ui: UiStrings,
    titleLanguage?: FedlexLanguage,
  ): void {
    if (laws.length === 0) return;

    new Setting(containerEl).setName(heading).setHeading();
    const table = containerEl.createDiv({ cls: "de-law-settings-supported-table" });
    const headerRow = table.createDiv({
      cls: "de-law-settings-supported-row de-law-settings-supported-row-header",
    });
    headerRow.createDiv({ text: ui.code });
    headerRow.createDiv({ text: ui.law });
    headerRow.createDiv({ text: ui.referenceType });
    headerRow.createDiv({ text: ui.examples });

    for (const law of laws) {
      const row = table.createDiv({ cls: "de-law-settings-supported-row" });
      row.createDiv({ text: law.displayLawCode });
      row.createDiv({
        text: titleLanguage && law.officialTitlesByLanguage
          ? law.officialTitlesByLanguage[titleLanguage]
          : law.lawTitle,
      });
      row.createDiv({ text: law.referenceType === "article" ? "Art." : "§" });
      const examples = row.createDiv({ cls: "de-law-settings-supported-example-list" });
      for (const exampleInput of law.exampleInputs) {
        examples.createSpan({
          cls: "de-law-settings-supported-example",
          text: exampleInput,
        });
      }
    }
  }
}

function selectSwissSettingsTitleLanguage(uiLocale: string): FedlexLanguage {
  if (uiLocale === "fr") return "fr";
  if (uiLocale === "it") return "it";
  return "de";
}

function safeGetObsidianLanguage(): string  {
  try {
    return moment.locale();
  } catch {
    return "en";
  }
}

function normalizeTtlDays(value: unknown): number | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }

  return parsed;
}

function normalizeJurisdiction(value: unknown): LawJurisdiction {
  return value === "DE" || value === "AT" || value === "CH" || value === "EU" || value === "ES" ? value : "EU";
}
