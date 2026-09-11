import type { LawMetadataSearchEntry } from "../lawMetadataSearch";
import type { LawProviderHttpTransport } from "../httpTransport";

const DEFAULT_SEARCH_URL = "https://www.boe.es/datosabiertos/api/legislacion-consolidada";
const BOE_ID = /^BOE-A-(\d{4})-(\d{1,5})$/i;
const COMPLETE_LAW_NUMBER = /^\d+\/\d{4}$/;
const BARE_NUMERIC_TOKEN = /^\d+$/;
const MAX_RESULTS = 8;
const MIN_QUERY_LENGTH = 2;

export interface BoeLawDiscoveryResult {
  kind: "results" | "no-results";
  entries: LawMetadataSearchEntry[];
}

export class BoeLawDiscoveryUnavailableError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message);
    if (options?.cause !== undefined) (this as Error & { cause?: unknown }).cause = options.cause;
    this.name = "BoeLawDiscoveryUnavailableError";
  }
}

export class BoeLawDiscoveryMalformedResponseError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message);
    if (options?.cause !== undefined) (this as Error & { cause?: unknown }).cause = options.cause;
    this.name = "BoeLawDiscoveryMalformedResponseError";
  }
}

export class BoeLawDiscovery {
  constructor(
    private readonly fetchFn: LawProviderHttpTransport,
    private readonly searchUrl = DEFAULT_SEARCH_URL,
  ) {}

  async search(query: string): Promise<BoeLawDiscoveryResult> {
    const normalizedQuery = query.trim().replace(/\s+/g, " ");
    if (normalizedQuery.length < MIN_QUERY_LENGTH) {
      return { kind: "no-results", entries: [] };
    }

    const url = this.buildSearchUrl(normalizedQuery);
    let response;
    try {
      response = await this.fetchFn(url, { headers: { Accept: "application/json" } });
    } catch (error) {
      throw new BoeLawDiscoveryUnavailableError("BOE discovery source is unavailable.", { cause: error });
    }

    if (!response.ok) {
      throw new BoeLawDiscoveryUnavailableError(
        `BOE discovery source returned HTTP ${response.status ?? "unknown"}.`,
      );
    }

    let value: unknown;
    try {
      value = await response.json();
    } catch (error) {
      throw new BoeLawDiscoveryMalformedResponseError("BOE discovery returned invalid JSON.", { cause: error });
    }

    return this.parseResponse(value);
  }

  private buildSearchUrl(query: string): string {
    const url = new URL(this.searchUrl);
    url.searchParams.set("query", JSON.stringify({
      query: {
        query_string: {
          query: buildTitleQuery(query),
        },
      },
    }));
    url.searchParams.set("offset", "0");
    url.searchParams.set("limit", String(MAX_RESULTS));
    return url.toString();
  }

  private parseResponse(value: unknown): BoeLawDiscoveryResult {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new BoeLawDiscoveryMalformedResponseError("BOE discovery response envelope is malformed.");
    }

    const root = value as { status?: unknown; data?: unknown };
    this.validateStatus(root.status);
    if (root.data === "" || isEmptyObject(root.data)) return { kind: "no-results", entries: [] };
    if (!Array.isArray(root.data)) {
      throw new BoeLawDiscoveryMalformedResponseError("BOE discovery response data is malformed.");
    }

    const seenIds = new Set<string>();
    const entries: LawMetadataSearchEntry[] = [];
    for (const item of root.data) {
      const entry = this.parseEntry(item);
      if (seenIds.has(entry.canonicalInput)) continue;
      seenIds.add(entry.canonicalInput);
      entries.push(entry);
    }

    const limitedEntries = entries.slice(0, MAX_RESULTS);
    return limitedEntries.length > 0
      ? { kind: "results", entries: limitedEntries }
      : { kind: "no-results", entries: [] };
  }

  private validateStatus(value: unknown): void {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new BoeLawDiscoveryMalformedResponseError("BOE discovery response status is malformed.");
    }
    const code = (value as { code?: unknown }).code;
    if (code !== "200" && code !== 200) {
      throw new BoeLawDiscoveryMalformedResponseError("BOE discovery response status is not successful.");
    }
  }

  private parseEntry(value: unknown): LawMetadataSearchEntry {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new BoeLawDiscoveryMalformedResponseError("BOE discovery result is malformed.");
    }
    const item = value as { identificador?: unknown; titulo?: unknown; url_html_consolidada?: unknown };
    if (typeof item.identificador !== "string") {
      throw new BoeLawDiscoveryMalformedResponseError("BOE discovery result is missing its identifier.");
    }
    const canonicalInput = item.identificador.trim().toUpperCase();
    if (!BOE_ID.test(canonicalInput)) {
      throw new BoeLawDiscoveryMalformedResponseError("BOE discovery result contains an invalid identifier.");
    }
    if (typeof item.titulo !== "string" || !item.titulo.trim()) {
      throw new BoeLawDiscoveryMalformedResponseError("BOE discovery result is missing its title.");
    }
    if (typeof item.url_html_consolidada !== "string" || !isOfficialBoeUrl(item.url_html_consolidada, canonicalInput)) {
      throw new BoeLawDiscoveryMalformedResponseError("BOE discovery result contains an invalid official URL.");
    }

    return {
      jurisdiction: "ES",
      canonicalInput,
      title: item.titulo.trim(),
      aliases: [canonicalInput],
      sourceUrl: item.url_html_consolidada,
    };
  }
}

function isEmptyObject(value: unknown): boolean {
  return value !== null
    && typeof value === "object"
    && !Array.isArray(value)
    && Object.keys(value).length === 0;
}

function isOfficialBoeUrl(value: string, id: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:"
      && url.hostname === "www.boe.es"
      && url.port === ""
      && url.username === ""
      && url.password === ""
      && url.pathname === "/buscar/act.php"
      && url.hash === ""
      && url.searchParams.get("id") === id
      && [...url.searchParams.keys()].length === 1;
  } catch {
    return false;
  }
}

function escapeQuery(value: string): string {
  return value.replace(/[+\-=&|><!(){}[\]^"~*?:\\/]/g, "\\$&");
}

function buildTitleQuery(query: string): string {
  return query.split(" ").map((token) => {
    if (COMPLETE_LAW_NUMBER.test(token)) return `numero_oficial:${escapeQuery(token)}`;
    if (BARE_NUMERIC_TOKEN.test(token)) return `titulo:${escapeQuery(token)}*`;
    return `titulo:${escapeQuery(token)}`;
  }).join(" AND ");
}
