import type { EuDocumentType } from "./types";

export interface EuActEntry {
  celex: string;
  documentType: EuDocumentType;
  canonicalLawCode: string;
  aliases: readonly string[];
  officialTitle: string;
}

export interface ParsedEuCelex {
  sector: "3";
  year: string;
  documentType: EuDocumentType;
  number: string;
}

const EU_ACT_CELEX_PATTERN = /^3(\d{4})([RLD])(\d{4})$/;

const EU_ACTS: readonly EuActEntry[] = [
  {
    celex: "32016R0679",
    documentType: "R",
    canonicalLawCode: "DSGVO",
    aliases: ["DSGVO", "GDPR", "RGPD", "RODO"],
    officialTitle: "Regulation (EU) 2016/679",
  },
  {
    celex: "32024R1689",
    documentType: "R",
    canonicalLawCode: "AIACT",
    aliases: ["AIACT", "AI-ACT", "AI ACT", "EU AI ACT", "AI-GESETZ", "AI-VO"],
    officialTitle: "Regulation (EU) 2024/1689",
  },
  {
    celex: "32023R2854",
    documentType: "R",
    canonicalLawCode: "DATA_ACT",
    aliases: ["DATA_ACT", "DATA ACT"],
    officialTitle: "Regulation (EU) 2023/2854",
  },
];

const euActsByLawCode = new Map<string, EuActEntry>();
const euActsByCelex = new Map<string, EuActEntry>();
const euActAliasList: string[] = [];

for (const entry of EU_ACTS) {
  euActsByCelex.set(entry.celex, entry);
  for (const alias of entry.aliases) {
    euActsByLawCode.set(alias, entry);
    euActAliasList.push(alias);
  }
}

export const EU_ACT_ALIASES: readonly string[] = euActAliasList;

export function euActForLawCode(lawCode: string): EuActEntry | null {
  return euActsByLawCode.get(lawCode.trim().toUpperCase()) ?? null;
}

export function euActForCelex(celex: string): EuActEntry | null {
  return euActsByCelex.get(celex) ?? null;
}

export function normalizeEuLawCode(lawCode: string): string | null {
  return euActForLawCode(lawCode)?.canonicalLawCode ?? null;
}

export function parseEuCelex(value: string): ParsedEuCelex | null {
  const match = EU_ACT_CELEX_PATTERN.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const number = Number(match[3]);
  if (!Number.isInteger(year) || year < 1952 || year > 2099) return null;
  if (!Number.isInteger(number) || number < 1) return null;
  return {
    sector: "3",
    year: match[1],
    documentType: match[2] as EuDocumentType,
    number: match[3],
  };
}