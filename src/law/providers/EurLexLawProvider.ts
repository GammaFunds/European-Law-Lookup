import type { LawProvider } from "../LawProvider";
import { LawProviderUnavailableError } from "../errors";
import type { LawProviderHttpTransport } from "../httpTransport";
import type { LawReference, LawSection } from "../types";
import { euActForLawCode } from "../euActRegistry";
import {
  buildEurLexFetchRequest,
  buildEurLexSectionUrl,
} from "./eurLexMapping";

export class EurLexLawProvider implements LawProvider {
  readonly id = "eur-lex";
  readonly label = "EUR-Lex";

  constructor(private readonly fetchFn: LawProviderHttpTransport) {}

  async getSection(reference: LawReference): Promise<LawSection | null> {
    const sourceUrl = buildEurLexSectionUrl(reference);
    const fetchRequest = buildEurLexFetchRequest(reference);
    if (!sourceUrl || !fetchRequest) return null;
    const act = euActForLawCode(reference.lawCode);
    if (!act) return null;

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
      lawCode: act.canonicalLawCode,
      lawTitle: textOf(firstElementByClass(html, "oj-doc-ti")) || act.officialTitle,
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
