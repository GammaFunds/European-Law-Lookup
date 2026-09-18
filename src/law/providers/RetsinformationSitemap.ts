import type { LawProviderHttpTransport } from "../httpTransport";
import {
  requestRetsinformationWithRetry,
} from "./retsinformationHttp";
import { parseDkCanonicalEli } from "./retsinformationIdentity";

export interface RetsinformationSitemapEntry {
  canonicalEli: string;
  sitemapLastModified: string | null;
}

export interface RetsinformationSitemapOptions {
  sleep?: (ms: number) => Promise<void>;
}

const OFFICIAL_INDEX_URL = "https://www.retsinformation.dk/eli/sitemap.xml";
const OFFICIAL_SITEMAP_ORIGIN = "https://www.retsinformation.dk";
const SITEMAP_NS = "http://www.sitemaps.org/schemas/sitemap/0.9";

interface XmlNode {
  qualifiedName: string;
  localName: string;
  namespace: string | null;
  children: XmlNode[];
  text: string;
}

const XML_NAME_PART = /^[A-Za-z_][A-Za-z0-9_.-]*$/;

function parseXmlDocument(xml: string): XmlNode {
  let offset = 0;
  const stack: Array<{ node: XmlNode; namespaces: Map<string, string> }> = [];
  let root: XmlNode | null = null;

  const fail = (): never => {
    throw new Error("malformed XML sitemap document");
  };
  const isWhitespace = (char: string): boolean => /\s/.test(char);
  const skipWhitespace = (): void => {
    while (offset < xml.length && isWhitespace(xml[offset])) offset += 1;
  };
  const readName = (): string => {
    const start = offset;
    while (offset < xml.length && /[A-Za-z0-9_.:-]/.test(xml[offset])) offset += 1;
    const name = xml.substring(start, offset);
    const parts = name.split(":");
    if (parts.length > 2 || parts.some((part) => !XML_NAME_PART.test(part))) fail();
    return name;
  };

  while (offset < xml.length) {
    if (xml[offset] !== "<") {
      const start = offset;
      while (offset < xml.length && xml[offset] !== "<") offset += 1;
      const text = xml.substring(start, offset);
      if (stack.length > 0) stack[stack.length - 1].node.text += text;
      else if (text.trim() !== "") fail();
      continue;
    }

    if (xml.startsWith("<!--", offset)) {
      const end = xml.indexOf("-->", offset + 4);
      if (end === -1) fail();
      offset = end + 3;
      continue;
    }
    if (xml.startsWith("<?", offset)) {
      const end = xml.indexOf("?>", offset + 2);
      if (end === -1) fail();
      offset = end + 2;
      continue;
    }
    if (xml.startsWith("<![CDATA[", offset)) {
      const end = xml.indexOf("]]>", offset + 9);
      if (end === -1 || stack.length === 0) fail();
      stack[stack.length - 1].node.text += xml.substring(offset + 9, end);
      offset = end + 3;
      continue;
    }
    if (xml.startsWith("<!", offset)) fail();

    if (xml.startsWith("</", offset)) {
      offset += 2;
      const closingName = readName();
      skipWhitespace();
      if (xml[offset] !== ">" || stack.length === 0) fail();
      const current = stack.pop();
      if (!current || current.node.qualifiedName !== closingName) fail();
      offset += 1;
      continue;
    }

    offset += 1;
    const qualifiedName = readName();
    const attributes = new Set<string>();
    const namespaceDeclarations = new Map<string, string>();
    let selfClosing = false;
    while (true) {
      skipWhitespace();
      if (xml.startsWith("/>", offset)) {
        offset += 2;
        selfClosing = true;
        break;
      }
      if (xml[offset] === ">") {
        offset += 1;
        break;
      }
      if (offset >= xml.length) fail();
      const attributeName = readName();
      if (attributes.has(attributeName)) fail();
      attributes.add(attributeName);
      skipWhitespace();
      if (xml[offset] !== "=") fail();
      offset += 1;
      skipWhitespace();
      const quote = xml[offset];
      if (quote !== '"' && quote !== "'") fail();
      offset += 1;
      const valueStart = offset;
      const valueEnd = xml.indexOf(quote, valueStart);
      if (valueEnd === -1) fail();
      const value = xml.substring(valueStart, valueEnd);
      offset = valueEnd + 1;
      if (attributeName === "xmlns") namespaceDeclarations.set("", value);
      else if (attributeName.startsWith("xmlns:")) {
        const prefix = attributeName.substring(6);
        namespaceDeclarations.set(prefix, value);
      }
    }

    const inherited = stack.length > 0 ? stack[stack.length - 1].namespaces : new Map<string, string>();
    const namespaces = new Map(inherited);
    for (const [prefix, value] of namespaceDeclarations) namespaces.set(prefix, value);
    const prefix = qualifiedName.includes(":") ? qualifiedName.substring(0, qualifiedName.indexOf(":")) : "";
    const localName = qualifiedName.includes(":") ? qualifiedName.substring(qualifiedName.indexOf(":") + 1) : qualifiedName;
    const node: XmlNode = {
      qualifiedName,
      localName,
      namespace: namespaces.get(prefix) ?? null,
      children: [],
      text: "",
    };
    if (stack.length > 0) stack[stack.length - 1].node.children.push(node);
    else if (root !== null) fail();
    else root = node;
    if (!selfClosing) stack.push({ node, namespaces });
  }

  if (stack.length !== 0 || root === null) fail();
  return root as XmlNode;
}

function requireSitemapNode(node: XmlNode, localName: string, kind: string): void {
  if (node.localName !== localName || node.namespace !== SITEMAP_NS) {
    throw new Error(`malformed sitemap ${kind}: invalid root`);
  }
}

function directText(node: XmlNode, localName: string, kind: string, required: boolean): string | null {
  const matches = node.children.filter((child) => child.localName === localName);
  if (matches.length > 1 || (required && matches.length === 0)) {
    throw new Error(`malformed sitemap ${kind}: invalid <${localName}>`);
  }
  if (matches.length === 0) return null;
  const match = matches[0];
  if (match.namespace !== SITEMAP_NS || match.children.length > 0) {
    throw new Error(`malformed sitemap ${kind}: invalid <${localName}>`);
  }
  const value = match.text.trim();
  if (required && value === "") throw new Error(`malformed sitemap ${kind}: empty <${localName}>`);
  return value;
}

function parseSitemapIndex(xml: string): string[] {
  const root = parseXmlDocument(xml);
  requireSitemapNode(root, "sitemapindex", "index");
  if (root.children.length === 0) {
    throw new Error("malformed sitemap index: no <sitemap> elements found");
  }
  const urls: string[] = [];
  for (const sitemap of root.children) {
    if (sitemap.localName !== "sitemap" || sitemap.namespace !== SITEMAP_NS) {
      throw new Error("malformed sitemap index: invalid direct child");
    }
    urls.push(directText(sitemap, "loc", "index", true)!);
  }
  return urls;
}

function parseSitemapPage(xml: string): Array<{ loc: string; lastmod: string | null }> {
  const root = parseXmlDocument(xml);
  requireSitemapNode(root, "urlset", "page");
  if (root.children.length === 0) {
    throw new Error("malformed sitemap page: no <url> elements found");
  }
  const entries: Array<{ loc: string; lastmod: string | null }> = [];
  for (const url of root.children) {
    if (url.localName !== "url" || url.namespace !== SITEMAP_NS) {
      throw new Error("malformed sitemap page: invalid direct child");
    }
    const loc = directText(url, "loc", "page", true)!;
    const lastmod = directText(url, "lastmod", "page", false);
    for (const child of url.children) {
      if (child.localName !== "loc" && child.localName !== "lastmod") {
        throw new Error("malformed sitemap page: invalid direct child");
      }
    }
    entries.push({ loc, lastmod });
  }
  return entries;
}

function isOfficialOrigin(loc: string, officialOrigin: string): boolean {
  if (!loc.startsWith("https://")) return false;
  const authorityEnd = loc.indexOf("/", "https://".length);
  const rawAuthority = authorityEnd === -1 ? loc.substring("https://".length) : loc.substring("https://".length, authorityEnd);
  if (rawAuthority !== "www.retsinformation.dk") return false;

  try {
    const url = new URL(loc);
    return url.protocol === "https:" &&
      url.hostname === "www.retsinformation.dk" &&
      url.username === "" &&
      url.password === "" &&
      url.port === "" &&
      url.origin === officialOrigin;
  } catch {
    return false;
  }
}

export async function enumerateRetsinformationSitemap(
  fetchFn: LawProviderHttpTransport,
  options: RetsinformationSitemapOptions = {},
): Promise<RetsinformationSitemapEntry[]> {
  const retryOptions = options.sleep ? { sleep: options.sleep } : undefined;
  const indexResponse = await requestRetsinformationWithRetry(fetchFn, OFFICIAL_INDEX_URL, retryOptions);
  if (!indexResponse.ok) {
    throw new Error(`failed to fetch sitemap index: HTTP ${indexResponse.status}`);
  }
  const indexXml = await indexResponse.text();
  const pageUrls = parseSitemapIndex(indexXml);

  const seen = new Map<string, string | null>();
  for (const pageUrl of pageUrls) {
    if (!isOfficialOrigin(pageUrl, OFFICIAL_SITEMAP_ORIGIN)) {
      throw new Error(`rejected foreign sitemap page origin: ${pageUrl}`);
    }
    const pageResponse = await requestRetsinformationWithRetry(fetchFn, pageUrl, retryOptions);
    if (!pageResponse.ok) {
      throw new Error(`failed to fetch sitemap page: HTTP ${pageResponse.status}`);
    }
    const pageXml = await pageResponse.text();
    const records = parseSitemapPage(pageXml);

    for (const record of records) {
      if (!isOfficialOrigin(record.loc, OFFICIAL_SITEMAP_ORIGIN)) continue;
      const parsed = parseDkCanonicalEli(record.loc);
      if (!parsed) continue;

      const existing = seen.get(parsed.canonicalEli);
      if (existing !== undefined) {
        if (existing !== record.lastmod) {
          throw new Error(
            `conflicting lastmod for ${parsed.canonicalEli}: "${existing}" vs "${record.lastmod}"`
          );
        }
        continue;
      }
      seen.set(parsed.canonicalEli, record.lastmod);
    }
  }

  const entries: RetsinformationSitemapEntry[] = [];
  for (const [canonicalEli, lastmod] of seen) {
    entries.push({ canonicalEli, sitemapLastModified: lastmod });
  }
  entries.sort((a, b) => a.canonicalEli.localeCompare(b.canonicalEli));
  return entries;
}
