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
import {
  BoeLawDiscoveryMalformedResponseError,
  BoeLawDiscoveryUnavailableError,
  type BoeLawDiscoveryResult,
} from "../law/providers/BoeLawDiscovery";

interface LawLookupModalSettingsStore {
  getDefaultLawSourceVariant(): LawSourceVariant;
  setDefaultLawSourceVariant?(value: LawSourceVariant): Promise<void>;
  getDefaultJurisdiction?(): LawJurisdiction;
  getDefaultEuLawLanguage(): EuLawLanguage;
  setDefaultEuLawLanguage(value: EuLawLanguage): Promise<void>;
  getDefaultChLawLanguage?(): FedlexLanguage;
  setDefaultChLawLanguage?(value: FedlexLanguage): Promise<void>;
  getShowInsertedSourceMetadata(): boolean;
  setShowInsertedSourceMetadata(value: boolean): Promise<void>;
  getInputLayout?(): InputLayout;
  onClose?(): void;
}

export type InputLayout = "single" | "split";

function normalizeJurisdiction(value: unknown): LawJurisdiction {
  return value === "DE" || value === "AT" || value === "CH" || value === "EU" || value === "ES" ? value : "EU";
}

export function normalizeInputLayout(value: unknown): InputLayout {
  return value === "split" ? "split" : "single";
}

export function composeSplitLookupInput(law: string, reference: string): string {
  return [law.trim(), reference.trim()].filter(Boolean).join(" ");
}

export function decomposeOneLineLookupInput(
  input: string,
  jurisdiction: LawJurisdiction,
): { law: string; reference: string } | null {
  const value = input.trim();
  if (!value) return { law: "", reference: "" };
  const marker = jurisdiction === "ES" ? "(?:§|Art[.]?|Artículo)" : "(?:§|Art[.]?)";
  const actFirst = value.match(new RegExp(`^(.+?)\\s+((?:${marker})[ ]*\\S.*)$`, "iu"));
  if (actFirst) return { law: actFirst[1].trim(), reference: actFirst[2].trim() };
  if (jurisdiction === "ES") {
    const referenceFirst = value.match(/^(?:(?:Art[.]?|Artículo)\s*\S.*?)\s+(BOE-A-\d{4}-\d{1,5})$/iu);
    if (referenceFirst) return { law: referenceFirst[2].trim(), reference: referenceFirst[1].trim() };
  }
  if (jurisdiction === "DE" || jurisdiction === "AT" || jurisdiction === "CH") {
    const referenceFirst = value.match(/^((?:§|Art\.?)[ ]*\S.*?)\s+([A-Z][A-Z0-9.-]*)$/u);
    if (referenceFirst) return { law: referenceFirst[2].trim(), reference: referenceFirst[1].trim() };
  }
  return null;
}

export interface LawLookupModalIndexProvider {
  getEuActIndex(): EuActIndex | null;
}

export interface LawLookupModalDiscoveryProvider {
  search(query: string): Promise<BoeLawDiscoveryResult>;
}

const EU_ALIASES_BY_CELEX = buildEuAliasesByCelex();
const COMPLETE_SPANISH_BOE_IDENTIFIER = /^BOE-A-\d{4}-\d{1,5}$/iu;
let nextInputId = 0;

export class LawLookupModal extends Modal {
  private inputEl!: HTMLInputElement;
  private lawInputEl!: HTMLInputElement;
  private referenceInputEl!: HTMLInputElement;
  private suggestionsEl!: HTMLElement;
  private selectedLawStatusEl!: HTMLElement;
  private resultEl!: HTMLElement;
  private actionsEl!: HTMLElement;
  private formEl!: HTMLElement;
  private jurisdictionSelectEl!: HTMLSelectElement;
  private inputElements: HTMLElement[] = [];
  private inputLabels: HTMLElement[] = [];
  private currentSection: LawSection | null = null;
  private currentMarkdown = "";
  private selectedSourceVariant: LawSourceVariant = "official-de";
  private selectedJurisdiction: LawJurisdiction = "EU";
  private selectedEuLanguage: EuLawLanguage = "de";
  private selectedEuCellarLanguage: string = "deu";
  private selectedChLanguage: FedlexLanguage = "de";
  private selectedLaw: LawMetadataSuggestion | null = null;
  private showInsertedSourceMetadata = true;
  private readonly lookupSequence = new LookupSequence();
  private inputLayout: InputLayout = "single";
  private boeDiscoveryCancel: (() => void) | null = null;
  private boeDiscoveryRevision = 0;
  private boeDiscoveryPending: { query: string; revision: number } | null = null;
  private boeDiscoveryLoadingEl: HTMLElement | null = null;
  private explicitLookupPendingId: number | null = null;
  private explicitLookupLoadingEl: HTMLElement | null = null;
  private modalContainerEl: HTMLElement | null = null;

  constructor(
    app: App,
    private readonly providerRegistry: ProviderRegistry,
    private readonly settingsStore: LawLookupModalSettingsStore,
    private readonly ui: UiStrings,
    private readonly indexProvider: LawLookupModalIndexProvider = { getEuActIndex: () => null },
    private readonly boeDiscovery: LawLookupModalDiscoveryProvider | null = null,
  ) {
    super(app);
  }

  onOpen() {
    const { contentEl } = this;
    this.clearModalContainerClass();
    this.modalContainerEl = this.modalEl?.parentElement ?? null;
    this.modalContainerEl?.addClass("de-law-lookup-modal-container");
    contentEl.empty();
    contentEl.addClass("de-law-lookup-modal");

    contentEl.createEl("h2", { text: this.ui.lookUpLawTitle });

    const formEl = contentEl.createDiv({ cls: "de-law-lookup-form" });
    this.formEl = formEl;
    this.inputLayout = normalizeInputLayout(this.settingsStore.getInputLayout?.());
    this.renderInputControls();
    this.selectedJurisdiction = normalizeJurisdiction(this.settingsStore.getDefaultJurisdiction?.());

    const jurisdictionSelect = formEl.createEl("select", {
      cls: "de-law-jurisdiction-select",
    });
    this.jurisdictionSelectEl = jurisdictionSelect;
    jurisdictionSelect.createEl("option", {
      value: "EU",
      text: this.ui.jurisdictionEuropeanUnion,
    });
    jurisdictionSelect.createEl("option", {
      value: "DE",
      text: this.ui.jurisdictionGermany,
    });
    jurisdictionSelect.createEl("option", {
      value: "AT",
      text: this.ui.jurisdictionAustria,
    });
    jurisdictionSelect.createEl("option", { value: "CH", text: this.ui.jurisdictionSwitzerland });
    jurisdictionSelect.createEl("option", { value: "ES", text: this.ui.jurisdictionSpain });
    jurisdictionSelect.value = this.selectedJurisdiction;
    jurisdictionSelect.addEventListener("change", () => {
      this.lookupSequence.next();
      this.clearExplicitLookupLoading();
      this.cancelBoeDiscovery();
      this.selectedJurisdiction = jurisdictionSelect.value as LawJurisdiction;
      this.selectedLaw = null;
      this.currentSection = null;
      this.currentMarkdown = "";
      if (this.inputLayout === "split") {
        this.lawInputEl.value = "";
        this.referenceInputEl.value = "";
      }
      this.renderSelectedLawStatus();
      this.renderResultMessage(this.ui.noLookupRunYet);
      this.renderActions();
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
    this.clearModalContainerClass();
    this.clearExplicitLookupLoading();
    this.cancelBoeDiscovery();
    this.contentEl.empty();
    this.settingsStore.onClose?.();
  }

  private clearModalContainerClass(): void {
    this.modalContainerEl?.removeClass("de-law-lookup-modal-container");
    this.modalContainerEl = null;
  }

  setInputLayout(layout: InputLayout): boolean {
    const nextLayout = normalizeInputLayout(layout);
    if (nextLayout === this.inputLayout) return true;

    let law = "";
    let reference = "";
    if (this.inputLayout === "single") {
      const decomposed = decomposeOneLineLookupInput(this.inputEl.value, this.selectedJurisdiction);
      if (!decomposed) return false;
      law = decomposed.law;
      reference = decomposed.reference;
      if (this.selectedLaw?.canonicalInput !== law) this.selectedLaw = null;
    } else {
      law = this.lawInputValue().trim();
      reference = this.referenceInputEl.value.trim();
      if (this.selectedLaw?.canonicalInput !== law) this.selectedLaw = null;
    }

    const composed = nextLayout === "single" ? composeSplitLookupInput(law, reference) : "";
    this.removeInputControls();
    this.inputLayout = nextLayout;
    this.renderInputControls(law, reference, composed);
    this.renderSelectedLawStatus();
    this.renderMetadataSuggestions();
    return true;
  }

  private async renderParsedReference() {
    this.cancelBoeDiscovery();
    this.suggestionsEl?.empty();
    const lookupId = this.lookupSequence.next();
    this.clearExplicitLookupLoading();
    const parsedReference = parseLawReferenceWithSelectedJurisdiction(
      this.lookupInputValue(),
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
    this.renderExplicitLookupLoading(lookupId);

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
    } finally {
      if (this.lookupSequence.isCurrent(lookupId)) {
        this.clearExplicitLookupLoading(lookupId);
      }
    }
  }

  private renderExplicitLookupLoading(lookupId: number): void {
    this.explicitLookupPendingId = lookupId;
    this.resultEl?.setAttribute?.("aria-busy", "true");
    this.explicitLookupLoadingEl = this.resultEl.createDiv({ cls: "de-law-lookup-loading" });
    this.explicitLookupLoadingEl?.setAttribute?.("role", "status");
    this.explicitLookupLoadingEl?.setAttribute?.("aria-label", "Loading law text");
  }

  private clearExplicitLookupLoading(lookupId?: number): void {
    if (lookupId !== undefined && this.explicitLookupPendingId !== lookupId) return;
    this.explicitLookupPendingId = null;
    this.resultEl?.setAttribute?.("aria-busy", "false");
    this.explicitLookupLoadingEl?.remove?.();
    this.explicitLookupLoadingEl = null;
  }

  private renderMetadataSuggestions(): void {
    this.cancelBoeDiscovery();
    this.suggestionsEl.empty();
    if (this.selectedJurisdiction === "ES") {
      if (this.canonicalizeDirectSpanishBoeInput()) return;
      const query = this.boeDiscoveryQuery();
      if (!this.boeDiscovery || query.trim().length < 2) return;
      if (this.selectedLaw && this.inputStillHasSelectedLawPrefix()) return;

      const revision = this.boeDiscoveryRevision;
      const schedule = () => {
        this.boeDiscoveryCancel = null;
        void this.loadBoeSuggestions(query, revision);
      };
      if (typeof window === "undefined") {
        const nodeSetTimeout = setTimeout;
        const nodeClearTimeout = clearTimeout;
        const timer = nodeSetTimeout(schedule, 250);
        this.boeDiscoveryCancel = () => nodeClearTimeout(timer);
      } else {
        const timer = window.setTimeout(schedule, 250);
        this.boeDiscoveryCancel = () => window.clearTimeout(timer);
      }
      return;
    }
    const suggestions = searchLawMetadata({
      query: this.lawInputValue(),
      jurisdiction: this.selectedJurisdiction,
      entries: this.metadataSearchEntries(),
    });

    this.renderSuggestionButtons(suggestions);
  }

  private canonicalizeDirectSpanishBoeInput(): boolean {
    const decomposed = this.inputLayout === "single"
      ? decomposeOneLineLookupInput(this.lawInputValue(), "ES")
      : null;
    const law = decomposed?.law ?? this.lawInputValue();
    const normalizedLaw = law.trim();
    if (!COMPLETE_SPANISH_BOE_IDENTIFIER.test(normalizedLaw)) return false;

    const canonicalLaw = normalizedLaw.toUpperCase();
    if (this.inputLayout === "split") {
      this.lawInputEl.value = canonicalLaw;
    } else {
      this.inputEl.value = decomposed
        ? `${canonicalLaw} ${decomposed.reference}`
        : canonicalLaw;
    }
    return true;
  }

  private async loadBoeSuggestions(query: string, revision: number): Promise<void> {
    if (!this.boeDiscovery) return;
    if (!this.isCurrentBoeDiscovery(query, revision)) return;

    this.renderBoeDiscoveryLoading(query, revision);

    try {
      const result = await this.boeDiscovery.search(query);
      if (!this.isCurrentBoeDiscovery(query, revision)) return;
      if (result.kind === "no-results") {
        this.renderBoeDiscoveryStatus("no-results");
        return;
      }

      const suggestions: LawMetadataSuggestion[] = result.entries.map((entry) => ({
        ...entry,
        matchKind: "title-contains",
      }));
      if (suggestions.length === 0) {
        this.renderBoeDiscoveryStatus("no-results");
        return;
      }
      this.suggestionsEl.empty();
      this.renderSuggestionButtons(suggestions);
    } catch (error) {
      if (!this.isCurrentBoeDiscovery(query, revision)) return;
      this.renderBoeDiscoveryStatus(
        error instanceof BoeLawDiscoveryUnavailableError
          ? "unavailable"
          : error instanceof BoeLawDiscoveryMalformedResponseError
            ? "malformed"
          : "unavailable",
      );
    } finally {
      this.clearBoeDiscoveryLoading(query, revision);
    }
  }

  private renderBoeDiscoveryLoading(query: string, revision: number): void {
    this.boeDiscoveryPending = { query, revision };
    this.suggestionsEl.empty();
    this.suggestionsEl.setAttribute("aria-busy", "true");
    this.boeDiscoveryLoadingEl = this.suggestionsEl.createDiv({ cls: "de-law-lookup-loading" });
    this.boeDiscoveryLoadingEl.setAttribute("role", "status");
    this.boeDiscoveryLoadingEl.setAttribute("aria-label", "Loading law suggestions");
  }

  private clearBoeDiscoveryLoading(query: string, revision: number): void {
    if (this.boeDiscoveryPending?.query !== query || this.boeDiscoveryPending.revision !== revision) return;
    this.boeDiscoveryPending = null;
    this.suggestionsEl.setAttribute("aria-busy", "false");
    this.boeDiscoveryLoadingEl?.remove();
    this.boeDiscoveryLoadingEl = null;
  }

  private renderSuggestionButtons(suggestions: LawMetadataSuggestion[]): void {

    for (const suggestion of suggestions) {
      const button = this.suggestionsEl.createEl("button", {
        cls: "de-law-lookup-suggestion",
        type: "button",
        text: this.metadataSuggestionLabel(suggestion),
      });
      button.addEventListener("click", () => {
        if (this.inputLayout === "split") {
          this.lawInputEl.value = suggestion.canonicalInput;
        } else {
          this.inputEl.value = `${suggestion.canonicalInput} `;
        }
        this.suggestionsEl.empty();
        this.selectedLaw = suggestion;
        this.renderSelectedLawStatus();
      });
    }
  }

  private renderBoeDiscoveryStatus(status: "no-results" | "unavailable" | "malformed"): void {
    this.suggestionsEl.empty();
    const message = status === "no-results"
      ? "BOE: no matching laws."
      : status === "unavailable"
        ? "BOE: discovery source unavailable."
        : "BOE: discovery response invalid.";
    const statusEl = this.suggestionsEl.createDiv({
      cls: "de-law-lookup-discovery-status",
      text: message,
    });
    statusEl.setAttribute("data-discovery-status", status);
  }

  private boeDiscoveryQuery(): string {
    if (this.selectedJurisdiction !== "ES") return this.lawInputValue();
    if (this.inputLayout === "single") {
      return decomposeOneLineLookupInput(this.lawInputValue(), "ES")?.law ?? this.lawInputValue();
    }
    return this.lawInputValue();
  }

  private isCurrentBoeDiscovery(query: string, revision: number): boolean {
    return this.selectedJurisdiction === "ES"
      && this.boeDiscoveryRevision === revision
      && this.boeDiscoveryQuery() === query;
  }

  private cancelBoeDiscovery(): void {
    this.boeDiscoveryRevision += 1;
    this.boeDiscoveryPending = null;
    this.boeDiscoveryLoadingEl?.remove();
    this.boeDiscoveryLoadingEl = null;
    this.suggestionsEl?.setAttribute?.("aria-busy", "false");
    if (this.boeDiscoveryCancel !== null) {
      this.boeDiscoveryCancel();
      this.boeDiscoveryCancel = null;
    }
  }

  private inputStillHasSelectedLawPrefix(): boolean {
    if (!this.selectedLaw) return false;
    if (this.inputLayout === "split") return this.lawInputEl.value.trim() === this.selectedLaw.canonicalInput;
    return this.inputEl.value.startsWith(`${this.selectedLaw.canonicalInput} `);
  }

  private renderInputControls(law = "", reference = "", singleValue = ""): void {
    if (this.inputLayout === "split") {
      const lawId = `de-law-law-input-${++nextInputId}`;
      const referenceId = `de-law-reference-input-${++nextInputId}`;
      const lawLabel = this.formEl.createEl("label", { text: this.ui.lawLegalAct, attr: { for: lawId } });
      const lawInput = this.formEl.createEl("input", {
        type: "text",
        cls: "de-law-law-input",
        value: law,
        placeholder: this.ui.lawReferencePlaceholder,
        attr: { id: lawId, "aria-label": this.ui.lawLegalAct },
      });
      const referenceLabel = this.formEl.createEl("label", { text: this.ui.referenceInput, attr: { for: referenceId } });
      const referenceInput = this.formEl.createEl("input", {
        type: "text",
        cls: "de-law-reference-input",
        value: reference,
        placeholder: this.ui.articleReferences,
        attr: { id: referenceId, "aria-label": this.ui.referenceInput },
      });
      this.inputLabels = [lawLabel, referenceLabel];
      this.inputElements = [lawInput, referenceInput];
      this.lawInputEl = lawInput;
      this.referenceInputEl = referenceInput;
      lawInput.addEventListener("input", () => {
        if (this.selectedLaw && !this.inputStillHasSelectedLawPrefix()) {
          this.selectedLaw = null;
          this.renderSelectedLawStatus();
        }
        this.renderMetadataSuggestions();
      });
      referenceInput.addEventListener("keydown", (event) => {
        if (event.key === "Enter") void this.renderParsedReference();
      });
    } else {
      const input = this.formEl.createEl("input", {
        type: "text",
        value: singleValue,
        placeholder: this.ui.lawReferencePlaceholder,
      });
      this.inputLabels = [];
      this.inputElements = [input];
      this.inputEl = input;
      input.addEventListener("input", () => {
        if (this.selectedLaw && !this.inputStillHasSelectedLawPrefix()) {
          this.selectedLaw = null;
          this.renderSelectedLawStatus();
        }
        this.renderMetadataSuggestions();
      });
      input.addEventListener("keydown", (event) => {
        if (event.key === "Enter") void this.renderParsedReference();
      });
    }
    if (this.jurisdictionSelectEl) {
      const controls = [...this.inputLabels, ...this.inputElements];
      for (const control of controls) this.formEl.insertBefore(control, this.jurisdictionSelectEl);
    }
  }

  private removeInputControls(): void {
    for (const element of [...this.inputLabels, ...this.inputElements]) element.remove();
    this.inputLabels = [];
    this.inputElements = [];
  }

  private renderSelectedLawStatus(): void {
    if (!this.selectedLawStatusEl) return;
    this.selectedLawStatusEl.empty();
    if (!this.selectedLaw) return;

    const reference = this.selectedJurisdiction === "EU" || this.selectedJurisdiction === "CH" || this.selectedJurisdiction === "ES"
      ? this.ui.articleReferences
      : `${this.ui.sectionReferences} / ${this.ui.articleReferences}`;
    const message = this.ui.selectedLawContinueWithReference
      .replace("{law}", this.selectedLaw.title)
      .replace("{reference}", reference);
    this.selectedLawStatusEl.setText(`✓ ${message}`);
  }

  private *metadataSearchEntries(): Generator<LawMetadataSearchEntry> {
    if (this.selectedJurisdiction === "ES") return;

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
          if (this.lookupInputValue().trim()) void this.renderParsedReference();
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
            if (this.lookupInputValue().trim()) void this.renderParsedReference();
          });
      });
    } else if (this.selectedJurisdiction === "DE") {
      new Setting(this.actionsEl).setName(this.ui.useEnglishTranslationWhenAvailable).addToggle((toggle) => {
        toggle.setValue(this.selectedSourceVariant === "translation-en").onChange(async (value) => {
          this.selectedSourceVariant = value ? "translation-en" : "official-de";
          await this.settingsStore.setDefaultLawSourceVariant?.(this.selectedSourceVariant);
          if (this.lookupInputValue().trim()) void this.renderParsedReference();
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
    const parsed = parseLawReferenceWithSelectedJurisdiction(this.lookupInputValue(), "EU", index);
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

  private lawInputValue(): string {
    return this.inputLayout === "split" ? this.lawInputEl?.value ?? "" : this.inputEl?.value ?? "";
  }

  private lookupInputValue(): string {
    if (this.inputLayout === "split") {
      return composeSplitLookupInput(this.lawInputValue(), this.referenceInputEl?.value ?? "");
    }
    return this.inputEl?.value ?? "";
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
