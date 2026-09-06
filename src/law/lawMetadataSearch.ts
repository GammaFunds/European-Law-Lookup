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

export function searchLawMetadata(params: {
  query: string;
  jurisdiction: LawMetadataJurisdiction;
  entries: readonly LawMetadataSearchEntry[];
  limit?: number;
}): LawMetadataSuggestion[] {
  const normalizedQuery = normalize(params.query);
  if (normalizedQuery.length < 2) return [];

  const limit = params.limit ?? 8;
  if (!Number.isInteger(limit) || limit <= 0) return [];

  const ranked: RankedSuggestion[] = [];
  for (const entry of params.entries) {
    if (entry.jurisdiction !== params.jurisdiction) continue;

    const aliases = [entry.canonicalInput, ...(entry.aliases ?? [])];
    if (aliases.some((alias) => normalize(alias) === normalizedQuery)) {
      ranked.push({
        rank: 1,
        sortKey: suggestionSortKey(entry),
        suggestion: { ...entry, matchKind: "exact-alias" },
      });
      continue;
    }

    const titles = [entry.title, ...(entry.alternateTitles ?? [])];
    const prefixTitle = titles.find((title) => normalize(title).startsWith(normalizedQuery));
    if (prefixTitle) {
      ranked.push({
        rank: 2,
        sortKey: suggestionSortKey(entry, prefixTitle),
        suggestion: { ...entry, matchKind: "title-prefix", matchedTitle: prefixTitle },
      });
      continue;
    }

    const containingTitle = titles.find((title) => normalize(title).includes(normalizedQuery));
    if (containingTitle) {
      ranked.push({
        rank: 3,
        sortKey: suggestionSortKey(entry, containingTitle),
        suggestion: { ...entry, matchKind: "title-contains", matchedTitle: containingTitle },
      });
      continue;
    }

    if (
      entry.jurisdiction === "EU"
      && [entry.celex, entry.year, entry.number]
        .filter((value): value is string => typeof value === "string")
        .some((value) => normalize(value).includes(normalizedQuery))
    ) {
      ranked.push({
        rank: 4,
        sortKey: suggestionSortKey(entry),
        suggestion: { ...entry, matchKind: "eu-technical" },
      });
    }
  }

  ranked.sort((left, right) => {
    if (left.rank !== right.rank) return left.rank - right.rank;
    if (left.sortKey < right.sortKey) return -1;
    if (left.sortKey > right.sortKey) return 1;
    return 0;
  });

  return ranked.slice(0, limit).map(({ suggestion }) => suggestion);
}

function normalize(value: string): string {
  return value.trim().toLowerCase();
}

function suggestionSortKey(entry: LawMetadataSearchEntry, matchedTitle?: string): string {
  return `${normalize(matchedTitle ?? entry.title)}\u0000${normalize(entry.canonicalInput)}`;
}
