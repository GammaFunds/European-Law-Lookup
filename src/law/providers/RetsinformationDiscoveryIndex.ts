import { parseDkCanonicalEli } from "./retsinformationIdentity";

export interface RetsinformationIndex {
  schemaVersion: 1;
  source: "retsinformation-eli";
  generatedAt: string;
  lastSuccessfulRefresh: string | null;
  lastSuccessfulIncrementalRefresh: string | null;
  lastSuccessfulFullReconciliation: string | null;
  feedWatermark: string | null;
  entries: RetsinformationIndexEntry[];
}

export interface RetsinformationIndexEntry {
  canonicalEli: string;
  popularTitle: string | null;
  documentTitle: string;
  documentType: string;
  pubMedia: string;
  year: string;
  number: string;
  status: string | null;
  startDate: string | null;
  endDate: string | null;
  changeDate: string | null;
  accessionNumber: string | null;
  ministry: string | null;
  announcedIn: string | null;
  sourceUpdateTimestamp: string | null;
  sitemapLastModified: string | null;
}

const nullableIndexFields = [
  "lastSuccessfulRefresh",
  "lastSuccessfulIncrementalRefresh",
  "lastSuccessfulFullReconciliation",
  "feedWatermark",
] as const;

const nullableEntryFields = [
  "popularTitle", "status", "startDate", "endDate", "changeDate", "accessionNumber",
  "ministry", "announcedIn", "sourceUpdateTimestamp", "sitemapLastModified",
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireString(value: unknown, field: string): asserts value is string {
  if (typeof value !== "string") throw new Error(`Invalid stored Retsinformation index field: ${field}`);
}

function requireNullableString(value: unknown, field: string): asserts value is string | null {
  if (value !== null && typeof value !== "string") {
    throw new Error(`Invalid stored Retsinformation index nullable field: ${field}`);
  }
}

function requireOwn(record: Record<string, unknown>, field: string): void {
  if (!Object.prototype.hasOwnProperty.call(record, field)) {
    throw new Error(`Missing stored Retsinformation index field: ${field}`);
  }
}

export function parseStoredRetsinformationIndex(raw: unknown): RetsinformationIndex {
  if (!isRecord(raw)) {
    throw new Error("Invalid stored Retsinformation index root.");
  }
  requireOwn(raw, "schemaVersion");
  requireOwn(raw, "source");
  if (raw.schemaVersion !== 1 || raw.source !== "retsinformation-eli") {
    throw new Error("Invalid stored Retsinformation index root.");
  }
  requireOwn(raw, "generatedAt");
  const generatedAt = raw.generatedAt;
  requireString(generatedAt, "generatedAt");
  for (const field of nullableIndexFields) {
    requireOwn(raw, field);
    requireNullableString(raw[field], field);
  }
  requireOwn(raw, "entries");
  if (!Array.isArray(raw.entries)) throw new Error("Invalid stored Retsinformation index entries.");

  const seen = new Set<string>();
  const entries = raw.entries.map((value, index) => {
    if (!isRecord(value)) throw new Error(`Invalid stored Retsinformation index entry: ${index}`);
    for (const field of [
      "canonicalEli", "popularTitle", "documentTitle", "documentType", "pubMedia", "year", "number",
      "status", "startDate", "endDate", "changeDate", "accessionNumber", "ministry", "announcedIn",
      "sourceUpdateTimestamp", "sitemapLastModified",
    ]) requireOwn(value, field);
    const canonicalEli = value.canonicalEli;
    const documentTitle = value.documentTitle;
    const documentType = value.documentType;
    const pubMedia = value.pubMedia;
    const year = value.year;
    const number = value.number;
    requireString(canonicalEli, "canonicalEli");
    requireString(documentTitle, "documentTitle");
    requireString(documentType, "documentType");
    requireString(pubMedia, "pubMedia");
    requireString(year, "year");
    requireString(number, "number");
    for (const field of nullableEntryFields) requireNullableString(value[field], field);
    const identity = parseDkCanonicalEli(canonicalEli);
    if (!identity || identity.canonicalEli !== canonicalEli) {
      throw new Error(`Invalid canonical Retsinformation ELI: ${canonicalEli}`);
    }
    if (pubMedia !== identity.pubMedia || year !== identity.year || number !== identity.number) {
      throw new Error(`Canonical Retsinformation ELI components do not match: ${canonicalEli}`);
    }
    if (seen.has(identity.canonicalEli)) throw new Error(`Duplicate canonical Retsinformation ELI: ${identity.canonicalEli}`);
    seen.add(identity.canonicalEli);
    return {
      canonicalEli,
      popularTitle: value.popularTitle as string | null,
      documentTitle,
      documentType,
      pubMedia,
      year,
      number,
      status: value.status as string | null,
      startDate: value.startDate as string | null,
      endDate: value.endDate as string | null,
      changeDate: value.changeDate as string | null,
      accessionNumber: value.accessionNumber as string | null,
      ministry: value.ministry as string | null,
      announcedIn: value.announcedIn as string | null,
      sourceUpdateTimestamp: value.sourceUpdateTimestamp as string | null,
      sitemapLastModified: value.sitemapLastModified as string | null,
    };
  });

  return {
    schemaVersion: 1,
    source: "retsinformation-eli",
    generatedAt,
    lastSuccessfulRefresh: raw.lastSuccessfulRefresh as string | null,
    lastSuccessfulIncrementalRefresh: raw.lastSuccessfulIncrementalRefresh as string | null,
    lastSuccessfulFullReconciliation: raw.lastSuccessfulFullReconciliation as string | null,
    feedWatermark: raw.feedWatermark as string | null,
    entries,
  };
}
