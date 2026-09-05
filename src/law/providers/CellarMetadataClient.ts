import type { EuDocumentType } from "../types";
import { parseEuCelex, type ParsedEuCelex } from "../euActRegistry";
import { isEuCellarLanguageCode } from "../euLanguages";

export interface CellarWorkRecord {
  celex: string;
  documentType: EuDocumentType;
  year: string;
  number: string;
  titlesByLanguage: Record<string, string>;
  availableLanguages: string[];
}

export interface CellarDiscoveredWorkRecord extends CellarWorkRecord {
  workUri: string;
}

export interface CellarMetadataTransport {
  fetchSparqlJson(query: string): Promise<unknown>;
  fetchWorkRdf(celex: string): Promise<string>;
}

export const CELLAR_SPARQL_ENDPOINT = "https://publications.europa.eu/webapi/rdf/sparql";
export const CELLAR_WORK_RDF_ACCEPT = "application/rdf+xml";

const CDM_NS = "http://publications.europa.eu/ontology/cdm#";
const OWL_NS = "http://www.w3.org/2002/07/owl#";
const RDF_NS = "http://www.w3.org/1999/02/22-rdf-syntax-ns#";
const PURL_NS = "http://purl.org/dc/elements/1.1/";

const TARGET_CELEX_PATTERN = /^3\d{4}[RLD]\d{4,6}$/;
const DISCOVERY_CELEX_PATTERN = /^3\d{4}[RLD]\d{4,6}$/;

export interface CellarWorkCursor {
  workId: string;
  workUri: string;
}

export interface CellarWorkIdentity {
  work: string;
  celex: string;
}

export interface CellarTargetWorksPage {
  records: CellarDiscoveredWorkRecord[];
  nextCursor: CellarWorkCursor | null;
}

export class CellarMetadataError extends Error {}

function escapeSparqlString(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\r/g, "\\r").replace(/\n/g, "\\n");
}

function assertAdmittedCelex(celex: string): ParsedEuCelex {
  const parsed = parseEuCelex(celex);
  if (!parsed) {
    throw new CellarMetadataError(`CELLAR does not admit CELEX "${celex}".`);
  }
  return parsed;
}

function compareWorkIdentity(a: CellarWorkIdentity, b: CellarWorkCursor): number {
  if (a.celex !== b.workId) return a.celex < b.workId ? -1 : 1;
  if (a.work !== b.workUri) return a.work < b.workUri ? -1 : 1;
  return 0;
}

function assertIdentityPageIntegrity(identities: readonly CellarWorkIdentity[], cursor: CellarWorkCursor | null): void {
  if (identities.length === 0) return;
  let previous: CellarWorkCursor | null = cursor;
  const seen = new Set<string>();
  const worksByCelex = new Map<string, Set<string>>();
  const celexesByWork = new Map<string, Set<string>>();
  for (const identity of identities) {
    const key = `${identity.celex}\u0000${identity.work}`;
    if (seen.has(key)) {
      throw new CellarMetadataError("CELLAR identity page contained a duplicate Work identity tuple.");
    }
    seen.add(key);
    if (previous !== null && compareWorkIdentity(identity, previous) <= 0) {
      throw new CellarMetadataError("CELLAR identity page violated strict keyset ordering.");
    }
    previous = { workId: identity.celex, workUri: identity.work };
    let works = worksByCelex.get(identity.celex);
    if (!works) {
      works = new Set<string>();
      worksByCelex.set(identity.celex, works);
    }
    works.add(identity.work);
    let celexes = celexesByWork.get(identity.work);
    if (!celexes) {
      celexes = new Set<string>();
      celexesByWork.set(identity.work, celexes);
    }
    celexes.add(identity.celex);
  }
  for (const [celex, works] of worksByCelex) {
    if (works.size > 1) {
      throw new CellarMetadataError(`Ambiguous CELLAR Work identity for CELEX "${celex}".`);
    }
  }
  for (const [work, celexes] of celexesByWork) {
    if (celexes.size > 1) {
      throw new CellarMetadataError(`Ambiguous CELLAR Work identity for Work URI "${work}".`);
    }
  }
}

function validateCursor(cursor: CellarWorkCursor | null): void {
  if (cursor === null) return;
  if (!/^https?:[^<>\s]+$/.test(cursor.workUri) || !parseEuCelex(cursor.workId)) {
    throw new CellarMetadataError("Invalid CELLAR Work cursor.");
  }
}

export function buildTargetWorksQuery(cursor: CellarWorkCursor | null, limit: number): string {
  validateCursor(cursor);
  if (!Number.isInteger(limit) || limit <= 0) {
    throw new CellarMetadataError(`Invalid SPARQL limit "${limit}".`);
  }
  const continuation = cursor
    ? `  FILTER(STR(?workId) > "${escapeSparqlString(`celex:${cursor.workId}`)}" || (STR(?workId) = "${escapeSparqlString(`celex:${cursor.workId}`)}" && STR(?work) > "${escapeSparqlString(cursor.workUri)}"))`
    : "";
  return [
    "PREFIX cdm: <http://publications.europa.eu/ontology/cdm#>",
    "PREFIX xsd: <http://www.w3.org/2001/XMLSchema#>",
    "SELECT DISTINCT ?work ?workId WHERE {",
    "  ?work cdm:work_id_document ?workId .",
    `  FILTER(REGEX(STR(?workId), "^celex:3[0-9]{4}[RLD][0-9]{4,6}$"))`,
    "  BIND(xsd:integer(SUBSTR(STR(?workId), 13)) AS ?cellarDocNumber)",
    "  FILTER(?cellarDocNumber > 0)",
    continuation,
    "}",
    `ORDER BY STR(?workId) STR(?work) LIMIT ${limit}`,
  ].filter(Boolean).join("\n");
}

export function buildWorkRecordQuery(celex: string): string {
  assertAdmittedCelex(celex);
  return [
    "PREFIX cdm: <http://publications.europa.eu/ontology/cdm#>",
    "PREFIX owl: <http://www.w3.org/2002/07/owl#>",
    "PREFIX purl: <http://purl.org/dc/elements/1.1/>",
    "SELECT ?celex (GROUP_CONCAT(DISTINCT ?langCode; SEPARATOR=' ') AS ?languages) WHERE {",
    `  VALUES (?celex ?celexUri) { ("${celex}" <http://publications.europa.eu/resource/celex/${celex}>) }`,
    "  ?work owl:sameAs ?celexUri .",
    "  ?expr cdm:expression_belongs_to_work ?work ;",
    "        cdm:expression_uses_language ?lang .",
    "  ?lang purl:identifier ?langCode .",
    "} GROUP BY ?celex",
  ].join("\n");
}

export function buildWorkMetadataQuery(workUri: string, celex: string): string {
  assertAdmittedCelex(celex);
  if (!/^https?:[^<>\s]+$/.test(workUri)) {
    throw new CellarMetadataError("Cannot build a CELLAR metadata query for invalid Work identity.");
  }
  return [
    "PREFIX cdm: <http://publications.europa.eu/ontology/cdm#>",
    "PREFIX purl: <http://purl.org/dc/elements/1.1/>",
    `SELECT "${celex}" AS ?celex (GROUP_CONCAT(DISTINCT ?langCode; SEPARATOR=' ') AS ?languages) WHERE {`,
    `  VALUES ?work { <${workUri}> }`,
    "  ?expr cdm:expression_belongs_to_work ?work ;",
    "        cdm:expression_uses_language ?lang .",
    "  ?lang purl:identifier ?langCode .",
    "} GROUP BY ?celex",
  ].join("\n");
}

export function buildBatchWorkMetadataQuery(identities: readonly CellarWorkIdentity[]): string {
  if (identities.length === 0 || identities.some(({ work }) => !/^https?:[^<>\s]+$/.test(work))) {
    throw new CellarMetadataError("Cannot build a CELLAR metadata batch query for invalid Work identities.");
  }
  return [
    "PREFIX cdm: <http://publications.europa.eu/ontology/cdm#>",
    "PREFIX purl: <http://purl.org/dc/elements/1.1/>",
    "SELECT ?work ?langCode WHERE {",
    `  VALUES ?work { ${identities.map(({ work }) => `<${work}>`).join(" ")} }`,
    "  ?expr cdm:expression_belongs_to_work ?work ;",
    "        cdm:expression_uses_language ?lang .",
    "  ?lang purl:identifier ?langCode .",
    "}",
  ].join("\n");
}

interface SparqlBinding {
  [variable: string]: { type: string; value: string; "xml:lang"?: string } | undefined;
}

interface SparqlResults {
  results?: { bindings?: SparqlBinding[] };
}

function parseTargetWorkIdentities(json: unknown): CellarWorkIdentity[] {
  if (typeof json !== "object" || json === null) throw new CellarMetadataError("CELLAR SPARQL response must be an object.");
  const bindings = (json as SparqlResults).results?.bindings;
  if (!Array.isArray(bindings)) throw new CellarMetadataError("CELLAR SPARQL response is missing results.bindings.");
  return bindings.map((binding) => {
    const work = binding.work?.value;
    const workId = binding.workId?.value;
    const celex = typeof workId === "string" && workId.startsWith("celex:") ? workId.slice(6) : "";
    if (typeof work !== "string" || !/^https?:[^<>\s]+$/.test(work) || !DISCOVERY_CELEX_PATTERN.test(celex)) {
      throw new CellarMetadataError(`CELLAR SPARQL returned an invalid Work identity for "${String(workId)}".`);
    }
    if (!parseEuCelex(celex)) {
      throw new CellarMetadataError(`CELLAR discovery returned unsupported CELEX "${celex}".`);
    }
    return { work, celex };
  });
}

export function parseCellarTargetWorkPage(
  json: unknown,
  identities: readonly CellarWorkIdentity[],
  nextCursor: CellarWorkCursor | null,
): CellarTargetWorksPage {
  const identityByWork = new Map(identities.map((identity) => [identity.work, identity]));
  const records = new Map<string, CellarDiscoveredWorkRecord>();
  for (const identity of identities) {
    const parsed = parseEuCelex(identity.celex);
    if (!parsed) throw new CellarMetadataError(`CELLAR discovery returned unsupported CELEX "${identity.celex}".`);
    records.set(identity.work, {
      workUri: identity.work,
      celex: identity.celex,
      documentType: parsed.documentType,
      year: parsed.year,
      number: parsed.number,
      titlesByLanguage: {},
      availableLanguages: [],
    });
  }
  if (typeof json !== "object" || json === null) throw new CellarMetadataError("CELLAR SPARQL response must be an object.");
  const bindings = (json as SparqlResults).results?.bindings;
  if (!Array.isArray(bindings)) throw new CellarMetadataError("CELLAR SPARQL response is missing results.bindings.");
  for (const binding of bindings) {
    const work = binding.work?.value;
    const language = binding.langCode?.value;
    const identity = typeof work === "string" ? identityByWork.get(work) : undefined;
    if (!identity || typeof language !== "string" || !isEuCellarLanguageCode(language.toLowerCase())) {
      throw new CellarMetadataError("CELLAR SPARQL returned malformed batch enrichment.");
    }
    const record = records.get(work as string)!;
    record.availableLanguages = [...new Set([...record.availableLanguages, language.toLowerCase()])].sort();
  }
  return { records: [...records.values()], nextCursor };
}

export function parseCellarSparqlResults(json: unknown): CellarWorkRecord[] {
  if (typeof json !== "object" || json === null) {
    throw new CellarMetadataError("CELLAR SPARQL response must be an object.");
  }
  const results = (json as SparqlResults).results;
  if (!results || !Array.isArray(results.bindings)) {
    throw new CellarMetadataError("CELLAR SPARQL response is missing results.bindings.");
  }
  const records = new Map<string, CellarWorkRecord>();
  for (const binding of results.bindings) {
    const celexValue = binding.celex?.value;
    if (typeof celexValue !== "string" || !TARGET_CELEX_PATTERN.test(celexValue)) {
      throw new CellarMetadataError(`CELLAR SPARQL returned a non-target CELEX "${String(celexValue)}".`);
    }
    const parsed = parseEuCelex(celexValue);
    if (!parsed) {
      throw new CellarMetadataError(`CELLAR SPARQL returned an out-of-scope CELEX "${celexValue}".`);
    }
    const languagesValue = binding.languages?.value ?? "";
    const availableLanguages = parseExpressionLanguages(languagesValue);
    const title = binding.title?.value;
    const existing = records.get(celexValue);
    const titlesByLanguage: Record<string, string> = existing ? { ...existing.titlesByLanguage } : {};
    if (title && binding.title?.["xml:lang"] && isEuCellarLanguageCode(binding.title["xml:lang"])) {
      titlesByLanguage[binding.title["xml:lang"]] = title;
    } else if (title && !existing) {
      titlesByLanguage.eng = title;
    }
    const mergedLanguages = new Set([...availableLanguages, ...(existing?.availableLanguages ?? [])]);
    records.set(celexValue, {
      celex: celexValue,
      documentType: parsed.documentType,
      year: parsed.year,
      number: parsed.number,
      titlesByLanguage,
      availableLanguages: [...mergedLanguages].sort(),
    });
  }
  return [...records.values()];
}

function parseExpressionLanguages(value: string): string[] {
  const languages = new Set<string>();
  for (const token of value.split(/\s+/)) {
    const code = token.trim().toUpperCase();
    if (/^[A-Z]{3}$/.test(code) && isEuCellarLanguageCode(code.toLowerCase())) {
      languages.add(code.toLowerCase());
    }
  }
  return [...languages];
}

export class CellarMetadataClient {
  constructor(
    private readonly transport: CellarMetadataTransport,
    private readonly options: { sparqlEndpoint?: string; pageSize?: number; metadataBatchSize?: number } = {},
  ) {}

  get pageSize(): number {
    return this.options.pageSize ?? 5000;
  }

  get sparqlEndpoint(): string {
    return this.options.sparqlEndpoint ?? CELLAR_SPARQL_ENDPOINT;
  }

  get metadataBatchSize(): number {
    return this.options.metadataBatchSize ?? 50;
  }

  async fetchTargetWorksPage(cursor: CellarWorkCursor | null, limit = this.pageSize): Promise<CellarTargetWorksPage> {
    const query = buildTargetWorksQuery(cursor, limit);
    const identities = parseTargetWorkIdentities(await this.transport.fetchSparqlJson(query));
    assertIdentityPageIntegrity(identities, cursor);
    if (identities.length === 0) return { records: [], nextCursor: null };
    const terminal = identities[identities.length - 1];
    if (!Number.isInteger(this.metadataBatchSize) || this.metadataBatchSize <= 0) {
      throw new CellarMetadataError(`Invalid CELLAR metadata batch size "${this.metadataBatchSize}".`);
    }
    const records = new Map<string, CellarDiscoveredWorkRecord>();
    for (let start = 0; start < identities.length; start += this.metadataBatchSize) {
      const batch = identities.slice(start, start + this.metadataBatchSize);
      const enriched = parseCellarTargetWorkPage(
        await this.transport.fetchSparqlJson(buildBatchWorkMetadataQuery(batch)),
        batch,
        null,
      );
      for (const record of enriched.records) records.set(record.celex, record);
    }
    return { records: [...records.values()], nextCursor: { workId: terminal.celex, workUri: terminal.work } };
  }

  async fetchWorkRecord(celex: string): Promise<CellarWorkRecord | null> {
    if (!parseEuCelex(celex)) return null;
    const query = buildWorkRecordQuery(celex);
    const json = await this.transport.fetchSparqlJson(query);
    const records = parseCellarSparqlResults(json);
    if (records.length === 0) return null;
    if (records.length > 1) {
      throw new CellarMetadataError(`CELLAR returned multiple Work records for CELEX "${celex}".`);
    }
    const record = records[0];
    if (record.celex !== celex) {
      throw new CellarMetadataError(
        `CELLAR returned Work record for "${record.celex}" but requested CELEX "${celex}".`,
      );
    }
    return record;
  }

  async fetchWorkRecordFromRdf(celex: string): Promise<CellarWorkRecord | null> {
    if (!parseEuCelex(celex)) return null;
    const rdf = await this.transport.fetchWorkRdf(celex);
    return parseCellarWorkRdf(rdf, celex);
  }
}

export function parseCellarWorkRdf(xml: string, expectedCelex: string): CellarWorkRecord | null {
  if (typeof xml !== "string" || xml.length === 0) return null;
  const prefixes = collectPrefixes(xml);
  const cdm = prefixes.cdm ?? CDM_NS;
  const owl = prefixes.owl ?? OWL_NS;
  const rdf = prefixes.rdf ?? RDF_NS;

  const nodes = parseDescriptionNodes(xml, rdf);
  const celexNode = nodes.find((node) => node.about.endsWith(`/celex/${expectedCelex}`));
  if (!celexNode) return null;

  const relatedAbouts = computeRelatedAbouts(nodes, celexNode.about, owl, cdm, expectedCelex);
  const workNodes = nodes.filter((node) => relatedAbouts.has(node.about));

  let idCelex: string | null = null;
  for (const node of workNodes) {
    for (const triple of node.triples) {
      if (triple.predicate === `${cdm}work_id_document` && triple.object === `celex:${expectedCelex}`) {
        idCelex = expectedCelex;
      }
    }
  }
  if (idCelex !== expectedCelex) return null;

  const availableLanguages = new Set<string>();
  const titlesByLanguage: Record<string, string> = {};
  const languageByAbout = new Map<string, string>();
  for (const node of nodes) {
    for (const triple of node.triples) {
      if (triple.predicate === `${PURL_NS}identifier` && triple.object) {
        const code = triple.object.trim().toLowerCase();
        if (isEuCellarLanguageCode(code)) languageByAbout.set(node.about, code);
      }
    }
  }
  for (const node of nodes) {
    for (const triple of node.triples) {
      if (triple.predicate === `${cdm}expression_belongs_to_work` && triple.resource && relatedAbouts.has(triple.resource)) {
        const expression = node;
        for (const expressionTriple of expression.triples) {
          if (expressionTriple.predicate === `${cdm}expression_uses_language` && expressionTriple.resource) {
            const code = languageByAbout.get(expressionTriple.resource);
            if (code) availableLanguages.add(code);
          }
        }
      }
      if (triple.predicate === `${cdm}title` && triple.object && triple.lang && triple.lang.length === 3) {
        const code = triple.lang.toLowerCase();
        if (isEuCellarLanguageCode(code)) titlesByLanguage[code] = triple.object;
      }
    }
  }

  const parsed = parseEuCelex(expectedCelex);
  if (!parsed) return null;
  return {
    celex: expectedCelex,
    documentType: parsed.documentType,
    year: parsed.year,
    number: parsed.number,
    titlesByLanguage,
    availableLanguages: [...availableLanguages].sort(),
  };
}

interface DescriptionNode {
  about: string;
  triples: Array<{ predicate: string; object: string; resource: string | null; datatype: string | null; lang: string | null }>;
}

function collectPrefixes(xml: string): Record<string, string> {
  const map: Record<string, string> = {};
  const regex = /xmlns:([a-zA-Z0-9_.-]+)="([^"]+)"/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(xml)) !== null) {
    map[match[1]] = match[2];
  }
  return map;
}

function expandPredicate(tag: string, prefixes: Record<string, string>): string {
  const colon = tag.indexOf(":");
  if (colon < 0) return tag;
  const prefix = tag.slice(0, colon);
  const local = tag.slice(colon + 1);
  const ns = prefixes[prefix];
  return ns ? `${ns}${local}` : tag;
}

function parseDescriptionNodes(xml: string, rdfNs: string): DescriptionNode[] {
  void rdfNs;
  const prefixes = collectPrefixes(xml);
  const nodes: DescriptionNode[] = [];
  const openRegex = /<rdf:Description\b([^>]*)>/g;
  let current: RegExpExecArray | null;
  while ((current = openRegex.exec(xml)) !== null) {
    const openAttrs = current[1];
    const aboutMatch = /rdf:about="([^"]+)"/.exec(openAttrs);
    const about = aboutMatch ? aboutMatch[1].replace(/&amp;/g, "&") : "";
    const end = xml.indexOf("</rdf:Description>", current.index);
    if (end < 0) break;
    const body = xml.slice(current.index + current[0].length, end);
    const triples = parseTriples(body, prefixes);
    nodes.push({ about, triples });
    openRegex.lastIndex = end + "</rdf:Description>".length;
  }
  return nodes;
}


function parseTriples(body: string, prefixes: Record<string, string>): DescriptionNode["triples"] {
  const triples: DescriptionNode["triples"] = [];
  const elementRegex = /<((?:[a-zA-Z0-9_.-]+:)?[a-zA-Z0-9_.-]+)([^>]*?)\/>|<((?:[a-zA-Z0-9_.-]+:)?[a-zA-Z0-9_.-]+)([^>]*)>([\s\S]*?)<\/\3>/g;
  let match: RegExpExecArray | null;
  while ((match = elementRegex.exec(body)) !== null) {
    const selfClosing = match[2] !== undefined;
    const tag = selfClosing ? match[1] : match[3];
    const attrs = selfClosing ? match[2] : match[4];
    const text = selfClosing ? "" : match[5];
    const predicate = expandPredicate(tag, prefixes);
    const resourceMatch = /rdf:resource="([^"]+)"/.exec(attrs);
    const langMatch = /xml:lang="([^"]+)"/.exec(attrs);
    const datatypeMatch = /rdf:datatype="([^"]+)"/.exec(attrs);
    triples.push({
      predicate,
      object: text.trim(),
      resource: resourceMatch ? resourceMatch[1] : null,
      datatype: datatypeMatch ? datatypeMatch[1] : null,
      lang: langMatch ? langMatch[1].toLowerCase() : null,
    });
  }
  return triples;
}

function collectSameAsTargets(node: DescriptionNode, owlNs: string): Set<string> {
  const targets = new Set<string>();
  for (const triple of node.triples) {
    if (triple.predicate === `${owlNs}sameAs` && triple.resource) {
      targets.add(triple.resource);
    }
  }
  return targets;
}

function computeRelatedAbouts(
  nodes: DescriptionNode[],
  seedAbout: string,
  owlNs: string,
  cdmNs: string,
  expectedCelex: string,
): Set<string> {
  const adjacency = new Map<string, Set<string>>();
  const addEdge = (from: string, to: string) => {
    if (!adjacency.has(from)) adjacency.set(from, new Set());
    adjacency.get(from)!.add(to);
  };
  for (const node of nodes) {
    for (const target of collectSameAsTargets(node, owlNs)) {
      addEdge(node.about, target);
      addEdge(target, node.about);
    }
  }

  const seed = new Set<string>([seedAbout]);
  for (const node of nodes) {
    for (const triple of node.triples) {
      if (triple.predicate === `${cdmNs}id_celex` && triple.object === expectedCelex) {
        seed.add(node.about);
      }
    }
  }

  const visited = new Set<string>();
  const queue: string[] = [...seed];
  while (queue.length > 0) {
    const current = queue.shift()!;
    if (visited.has(current)) continue;
    visited.add(current);
    const neighbors = adjacency.get(current);
    if (neighbors) {
      for (const neighbor of neighbors) {
        if (!visited.has(neighbor)) queue.push(neighbor);
      }
    }
  }
  return visited;
}
