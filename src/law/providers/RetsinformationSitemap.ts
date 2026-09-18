import type { LawProviderHttpTransport } from "../httpTransport";
import { parseDkCanonicalEli } from "./retsinformationIdentity";
import {
  requestRetsinformationWithRetry,
  type RetsinformationRetryOptions,
} from "./retsinformationHttp";

export const RETSINFORMATION_ELI_SITEMAP_URL = "https://www.retsinformation.dk/eli/sitemap.xml";
const SITEMAP_NAMESPACE = "http://www.sitemaps.org/schemas/sitemap/0.9";

export interface RetsinformationSitemapEntry {
  canonicalEli: string;
  sitemapLastModified: string | null;
}

export type RetsinformationSitemapOptions = RetsinformationRetryOptions;

interface SitemapRecord {
  loc: string;
  lastmod: string | null;
}

interface XmlAttribute {
  name: string;
  value: string;
}

interface XmlNode {
  name: string;
  localName: string;
  prefix: string | null;
  attributes: XmlAttribute[];
  children: XmlNode[];
  text: string;
}

function decodeXmlEntities(value: string): string {
  return value.replace(/&(?:amp|lt|gt|quot|apos);|&#(?:x[\da-f]+|\d+);/giu, (entity) => {
    switch (entity.toLowerCase()) {
      case "&amp;": return "&";
      case "&lt;": return "<";
      case "&gt;": return ">";
      case "&quot;": return "\"";
      case "&apos;": return "'";
      default: {
        const hexadecimal = entity.match(/^&#x([\da-f]+);$/iu);
        const numeric = entity.match(/^&#(\d+);$/u);
        const codePoint = hexadecimal
          ? Number.parseInt(hexadecimal[1], 16)
          : numeric ? Number.parseInt(numeric[1], 10) : Number.NaN;
        return Number.isSafeInteger(codePoint) ? String.fromCodePoint(codePoint) : entity;
      }
    }
  });
}

function parseQualifiedName(name: string): { prefix: string | null; localName: string } {
  const match = /^([A-Za-z_][\w.-]*):([A-Za-z_][\w.-]*)$|^([A-Za-z_][\w.-]*)$/u.exec(name);
  if (!match) throw new Error(`Malformed Retsinformation sitemap: invalid XML name ${name}.`);
  return { prefix: match[1] ?? null, localName: match[2] ?? match[3] };
}

function parseXml(xml: string): XmlNode {
  let offset = 0;
  const source = xml.replace(/^\uFEFF/u, "");

  function skipWhitespace(): void {
    while (/\s/u.test(source[offset] ?? "")) offset += 1;
  }

  function skipMisc(): void {
    while (true) {
      skipWhitespace();
      if (source.startsWith("<?", offset)) {
        const end = source.indexOf("?>", offset + 2);
        if (end < 0) throw new Error("Malformed Retsinformation sitemap: unterminated processing instruction.");
        offset = end + 2;
      } else if (source.startsWith("<!--", offset)) {
        const end = source.indexOf("-->", offset + 4);
        if (end < 0) throw new Error("Malformed Retsinformation sitemap: unterminated comment.");
        offset = end + 3;
      } else {
        return;
      }
    }
  }

  function parseElement(): XmlNode {
    if (source[offset] !== "<" || source.startsWith("</", offset)) {
      throw new Error("Malformed Retsinformation sitemap: expected an opening tag.");
    }
    offset += 1;
    const nameStart = offset;
    while (/[A-Za-z0-9_.:-]/u.test(source[offset] ?? "")) offset += 1;
    const name = source.slice(nameStart, offset);
    const qualifiedName = parseQualifiedName(name);
    const attributes: XmlAttribute[] = [];
    const attributeNames = new Set<string>();
    let selfClosing = false;
    while (true) {
      skipWhitespace();
      if (source.startsWith("/>", offset)) {
        offset += 2;
        selfClosing = true;
        break;
      }
      if (source[offset] === ">") {
        offset += 1;
        break;
      }
      const attributeStart = offset;
      while (/[A-Za-z0-9_.:-]/u.test(source[offset] ?? "")) offset += 1;
      const attributeName = source.slice(attributeStart, offset);
      parseQualifiedName(attributeName);
      if (!attributeName || attributeNames.has(attributeName)) {
        throw new Error(`Malformed Retsinformation sitemap: duplicate or invalid XML attribute ${attributeName}.`);
      }
      attributeNames.add(attributeName);
      skipWhitespace();
      if (source[offset] !== "=") throw new Error("Malformed Retsinformation sitemap: attribute without value.");
      offset += 1;
      skipWhitespace();
      const quote = source[offset];
      if (quote !== "\"" && quote !== "'") throw new Error("Malformed Retsinformation sitemap: unquoted attribute.");
      offset += 1;
      const valueStart = offset;
      while (source[offset] !== quote && source[offset] !== undefined) {
        if (source[offset] === "<") throw new Error("Malformed Retsinformation sitemap: invalid attribute value.");
        offset += 1;
      }
      if (source[offset] !== quote) throw new Error("Malformed Retsinformation sitemap: unterminated attribute.");
      attributes.push({ name: attributeName, value: decodeXmlEntities(source.slice(valueStart, offset)) });
      offset += 1;
    }

    const node: XmlNode = { name, ...qualifiedName, attributes, children: [], text: "" };
    if (selfClosing) return node;
    while (true) {
      if (source[offset] === undefined) {
        throw new Error("Malformed Retsinformation sitemap: unterminated element at EOF.");
      }
      if (source.startsWith("</", offset)) {
        offset += 2;
        const closeStart = offset;
        while (/[A-Za-z0-9_.:-]/u.test(source[offset] ?? "")) offset += 1;
        const closeName = source.slice(closeStart, offset);
        skipWhitespace();
        if (source[offset] !== ">" || closeName !== name) {
          throw new Error("Malformed Retsinformation sitemap: mismatched closing tag.");
        }
        offset += 1;
        return node;
      }
      if (source[offset] !== "<") {
        const textStart = offset;
        while (source[offset] !== "<" && source[offset] !== undefined) offset += 1;
        node.text += source.slice(textStart, offset);
        continue;
      }
      if (source.startsWith("<!--", offset)) {
        const end = source.indexOf("-->", offset + 4);
        if (end < 0) throw new Error("Malformed Retsinformation sitemap: unterminated comment.");
        offset = end + 3;
      } else if (source.startsWith("<?", offset)) {
        const end = source.indexOf("?>", offset + 2);
        if (end < 0) throw new Error("Malformed Retsinformation sitemap: unterminated processing instruction.");
        offset = end + 2;
      } else if (source.startsWith("<![CDATA[", offset)) {
        const end = source.indexOf("]]>", offset + 9);
        if (end < 0) throw new Error("Malformed Retsinformation sitemap: unterminated CDATA.");
        node.text += source.slice(offset + 9, end);
        offset = end + 3;
      } else if (source.startsWith("<!", offset)) {
        throw new Error("Malformed Retsinformation sitemap: unsupported declaration.");
      } else {
        node.children.push(parseElement());
      }
    }
  }

  skipMisc();
  const root = parseElement();
  skipMisc();
  if (offset !== source.length) throw new Error("Malformed Retsinformation sitemap: multiple document roots.");
  return root;
}

function namespaceFor(node: XmlNode, inherited: Map<string, string>): Map<string, string> {
  const namespaces = new Map(inherited);
  for (const attribute of node.attributes) {
    if (attribute.name === "xmlns") namespaces.set("", attribute.value);
    else if (attribute.name.startsWith("xmlns:")) namespaces.set(attribute.name.slice(6), attribute.value);
  }
  return namespaces;
}

function validateSitemapNamespace(node: XmlNode, inherited: Map<string, string>, expectedPrefix: string | null): void {
  if (node.prefix !== expectedPrefix) throw new Error("Malformed Retsinformation sitemap: inconsistent element prefix.");
  const namespaces = namespaceFor(node, inherited);
  if (namespaces.get(expectedPrefix ?? "") !== SITEMAP_NAMESPACE) {
    throw new Error("Malformed Retsinformation sitemap: element has the wrong namespace.");
  }
  for (const child of node.children) validateSitemapNamespace(child, namespaces, expectedPrefix);
}

function parseSitemapRoot(xml: string, expectedRoot: string): XmlNode {
  const root = parseXml(xml);
  if (root.localName !== expectedRoot) throw new Error(`Malformed Retsinformation sitemap: expected ${expectedRoot} root.`);
  const prefix = root.prefix;
  validateSitemapNamespace(root, new Map(), prefix);
  return root;
}

function requiredDirectText(node: XmlNode, element: string, prefix: string | null): string {
  const matches = node.children.filter((child) => child.localName === element && child.prefix === prefix);
  if (matches.length !== 1 || matches[0].children.length !== 0) {
    throw new Error(`Malformed Retsinformation sitemap: expected one direct ${element}.`);
  }
  const value = decodeXmlEntities(matches[0].text.trim());
  if (!value) throw new Error(`Malformed Retsinformation sitemap: empty ${element}.`);
  return value;
}

function parseSitemapIndex(xml: string): string[] {
  const root = parseSitemapRoot(xml, "sitemapindex");
  const records = root.children.filter((child) => child.localName === "sitemap" && child.prefix === root.prefix);
  if (records.length === 0 || records.length !== root.children.length) {
    throw new Error("Malformed Retsinformation sitemap index: expected direct sitemap pages.");
  }
  return records.map((record) => requiredDirectText(record, "loc", root.prefix));
}

function parseSitemapPage(xml: string): SitemapRecord[] {
  const root = parseSitemapRoot(xml, "urlset");
  const records = root.children.filter((child) => child.localName === "url" && child.prefix === root.prefix);
  if (records.length === 0 || records.length !== root.children.length) {
    throw new Error("Malformed Retsinformation sitemap page: expected direct URL entries.");
  }
  return records.map((record) => {
    const lastmods = record.children.filter((child) => child.localName === "lastmod" && child.prefix === root.prefix);
    if (lastmods.length > 1 || record.children.some((child) => child.localName !== "loc" && child.localName !== "lastmod")) {
      throw new Error("Malformed Retsinformation sitemap page: invalid direct URL children.");
    }
    return {
      loc: requiredDirectText(record, "loc", root.prefix),
      lastmod: lastmods.length === 1 ? decodeXmlEntities(lastmods[0].text) : null,
    };
  });
}

function validateSitemapPageUrl(pageUrl: string): void {
  let url: URL;
  try { url = new URL(pageUrl); } catch { throw new Error(`Invalid Retsinformation sitemap page URL: ${pageUrl}`); }
  if (url.protocol !== "https:" || url.hostname !== "www.retsinformation.dk" || url.port
    || url.username || url.password) {
    throw new Error(`Non-official Retsinformation sitemap page URL: ${pageUrl}`);
  }
}

function canonicalEntry(record: SitemapRecord): RetsinformationSitemapEntry | null {
  let url: URL;
  try { url = new URL(record.loc); } catch { return null; }
  if (url.protocol !== "https:" || url.hostname !== "www.retsinformation.dk"
    || url.username || url.password || url.port || url.search || url.hash) return null;

  const identity = parseDkCanonicalEli(url.pathname);
  if (!identity || identity.canonicalEli !== url.pathname) return null;
  return {
    canonicalEli: identity.canonicalEli,
    sitemapLastModified: record.lastmod,
  };
}

async function fetchText(
  fetchFn: LawProviderHttpTransport,
  url: string,
  options: RetsinformationSitemapOptions,
): Promise<string> {
  const response = await requestRetsinformationWithRetry(fetchFn, url, options);
  if (!response.ok) throw new Error(`Retsinformation sitemap request failed: ${url}`);
  return response.text();
}

export async function enumerateRetsinformationSitemap(
  fetchFn: LawProviderHttpTransport,
  options: RetsinformationSitemapOptions = {},
): Promise<RetsinformationSitemapEntry[]> {
  const indexXml = await fetchText(fetchFn, RETSINFORMATION_ELI_SITEMAP_URL, options);
  const pageUrls = parseSitemapIndex(indexXml);
  const entries = new Map<string, RetsinformationSitemapEntry>();

  for (const pageUrl of pageUrls) {
    validateSitemapPageUrl(pageUrl);
    const pageXml = await fetchText(fetchFn, pageUrl, options);
    for (const record of parseSitemapPage(pageXml)) {
      const entry = canonicalEntry(record);
      if (!entry) continue;
      const previous = entries.get(entry.canonicalEli);
      if (!previous) {
        entries.set(entry.canonicalEli, entry);
      } else if (previous.sitemapLastModified !== entry.sitemapLastModified) {
        throw new Error(`Conflicting sitemap lastmod for ${entry.canonicalEli}.`);
      }
    }
  }

  return [...entries.values()].sort((left, right) => left.canonicalEli.localeCompare(right.canonicalEli));
}
