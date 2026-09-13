import type { LawProvider } from "../LawProvider";
import { LawProviderUnavailableError } from "../errors";
import type { LawProviderHttpResponse } from "../httpTransport";
import type { LawReference, LawSection, NormattivaActMetadata } from "../types";

const DEFAULT_BASE_URL = "https://api.normattiva.it/t/normattiva.api/bff-opendata/v1";
const CODE_PATTERN = /^[0-9]{2,3}[A-Z][0-9]{4,5}$/u;
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/u;

export type CurrentDateProvider = () => string;
export type NormattivaPostTransport = (url: string, body: string) => Promise<LawProviderHttpResponse>;

export class NormattivaSourceContractError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = "NormattivaSourceContractError";
  }
}

export interface NormattivaLawCode {
  dataGU: string;
  codiceRedazionale: string;
}

export class NormattivaLawProvider implements LawProvider {
  readonly id = "normattiva";
  readonly label = "Normattiva";

  constructor(
    private readonly baseUrl = DEFAULT_BASE_URL,
    private readonly post: NormattivaPostTransport,
    private readonly currentDate: CurrentDateProvider = defaultCurrentDate,
  ) {}

  async getSection(reference: LawReference): Promise<LawSection | null> {
    if (reference.jurisdiction !== "IT") return null;
    if (reference.referenceType && reference.referenceType !== "article") return null;
    if (reference.language !== undefined && reference.language !== "it") return null;

    const identity = parseNormattivaLawCode(reference.lawCode);
    const article = parsePositiveArticle(reference.section);
    const requestedDate = this.currentDate();
    if (!identity || article === null || !isGregorianDate(requestedDate)) return null;
    const selectedAct = reference.normattivaAct;
    if (!selectedAct || !isNormattivaActMetadata(selectedAct, identity.dataGU)) return null;

    const body = JSON.stringify({
      dataGU: identity.dataGU,
      codiceRedazionale: identity.codiceRedazionale,
      idArticolo: article,
      dataVigenza: requestedDate,
    });
    const url = `${this.baseUrl}/api/v1/atto/dettaglio-atto`;

    try {
      const response = await this.post(url, body);
      if (response.status === 404) return null;
      if (response.status === 400) throw new NormattivaSourceContractError("Normattiva rejected a locally valid request.", 400);
      if (!response.ok) throw new Error(`Normattiva returned HTTP ${response.status ?? "unknown"}`);
      let value: unknown;
      try {
        value = await response.json();
      } catch {
        throw new NormattivaSourceContractError("Normattiva response payload is not valid JSON.");
      }
      const parsed = parseDetailResponse(value, selectedAct, identity.dataGU, identity.codiceRedazionale, article, requestedDate);
      return {
        providerId: this.id,
        providerLabel: this.label,
        lawCode: reference.lawCode,
        lawTitle: selectedAct.title,
        section: String(article),
        referenceType: "article",
        jurisdiction: "IT",
        language: "it",
        text: parsed.text,
        retrievedAt: new Date().toISOString(),
        validFrom: parsed.validFrom,
        ...(parsed.validTo ? { validTo: parsed.validTo } : {}),
        cacheStatus: "live",
        isOfficialSource: true,
        isAuthoritativeText: false,
      };
    } catch (error) {
      if (error instanceof LawProviderUnavailableError || error instanceof NormattivaSourceContractError) throw error;
      throw new LawProviderUnavailableError(this.id, "Normattiva lookup failed before a definitive not-found result.", error);
    }
  }
}

export function parseNormattivaLawCode(value: string): NormattivaLawCode | null {
  const match = /^normattiva:(\d{4}-\d{2}-\d{2}):([^\s:]+)$/u.exec(value);
  if (!match || !isGregorianDate(match[1]) || !CODE_PATTERN.test(match[2])) return null;
  return { dataGU: match[1], codiceRedazionale: match[2] };
}

function parsePositiveArticle(value: string): number | null {
  if (!/^\d+$/u.test(value)) return null;
  const article = Number(value);
  return Number.isSafeInteger(article) && article > 0 ? article : null;
}

export function formatLocalCalendarDate(date: Date): string {
  return `${String(date.getFullYear()).padStart(4, "0")}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function defaultCurrentDate(): string {
  return formatLocalCalendarDate(new Date());
}

function isGregorianDate(value: string): boolean {
  const match = DATE_PATTERN.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1) return false;
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return day <= daysInMonth;
}

function isNormattivaActMetadata(value: NormattivaActMetadata, dataGU: string): boolean {
  return value.title.trim() !== ""
    && value.actType.trim() !== ""
    && isGregorianDate(value.actDate)
    && Number.isSafeInteger(value.actNumber) && value.actNumber > 0
    && value.guDate === dataGU
    && (value.guNumber === undefined || (Number.isSafeInteger(value.guNumber) && value.guNumber > 0));
}

function parseDetailResponse(
  value: unknown,
  selectedAct: NormattivaActMetadata,
  expectedDataGU: string,
  expectedCodiceRedazionale: string,
  article: number,
  requestedDate: string,
): { text: string; validFrom: string; validTo?: string } {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new NormattivaSourceContractError("Normattiva response envelope malformed");
  const data = (value as { data?: unknown }).data;
  if (!data || typeof data !== "object" || Array.isArray(data)) throw new NormattivaSourceContractError("Normattiva response data missing");
  const record = data as { atto?: unknown; lista?: unknown };
  if (!record.atto || typeof record.atto !== "object" || Array.isArray(record.atto)) throw new NormattivaSourceContractError("Normattiva act missing");
  if (record.lista !== undefined && record.lista !== null && (!Array.isArray(record.lista) || record.lista.length !== 0)) {
    throw new NormattivaSourceContractError("Normattiva response is ambiguous");
  }

  const act = record.atto as Record<string, unknown>;
  const actDate = dateFromParts(act.annoProvvedimento, act.meseProvvedimento, act.giornoProvvedimento);
  const guDate = dateFromParts(act.annoGU, act.meseGU, act.giornoGU);
  const hasDataGU = act.dataGU !== undefined;
  const hasCodiceRedazionale = act.codiceRedazionale !== undefined;
  const sourceIdentityValid = hasDataGU === hasCodiceRedazionale
    && (!hasDataGU || (act.dataGU === expectedDataGU && act.codiceRedazionale === expectedCodiceRedazionale));
  if (act.titolo !== selectedAct.title
    || act.tipoProvvedimentoDescrizione !== selectedAct.actType
    || actDate !== selectedAct.actDate
    || act.numeroProvvedimento !== selectedAct.actNumber
    || guDate !== selectedAct.guDate
    || (selectedAct.guNumber !== undefined && act.numeroGU !== selectedAct.guNumber)
    || !sourceIdentityValid) {
    throw new NormattivaSourceContractError("Normattiva act identity mismatch");
  }

  const html = typeof act.articoloHtml === "string" ? act.articoloHtml : "";
  const marker = validateArticleMarker(html, article);
  const validFrom = parseCompactDate(act.articoloDataInizioVigenza);
  const endValue = act.articoloDataFineVigenza;
  const validTo = endValue === "99999999"
    ? undefined
    : parseCompactDate(endValue);
  if (!validFrom || (endValue !== "99999999" && validTo === null)
    || validFrom > requestedDate || (validTo !== undefined && validTo !== null && requestedDate > validTo)) {
    throw new NormattivaSourceContractError("Normattiva Article validity interval mismatch");
  }

  const bodyValidationText = htmlToText(html.replace(marker.markerHtml, ""));
  if (!bodyValidationText) throw new NormattivaSourceContractError("Normattiva Article text missing");
  return { text: htmlToText(html), validFrom, ...(validTo ? { validTo } : {}), ...marker };
}

function dateFromParts(year: unknown, month: unknown, day: unknown): string | null {
  if (![year, month, day].every((value) => typeof value === "number" && Number.isInteger(value))) return null;
  const result = `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  return isGregorianDate(result) ? result : null;
}

function parseCompactDate(value: unknown): string | null {
  if (typeof value !== "string" || !/^\d{8}$/u.test(value)) return null;
  const result = `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6)}`;
  return isGregorianDate(result) ? result : null;
}

function validateArticleMarker(html: string, article: number): { markerHtml: string } {
  const markerPattern = /<([a-z][\w:-]*)\b([^>]*)class=["'][^"']*\barticle-num-akn\b[^"']*["']([^>]*)>([\s\S]*?)<\/\1>/giu;
  const markers = [...html.matchAll(markerPattern)];
  const matching = markers.filter((match) => {
    const attributes = `${match[2]} ${match[3]}`;
    const id = new RegExp(`(?:^|\\s)id=["']art_${article}["']`, "u").test(attributes);
    const visible = htmlToText(match[4]).replace(/\s+/gu, " ").trim();
    return id && new RegExp(`^Art\\.?\\s*${article}$`, "u").test(visible);
  });
  if (markers.length !== 1 || matching.length !== 1) throw new NormattivaSourceContractError("Normattiva Article marker mismatch");
  return { markerHtml: matching[0][0] };
}

function htmlToText(html: string): string {
  return decodeEntities(html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/giu, "")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/giu, "")
    .replace(/<br\s*\/?>/giu, "\n")
    .replace(/<\/(?:div|p|h[1-6]|li|tr|section|article)>/giu, "\n")
    .replace(/<[^>]+>/gu, ""))
    .split("\n")
    .map((line) => line.replace(/\s+/gu, " ").trim())
    .filter(Boolean)
    .join("\n")
    .trim();
}

function decodeEntities(value: string): string {
  const named: Record<string, string> = { amp: "&", apos: "'", gt: ">", lt: "<", quot: '"', nbsp: " ", agrave: "à", egrave: "è", igrave: "ì", ograve: "ò", ugrave: "ù", eacute: "é", ocirc: "ô" };
  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/giu, (full, entity: string) => {
    if (entity.toLowerCase().startsWith("#x")) return String.fromCodePoint(Number.parseInt(entity.slice(2), 16));
    if (entity.startsWith("#")) return String.fromCodePoint(Number(entity.slice(1)));
    return named[entity.toLowerCase()] ?? full;
  });
}
