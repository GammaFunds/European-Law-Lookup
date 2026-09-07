import type { LawSourceVariant } from "../law/types";
import { UI_LANGUAGE_CODES, UI_STRINGS } from "./i18nCatalog";

export type UiLanguage = "bg" | "cs" | "da" | "de" | "el" | "en" | "es" | "et" | "fi" | "fr" | "ga" | "hr" | "hu" | "it" | "lt" | "lv" | "mt" | "nl" | "pl" | "pt" | "ro" | "sk" | "sl" | "sv";
export { UI_LANGUAGE_CODES };
export interface UiPresentationStrings {
  live: string;
  cached: string;
  stale: string;
  englishTextVariantNotice: string;
  austrianConsolidatedNotice: string;
  euOfficialLanguageNotice: string;
  celex: string;
  sourceMetadata: string;
  cacheMetadata: string;
}
export interface UiStrings extends UiPresentationStrings {
  commandName: string;
  enableLocalLawTextCache: string;
  enableLocalLawTextCacheDescription: string;
  defaultLawTextSource: string;
  germanOfficialText: string;
  englishTranslationWhenAvailable: string;
  cacheExpirationInDays: string;
  cacheExpirationInDaysDescription: string;
  noExpirationPlaceholder: string;
  supportedLaws: string;
  supportedLawsDescription: string;
  inputLayout: string;
  oneLineInputLayout: string;
  twoFieldInputLayout: string;
  defaultJurisdiction?: string;
  defaultJurisdictionDescription?: string;
  lawLegalAct: string;
  referenceInput: string;
  sectionReferences: string;
  articleReferences: string;
  selectedLawContinueWithReference: string;
  intentionallyUnsupportedCandidates: string;
  ggArticleOnlyNote: string;
  unsupportedCandidatesNote: string;
  code: string;
  law: string;
  referenceType: string;
  examples: string;
  lookUpLawTitle: string;
  lawReferencePlaceholder: string;
  lookUpLawButton: string;
  noLookupRunYet: string;
  noRecognizedCitation: string;
  lookingUpLaw: string;
  noCitationFound: string;
  useEnglishTranslationWhenAvailable: string;
  englishTranslationUnavailableForCitation: string;
  insertSourceAndCacheNote: string;
  insertIntoCurrentNote: string;
  noActiveMarkdownEditorFound: string;
  jurisdictionLabel: string;
  jurisdictionGermany: string;
  jurisdictionAustria: string;
  jurisdictionSwitzerland: string;
  jurisdictionEuropeanUnion: string;
  euTextLanguage: string;
  defaultEuTextLanguage: string;
  defaultEuTextLanguageDescription: string;
  euLanguageExpressionUnavailable: string;
  acceptedInputFormats: string;
  directCelexCitation: string;
  structuredArticleFirst: string;
  structuredActFirst: string;
  knownAlias: string;
  exactOfficialTitle: string;
  euDirectCelexExamples: string;
  euStructuredCitationExample: string;
  euActFirstExample: string;
  euAliasExamples: string;
  euExactTitleExample: string;
  euScopeNote: string;
  source: string;
  retrievedOn: string;
  cache: string;
  live: string;
  cached: string;
  stale: string;
  englishTextVariantNotice: string;
  austrianConsolidatedNotice: string;
  euOfficialLanguageNotice: string;
  celex: string;
  sourceMetadata: string;
  cacheMetadata: string;
  swissOfficialTextLanguage: string;
  unexpectedLookupFailure: string;
  refreshEuActIndex: string;
}

export function resolveUiLanguage(languageCode: unknown): UiLanguage {
  const normalized = typeof languageCode === "string" ? languageCode.trim() : "";
  if (!/^[A-Za-z]{2,8}(?:[-_][A-Za-z0-9]{1,8})*$/.test(normalized)) return "en";
  const primary = normalized.toLowerCase().split(/[-_]/)[0];
  return (UI_LANGUAGE_CODES as readonly string[]).includes(primary) ? primary as UiLanguage : "en";
}

export function localizedCacheStatus(
  cacheStatus: "live" | "cached" | "stale",
  strings: Pick<UiPresentationStrings, "live" | "cached" | "stale">,
): string {
  return strings[cacheStatus];
}
const DEFAULT_JURISDICTION_STRINGS: Record<UiLanguage, { defaultJurisdiction: string; defaultJurisdictionDescription: string }> = {
  bg: { defaultJurisdiction: "Юрисдикция по подразбиране", defaultJurisdictionDescription: "Юрисдикцията, избрана при отваряне на търсенето." },
  cs: { defaultJurisdiction: "Výchozí jurisdikce", defaultJurisdictionDescription: "Jurisdikce vybraná při otevření vyhledávání." },
  da: { defaultJurisdiction: "Standardjurisdiktion", defaultJurisdictionDescription: "Den jurisdiktion, der vælges, når søgningen åbnes." },
  de: { defaultJurisdiction: "Standardjurisdiktion", defaultJurisdictionDescription: "Die beim Öffnen der Suche ausgewählte Jurisdiktion." },
  el: { defaultJurisdiction: "Προεπιλεγμένη δικαιοδοσία", defaultJurisdictionDescription: "Η δικαιοδοσία που επιλέγεται κατά το άνοιγμα της αναζήτησης." },
  en: { defaultJurisdiction: "Default jurisdiction", defaultJurisdictionDescription: "The jurisdiction selected when the lookup opens." },
  es: { defaultJurisdiction: "Jurisdicción predeterminada", defaultJurisdictionDescription: "La jurisdicción seleccionada al abrir la búsqueda." },
  et: { defaultJurisdiction: "Vaikimisi jurisdiktsioon", defaultJurisdictionDescription: "Otsingu avamisel valitav jurisdiktsioon." },
  fi: { defaultJurisdiction: "Oletuslainkäyttöalue", defaultJurisdictionDescription: "Haun avaamisen yhteydessä valittava lainkäyttöalue." },
  fr: { defaultJurisdiction: "Juridiction par défaut", defaultJurisdictionDescription: "La juridiction sélectionnée à l’ouverture de la recherche." },
  ga: { defaultJurisdiction: "Dlínse réamhshocraithe", defaultJurisdictionDescription: "An dlínse a roghnaítear nuair a osclaítear an cuardach." },
  hr: { defaultJurisdiction: "Zadana jurisdikcija", defaultJurisdictionDescription: "Jurisdikcija odabrana pri otvaranju pretraživanja." },
  hu: { defaultJurisdiction: "Alapértelmezett joghatóság", defaultJurisdictionDescription: "A keresés megnyitásakor kiválasztott joghatóság." },
  it: { defaultJurisdiction: "Giurisdizione predefinita", defaultJurisdictionDescription: "La giurisdizione selezionata all’apertura della ricerca." },
  lt: { defaultJurisdiction: "Numatytoji jurisdikcija", defaultJurisdictionDescription: "Jurisdikcija, parenkama atidarius paiešką." },
  lv: { defaultJurisdiction: "Noklusējuma jurisdikcija", defaultJurisdictionDescription: "Jurisdikcija, kas tiek izvēlēta, atverot meklēšanu." },
  mt: { defaultJurisdiction: "Ġurisdizzjoni awtomatika", defaultJurisdictionDescription: "Il-ġurisdizzjoni magħżula meta tinfetaħ it-tfittxija." },
  nl: { defaultJurisdiction: "Standaardjurisdictie", defaultJurisdictionDescription: "De jurisdictie die wordt geselecteerd wanneer zoeken wordt geopend." },
  pl: { defaultJurisdiction: "Jurysdykcja domyślna", defaultJurisdictionDescription: "Jurysdykcja wybierana przy otwieraniu wyszukiwania." },
  pt: { defaultJurisdiction: "Jurisdição predefinida", defaultJurisdictionDescription: "A jurisdição selecionada ao abrir a pesquisa." },
  ro: { defaultJurisdiction: "Jurisdicție implicită", defaultJurisdictionDescription: "Jurisdicția selectată la deschiderea căutării." },
  sk: { defaultJurisdiction: "Predvolená jurisdikcia", defaultJurisdictionDescription: "Jurisdikcia vybraná pri otvorení vyhľadávania." },
  sl: { defaultJurisdiction: "Privzeta pristojnost", defaultJurisdictionDescription: "Pristojnost, izbrana ob odprtju iskanja." },
  sv: { defaultJurisdiction: "Standardjurisdiktion", defaultJurisdictionDescription: "Den jurisdiktion som väljs när sökningen öppnas." },
};

export function getUiStrings(languageCode: unknown): UiStrings & { defaultJurisdiction: string; defaultJurisdictionDescription: string } {
  const language = resolveUiLanguage(languageCode);
  return { ...UI_STRINGS[language], ...DEFAULT_JURISDICTION_STRINGS[language] };
}
export function defaultLawSourceVariantForLanguage(_languageCode: unknown, storedValue?: LawSourceVariant): LawSourceVariant { return storedValue === "official-de" || storedValue === "translation-en" ? storedValue : "official-de"; }
