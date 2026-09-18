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

const ELI_NAMESPACE = "http://data.europa.eu/eli/ontology#";
const RETSINFORMATION_HOST = "https://www.retsinformation.dk";
const TYPE_DOCUMENT_AUTHORITY = "http://www.retsinformation.dk/eli/resource/authority/type_document#";

type JsonLdNode = Record<string, unknown>;

function jsonLdNodes(raw: unknown): JsonLdNode[] | null {
  if (Array.isArray(raw)) return raw.every(isRecord) ? raw.map((node) => node) : null;
  if (!isRecord(raw)) return null;
  const graph = raw["@graph"];
  if (!Array.isArray(graph) || !graph.every(isRecord)) return null;
  return graph.map((node) => node);
}

function jsonLdContext(raw: unknown): Record<string, unknown> {
  return isRecord(raw) && isRecord(raw["@context"]) ? raw["@context"] : {};
}

function expandJsonLdTerm(value: unknown, context: Record<string, unknown>): string | null {
  if (typeof value !== "string") return null;
  if (value.startsWith(ELI_NAMESPACE)) return value;
  const separator = value.indexOf(":");
  if (separator < 1) return null;
  const prefix = value.slice(0, separator);
  const local = value.slice(separator + 1);
  const definition = context[prefix];
  const namespace = definition === ELI_NAMESPACE
    ? definition
    : isRecord(definition) && definition["@id"] === ELI_NAMESPACE ? definition["@id"] : null;
  return namespace ? `${namespace}${local}` : null;
}

function jsonLdValues(node: JsonLdNode, property: string, context: Record<string, unknown>): unknown[] {
  return Object.entries(node).flatMap(([key, value]) => {
    if (key === property || expandJsonLdTerm(key, context) === property) {
      return Array.isArray(value) ? value.map((item) => item as unknown) : [value];
    }
    return [];
  });
}

function jsonLdStrings(node: JsonLdNode, property: string, context: Record<string, unknown>): string[] {
  return jsonLdValues(node, property, context).flatMap((value) => {
    if (typeof value === "string") return [value];
    if (isRecord(value) && typeof value["@value"] === "string") return [value["@value"]];
    return [];
  });
}

function jsonLdIds(node: JsonLdNode, property: string, context: Record<string, unknown>): string[] {
  return jsonLdValues(node, property, context).flatMap((value) => {
    if (isRecord(value) && typeof value["@id"] === "string") return [value["@id"]];
    if (typeof value === "string") return [value];
    return [];
  });
}

function hasJsonLdType(node: JsonLdNode, type: string, context: Record<string, unknown>): boolean {
  const types = Array.isArray(node["@type"]) ? node["@type"] : [node["@type"]];
  return types.some((value) => expandJsonLdTerm(value, context) === type);
}

function oneString(values: string[]): string | null {
  const unique = [...new Set(values.filter((value) => value.trim() !== ""))];
  return unique.length === 1 ? unique[0] : null;
}

function oneId(values: string[]): string | null {
  return oneString(values);
}

export function parseRetsinformationJsonLd(
  json: unknown,
  canonicalEli: string,
  observedAt: string,
): Omit<RetsinformationIndexEntry, "sitemapLastModified"> | null {
  const identity = typeof canonicalEli === "string" ? parseDkCanonicalEli(canonicalEli) : null;
  if (!identity || !observedAt.trim()) return null;

  let raw: unknown;
  try { raw = typeof json === "string" ? JSON.parse(json) : json; } catch { return null; }
  const nodes = jsonLdNodes(raw);
  if (!nodes) return null;
  const context = jsonLdContext(raw);
  const resourceId = `${RETSINFORMATION_HOST}${identity.canonicalEli}`;
  const resources = nodes.filter((node) => node["@id"] === resourceId && hasJsonLdType(node, `${ELI_NAMESPACE}LegalResource`, context));
  if (resources.length !== 1) return null;
  const resource = resources[0];
  const expressions = nodes.filter((node) => hasJsonLdType(node, `${ELI_NAMESPACE}LegalExpression`, context)
    && jsonLdIds(node, `${ELI_NAMESPACE}realizes`, context).includes(resourceId));
  if (expressions.length !== 1) return null;
  const expression = expressions[0];

  const documentTitle = oneString(jsonLdStrings(expression, `${ELI_NAMESPACE}title`, context));
  const documentTypeId = oneId(jsonLdIds(resource, `${ELI_NAMESPACE}type_document`, context));
  const sourceNumber = oneString(jsonLdStrings(resource, `${ELI_NAMESPACE}number`, context));
  if (!documentTitle || !documentTypeId || !documentTypeId.startsWith(TYPE_DOCUMENT_AUTHORITY)
    || (sourceNumber !== null && sourceNumber !== identity.number)) return null;
  const documentType = documentTypeId.slice(TYPE_DOCUMENT_AUTHORITY.length);
  if (!documentType) return null;

  return {
    canonicalEli: identity.canonicalEli,
    popularTitle: oneString(jsonLdStrings(expression, `${ELI_NAMESPACE}title_alternative`, context)),
    documentTitle,
    documentType,
    pubMedia: identity.pubMedia,
    year: identity.year,
    number: identity.number,
    status: oneString(jsonLdStrings(resource, `${ELI_NAMESPACE}in_force`, context)),
    startDate: oneString(jsonLdStrings(resource, `${ELI_NAMESPACE}date_entry_in_force`, context)),
    endDate: oneString(jsonLdStrings(resource, `${ELI_NAMESPACE}date_no_longer_in_force`, context)),
    changeDate: oneString(jsonLdStrings(resource, `${ELI_NAMESPACE}date_document`, context)),
    accessionNumber: oneString(jsonLdStrings(resource, `${ELI_NAMESPACE}id_local`, context)),
    ministry: oneString(jsonLdStrings(resource, `${ELI_NAMESPACE}responsibility_of`, context)),
    announcedIn: oneString(jsonLdStrings(resource, `${ELI_NAMESPACE}publication`, context)),
    sourceUpdateTimestamp: observedAt,
  };
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
