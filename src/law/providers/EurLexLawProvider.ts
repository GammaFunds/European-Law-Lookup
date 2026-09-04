import type { LawProvider } from "../LawProvider";
import { LawProviderUnavailableError } from "../errors";
import type { LawProviderHttpTransport } from "../httpTransport";
import type { LawReference, LawSection } from "../types";
import { euActForCelexReference } from "../euActRegistry";
import {
  buildEurLexFetchRequest,
  buildEurLexSectionUrl,
  buildEurLexXhtmlFetchRequest,
  EuActLanguageExpressionUnavailableError,
  isCellarUuid,
  resolveEuCelexIdentity,
  type EuActLanguageAuthorizer,
} from "./eurLexMapping";

export class EurLexLawProvider implements LawProvider {
  readonly id = "eur-lex";
  readonly label = "EUR-Lex";

  constructor(
    private readonly fetchFn: LawProviderHttpTransport,
    private readonly languageAuthorizer?: EuActLanguageAuthorizer,
  ) {}

  async getSection(reference: LawReference): Promise<LawSection | null> {
    const identity = resolveEuCelexIdentity(reference);
    if (!identity) return null;
    const requestedLanguage = reference.language ?? "de";
    // The local EU-act index is advisory only. Negative metadata (e.g. a
    // requested language absent from the cached index) is NOT authoritative
    // evidence of unavailability and must not veto a structurally valid request
    // before the official Identifier Notice is consulted.
    this.languageAuthorizer?.authorize(identity.celex, requestedLanguage);
    const sourceUrl = buildEurLexSectionUrl(reference);
    const fetchRequest = buildEurLexFetchRequest(reference);
    if (!sourceUrl || !fetchRequest) return null;

    let response;
    try {
      response = await this.fetchFn(fetchRequest.url, { headers: fetchRequest.headers });
    } catch (error) {
      throw new LawProviderUnavailableError(
        this.id,
        "EUR-Lex lookup failed before a definitive not-found result.",
        error,
      );
    }

    if (response.status === 404) return null;
    if (response.status !== 200) {
      throw new LawProviderUnavailableError(
        this.id,
        `EUR-Lex request failed: ${sourceUrl}`,
      );
    }

    const notice = await response.text();
    const cellarUuid = extractValidatedCellarUuid(notice, identity.celex);
    if (!cellarUuid) return null;

    const xhtmlRequest = buildEurLexXhtmlFetchRequest(reference, cellarUuid);
    if (!xhtmlRequest) return null;

    try {
      response = await this.fetchFn(xhtmlRequest.url, { headers: xhtmlRequest.headers });
    } catch (error) {
      throw new LawProviderUnavailableError(
        this.id,
        "EUR-Lex XHTML lookup failed before a definitive not-found result.",
        error,
      );
    }

    if (response.status === 404) {
      // The Identifier Notice already proved the act exists; a 404 on the
      // requested-language CELLAR XHTML expression is therefore authoritative
      // evidence that this language representation is absent. It must not
      // collapse into a generic not-found article result.
      throw new EuActLanguageExpressionUnavailableError(identity.celex, requestedLanguage);
    }
    if (response.status !== 200) {
      throw new LawProviderUnavailableError(
        this.id,
        `EUR-Lex request failed: ${sourceUrl}`,
      );
    }

    const html = await response.text();
    if (!isUsableHtml(html)) return null;

    const article = extractElementById(html, `art_${reference.section}`);
    if (!article) return null;

    const subtitle = textOf(firstElementByClass(article, "oj-sti-art"));
    const body = textOf(
      removeElementByClass(
        removeElementByClass(removeElementByClass(article, "oj-ti-art"), "oj-sti-art"),
        "oj-art",
      ),
    );
    if (!body) return null;

    return {
      providerId: this.id,
      providerLabel: this.label,
      sourceUrl,
      lawCode: reference.lawCode,
      lawTitle: textOf(firstElementByClass(html, "oj-doc-ti")) || euActForCelexReference(identity.celex)?.officialTitle || reference.lawCode,
      section: reference.section,
      referenceType: "article",
      jurisdiction: "EU",
      language: reference.language,
      heading: subtitle || undefined,
      text: body,
      retrievedAt: new Date().toISOString(),
      cacheStatus: "live",
      isOfficialSource: true,
      isAuthoritativeText: true,
      euCelex: identity.celex,
      euDocumentType: identity.documentType,
    };
  }
}

function isUsableHtml(html: string): boolean {
  return /<html\b/i.test(html) && /<body\b/i.test(html) && !/(captcha|access denied|just a moment)/i.test(html);
}

function firstElementByClass(html: string, className: string): string | null {
  const match = new RegExp(`<([\\w:-]+)\\b[^>]*\\bclass=["'][^"']*\\b${className}\\b[^"']*["'][^>]*>`, "i").exec(html);
  return match ? extractElementAt(html, match.index, match[1]) : null;
}

function removeElementByClass(html: string, className: string): string {
  const element = firstElementByClass(html, className);
  return element ? html.replace(element, "") : html;
}

function extractElementById(html: string, id: string): string | null {
  const match = new RegExp(`<([\\w:-]+)\\b[^>]*\\bid=["']${escapeRegex(id)}["'][^>]*>`, "i").exec(html);
  return match ? extractElementAt(html, match.index, match[1]) : null;
}

function extractElementAt(html: string, start: number, tag: string): string | null {
  const token = new RegExp(`<\\/?${escapeRegex(tag)}\\b[^>]*>`, "gi");
  token.lastIndex = start;
  let depth = 0;
  let match: RegExpExecArray | null;

  while ((match = token.exec(html))) {
    if (/^<\//.test(match[0])) depth--;
    else if (!/\/>$/.test(match[0])) depth++;
    if (depth === 0) return html.slice(start, token.lastIndex);
  }

  return null;
}

function textOf(html: string | null): string {
  if (!html) return "";

  return decodeEntities(
    html
      .replace(/<!--[\s\S]*?-->/g, "")
      .replace(/<(script|style|nav)\b[\s\S]*?<\/\1>/gi, "")
      .replace(/<\/(p|div|li|br|tr|h\d)>/gi, "\n")
      .replace(/<[^>]+>/g, " "),
  )
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
}

function decodeEntities(value: string): string {
  return value.replace(/&(?:amp|lt|gt|quot|apos);|&#x[0-9a-f]+;|&#\d+;/gi, (entity) => {
    const named: Record<string, string> = {
      "&amp;": "&",
      "&lt;": "<",
      "&gt;": ">",
      "&quot;": '"',
      "&apos;": "'",
    };
    if (named[entity.toLowerCase()]) return named[entity.toLowerCase()];

    const number = entity.startsWith("&#x") || entity.startsWith("&#X")
      ? parseInt(entity.slice(3, -1), 16)
      : parseInt(entity.slice(2, -1), 10);
    return isValidUnicodeScalarValue(number) ? String.fromCodePoint(number) : entity;
  });
}

function isValidUnicodeScalarValue(value: number): boolean {
  return Number.isFinite(value)
    && value >= 0
    && value <= 0x10ffff
    && (value < 0xd800 || value > 0xdfff);
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function extractValidatedCellarUuid(notice: string, expectedCelex: string): string | null {
  const uriBlocks = parseIdentifierNotice(notice);
  if (!uriBlocks) return null;

  const celexBlocks = uriBlocks.filter((block) => block.type === "celex" || isCelexValue(block.value));
  if (celexBlocks.length !== 1) return null;
  const celexBlock = celexBlocks[0];
  if (celexBlock.type !== "celex"
    || celexBlock.identifier !== expectedCelex
    || celexBlock.value !== `http://publications.europa.eu/resource/celex/${expectedCelex}`
      && celexBlock.value !== `https://publications.europa.eu/resource/celex/${expectedCelex}`) return null;

  const cellarCandidates = uriBlocks.filter((block) => block.type === "cellar" || isCellarValue(block.value));
  if (cellarCandidates.length !== 1) return null;
  const cellar = cellarCandidates[0];
  const uuid = cellar.identifier;
  const valueUuid = /^https?:\/\/publications\.europa\.eu\/resource\/cellar\/([^/]+)$/.exec(cellar.value ?? "")?.[1];
  return cellar.type === "cellar" && uuid !== null && valueUuid === uuid && isCellarUuid(uuid) ? uuid : null;
}

type NoticeUriBlock = { type: string; identifier: string; value: string };
type NoticeToken =
  | { kind: "text"; value: string }
  | { kind: "open" | "close"; name: string; attributes: string }
  | { kind: "declaration" };

function parseIdentifierNotice(notice: string): NoticeUriBlock[] | null {
  const tokens = tokenizeNotice(notice);
  if (!tokens) return null;

  let position = 0;
  position = skipWhitespace(tokens, position);
  if (tokens[position]?.kind === "declaration") position++;
  position = skipWhitespace(tokens, position);
  const root = tokens[position];
  if (root?.kind !== "open" || root.name !== "NOTICE" || !hasIdentifierType(root)) return null;
  position++;

  const uriBlocks: NoticeUriBlock[] = [];
  while (true) {
    if (isWhitespace(tokens[position])) {
      position++;
      continue;
    }
    if (isClosing(tokens[position], "NOTICE")) {
      position++;
      break;
    }
    if (isOpening(tokens[position], "URI")) {
      const parsed = parseNoticeUri(tokens, position);
      if (!parsed) return null;
      uriBlocks.push(parsed.uri);
      position = parsed.position;
      continue;
    }
    if (isOpening(tokens[position], "SAMEAS")) {
      const parsed = parseSameAs(tokens, position);
      if (!parsed) return null;
      uriBlocks.push(parsed.uri);
      position = parsed.position;
      continue;
    }
    return null;
  }

  while (isWhitespace(tokens[position])) position++;
  return position === tokens.length ? uriBlocks : null;
}

const XML_DECLARATION_PATTERN =
  /^<\?xml[ \t\r\n]+version[ \t\r\n]*=[ \t\r\n]*(["'])1\.0\1(?:[ \t\r\n]+encoding[ \t\r\n]*=[ \t\r\n]*(["'])[A-Za-z][A-Za-z0-9._-]*\2)?(?:[ \t\r\n]+standalone[ \t\r\n]*=[ \t\r\n]*(["'])(?:yes|no)\3)?[ \t\r\n]*\?>$/;

function isValidXmlDeclaration(token: string): boolean {
  return XML_DECLARATION_PATTERN.test(token);
}

function tokenizeNotice(input: string): NoticeToken[] | null {
  const tokens: NoticeToken[] = [];
  let cursor = 0;
  while (cursor < input.length) {
    if (input[cursor] !== "<") {
      const end = input.indexOf("<", cursor);
      const next = end < 0 ? input.length : end;
      tokens.push({ kind: "text", value: input.slice(cursor, next) });
      cursor = next;
      continue;
    }
    const end = input.indexOf(">", cursor + 1);
    if (end < 0) return null;
    const token = input.slice(cursor, end + 1);
    if (token.startsWith("<?xml") && token.endsWith("?>")) {
      if (!isValidXmlDeclaration(token)
        || tokens.some((item) => item.kind !== "text" || item.value.trim())) return null;
      tokens.push({ kind: "declaration" });
    } else {
      const closing = /^<\/([A-Za-z_:][\w:.-]*)\s*>$/.exec(token);
      const opening = /^<([A-Za-z_:][\w:.-]*)([\s\S]*?)>$/.exec(token);
      if (closing) tokens.push({ kind: "close", name: closing[1], attributes: "" });
      else if (opening && !opening[2].trimEnd().endsWith("/")) {
        tokens.push({ kind: "open", name: opening[1], attributes: opening[2] });
      } else return null;
    }
    cursor = end + 1;
  }
  return tokens;
}

function parseNoticeUri(tokens: NoticeToken[], start: number): { uri: NoticeUriBlock; position: number } | null {
  let position = start + 1;
  const fields: Partial<NoticeUriBlock> = {};
  while (true) {
    if (isWhitespace(tokens[position])) {
      position++;
      continue;
    }
    if (isClosing(tokens[position], "URI")) {
      if (fields.type === undefined || fields.identifier === undefined || fields.value === undefined) return null;
      return { uri: fields as NoticeUriBlock, position: position + 1 };
    }
    const field = tokens[position];
    if (field?.kind !== "open" || field.attributes.trim() !== ""
      || (field.name !== "TYPE" && field.name !== "IDENTIFIER" && field.name !== "VALUE")) return null;
    const name = field.name.toLowerCase() as "type" | "identifier" | "value";
    if (fields[name] !== undefined) return null;
    position++;
    const textToken = tokens[position];
    if (textToken?.kind !== "text") return null;
    const value = textToken.value.trim();
    position++;
    if (!isClosing(tokens[position], field.name)) return null;
    fields[name] = value;
    position++;
  }
}

function parseSameAs(tokens: NoticeToken[], start: number): { uri: NoticeUriBlock; position: number } | null {
  let position = start + 1;
  while (isWhitespace(tokens[position])) position++;
  if (!isOpening(tokens[position], "URI")) return null;
  const parsed = parseNoticeUri(tokens, position);
  if (!parsed) return null;
  position = parsed.position;
  while (isWhitespace(tokens[position])) position++;
  return isClosing(tokens[position], "SAMEAS")
    ? { uri: parsed.uri, position: position + 1 }
    : null;
}

function isOpening(token: NoticeToken | undefined, name: string): token is Extract<NoticeToken, { kind: "open" }> {
  return token?.kind === "open" && token.name === name && token.attributes.trim() === "";
}

function isClosing(token: NoticeToken | undefined, name: string): boolean {
  return token?.kind === "close" && token.name === name;
}

function isWhitespace(token: NoticeToken | undefined): token is Extract<NoticeToken, { kind: "text" }> {
  return token?.kind === "text" && !token.value.trim();
}

function skipWhitespace(tokens: NoticeToken[], position: number): number {
  while (isWhitespace(tokens[position])) position++;
  return position;
}

function hasIdentifierType(token: NoticeToken | undefined): boolean {
  if (token?.kind !== "open" || token.name !== "NOTICE") return false;

  const attributes = parseNoticeRootAttributes(token.attributes);
  return attributes?.type === "identifier";
}

function parseNoticeRootAttributes(value: string): { type: string } | null {
  const attributes = new Set<string>();
  const attributePattern = /([A-Za-z_:][A-Za-z0-9_.:-]*)[ \t\r\n]*=[ \t\r\n]*(["'])((?:[^<&]|&(?:amp|lt|gt|quot|apos|#\d+|#x[0-9A-Fa-f]+);)*?)\2/y;
  let position = 0;
  let type: string | undefined;

  while (position < value.length) {
    if (attributes.size > 0) {
      if (!/[ \t\r\n]/.test(value[position] ?? "")) return null;
      while (/[ \t\r\n]/.test(value[position] ?? "")) position++;
    } else {
      while (/[ \t\r\n]/.test(value[position] ?? "")) position++;
    }
    if (position === value.length) break;

    attributePattern.lastIndex = position;
    const match = attributePattern.exec(value);
    if (!match || attributes.has(match[1]) || !hasValidXml10CharacterReferences(match[3])) return null;
    attributes.add(match[1]);
    if (match[1] === "type") type = match[3];
    else if (match[1] !== "embargo-date") return null;
    position = attributePattern.lastIndex;
  }

  return type === undefined || attributes.size > 2 ? null : { type };
}

function hasValidXml10CharacterReferences(value: string): boolean {
  for (const reference of value.match(/&#(?:x[0-9A-Fa-f]+|\d+);/g) ?? []) {
    const number = reference.startsWith("&#x")
      ? Number.parseInt(reference.slice(3, -1), 16)
      : Number.parseInt(reference.slice(2, -1), 10);
    if (!isValidXml10Character(number)) return false;
  }
  return true;
}

function isValidXml10Character(value: number): boolean {
  return value === 0x9
    || value === 0xa
    || value === 0xd
    || value >= 0x20 && value <= 0xd7ff
    || value >= 0xe000 && value <= 0xfffd
    || value >= 0x10000 && value <= 0x10ffff;
}

function isCellarValue(value: string | null): boolean {
  return /^https?:\/\/publications\.europa\.eu\/resource\/cellar\/[^/]+$/.test(value ?? "");
}

function isCelexValue(value: string | null): boolean {
  return /^https?:\/\/publications\.europa\.eu\/resource\/celex\/[^/]+$/.test(value ?? "");
}
