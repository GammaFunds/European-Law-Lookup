import { parseDkCanonicalEli } from "./retsinformationIdentity";

export const RETSINFORMATION_INDEX_SCHEMA_VERSION = 1;

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

export class RetsinformationIndexValidationError extends Error {}

const entryFields = [
  "canonicalEli",
  "popularTitle",
  "documentTitle",
  "documentType",
  "pubMedia",
  "year",
  "number",
  "status",
  "startDate",
  "endDate",
  "changeDate",
  "accessionNumber",
  "ministry",
  "announcedIn",
  "sourceUpdateTimestamp",
  "sitemapLastModified",
] as const;

const indexFields = [
  "schemaVersion",
  "source",
  "generatedAt",
  "lastSuccessfulRefresh",
  "lastSuccessfulIncrementalRefresh",
  "lastSuccessfulFullReconciliation",
  "feedWatermark",
  "entries",
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireExactFields(value: Record<string, unknown>, fields: readonly string[], label: string): void {
  const actual = Object.keys(value).sort();
  const expected = [...fields].sort();
  if (actual.length !== expected.length || actual.some((field, index) => field !== expected[index])) {
    throw new RetsinformationIndexValidationError(`${label} has an invalid field shape.`);
  }
}

function stringOrNull(value: unknown, field: string): string | null {
  if (value === null) return null;
  if (typeof value !== "string") {
    throw new RetsinformationIndexValidationError(`${field} must be a string or null.`);
  }
  return value;
}

export function parseStoredRetsinformationIndex(raw: unknown): RetsinformationIndex {
  if (!isRecord(raw)) {
    throw new RetsinformationIndexValidationError("Retsinformation index must be an object.");
  }
  requireExactFields(raw, indexFields, "Retsinformation index");
  if (raw.schemaVersion !== RETSINFORMATION_INDEX_SCHEMA_VERSION) {
    throw new RetsinformationIndexValidationError("Unsupported Retsinformation index schema version.");
  }
  if (raw.source !== "retsinformation-eli") {
    throw new RetsinformationIndexValidationError("Unsupported Retsinformation index source.");
  }
  if (typeof raw.generatedAt !== "string") {
    throw new RetsinformationIndexValidationError("generatedAt must be a string.");
  }
  const lastSuccessfulRefresh = stringOrNull(raw.lastSuccessfulRefresh, "lastSuccessfulRefresh");
  const lastSuccessfulIncrementalRefresh = stringOrNull(
    raw.lastSuccessfulIncrementalRefresh,
    "lastSuccessfulIncrementalRefresh",
  );
  const lastSuccessfulFullReconciliation = stringOrNull(
    raw.lastSuccessfulFullReconciliation,
    "lastSuccessfulFullReconciliation",
  );
  const feedWatermark = stringOrNull(raw.feedWatermark, "feedWatermark");
  if (!Array.isArray(raw.entries)) {
    throw new RetsinformationIndexValidationError("entries must be an array.");
  }

  const seen = new Set<string>();
  const entries = raw.entries.map((rawEntry, index) => {
    if (!isRecord(rawEntry)) {
      throw new RetsinformationIndexValidationError(`Entry ${index} must be an object.`);
    }
    requireExactFields(rawEntry, entryFields, `Entry ${index}`);
    if (typeof rawEntry.canonicalEli !== "string") {
      throw new RetsinformationIndexValidationError(`Entry ${index} canonicalEli must be a string.`);
    }
    const parsed = parseDkCanonicalEli(rawEntry.canonicalEli);
    if (!parsed || parsed.canonicalEli !== rawEntry.canonicalEli) {
      throw new RetsinformationIndexValidationError(`Entry ${index} canonicalEli is not canonical.`);
    }
    if (seen.has(parsed.canonicalEli)) {
      throw new RetsinformationIndexValidationError(`Duplicate canonicalEli "${parsed.canonicalEli}".`);
    }
    seen.add(parsed.canonicalEli);
    for (const field of ["documentTitle", "documentType", "pubMedia", "year", "number"] as const) {
      if (typeof rawEntry[field] !== "string") {
        throw new RetsinformationIndexValidationError(`Entry ${index} ${field} must be a string.`);
      }
    }
    const documentTitle = rawEntry.documentTitle as string;
    const documentType = rawEntry.documentType as string;
    const pubMedia = rawEntry.pubMedia as string;
    const year = rawEntry.year as string;
    const number = rawEntry.number as string;
    if (pubMedia !== parsed.pubMedia || year !== parsed.year || number !== parsed.number) {
      throw new RetsinformationIndexValidationError(`Entry ${index} identity fields do not match canonicalEli.`);
    }
    return {
      canonicalEli: rawEntry.canonicalEli,
      popularTitle: stringOrNull(rawEntry.popularTitle, "popularTitle"),
      documentTitle,
      documentType,
      pubMedia,
      year,
      number,
      status: stringOrNull(rawEntry.status, "status"),
      startDate: stringOrNull(rawEntry.startDate, "startDate"),
      endDate: stringOrNull(rawEntry.endDate, "endDate"),
      changeDate: stringOrNull(rawEntry.changeDate, "changeDate"),
      accessionNumber: stringOrNull(rawEntry.accessionNumber, "accessionNumber"),
      ministry: stringOrNull(rawEntry.ministry, "ministry"),
      announcedIn: stringOrNull(rawEntry.announcedIn, "announcedIn"),
      sourceUpdateTimestamp: stringOrNull(rawEntry.sourceUpdateTimestamp, "sourceUpdateTimestamp"),
      sitemapLastModified: stringOrNull(rawEntry.sitemapLastModified, "sitemapLastModified"),
    };
  });

  return {
    schemaVersion: RETSINFORMATION_INDEX_SCHEMA_VERSION,
    source: "retsinformation-eli",
    generatedAt: raw.generatedAt,
    lastSuccessfulRefresh,
    lastSuccessfulIncrementalRefresh,
    lastSuccessfulFullReconciliation,
    feedWatermark,
    entries,
  };
}
