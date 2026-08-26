import { euLanguageToEliCode, isEuLawLanguage } from "../euLanguages";
import type { EuDocumentType, EuLawLanguage } from "../types";
import { euActForCelexReference, euActForLawCode, parseEuCelex } from "../euActRegistry";

export const EUR_LEX_DSGVO_CELEX = "32016R0679";
export const EUR_LEX_DSGVO_ELI_PATH = "reg/2016/679/oj";
export const EUR_LEX_DSGVO_ALIASES = ["DSGVO", "GDPR", "RGPD", "RODO"] as const;

export const EUR_LEX_AIACT_CELEX = "32024R1689";
export const EUR_LEX_AIACT_ELI_PATH = "reg/2024/1689/oj";
export const EUR_LEX_AIACT_ALIASES = ["AIACT", "AI_ACT", "AIA", "AI-ACT", "AI ACT", "EU AI ACT", "AI-GESETZ", "KI-VO", "AI-VO"] as const;

export const EUR_LEX_DATA_ACT_CELEX = "32023R2854";
export const EUR_LEX_DATA_ACT_ELI_PATH = "reg/2023/2854/oj";
export const EUR_LEX_DATA_ACT_ALIASES = ["DATA_ACT", "DATA ACT"] as const;

export const EUR_LEX_DSGVO_CELLAR_URL = `https://publications.europa.eu/resource/celex/${EUR_LEX_DSGVO_CELEX}`;
export const EUR_LEX_AIACT_CELLAR_URL = `https://publications.europa.eu/resource/celex/${EUR_LEX_AIACT_CELEX}`;
export const EUR_LEX_DATA_ACT_CELLAR_URL = `https://publications.europa.eu/resource/celex/${EUR_LEX_DATA_ACT_CELEX}`;
export const EUR_LEX_CELLAR_RESOURCE_BASE_URL = "https://publications.europa.eu/resource/cellar";

export interface EuCelexIdentity {
  celex: string;
  documentType: EuDocumentType;
}

export function resolveEuCelexIdentity(reference: { euCelex?: string; lawCode?: string; jurisdiction?: string; euDocumentType?: EuDocumentType }): EuCelexIdentity | null {
  if (reference.jurisdiction !== "EU") return null;

  const refCelex = reference.euCelex?.trim().toUpperCase();
  const registryEntry = refCelex
    ? euActForCelexReference(refCelex)
    : reference.lawCode
      ? euActForLawCode(reference.lawCode) ?? euActForCelexReference(reference.lawCode)
      : null;

  if (!registryEntry) return null;

  if (refCelex && registryEntry.celex !== refCelex) return null;

  if (reference.lawCode) {
    const lawCodeEntry = euActForLawCode(reference.lawCode) ?? euActForCelexReference(reference.lawCode);
    if (lawCodeEntry && lawCodeEntry.celex !== registryEntry.celex) return null;
  }

  if (reference.euDocumentType && reference.euDocumentType !== registryEntry.documentType) return null;

  return { celex: registryEntry.celex, documentType: registryEntry.documentType };
}

export function buildEurLexFetchRequest(reference: {
  euCelex?: string;
  lawCode?: string;
  jurisdiction?: string;
  language?: string;
}): {
  url: string;
  headers: Record<string, string>;
} | null {
  if (!isEuLawLanguage(reference.language)) return null;
  const identity = resolveEuCelexIdentity(reference);
  if (!identity) return null;
  return {
    url: `https://publications.europa.eu/resource/celex/${identity.celex}`,
    headers: {
      Accept: "application/xml;notice=identifiers",
    },
  };
}

export function buildEurLexXhtmlFetchRequest(reference: {
  language?: string;
}, cellarUuid: string): {
  url: string;
  headers: Record<string, string>;
} | null {
  if (!isEuLawLanguage(reference.language) || !isCellarUuid(cellarUuid)) return null;
  return {
    url: `${EUR_LEX_CELLAR_RESOURCE_BASE_URL}/${cellarUuid}`,
    headers: {
      Accept: "application/xhtml+xml",
      "Accept-Language": euLanguageToEliCode(reference.language as EuLawLanguage),
      "Accept-Max-Cs-Size": "8388608",
    },
  };
}

export function isCellarUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

export function canMapEurLexReference(reference: {
  euCelex?: string;
  lawCode?: string;
  jurisdiction?: string;
  language?: string;
  referenceType?: string;
}): boolean {
  return reference.jurisdiction === "EU"
    && reference.referenceType === "article"
    && isEuLawLanguage(reference.language)
    && resolveEuCelexIdentity(reference) !== null;
}

export function buildEurLexSectionUrl(reference: {
  euCelex?: string;
  lawCode?: string;
  jurisdiction?: string;
  language?: string;
  referenceType?: string;
}): string | null {
  if (!canMapEurLexReference(reference)) return null;
  const identity = resolveEuCelexIdentity(reference);
  if (!identity) return null;
  const parsed = parseEuCelex(identity.celex);
  if (!parsed) return null;
  const eliType = parsed.documentType === "R"
    ? "reg"
    : parsed.documentType === "L"
      ? "dir"
      : "dec";
  return `https://eur-lex.europa.eu/eli/${eliType}/${parsed.year}/${Number(parsed.number)}/oj/${euLanguageToEliCode(reference.language! as EuLawLanguage)}/html`;
}
