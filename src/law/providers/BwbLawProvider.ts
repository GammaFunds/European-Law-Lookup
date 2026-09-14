import type { LawProvider } from "../LawProvider";
import { LawProviderUnavailableError } from "../errors";
import type { LawProviderHttpTransport } from "../httpTransport";
import type { LawReference, LawSection } from "../types";

const DEFAULT_URL = "https://zoekservice.overheid.nl/sru/Search";
const BWBR = /^BWBR\d{7}$/u;
const ARTICLE = /^\d+(?:[:.]\d+|[A-Za-z])?$/u;

export class BwbLawProvider implements LawProvider {
  readonly id = "bwb";
  readonly label = "BWB / Wetten.nl";
  constructor(private readonly baseUrl = DEFAULT_URL, private readonly fetchFn: LawProviderHttpTransport, private readonly currentDate: () => string = () => new Date().toISOString().slice(0, 10)) {}

  async getSection(reference: LawReference): Promise<LawSection | null> {
    if (reference.jurisdiction !== "NL" || (reference.referenceType && reference.referenceType !== "article") || (reference.language !== undefined && reference.language !== "nl")) return null;
    const lawCode = reference.lawCode.toUpperCase();
    if (!BWBR.test(lawCode) || !ARTICLE.test(reference.section)) return null;
    const date = this.currentDate();
    if (!isDate(date)) return null;
    const query = `(identifier=${lawCode} and geldigheidsdatum=${date} and zichtdatum=${date})`;
    const discoveryUrl = `${this.baseUrl}?operation=searchRetrieve&version=2.0&x-connection=BWB&query=${encodeURIComponent(query)}&maximumRecords=8`;
    try {
      const discovery = await this.request(discoveryUrl);
      if (discovery.status === 404) return null;
      if (!discovery.ok) throw new Error(`BWB SRU HTTP ${discovery.status ?? "unknown"}`);
      const state = parseState(await discovery.text(), lawCode, date);
      if (!state) return null;
      const textResponse = await this.request(state.locator);
      if (textResponse.status === 404) return null;
      if (!textResponse.ok) throw new Error(`BWB toestand HTTP ${textResponse.status ?? "unknown"}`);
      const document = parseToestand(await textResponse.text(), lawCode, state.toestand);
      const requestedLabel = `Artikel ${reference.section.replace(/[A-Z]$/u, (suffix) => suffix.toLowerCase())}`;
      const articles = descendants(document, "artikel").filter((node) => node.attrs.label === requestedLabel);
      if (articles.length !== 1) return null;
      const text = descendants(articles[0], "al").map(nodeText).join("\n").trim();
      if (!text) throw new Error("BWB Article text missing");
      return { providerId: this.id, providerLabel: this.label, sourceUrl: state.locator, lawCode, lawTitle: state.title, section: articles[0].attrs.label, referenceType: "article", jurisdiction: "NL", language: "nl", text, retrievedAt: new Date().toISOString(), cacheStatus: "live", isOfficialSource: true, isAuthoritativeText: false };
    } catch (error) {
      if (error instanceof LawProviderUnavailableError) throw error;
      throw new LawProviderUnavailableError(this.id, "BWB lookup failed before a definitive not-found result.", error);
    }
  }

  private async request(url: string) { try { return await this.fetchFn(url, { headers: { Accept: "application/xml" } }); } catch (error) { throw new LawProviderUnavailableError(this.id, `BWB request failed: ${url}`, error); } }
}

interface Node { name: string; attrs: Record<string,string>; children: Node[]; text: string; }
interface State { title: string; toestand: string; locator: string; }
function parseState(xml: string, expected: string, date: string): State | null { const root=parseXml(xml); const records=descendants(root,"record"); if (records.length === 0) return null; const states=records.map(record=>{const id=childText(record,"identifier"); const title=childText(record,"title"); const toestand=childText(record,"toestand"); const locator=childText(record,"locatie_toestand"); if(id!==expected||!title||!toestand||!locator)throw new Error("BWB current state metadata missing"); const stateMatch=toestand.match(/\/id\/(BWBR\d{7})\/(\d{4}-\d{2}-\d{2})\/(\d+)$/u); const locatorMatch=locator.match(/\/bwb\/(BWBR\d{7})\/(\d{4}-\d{2}-\d{2})_(\d+)\/xml\/BWBR\d{7}_(\d{4}-\d{2}-\d{2})_(\d+)\.xml$/u); if(!stateMatch||!locatorMatch||stateMatch[1]!==expected||locatorMatch[1]!==expected||stateMatch[2]!==locatorMatch[2]||stateMatch[3]!==locatorMatch[3]||locatorMatch[2]!==locatorMatch[4]||locatorMatch[3]!==locatorMatch[5])throw new Error("BWB current state identity mismatch"); const start=childText(record,"geldigheidsperiode_startdatum"); const end=childText(record,"geldigheidsperiode_einddatum"); const visibleStart=childText(record,"zichtperiode_startdatum"); const visibleEnd=childText(record,"zichtperiode_einddatum"); if(!isDate(start)||!isDate(end)||!isDate(visibleStart)||!isDate(visibleEnd)||date<start||date>end||date<visibleStart||date>visibleEnd)throw new Error("BWB current state date metadata mismatch"); return {title,toestand,locator}; }); if (states.length !== 1) throw new Error("BWB current state was ambiguous"); return states[0]; }
function parseToestand(xml: string, expected: string, expectedState: string): Node { const root=parseXml(xml); if(root.name!=="toestand"||root.attrs["bwb-id"]!==expected||root.attrs["bwb-ng-vast-deel"]!==expectedState)throw new Error("BWB toestand identity mismatch"); const languages=descendants(root,"wetgeving").map(n=>n.attrs["xml:lang"]??n.attrs.lang).filter(Boolean); if(languages.length!==1||languages[0]!=="nl")throw new Error("BWB language metadata mismatch"); return root; }
function parseXml(xml:string):Node { const top:Node={name:"#root",attrs:{},children:[],text:""}; const stack=[top]; const token=/<!--[\s\S]*?-->|<\?[^>]*>|<![^>]*>|<[^>]+>|[^<]+/gu; for(const m of xml.matchAll(token)){const t=m[0];if(t.startsWith("<!--")||t.startsWith("<?")||t.startsWith("<!"))continue;if(t.startsWith("</")){if(stack.length===1||stack.pop()!.name!==local(t.slice(2,-1).trim()))throw new Error("BWB XML malformed");}else if(t.startsWith("<")){const self=/\/\s*>$/u.test(t),body=t.slice(1,t.length-(self?2:1)).trim(),name=/^([^\s/>]+)/u.exec(body);if(!name)throw new Error("BWB XML malformed");const node:Node={name:local(name[1]),attrs:attrs(body.slice(name[0].length)),children:[],text:""};stack.at(-1)!.children.push(node);if(!self)stack.push(node);}else{if(stack.length===1&&/\S/u.test(t))throw new Error("BWB XML malformed");stack.at(-1)!.text+=decode(t);}}if(stack.length!==1||top.children.length!==1)throw new Error("BWB XML malformed");return top.children[0]; }
function attrs(v:string){const o:Record<string,string>={};for(const m of v.matchAll(/([^\s=]+)\s*=\s*(["'])(.*?)\2/gu))o[local(m[1])]=decode(m[3]);return o;}
function local(v:string){const i=v.indexOf(":");return i<0?v:v.slice(i+1);}
function decode(v:string){return v.replace(/&amp;/gu,"&").replace(/&lt;/gu,"<").replace(/&gt;/gu,">").replace(/&quot;/gu,'"').replace(/&apos;/gu,"'");}
function descendants(n:Node,name:string):Node[]{return n.children.flatMap(c=>[...(c.name===name?[c]:[]),...descendants(c,name)]);}
function childText(n:Node,name:string){const found=descendants(n,name);return found.length===1?nodeText(found[0]):found.length?found.map(nodeText).join("\u0000"):"";}
function nodeText(n:Node):string{return `${n.text} ${n.children.map(nodeText).join(" ")}`.replace(/\s+/gu," ").trim();}
function isDate(value: string): boolean { const match=/^(\d{4})-(\d{2})-(\d{2})$/u.exec(value); if(!match)return false; const year=Number(match[1]); const month=Number(match[2]); const day=Number(match[3]); if(year===0||month<1||month>12||day<1)return false; const leap=year%4===0&&(year%100!==0||year%400===0); const days=[31,leap?29:28,31,30,31,30,31,31,30,31,30,31]; return day<=days[month-1]; }
