import type { LawMetadataSearchEntry } from "../lawMetadataSearch";
import type { NormattivaActMetadata } from "../types";
import type { LawProviderHttpResponse } from "../httpTransport";
import {
  LawDiscoveryMalformedResponseError,
  LawDiscoveryUnavailableError,
  type LawDiscoveryProvider,
  type LawDiscoveryResult,
} from "../LawDiscovery";
import { parseNormattivaLawCode, type NormattivaPostTransport } from "./NormattivaLawProvider";

const DEFAULT_BASE_URL = "https://api.normattiva.it/t/normattiva.api/bff-opendata/v1";
const MAX_RESULTS = 8;

export class NormattivaLawDiscovery implements LawDiscoveryProvider {
  readonly jurisdiction = "IT" as const;
  readonly sourceLabel = "Normattiva";

  constructor(
    private readonly post: NormattivaPostTransport,
    private readonly baseUrl = DEFAULT_BASE_URL,
  ) {}

  async search(query: string): Promise<LawDiscoveryResult> {
    const normalized = query.trim().replace(/\s+/gu, " ");
    if (normalized.length < 2) return { kind: "no-results", entries: [] };
    const url = `${this.baseUrl}/api/v1/ricerca/semplice`;
    let response: LawProviderHttpResponse;
    try {
      response = await this.post(url, JSON.stringify({
        testoRicerca: normalized,
        paginazione: { paginaCorrente: 1, numeroElementiPerPagina: MAX_RESULTS },
      }));
    } catch {
      throw new LawDiscoveryUnavailableError("Normattiva discovery source is unavailable.");
    }
    if (!response.ok) throw new LawDiscoveryUnavailableError(`Normattiva discovery source unavailable: HTTP ${response.status ?? "unknown"}.`);

    let value: unknown;
    try {
      value = await response.json();
    } catch {
      throw new LawDiscoveryMalformedResponseError("Normattiva discovery returned invalid JSON.");
    }
    const candidates = extractCandidates(value);
    const entries: LawMetadataSearchEntry[] = [];
    for (const candidate of candidates) {
      const parsed = parseCandidate(candidate);
      if (parsed) entries.push(parsed);
      if (entries.length === MAX_RESULTS) break;
    }
    return entries.length === 0 ? { kind: "no-results", entries: [] } : { kind: "results", entries };
  }
}

function extractCandidates(value: unknown): unknown[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new LawDiscoveryMalformedResponseError("Normattiva discovery response envelope is malformed.");
  }
  const root = value as Record<string, unknown>;
  const data = root.data;
  const list = Array.isArray(data)
    ? data
    : data && typeof data === "object" && !Array.isArray(data)
      ? firstArray(data as Record<string, unknown>, ["lista", "risultati", "results", "atti"])
      : firstArray(root, ["listaAtti", "lista", "risultati", "results", "atti"]);
  if (!list) throw new LawDiscoveryMalformedResponseError("Normattiva discovery result list is malformed.");
  return list;
}

function firstArray(value: Record<string, unknown>, keys: string[]): unknown[] | null {
  for (const key of keys) if (Array.isArray(value[key])) return value[key] as unknown[];
  return null;
}

function parseCandidate(value: unknown): LawMetadataSearchEntry | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const source = value as Record<string, unknown>;
  const act = source.atto && typeof source.atto === "object" && !Array.isArray(source.atto)
    ? source.atto as Record<string, unknown>
    : source;
  const dataGU = stringValue(source.dataGU) ?? stringValue(act.dataGU);
  const code = stringValue(source.codiceRedazionale) ?? stringValue(act.codiceRedazionale);
  const identity = dataGU && code ? parseNormattivaLawCode(`normattiva:${dataGU}:${code}`) : null;
  const title = stringValue(source.titoloAtto) ?? stringValue(source.titolo) ?? stringValue(source.title) ?? stringValue(act.titolo) ?? stringValue(act.title);
  const formalTitle = stringValue(source.descrizioneAtto);
  const actType = stringValue(source.denominazioneAtto) ?? stringValue(source.tipoProvvedimentoDescrizione) ?? stringValue(act.tipoProvvedimentoDescrizione);
  const actDate = dateString(source.dataEmanazione) ?? dateString(source.dataAtto) ?? dateString(source.dataProvvedimento) ?? dateString(act.dataAtto) ?? dateString(act.dataProvvedimento)
    ?? dateFromParts(source, "annoProvvedimento", "meseProvvedimento", "giornoProvvedimento")
    ?? dateFromParts(act, "annoProvvedimento", "meseProvvedimento", "giornoProvvedimento");
  const actNumber = numberValue(source.numeroProvvedimento) ?? numberValue(act.numeroProvvedimento);
  const guNumber = numberValue(source.numeroGU) ?? numberValue(act.numeroGU);
  if (!identity || !title?.trim() || !formalTitle?.trim() || !actType?.trim() || !actDate || actNumber === null || !isGregorianDate(actDate)) return null;
  const metadata: NormattivaActMetadata = {
    title: formalTitle.trim(),
    actType: actType.trim(),
    actDate,
    actNumber,
    guDate: identity.dataGU,
    ...(guNumber === null ? {} : { guNumber }),
  };
  return {
    jurisdiction: "IT",
    canonicalInput: `normattiva:${identity.dataGU}:${identity.codiceRedazionale}`,
    title: title.trim(),
    normattivaAct: metadata,
  };
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function dateString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  return value.slice(0, 10);
}

function numberValue(value: unknown): number | null {
  const number = typeof value === "number" ? value : typeof value === "string" && /^\d+$/u.test(value) ? Number(value) : NaN;
  return Number.isSafeInteger(number) && number > 0 ? number : null;
}

function dateFromParts(value: Record<string, unknown>, yearKey: string, monthKey: string, dayKey: string): string | null {
  const year = value[yearKey];
  const month = value[monthKey];
  const day = value[dayKey];
  if (![year, month, day].every((part) => typeof part === "number" && Number.isInteger(part))) return null;
  const result = `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  return isGregorianDate(result) ? result : null;
}

function isGregorianDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  return month >= 1 && month <= 12 && day >= 1 && day <= new Date(Date.UTC(year, month, 0)).getUTCDate();
}
