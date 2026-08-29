import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  EU_ACT_ALIASES,
  euActForCelex,
  euActForCelexReference,
  euActForLawCode,
  normalizeEuLawCode,
  parseEuCelex,
} from "../src/law/euActRegistry";
import { parseLawReferenceWithSelectedJurisdiction } from "../src/parser";

describe("euActRegistry", () => {
  it("owns EU alias recognition instead of duplicating it in the parser", () => {
    const parserSource = readFileSync("src/parser.ts", "utf8");
    assert.doesNotMatch(parserSource, /new Set\(\["DSGVO", "GDPR", "RGPD", "RODO"\]\)/);
  });

  it("binds DSGVO, GDPR, RGPD, and RODO aliases to CELEX 32016R0679", () => {
    for (const alias of ["DSGVO", "GDPR", "RGPD", "RODO"]) {
      const entry = euActForLawCode(alias);
      assert.equal(entry?.celex, "32016R0679");
      assert.equal(entry?.canonicalLawCode, "DSGVO");
      assert.equal(entry?.documentType, "R");
      assert.equal(entry?.officialTitle, "Regulation (EU) 2016/679");
    }
  });

  it("binds AI Act aliases to CELEX 32024R1689", () => {
    for (const alias of ["AIACT", "AI_ACT", "AIA", "AI-ACT", "AI ACT", "EU AI ACT", "AI-GESETZ", "KI-VO", "AI-VO"]) {
      const entry = euActForLawCode(alias);
      assert.equal(entry?.celex, "32024R1689");
      assert.equal(entry?.canonicalLawCode, "AIACT");
      assert.equal(entry?.documentType, "R");
      assert.equal(entry?.officialTitle, "Regulation (EU) 2024/1689");
    }
  });

  it("binds Data Act aliases to CELEX 32023R2854", () => {
    for (const alias of ["DATA_ACT", "DATA ACT"]) {
      const entry = euActForLawCode(alias);
      assert.equal(entry?.celex, "32023R2854");
      assert.equal(entry?.canonicalLawCode, "DATA_ACT");
      assert.equal(entry?.documentType, "R");
      assert.equal(entry?.officialTitle, "Regulation (EU) 2023/2854");
    }
  });

  it("binds NIS2 aliases to CELEX 32022L2555", () => {
    for (const alias of ["NIS2", "NIS-2", "NIS 2"]) {
      const entry = euActForLawCode(alias);
      assert.equal(entry?.celex, "32022L2555");
      assert.equal(entry?.canonicalLawCode, "NIS2");
      assert.equal(entry?.documentType, "L");
      assert.equal(entry?.officialTitle, "Directive (EU) 2022/2555");
    }
  });

  it("normalizes NIS2 alias case-insensitively to canonical law code", () => {
    assert.equal(normalizeEuLawCode("nis2"), "NIS2");
    assert.equal(normalizeEuLawCode(" NIS-2 "), "NIS2");
    assert.equal(normalizeEuLawCode("NIS2"), "NIS2");
    assert.equal(normalizeEuLawCode("nis 2"), "NIS2");
  });

  it("resolves CELEX 32022L2555 to the NIS2 entry via euActForCelex", () => {
    const entry = euActForCelex("32022L2555");
    assert.ok(entry);
    assert.equal(entry.canonicalLawCode, "NIS2");
    assert.equal(entry.documentType, "L");
    assert.equal(entry.officialTitle, "Directive (EU) 2022/2555");
  });

  it("normalizes EU aliases case-insensitively to the canonical law code", () => {
    assert.equal(normalizeEuLawCode("gdpr"), "DSGVO");
    assert.equal(normalizeEuLawCode(" RGPD "), "DSGVO");
    assert.equal(normalizeEuLawCode("DSGVO"), "DSGVO");
    assert.equal(normalizeEuLawCode("BGB"), null);
    assert.equal(normalizeEuLawCode("aiact"), "AIACT");
    assert.equal(normalizeEuLawCode(" AI-ACT "), "AIACT");
    assert.equal(normalizeEuLawCode("EU AI ACT"), "AIACT");
    assert.equal(normalizeEuLawCode("ai_act"), "AIACT");
    assert.equal(normalizeEuLawCode("aia"), "AIACT");
    assert.equal(normalizeEuLawCode("KI-VO"), "AIACT");
    assert.equal(normalizeEuLawCode("data_act"), "DATA_ACT");
    assert.equal(normalizeEuLawCode(" Data Act "), "DATA_ACT");
  });

  it("exposes the supported EU alias set", () => {
    assert.deepEqual([...EU_ACT_ALIASES].sort(), [
      "AIA", "AI ACT", "AI-ACT", "AI_ACT", "AIACT", "AI-GESETZ", "AI-VO",
      "CER", "CER DIRECTIVE", "CRA", "CRITICAL ENTITIES RESILIENCE DIRECTIVE",
      "CROWDFUNDING REGULATION", "CYBER RESILIENCE ACT",
      "DATA ACT", "DATA_ACT", "DATA GOVERNANCE ACT",
      "DCD", "DGA", "DIGITAL CONTENT DIRECTIVE", "DIGITAL MARKETS ACT", "DIGITAL SERVICES ACT",
      "DMA", "DORA", "DSA", "DSGVO",
      "DSM COPYRIGHT", "DSM_COPYRIGHT", "DSM COPYRIGHT DIRECTIVE",
      "ECSP", "E_EVIDENCE_DIR", "E EVIDENCE DIRECTIVE", "E-EVIDENCE DIRECTIVE",
      "E_EVIDENCE_REG", "E EVIDENCE REGULATION", "E-EVIDENCE REGULATION",
      "EIDAS 2", "EIDAS-2", "EIDAS2", "EU AI ACT",
      "EUROPEAN CROWDFUNDING SERVICE PROVIDERS", "EUROPEAN DIGITAL IDENTITY FRAMEWORK",
      "FFNPD", "FREE FLOW OF NON-PERSONAL DATA",
      "GDPR", "GENERAL PRODUCT SAFETY REGULATION", "GPSR",
      "KI-VO",
      "MARKETS IN CRYPTO-ASSETS", "MI-CA", "MICA",
      "NIS 2", "NIS-2", "NIS2",
      "OMNIBUS", "OMNIBUS DIRECTIVE",
      "OPEN DATA", "OPEN_DATA", "OPEN DATA DIRECTIVE",
      "RGPD", "RODO",
      "SALE OF GOODS DIRECTIVE", "SGD",
      "TCO", "TERRORIST CONTENT ONLINE", "TERRORIST CONTENT ONLINE REGULATION",
      "TFR", "TRANSFER OF FUNDS REGULATION",
    ].sort());
  });

  it("resolves the AI Act CELEX and rejects every unregistered CELEX", () => {
    assert.equal(euActForCelex("32024R1689")?.canonicalLawCode, "AIACT");
    assert.equal(euActForCelex("32019L0791"), null);
    assert.equal(euActForCelex("32016R0679")?.canonicalLawCode, "DSGVO");
    assert.equal(euActForCelex("32023R2854")?.canonicalLawCode, "DATA_ACT");
    assert.equal(euActForCelex("32023R2855"), null);
  });

  it("creates exact synthetic entries for valid unregistered sector-3 acts", () => {
    for (const [celex, documentType] of [["32022R2066", "R"], ["32019L0791", "L"], ["32022D1234", "D"]] as const) {
      assert.deepEqual(euActForCelexReference(` ${celex.toLowerCase()} `), {
        celex,
        canonicalLawCode: celex,
        documentType,
        aliases: [],
        officialTitle: celex,
      });
    }
  });

  it("fails closed for non-resolvable CELEX values and unknown aliases", () => {
    for (const value of ["bad", "02022R2065", "52022R2065", "32022C2065", "DSA"]) {
      assert.equal(euActForCelexReference(value), null, value);
    }
  });
});

describe("parseEuCelex", () => {
  it("parses a valid sector-3 regulation", () => {
    assert.deepEqual(parseEuCelex("32016R0679"), {
      sector: "3",
      year: "2016",
      documentType: "R",
      number: "0679",
    });
  });

  it("parses valid sector-3 directive and decision shapes", () => {
    assert.equal(parseEuCelex("32019L0790")?.documentType, "L");
    assert.equal(parseEuCelex("32019D0797")?.documentType, "D");
    assert.equal(parseEuCelex("32019L0790")?.year, "2019");
    assert.equal(parseEuCelex("32019D0797")?.number, "0797");
  });

  it("fails closed for non-sector-3 CELEX", () => {
    assert.equal(parseEuCelex("02016R0679"), null);
    assert.equal(parseEuCelex("12016R0679"), null);
    assert.equal(parseEuCelex("22016R0679"), null);
    assert.equal(parseEuCelex("42016R0679"), null);
    assert.equal(parseEuCelex("62016R0679"), null);
  });

  it("fails closed for unsupported document types", () => {
    assert.equal(parseEuCelex("32016C0679"), null);
    assert.equal(parseEuCelex("32016A0679"), null);
    assert.equal(parseEuCelex("32016M0679"), null);
  });

  it("fails closed for malformed CELEX shapes", () => {
    for (const value of [
      "32016R679",
      "32016R06790",
      "32016r0679",
      "32016 R 0679",
      "32016R067X",
      "32016X0679",
      "32016R0000",
      "31001R0001",
      "32100R0001",
      "",
    ]) {
      assert.equal(parseEuCelex(value), null, value);
    }
  });

  it("validates CELEX sector/type/year/number consistency in registry", () => {
    const entry32016R0679 = euActForCelex("32016R0679");
    assert.ok(entry32016R0679);
    assert.equal(entry32016R0679.documentType, "R");
    const entry32024R1689 = euActForCelex("32024R1689");
    assert.ok(entry32024R1689);
    assert.equal(entry32024R1689.documentType, "R");
    const entry32023R2854 = euActForCelex("32023R2854");
    assert.ok(entry32023R2854);
    assert.equal(entry32023R2854.documentType, "R");
  });

  it("does not create synthetic entries for sector/CELEX combos that fail parseEuCelex", () => {
    assert.equal(euActForCelexReference("02016R0679"), null);
    assert.equal(euActForCelexReference("52016R0679"), null);
    assert.equal(euActForCelexReference("32016C0679"), null);
  });

  it("does not create synthetic entries for already-curated CELEX values", () => {
    for (const [celex, canonical] of [
      ["32022R2065", "DSA"],
      ["32022R1925", "DMA"],
      ["32022R2554", "DORA"],
      ["32024R2847", "CRA"],
      ["32022R0868", "DGA"],
    ] as const) {
      const entry = euActForCelexReference(celex);
      assert.ok(entry);
      assert.equal(entry.canonicalLawCode, canonical);
      assert.notEqual(entry.aliases.length, 0);
    }
  });
});

describe("Batch 1 EU digital/cyber acts", () => {
  const acts = [
    {
      celex: "32022R2065",
      canonicalLawCode: "DSA",
      aliases: ["DSA", "DIGITAL SERVICES ACT"],
      officialTitle: "Regulation (EU) 2022/2065",
    },
    {
      celex: "32022R1925",
      canonicalLawCode: "DMA",
      aliases: ["DMA", "DIGITAL MARKETS ACT"],
      officialTitle: "Regulation (EU) 2022/1925",
    },
    {
      celex: "32022R2554",
      canonicalLawCode: "DORA",
      aliases: ["DORA"],
      officialTitle: "Regulation (EU) 2022/2554",
    },
    {
      celex: "32024R2847",
      canonicalLawCode: "CRA",
      aliases: ["CRA", "CYBER RESILIENCE ACT"],
      officialTitle: "Regulation (EU) 2024/2847",
    },
    {
      celex: "32022R0868",
      canonicalLawCode: "DGA",
      aliases: ["DGA", "DATA GOVERNANCE ACT"],
      officialTitle: "Regulation (EU) 2022/868",
    },
  ] as const;

  for (const act of acts) {
    it(`binds ${act.canonicalLawCode} aliases to CELEX ${act.celex}`, () => {
      for (const alias of act.aliases) {
        const entry = euActForLawCode(alias);
        assert.equal(entry?.celex, act.celex);
        assert.equal(entry?.canonicalLawCode, act.canonicalLawCode);
        assert.equal(entry?.documentType, "R");
        assert.equal(entry?.officialTitle, act.officialTitle);
      }
    });

    it(`normalizes ${act.canonicalLawCode} alias case-insensitively to canonical law code`, () => {
      for (const alias of act.aliases) {
        assert.equal(normalizeEuLawCode(alias.toLowerCase()), act.canonicalLawCode);
        assert.equal(normalizeEuLawCode(` ${alias} `), act.canonicalLawCode);
        assert.equal(normalizeEuLawCode(alias), act.canonicalLawCode);
      }
    });

    it(`resolves CELEX ${act.celex} to the ${act.canonicalLawCode} entry via euActForCelex`, () => {
      const entry = euActForCelex(act.celex);
      assert.ok(entry);
      assert.equal(entry.canonicalLawCode, act.canonicalLawCode);
      assert.equal(entry.documentType, "R");
      assert.equal(entry.officialTitle, act.officialTitle);
    });

    it(`resolves CELEX ${act.celex} to the curated ${act.canonicalLawCode} entry via euActForCelexReference`, () => {
      const entry = euActForCelexReference(` ${act.celex.toLowerCase()} `);
      assert.ok(entry);
      assert.equal(entry.canonicalLawCode, act.canonicalLawCode);
      assert.notEqual(entry.aliases.length, 0);
      assert.equal(entry.officialTitle, act.officialTitle);
    });
  }

  it("keeps the registry unique across CELEX, canonical lawCode, and aliases", () => {
    const seenCelex = new Set<string>();
    const seenCanonical = new Set<string>();
    const seenAlias = new Set<string>();
    for (const entry of [euActForCelex("32016R0679"), euActForCelex("32024R1689"), euActForCelex("32023R2854"), euActForCelex("32022L2555"), ...acts.map((a) => euActForCelex(a.celex))].filter(Boolean) as Array<NonNullable<ReturnType<typeof euActForCelex>>>) {
      assert.ok(entry);
      assert.equal(seenCelex.has(entry.celex), false, `dup celex ${entry.celex}`);
      seenCelex.add(entry.celex);
      assert.equal(seenCanonical.has(entry.canonicalLawCode), false, `dup canonical ${entry.canonicalLawCode}`);
      seenCanonical.add(entry.canonicalLawCode);
      for (const alias of entry.aliases) {
        const normalized = alias.toUpperCase();
        assert.equal(seenAlias.has(normalized), false, `dup alias ${alias}`);
        seenAlias.add(normalized);
      }
    }
  });
});

describe("Wave 2 EU legal acts curation", () => {
  const wave2 = [
    {
      celex: "32022L2557",
      documentType: "L" as const,
      canonicalLawCode: "CER",
      aliases: ["CER", "CER DIRECTIVE", "CRITICAL ENTITIES RESILIENCE DIRECTIVE"],
      officialTitle: "Directive (EU) 2022/2557",
      section: "10",
    },
    {
      celex: "32024R1183",
      documentType: "R" as const,
      canonicalLawCode: "EIDAS2",
      aliases: ["EIDAS2", "EIDAS 2", "EIDAS-2", "EUROPEAN DIGITAL IDENTITY FRAMEWORK"],
      officialTitle: "Regulation (EU) 2024/1183",
      section: "1",
    },
    {
      celex: "32023R1114",
      documentType: "R" as const,
      canonicalLawCode: "MICA",
      aliases: ["MICA", "MI-CA", "MARKETS IN CRYPTO-ASSETS"],
      officialTitle: "Regulation (EU) 2023/1114",
      section: "4",
    },
    {
      celex: "32023R1113",
      documentType: "R" as const,
      canonicalLawCode: "TFR",
      aliases: ["TFR", "TRANSFER OF FUNDS REGULATION"],
      officialTitle: "Regulation (EU) 2023/1113",
      section: "4",
    },
    {
      celex: "32019L1024",
      documentType: "L" as const,
      canonicalLawCode: "OPEN_DATA",
      aliases: ["OPEN_DATA", "OPEN DATA", "OPEN DATA DIRECTIVE"],
      officialTitle: "Directive (EU) 2019/1024",
      section: "5",
    },
    {
      celex: "32019L0790",
      documentType: "L" as const,
      canonicalLawCode: "DSM_COPYRIGHT",
      aliases: ["DSM_COPYRIGHT", "DSM COPYRIGHT", "DSM COPYRIGHT DIRECTIVE"],
      officialTitle: "Directive (EU) 2019/790",
      section: "17",
    },
    {
      celex: "32019L0770",
      documentType: "L" as const,
      canonicalLawCode: "DCD",
      aliases: ["DCD", "DIGITAL CONTENT DIRECTIVE"],
      officialTitle: "Directive (EU) 2019/770",
      section: "5",
    },
    {
      celex: "32019L0771",
      documentType: "L" as const,
      canonicalLawCode: "SGD",
      aliases: ["SGD", "SALE OF GOODS DIRECTIVE"],
      officialTitle: "Directive (EU) 2019/771",
      section: "5",
    },
    {
      celex: "32019L2161",
      documentType: "L" as const,
      canonicalLawCode: "OMNIBUS",
      aliases: ["OMNIBUS", "OMNIBUS DIRECTIVE"],
      officialTitle: "Directive (EU) 2019/2161",
      section: "1",
    },
    {
      celex: "32018R1807",
      documentType: "R" as const,
      canonicalLawCode: "FFNPD",
      aliases: ["FFNPD", "FREE FLOW OF NON-PERSONAL DATA"],
      officialTitle: "Regulation (EU) 2018/1807",
      section: "4",
    },
    {
      celex: "32021R0784",
      documentType: "R" as const,
      canonicalLawCode: "TCO",
      aliases: ["TCO", "TERRORIST CONTENT ONLINE", "TERRORIST CONTENT ONLINE REGULATION"],
      officialTitle: "Regulation (EU) 2021/784",
      section: "3",
    },
    {
      celex: "32023R1543",
      documentType: "R" as const,
      canonicalLawCode: "E_EVIDENCE_REG",
      aliases: ["E_EVIDENCE_REG", "E-EVIDENCE REGULATION", "E EVIDENCE REGULATION"],
      officialTitle: "Regulation (EU) 2023/1543",
      section: "5",
    },
    {
      celex: "32023L1544",
      documentType: "L" as const,
      canonicalLawCode: "E_EVIDENCE_DIR",
      aliases: ["E_EVIDENCE_DIR", "E-EVIDENCE DIRECTIVE", "E EVIDENCE DIRECTIVE"],
      officialTitle: "Directive (EU) 2023/1544",
      section: "3",
    },
    {
      celex: "32020R1503",
      documentType: "R" as const,
      canonicalLawCode: "ECSP",
      aliases: ["ECSP", "CROWDFUNDING REGULATION", "EUROPEAN CROWDFUNDING SERVICE PROVIDERS"],
      officialTitle: "Regulation (EU) 2020/1503",
      section: "4",
    },
    {
      celex: "32023R0988",
      documentType: "R" as const,
      canonicalLawCode: "GPSR",
      aliases: ["GPSR", "GENERAL PRODUCT SAFETY REGULATION"],
      officialTitle: "Regulation (EU) 2023/988",
      section: "5",
    },
  ] as const;

  for (const act of wave2) {
    it(`binds ${act.canonicalLawCode} aliases to CELEX ${act.celex}`, () => {
      for (const alias of act.aliases) {
        const entry = euActForLawCode(alias);
        assert.equal(entry?.celex, act.celex);
        assert.equal(entry?.canonicalLawCode, act.canonicalLawCode);
        assert.equal(entry?.documentType, act.documentType);
        assert.equal(entry?.officialTitle, act.officialTitle);
      }
    });

    it(`normalizes ${act.canonicalLawCode} canonical alias case-insensitively`, () => {
      assert.equal(normalizeEuLawCode(act.canonicalLawCode.toLowerCase()), act.canonicalLawCode);
      assert.equal(normalizeEuLawCode(` ${act.canonicalLawCode} `), act.canonicalLawCode);
      assert.equal(normalizeEuLawCode(act.canonicalLawCode), act.canonicalLawCode);
    });

    it(`resolves CELEX ${act.celex} to the ${act.canonicalLawCode} entry via euActForCelex`, () => {
      const entry = euActForCelex(act.celex);
      assert.ok(entry);
      assert.equal(entry.canonicalLawCode, act.canonicalLawCode);
      assert.equal(entry.documentType, act.documentType);
      assert.equal(entry.officialTitle, act.officialTitle);
    });

    it(`resolves CELEX ${act.celex} to the curated ${act.canonicalLawCode} entry via euActForCelexReference`, () => {
      const entry = euActForCelexReference(` ${act.celex.toLowerCase()} `);
      assert.ok(entry);
      assert.equal(entry.canonicalLawCode, act.canonicalLawCode);
      assert.equal(entry.celex, act.celex);
      assert.notEqual(entry.aliases.length, 0);
      assert.equal(entry.officialTitle, act.officialTitle);
    });

    it(`resolves ${act.canonicalLawCode} canonical alias via selected EU parser`, () => {
      assert.deepEqual(
        parseLawReferenceWithSelectedJurisdiction(`${act.canonicalLawCode} Art. ${act.section}`, "EU"),
        {
          lawCode: act.canonicalLawCode,
          section: act.section,
          referenceType: "article",
          jurisdiction: "EU",
          euCelex: act.celex,
          euDocumentType: act.documentType,
        },
      );
    });

    it(`resolves direct CELEX ${act.celex} via selected EU parser`, () => {
      assert.deepEqual(
        parseLawReferenceWithSelectedJurisdiction(`Art. ${act.section} CELEX ${act.celex}`, "EU"),
        {
          lawCode: act.canonicalLawCode,
          section: act.section,
          referenceType: "article",
          jurisdiction: "EU",
          euCelex: act.celex,
          euDocumentType: act.documentType,
        },
      );
      assert.equal(
        parseLawReferenceWithSelectedJurisdiction(`${act.celex} Art. ${act.section}`, "DE"),
        null,
      );
    });

    for (const jurisdiction of ["DE", "AT", "CH"] as const) {
      it(`rejects ${act.canonicalLawCode} canonical alias under ${jurisdiction}`, () => {
        assert.equal(
          parseLawReferenceWithSelectedJurisdiction(`${act.canonicalLawCode} Art. ${act.section}`, jurisdiction),
          null,
        );
      });
    }
  }

  it("keeps Wave 2 registry unique across CELEX, canonical lawCode, and aliases", () => {
    const seenCelex = new Set<string>();
    const seenCanonical = new Set<string>();
    const seenAlias = new Set<string>();
    for (const act of wave2) {
      const entry = euActForCelex(act.celex);
      assert.ok(entry);
      assert.equal(seenCelex.has(entry.celex), false, `dup celex ${entry.celex}`);
      seenCelex.add(entry.celex);
      assert.equal(seenCanonical.has(entry.canonicalLawCode), false, `dup canonical ${entry.canonicalLawCode}`);
      seenCanonical.add(entry.canonicalLawCode);
      for (const alias of entry.aliases) {
        const normalized = alias.toUpperCase();
        assert.equal(seenAlias.has(normalized), false, `dup alias ${alias}`);
        seenAlias.add(normalized);
      }
    }
  });
});
