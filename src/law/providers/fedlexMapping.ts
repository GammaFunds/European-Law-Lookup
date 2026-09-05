import type { LawReference, LawSection } from "../types";

interface SwissLawConfig {
  workUri: string;
  lawTitle: string;
  displayLawCode: string;
  exampleInputs?: readonly string[];
}

export interface OfficialTitlesByLanguage {
  de: string;
  fr: string;
  it: string;
}

const officialTitlesByWorkUri: Readonly<Record<string, OfficialTitlesByLanguage>> = {
  "https://fedlex.data.admin.ch/eli/cc/11/529_488_529": { de: "Bundesgesetz vom 11. April 1889 über Schuldbetreibung und Konkurs (SchKG)", fr: "Loi fédérale du 11 avril 1889 sur la poursuite pour dettes et la faillite (LP)", it: "Legge federale dell'11 aprile 1889 sulla esecuzione e sul fallimento (LEF)" },
  "https://fedlex.data.admin.ch/eli/cc/1955/871_893_899": { de: "Bundesgesetz vom 25. Juni 1954 über die Erfindungspatente (Patentgesetz, PatG)", fr: "Loi fédérale du 25 juin 1954 sur les brevets d'invention (Loi sur les brevets, LBI)", it: "Legge federale del 25 giugno 1954 sui brevetti d'invenzione (Legge sui brevetti, LBI)" },
  "https://fedlex.data.admin.ch/eli/cc/1959/679_705_685": { de: "Strassenverkehrsgesetz vom 19. Dezember 1958 (SVG)", fr: "Loi fédérale du 19 décembre 1958 sur la circulation routière (LCR)", it: "Legge federale del 19 dicembre 1958 sulla circolazione stradale (LCStr)" },
  "https://fedlex.data.admin.ch/eli/cc/1959/827_857_845": { de: "Bundesgesetz vom 19. Juni 1959 über die Invalidenversicherung (IVG)", fr: "Loi fédérale du 19 juin 1959 sur l'assurance-invalidité (LAI)", it: "Legge federale del 19 giugno 1959 sull’assicurazione per l’invalidità (LAI)" },
  "https://fedlex.data.admin.ch/eli/cc/1966/57_57_57": { de: "Bundesgesetz vom 13. März 1964 über die Arbeit in Industrie, Gewerbe und Handel (Arbeitsgesetz, ArG)", fr: "Loi fédérale du 13 mars 1964 sur le travail dans l'industrie, l'artisanat et le commerce (Loi sur le travail, LTr)", it: "Legge federale del 13 marzo 1964 sul lavoro nell'industria, nell'artigianato e nel commercio (Legge sul lavoro, LL)" },
  "https://fedlex.data.admin.ch/eli/cc/1969/737_757_755": { de: "Bundesgesetz vom 20. Dezember 1968 über das Verwaltungsverfahren (Verwaltungsverfahrensgesetz, VwVG)", fr: "Loi fédérale du 20 décembre 1968 sur la procédure administrative (PA)", it: "Legge federale del 20 dicembre 1968 sulla procedura amministrativa (PA)" },
  "https://fedlex.data.admin.ch/eli/cc/1988/1776_1776_1776": { de: "Bundesgesetz vom 18. Dezember 1987 über das Internationale Privatrecht (IPRG)", fr: "Loi fédérale du 18 décembre 1987 sur le droit international privé (LDIP)", it: "Legge federale del 18 dicembre 1987 sul diritto internazionale privato (LDIP)" },
  "https://fedlex.data.admin.ch/eli/cc/1991/1184_1184_1184": { de: "Bundesgesetz vom 14. Dezember 1990 über die direkte Bundessteuer (DBG)", fr: "Loi fédérale du 14 décembre 1990 sur l'impôt fédéral direct (LIFD)", it: "Legge federale del 14 dicembre 1990 sull'imposta federale diretta (LIFD)" },
  "https://fedlex.data.admin.ch/eli/cc/1991/1256_1256_1256": { de: "Bundesgesetz vom 14. Dezember 1990 über die Harmonisierung der direkten Steuern der Kantone und Gemeinden (Steuerharmonisierungsgesetz, StHG)", fr: "Loi fédérale du 14 décembre 1990 sur l'harmonisation des impôts directs des cantons et des communes (LHID)", it: "Legge federale del 14 dicembre 1990 sull'armonizzazione delle imposte dirette dei Cantoni e dei Comuni (LAID)" },
  "https://fedlex.data.admin.ch/eli/cc/1993/1798_1798_1798": { de: "Bundesgesetz vom 9. Oktober 1992 über das Urheberrecht und verwandte Schutzrechte (Urheberrechtsgesetz, URG)", fr: "Loi fédérale du 9 octobre 1992 sur le droit d'auteur et les droits voisins (Loi sur le droit d'auteur, LDA)", it: "Legge federale del 9 ottobre 1992 sul diritto d'autore e sui diritti di protezione affini (Legge sul diritto d'autore, LDA)" },
  "https://fedlex.data.admin.ch/eli/cc/1993/274_274_274": { de: "Bundesgesetz vom 28. August 1992 über den Schutz von Marken und Herkunftsangaben (Markenschutzgesetz, MSchG)", fr: "Loi fédérale du 28 août 1992 sur la protection des marques et des indications de provenance (Loi sur la protection des marques, LPM)", it: "Legge federale del 28 agosto 1992 sulla protezione dei marchi e delle indicazioni di provenienza (Legge sulla protezione dei marchi, LPM)" },
  "https://fedlex.data.admin.ch/eli/cc/1996/546_546_546": { de: "Bundesgesetz vom 6. Oktober 1995 über Kartelle und andere Wettbewerbsbeschränkungen (Kartellgesetz, KG)", fr: "Loi fédérale du 6 octobre 1995 sur les cartels et autres restrictions à la concurrence (Loi sur les cartels, LCart)", it: "Legge federale del 6 ottobre 1995 sui cartelli e altre limitazioni della concorrenza (Legge sui cartelli, LCart)" },
  "https://fedlex.data.admin.ch/eli/cc/1999/404": { de: "Bundesverfassung der Schweizerischen Eidgenossenschaft vom 18. April 1999", fr: "Constitution fédérale de la Confédération suisse du 18 avril 1999", it: "Costituzione federale della Confederazione Svizzera del 18 aprile 1999" },
  "https://fedlex.data.admin.ch/eli/cc/2002/510": { de: "Bundesgesetz vom 6. Oktober 2000 über den Allgemeinen Teil des Sozialversicherungsrechts (ATSG)", fr: "Loi fédérale du 6 octobre 2000 sur la partie générale du droit des assurances sociales (LPGA)", it: "Legge federale del 6 ottobre 2000 sulla parte generale del diritto delle assicurazioni sociali (LPGA)" },
  "https://fedlex.data.admin.ch/eli/cc/2006/218": { de: "Bundesgesetz vom 17. Juni 2005 über das Bundesgericht (Bundesgerichtsgesetz, BGG)", fr: "Loi du 17 juin 2005 sur le Tribunal fédéral (LTF)", it: "Legge del 17 giugno 2005 sul Tribunale federale (LTF)" },
  "https://fedlex.data.admin.ch/eli/cc/2007/758": { de: "Bundesgesetz vom 16. Dezember 2005 über die Ausländerinnen und Ausländer und über die Integration (Ausländer- und Integrationsgesetz, AIG)", fr: "Loi fédérale du 16 décembre 2005 sur les étrangers et l'intégration (LEI)", it: "Legge federale del 16 dicembre 2005 sugli stranieri e la loro integrazione (LStrI)" },
  "https://fedlex.data.admin.ch/eli/cc/2010/262": { de: "Schweizerische Zivilprozessordnung vom 19. Dezember 2008 (Zivilprozessordnung, ZPO)", fr: "Code de procédure civile du 19 décembre 2008 (CPC)", it: "Codice di diritto processuale civile svizzero del 19 dicembre 2008 (Codice di procedura civile, CPC)" },
  "https://fedlex.data.admin.ch/eli/cc/2010/267": { de: "Schweizerische Strafprozessordnung vom 5. Oktober 2007 (Strafprozessordnung, StPO)", fr: "Code de procédure pénale suisse du 5 octobre 2007 (Code de procédure pénale, CPP)", it: "Codice di diritto processuale penale svizzero del 5 ottobre 2007 (Codice di procedura penale, CPP)" },
  "https://fedlex.data.admin.ch/eli/cc/2022/491": { de: "Bundesgesetz vom 25. September 2020 über den Datenschutz (Datenschutzgesetz, DSG)", fr: "Loi fédérale du 25 septembre 2020 sur la protection des données (LPD)", it: "Legge federale del 25 settembre 2020 sulla protezione dei dati (LPD)" },
  "https://fedlex.data.admin.ch/eli/cc/24/233_245_233": { de: "Schweizerisches Zivilgesetzbuch vom 10. Dezember 1907", fr: "Code civil suisse du 10 décembre 1907", it: "Codice civile svizzero del 10 dicembre 1907" },
  "https://fedlex.data.admin.ch/eli/cc/27/317_321_377": { de: "Bundesgesetz vom 30. März 1911 betreffend die Ergänzung des Schweizerischen Zivilgesetzbuches (Fünfter Teil: Obligationenrecht)", fr: "Loi fédérale du 30 mars 1911 complétant le Code civil suisse (Livre cinquième: Droit des obligations)", it: "Legge federale del 30 marzo 1911 di complemento del Codice civile svizzero (Libro quinto: Diritto delle obbligazioni)" },
  "https://fedlex.data.admin.ch/eli/cc/54/757_781_799": { de: "Schweizerisches Strafgesetzbuch vom 21. Dezember 1937", fr: "Code pénal suisse du 21 décembre 1937", it: "Codice penale svizzero del 21 dicembre 1937" },
  "https://fedlex.data.admin.ch/eli/cc/63/837_843_843": { de: "Bundesgesetz vom 20. Dezember 1946 über die Alters- und Hinterlassenenversicherung (AHVG)", fr: "Loi fédérale du 20 décembre 1946 sur l'assurance-vieillesse et survivants (LAVS)", it: "Legge federale del 20 dicembre 1946 sull'assicurazione per la vecchiaia e per i superstiti (LAVS)" },
};

const supportedSwissLaws: Record<string, SwissLawConfig> = {
  BV: {
    workUri: "https://fedlex.data.admin.ch/eli/cc/1999/404",
    lawTitle: "Bundesverfassung der Schweizerischen Eidgenossenschaft",
    displayLawCode: "BV",
  },
  ZGB: {
    workUri: "https://fedlex.data.admin.ch/eli/cc/24/233_245_233",
    lawTitle: "Zivilgesetzbuch",
    displayLawCode: "ZGB",
  },
  OR: {
    workUri: "https://fedlex.data.admin.ch/eli/cc/27/317_321_377",
    lawTitle: "Obligationenrecht",
    displayLawCode: "OR",
  },
  STGB: {
    workUri: "https://fedlex.data.admin.ch/eli/cc/54/757_781_799",
    lawTitle: "Schweizerisches Strafgesetzbuch",
    displayLawCode: "StGB",
  },
  ZPO: {
    workUri: "https://fedlex.data.admin.ch/eli/cc/2010/262",
    lawTitle: "Schweizerische Zivilprozessordnung",
    displayLawCode: "ZPO",
  },
  STPO: {
    workUri: "https://fedlex.data.admin.ch/eli/cc/2010/267",
    lawTitle: "Schweizerische Strafprozessordnung",
    displayLawCode: "StPO",
  },
  SCHKG: {
    workUri: "https://fedlex.data.admin.ch/eli/cc/11/529_488_529",
    lawTitle: "Bundesgesetz über Schuldbetreibung und Konkurs",
    displayLawCode: "SchKG",
  },
  VWVG: {
    workUri: "https://fedlex.data.admin.ch/eli/cc/1969/737_757_755",
    lawTitle: "Verwaltungsverfahrensgesetz",
    displayLawCode: "VwVG",
  },
  BGG: {
    workUri: "https://fedlex.data.admin.ch/eli/cc/2006/218",
    lawTitle: "Bundesgerichtsgesetz",
    displayLawCode: "BGG",
  },
  DSG: {
    workUri: "https://fedlex.data.admin.ch/eli/cc/2022/491",
    lawTitle: "Datenschutzgesetz",
    displayLawCode: "DSG",
  },
  IPRG: {
    workUri: "https://fedlex.data.admin.ch/eli/cc/1988/1776_1776_1776",
    lawTitle: "Bundesgesetz über das Internationale Privatrecht",
    displayLawCode: "IPRG",
  },
  DBG: {
    workUri: "https://fedlex.data.admin.ch/eli/cc/1991/1184_1184_1184",
    lawTitle: "Bundesgesetz über die direkte Bundessteuer",
    displayLawCode: "DBG",
  },
  STHG: {
    workUri: "https://fedlex.data.admin.ch/eli/cc/1991/1256_1256_1256",
    lawTitle:
      "Bundesgesetz über die Harmonisierung der direkten Steuern der Kantone und Gemeinden",
    displayLawCode: "StHG",
  },
  AHVG: {
    workUri: "https://fedlex.data.admin.ch/eli/cc/63/837_843_843",
    lawTitle:
      "Bundesgesetz über die Alters- und Hinterlassenenversicherung",
    displayLawCode: "AHVG",
  },
  IVG: {
    workUri: "https://fedlex.data.admin.ch/eli/cc/1959/827_857_845",
    lawTitle: "Bundesgesetz über die Invalidenversicherung",
    displayLawCode: "IVG",
  },
  ATSG: {
    workUri: "https://fedlex.data.admin.ch/eli/cc/2002/510",
    lawTitle:
      "Bundesgesetz über den Allgemeinen Teil des Sozialversicherungsrechts",
    displayLawCode: "ATSG",
  },
  ARG: {
    workUri: "https://fedlex.data.admin.ch/eli/cc/1966/57_57_57",
    lawTitle:
      "Bundesgesetz über die Arbeit in Industrie, Gewerbe und Handel",
    displayLawCode: "ArG",
  },
  SVG: {
    workUri: "https://fedlex.data.admin.ch/eli/cc/1959/679_705_685",
    lawTitle: "Strassenverkehrsgesetz",
    displayLawCode: "SVG",
  },
  AIG: {
    workUri: "https://fedlex.data.admin.ch/eli/cc/2007/758",
    lawTitle: "Ausländer- und Integrationsgesetz",
    displayLawCode: "AIG",
  },
  KG: {
    workUri: "https://fedlex.data.admin.ch/eli/cc/1996/546_546_546",
    lawTitle:
      "Bundesgesetz über Kartelle und andere Wettbewerbsbeschränkungen",
    displayLawCode: "KG",
  },
  URG: {
    workUri: "https://fedlex.data.admin.ch/eli/cc/1993/1798_1798_1798",
    lawTitle:
      "Bundesgesetz über das Urheberrecht und verwandte Schutzrechte",
    displayLawCode: "URG",
  },
  PATG: {
    workUri: "https://fedlex.data.admin.ch/eli/cc/1955/871_893_899",
    lawTitle: "Bundesgesetz über die Erfindungspatente",
    displayLawCode: "PatG",
  },
  MSCHG: {
    workUri: "https://fedlex.data.admin.ch/eli/cc/1993/274_274_274",
    lawTitle:
      "Bundesgesetz über den Schutz von Marken und Herkunftsangaben",
    displayLawCode: "MSchG",
  },
};

export interface SupportedFedlexLaw {
  workUri: string;
  displayLawCode: string;
  lawTitle: string;
  officialTitlesByLanguage: OfficialTitlesByLanguage;
  referenceType: "article";
  exampleInputs: readonly string[];
}

export function getSupportedFedlexLaws(): ReadonlyArray<SupportedFedlexLaw> {
  return Object.entries(supportedSwissLaws)
    .map(([, law]) => ({
      workUri: law.workUri,
      displayLawCode: law.displayLawCode,
      lawTitle: law.lawTitle,
      officialTitlesByLanguage: officialTitlesByWorkUri[law.workUri],
      referenceType: "article" as const,
      exampleInputs:
        law.exampleInputs ?? [
          `Art. 1 ${law.displayLawCode}`,
          `${law.displayLawCode} Art. 1`,
        ],
    }))
    .sort((left, right) =>
      left.displayLawCode.localeCompare(right.displayLawCode, "de"),
    );
}

export interface FedlexMapResult {
  workUri: string;
  articleNumber: string;
  language: FedlexLanguage;
}

export type FedlexLanguage = "de" | "fr" | "it";

export function normalizeFedlexLanguage(language?: string): FedlexLanguage | null {
  if (language === undefined || language === "de") return "de";
  if (language === "fr" || language === "it") return language;
  return null;
}

export function mapFedlexReference(
  reference: LawReference,
): FedlexMapResult | null {
  if (reference.jurisdiction !== "CH") {
    return null;
  }

  const law = supportedSwissLaws[reference.lawCode.toUpperCase()];
  if (!law) {
    return null;
  }

  if (reference.referenceType === "section") {
    return null;
  }

  const language = normalizeFedlexLanguage(reference.language);
  if (!language) return null;

  return {
    workUri: law.workUri,
    articleNumber: reference.section,
    language,
  };
}

export function normalizeArticleId(section: string): string {
  const match = section.match(/^(\d+)([a-zA-Z])$/);
  if (match) {
    return `art_${match[1]}_${match[2].toLowerCase()}`;
  }
  return `art_${section}`;
}

export function buildFedlexQueryBody(
  workUri: string,
  articleNumber: string,
  language: string = "de",
): unknown {
  const normalizedLanguage = normalizeFedlexLanguage(language);
  if (!normalizedLanguage) {
    throw new Error(`Unsupported Swiss law language: ${language}`);
  }
  const contentField = `${normalizedLanguage}Content`;
  const contentIdField = `${contentField}.id.keyword`;
  return {
    query: {
      bool: {
        must: [
          { term: { "contentParent.keyword": workUri } },
          {
            nested: {
              path: contentField,
              query: {
                term: {
                  [contentIdField]: normalizeArticleId(articleNumber),
                },
              },
              inner_hits: { _source: true },
            },
          },
        ],
      },
    },
  };
}

export interface FedlexArticleData {
  id: string;
  title?: string;
  content?: string;
  order?: number;
  itemUri?: string;
}

export function extractFedlexArticleFromResponse(
  responseJson: unknown,
  language: string = "de",
): FedlexArticleData | null {
  const normalizedLanguage = normalizeFedlexLanguage(language);
  if (!normalizedLanguage) return null;
  const root = responseJson as FedlexSearchResponse;
  const outerHits = root?.hits?.hits;
  if (!outerHits || outerHits.length === 0) {
    return null;
  }

  const inner = outerHits[0]?.inner_hits?.[`${normalizedLanguage}Content`]?.hits?.hits;
  if (!inner || inner.length === 0) {
    return null;
  }

  const source = inner[0]._source;
  if (!source || !source.id) {
    return null;
  }

  return {
    id: source.id,
    title: source.title,
    content: source.content,
    order: source.order,
    itemUri: source.itemUri,
  };
}

export function normalizeFedlexHeading(
  heading: string | undefined,
  sectionNumber?: string,
): string | undefined {
  if (!heading) {
    return undefined;
  }

  // Convert HTML to plain text first
  let text = convertFedlexHtmlToText(heading);

  if (!text) {
    return undefined;
  }

  // Remove leading article label like "Art. 8", "Art 8", "Artikel 8"
  if (sectionNumber) {
    const escapedSection = sectionNumber.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const sectionPattern = escapedSection.replace(
      /^(\d+)([a-zA-Z])$/,
      "$1\\s*$2",
    );
    const pattern = new RegExp(
      `^(?:Art\\.?\\s*${sectionPattern}|Artikel\\s+${sectionPattern})(?:\\s+|$)`,
      "i",
    );
    text = text.replace(pattern, "").trim();
  }

  // Also try without section number for generic "Art." prefix
  text = text.replace(/^Art\.?\s+\d+(?:\s+|$)/, "").trim();

  if (!text) {
    return undefined;
  }

  return text;
}

export function convertFedlexHtmlToText(html: string | undefined): string {
  if (!html) {
    return "";
  }

  let text = html;

  // Remove HTML comments
  text = text.replace(/<!--[\s\S]*?-->/g, "");

  // Remove script, style, noscript blocks and their contents
  text = text.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "");
  text = text.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "");
  text = text.replace(/<noscript[^>]*>[\s\S]*?<\/noscript>/gi, "");

  // Handle dl/dt/dd structures: <dl><dt>a.</dt><dd>Text</dd></dl>
  text = text.replace(/<dt>/gi, "\n");
  text = text.replace(/<\/dt>/gi, "");
  text = text.replace(/<dd>/gi, " ");
  text = text.replace(/<\/dd>/gi, "\n");

  // Add readable boundaries for block elements
  text = text
    .replace(/<\/p>/gi, "\n")
    .replace(/<\/h[1-6]>/gi, "\n")
    .replace(/<\/li>/gi, "\n")
    .replace(/<\/div>/gi, "\n")
    .replace(/<\/section>/gi, "\n")
    .replace(/<\/article>/gi, "\n")
    .replace(/<\/ol>/gi, "\n")
    .replace(/<\/ul>/gi, "\n")
    .replace(/<\/tr>/gi, "\n")
    .replace(/<\/td>/gi, " ")
    .replace(/<\/th>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n");

  // Preserve sup paragraph numbers
  text = text.replace(/<sup[^>]*>/gi, "").replace(/<\/sup>/gi, "");

  // Decode common HTML entities and non-breaking spaces
  text = decodeHtmlEntities(text);

  // Remove any remaining raw tags
  text = text.replace(/<[^>]+>/g, "");

  // Collapse excessive whitespace
  text = text
    .replace(/[ \t]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return text;
}

function decodeHtmlEntities(value: string): string {
  return value.replace(
    /&(#x?[0-9a-f]+|[a-z]+);/gi,
    (entity, token: string) => {
      if (token.startsWith("#x")) {
        return String.fromCodePoint(Number.parseInt(token.slice(2), 16));
      }

      if (token.startsWith("#")) {
        return String.fromCodePoint(Number.parseInt(token.slice(1), 10));
      }

      const named: Record<string, string> = {
        amp: "&",
        gt: ">",
        lt: "<",
        nbsp: " ",
        quot: '"',
        apos: "'",
        sect: "§",
        szlig: "ß",
        auml: "ä",
        Auml: "Ä",
        ouml: "ö",
        Ouml: "Ö",
        uuml: "ü",
        Uuml: "Ü",
      };

      return named[token] ?? entity;
    },
  );
}

export function mapFedlexToLawSection(params: {
  reference: LawReference;
  articleData: FedlexArticleData;
  providerId: string;
  providerLabel: string;
  retrievedAt: string;
}): LawSection {
  const law =
    supportedSwissLaws[params.reference.lawCode.toUpperCase()];
  if (!law) {
    throw new Error(
      `Unsupported Swiss law code: ${params.reference.lawCode}`,
    );
  }

  return {
    providerId: params.providerId,
    providerLabel: params.providerLabel,
    sourceUrl: params.articleData.itemUri,
    lawCode: law.displayLawCode,
    lawTitle: law.lawTitle,
    section: params.reference.section,
    referenceType: "article",
    sourceVariant: "official-de",
    jurisdiction: "CH",
    language: normalizeFedlexLanguage(params.reference.language) ?? undefined,
    heading: normalizeFedlexHeading(params.articleData.title, params.reference.section),
    text: convertFedlexHtmlToText(params.articleData.content),
    retrievedAt: params.retrievedAt,
    cacheStatus: "live",
    isOfficialSource: true,
    isAuthoritativeText: true,
  };
}

interface FedlexSearchResponse {
  hits?: {
    hits?: Array<{
      _source?: Record<string, unknown>;
      inner_hits?: Record<string, {
          hits?: {
            hits?: Array<{
              _source?: {
                id?: string;
                title?: string;
                content?: string;
                order?: number;
                itemUri?: string;
              };
            }>;
          };
        }>;
    }>;
  };
}
