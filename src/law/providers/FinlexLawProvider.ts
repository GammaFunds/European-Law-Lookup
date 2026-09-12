import type { LawProvider } from "../LawProvider";
import { LawProviderUnavailableError } from "../errors";
import type { LawProviderHttpResponse, LawProviderHttpTransport } from "../httpTransport";
import type { LawReference, LawSection } from "../types";

const DEFAULT_BASE_URL = "https://opendata.finlex.fi/finlex/avoindata/v1";
const USER_AGENT = "obsidian-de-law/ELL-FI-PROVIDER-CORE-1 (contact: miko)";

interface AknNode { name: string; attributes: Record<string, string>; children: AknNode[]; text: string; }
export interface FinlexAknDocument {
  year: string;
  number: string;
  country: string;
  subtype: string;
  language: string;
  workUri: string;
  expressionUri: string;
  title: string;
  authoritative: boolean | null;
  root: AknNode;
}

export class FinlexLawProvider implements LawProvider {
  readonly id = "finlex";
  readonly label = "Finlex";

  constructor(
    private readonly baseUrl = DEFAULT_BASE_URL,
    private readonly fetchFn: LawProviderHttpTransport,
  ) {}

  async getSection(reference: LawReference): Promise<LawSection | null> {
    if (reference.jurisdiction !== "FI" || (reference.referenceType && reference.referenceType !== "section")) return null;
    const identity = parseLawCode(reference.lawCode);
    if (!identity) return null;
    const language = reference.language ?? "fin";
    if (language !== "fin" && language !== "swe") return null;
    const url = `${this.baseUrl}/akn/fi/act/statute-consolidated/${identity.year}/${identity.number}/${language}@latest`;
    try {
      const response = await this.request(url);
      if (response.status === 404) return null;
      if (!response.ok) throw new LawProviderUnavailableError(this.id, `Finlex request failed: ${url}`);
      const document = parseFinlexAkn(await response.text(), identity.year, identity.number, language);
      const section = findSection(document.root, reference.section);
      if (!section) return null;
      const heading = directChildText(section, "heading");
      const text = descendants(section, "content").map(nodeText).map((value) => value.trim()).filter(Boolean).join(" ");
      if (!text) throw new Error("Finlex section has no content");
      return {
        providerId: this.id, providerLabel: this.label, sourceUrl: url,
        lawCode: `${identity.number}/${identity.year}`, lawTitle: document.title,
        section: reference.section, referenceType: "section", jurisdiction: "FI", language,
        ...(heading ? { heading } : {}), text, retrievedAt: new Date().toISOString(), cacheStatus: "live",
      isOfficialSource: true, isAuthoritativeText: false,
      };
    } catch (error) {
      if (error instanceof LawProviderUnavailableError) throw error;
      throw new LawProviderUnavailableError(this.id, "Finlex lookup failed before a definitive not-found result.", error);
    }
  }

  private async request(url: string): Promise<LawProviderHttpResponse> {
    try { return await this.fetchFn(url, { headers: { Accept: "application/xml", "User-Agent": USER_AGENT } }); }
    catch (error) { throw new LawProviderUnavailableError(this.id, `Finlex request failed: ${url}`, error); }
  }
}

export function parseFinlexAkn(xml: string, expectedYear?: string, expectedNumber?: string, expectedLanguage?: string): FinlexAknDocument {
  const root = parseXml(xml);
  const work = exactlyOne(descendants(root, "FRBRWork"));
  const expression = exactlyOne(descendants(root, "FRBRExpression"));
  const workUri = requiredAttribute(exactlyOne(descendants(work, "FRBRuri")), "value");
  const expressionUri = requiredAttribute(exactlyOne(descendants(expression, "FRBRuri")), "value");
  const country = requiredAttribute(exactlyOne(descendants(work, "FRBRcountry")), "value").toLowerCase();
  const subtype = requiredAttribute(exactlyOne(descendants(work, "FRBRsubtype")), "value");
  const number = requiredAttribute(exactlyOne(descendants(work, "FRBRnumber")), "value");
  const language = requiredAttribute(exactlyOne(descendants(expression, "FRBRlanguage")), "language").toLowerCase();
  const workMatch = workUri.match(/^\/akn\/fi\/act\/statute-consolidated\/((?!0000)\d{4})\/([1-9]\d{0,5})$/u);
  const expressionMatch = expressionUri.match(/^\/akn\/fi\/act\/statute-consolidated\/((?!0000)\d{4})\/([1-9]\d{0,5})\/(fin|swe)@[0-9A-Za-z]*$/u);
  if (!workMatch || !expressionMatch || country !== "fi" || subtype !== "statute-consolidated" || number !== workMatch[2] || expressionMatch[1] !== workMatch[1] || expressionMatch[2] !== number || expressionMatch[3] !== language) throw new Error("Finlex AKN identity mismatch");
  if (expectedYear !== undefined && workMatch[1] !== expectedYear) throw new Error("Finlex AKN year mismatch");
  if (expectedNumber !== undefined && number !== expectedNumber) throw new Error("Finlex AKN number mismatch");
  if (expectedLanguage !== undefined && language !== expectedLanguage) throw new Error("Finlex AKN language mismatch");
  const authority = descendants(work, "FRBRauthoritative");
  if (authority.length !== 1 || requiredAttribute(authority[0], "value") !== "false") throw new Error("Finlex AKN authority metadata mismatch");
  const title = nodeText(exactlyOne(descendants(root, "docTitle"))).trim();
  if (!title) throw new Error("Finlex AKN title missing");
  return { year: workMatch[1], number, country, subtype, language, workUri, expressionUri, title, authoritative: requiredAttribute(authority[0], "value") === "true", root };
}

export function findSection(root: AknNode, requestedSection: string): AknNode | null {
  const matches = descendants(root, "section").filter((section) => directChildText(section, "num").trim() === `${requestedSection} §`);
  return matches.length === 1 ? matches[0] : null;
}

function parseLawCode(value: string): { year: string; number: string } | null {
  const match = /^([1-9]\d{0,5})\/((?!0000)\d{4})$/u.exec(value.trim());
  return match ? { number: match[1], year: match[2] } : null;
}

function parseXml(xml: string): AknNode {
  const root: AknNode = { name: "#root", attributes: {}, children: [], text: "" };
  const stack: AknNode[] = [root];
  const tokenPattern = /<!--[\s\S]*?-->|<\?[^>]*\?>|<![^>]*>|<[^>]+>|[^<]+/gu;
  for (const match of xml.matchAll(tokenPattern)) {
    const token = match[0];
    if (token.startsWith("<!--") || token.startsWith("<?") || token.startsWith("<!")) continue;
    if (token.startsWith("</")) {
      const name = localName(token.slice(2, -1).trim());
      if (stack.length === 1 || stack.pop()?.name !== name) throw new Error("Malformed XML");
    } else if (token.startsWith("<")) {
      const selfClosing = /\/\s*>$/u.test(token);
      const body = token.slice(1, token.length - (selfClosing ? 2 : 1)).trim();
      const nameMatch = /^([^\s/>]+)/u.exec(body);
      if (!nameMatch) throw new Error("Malformed XML");
      const node: AknNode = { name: localName(nameMatch[1]), attributes: parseAttributes(body.slice(nameMatch[0].length)), children: [], text: "" };
      stack[stack.length - 1].children.push(node);
      if (!selfClosing) stack.push(node);
    } else {
      if (stack.length === 1 && /\S/u.test(token)) throw new Error("Malformed XML");
      stack[stack.length - 1].text += decodeEntities(token);
    }
  }
  if (stack.length !== 1 || root.children.length !== 1) throw new Error("Malformed XML");
  return root.children[0];
}

function parseAttributes(value: string): Record<string, string> {
  const attributes: Record<string, string> = {};
  const pattern = /([^\s=]+)\s*=\s*(["'])(.*?)\2/gu;
  for (const match of value.matchAll(pattern)) attributes[localName(match[1])] = decodeEntities(match[3]);
  return attributes;
}

function localName(name: string): string { const index = name.indexOf(":"); return index >= 0 ? name.slice(index + 1) : name; }
function requiredAttribute(node: AknNode, name: string): string { const value = node.attributes[name]; if (!value) throw new Error(`Finlex AKN attribute missing: ${name}`); return value; }
function exactlyOne(nodes: AknNode[]): AknNode { if (nodes.length !== 1) throw new Error("Finlex AKN metadata is ambiguous or missing"); return nodes[0]; }
function directChildText(node: AknNode, name: string): string { const child = node.children.filter((candidate) => candidate.name === name); return child.length === 1 ? nodeText(child[0]) : ""; }
function descendants(node: AknNode, name: string): AknNode[] { return node.children.flatMap((child) => [ ...(child.name === name ? [child] : []), ...descendants(child, name) ]); }
function nodeText(node: AknNode): string { return `${node.text} ${node.children.map(nodeText).join(" ")}`.replace(/\s+/gu, " ").trim(); }
function decodeEntities(value: string): string { return value.replace(/&amp;/gu, "&").replace(/&lt;/gu, "<").replace(/&gt;/gu, ">").replace(/&quot;/gu, "\"").replace(/&apos;/gu, "'").replace(/&#(\d+);/gu, (_m, code: string) => String.fromCodePoint(Number(code))); }
