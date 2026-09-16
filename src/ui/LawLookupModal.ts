import { App, MarkdownView, Modal, Notice, Setting } from "obsidian";
import { formatLawSectionAsMarkdown } from "../law/CitationFormatter";
import { LawProviderUnavailableError, LawTranslationUnavailableError } from "../law/errors";
import { LawSectionNotFoundError, ProviderRegistry } from "../law/ProviderRegistry";
import type { LawJurisdiction, LawSection, LawSourceVariant } from "../law/types";
import { EU_LANGUAGES } from "../law/euLanguages";
import type { EuLawLanguage } from "../law/types";
import { parseLawReferenceWithSelectedJurisdiction } from "../parser";
import { LookupSequence } from "./LookupSequence";
import { insertMarkdownIntoMarkdownView } from "./editorInsertion";
import { getUiStrings, UI_LANGUAGE_CODES } from "./i18n";
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
import { NormattivaSourceContractError } from "../law/providers/NormattivaLawProvider";
import { EU_ACT_ALIASES, euActForLawCode } from "../law/euActRegistry";
import {
  searchLawMetadata,
  type LawMetadataSearchEntry,
  type LawMetadataSuggestion,
} from "../law/lawMetadataSearch";
import {
  classifyLawDiscoveryError,
  type LawDiscoveryProvider,
  type LawDiscoveryStatus,
} from "../law/LawDiscovery";

interface LawLookupModalSettingsStore {
  getDefaultLawSourceVariant(): LawSourceVariant;
  setDefaultLawSourceVariant?(value: LawSourceVariant): Promise<void>;
  getDefaultJurisdiction?(): LawJurisdiction;
  getDefaultEuLawLanguage(): EuLawLanguage;
  setDefaultEuLawLanguage(value: EuLawLanguage): Promise<void>;
  getDefaultChLawLanguage?(): FedlexLanguage;
  setDefaultChLawLanguage?(value: FedlexLanguage): Promise<void>;
  getDefaultFiLawLanguage?(): "fi" | "sv";
  setDefaultFiLawLanguage?(value: "fi" | "sv"): Promise<void>;
  getShowInsertedSourceMetadata(): boolean;
  setShowInsertedSourceMetadata(value: boolean): Promise<void>;
  getInputLayout?(): InputLayout;
  onClose?(): void;
}

export type InputLayout = "single" | "split";

function uiText(ui: UiStrings, key: keyof UiStrings): string {
  const value = ui[key];
  if (typeof value === "string" && value !== key) return value;
  const fallback = getUiStrings("en")[key];
  return typeof fallback === "string" ? fallback : "";
}

function normalizeJurisdiction(value: unknown): LawJurisdiction {
  return value === "DE" || value === "AT" || value === "CH" || value === "EU" || value === "ES" || value === "FI" || value === "IT" || value === "NL" ? value : "EU";
}

const JURISDICTION_LABEL_KEYS = [
  "jurisdictionGermany",
  "jurisdictionAustria",
  "jurisdictionSwitzerland",
  "jurisdictionSpain",
  "jurisdictionFinland",
  "jurisdictionItaly",
  "jurisdictionNetherlands",
  "jurisdictionEuropeanUnion",
] as const;

function uiLocaleForStrings(ui: UiStrings): string {
  for (const language of UI_LANGUAGE_CODES) {
    const localized = getUiStrings(language);
    if (JURISDICTION_LABEL_KEYS.every((key) => localized[key] === ui[key])) return language;
  }
  return "en";
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

const JURISDICTION_EXAMPLES: Record<LawJurisdiction, { law: string; reference: string; single: string }> = {
  EU: { law: "GDPR", reference: "Art. 6", single: "GDPR Art. 6" },
  DE: { law: "BGB", reference: "§ 823", single: "§ 823 BGB" },
  AT: { law: "ABGB", reference: "§ 1295", single: "§ 1295 ABGB" },
  CH: { law: "OR", reference: "Art. 41", single: "Art. 41 OR" },
  ES: { law: "BOE-A-2015-10566", reference: "Art. 1", single: "BOE-A-2015-10566 Art. 1" },
  FI: { law: "729/2018", reference: "§ 1", single: "729/2018 § 1" },
  IT: { law: "Codice dell'amministrazione digitale", reference: "Art. 20", single: "Codice dell'amministrazione digitale Art. 20" },
  NL: { law: "Algemene wet bestuursrecht", reference: "Art. 1:1", single: "Algemene wet bestuursrecht Art. 1:1" },
  DK: { law: "Forvaltningsloven", reference: "§ 1", single: "Forvaltningsloven § 1" },
};

function jurisdictionPlaceholder(template: string, example: string): string {
  return template.replace("{example}", example);
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
  private selectedFiLanguage: "fi" | "sv" = "fi";
  private selectedLaw: LawMetadataSuggestion | null = null;
  private showInsertedSourceMetadata = true;
  private readonly lookupSequence = new LookupSequence();
  private inputLayout: InputLayout = "single";
  private discoveryCancel: (() => void) | null = null;
  private discoveryRevision = 0;
  private discoveryPending: { query: string; revision: number } | null = null;
  private discoveryLoadingEl: HTMLElement | null = null;
  private explicitLookupPendingId: number | null = null;
  private explicitLookupLoadingEl: HTMLElement | null = null;
  private modalContainerEl: HTMLElement | null = null;

  constructor(
    app: App,
    private readonly providerRegistry: ProviderRegistry,
    private readonly settingsStore: LawLookupModalSettingsStore,
    private readonly ui: UiStrings,
    private readonly indexProvider: LawLookupModalIndexProvider = { getEuActIndex: () => null },
    private readonly discoveryProviders: ReadonlyMap<LawJurisdiction, LawDiscoveryProvider> | LawDiscoveryProvider | null = null,
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
    this.selectedJurisdiction = normalizeJurisdiction(this.settingsStore.getDefaultJurisdiction?.());
    this.renderInputControls();

    const jurisdictionSelect = formEl.createEl("select", {
      cls: "de-law-jurisdiction-select",
    });
    this.jurisdictionSelectEl = jurisdictionSelect;
    const jurisdictionOptions: Array<{ code: LawJurisdiction; label: string }> = [
      { code: "EU", label: this.ui.jurisdictionEuropeanUnion },
      { code: "DE", label: this.ui.jurisdictionGermany },
      { code: "AT", label: this.ui.jurisdictionAustria },
      { code: "CH", label: this.ui.jurisdictionSwitzerland },
      { code: "ES", label: this.ui.jurisdictionSpain },
      { code: "FI", label: this.ui.jurisdictionFinland ?? "Finland" },
      { code: "IT", label: this.ui.jurisdictionItaly! },
      { code: "NL", label: this.ui.jurisdictionNetherlands ?? "Netherlands" },
    ];
    const euOption = jurisdictionOptions.find((option) => option.code === "EU")!;
    const collator = new Intl.Collator(uiLocaleForStrings(this.ui), { sensitivity: "base" });
    const orderedJurisdictionOptions = [
      euOption,
      ...jurisdictionOptions
        .filter((option) => option.code !== "EU")
        .sort((left, right) => collator.compare(left.label, right.label) || left.code.localeCompare(right.code)),
    ];
    for (const option of orderedJurisdictionOptions) {
      jurisdictionSelect.createEl("option", { value: option.code, text: option.label });
    }
    jurisdictionSelect.value = this.selectedJurisdiction;
    jurisdictionSelect.addEventListener("change", () => {
      this.lookupSequence.next();
      this.clearExplicitLookupLoading();
      this.cancelDiscovery();
      this.selectedJurisdiction = jurisdictionSelect.value as LawJurisdiction;
      this.selectedLaw = null;
      this.currentSection = null;
      this.currentMarkdown = "";
      if (this.inputLayout === "split") {
        this.lawInputEl.value = "";
        this.referenceInputEl.value = "";
      } else {
        this.inputEl.value = "";
      }
      this.updatePlaceholders();
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
    this.selectedFiLanguage = this.settingsStore.getDefaultFiLawLanguage?.() ?? "fi";
    this.showInsertedSourceMetadata =
      this.settingsStore.getShowInsertedSourceMetadata();
    this.renderActions();
  }

  onClose() {
    this.clearModalContainerClass();
    this.clearExplicitLookupLoading();
    this.cancelDiscovery();
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
      if (this.selectedLaw && !this.inputStillHasSelectedLawPrefix()) this.selectedLaw = null;
    } else {
      law = this.lawInputValue().trim();
      reference = this.referenceInputEl.value.trim();
      if (this.selectedLaw && !this.inputStillHasSelectedLawPrefix()) this.selectedLaw = null;
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
    this.cancelDiscovery();
    this.suggestionsEl?.empty();
    const lookupId = this.lookupSequence.next();
    this.clearExplicitLookupLoading();
    const visibleLookupInput = this.lookupInputValue();
    const parsedReference = parseLawReferenceWithSelectedJurisdiction(
      (this.selectedJurisdiction === "IT" || this.selectedJurisdiction === "NL") && this.selectedLaw
        ? this.lookupInputWithSelectedLawIdentity(visibleLookupInput)
        : visibleLookupInput,
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
        : parsedReference.jurisdiction === "FI"
          ? { ...parsedReference, language: this.selectedFiLanguage === "fi" ? "fin" : "swe" }
          : this.selectedJurisdiction === "IT"
            ? { ...parsedReference, language: "it", normattivaAct: this.selectedLaw?.normattivaAct }
            : this.selectedJurisdiction === "NL"
              ? parsedReference
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
              : error instanceof LawSectionNotFoundError
                ? this.ui.lawSectionNotFound
                : error instanceof LawProviderUnavailableError
                  ? this.ui.lawProviderUnavailable
                  : error instanceof NormattivaSourceContractError
                    ? this.ui.normattivaSourceUnverified
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
    this.explicitLookupLoadingEl?.setAttribute?.("aria-label", uiText(this.ui, "loadingLawText"));
  }

  private clearExplicitLookupLoading(lookupId?: number): void {
    if (lookupId !== undefined && this.explicitLookupPendingId !== lookupId) return;
    this.explicitLookupPendingId = null;
    this.resultEl?.setAttribute?.("aria-busy", "false");
    this.explicitLookupLoadingEl?.remove?.();
    this.explicitLookupLoadingEl = null;
  }

  private renderMetadataSuggestions(): void {
    this.cancelDiscovery();
    this.suggestionsEl.empty();
    if (this.selectedJurisdiction === "ES" && this.canonicalizeDirectSpanishBoeInput()) return;
    const discoveryProvider = this.discoveryProviderForJurisdiction();
    if (discoveryProvider) {
      const query = this.discoveryQuery();
      if (query.trim().length < 2) return;
      if (this.selectedLaw && this.inputStillHasSelectedLawPrefix()) return;

      const revision = this.discoveryRevision;
      const schedule = () => {
        this.discoveryCancel = null;
        void this.loadDiscoverySuggestions(discoveryProvider, query, revision);
      };
      if (typeof window === "undefined") {
        const nodeSetTimeout = setTimeout;
        const nodeClearTimeout = clearTimeout;
        const timer = nodeSetTimeout(schedule, 250);
        this.discoveryCancel = () => nodeClearTimeout(timer);
      } else {
        const timer = window.setTimeout(schedule, 250);
        this.discoveryCancel = () => window.clearTimeout(timer);
      }
      return;
    }
    if (this.selectedJurisdiction === "ES") return;
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

  private async loadDiscoverySuggestions(
    provider: LawDiscoveryProvider,
    query: string,
    revision: number,
  ): Promise<void> {
    if (!this.isCurrentDiscovery(query, revision)) return;

    this.renderDiscoveryLoading(query, revision);

    try {
      const result = await provider.search(query);
      if (!this.isCurrentDiscovery(query, revision)) return;
      if (result.kind === "no-results") {
        this.renderDiscoveryStatus(provider, "no-results");
        return;
      }

      const suggestions = searchLawMetadata({
        query,
        jurisdiction: this.selectedJurisdiction,
        entries: result.entries,
        limit: 8,
      });
      if (suggestions.length === 0) {
        this.renderDiscoveryStatus(provider, "no-results");
        return;
      }
      this.suggestionsEl.empty();
      this.renderSuggestionButtons(suggestions);
    } catch (error) {
      if (!this.isCurrentDiscovery(query, revision)) return;
      this.renderDiscoveryStatus(provider, classifyLawDiscoveryError(error));
    } finally {
      this.clearDiscoveryLoading(query, revision);
    }
  }

  private renderDiscoveryLoading(query: string, revision: number): void {
    this.discoveryPending = { query, revision };
    this.suggestionsEl.empty();
    this.suggestionsEl.setAttribute("aria-busy", "true");
    this.discoveryLoadingEl = this.suggestionsEl.createDiv({ cls: "de-law-lookup-loading" });
    this.discoveryLoadingEl.setAttribute("role", "status");
    this.discoveryLoadingEl.setAttribute("aria-label", uiText(this.ui, "loadingLawSuggestions"));
  }

  private clearDiscoveryLoading(query: string, revision: number): void {
    if (this.discoveryPending?.query !== query || this.discoveryPending.revision !== revision) return;
    this.discoveryPending = null;
    this.suggestionsEl.setAttribute("aria-busy", "false");
    this.discoveryLoadingEl?.remove();
    this.discoveryLoadingEl = null;
  }

  private renderSuggestionButtons(suggestions: LawMetadataSuggestion[]): void {

    for (const suggestion of suggestions) {
      const button = this.suggestionsEl.createEl("button", {
        cls: "de-law-lookup-suggestion",
        type: "button",
        text: this.metadataSuggestionLabel(suggestion),
      });
      button.addEventListener("click", () => {
        const displayedLaw = suggestion.jurisdiction === "IT" || suggestion.jurisdiction === "NL"
          ? suggestion.title
          : suggestion.canonicalInput;
        if (this.inputLayout === "split") {
          this.lawInputEl.value = displayedLaw;
        } else {
          this.inputEl.value = `${displayedLaw} `;
        }
        this.suggestionsEl.empty();
        this.selectedLaw = suggestion;
        this.renderSelectedLawStatus();
      });
    }
  }

  private renderDiscoveryStatus(provider: LawDiscoveryProvider, status: LawDiscoveryStatus): void {
    this.suggestionsEl.empty();
    const sourceLabel = provider.sourceLabel;
    const message = status === "no-results"
      ? uiText(this.ui, "discoveryNoResults").replace("{source}", sourceLabel)
      : status === "unavailable"
        ? uiText(this.ui, "discoveryUnavailable").replace("{source}", sourceLabel)
        : uiText(this.ui, "discoveryMalformed").replace("{source}", sourceLabel);
    const statusEl = this.suggestionsEl.createDiv({
      cls: "de-law-lookup-discovery-status",
      text: message,
    });
    statusEl.setAttribute("data-discovery-status", status);
  }

  private discoveryQuery(): string {
    if (this.selectedJurisdiction !== "ES") return this.lawInputValue();
    if (this.inputLayout === "single") {
      return decomposeOneLineLookupInput(this.lawInputValue(), "ES")?.law ?? this.lawInputValue();
    }
    return this.lawInputValue();
  }

  private isCurrentDiscovery(query: string, revision: number): boolean {
    return this.discoveryProviderForJurisdiction() !== null
      && this.discoveryRevision === revision
      && this.discoveryQuery() === query;
  }

  private cancelDiscovery(): void {
    this.discoveryRevision += 1;
    this.discoveryPending = null;
    this.discoveryLoadingEl?.remove();
    this.discoveryLoadingEl = null;
    this.suggestionsEl?.setAttribute?.("aria-busy", "false");
    if (this.discoveryCancel !== null) {
      this.discoveryCancel();
      this.discoveryCancel = null;
    }
  }

  private discoveryProviderForJurisdiction(): LawDiscoveryProvider | null {
    if (this.discoveryProviders && "get" in this.discoveryProviders) {
      return this.discoveryProviders.get(this.selectedJurisdiction) ?? null;
    }
    if (this.discoveryProviders && "search" in this.discoveryProviders && this.discoveryProviders.jurisdiction === this.selectedJurisdiction) {
      return this.discoveryProviders;
    }
    return null;
  }

  private inputStillHasSelectedLawPrefix(): boolean {
    if (!this.selectedLaw) return false;
    const displayedLaw = this.selectedLaw.jurisdiction === "IT" || this.selectedLaw.jurisdiction === "NL"
      ? this.selectedLaw.title
      : this.selectedLaw.canonicalInput;
    if (this.inputLayout === "split") return this.lawInputEl.value.trim() === displayedLaw.trim();
    return this.inputEl.value.startsWith(`${displayedLaw} `);
  }

  private lookupInputWithSelectedLawIdentity(input: string): string {
    if (!this.selectedLaw) return input;
    const decomposed = decomposeOneLineLookupInput(input, this.selectedJurisdiction);
    return decomposed
      ? composeSplitLookupInput(this.selectedLaw.canonicalInput, decomposed.reference)
      : input;
  }

  private jurisdictionPlaceholder(example: string): string {
    return jurisdictionPlaceholder(this.ui.lawReferencePlaceholder, example);
  }

  private updatePlaceholders(): void {
    const examples = JURISDICTION_EXAMPLES[this.selectedJurisdiction];
    if (this.inputLayout === "split") {
      if (this.lawInputEl) {
        const ph = this.jurisdictionPlaceholder(examples.law);
        if (typeof this.lawInputEl.setAttribute === "function") this.lawInputEl.setAttribute("placeholder", ph);
        else this.lawInputEl.placeholder = ph;
      }
      if (this.referenceInputEl) {
        const ph = this.jurisdictionPlaceholder(examples.reference);
        if (typeof this.referenceInputEl.setAttribute === "function") this.referenceInputEl.setAttribute("placeholder", ph);
        else this.referenceInputEl.placeholder = ph;
      }
    } else {
      if (this.inputEl) {
        const ph = this.jurisdictionPlaceholder(examples.single);
        if (typeof this.inputEl.setAttribute === "function") this.inputEl.setAttribute("placeholder", ph);
        else this.inputEl.placeholder = ph;
      }
    }
  }

  private renderInputControls(law = "", reference = "", singleValue = ""): void {
    const examples = JURISDICTION_EXAMPLES[this.selectedJurisdiction];
    if (this.inputLayout === "split") {
      const lawId = `de-law-law-input-${++nextInputId}`;
      const referenceId = `de-law-reference-input-${++nextInputId}`;
      const lawLabel = this.formEl.createEl("label", { text: this.ui.lawLegalAct, attr: { for: lawId } });
      const lawInput = this.formEl.createEl("input", {
        type: "text",
        cls: "de-law-law-input",
        value: law,
        placeholder: this.jurisdictionPlaceholder(examples.law),
        attr: { id: lawId, "aria-label": this.ui.lawLegalAct },
      });
      const referenceLabel = this.formEl.createEl("label", { text: this.ui.referenceInput, attr: { for: referenceId } });
      const referenceInput = this.formEl.createEl("input", {
        type: "text",
        cls: "de-law-reference-input",
        value: reference,
        placeholder: this.jurisdictionPlaceholder(examples.reference),
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
        placeholder: this.jurisdictionPlaceholder(examples.single),
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
    if (suggestion.jurisdiction === "IT" && suggestion.canonicalInput.startsWith("normattiva:")) {
      return matchedTitle;
    }
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
    } else if (this.selectedJurisdiction === "FI") {
      new Setting(this.actionsEl).setName(this.ui.defaultFiTextLanguage ?? "Finnish text language").addDropdown((dropdown) => {
        dropdown.addOption("fi", "Suomi");
        dropdown.addOption("sv", "Svenska");
        dropdown.setValue(this.selectedFiLanguage).onChange(async (value) => {
          if (value !== "fi" && value !== "sv") return;
          this.selectedFiLanguage = value;
          await this.settingsStore.setDefaultFiLawLanguage?.(value);
          this.currentSection = null;
          this.currentMarkdown = "";
          this.renderResultMessage(this.ui.noLookupRunYet);
          this.renderActions();
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

    if (this.currentSection.jurisdiction === "IT" && !this.currentSection.isAuthoritativeText) {
      this.resultEl.createDiv({
        cls: "de-law-source-status-notice",
        text: this.ui.italyNonAuthoritativeNotice!,
      });
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
