import type { LawProvider } from "../LawProvider";
import { LawProviderUnavailableError } from "../errors";
import type { LawProviderHttpResponse, LawProviderHttpTransport } from "../httpTransport";
import type { LawReference, LawSection } from "../types";

const BASE_URL = "https://www.boe.es/datosabiertos/api/legislacion-consolidada";
const RECORD_BASE_URL = "https://www.boe.es/buscar/act.php?id=";
const BOE_ID = /^BOE-A-(\d{4})-(\d{1,5})$/i;

interface BoeMetadata { identificador: string; titulo: string; url_html_consolidada: string; url_eli: string; }
interface BoeIndexEntry {
  id: string;
  titulo: string;
  fecha_actualizacion?: string;
  url?: string;
}
interface BoeVersion { date: string; html: string; }

const BOE_BLOCK_TYPES = new Set([
  "nota_inicial",
  "precepto",
  "encabezado",
  "firma",
  "parte_dispositiva",
  "parte_final",
  "preambulo",
  "instrumento",
]);

export class BoeLawProvider implements LawProvider {
  readonly id = "boe";
  readonly label = "BOE / Agencia Estatal Boletín Oficial del Estado";

  constructor(
    private readonly baseUrl = BASE_URL,
    private readonly fetchFn: LawProviderHttpTransport,
  ) {}

  async getSection(reference: LawReference): Promise<LawSection | null> {
    if (reference.jurisdiction !== "ES" || (reference.referenceType && reference.referenceType !== "article")) return null;
    const lawCode = reference.lawCode.toUpperCase();
    if (!BOE_ID.test(lawCode)) return null;

    try {
      const metadataResponse = await this.request(this.url(lawCode, "metadatos"), "application/json");
      if (metadataResponse.status === 404) return null;
      this.requireOk(metadataResponse, "metadata");
      const metadata = this.parseMetadata(await metadataResponse.json(), lawCode);
      if (!metadata) return null;

      const recordResponse = await this.request(this.recordUrl(lawCode), "text/html");
      this.requireOk(recordResponse, "official record");
      const officialPageWork = this.parseOfficialPageWork(
        await this.readText(recordResponse, "official record"),
      );
      if (officialPageWork !== metadata.url_eli) {
        throw new Error("BOE official-page ELI identity mismatch");
      }

      const eliResponse = await this.request(this.url(lawCode, "metadata-eli"), "application/xml");
      this.requireOk(eliResponse, "ELI metadata");
      const currentVersionDate = this.parseCurrentVersionDate(
        await this.readText(eliResponse, "ELI metadata"),
        metadata.url_eli,
        lawCode,
      );

      const indexResponse = await this.request(this.url(lawCode, "texto/indice"), "application/json");
      this.requireOk(indexResponse, "block index");
      const blockId = await this.findBlockId(await indexResponse.json(), reference.section, lawCode);
      if (!blockId) return null;

      const blockResponse = await this.request(
        this.url(lawCode, `texto/bloque/${encodeURIComponent(blockId)}`),
        "application/xml",
      );
      if (blockResponse.status === 404) return null;
      this.requireOk(blockResponse, "block");
      const blockXml = await this.readText(blockResponse, "block");
      const parsed = this.parseBlock(blockXml, blockId, reference.section, currentVersionDate);
      if (!parsed) throw new Error("No unique applicable BOE block version");

      return {
        providerId: this.id,
        providerLabel: this.label,
        sourceUrl: metadata.url_html_consolidada,
        lawCode,
        lawTitle: metadata.titulo,
        section: normalizeSection(reference.section),
        referenceType: "article",
        jurisdiction: "ES",
        language: "es",
        heading: parsed.heading,
        text: parsed.text,
        retrievedAt: new Date().toISOString(),
        validFrom: parsed.validFrom,
        cacheStatus: "live",
        isOfficialSource: true,
        isAuthoritativeText: false,
      };
    } catch (error) {
      if (error instanceof LawProviderUnavailableError) throw error;
      throw new LawProviderUnavailableError(this.id, "BOE lookup failed before a definitive not-found result.", error);
    }
  }

  private url(id: string, suffix: string): string { return `${this.baseUrl}/id/${id}/${suffix}`; }

  private recordUrl(id: string): string { return `${RECORD_BASE_URL}${encodeURIComponent(id)}`; }

  private async request(url: string, accept: string): Promise<LawProviderHttpResponse> {
    try { return await this.fetchFn(url, { headers: { Accept: accept } }); }
    catch (error) { throw new LawProviderUnavailableError(this.id, `BOE request failed: ${url}`, error); }
  }

  private requireOk(response: LawProviderHttpResponse, what: string): void {
    if (!response.ok) throw new LawProviderUnavailableError(this.id, `BOE ${what} request failed.`);
  }

  private async readText(response: LawProviderHttpResponse, what: string): Promise<string> {
    try { return await response.text(); }
    catch (error) { throw new LawProviderUnavailableError(this.id, `BOE ${what} parsing failed.`, error); }
  }

  private parseMetadata(value: unknown, requestedId: string): BoeMetadata | null {
    const root = value as { data?: unknown };
    if (Array.isArray(root.data) && root.data.length !== 1) throw new Error("Ambiguous BOE metadata envelope");
    const item = Array.isArray(root.data) ? (root.data as unknown[])[0] : root.data;
    if (!item || typeof item !== "object") throw new Error("Malformed BOE metadata");
    const metadata = item as Partial<BoeMetadata>;
    if (metadata.identificador !== requestedId) return null;
    if (
      typeof metadata.titulo !== "string"
      || !metadata.titulo.trim()
      || typeof metadata.url_html_consolidada !== "string"
      || !isCanonicalConsolidatedRecordUrl(metadata.url_html_consolidada, requestedId)
      || typeof metadata.url_eli !== "string"
      || !metadata.url_eli.trim()
    ) {
      throw new Error("Malformed or incomplete BOE metadata");
    }
    return metadata as BoeMetadata;
  }

  private parseOfficialPageWork(html: string): string {
    const pattern = /<dt\b[^>]*>\s*Permalink ELI:\s*<\/dt>\s*<dd\b[^>]*>\s*<a\b[^>]*\bhref\s*=\s*(["'])([^"']+)\1[^>]*>/gi;
    const matches: string[] = [];
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(html)) !== null) {
      if (match[2] !== undefined) {
        matches.push(match[2]);
      }
    }
    if (matches.length !== 1 || !isCanonicalConsolidatedEliUrl(matches[0])) {
      throw new Error("BOE official record contains an ambiguous or malformed ELI permalink");
    }
    return matches[0].slice(0, -"/con".length);
  }

  private parseCurrentVersionDate(xml: string, expectedWork: string, requestedId: string): string {
    const root = parseXmlDocument(xml, "response");
    const data = singleChild(root, "data");
    const metadataEli = singleChild(data, "metadata-eli");
    const rdf = singleChild(metadataEli, "rdf:RDF");
    const resources = descendantsNamed(rdf, "eli:LegalResource");
    const candidates: string[] = [];
    const resourcePattern = new RegExp(`^${escapeRegExp(expectedWork)}/con/(\\d{8})$`, "i");

    for (const resource of resources) {
      const resourceAbout = readAttribute(resource.attributes, "rdf:about");
      const resourceMatch = resourceAbout?.match(resourcePattern);
      if (!resourceMatch) continue;

      const localId = requiredSingleText(resource, "eli:id_local");
      if (!BOE_ID.test(localId) || localId !== requestedId) {
        throw new Error("BOE ELI local identity mismatch");
      }

      const memberOf = resource.children.filter(
        (child) => child.name.toLowerCase() === "eli:is_member_of",
      );
      if (memberOf.length !== 1 || readAttribute(memberOf[0].attributes, "rdf:resource") !== expectedWork) {
        throw new Error("BOE ELI work identity mismatch");
      }

      const date = requiredSingleText(resource, "eli:version_date");
      if (!isCalendarDate(date) || compactDate(date) !== resourceMatch[1]) {
        throw new Error("BOE ELI metadata contains an invalid version date");
      }

      const realizations = resource.children.filter(
        (child) => child.name.toLowerCase() === "eli:is_realized_by",
      );
      if (realizations.length !== 1) {
        throw new Error("BOE ELI metadata contains an ambiguous realization");
      }
      const expressions = realizations[0].children.filter(
        (child) => child.name.toLowerCase() === "eli:legalexpression",
      );
      if (expressions.length !== 1) {
        throw new Error("BOE ELI metadata contains an ambiguous consolidated expression");
      }
      const expression = expressions[0];
      const expressionAbout = readAttribute(expression.attributes, "rdf:about");
      if (expressionAbout !== `${resourceAbout}/spa`) {
        throw new Error("BOE ELI expression identity mismatch");
      }
      const language = singleChild(expression, "eli:language");
      if (readAttribute(language.attributes, "rdf:resource")?.toLowerCase() !== "http://www.elidata.es/mdr/authority/language/spa") {
        throw new Error("BOE ELI language identity mismatch");
      }
      const realizes = singleChild(expression, "eli:realizes");
      if (readAttribute(realizes.attributes, "rdf:resource") !== resourceAbout) {
        throw new Error("BOE ELI expression work identity mismatch");
      }
      candidates.push(date);
    }

    const applicable = candidates.filter((date) => date <= new Date().toISOString().slice(0, 10));
    const latest = applicable.reduce<string | null>(
      (current, date) => current === null || date > current ? date : current,
      null,
    );
    if (latest === null || applicable.filter((date) => date === latest).length !== 1) {
      throw new Error("BOE ELI metadata contains no unique applicable Spanish consolidated expression");
    }
    return latest;
  }

  private async findBlockId(value: unknown, section: string, lawCode: string): Promise<string | null> {
    const root = value as { data?: unknown };
    if (Array.isArray(root.data) && root.data.length !== 1) throw new Error("Ambiguous BOE index envelope");
    const data = Array.isArray(root.data) ? (root.data as unknown[])[0] : root.data;
    if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("Malformed BOE index envelope");
    const rawEntries = (data as { bloque?: unknown }).bloque;
    if (!Array.isArray(rawEntries)) throw new Error("Malformed BOE index entries");
    const seenIds = new Set<string>();
    const entries = rawEntries.map((entry): BoeIndexEntry => {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) throw new Error("Malformed BOE index entry");
      const candidate = entry as Partial<BoeIndexEntry>;
      const id = candidate.id;
      if (typeof id !== "string" || !id.trim()) throw new Error("Incomplete BOE index entry");
      if (candidate.titulo !== undefined && typeof candidate.titulo !== "string") throw new Error("Malformed BOE index entry title");
      if (candidate.fecha_actualizacion !== undefined && typeof candidate.fecha_actualizacion !== "string") {
        throw new Error("Malformed BOE index entry date");
      }
      if (candidate.url !== undefined && typeof candidate.url !== "string") throw new Error("Malformed BOE index entry URL");
      if (seenIds.has(id)) throw new Error("Duplicate BOE index block ID");
      seenIds.add(id);
      return {
        id,
        titulo: candidate.titulo ?? "",
        fecha_actualizacion: candidate.fecha_actualizacion,
        url: candidate.url,
      };
    });

    for (const entry of entries) {
      if (entry.titulo.trim()) continue;
      const blockResponse = await this.request(
        this.url(lawCode, `texto/bloque/${encodeURIComponent(entry.id)}`),
        "application/xml",
      );
      this.requireOk(blockResponse, "blank-title block classification");
      const blockXml = await this.readText(blockResponse, "blank-title block classification");
      const type = this.parseStructuralBlockType(blockXml, entry.id);
      if (type === "precepto") throw new Error("Blank-title BOE index entry is a referenceable precepto");
    }

    const target = normalizeSection(section);
    const matches = entries.filter((entry) => normalizeIndexTitle(entry.titulo) === target);
    if (matches.length > 1) throw new Error("Ambiguous BOE article index");
    return matches[0]?.id ?? null;
  }

  private parseStructuralBlockType(xml: string, expectedId: string): string {
    const response = parseXmlDocument(xml, "response");
    const data = singleChild(response, "data");
    const block = singleChild(data, "bloque");
    if (readAttribute(block.attributes, "id") !== expectedId) throw new Error("BOE blank-title block identity mismatch");
    const type = readAttribute(block.attributes, "tipo");
    if (!type || !BOE_BLOCK_TYPES.has(type)) throw new Error("BOE blank-title block has an invalid type");
    const title = readAttribute(block.attributes, "titulo");
    if (title === null && type === "precepto") throw new Error("Blank-title BOE index entry is a referenceable precepto");
    if (title !== null && type !== "precepto" && looksLikeArticleTitle(title)) throw new Error("BOE blank-title block has a contradictory article title");
    if (block.children.length === 0 || block.children.some((child) => child.name.toLowerCase() !== "version")) {
      throw new Error("BOE blank-title block has malformed versions");
    }
    if (block.children.some((child) => hasDescendantNamed(child, "version"))) {
      throw new Error("BOE blank-title block contains a nested version");
    }
    for (const version of block.children) {
      const idNorma = readAttribute(version.attributes, "id_norma");
      const publicationDate = normalizeBoeDate(readAttribute(version.attributes, "fecha_publicacion"));
      const effectiveDateAttribute = readAttribute(version.attributes, "fecha_vigencia");
      const effectiveDate = effectiveDateAttribute === null ? null : normalizeBoeDate(effectiveDateAttribute);
      if (!idNorma || !BOE_ID.test(idNorma) || !publicationDate || (effectiveDateAttribute !== null && !effectiveDate)) {
        throw new Error("BOE blank-title block has invalid version identity or date");
      }
      if (version.children.length === 0) throw new Error("BOE blank-title block contains an empty version");
    }
    return type;
  }

  private parseBlock(xml: string, blockId: string, requestedSection: string, currentDate: string): { heading?: string; text: string; validFrom?: string } | null {
    const response = parseXmlDocument(xml, "response");
    const data = singleChild(response, "data");
    const block = singleChild(data, "bloque");
    if (readAttribute(block.attributes, "id") !== blockId) throw new Error("BOE block identity mismatch");
    if (readAttribute(block.attributes, "tipo") !== "precepto") throw new Error("BOE selected block is not a precepto");
    const target = normalizeSection(requestedSection);
    const blockTitle = readAttribute(block.attributes, "titulo");
    if (!blockTitle || normalizeIndexTitle(blockTitle) !== target) throw new Error("BOE block article identity mismatch");
    if (block.children.some((child) => child.name.toLowerCase() !== "version")) throw new Error("BOE block contains an unexpected direct child");
    if (block.children.some((child) => hasDescendantNamed(child, "version"))) throw new Error("BOE block contains a nested version");
    const versions = block.children.map((node): BoeVersion => {
      const idNorma = readAttribute(node.attributes, "id_norma");
      const date = normalizeBoeDate(readAttribute(node.attributes, "fecha_vigencia"));
      if (!idNorma || !BOE_ID.test(idNorma) || !date) throw new Error("BOE block version has invalid identity or effective date");
      const article = singleChild(node, "p", (candidate) => /(?:^|\s)articulo(?:\s|$)/i.test(readAttribute(candidate.attributes, "class") ?? ""));
      if (!article || normalizeIndexTitle(textFromMarkup(article.innerXml)) !== target) throw new Error("BOE block version article identity mismatch");
      return { date, html: node.innerXml };
    }).filter((version) => version.date <= currentDate);
    const latestDate = versions.reduce<string | null>((latest, version) => !latest || version.date > latest ? version.date : latest, null);
    const current = latestDate ? versions.filter((version) => version.date === latestDate) : [];
    if (current.length !== 1) return null;
    const html = current[0].html.replace(/<blockquote\b[\s\S]*?<\/blockquote>/gi, "");
    const heading = textFromMarkup(html.match(/<p\b[^>]*class=["'][^"']*articulo[^"']*["'][^>]*>([\s\S]*?)<\/p>/i)?.[1] ?? "");
    const body = textFromMarkup(html.replace(/<p\b[^>]*class=["'][^"']*articulo[^"']*["'][^>]*>[\s\S]*?<\/p>/i, ""));
    if (!body) throw new Error("BOE block contains no normative text");
    return { heading: heading || undefined, text: body, validFrom: latestDate ?? undefined };
  }
}

function normalizeSection(section: string): string { return section.trim().replace(/\s+/g, " ").toLocaleLowerCase("es"); }
function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}
function normalizeBoeDate(value: string | null): string | null {
  if (!value) return null;
  const normalized = /^\d{8}$/.test(value)
    ? `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`
    : value;
  return isCalendarDate(normalized) ? normalized : null;
}
function compactDate(value: string): string { return value.replace(/-/g, ""); }
function normalizeIndexTitle(title: string): string {
  const normalized = normalizeSection(title).normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const match = normalized.match(/^art(?:iculo|\.?)\s+([^.:]+?)(?:[.:]\s.*)?$/i);
  return match?.[1]?.trim() ?? normalized;
}
function looksLikeArticleTitle(title: string): boolean {
  const normalized = normalizeSection(title).normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  return /^art(?:iculo|\.?)\s+/i.test(normalized);
}
interface XmlNode {
  name: string;
  attributes: Record<string, string>;
  children: XmlNode[];
  innerXml: string;
  outerXml: string;
  textContent: string;
  start: number;
  contentStart: number;
}

function readAttribute(attributes: string | Record<string, string>, name: string): string | null {
  if (typeof attributes !== "string") return attributes[name.toLowerCase()] ?? null;
  return attributes.match(new RegExp(`${name}=["']([^"']+)["']`, "i"))?.[1] ?? null;
}

function singleChild(node: XmlNode, name: string, predicate: (child: XmlNode) => boolean = () => true): XmlNode {
  const matches = node.children.filter((child) => child.name.toLowerCase() === name.toLowerCase() && predicate(child));
  if (matches.length !== 1) throw new Error(`BOE XML requires exactly one ${name}`);
  return matches[0];
}

function requiredSingleText(node: XmlNode, name: string): string {
  const child = singleChild(node, name);
  if (!child) throw new Error(`BOE XML ${name} is missing`);
  const value = child.textContent.trim();
  if (!value) throw new Error(`BOE XML ${name} is empty`);
  return value;
}

function hasDescendantNamed(node: XmlNode, name: string): boolean {
  return node.children.some((child) => child.name.toLowerCase() === name.toLowerCase() || hasDescendantNamed(child, name));
}

function descendantsNamed(node: XmlNode, name: string): XmlNode[] {
  const descendants: XmlNode[] = [];
  const normalizedName = name.toLowerCase();
  for (const child of node.children) {
    if (child.name.toLowerCase() === normalizedName) descendants.push(child);
    descendants.push(...descendantsNamed(child, name));
  }
  return descendants;
}

function parseXmlDocument(xml: string, expectedRoot: string): XmlNode {
  const stack: XmlNode[] = [];
  let root: XmlNode | null = null;
  let xmlDeclarationSeen = false;
  let position = 0;
  while (position < xml.length) {
    const open = xml.indexOf("<", position);
    if (open < 0) {
      const text = xml.slice(position);
      if (!stack.length && text.trim()) throw new Error("Unexpected XML text outside root");
      if (stack.length) stack[stack.length - 1].textContent += text;
      break;
    }
    const text = xml.slice(position, open);
    if (!stack.length && text.trim()) throw new Error("Unexpected XML text outside root");
    if (stack.length) stack[stack.length - 1].textContent += text;
    if (xml.startsWith("<!--", open)) {
      const end = xml.indexOf("-->", open + 4);
      if (end < 0) throw new Error("Unterminated XML comment");
      position = end + 3;
      continue;
    }
    if (xml.startsWith("<![CDATA[", open)) {
      if (!stack.length) throw new Error("CDATA outside XML root");
      const end = xml.indexOf("]]>", open + 9);
      if (end < 0) throw new Error("Unterminated XML CDATA");
      stack[stack.length - 1].textContent += xml.slice(open + 9, end);
      position = end + 3;
      continue;
    }
    if (xml.startsWith("<?", open)) {
      const end = xml.indexOf("?>", open + 2);
      if (end < 0) throw new Error("Unterminated XML processing instruction");
      if (xml.slice(open, end + 2).toLowerCase().startsWith("<?xml")) {
        if (xmlDeclarationSeen || root !== null || !/^<\?xml\s+version\s*=\s*(["'])1\.0\1(?:\s+encoding\s*=\s*(["'])[A-Za-z][A-Za-z0-9._-]*\2)?(?:\s+standalone\s*=\s*(["'])(?:yes|no)\3)?\s*\?>$/.test(xml.slice(open, end + 2))) {
          throw new Error("Malformed or duplicate XML declaration");
        }
        xmlDeclarationSeen = true;
      }
      position = end + 2;
      continue;
    }
    const end = findTagEnd(xml, open + 1);
    if (end < 0) throw new Error("Unterminated XML tag");
    const token = xml.slice(open + 1, end).trim();
    if (token.startsWith("!")) throw new Error("Unsupported XML declaration");
    if (token.startsWith("/")) {
      const name = token.slice(1).trim();
      const current = stack.pop();
      if (!current || name !== current.name || !/^[A-Za-z_:][A-Za-z0-9_.:-]*$/.test(name)) throw new Error("Mismatched XML closing tag");
      current.innerXml = xml.slice(current.contentStart, open);
      current.outerXml = xml.slice(current.start, end + 1);
    } else {
      const selfClosing = /\/\s*$/.test(token);
      const content = selfClosing ? token.replace(/\/\s*$/, "").trim() : token;
      const nameMatch = /^([A-Za-z_:][A-Za-z0-9_.:-]*)([\s\S]*)$/.exec(content);
      if (!nameMatch) throw new Error("Malformed XML opening tag");
      const node: XmlNode = {
        name: nameMatch[1],
        attributes: parseXmlAttributes(nameMatch[2]),
        children: [],
        innerXml: "",
        outerXml: "",
        textContent: "",
        start: open,
        contentStart: end + 1,
      };
      if (root === null) root = node;
      else if (!stack.length) throw new Error("Multiple XML roots");
      else stack[stack.length - 1].children.push(node);
      if (selfClosing) node.outerXml = xml.slice(node.start, end + 1);
      else stack.push(node);
    }
    position = end + 1;
  }
  if (!root || stack.length || root.name.toLowerCase() !== expectedRoot.toLowerCase()) throw new Error("Incomplete BOE XML document");
  return root;
}

function parseXmlAttributes(attributes: string): Record<string, string> {
  const result: Record<string, string> = {};
  let rest = attributes.trim();
  while (rest) {
    const match = /^([A-Za-z_:][A-Za-z0-9_.:-]*)\s*=\s*(["'])([^"'<&]*(?:&(amp|lt|gt|quot|apos|#\d+|#x[0-9A-Fa-f]+);[^"'<&]*)*)\2\s*/.exec(rest);
    if (!match || result[match[1].toLowerCase()] !== undefined) throw new Error("Malformed or duplicate XML attribute");
    result[match[1].toLowerCase()] = match[3];
    rest = rest.slice(match[0].length);
  }
  return result;
}
function escapeRegExp(value: string): string { return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

function isCanonicalConsolidatedRecordUrl(value: string | undefined, requestedId: string): value is string {
  if (!value) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:"
      && url.hostname === "www.boe.es"
      && url.port === ""
      && url.username === ""
      && url.password === ""
      && url.pathname === "/buscar/act.php"
      && url.hash === ""
      && url.searchParams.get("id") === requestedId
      && [...url.searchParams.keys()].length === 1;
  } catch {
    return false;
  }
}

function isCanonicalConsolidatedEliUrl(value: string | undefined): value is string {
  if (!value) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:"
      && url.hostname === "www.boe.es"
      && url.port === ""
      && /^\/eli\/es\/[a-z]\/\d{4}\/\d{2}\/\d{2}\/[^/]+\/con$/.test(url.pathname)
      && url.search === ""
      && url.hash === "";
  } catch {
    return false;
  }
}

function findTagEnd(xml: string, start: number): number {
  let quote = "";
  for (let i = start; i < xml.length; i++) {
    const character = xml[i];
    if (quote) {
      if (character === quote) quote = "";
    } else if (character === '"' || character === "'") {
      quote = character;
    } else if (character === ">") {
      return i;
    }
  }
  return -1;
}

function textFromMarkup(value: string): string {
  return value.replace(/<br\s*\/?\s*>/gi, "\n").replace(/<\/(?:p|tr|td|th|div|li)>/gi, "\n").replace(/<[^>]+>/g, "").replace(/&#(\d+);/g, (_m, code: string) => String.fromCodePoint(Number(code))).replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">").replace(/\r/g, "").split("\n").map((line) => line.replace(/\s+/g, " ").trim()).filter(Boolean).join("\n");
}
