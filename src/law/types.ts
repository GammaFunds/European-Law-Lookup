export type LawReferenceType = "section" | "article";
export type LawSourceVariant = "official-de" | "translation-en";
export type LawJurisdiction = "DE" | "AT" | "CH" | "EU";
export type EuDocumentType = "R" | "L" | "D";
export type EuLawLanguage =
  | "bg" | "es" | "cs" | "da" | "de" | "et" | "el" | "en" | "fr" | "ga" | "hr" | "it"
  | "lv" | "lt" | "hu" | "mt" | "nl" | "pl" | "pt" | "ro" | "sk" | "sl" | "fi" | "sv";

export interface LawReference {
  lawCode: string;
  section: string;
  referenceType?: LawReferenceType;
  sourceVariant?: LawSourceVariant;
  jurisdiction?: LawJurisdiction;
  language?: EuLawLanguage;
  subsection?: string;
  sentence?: string;
  euCelex?: string;
  euDocumentType?: EuDocumentType;
}

export interface LawSection {
  providerId: string;
  providerLabel: string;
  sourceUrl?: string;
  lawCode: string;
  lawTitle: string;
  section: string;
  referenceType?: LawReferenceType;
  sourceVariant?: LawSourceVariant;
  jurisdiction?: LawJurisdiction;
  language?: EuLawLanguage;
  subsection?: string;
  heading?: string;
  text: string;
  retrievedAt: string;
  validFrom?: string;
  validTo?: string;
  cacheStatus: "live" | "cached" | "stale";
  isOfficialSource: boolean;
  isAuthoritativeText: boolean;
  euCelex?: string;
  euDocumentType?: EuDocumentType;
}

export interface LawSearchResult {
  label: string;
  reference: LawReference;
}
