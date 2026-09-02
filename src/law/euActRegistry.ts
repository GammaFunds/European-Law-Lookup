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

const EU_ACT_CELEX_PATTERN = /^3(\d{4})([RLD])(\d{4,6})$/;

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
    aliases: ["AIACT", "AI_ACT", "AIA", "AI-ACT", "AI ACT", "EU AI ACT", "AI-GESETZ", "KI-VO", "AI-VO"],
    officialTitle: "Regulation (EU) 2024/1689",
  },
  {
    celex: "32023R2854",
    documentType: "R",
    canonicalLawCode: "DATA_ACT",
    aliases: ["DATA_ACT", "DATA ACT"],
    officialTitle: "Regulation (EU) 2023/2854",
  },
  {
    celex: "32022L2555",
    documentType: "L",
    canonicalLawCode: "NIS2",
    aliases: ["NIS2", "NIS-2", "NIS 2"],
    officialTitle: "Directive (EU) 2022/2555",
  },
  {
    celex: "32022R2065",
    documentType: "R",
    canonicalLawCode: "DSA",
    aliases: ["DSA", "DIGITAL SERVICES ACT"],
    officialTitle: "Regulation (EU) 2022/2065",
  },
  {
    celex: "32022R1925",
    documentType: "R",
    canonicalLawCode: "DMA",
    aliases: ["DMA", "DIGITAL MARKETS ACT"],
    officialTitle: "Regulation (EU) 2022/1925",
  },
  {
    celex: "32022R2554",
    documentType: "R",
    canonicalLawCode: "DORA",
    aliases: ["DORA"],
    officialTitle: "Regulation (EU) 2022/2554",
  },
  {
    celex: "32024R2847",
    documentType: "R",
    canonicalLawCode: "CRA",
    aliases: ["CRA", "CYBER RESILIENCE ACT"],
    officialTitle: "Regulation (EU) 2024/2847",
  },
  {
    celex: "32022R0868",
    documentType: "R",
    canonicalLawCode: "DGA",
    aliases: ["DGA", "DATA GOVERNANCE ACT"],
    officialTitle: "Regulation (EU) 2022/868",
  },
  {
    celex: "32022L2557",
    documentType: "L",
    canonicalLawCode: "CER",
    aliases: ["CER", "CER DIRECTIVE", "CRITICAL ENTITIES RESILIENCE DIRECTIVE"],
    officialTitle: "Directive (EU) 2022/2557",
  },
  {
    celex: "32024R1183",
    documentType: "R",
    canonicalLawCode: "EIDAS2",
    aliases: ["EIDAS2", "EIDAS 2", "EIDAS-2", "EUROPEAN DIGITAL IDENTITY FRAMEWORK"],
    officialTitle: "Regulation (EU) 2024/1183",
  },
  {
    celex: "32023R1114",
    documentType: "R",
    canonicalLawCode: "MICA",
    aliases: ["MICA", "MI-CA", "MARKETS IN CRYPTO-ASSETS"],
    officialTitle: "Regulation (EU) 2023/1114",
  },
  {
    celex: "32023R1113",
    documentType: "R",
    canonicalLawCode: "TFR",
    aliases: ["TFR", "TRANSFER OF FUNDS REGULATION"],
    officialTitle: "Regulation (EU) 2023/1113",
  },
  {
    celex: "32019L1024",
    documentType: "L",
    canonicalLawCode: "OPEN_DATA",
    aliases: ["OPEN_DATA", "OPEN DATA", "OPEN DATA DIRECTIVE"],
    officialTitle: "Directive (EU) 2019/1024",
  },
  {
    celex: "32019L0790",
    documentType: "L",
    canonicalLawCode: "DSM_COPYRIGHT",
    aliases: ["DSM_COPYRIGHT", "DSM COPYRIGHT", "DSM COPYRIGHT DIRECTIVE"],
    officialTitle: "Directive (EU) 2019/790",
  },
  {
    celex: "32019L0770",
    documentType: "L",
    canonicalLawCode: "DCD",
    aliases: ["DCD", "DIGITAL CONTENT DIRECTIVE"],
    officialTitle: "Directive (EU) 2019/770",
  },
  {
    celex: "32019L0771",
    documentType: "L",
    canonicalLawCode: "SGD",
    aliases: ["SGD", "SALE OF GOODS DIRECTIVE"],
    officialTitle: "Directive (EU) 2019/771",
  },
  {
    celex: "32019L2161",
    documentType: "L",
    canonicalLawCode: "OMNIBUS",
    aliases: ["OMNIBUS", "OMNIBUS DIRECTIVE"],
    officialTitle: "Directive (EU) 2019/2161",
  },
  {
    celex: "32018R1807",
    documentType: "R",
    canonicalLawCode: "FFNPD",
    aliases: ["FFNPD", "FREE FLOW OF NON-PERSONAL DATA"],
    officialTitle: "Regulation (EU) 2018/1807",
  },
  {
    celex: "32021R0784",
    documentType: "R",
    canonicalLawCode: "TCO",
    aliases: ["TCO", "TERRORIST CONTENT ONLINE", "TERRORIST CONTENT ONLINE REGULATION"],
    officialTitle: "Regulation (EU) 2021/784",
  },
  {
    celex: "32023R1543",
    documentType: "R",
    canonicalLawCode: "E_EVIDENCE_REG",
    aliases: ["E_EVIDENCE_REG", "E-EVIDENCE REGULATION", "E EVIDENCE REGULATION"],
    officialTitle: "Regulation (EU) 2023/1543",
  },
  {
    celex: "32023L1544",
    documentType: "L",
    canonicalLawCode: "E_EVIDENCE_DIR",
    aliases: ["E_EVIDENCE_DIR", "E-EVIDENCE DIRECTIVE", "E EVIDENCE DIRECTIVE"],
    officialTitle: "Directive (EU) 2023/1544",
  },
  {
    celex: "32020R1503",
    documentType: "R",
    canonicalLawCode: "ECSP",
    aliases: ["ECSP", "CROWDFUNDING REGULATION", "EUROPEAN CROWDFUNDING SERVICE PROVIDERS"],
    officialTitle: "Regulation (EU) 2020/1503",
  },
  {
    celex: "32023R0988",
    documentType: "R",
    canonicalLawCode: "GPSR",
    aliases: ["GPSR", "GENERAL PRODUCT SAFETY REGULATION"],
    officialTitle: "Regulation (EU) 2023/988",
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

export function euActForCelexReference(celex: string): EuActEntry | null {
  const normalizedCelex = celex.trim().toUpperCase();
  const curatedEntry = euActForCelex(normalizedCelex);
  if (curatedEntry) return curatedEntry;

  const parsed = parseEuCelex(normalizedCelex);
  if (!parsed) return null;

  return {
    celex: normalizedCelex,
    canonicalLawCode: normalizedCelex,
    documentType: parsed.documentType,
    aliases: [],
    officialTitle: normalizedCelex,
  };
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

function validateEuActRegistry(entries: readonly EuActEntry[]): void {
  const seenCelex = new Map<string, string>();
  const seenCanonical = new Map<string, string>();
  const seenAlias = new Map<string, string>();

  for (const entry of entries) {
    const parsed = parseEuCelex(entry.celex);
    if (!parsed) {
      throw new Error(`EU act registry: invalid CELEX format "${entry.celex}".`);
    }
    if (parsed.documentType !== entry.documentType) {
      throw new Error(
        `EU act registry: CELEX "${entry.celex}" declares documentType "${entry.documentType}" but parsed "${parsed.documentType}".`,
      );
    }

    const existingCelex = seenCelex.get(entry.celex);
    if (existingCelex) {
      throw new Error(
        `EU act registry: duplicate CELEX "${entry.celex}" (first: "${existingCelex}").`,
      );
    }
    seenCelex.set(entry.celex, entry.canonicalLawCode);

    const existingCanonical = seenCanonical.get(entry.canonicalLawCode);
    if (existingCanonical) {
      throw new Error(
        `EU act registry: duplicate canonicalLawCode "${entry.canonicalLawCode}" (CELEX "${entry.celex}" vs "${existingCanonical}").`,
      );
    }
    seenCanonical.set(entry.canonicalLawCode, entry.celex);

    for (const alias of entry.aliases) {
      const normalizedAlias = alias.toUpperCase();
      const existingAlias = seenAlias.get(normalizedAlias);
      if (existingAlias) {
        throw new Error(
          `EU act registry: duplicate alias "${alias}" (case-insensitive; entry "${entry.celex}" vs "${existingAlias}").`,
        );
      }
      seenAlias.set(normalizedAlias, entry.celex);
    }
  }
}

validateEuActRegistry(EU_ACTS);
