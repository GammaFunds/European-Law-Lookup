import { parseEuCelex } from "./euActRegistry";
import { euDocumentTypeForHumanCitationActLabel } from "./euHumanCitation";
import type { EuDocumentType } from "./types";

export type LawMetadataJurisdiction = "DE" | "AT" | "CH" | "EU";

export type LawMetadataMatchKind =
  | "exact-alias"
  | "title-prefix"
  | "title-contains"
  | "eu-technical";

export interface LawMetadataSearchEntry {
  jurisdiction: LawMetadataJurisdiction;
  canonicalInput: string;
  title: string;
  aliases?: readonly string[];
  alternateTitles?: readonly string[];
  celex?: string;
  year?: string;
  number?: string;
}

export interface LawMetadataSuggestion extends LawMetadataSearchEntry {
  matchKind: LawMetadataMatchKind;
  matchedTitle?: string;
}

interface RankedSuggestion {
  rank: number;
  sortKey: string;
  suggestion: LawMetadataSuggestion;
}

interface EuStructuredQuery {
  documentType: EuDocumentType | null;
  year: string;
  number: string | null;
}

export function searchLawMetadata(params: {
  query: string;
  jurisdiction: LawMetadataJurisdiction;
  entries: Iterable<LawMetadataSearchEntry>;
  limit?: number;
}): LawMetadataSuggestion[] {
  const normalizedQuery = normalize(params.query);
  if (normalizedQuery.length < 2) return [];

  const limit = params.limit ?? 8;
  if (!Number.isInteger(limit) || limit <= 0) return [];

  const euStructuredQuery = params.jurisdiction === "EU"
    ? parseEuStructuredQuery(params.query)
    : null;
  const ranked: RankedSuggestion[] = [];
  for (const entry of params.entries) {
    if (entry.jurisdiction !== params.jurisdiction) continue;

    const exactAliases = [entry.canonicalInput, ...(entry.aliases ?? [])];
    const exactAlias = exactAliases.find((alias) => normalize(alias) === normalizedQuery);
    if (exactAlias) {
      addRanked(ranked, {
        rank: 1,
        sortKey: suggestionSortKey(entry, exactAlias),
        suggestion: suggestionForAlias(entry, "exact-alias", exactAlias),
      }, limit);
      continue;
    }

    if (entry.jurisdiction === "EU") {
      const prefixAlias = (entry.aliases ?? []).find((alias) => normalize(alias).startsWith(normalizedQuery));
      if (prefixAlias) {
        addRanked(ranked, {
          rank: 2,
          sortKey: suggestionSortKey(entry, prefixAlias),
          suggestion: suggestionForAlias(entry, "title-prefix", prefixAlias),
        }, limit);
        continue;
      }
    }

    const titles = [entry.title, ...(entry.alternateTitles ?? [])];
    const prefixTitle = titles.find((title) => normalize(title).startsWith(normalizedQuery));
    if (prefixTitle) {
      addRanked(ranked, {
        rank: 2,
        sortKey: suggestionSortKey(entry, prefixTitle),
        suggestion: { ...entry, matchKind: "title-prefix", matchedTitle: prefixTitle },
      }, limit);
      continue;
    }

    if (entry.jurisdiction === "EU") {
      const containingAlias = (entry.aliases ?? []).find((alias) => normalize(alias).includes(normalizedQuery));
      if (containingAlias) {
        addRanked(ranked, {
          rank: 3,
          sortKey: suggestionSortKey(entry, containingAlias),
          suggestion: suggestionForAlias(entry, "title-contains", containingAlias),
        }, limit);
        continue;
      }
    }

    const containingTitle = titles.find((title) => normalize(title).includes(normalizedQuery));
    if (containingTitle) {
      addRanked(ranked, {
        rank: 3,
        sortKey: suggestionSortKey(entry, containingTitle),
        suggestion: { ...entry, matchKind: "title-contains", matchedTitle: containingTitle },
      }, limit);
      continue;
    }

    if (entry.jurisdiction === "EU" && euStructuredQuery && matchesEuStructuredQuery(entry, euStructuredQuery)) {
      addRanked(ranked, {
        rank: 4,
        sortKey: suggestionSortKey(entry),
        suggestion: { ...entry, matchKind: "eu-technical" },
      }, limit);
      continue;
    }

    if (
      entry.jurisdiction === "EU"
      && [entry.celex, entry.year, entry.number]
        .filter((value): value is string => typeof value === "string")
        .some((value) => normalize(value).includes(normalizedQuery))
    ) {
      addRanked(ranked, {
        rank: 4,
        sortKey: suggestionSortKey(entry),
        suggestion: { ...entry, matchKind: "eu-technical" },
      }, limit);
    }
  }

  return ranked.map(({ suggestion }) => suggestion);
}

function suggestionForAlias(
  entry: LawMetadataSearchEntry,
  matchKind: LawMetadataMatchKind,
  alias: string,
): LawMetadataSuggestion {
  if (
    entry.jurisdiction === "EU"
    && normalize(entry.title) === normalize(entry.canonicalInput)
    && normalize(alias) !== normalize(entry.canonicalInput)
  ) {
    return { ...entry, title: alias, matchKind, matchedTitle: alias };
  }
  return entry.jurisdiction === "EU"
    ? { ...entry, matchKind, matchedTitle: alias }
    : { ...entry, matchKind };
}

function parseEuStructuredQuery(query: string): EuStructuredQuery | null {
  const normalized = query.normalize("NFKC").trim().replace(/\s+/g, " ");
  const generic = /^(\d{4})(?:\s*[/-]\s*|\s+)(\d{1,6})$/u.exec(normalized);
  if (generic) {
    return { documentType: null, year: generic[1], number: generic[2] };
  }

  const typed = /^(.+?)\s+(\d{4})(?:(?:\s*[/-]\s*|\s+)(\d{1,6}))?$/u.exec(normalized);
  if (!typed) return null;
  const documentType = euDocumentTypeForSearchLabel(typed[1]);
  if (!documentType) return null;
  return { documentType, year: typed[2], number: typed[3] ?? null };
}

function euDocumentTypeForSearchLabel(label: string): EuDocumentType | null {
  const normalized = normalize(label).replace(/\.$/u, "");
  if (normalized === "vo") return "R";
  if (normalized === "rl") return "L";
  return euDocumentTypeForHumanCitationActLabel(label);
}

function matchesEuStructuredQuery(entry: LawMetadataSearchEntry, query: EuStructuredQuery): boolean {
  if (!entry.celex || !entry.year || !entry.number || entry.year !== query.year) return false;
  const parsed = parseEuCelex(entry.celex);
  if (!parsed) return false;
  if (query.documentType && parsed.documentType !== query.documentType) return false;
  if (query.number !== null && !sameEuDocumentNumber(entry.number, query.number)) return false;
  return true;
}

function sameEuDocumentNumber(left: string, right: string): boolean {
  if (!/^\d{1,6}$/.test(left) || !/^\d{1,6}$/.test(right)) return false;
  const leftNumber = Number(left);
  const rightNumber = Number(right);
  return leftNumber > 0 && rightNumber > 0 && leftNumber === rightNumber;
}

function addRanked(ranked: RankedSuggestion[], candidate: RankedSuggestion, limit: number): void {
  const insertAt = ranked.findIndex((entry) => compareRanked(candidate, entry) < 0);
  if (insertAt === -1) ranked.push(candidate);
  else ranked.splice(insertAt, 0, candidate);
  if (ranked.length > limit) ranked.pop();
}

function compareRanked(left: RankedSuggestion, right: RankedSuggestion): number {
  if (left.rank !== right.rank) return left.rank - right.rank;
  if (left.sortKey < right.sortKey) return -1;
  if (left.sortKey > right.sortKey) return 1;
  return 0;
}

function normalize(value: string): string {
  return value.normalize("NFKC").trim().toLowerCase();
}

function suggestionSortKey(entry: LawMetadataSearchEntry, matchedTitle?: string): string {
  return `${normalize(matchedTitle ?? entry.title)}\u0000${normalize(entry.canonicalInput)}`;
}
