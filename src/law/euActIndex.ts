import type { EuDocumentType } from "./types";
import { parseEuCelex } from "./euActRegistry";
import { isEuCellarLanguageCode } from "./euLanguages";

export const EU_ACT_INDEX_SCHEMA_VERSION = 1;

export interface EuActIndexEntry {
  celex: string;
  documentType: EuDocumentType;
  year: string;
  number: string;
  titlesByLanguage: Record<string, string>;
  availableLanguages: string[];
}

export interface EuActIndex {
  schemaVersion: number;
  lastSyncCheckpoint: string | null;
  entries: ReadonlyMap<string, EuActIndexEntry>;
}

export interface StoredEuActIndexEntry {
  celex: string;
  documentType: EuDocumentType;
  year: string;
  number: string;
  titlesByLanguage: Record<string, string>;
  availableLanguages: string[];
}

export interface StoredEuActIndex {
  schemaVersion: number;
  lastSyncCheckpoint: string | null;
  generatedAt: string;
  entries: StoredEuActIndexEntry[];
}

export class EuActIndexValidationError extends Error {}

export function emptyEuActIndex(): EuActIndex {
  return {
    schemaVersion: EU_ACT_INDEX_SCHEMA_VERSION,
    lastSyncCheckpoint: null,
    entries: new Map(),
  };
}

export function validateEuActIndexEntry(entry: unknown): EuActIndexEntry {
  if (typeof entry !== "object" || entry === null) {
    throw new EuActIndexValidationError("EU act index entry must be an object.");
  }
  const candidate = entry as Record<string, unknown>;
  const celex = candidate.celex;
  if (typeof celex !== "string") {
    throw new EuActIndexValidationError("EU act index entry requires a string celex.");
  }
  const parsed = parseEuCelex(celex);
  if (!parsed) {
    throw new EuActIndexValidationError(
      `EU act index entry has a CELEX "${celex}" outside the supported sector-3 R/L/D original scope.`,
    );
  }
  if (parsed.documentType !== candidate.documentType) {
    throw new EuActIndexValidationError(
      `EU act index entry CELEX "${celex}" declares documentType "${String(candidate.documentType)}" but parsed "${parsed.documentType}".`,
    );
  }
  const documentType = candidate.documentType;
  if (documentType !== "R" && documentType !== "L" && documentType !== "D") {
    throw new EuActIndexValidationError(
      `EU act index entry has an unsupported documentType "${String(documentType)}".`,
    );
  }
  if (typeof candidate.year !== "string" || candidate.year !== parsed.year) {
    throw new EuActIndexValidationError(`EU act index entry CELEX "${celex}" has an inconsistent year.`);
  }
  const year = candidate.year;
  if (typeof candidate.number !== "string" || candidate.number !== parsed.number) {
    throw new EuActIndexValidationError(`EU act index entry CELEX "${celex}" has an inconsistent number.`);
  }
  const number = candidate.number;
  const titlesByLanguageRaw = candidate.titlesByLanguage;
  if (typeof titlesByLanguageRaw !== "object" || titlesByLanguageRaw === null) {
    throw new EuActIndexValidationError(`EU act index entry CELEX "${celex}" requires an object titlesByLanguage.`);
  }
  const titlesByLanguage: Record<string, string> = {};
  for (const [language, title] of Object.entries(titlesByLanguageRaw as Record<string, unknown>)) {
    if (!isEuCellarLanguageCode(language)) {
      throw new EuActIndexValidationError(
        `EU act index entry CELEX "${celex}" has a non-admitted language title key "${language}".`,
      );
    }
    if (typeof title !== "string") {
      throw new EuActIndexValidationError(
        `EU act index entry CELEX "${celex}" has a non-string title for language "${language}".`,
      );
    }
    titlesByLanguage[language] = title;
  }
  const availableLanguagesRaw = candidate.availableLanguages;
  if (!Array.isArray(availableLanguagesRaw)) {
    throw new EuActIndexValidationError(`EU act index entry CELEX "${celex}" requires an array availableLanguages.`);
  }
  const availableLanguages = new Set<string>();
  for (const language of availableLanguagesRaw) {
    if (!isEuCellarLanguageCode(language)) {
      throw new EuActIndexValidationError(
        `EU act index entry CELEX "${celex}" lists a non-admitted available language "${String(language)}".`,
      );
    }
    availableLanguages.add(language);
  }
  return {
    celex,
    documentType,
    year,
    number,
    titlesByLanguage,
    availableLanguages: [...availableLanguages].sort(),
  };
}

export function parseStoredEuActIndex(raw: unknown): EuActIndex {
  if (typeof raw !== "object" || raw === null) {
    throw new EuActIndexValidationError("EU act index must be an object.");
  }
  const candidate = raw as Record<string, unknown>;
  const schemaVersion = candidate.schemaVersion;
  if (schemaVersion !== EU_ACT_INDEX_SCHEMA_VERSION) {
    throw new EuActIndexValidationError(
      `Unsupported EU act index schema version "${String(schemaVersion)}".`,
    );
  }
  const entriesRaw = candidate.entries;
  if (!Array.isArray(entriesRaw)) {
    throw new EuActIndexValidationError("EU act index requires an array of entries.");
  }
  const seenCelex = new Set<string>();
  const entries = new Map<string, EuActIndexEntry>();
  for (const entryRaw of entriesRaw) {
    const entry = validateEuActIndexEntry(entryRaw);
    if (seenCelex.has(entry.celex)) {
      throw new EuActIndexValidationError(`EU act index contains a duplicate CELEX "${entry.celex}".`);
    }
    seenCelex.add(entry.celex);
    entries.set(entry.celex, entry);
  }
  const lastSyncCheckpoint = candidate.lastSyncCheckpoint;
  if (lastSyncCheckpoint !== null && (typeof lastSyncCheckpoint !== "string" || !isIsoTimestamp(lastSyncCheckpoint))) {
    throw new EuActIndexValidationError("EU act index lastSyncCheckpoint must be null or an ISO timestamp.");
  }
  return {
    schemaVersion: EU_ACT_INDEX_SCHEMA_VERSION,
    lastSyncCheckpoint: lastSyncCheckpoint ?? null,
    entries,
  };
}

export function serializeEuActIndex(index: EuActIndex, generatedAt: string): StoredEuActIndex {
  return {
    schemaVersion: EU_ACT_INDEX_SCHEMA_VERSION,
    lastSyncCheckpoint: index.lastSyncCheckpoint,
    generatedAt,
    entries: [...index.entries.values()].map((entry) => ({
      celex: entry.celex,
      documentType: entry.documentType,
      year: entry.year,
      number: entry.number,
      titlesByLanguage: { ...entry.titlesByLanguage },
      availableLanguages: [...entry.availableLanguages],
    })),
  };
}

export function indexEntryForCelex(index: EuActIndex, celex: string): EuActIndexEntry | null {
  const normalized = celex.trim().toUpperCase();
  return index.entries.get(normalized) ?? null;
}

export function isEuActIndexEntryAvailableLanguage(entry: EuActIndexEntry, language: string): boolean {
  return entry.availableLanguages.includes(language);
}

export function searchEuActIndex(index: EuActIndex, query: string): EuActIndexEntry[] {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return [];
  const results: EuActIndexEntry[] = [];
  for (const entry of index.entries.values()) {
    if (entry.celex.toLowerCase().includes(normalized)) {
      results.push(entry);
      continue;
    }
    if (entry.year.includes(normalized) || entry.number.includes(normalized)) {
      results.push(entry);
      continue;
    }
    const titleMatch = Object.values(entry.titlesByLanguage).some((title) =>
      title.toLowerCase().includes(normalized),
    );
    if (titleMatch) results.push(entry);
  }
  return results;
}

export function addOrReplaceEntry(index: EuActIndex, entry: EuActIndexEntry): EuActIndex {
  const entries = new Map(index.entries);
  entries.set(entry.celex, entry);
  return {
    schemaVersion: index.schemaVersion,
    lastSyncCheckpoint: index.lastSyncCheckpoint,
    entries,
  };
}

export function euActIndexEntryOfficialTitle(entry: EuActIndexEntry, language?: string): string | null {
  if (language && entry.titlesByLanguage[language]) return entry.titlesByLanguage[language];
  for (const preferred of ["en", "de", "fr"]) {
    if (entry.titlesByLanguage[preferred]) return entry.titlesByLanguage[preferred];
  }
  const first = Object.values(entry.titlesByLanguage)[0];
  return first ?? null;
}

function isIsoTimestamp(value: string): boolean {
  const ms = Date.parse(value);
  return Number.isFinite(ms) && value.includes("T");
}
