import { App, MarkdownView, Modal, Notice, Setting } from "obsidian";
import { formatLawSectionAsMarkdown } from "../law/CitationFormatter";
import { LawTranslationUnavailableError } from "../law/errors";
import { ProviderRegistry } from "../law/ProviderRegistry";
import type { LawJurisdiction, LawSection, LawSourceVariant } from "../law/types";
import { EU_LANGUAGES } from "../law/euLanguages";
import type { EuLawLanguage } from "../law/types";
import { parseLawReferenceWithSelectedJurisdiction } from "../parser";
import { LookupSequence } from "./LookupSequence";
import { insertMarkdownIntoMarkdownView } from "./editorInsertion";
import type { UiStrings } from "./i18n";
import { buildLawSectionPreviewModel } from "./lawSectionPreview";
import {
  EuActLanguageExpressionUnavailableError,
} from "../law/providers/eurLexMapping";
import {
  euActIndexEntryOfficialTitle,
  indexEntryForCelex,
  type EuActIndex,
  type EuActIndexEntry,
} from "../law/euActIndex";
import {
  cellarCodeToLegacyEuLawLanguage,
  cellarLanguageNativeName,
  legacyEuLawLanguageToCellarCode,
} from "../law/euLanguages";
import type { FedlexLanguage } from "../law/providers/fedlexMapping";
import { getSupportedFedlexLaws } from "../law/providers/fedlexMapping";
import { getSupportedGesetzeImInternetLaws } from "../law/providers/gesetzeImInternetMapping";
import { getSupportedRisLaws } from "../law/providers/risMapping";
import { EU_ACT_ALIASES, euActForLawCode } from "../law/euActRegistry";
import {
  searchLawMetadata,
  type LawMetadataSearchEntry,
  type LawMetadataSuggestion,
} from "../law/lawMetadataSearch";

interface LawLookupModalSettingsStore {
  getDefaultLawSourceVariant(): LawSourceVariant;
  getDefaultEuLawLanguage(): EuLawLanguage;
  setDefaultEuLawLanguage(value: EuLawLanguage): Promise<void>;
  getDefaultChLawLanguage?(): FedlexLanguage;
  setDefaultChLawLanguage?(value: FedlexLanguage): Promise<void>;
  getShowInsertedSourceMetadata(): boolean;
  setShowInsertedSourceMetadata(value: boolean): Promise<void>;
}

export interface LawLookupModalIndexProvider {
  getEuActIndex(): EuActIndex | null;
}

const EU_ALIASES_BY_CELEX = buildEuAliasesByCelex();

export class LawLookupModal extends Modal {
  private inputEl!: HTMLInputElement;
  private suggestionsEl!: HTMLElement;
  private selectedLawStatusEl!: HTMLElement;
  private resultEl!: HTMLElement;
  private actionsEl!: HTMLElement;
  private currentSection: LawSection | null = null;
  private currentMarkdown = "";
  private selectedSourceVariant: LawSourceVariant = "official-de";
  private selectedJurisdiction: LawJurisdiction = "DE";
  private selectedEuLanguage: EuLawLanguage = "de";
  private selectedEuCellarLanguage: string = "deu";
  private selectedChLanguage: FedlexLanguage = "de";
  private selectedLaw: LawMetadataSuggestion | null = null;
  private showInsertedSourceMetadata = true;
  private readonly lookupSequence = new LookupSequence();

  constructor(
    app: App,
    private readonly providerRegistry: ProviderRegistry,
    private readonly settingsStore: LawLookupModalSettingsStore,
    private readonly ui: UiStrings,
    private readonly indexProvider: LawLookupModalIndexProvider = { getEuActIndex: () => null },
  ) {
    super(app);
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("de-law-lookup-modal");

    contentEl.createEl("h2", { text: this.ui.lookUpLawTitle });

    const formEl = contentEl.createDiv({ cls: "de-law-lookup-form" });
    this.inputEl = formEl.createEl("input", {
      type: "text",
      placeholder: this.ui.lawReferencePlaceholder,
    });
    this.inputEl.addEventListener("input", () => {
      if (this.selectedLaw && !this.inputStillHasSelectedLawPrefix()) {
        this.selectedLaw = null;
        this.renderSelectedLawStatus();
      }
      this.renderMetadataSuggestions();
    });
    this.inputEl.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        void this.renderParsedReference();
      }
    });

    const jurisdictionSelect = formEl.createEl("select", {
      cls: "de-law-jurisdiction-select",
    });
    jurisdictionSelect.createEl("option", {
      value: "DE",
      text: this.ui.jurisdictionGermany,
    });
    jurisdictionSelect.createEl("option", {
      value: "AT",
      text: this.ui.jurisdictionAustria,
    });
    jurisdictionSelect.createEl("option", {
      value: "CH",
      text: this.ui.jurisdictionSwitzerland,
    });
    jurisdictionSelect.createEl("option", { value: "EU", text: this.ui.jurisdictionEuropeanUnion });
    jurisdictionSelect.addEventListener("change", () => {
      this.selectedJurisdiction = jurisdictionSelect.value as LawJurisdiction;
      this.selectedLaw = null;
      this.renderSelectedLawStatus();
      this.renderActions();
      if (this.inputEl?.value.trim()) {
        void this.renderParsedReference();
      }
      this.renderMetadataSuggestions();
    });

    const searchButton = formEl.createEl("button", { text: this.ui.lookUpLawButton });
    searchButton.addEventListener("click", () => {
      void this.renderParsedReference();
    });

    this.suggestionsEl = formEl.createDiv({ cls: "de-law-lookup-suggestions" });
    this.selectedLawStatusEl = formEl.createDiv({ cls: "de-law-selected-law-status" });
    this.renderSelectedLawStatus();
    this.resultEl = contentEl.createDiv({ cls: "de-law-lookup-result" });
    this.renderResultMessage(this.ui.noLookupRunYet);
    this.actionsEl = contentEl.createDiv({ cls: "de-law-lookup-actions" });
    this.selectedSourceVariant = this.settingsStore.getDefaultLawSourceVariant();
    this.selectedEuLanguage = this.settingsStore.getDefaultEuLawLanguage();
    this.selectedEuCellarLanguage = legacyEuLawLanguageToCellarCode(this.selectedEuLanguage);
    this.selectedChLanguage = this.settingsStore.getDefaultChLawLanguage?.() ?? "de";
    this.showInsertedSourceMetadata =
      this.settingsStore.getShowInsertedSourceMetadata();
    this.renderActions();
  }

  onClose() {
    this.contentEl.empty();
  }

  private async renderParsedReference() {
    this.suggestionsEl?.empty();
    const lookupId = this.lookupSequence.next();
    const parsedReference = parseLawReferenceWithSelectedJurisdiction(
      this.inputEl.value,
      this.selectedJurisdiction,
      this.indexProvider.getEuActIndex(),
    );
    this.currentSection = null;
    this.currentMarkdown = "";
    this.renderActions();

    if (!parsedReference) {
      this.renderResultMessage(this.ui.noRecognizedCitation);
      return;
    }

    const parsed = this.selectedJurisdiction === "EU"
      ? { ...parsedReference, language: this.selectedEuCellarLanguage }
      : parsedReference.jurisdiction === "CH"
        ? { ...parsedReference, language: this.selectedChLanguage }
        : { ...parsedReference, sourceVariant: this.selectedSourceVariant };

    this.renderResultMessage(this.ui.lookingUpLaw);

    try {
      const section = await this.providerRegistry.getSection(parsed);
      if (!this.lookupSequence.isCurrent(lookupId)) {
        return;
      }

      this.currentSection = section;
      this.currentMarkdown = this.formatCurrentSection();
      this.renderCurrentPreview();
      this.renderActions();
    } catch (error) {
      if (!this.lookupSequence.isCurrent(lookupId)) {
        return;
      }

      this.currentSection = null;
      this.renderResultMessage(
        error instanceof LawTranslationUnavailableError
          ? this.ui.englishTranslationUnavailableForCitation
          : error instanceof EuActLanguageExpressionUnavailableError
            ? this.ui.euLanguageExpressionUnavailable
              : this.ui.unexpectedLookupFailure,
      );
    }
  }

  private renderMetadataSuggestions(): void {
    this.suggestionsEl.empty();
    const suggestions = searchLawMetadata({
      query: this.inputEl.value,
      jurisdiction: this.selectedJurisdiction,
      entries: this.metadataSearchEntries(),
    });

    for (const suggestion of suggestions) {
      const button = this.suggestionsEl.createEl("button", {
        cls: "de-law-lookup-suggestion",
        type: "button",
        text: this.metadataSuggestionLabel(suggestion),
      });
      button.addEventListener("click", () => {
        this.inputEl.value = `${suggestion.canonicalInput} `;
        this.suggestionsEl.empty();
        this.selectedLaw = suggestion;
        this.renderSelectedLawStatus();
      });
    }
  }

  private inputStillHasSelectedLawPrefix(): boolean {
    return this.selectedLaw !== null
      && this.inputEl.value.startsWith(`${this.selectedLaw.canonicalInput} `);
  }

  private renderSelectedLawStatus(): void {
    if (!this.selectedLawStatusEl) return;
    this.selectedLawStatusEl.empty();
    if (!this.selectedLaw) return;

    const reference = this.selectedJurisdiction === "EU" || this.selectedJurisdiction === "CH"
      ? this.ui.articleReferences
      : `${this.ui.sectionReferences} / ${this.ui.articleReferences}`;
    const message = this.ui.selectedLawContinueWithReference
      .replace("{law}", this.selectedLaw.title)
      .replace("{reference}", reference);
    this.selectedLawStatusEl.setText(`✓ ${message}`);
  }

  private *metadataSearchEntries(): Generator<LawMetadataSearchEntry> {
    if (this.selectedJurisdiction === "DE") {
      for (const law of getSupportedGesetzeImInternetLaws()) {
        yield {
          jurisdiction: "DE",
          canonicalInput: law.displayLawCode,
          title: law.lawTitle,
          aliases: [law.displayLawCode],
        };
      }
      return;
    }

    if (this.selectedJurisdiction === "AT") {
      for (const law of getSupportedRisLaws()) {
        yield {
          jurisdiction: "AT",
          canonicalInput: law.displayLawCode,
          title: law.lawTitle,
          aliases: [law.displayLawCode],
        };
      }
      return;
    }

    if (this.selectedJurisdiction === "CH") {
      for (const law of getSupportedFedlexLaws()) {
        yield {
          jurisdiction: "CH",
          canonicalInput: law.displayLawCode,
          title: law.lawTitle,
          aliases: [law.displayLawCode],
          alternateTitles: Object.values(law.officialTitlesByLanguage),
        };
      }
      return;
    }

    const index = this.indexProvider.getEuActIndex();
    if (!index) return;
    for (const entry of index.entries.values()) {
      yield {
        jurisdiction: "EU",
        canonicalInput: entry.celex,
        title: euActIndexEntryOfficialTitle(entry) ?? entry.celex,
        aliases: EU_ALIASES_BY_CELEX.get(entry.celex) ?? [],
        alternateTitles: Object.values(entry.titlesByLanguage),
        celex: entry.celex,
        year: entry.year,
        number: entry.number,
      };
    }
  }

  private metadataSuggestionLabel(suggestion: LawMetadataSuggestion): string {
    const matchedTitle = suggestion.matchedTitle ?? suggestion.title;
    if (suggestion.jurisdiction !== "EU") {
      return `${matchedTitle} (${suggestion.canonicalInput})`;
    }

    if (matchedTitle === suggestion.title) {
      return `${matchedTitle} — CELEX ${suggestion.canonicalInput}`;
    }
    return `${matchedTitle} — ${suggestion.title} — CELEX ${suggestion.canonicalInput}`;
  }

  private renderActions() {
    this.actionsEl.empty();

    if (this.selectedJurisdiction === "EU") {
      const availableLanguages = this.availableEuLanguagesForCurrentReference();
      new Setting(this.actionsEl).setName(this.ui.euTextLanguage).addDropdown((dropdown) => {
        for (const language of availableLanguages) dropdown.addOption(language.code, language.nativeName);
        dropdown.setValue(this.selectedEuCellarLanguage).onChange(async (value) => {
          this.selectedEuCellarLanguage = value;
          const legacy = cellarCodeToLegacyEuLawLanguage(value);
          if (legacy) {
            this.selectedEuLanguage = legacy;
            await this.settingsStore.setDefaultEuLawLanguage(legacy);
          }
          if (this.inputEl?.value.trim()) void this.renderParsedReference();
        });
      });
    } else if (this.selectedJurisdiction === "CH") {
      new Setting(this.actionsEl).setName(this.ui.swissOfficialTextLanguage).addDropdown((dropdown) => {
        dropdown.addOption("de", "Deutsch");
        dropdown.addOption("fr", "Français");
        dropdown.addOption("it", "Italiano");
        dropdown.setValue(this.selectedChLanguage).onChange(async (value) => {
            if (value !== "de" && value !== "fr" && value !== "it") return;
            this.selectedChLanguage = value;
            await this.settingsStore.setDefaultChLawLanguage?.(value);
            if (this.inputEl?.value.trim()) void this.renderParsedReference();
          });
      });
    } else {
      new Setting(this.actionsEl).setName(this.ui.useEnglishTranslationWhenAvailable).addToggle((toggle) => {
        toggle.setValue(this.selectedSourceVariant === "translation-en").onChange((value) => {
          this.selectedSourceVariant = value ? "translation-en" : "official-de";
          if (this.inputEl?.value.trim()) void this.renderParsedReference();
        });
      });
    }

    new Setting(this.actionsEl)
      .setName(this.ui.insertSourceAndCacheNote)
      .addToggle((toggle) => {
        toggle.setValue(this.showInsertedSourceMetadata).onChange((value) => {
          this.showInsertedSourceMetadata = value;
          void this.settingsStore.setShowInsertedSourceMetadata(value);

          if (!this.currentSection) {
            return;
          }

          this.currentMarkdown = this.formatCurrentSection();
          this.renderCurrentPreview();
        });
      });

    if (!this.currentSection) {
      return;
    }

    const button = this.actionsEl.createEl("button", {
      text: this.ui.insertIntoCurrentNote,
    });

    button.addEventListener("click", () => {
      const view = this.app.workspace.getActiveViewOfType(MarkdownView);
      if (!view) {
        new Notice(this.ui.noActiveMarkdownEditorFound);
        return;
      }

      insertMarkdownIntoMarkdownView(view, this.currentMarkdown);
    });
  }

  private formatCurrentSection(): string {
    if (!this.currentSection) {
      return "";
    }

    return formatLawSectionAsMarkdown(this.currentSection, {
      includeMetadataFooter: this.showInsertedSourceMetadata,
      presentationStrings: this.ui,
    });
  }

  private renderCurrentPreview() {
    if (!this.currentSection) {
      this.renderResultMessage(this.ui.noCitationFound);
      return;
    }

    const preview = buildLawSectionPreviewModel(this.currentSection, {
      includeMetadataFooter: this.showInsertedSourceMetadata,
      presentationStrings: this.ui,
    });

    this.resultEl.empty();

    this.resultEl.createDiv({
      cls: "de-law-lookup-preview-title",
      text: preview.title,
    });

    const bodyEl = this.resultEl.createDiv({ cls: "de-law-lookup-preview-body" });
    for (const paragraph of preview.paragraphs) {
      bodyEl.createEl("p", {
        cls: "de-law-lookup-preview-paragraph",
        text: paragraph,
      });
    }

    if (preview.metadataLines.length > 0) {
      const metadataEl = this.resultEl.createDiv({
        cls: "de-law-lookup-preview-metadata",
      });

      for (const line of preview.metadataLines) {
        metadataEl.createDiv({
          cls: "de-law-lookup-preview-metadata-line",
          text: line,
        });
      }
    }
  }

  private renderResultMessage(message: string) {
    this.resultEl.empty();
    this.resultEl.createDiv({
      cls: "de-law-lookup-result-message",
      text: message,
    });
  }

  private availableEuLanguagesForCurrentReference(): Array<{ code: string; nativeName: string }> {
    const index = this.indexProvider.getEuActIndex();
    const parsed = parseLawReferenceWithSelectedJurisdiction(this.inputEl?.value ?? "", "EU", index);
    const celex = parsed?.euCelex;
    if (celex && index) {
      const entry: EuActIndexEntry | null = indexEntryForCelex(index, celex);
      if (entry && entry.availableLanguages.length > 0) {
        const known = entry.availableLanguages
          .map((code) => ({ code, nativeName: cellarLanguageNativeName(code) ?? code }));
        if (known.length > 0) return known;
      }
    }
    return EU_LANGUAGES.map((language) => ({ code: language.eliCode, nativeName: language.nativeName }));
  }
}

function buildEuAliasesByCelex(): ReadonlyMap<string, readonly string[]> {
  const aliasesByCelex = new Map<string, string[]>();
  for (const alias of EU_ACT_ALIASES) {
    const act = euActForLawCode(alias);
    if (!act) continue;
    const aliases = aliasesByCelex.get(act.celex) ?? [];
    aliases.push(alias);
    aliasesByCelex.set(act.celex, aliases);
  }
  return aliasesByCelex;
}
