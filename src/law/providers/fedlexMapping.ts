import type { LawReference, LawSection } from "../types";

interface SwissLawConfig {
  workUri: string;
  lawTitle: string;
  displayLawCode: string;
  exampleInputs?: readonly string[];
}

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
  displayLawCode: string;
  lawTitle: string;
  referenceType: "article";
  exampleInputs: readonly string[];
}

export function getSupportedFedlexLaws(): ReadonlyArray<SupportedFedlexLaw> {
  return Object.entries(supportedSwissLaws)
    .map(([, law]) => ({
      displayLawCode: law.displayLawCode,
      lawTitle: law.lawTitle,
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
