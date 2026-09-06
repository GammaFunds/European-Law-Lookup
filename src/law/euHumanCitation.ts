import type { EuActIndex } from "./euActIndex";
import { EU_LANGUAGES } from "./euLanguages";
import { euActForCelexReference, parseEuCelex } from "./euActRegistry";
import type { EuDocumentType, EuLawLanguage, LawReference } from "./types";

interface EuHumanCitationLanguageTokens {
  articleMarkers: readonly string[];
  actLabels: Readonly<Record<EuDocumentType, string>>;
  orgCodes: readonly string[];
}

const EU_HUMAN_CITATION_TOKENS: Readonly<Record<EuLawLanguage, EuHumanCitationLanguageTokens>> = {
  bg: {
    articleMarkers: ["член", "чл"],
    actLabels: { R: "Регламент", L: "Директива", D: "Решение" },
    orgCodes: ["ЕС"],
  },
  es: {
    articleMarkers: ["artículo", "art"],
    actLabels: { R: "Reglamento", L: "Directiva", D: "Decisión" },
    orgCodes: ["UE"],
  },
  cs: {
    articleMarkers: ["článek", "čl"],
    actLabels: { R: "Nařízení", L: "Směrnice", D: "Rozhodnutí" },
    orgCodes: ["EU"],
  },
  da: {
    articleMarkers: ["artikel", "art"],
    actLabels: { R: "Forordning", L: "Direktiv", D: "Afgørelse" },
    orgCodes: ["EU"],
  },
  de: {
    articleMarkers: ["artikel", "art"],
    actLabels: { R: "Verordnung", L: "Richtlinie", D: "Beschluss" },
    orgCodes: ["EU"],
  },
  et: {
    articleMarkers: ["artikkel", "art"],
    actLabels: { R: "Määrus", L: "Direktiiv", D: "Otsus" },
    orgCodes: ["EL"],
  },
  el: {
    articleMarkers: ["άρθρο", "άρθ"],
    actLabels: { R: "Κανονισμός", L: "Οδηγία", D: "Απόφαση" },
    orgCodes: ["ΕΕ"],
  },
  en: {
    articleMarkers: ["article", "art"],
    actLabels: { R: "Regulation", L: "Directive", D: "Decision" },
    orgCodes: ["EU"],
  },
  fr: {
    articleMarkers: ["article", "art"],
    actLabels: { R: "Règlement", L: "Directive", D: "Décision" },
    orgCodes: ["UE"],
  },
  ga: {
    articleMarkers: ["airteagal", "alt"],
    actLabels: { R: "Rialachán", L: "Treoir", D: "Cinneadh" },
    orgCodes: ["AE"],
  },
  hr: {
    articleMarkers: ["članak", "čl"],
    actLabels: { R: "Uredba", L: "Direktiva", D: "Odluka" },
    orgCodes: ["EU"],
  },
  it: {
    articleMarkers: ["articolo", "art"],
    actLabels: { R: "Regolamento", L: "Direttiva", D: "Decisione" },
    orgCodes: ["UE"],
  },
  lv: {
    articleMarkers: ["pants", "p"],
    actLabels: { R: "Regula", L: "Direktīva", D: "Lēmums" },
    orgCodes: ["ES"],
  },
  lt: {
    articleMarkers: ["straipsnis", "str"],
    actLabels: { R: "Reglamentas", L: "Direktyva", D: "Sprendimas" },
    orgCodes: ["ES"],
  },
  hu: {
    articleMarkers: ["cikk", "c"],
    actLabels: { R: "Rendelet", L: "Irányelv", D: "Határozat" },
    orgCodes: ["EU"],
  },
  mt: {
    articleMarkers: ["artikolu", "art"],
    actLabels: { R: "Regolament", L: "Direttiva", D: "Deċiżjoni" },
    orgCodes: ["UE"],
  },
  nl: {
    articleMarkers: ["artikel", "art"],
    actLabels: { R: "Verordening", L: "Richtlijn", D: "Besluit" },
    orgCodes: ["EU"],
  },
  pl: {
    articleMarkers: ["artykuł", "art"],
    actLabels: { R: "Rozporządzenie", L: "Dyrektywa", D: "Decyzja" },
    orgCodes: ["UE"],
  },
  pt: {
    articleMarkers: ["artigo", "art"],
    actLabels: { R: "Regulamento", L: "Diretiva", D: "Decisão" },
    orgCodes: ["UE"],
  },
  ro: {
    articleMarkers: ["articol", "art"],
    actLabels: { R: "Regulament", L: "Directiva", D: "Decizie" },
    orgCodes: ["UE"],
  },
  sk: {
    articleMarkers: ["článok", "čl"],
    actLabels: { R: "Nariadenie", L: "Smernica", D: "Rozhodnutie" },
    orgCodes: ["EÚ"],
  },
  sl: {
    articleMarkers: ["člen", "čl"],
    actLabels: { R: "Uredba", L: "Direktiva", D: "Odločitev" },
    orgCodes: ["EU"],
  },
  fi: {
    articleMarkers: ["artikla", "art"],
    actLabels: { R: "Asetus", L: "Direktiivi", D: "Päätös" },
    orgCodes: ["EU"],
  },
  sv: {
    articleMarkers: ["artikel", "art"],
    actLabels: { R: "Förordning", L: "Direktiv", D: "Beslut" },
    orgCodes: ["EU"],
  },
};

const allOrgCodes = new Set<string>();
for (const tokens of Object.values(EU_HUMAN_CITATION_TOKENS)) {
  for (const orgCode of tokens.orgCodes) {
    allOrgCodes.add(orgCode.toLowerCase());
  }
}

if (Object.keys(EU_HUMAN_CITATION_TOKENS).length !== EU_LANGUAGES.length) {
  throw new Error("EU human citation token table must contain exactly one entry per EU_LANGUAGE.");
}
for (const language of EU_LANGUAGES) {
  if (!EU_HUMAN_CITATION_TOKENS[language.code]) {
    throw new Error(`EU human citation tokens missing for language ${language.code}.`);
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeWhitespace(input: string): string {
  return input.trim().replace(/\s+/g, " ");
}

function normalizeToken(input: string): string {
  return input
    .normalize("NFKC")
    .replace(/\.$/u, "")
    .toLowerCase();
}

export function normalizeEuCitationTitle(title: string): string {
  return title
    .normalize("NFKC")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

export function supportedEuHumanCitationLanguages(): readonly EuLawLanguage[] {
  return Object.keys(EU_HUMAN_CITATION_TOKENS).sort() as EuLawLanguage[];
}

export function euDocumentTypeForHumanCitationActLabel(label: string): EuDocumentType | null {
  const normalizedLabel = normalizeToken(label);
  let matchedType: EuDocumentType | null = null;
  for (const tokens of Object.values(EU_HUMAN_CITATION_TOKENS)) {
    for (const [type, actLabel] of Object.entries(tokens.actLabels) as [EuDocumentType, string][]) {
      if (normalizeToken(actLabel) !== normalizedLabel) continue;
      if (matchedType && matchedType !== type) return null;
      matchedType = type;
    }
  }
  return matchedType;
}

function padEuActNumber(number: string): string | null {
  if (!/^\d{1,6}$/.test(number)) return null;
  const numeric = Number(number);
  if (!Number.isInteger(numeric) || numeric < 1) return null;
  return number.length < 4 ? number.padStart(4, "0") : number;
}

function tryNormalizeSuffixOrg(input: string): string {
  const suffixPattern = /^(.*?)\s+(\d{4})\/(\d{1,6})\/([\p{L}\p{M}0-9]+)$/u;
  const match = suffixPattern.exec(input);
  if (!match) return input;
  const orgCode = match[4];
  if (!allOrgCodes.has(orgCode.toLowerCase())) return input;
  return `${match[1]} (${orgCode}) ${match[2]}/${match[3]}`;
}

function documentTypeForActLabel(language: EuLawLanguage, label: string): EuDocumentType | null {
  const tokens = EU_HUMAN_CITATION_TOKENS[language];
  const normalizedLabel = normalizeToken(label);
  for (const [type, actLabel] of Object.entries(tokens.actLabels) as [EuDocumentType, string][]) {
    if (normalizeToken(actLabel) === normalizedLabel) return type;
  }
  return null;
}

function isOrgCodeForLanguage(language: EuLawLanguage, orgCode: string): boolean {
  const normalizedOrgCode = normalizeToken(orgCode);
  return EU_HUMAN_CITATION_TOKENS[language].orgCodes.some(
    (code) => normalizeToken(code) === normalizedOrgCode,
  );
}

const sectionPattern = String.raw`\d+[A-Za-z]?`;

function tryResolveStructuredCitation(input: string): LawReference | null {
  const normalized = normalizeWhitespace(input);
  const withPrefixOrg = tryNormalizeSuffixOrg(normalized);

  for (const language of Object.keys(EU_HUMAN_CITATION_TOKENS) as EuLawLanguage[]) {
    const tokens = EU_HUMAN_CITATION_TOKENS[language];
    const articleMarkerPattern = tokens.articleMarkers.map(escapeRegExp).join("|");
    const actLabelPattern = Object.values(tokens.actLabels).map(escapeRegExp).join("|");
    const orgCodePattern = tokens.orgCodes.map(escapeRegExp).join("|");

    const articleFirstPattern = new RegExp(
      `^(?:${articleMarkerPattern})\\.?\\s*(${sectionPattern})\\s+(?:(${actLabelPattern}))\\s+\\((${orgCodePattern})\\)\\s+(\\d{4})/(\\d{1,6})$`,
      "iu",
    );
    const actFirstPattern = new RegExp(
      `^(?:(${actLabelPattern}))\\s+(?:(?:\\((${orgCodePattern})\\)\\s+(\\d{4})/(\\d{1,6}))|(?:(\\d{4})/(\\d{1,6})/(${orgCodePattern})))\\s+(?:${articleMarkerPattern})\\.?\\s*(${sectionPattern})$`,
      "iu",
    );

    const articleFirstMatch = articleFirstPattern.exec(withPrefixOrg);
    if (articleFirstMatch) {
      const section = articleFirstMatch[1];
      const actLabel = articleFirstMatch[2];
      const orgCode = articleFirstMatch[3];
      const year = articleFirstMatch[4];
      const number = articleFirstMatch[5];
      const documentType = documentTypeForActLabel(language, actLabel);
      if (!documentType || !isOrgCodeForLanguage(language, orgCode)) continue;
      return buildReference(year, documentType, number, section);
    }

    const actFirstMatch = actFirstPattern.exec(withPrefixOrg);
    if (actFirstMatch) {
      const actLabel = actFirstMatch[1];
      const documentType = documentTypeForActLabel(language, actLabel);
      if (!documentType) continue;
      let orgCode: string;
      let year: string;
      let number: string;
      if (actFirstMatch[2]) {
        orgCode = actFirstMatch[2];
        year = actFirstMatch[3];
        number = actFirstMatch[4];
      } else {
        year = actFirstMatch[5];
        number = actFirstMatch[6];
        orgCode = actFirstMatch[7];
      }
      const section = actFirstMatch[8];
      if (!isOrgCodeForLanguage(language, orgCode)) continue;
      return buildReference(year, documentType, number, section);
    }
  }

  return null;
}

function buildReference(
  year: string,
  documentType: EuDocumentType,
  number: string,
  section: string,
): LawReference | null {
  if (!/^\d{4}$/.test(year)) return null;
  const paddedNumber = padEuActNumber(number);
  if (!paddedNumber) return null;
  const celex = `3${year}${documentType}${paddedNumber}`;
  if (!parseEuCelex(celex)) return null;
  const act = euActForCelexReference(celex);
  if (!act) return null;
  return {
    lawCode: act.canonicalLawCode,
    section,
    referenceType: "article",
    jurisdiction: "EU",
    euCelex: act.celex,
    euDocumentType: act.documentType,
  };
}

function tryStripArticleMarker(input: string): { title: string; section: string } | null {
  const normalized = normalizeWhitespace(input);

  for (const language of Object.keys(EU_HUMAN_CITATION_TOKENS) as EuLawLanguage[]) {
    const tokens = EU_HUMAN_CITATION_TOKENS[language];
    const articleMarkerPattern = tokens.articleMarkers.map(escapeRegExp).join("|");

    const articleFirstPattern = new RegExp(
      `^(?:${articleMarkerPattern})\\.?\\s*(${sectionPattern})\\s+(.*)$`,
      "iu",
    );
    const articleLastPattern = new RegExp(
      `^(.*?)\\s+(?:${articleMarkerPattern})\\.?\\s*(${sectionPattern})$`,
      "iu",
    );

    const articleFirstMatch = articleFirstPattern.exec(normalized);
    if (articleFirstMatch) {
      return { title: articleFirstMatch[2], section: articleFirstMatch[1] };
    }

    const articleLastMatch = articleLastPattern.exec(normalized);
    if (articleLastMatch) {
      return { title: articleLastMatch[1], section: articleLastMatch[2] };
    }
  }

  return null;
}

function buildTitleToCelexMap(index: EuActIndex): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>();
  for (const entry of index.entries.values()) {
    for (const title of Object.values(entry.titlesByLanguage)) {
      const normalized = normalizeEuCitationTitle(title);
      if (!normalized) continue;
      let celexSet = map.get(normalized);
      if (!celexSet) {
        celexSet = new Set<string>();
        map.set(normalized, celexSet);
      }
      celexSet.add(entry.celex);
    }
  }
  return map;
}

function tryResolveExactTitle(input: string, index: EuActIndex | null): LawReference | null {
  if (!index) return null;

  let titlePart = normalizeWhitespace(input);
  let section = "";
  const stripped = tryStripArticleMarker(input);
  if (stripped) {
    titlePart = stripped.title;
    section = stripped.section;
  }

  const normalizedTitle = normalizeEuCitationTitle(titlePart);
  if (!normalizedTitle) return null;

  const titleMap = buildTitleToCelexMap(index);
  const celexSet = titleMap.get(normalizedTitle);
  if (!celexSet || celexSet.size !== 1) return null;
  const celex = [...celexSet][0];

  const act = euActForCelexReference(celex);
  if (!act) return null;

  return {
    lawCode: act.canonicalLawCode,
    section,
    referenceType: section ? "article" : undefined,
    jurisdiction: "EU",
    euCelex: act.celex,
    euDocumentType: act.documentType,
  };
}

export function resolveEuHumanCitation(
  input: string,
  index: EuActIndex | null,
): LawReference | null {
  const structured = tryResolveStructuredCitation(input);
  if (structured) return structured;
  return tryResolveExactTitle(input, index);
}