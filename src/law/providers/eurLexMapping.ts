import { euLanguageToEliCode, isEuLawLanguage } from "../euLanguages";
import type { LawReference } from "../types";
import { euActForLawCode, parseEuCelex } from "../euActRegistry";

export const EUR_LEX_DSGVO_CELEX = "32016R0679";
export const EUR_LEX_DSGVO_ELI_PATH = "reg/2016/679/oj";
export const EUR_LEX_DSGVO_ALIASES = ["DSGVO", "GDPR", "RGPD", "RODO"] as const;

export const EUR_LEX_DSGVO_CELLAR_URL = `https://publications.europa.eu/resource/celex/${EUR_LEX_DSGVO_CELEX}`;

export function buildEurLexFetchRequest(reference: LawReference): {
  url: string;
  headers: Record<string, string>;
} | null {
  if (!canMapEurLexReference(reference)) return null;
  const entry = euActForLawCode(reference.lawCode);
  if (!entry) return null;
  return {
    url: `https://publications.europa.eu/resource/celex/${entry.celex}`,
    headers: {
      Accept: "application/xhtml+xml",
      "Accept-Language": euLanguageToEliCode(reference.language!),
      "Accept-Max-Cs-Size": "8388608",
    },
  };
}

export function canMapEurLexReference(reference: LawReference): boolean {
  return reference.jurisdiction === "EU" && euActForLawCode(reference.lawCode) !== null
    && reference.referenceType === "article" && isEuLawLanguage(reference.language);
}

export function buildEurLexSectionUrl(reference: LawReference): string | null {
  if (!canMapEurLexReference(reference)) return null;
  const entry = euActForLawCode(reference.lawCode);
  const parsedCelex = entry ? parseEuCelex(entry.celex) : null;
  if (!entry || !parsedCelex) return null;
  const eliType = parsedCelex.documentType === "R"
    ? "reg"
    : parsedCelex.documentType === "L"
      ? "dir"
      : "dec";
  return `https://eur-lex.europa.eu/eli/${eliType}/${parsedCelex.year}/${Number(parsedCelex.number)}/oj/${euLanguageToEliCode(reference.language!)}/html`;
}
