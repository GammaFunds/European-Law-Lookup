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
export function getUiStrings(languageCode: unknown): UiStrings { return UI_STRINGS[resolveUiLanguage(languageCode)]; }
export function defaultLawSourceVariantForLanguage(_languageCode: unknown, storedValue?: LawSourceVariant): LawSourceVariant { return storedValue === "official-de" || storedValue === "translation-en" ? storedValue : "official-de"; }
