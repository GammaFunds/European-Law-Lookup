import type { LawMetadataSearchEntry } from "../lawMetadataSearch";
import type { LawProviderHttpTransport } from "../httpTransport";
import { LawDiscoveryMalformedResponseError, LawDiscoveryUnavailableError, type LawDiscoveryProvider, type LawDiscoveryResult } from "../LawDiscovery";

const DEFAULT_URL = "https://zoekservice.overheid.nl/sru/Search";
const BWBR = /^BWBR\d{7}$/u;
const MAX_RESULTS = 8;

export class BwbLawDiscovery implements LawDiscoveryProvider {
  readonly jurisdiction = "NL" as const;
  readonly sourceLabel = "BWB / Wetten.nl";
  constructor(private readonly fetchFn: LawProviderHttpTransport, private readonly baseUrl = DEFAULT_URL) {}

  async search(query: string): Promise<LawDiscoveryResult> {
    const value = query.trim().replace(/\s+/gu, " ");
    if (value.length < 2) return { kind: "no-results", entries: [] };
    const direct = value.toUpperCase();
    const cql = BWBR.test(direct) ? `dcterms.identifier==${direct}` : `titel=${quote(value)}`;
    const url = this.url(cql);
    const response = await this.request(url);
    if (response.status === 404) return { kind: "no-results", entries: [] };
    if (!response.ok) throw new LawDiscoveryUnavailableError(`BWB discovery failed: HTTP ${response.status ?? "unknown"}`);
    const xml = await this.read(response);
    const records = parseSru(xml);
    const entries: LawMetadataSearchEntry[] = [];
    const seen = new Set<string>();
    for (const record of records) {
      if (BWBR.test(direct) && record.id !== direct) throw new LawDiscoveryMalformedResponseError("BWB direct identity mismatch");
      const existing = entries.find((entry) => entry.canonicalInput === record.id);
      if (existing && (existing.title !== record.title || existing.sourceUrl !== record.locator)) throw new LawDiscoveryMalformedResponseError("BWB duplicate identity conflicted");
      if (seen.has(record.id)) continue;
      seen.add(record.id);
      entries.push({ jurisdiction: "NL", canonicalInput: record.id, title: record.title, sourceUrl: record.locator });
      if (entries.length === MAX_RESULTS) break;
    }
    return entries.length ? { kind: "results", entries } : { kind: "no-results", entries: [] };
  }

  private url(query: string): string {
    return `${this.baseUrl}?operation=searchRetrieve&version=2.0&x-connection=BWB&query=${encodeURIComponent(query)}&maximumRecords=${MAX_RESULTS}`;
  }
  private async request(url: string) {
    try { return await this.fetchFn(url, { headers: { Accept: "application/xml" } }); }
    catch { throw new LawDiscoveryUnavailableError(`BWB discovery unavailable: ${url}`); }
  }
  private async read(response: { text(): Promise<string> }): Promise<string> {
    try { return await response.text(); } catch { throw new LawDiscoveryMalformedResponseError("BWB discovery XML was unreadable"); }
  }
}

interface SruRecord { id: string; title: string; locator?: string; }
function parseSru(xml: string): SruRecord[] {
  const root = parseXml(xml);
  if (root.name !== "searchRetrieveResponse") throw new LawDiscoveryMalformedResponseError("BWB SRU root was malformed");
  const number = childText(root, "numberOfRecords");
  if (!/^\d+$/u.test(number)) throw new LawDiscoveryMalformedResponseError("BWB SRU result count was malformed");
  const records = descendants(root, "record").map((record) => {
    const id = childText(record, "identifier");
    const title = childText(record, "title").trim();
    const locator = childText(record, "locatie_toestand").trim();
    if (!BWBR.test(id) || !title) throw new LawDiscoveryMalformedResponseError("BWB SRU identity or title was missing");
    if (locator && !/^https:\/\/repository\.officiele-overheidspublicaties\.nl\/bwb\/BWBR\d{7}\/[\w-]+\/xml\/BWBR\d{7}_[\w-]+\.xml$/u.test(locator)) throw new LawDiscoveryMalformedResponseError("BWB toestand locator was malformed");
    const locatorId = locator?.match(/\/bwb\/(BWBR\d{7})\//u)?.[1];
    if (locator && locatorId !== id) throw new LawDiscoveryMalformedResponseError("BWB locator identity mismatch");
    return { id, title, ...(locator ? { locator } : {}) };
  });
  if (Number(number) > 0 && records.length === 0) throw new LawDiscoveryMalformedResponseError("BWB SRU records were missing");
  return records;
}

interface XmlNode { name: string; attrs: Record<string,string>; children: XmlNode[]; text: string; }
function parseXml(xml: string): XmlNode { const top: XmlNode={name:"#root",attrs:{},children:[],text:""}; const stack=[top]; const token= /<!--[\s\S]*?-->|<\?[^>]*>|<![^>]*>|<[^>]+>|[^<]+/gu; for(const m of xml.matchAll(token)){const t=m[0]; if(t.startsWith("<!--")||t.startsWith("<?")||t.startsWith("<!"))continue; if(t.startsWith("</")){if(stack.length===1||stack.pop()!.name!==local(t.slice(2,-1).trim()))throw new LawDiscoveryMalformedResponseError("BWB XML was malformed");} else if(t.startsWith("<")){const self=/\/\s*>$/u.test(t); const body=t.slice(1,t.length-(self?2:1)).trim(); const n=/^([^\s/>]+)/u.exec(body); if(!n)throw new LawDiscoveryMalformedResponseError("BWB XML was malformed"); const node:XmlNode={name:local(n[1]),attrs:attrs(body.slice(n[0].length)),children:[],text:""}; stack.at(-1)!.children.push(node); if(!self)stack.push(node);} else {if(stack.length===1&&/\S/u.test(t))throw new LawDiscoveryMalformedResponseError("BWB XML was malformed"); stack.at(-1)!.text+=decode(t);}} if(stack.length!==1||top.children.length!==1)throw new LawDiscoveryMalformedResponseError("BWB XML was malformed"); return top.children[0]; }
function attrs(value:string):Record<string,string>{const out:Record<string,string>={}; for(const m of value.matchAll(/([^\s=]+)\s*=\s*(["'])(.*?)\2/gu))out[local(m[1])]=decode(m[3]); return out;}
function local(value:string){const i=value.indexOf(":");return i<0?value:value.slice(i+1);}
function decode(value:string){return value.replace(/&amp;/gu,"&").replace(/&lt;/gu,"<").replace(/&gt;/gu,">").replace(/&quot;/gu,'"').replace(/&apos;/gu,"'");}
function descendants(node:XmlNode,name:string):XmlNode[]{return node.children.flatMap(c=>[...(c.name===name?[c]:[]),...descendants(c,name)]);}
function childText(node:XmlNode,name:string):string{const found=descendants(node,name); return found.length===1?textOf(found[0]):found.length===0?"":found.map(textOf).join("\u0000");}
function textOf(node:XmlNode):string{return `${node.text} ${node.children.map(textOf).join(" ")}`.replace(/\s+/gu," ").trim();}
function quote(value:string){return `"${value.replace(/"/gu,'\\"')}"`;}
