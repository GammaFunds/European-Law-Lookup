import type { LawSourceVariant } from "../law/types";

export type UiLanguage = "de" | "en";

export interface UiStrings {
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
}

const UI_STRINGS: Record<UiLanguage, UiStrings> = {
  de: {
    commandName: "Gesetz nachschlagen",
    enableLocalLawTextCache: "Lokalen Gesetzestext-Cache aktivieren",
    enableLocalLawTextCacheDescription:
      "Speichert erfolgreiche Treffer lokal. Live-Anbieter werden weiterhin zuerst abgefragt.",
    defaultLawTextSource: "Standard-Gesetzestextquelle",
    germanOfficialText: "Deutscher amtlicher Text",
    englishTranslationWhenAvailable: "Englischer Gesetzestext, sofern vorhanden",
    cacheExpirationInDays: "Cache-Ablauf in Tagen",
    cacheExpirationInDaysDescription:
      "Leer lassen, um gecachte Treffer ohne Ablauf als Fallback zu verwenden.",
    noExpirationPlaceholder: "kein Ablauf",
    supportedLaws: "Unterstützte Gesetze",
    supportedLawsDescription:
      "Diese Liste zeigt die aktuell explizit unterstützten Gesetze. Die Abfrage erfolgt weiterhin live über die Provider-Kette; diese Ansicht führt keine Netzwerkanfragen aus.",
    sectionReferences: "Paragraphenreferenzen (§)",
    articleReferences: "Artikelreferenzen (Art.)",
    intentionallyUnsupportedCandidates:
      "Hinweise zu bewusst nicht abgedeckten Kandidaten",
    ggArticleOnlyNote:
      "GG wird derzeit ausschließlich für Artikelreferenzen unterstützt.",
    unsupportedCandidatesNote:
      "SGB XIII wird bewusst nicht als geltendes SGB-Buch unterstützt.",
    code: "Kürzel",
    law: "Gesetz",
    referenceType: "Referenztyp",
    examples: "Beispiel",
    lookUpLawTitle: "Gesetz nachschlagen",
    lawReferencePlaceholder: "z. B. § 823 BGB",
    lookUpLawButton: "Gesetz suchen",
    noLookupRunYet: "Noch keine Suche ausgeführt.",
    noRecognizedCitation: "Keine erkannte Fundstelle.",
    lookingUpLaw: "Suche läuft...",
    noCitationFound: "Keine Fundstelle gefunden.",
    useEnglishTranslationWhenAvailable: "Englischen Gesetzestext anzeigen, sofern vorhanden",
    englishTranslationUnavailableForCitation:
      "Für diese Fundstelle ist keine verifizierte englische Übersetzung konfiguriert.",
    insertSourceAndCacheNote: "Quellen- und Cache-Hinweis einfügen",
    insertIntoCurrentNote: "In aktuelle Note einfügen",
    noActiveMarkdownEditorFound: "Kein aktiver Markdown-Editor gefunden.",
    jurisdictionLabel: "Rechtsraum",
    jurisdictionGermany: "Deutschland",
    jurisdictionAustria: "Österreich",
    jurisdictionSwitzerland: "Schweiz",
    jurisdictionEuropeanUnion: "Europäische Union",
    euTextLanguage: "EU-Sprachfassung",
    defaultEuTextLanguage: "Standard-EU-Sprachfassung",
    defaultEuTextLanguageDescription: "Amtliche Sprachfassung für EUR-Lex-Abfragen.",
    euLanguageExpressionUnavailable: "Diese amtliche EU-Sprachfassung ist für diesen Akt nicht verfügbar.",
  },
  en: {
    commandName: "Look up law",
    enableLocalLawTextCache: "Enable local law text cache",
    enableLocalLawTextCacheDescription:
      "Stores successful lookups locally. Live providers are still queried first.",
    defaultLawTextSource: "Default law text source",
    germanOfficialText: "German official text",
    englishTranslationWhenAvailable: "English law text when available",
    cacheExpirationInDays: "Cache expiration in days",
    cacheExpirationInDaysDescription:
      "Leave empty to keep cached matches available as a fallback without expiration.",
    noExpirationPlaceholder: "no expiration",
    supportedLaws: "Supported laws",
    supportedLawsDescription:
      "This list shows the laws that are explicitly supported right now. Lookups still run live through the provider chain; this view does not make any network requests.",
    sectionReferences: "Section references (§)",
    articleReferences: "Article references (Art.)",
    intentionallyUnsupportedCandidates:
      "Notes on intentionally unsupported candidates",
    ggArticleOnlyNote:
      "GG is currently supported only for article references.",
    unsupportedCandidatesNote:
      "SGB XIII is intentionally not supported as a current SGB book.",
    code: "Code",
    law: "Law",
    referenceType: "Reference type",
    examples: "Examples",
    lookUpLawTitle: "Look up law",
    lawReferencePlaceholder: "e.g. § 823 BGB",
    lookUpLawButton: "Look up",
    noLookupRunYet: "No lookup run yet.",
    noRecognizedCitation: "No recognized citation.",
    lookingUpLaw: "Looking up law...",
    noCitationFound: "No citation found.",
    useEnglishTranslationWhenAvailable: "Show English law text when available",
    englishTranslationUnavailableForCitation:
      "No verified English translation is configured for this citation.",
    insertSourceAndCacheNote: "Insert source and cache note",
    insertIntoCurrentNote: "Insert into current note",
    noActiveMarkdownEditorFound: "No active Markdown editor found.",
    jurisdictionLabel: "Jurisdiction",
    jurisdictionGermany: "Germany",
    jurisdictionAustria: "Austria",
    jurisdictionSwitzerland: "Switzerland",
    jurisdictionEuropeanUnion: "European Union",
    euTextLanguage: "EU text language",
    defaultEuTextLanguage: "Default EU text language",
    defaultEuTextLanguageDescription: "Official language version used for EUR-Lex lookups.",
    euLanguageExpressionUnavailable: "That official EU language expression is not available for this act.",
  },
};

export function resolveUiLanguage(languageCode: unknown): UiLanguage {
  return typeof languageCode === "string" && languageCode.toLowerCase().startsWith("de")
    ? "de"
    : "en";
}

export function getUiStrings(languageCode: unknown): UiStrings {
  return UI_STRINGS[resolveUiLanguage(languageCode)];
}

export function defaultLawSourceVariantForLanguage(
  _languageCode: unknown,
  storedValue?: LawSourceVariant,
): LawSourceVariant {
  if (storedValue === "official-de" || storedValue === "translation-en") {
    return storedValue;
  }

  return "official-de";
}
