import type { EuLawLanguage } from "./types";

export interface EuLanguageDefinition {
  code: EuLawLanguage;
  eliCode: string;
  nativeName: string;
}

export const EU_LANGUAGES: readonly EuLanguageDefinition[] = [
   ["bg", "bul", "Български"], ["es", "spa", "Español"], ["cs", "ces", "Čeština"], ["da", "dan", "Dansk"],
   ["de", "deu", "Deutsch"], ["et", "est", "Eesti"], ["el", "ell", "Ελληνικά"], ["en", "eng", "English"],
   ["fr", "fra", "Français"], ["ga", "gle", "Gaeilge"], ["hr", "hrv", "Hrvatski"], ["it", "ita", "Italiano"],
   ["lv", "lav", "Latviešu"], ["lt", "lit", "Lietuvių"], ["hu", "hun", "Magyar"], ["mt", "mlt", "Malti"],
   ["nl", "nld", "Nederlands"], ["pl", "pol", "Polski"], ["pt", "por", "Português"], ["ro", "ron", "Română"],
   ["sk", "slk", "Slovenčina"], ["sl", "slv", "Slovenščina"], ["fi", "fin", "Suomi"], ["sv", "swe", "Svenska"],
].map(([code, eliCode, nativeName]) => ({ code: code as EuLawLanguage, eliCode, nativeName }));

const byCode = new Map(EU_LANGUAGES.map((language) => [language.code, language]));
if (byCode.size !== 24 || new Set(EU_LANGUAGES.map((language) => language.eliCode)).size !== 24) {
  throw new Error("EU language registry must contain unique codes and ELI codes.");
}

export const EU_LANGUAGE_CODE_PATTERN = /^[a-z]{2}$/;

// The official CELLAR / EUR-Lex expression language identity is the three-letter code
// (e.g. "deu", "eng"). This is the dynamic runtime/transport identity and is NOT
// restricted to the 24 known EU languages below.
export const EU_CELLAR_LANGUAGE_CODE_PATTERN = /^[a-z]{3}$/;

export function isEuLawLanguage(value: unknown): value is EuLawLanguage {
  return typeof value === "string" && byCode.has(value as EuLawLanguage);
}

export function isEuLawLanguageCode(value: unknown): value is string {
  return typeof value === "string" && EU_LANGUAGE_CODE_PATTERN.test(value);
}

export function isEuCellarLanguageCode(value: string): boolean;
export function isEuCellarLanguageCode(value: unknown): value is string;
export function isEuCellarLanguageCode(value: unknown): boolean {
  return typeof value === "string" && EU_CELLAR_LANGUAGE_CODE_PATTERN.test(value);
}

export function normalizeEuCellarLanguageCode(value: unknown): string | null {
  if (!isEuCellarLanguageCode(value)) return null;
  return value;
}

const legacyToCellar = new Map<string, string>(EU_LANGUAGES.map((language) => [language.code, language.eliCode]));
const cellarCodeToLegacy = new Map<string, EuLawLanguage>(EU_LANGUAGES.map((language) => [language.eliCode, language.code]));
const cellarCodeToNativeName = new Map<string, string>(EU_LANGUAGES.map((language) => [language.eliCode, language.nativeName]));

// UI/legacy mapping only: a known two-letter UI code maps to its CELLAR three-letter code.
// This is NOT an admission whitelist for transport.
export function legacyEuLawLanguageToCellarCode(language: EuLawLanguage): string {
  return legacyToCellar.get(language) ?? language;
}

export function cellarCodeToLegacyEuLawLanguage(code: string): EuLawLanguage | null {
  if (!isEuCellarLanguageCode(code)) return null;
  return cellarCodeToLegacy.get(code) ?? null;
}

// Resolve any UI/legacy or CELLAR language identity to the canonical three-letter
// CELLAR code used by the transport. Returns null only for unrecognized identities.
export function resolveCellarLanguageCode(language: string | undefined): string | null {
  if (typeof language !== "string") return null;
  if (isEuCellarLanguageCode(language)) return language;
  if (isEuLawLanguage(language)) return legacyToCellar.get(language) ?? null;
  return null;
}

// Cache identity token: known languages collapse to the two-letter UI code so existing
// cache keys stay stable; an unknown CELLAR code is used verbatim (never falls back).
// Missing language defaults to German; an explicit but invalid token fails closed
// and returns null so it cannot create or read a EU cache entry.
export function euLanguageCacheToken(language: string | undefined): string | null {
  if (language === undefined) return "de";
  if (isEuLawLanguage(language)) return language;
  if (isEuCellarLanguageCode(language)) {
    const twoLetter = cellarCodeToLegacy.get(language);
    return twoLetter ?? language;
  }
  return null;
}

export function cellarLanguageNativeName(code: string): string | null {
  if (isEuCellarLanguageCode(code)) return cellarCodeToNativeName.get(code) ?? null;
  if (isEuLawLanguage(code)) {
    const eli = legacyToCellar.get(code);
    return eli ? cellarCodeToNativeName.get(eli) ?? null : null;
  }
  return null;
}

export function euLanguageNativeName(language: EuLawLanguage): string;
export function euLanguageNativeName(language: string): string | null;
export function euLanguageNativeName(language: string): string | null {
  if (!isEuLawLanguageCode(language)) return null;
  const known = byCode.get(language as EuLawLanguage);
  return known ? known.nativeName : null;
}

export function defaultEuLawLanguage(locale: unknown, storedValue?: unknown): EuLawLanguage {
  if (isEuLawLanguage(storedValue)) return storedValue;
  const primary = typeof locale === "string" ? locale.toLowerCase().split(/[-_]/)[0] : "";
  return isEuLawLanguage(primary) ? primary : "de";
}
