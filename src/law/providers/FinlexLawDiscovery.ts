import type { LawMetadataSearchEntry } from "../lawMetadataSearch";
import type { LawProviderHttpTransport } from "../httpTransport";
import { LawDiscoveryMalformedResponseError, LawDiscoveryUnavailableError, type LawDiscoveryProvider, type LawDiscoveryResult } from "../LawDiscovery";
import { parseFinlexAkn } from "./FinlexLawProvider";

const DEFAULT_BASE_URL = "https://opendata.finlex.fi/finlex/avoindata/v1";
const USER_AGENT = "obsidian-de-law/ELL-FI-PROVIDER-CORE-1 (contact: miko)";

export class FinlexLawDiscovery implements LawDiscoveryProvider {
  readonly jurisdiction = "FI" as const;
  readonly sourceLabel = "Finlex";

  constructor(private readonly fetchFn: LawProviderHttpTransport, private readonly baseUrl = DEFAULT_BASE_URL) {}

  async search(query: string): Promise<LawDiscoveryResult> {
    const normalized = query.trim();
    if (normalized.length < 2) return { kind: "no-results", entries: [] };
    const directIdentity = parseDirectLawCode(normalized);
    if (directIdentity) return this.searchDirectIdentity(directIdentity.year, directIdentity.number);
    const url = `${this.baseUrl}/akn/fi/act/statute-consolidated/list?format=json&page=1&limit=8&langAndVersion=fin%40latest&titleContains=${encodeURIComponent(normalized)}&isInForce=true`;
    const listResponse = await this.request(url, "application/json");
    if (listResponse.status === 404) return { kind: "no-results", entries: [] };
    if (!listResponse.ok) throw new LawDiscoveryUnavailableError(`Finlex discovery request failed: ${url}`);
    let value: unknown;
    try { value = await listResponse.json(); } catch { throw new LawDiscoveryMalformedResponseError("Finlex discovery JSON was malformed"); }
    if (!Array.isArray(value)) throw new LawDiscoveryMalformedResponseError("Finlex discovery response was not an array");
    const entries: LawMetadataSearchEntry[] = [];
    for (const item of value.slice(0, 8)) {
      if (!item || typeof item !== "object" || typeof (item as { akn_uri?: unknown }).akn_uri !== "string") throw new LawDiscoveryMalformedResponseError("Finlex discovery entry was malformed");
      const sourceUrl = (item as { akn_uri: string }).akn_uri;
      const match = new RegExp(`^${escapeRegExp(this.baseUrl)}\\/akn\\/fi\\/act\\/statute-consolidated\\/((?!0000)\\d{4})\\/([1-9]\\d{0,5})\\/(fin)@[0-9A-Za-z]*$`, "u").exec(sourceUrl);
      if (!match) throw new LawDiscoveryMalformedResponseError("Finlex discovery URI was malformed");
      const response = await this.request(sourceUrl, "application/xml");
      if (!response.ok) throw new LawDiscoveryUnavailableError(`Finlex metadata request failed: ${sourceUrl}`);
      let xml: string;
      try { xml = await response.text(); } catch { throw new LawDiscoveryMalformedResponseError("Finlex metadata XML was unreadable"); }
      let document;
      try { document = parseFinlexAkn(xml, match[1], match[2], "fin"); } catch { throw new LawDiscoveryMalformedResponseError("Finlex metadata identity was malformed"); }
      entries.push({ jurisdiction: "FI", canonicalInput: `${document.number}/${document.year}`, title: document.title, sourceUrl, year: document.year, number: document.number } as LawMetadataSearchEntry);
    }
    return entries.length === 0 ? { kind: "no-results", entries: [] } : { kind: "results", entries };
  }

  private async searchDirectIdentity(year: string, number: string): Promise<LawDiscoveryResult> {
    const sourceUrl = `${this.baseUrl}/akn/fi/act/statute-consolidated/${year}/${number}/fin@latest`;
    const response = await this.request(sourceUrl, "application/xml");
    if (response.status === 404) return { kind: "no-results", entries: [] };
    if (!response.ok) throw new LawDiscoveryUnavailableError(`Finlex metadata request failed: ${sourceUrl}`);
    let xml: string;
    try { xml = await response.text(); } catch { throw new LawDiscoveryMalformedResponseError("Finlex metadata XML was unreadable"); }
    let document;
    try { document = parseFinlexAkn(xml, year, number, "fin"); } catch { throw new LawDiscoveryMalformedResponseError("Finlex metadata identity was malformed"); }
    return {
      kind: "results",
      entries: [{ jurisdiction: "FI", canonicalInput: `${document.number}/${document.year}`, title: document.title, sourceUrl, year: document.year, number: document.number } as LawMetadataSearchEntry],
    };
  }

  private async request(url: string, accept: string) {
    try { return await this.fetchFn(url, { headers: { Accept: accept, "User-Agent": USER_AGENT } }); }
    catch { throw new LawDiscoveryUnavailableError(`Finlex request failed: ${url}`); }
  }
}

function escapeRegExp(value: string): string { return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"); }

function parseDirectLawCode(value: string): { year: string; number: string } | null {
  const match = /^([1-9]\d{0,5})\/((?!0000)\d{4})$/u.exec(value);
  return match ? { number: match[1], year: match[2] } : null;
}
