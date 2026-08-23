import type { LawJurisdiction, LawReference } from "./law/types";
import {
  EU_ACT_ALIASES,
  euActForCelexReference,
  euActForLawCode,
  parseEuCelex,
} from "./law/euActRegistry";

export type ParsedLawReference = LawReference;

const lawCodePattern = String.raw`[A-Za-zÄÖÜäöüß][A-Za-zÄÖÜäöüß0-9-]*`;
const sectionPattern = String.raw`\d+[A-Za-z]?`;
const articleMarkerPattern = String.raw`(?:Art\.?|Artikel)`;
const explicitSlashLawCodes = [
  "FreizügG/EU",
] as const;
const explicitSpacedLawCodes = [
  "SGB I",
  "SGB II",
  "SGB III",
  "SGB IV",
  "SGB V",
  "SGB VI",
  "SGB VII",
  "SGB VIII",
  "SGB IX",
  "SGB X",
  "SGB XI",
  "SGB XII",
  "SGB XIV",
] as const;
const explicitSpacedLawCodePattern = explicitSpacedLawCodes
  .map((lawCode) => lawCode.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
  .join("|");
const explicitSlashLawCodePattern = explicitSlashLawCodes
  .map((lawCode) => lawCode.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
  .join("|");

const atLawFirstPattern = new RegExp(
  String.raw`^AT\s+(${lawCodePattern})\s+(?:§\s*)?(${sectionPattern})$`,
  "u",
);

const atSectionFirstPattern = new RegExp(
  String.raw`^AT\s+(?:§\s*)?(${sectionPattern})\s+(${lawCodePattern})$`,
  "u",
);

const atLawLastPattern = new RegExp(
  String.raw`^(?:§\s*)?(${sectionPattern})\s+(${lawCodePattern})\s+AT$`,
  "u",
);

const atLawMiddlePattern = new RegExp(
  String.raw`^(${lawCodePattern})\s+AT\s+(?:§\s*)?(${sectionPattern})$`,
  "u",
);

const atArticleFirstPattern = new RegExp(
  String.raw`^AT\s+${articleMarkerPattern}\s*(${sectionPattern})\s+(${lawCodePattern})$`,
  "iu",
);

const atLawFirstArticlePattern = new RegExp(
  String.raw`^AT\s+(${lawCodePattern})\s+${articleMarkerPattern}\s*(${sectionPattern})$`,
  "iu",
);

const atArticleLawLastPattern = new RegExp(
  String.raw`^${articleMarkerPattern}\s*(${sectionPattern})\s+(${lawCodePattern})\s+AT$`,
  "iu",
);

const atLawArticleMiddlePattern = new RegExp(
  String.raw`^(${lawCodePattern})\s+${articleMarkerPattern}\s*(${sectionPattern})\s+AT$`,
  "iu",
);

const lawFirstPattern = new RegExp(
  String.raw`^(${lawCodePattern})\s+(?:§\s*)?(${sectionPattern})$`,
  "u",
);

const sectionFirstPattern = new RegExp(
  String.raw`^(?:§\s*)?(${sectionPattern})\s+(${lawCodePattern})$`,
  "u",
);

const articleFirstPattern = new RegExp(
  String.raw`^${articleMarkerPattern}\s*(${sectionPattern})\s+(${lawCodePattern})$`,
  "iu",
);

const lawFirstArticlePattern = new RegExp(
  String.raw`^(${lawCodePattern})\s+${articleMarkerPattern}\s*(${sectionPattern})$`,
  "iu",
);

const explicitSpacedLawFirstPattern = new RegExp(
  String.raw`^(${explicitSpacedLawCodePattern})\s+(?:§\s*)?(${sectionPattern})$`,
  "iu",
);

const explicitSpacedSectionFirstPattern = new RegExp(
  String.raw`^(?:§\s*)?(${sectionPattern})\s+(${explicitSpacedLawCodePattern})$`,
  "iu",
);
const explicitSlashLawFirstPattern = new RegExp(
  String.raw`^(${explicitSlashLawCodePattern})\s+(?:§\s*)?(${sectionPattern})$`,
  "iu",
);
const explicitSlashSectionFirstPattern = new RegExp(
  String.raw`^(?:§\s*)?(${sectionPattern})\s+(${explicitSlashLawCodePattern})$`,
  "iu",
);

const egbgbArticlePattern = sectionPattern;
const egbgbSubsectionPattern = sectionPattern;
const egbgbArticleSectionFirstPattern = new RegExp(
  String.raw`^${articleMarkerPattern}\s*(${egbgbArticlePattern})\s+§\s*(${egbgbSubsectionPattern})\s+(EGBGB)$`,
  "iu",
);
const egbgbLawFirstArticleSectionPattern = new RegExp(
  String.raw`^(EGBGB)\s+${articleMarkerPattern}\s*(${egbgbArticlePattern})\s+§\s*(${egbgbSubsectionPattern})$`,
  "iu",
);
const egbgbArticleFirstPattern = new RegExp(
  String.raw`^${articleMarkerPattern}\s*(${egbgbArticlePattern})\s+(EGBGB)$`,
  "iu",
);
const egbgbLawFirstArticlePattern = new RegExp(
  String.raw`^(EGBGB)\s+${articleMarkerPattern}\s*(${egbgbArticlePattern})$`,
  "iu",
);

const swissFedlexLawCodes = [
  "BV",
  "ZGB",
  "OR",
  "STGB",
  "ZPO",
  "STPO",
  "SCHKG",
  "VWVG",
  "BGG",
  "DSG",
  "IPRG",
  "DBG",
  "STHG",
  "AHVG",
  "IVG",
  "ATSG",
  "ARG",
  "SVG",
  "AIG",
  "KG",
  "URG",
  "PATG",
  "MSCHG",
];

const swissFedlexLawCodeSet = new Set(swissFedlexLawCodes);
const euLawCodePattern = EU_ACT_ALIASES
  .map((alias) => alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
  .join("|");

export function enrichJurisdiction(
  reference: ParsedLawReference,
  selectedJurisdiction: LawJurisdiction,
): ParsedLawReference {
  if (selectedJurisdiction === "AT" && !reference.jurisdiction) {
    return { ...reference, jurisdiction: "AT" };
  }
  if (
    selectedJurisdiction === "CH" &&
    !reference.jurisdiction &&
    reference.referenceType === "article" &&
    swissFedlexLawCodeSet.has(reference.lawCode)
  ) {
    return { ...reference, jurisdiction: "CH" };
  }
  if (selectedJurisdiction === "EU" && !reference.jurisdiction && reference.referenceType === "article") {
    const act = euActForLawCode(reference.lawCode);
    if (act) return { ...reference, lawCode: act.canonicalLawCode, jurisdiction: "EU" };
  }
  return reference;
}

export function parseLawReferenceWithSelectedJurisdiction(
  input: string,
  selectedJurisdiction: LawJurisdiction,
): ParsedLawReference | null {
  if (selectedJurisdiction === "EU") {
    const normalized = input.trim().replace(/\s+/g, " ");
    const euCelexArticle = parseEuCelexArticle(normalized);
    if (euCelexArticle) return euCelexArticle;
    const euArticle = new RegExp(`^(?:(${euLawCodePattern})\\s+${articleMarkerPattern}\\s*(${sectionPattern})|${articleMarkerPattern}\\s*(${sectionPattern})\\s+(${euLawCodePattern}))$`, "iu").exec(normalized);
    if (euArticle) {
      const act = euActForLawCode(euArticle[1] ?? euArticle[4]);
      if (act) {
        return { lawCode: act.canonicalLawCode, section: euArticle[2] ?? euArticle[3], referenceType: "article", jurisdiction: "EU" };
      }
    }
  }
  const parsedReference = parseLawReference(input);
  if (parsedReference) {
    if (
      selectedJurisdiction !== "EU" &&
      !parsedReference.jurisdiction &&
      euActForLawCode(parsedReference.lawCode) !== null
    ) {
      return null;
    }

    if (selectedJurisdiction !== "CH" && selectedJurisdiction !== "EU") {
      return enrichJurisdiction(parsedReference, selectedJurisdiction);
    }

    if (parsedReference.jurisdiction) {
      return parsedReference;
    }

    if (selectedJurisdiction === "CH") {
      const enrichedReference = enrichJurisdiction(parsedReference, "CH");
      return enrichedReference.jurisdiction === "CH" ? enrichedReference : null;
    }
    const enrichedReference = enrichJurisdiction(parsedReference, "EU");
    return enrichedReference.jurisdiction === "EU" ? enrichedReference : null;
  }

  if (selectedJurisdiction !== "EU" && isStandaloneEuAliasReference(input)) {
    return null;
  }

  if (selectedJurisdiction === "AT") {
    return parseLawReference(`AT ${input}`);
  }

  if (selectedJurisdiction === "CH") {
    const normalized = input.trim().replace(/\s+/g, " ");
    if (normalized) {
      const artFirstMatch = normalized.match(articleFirstPattern);
      if (artFirstMatch) {
        const lawCode = artFirstMatch[2].toUpperCase();
        if (swissFedlexLawCodeSet.has(lawCode)) {
          return {
            lawCode,
            section: artFirstMatch[1],
            referenceType: "article",
            jurisdiction: "CH",
          };
        }
      }

      const lawFirstArtMatch = normalized.match(lawFirstArticlePattern);
      if (lawFirstArtMatch) {
        const lawCode = lawFirstArtMatch[1].toUpperCase();
        if (swissFedlexLawCodeSet.has(lawCode)) {
          return {
            lawCode,
            section: lawFirstArtMatch[2],
            referenceType: "article",
            jurisdiction: "CH",
          };
        }
      }
    }
  }

  return null;
}

function parseEuCelexArticle(input: string): ParsedLawReference | null {
  const celexPattern = String.raw`(?:CELEX\s*[:]?\s*)?(3\d{4}[RLD]\d{4})`;
  const celexFirst = new RegExp(`^${celexPattern}\\s+${articleMarkerPattern}\\s*(${sectionPattern})$`, "iu").exec(input);
  const articleFirst = new RegExp(`^${articleMarkerPattern}\\s*(${sectionPattern})\\s+${celexPattern}$`, "iu").exec(input);
  const match = celexFirst ?? articleFirst;
  if (!match) return null;

  const celex = celexFirst ? match[1] : match[2];
  const section = celexFirst ? match[2] : match[1];
  if (!parseEuCelex(celex)) return null;
  const act = euActForCelexReference(celex);
  if (!act) return null;

  return {
    lawCode: act.canonicalLawCode,
    section,
    referenceType: "article",
    jurisdiction: "EU",
  };
}

function isStandaloneEuAliasReference(input: string): boolean {
  const normalized = input.trim().replace(/\s+/g, " ");
  if (!normalized) return false;

  return new RegExp(`^(?:(${euLawCodePattern})\\s+${articleMarkerPattern}\\s*(${sectionPattern})|${articleMarkerPattern}\\s*(${sectionPattern})\\s+(${euLawCodePattern})|(${euLawCodePattern})\\s+(?:§\\s*)?(${sectionPattern})|(?:§\\s*)?(${sectionPattern})\\s+(${euLawCodePattern}))$`, "iu").test(normalized);
}

export function parseLawReference(input: string): ParsedLawReference | null {
  const normalized = input.trim().replace(/\s+/g, " ");
  if (!normalized) {
    return null;
  }

  const atLawFirstMatch = normalized.match(atLawFirstPattern);
  if (atLawFirstMatch) {
    return {
      lawCode: atLawFirstMatch[1].toUpperCase(),
      section: atLawFirstMatch[2],
      jurisdiction: "AT",
    };
  }

  const atSectionFirstMatch = normalized.match(atSectionFirstPattern);
  if (atSectionFirstMatch) {
    return {
      lawCode: atSectionFirstMatch[2].toUpperCase(),
      section: atSectionFirstMatch[1],
      jurisdiction: "AT",
    };
  }

  const atLawLastMatch = normalized.match(atLawLastPattern);
  if (atLawLastMatch) {
    return {
      lawCode: atLawLastMatch[2].toUpperCase(),
      section: atLawLastMatch[1],
      jurisdiction: "AT",
    };
  }

  const atLawMiddleMatch = normalized.match(atLawMiddlePattern);
  if (atLawMiddleMatch) {
    return {
      lawCode: atLawMiddleMatch[1].toUpperCase(),
      section: atLawMiddleMatch[2],
      jurisdiction: "AT",
    };
  }

  const atArticleFirstMatch = normalized.match(atArticleFirstPattern);
  if (atArticleFirstMatch) {
    return {
      lawCode: atArticleFirstMatch[2].toUpperCase(),
      section: atArticleFirstMatch[1],
      referenceType: "article",
      jurisdiction: "AT",
    };
  }

  const atLawFirstArticleMatch = normalized.match(atLawFirstArticlePattern);
  if (atLawFirstArticleMatch) {
    return {
      lawCode: atLawFirstArticleMatch[1].toUpperCase(),
      section: atLawFirstArticleMatch[2],
      referenceType: "article",
      jurisdiction: "AT",
    };
  }

  const atArticleLawLastMatch = normalized.match(atArticleLawLastPattern);
  if (atArticleLawLastMatch) {
    return {
      lawCode: atArticleLawLastMatch[2].toUpperCase(),
      section: atArticleLawLastMatch[1],
      referenceType: "article",
      jurisdiction: "AT",
    };
  }

  const atLawArticleMiddleMatch = normalized.match(atLawArticleMiddlePattern);
  if (atLawArticleMiddleMatch) {
    return {
      lawCode: atLawArticleMiddleMatch[1].toUpperCase(),
      section: atLawArticleMiddleMatch[2],
      referenceType: "article",
      jurisdiction: "AT",
    };
  }

  const articleFirstMatch = normalized.match(articleFirstPattern);
  if (articleFirstMatch && articleFirstMatch[2].toUpperCase() === "GG") {
    return {
      lawCode: "GG",
      section: articleFirstMatch[1],
      referenceType: "article",
    };
  }

  const lawFirstArticleMatch = normalized.match(lawFirstArticlePattern);
  if (lawFirstArticleMatch && lawFirstArticleMatch[1].toUpperCase() === "GG") {
    return {
      lawCode: "GG",
      section: lawFirstArticleMatch[2],
      referenceType: "article",
    };
  }

  const egbgbArticleSectionFirstMatch = normalized.match(egbgbArticleSectionFirstPattern);
  if (egbgbArticleSectionFirstMatch) {
    return {
      lawCode: "EGBGB",
      section: egbgbArticleSectionFirstMatch[1],
      subsection: egbgbArticleSectionFirstMatch[2],
      referenceType: "article",
    };
  }

  const egbgbLawFirstArticleSectionMatch = normalized.match(egbgbLawFirstArticleSectionPattern);
  if (egbgbLawFirstArticleSectionMatch) {
    return {
      lawCode: "EGBGB",
      section: egbgbLawFirstArticleSectionMatch[2],
      subsection: egbgbLawFirstArticleSectionMatch[3],
      referenceType: "article",
    };
  }

  const egbgbArticleFirstMatch = normalized.match(egbgbArticleFirstPattern);
  if (egbgbArticleFirstMatch) {
    return {
      lawCode: "EGBGB",
      section: egbgbArticleFirstMatch[1],
      referenceType: "article",
    };
  }

  const egbgbLawFirstArticleMatch = normalized.match(egbgbLawFirstArticlePattern);
  if (egbgbLawFirstArticleMatch) {
    return {
      lawCode: "EGBGB",
      section: egbgbLawFirstArticleMatch[2],
      referenceType: "article",
    };
  }

  const explicitSpacedLawFirstMatch = normalized.match(explicitSpacedLawFirstPattern);
  if (explicitSpacedLawFirstMatch) {
    return {
      lawCode: explicitSpacedLawFirstMatch[1].toUpperCase(),
      section: explicitSpacedLawFirstMatch[2],
    };
  }

  const explicitSpacedSectionFirstMatch = normalized.match(explicitSpacedSectionFirstPattern);
  if (explicitSpacedSectionFirstMatch) {
    return {
      lawCode: explicitSpacedSectionFirstMatch[2].toUpperCase(),
      section: explicitSpacedSectionFirstMatch[1],
    };
  }

  const explicitSlashLawFirstMatch = normalized.match(explicitSlashLawFirstPattern);
  if (explicitSlashLawFirstMatch) {
    return {
      lawCode: explicitSlashLawFirstMatch[1].toUpperCase(),
      section: explicitSlashLawFirstMatch[2],
    };
  }

  const explicitSlashSectionFirstMatch = normalized.match(explicitSlashSectionFirstPattern);
  if (explicitSlashSectionFirstMatch) {
    return {
      lawCode: explicitSlashSectionFirstMatch[2].toUpperCase(),
      section: explicitSlashSectionFirstMatch[1],
    };
  }

  const lawFirstMatch = normalized.match(lawFirstPattern);
  if (lawFirstMatch) {
    if (lawFirstMatch[1].toUpperCase() === "EGBGB") {
      return null;
    }

    return {
      lawCode: lawFirstMatch[1].toUpperCase(),
      section: lawFirstMatch[2],
    };
  }

  const sectionFirstMatch = normalized.match(sectionFirstPattern);
  if (sectionFirstMatch) {
    if (sectionFirstMatch[2].toUpperCase() === "EGBGB") {
      return null;
    }

    return {
      lawCode: sectionFirstMatch[2].toUpperCase(),
      section: sectionFirstMatch[1],
    };
  }

  return null;
}
