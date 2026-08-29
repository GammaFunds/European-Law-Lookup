import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import {
  enrichJurisdiction,
  parseLawReference,
  parseLawReferenceWithSelectedJurisdiction,
  type ParsedLawReference,
} from "../src/parser";

describe("jurisdiction enrichment", () => {
  it("isolates EU DSGVO aliases to the selected EU jurisdiction", () => {
    const acceptedForms = [
      "DSGVO Art. 6",
      "Art. 6 DSGVO",
      "GDPR Art. 6",
      "Art. 6 GDPR",
      "RGPD Art. 6",
      "Art. 6 RGPD",
      "RODO Art. 6",
      "Art. 6 RODO",
    ];

    for (const input of acceptedForms) {
      assert.deepEqual(parseLawReferenceWithSelectedJurisdiction(input, "EU"), {
        lawCode: "DSGVO",
        section: "6",
        referenceType: "article",
        jurisdiction: "EU",
        euCelex: "32016R0679",
        euDocumentType: "R",
      });
    }

    for (const jurisdiction of ["DE", "AT", "CH"] as const) {
      for (const input of acceptedForms) {
        assert.equal(parseLawReferenceWithSelectedJurisdiction(input, jurisdiction), null);
      }
    }

    assert.equal(parseLawReferenceWithSelectedJurisdiction("DSGVO § 6", "EU"), null);
    assert.equal(parseLawReferenceWithSelectedJurisdiction("GDPR § 6", "EU"), null);
    assert.equal(parseLawReferenceWithSelectedJurisdiction("RGPD § 6", "EU"), null);
    assert.equal(parseLawReferenceWithSelectedJurisdiction("RODO § 6", "EU"), null);

    for (const jurisdiction of ["DE", "AT", "CH"] as const) {
      for (const input of ["DSGVO § 6", "GDPR § 6", "RGPD § 6", "RODO § 6"] as const) {
        assert.equal(parseLawReferenceWithSelectedJurisdiction(input, jurisdiction), null);
      }
    }

    assert.deepEqual(
      parseLawReferenceWithSelectedJurisdiction("AT StGB § 75", "EU"),
      {
        lawCode: "STGB",
        section: "75",
        jurisdiction: "AT",
      },
    );
  });

  it("isolates AI Act aliases to the selected EU jurisdiction", () => {
    const acceptedForms = [
      "AIACT Art. 1",
      "Art. 1 AIACT",
      "AI_ACT Art. 1",
      "Art. 1 AI_ACT",
      "AIA Art. 1",
      "Art. 1 AIA",
      "AI-ACT Art. 1",
      "Art. 1 AI-ACT",
      "AI ACT Art. 1",
      "Art. 1 AI ACT",
      "EU AI ACT Art. 1",
      "Art. 1 EU AI ACT",
      "AI-GESETZ Art. 1",
      "Art. 1 AI-GESETZ",
      "KI-VO Art. 1",
      "Art. 1 KI-VO",
      "AI-VO Art. 1",
      "Art. 1 AI-VO",
    ];

    for (const input of acceptedForms) {
      assert.deepEqual(parseLawReferenceWithSelectedJurisdiction(input, "EU"), {
        lawCode: "AIACT",
        section: "1",
        referenceType: "article",
        jurisdiction: "EU",
        euCelex: "32024R1689",
        euDocumentType: "R",
      });
    }

    for (const jurisdiction of ["DE", "AT", "CH"] as const) {
      for (const input of acceptedForms) {
        assert.equal(parseLawReferenceWithSelectedJurisdiction(input, jurisdiction), null);
      }
    }
  });

  it("isolates Data Act aliases to the selected EU jurisdiction", () => {
    const acceptedForms = [
      "DATA_ACT Art. 1",
      "Art. 1 DATA_ACT",
      "DATA ACT Art. 1",
      "Art. 1 DATA ACT",
      "Data Act Art. 1",
      "Art. 1 Data Act",
    ];

    for (const input of acceptedForms) {
      assert.deepEqual(parseLawReferenceWithSelectedJurisdiction(input, "EU"), {
        lawCode: "DATA_ACT",
        section: "1",
        referenceType: "article",
        jurisdiction: "EU",
        euCelex: "32023R2854",
        euDocumentType: "R",
      });
    }

    for (const jurisdiction of ["DE", "AT", "CH"] as const) {
      for (const input of acceptedForms) {
        assert.equal(parseLawReferenceWithSelectedJurisdiction(input, jurisdiction), null);
      }
    }
  });

  it("parses registered CELEX article references only for EU", () => {
    for (const input of [
      "32016R0679 Art. 6",
      "CELEX:32016R0679 Art. 6",
      "Art. 6 CELEX 32016R0679",
    ]) {
      assert.deepEqual(parseLawReferenceWithSelectedJurisdiction(input, "EU"), {
        lawCode: "DSGVO",
        section: "6",
        referenceType: "article",
        jurisdiction: "EU",
        euCelex: "32016R0679",
        euDocumentType: "R",
      });
    }

    assert.deepEqual(
      parseLawReferenceWithSelectedJurisdiction("32024R1689 Art. 1", "EU"),
      {
        lawCode: "AIACT",
        section: "1",
        referenceType: "article",
        jurisdiction: "EU",
        euCelex: "32024R1689",
        euDocumentType: "R",
      },
    );
    assert.deepEqual(
      parseLawReferenceWithSelectedJurisdiction("32023R2854 Art. 1", "EU"),
      {
        lawCode: "DATA_ACT",
        section: "1",
        referenceType: "article",
        jurisdiction: "EU",
        euCelex: "32023R2854",
        euDocumentType: "R",
      },
    );
    assert.equal(
      parseLawReferenceWithSelectedJurisdiction("32016R0679 Art. 6", "DE"),
      null,
    );
  });

  it("parses valid unregistered CELEX articles only for EU", () => {
    for (const [input, lawCode, section] of [
      ["32022R2066 Art. 12", "32022R2066", "12"],
      ["Art. 7 32022L2555", "NIS2", "7"],
      ["CELEX:32022D1234 Art. 1", "32022D1234", "1"],
    ] as const) {
      assert.deepEqual(parseLawReferenceWithSelectedJurisdiction(input, "EU"), {
        lawCode,
        section,
        referenceType: "article",
        jurisdiction: "EU",
        euCelex: lawCode === "NIS2" ? "32022L2555" : lawCode,
        euDocumentType: lawCode === "NIS2" ? "L" : lawCode.includes("R") ? "R" : lawCode.includes("L") ? "L" : "D",
      });
      assert.equal(parseLawReferenceWithSelectedJurisdiction(input, "DE"), null);
    }

    for (const input of ["bad Art. 1", "02022R2065 Art. 1", "52022R2065 Art. 1", "32022C2065 Art. 1"]) {
      assert.equal(parseLawReferenceWithSelectedJurisdiction(input, "EU"), null, input);
    }
  });
  it("keeps Deutschland selection DE/default-compatible for bare StGB", () => {
    assert.deepEqual(
      parseLawReferenceWithSelectedJurisdiction("StGB § 75", "DE"),
      {
        lawCode: "STGB",
        section: "75",
      },
    );
  });

  it("keeps Art. 1 GG valid under Deutschland selection", () => {
    assert.deepEqual(
      parseLawReferenceWithSelectedJurisdiction("Art. 1 GG", "DE"),
      {
        lawCode: "GG",
        section: "1",
        referenceType: "article",
      },
    );
  });

  it("adds AT when Österreich is selected and no jurisdiction is explicit", () => {
    assert.deepEqual(
      parseLawReferenceWithSelectedJurisdiction("StGB § 75", "AT"),
      {
        lawCode: "STGB",
        section: "75",
        jurisdiction: "AT",
      },
    );
  });

  it("adds AT for ABGB when Österreich is selected", () => {
    assert.deepEqual(
      parseLawReferenceWithSelectedJurisdiction("ABGB § 1295", "AT"),
      {
        lawCode: "ABGB",
        section: "1295",
        jurisdiction: "AT",
      },
    );
  });

  it("parses B-VG article references when Österreich is selected", () => {
    assert.deepEqual(
      parseLawReferenceWithSelectedJurisdiction("B-VG Art. 144", "AT"),
      {
        lawCode: "B-VG",
        section: "144",
        referenceType: "article",
        jurisdiction: "AT",
      },
    );
  });

  it("preserves explicit AT jurisdiction regardless of dropdown selection", () => {
    const parsed = parseLawReference("AT StGB § 75");
    assert.notEqual(parsed, null);

    assert.deepEqual(enrichJurisdiction(parsed!, "DE"), {
      lawCode: "STGB",
      section: "75",
      jurisdiction: "AT",
    });

    assert.deepEqual(
      parseLawReferenceWithSelectedJurisdiction("AT StGB § 75", "DE"),
      {
        lawCode: "STGB",
        section: "75",
        jurisdiction: "AT",
      },
    );
  });

  it("does not add jurisdiction for bare StGB when Deutschland is selected", () => {
    assert.deepEqual(
      parseLawReferenceWithSelectedJurisdiction("StGB § 242", "DE"),
      {
        lawCode: "STGB",
        section: "242",
      },
    );
  });

  it("preserves explicit DE jurisdiction when CH or AT is selected", () => {
    const reference: ParsedLawReference = {
      lawCode: "GG",
      section: "1",
      referenceType: "article",
      jurisdiction: "DE",
    };

    assert.deepEqual(enrichJurisdiction(reference, "CH"), {
      lawCode: "GG",
      section: "1",
      referenceType: "article",
      jurisdiction: "DE",
    });

    assert.deepEqual(enrichJurisdiction(reference, "AT"), {
      lawCode: "GG",
      section: "1",
      referenceType: "article",
      jurisdiction: "DE",
    });
  });

  describe("CH jurisdiction", () => {
    it("keeps Art. 8 BV valid under Switzerland selection", () => {
      assert.deepEqual(
        parseLawReferenceWithSelectedJurisdiction("Art. 8 BV", "CH"),
        {
          lawCode: "BV",
          section: "8",
          referenceType: "article",
          jurisdiction: "CH",
        },
      );
    });

    it("parses BV Art. 8 when Switzerland is selected", () => {
      assert.deepEqual(
        parseLawReferenceWithSelectedJurisdiction("BV Art. 8", "CH"),
        {
          lawCode: "BV",
          section: "8",
          referenceType: "article",
          jurisdiction: "CH",
        },
      );
    });

    it("parses Artikel 41 BV when Switzerland is selected", () => {
      assert.deepEqual(
        parseLawReferenceWithSelectedJurisdiction("Artikel 41 BV", "CH"),
        {
          lawCode: "BV",
          section: "41",
          referenceType: "article",
          jurisdiction: "CH",
        },
      );
    });

    it("parses Art. 1 ZGB when Switzerland is selected", () => {
      assert.deepEqual(
        parseLawReferenceWithSelectedJurisdiction("Art. 1 ZGB", "CH"),
        {
          lawCode: "ZGB",
          section: "1",
          referenceType: "article",
          jurisdiction: "CH",
        },
      );
    });

    it("parses ZGB Art. 1 when Switzerland is selected", () => {
      assert.deepEqual(
        parseLawReferenceWithSelectedJurisdiction("ZGB Art. 1", "CH"),
        {
          lawCode: "ZGB",
          section: "1",
          referenceType: "article",
          jurisdiction: "CH",
        },
      );
    });

    it("rejects StGB § 75 when Switzerland is selected", () => {
      assert.equal(
        parseLawReferenceWithSelectedJurisdiction("StGB § 75", "CH"),
        null,
      );
    });

    it("rejects Art. 1 GG when Switzerland is selected", () => {
      assert.equal(
        parseLawReferenceWithSelectedJurisdiction("Art. 1 GG", "CH"),
        null,
      );
    });

    it("rejects § 8 BV when Switzerland is selected", () => {
      assert.equal(
        parseLawReferenceWithSelectedJurisdiction("§ 8 BV", "CH"),
        null,
      );
    });

    it("parses OR Art. 1 when Switzerland is selected", () => {
      assert.deepEqual(
        parseLawReferenceWithSelectedJurisdiction("OR Art. 1", "CH"),
        {
          lawCode: "OR",
          section: "1",
          referenceType: "article",
          jurisdiction: "CH",
        },
      );
    });

    it("parses STGB Art. 1 when Switzerland is selected", () => {
      assert.deepEqual(
        parseLawReferenceWithSelectedJurisdiction("STGB Art. 1", "CH"),
        {
          lawCode: "STGB",
          section: "1",
          referenceType: "article",
          jurisdiction: "CH",
        },
      );
    });

    it("parses ZPO Art. 1 when Switzerland is selected", () => {
      assert.deepEqual(
        parseLawReferenceWithSelectedJurisdiction("ZPO Art. 1", "CH"),
        {
          lawCode: "ZPO",
          section: "1",
          referenceType: "article",
          jurisdiction: "CH",
        },
      );
    });

    it("parses STPO Art. 1 when Switzerland is selected", () => {
      assert.deepEqual(
        parseLawReferenceWithSelectedJurisdiction("STPO Art. 1", "CH"),
        {
          lawCode: "STPO",
          section: "1",
          referenceType: "article",
          jurisdiction: "CH",
        },
      );
    });

    it("parses SCHKG Art. 1 when Switzerland is selected", () => {
      assert.deepEqual(
        parseLawReferenceWithSelectedJurisdiction("SCHKG Art. 1", "CH"),
        {
          lawCode: "SCHKG",
          section: "1",
          referenceType: "article",
          jurisdiction: "CH",
        },
      );
    });

    it("parses VWVG Art. 1 when Switzerland is selected", () => {
      assert.deepEqual(
        parseLawReferenceWithSelectedJurisdiction("VWVG Art. 1", "CH"),
        {
          lawCode: "VWVG",
          section: "1",
          referenceType: "article",
          jurisdiction: "CH",
        },
      );
    });

    it("parses BGG Art. 1 when Switzerland is selected", () => {
      assert.deepEqual(
        parseLawReferenceWithSelectedJurisdiction("BGG Art. 1", "CH"),
        {
          lawCode: "BGG",
          section: "1",
          referenceType: "article",
          jurisdiction: "CH",
        },
      );
    });

    it("parses DSG Art. 1 when Switzerland is selected", () => {
      assert.deepEqual(
        parseLawReferenceWithSelectedJurisdiction("DSG Art. 1", "CH"),
        {
          lawCode: "DSG",
          section: "1",
          referenceType: "article",
          jurisdiction: "CH",
        },
      );
    });

    it("parses Art. 321a STGB when Switzerland is selected", () => {
      assert.deepEqual(
        parseLawReferenceWithSelectedJurisdiction("Art. 321a STGB", "CH"),
        {
          lawCode: "STGB",
          section: "321a",
          referenceType: "article",
          jurisdiction: "CH",
        },
      );
    });

    it("preserves DE/default behavior for StGB § 75 when Deutschland is selected", () => {
      assert.deepEqual(
        parseLawReferenceWithSelectedJurisdiction("StGB § 75", "DE"),
        {
          lawCode: "STGB",
          section: "75",
        },
      );
    });

    it("preserves DE/default behavior for Art. 1 GG when Deutschland is selected", () => {
      assert.deepEqual(
        parseLawReferenceWithSelectedJurisdiction("Art. 1 GG", "DE"),
        {
          lawCode: "GG",
          section: "1",
          referenceType: "article",
        },
      );
    });

    it("preserves AT behavior for B-VG Art. 144 when Österreich is selected", () => {
      assert.deepEqual(
        parseLawReferenceWithSelectedJurisdiction("B-VG Art. 144", "AT"),
        {
          lawCode: "B-VG",
          section: "144",
          referenceType: "article",
          jurisdiction: "AT",
        },
      );
    });

    it("preserves explicit AT jurisdiction when another dropdown value is selected", () => {
      assert.deepEqual(
        parseLawReferenceWithSelectedJurisdiction("AT StGB § 75", "CH"),
        {
          lawCode: "STGB",
          section: "75",
          jurisdiction: "AT",
        },
      );
    });

    it("preserves explicit AT jurisdiction when DE is selected", () => {
      assert.deepEqual(
        parseLawReferenceWithSelectedJurisdiction("AT StGB § 75", "DE"),
        {
          lawCode: "STGB",
          section: "75",
          jurisdiction: "AT",
        },
      );
    });
  });

  it("adds AT for GmbHG when Österreich is selected", () => {
    assert.deepEqual(
      parseLawReferenceWithSelectedJurisdiction("GmbHG § 1", "AT"),
      {
        lawCode: "GMBHG",
        section: "1",
        jurisdiction: "AT",
      },
    );
  });

  it("preserves DE/default for GmbHG § 1 when Deutschland is selected", () => {
    assert.deepEqual(
      parseLawReferenceWithSelectedJurisdiction("GmbHG § 1", "DE"),
      {
        lawCode: "GMBHG",
        section: "1",
      },
    );
  });

  it("adds AT for AktG when Österreich is selected", () => {
    assert.deepEqual(
      parseLawReferenceWithSelectedJurisdiction("AktG § 1", "AT"),
      {
        lawCode: "AKTG",
        section: "1",
        jurisdiction: "AT",
      },
    );
  });

  it("preserves DE/default for AktG § 1 when Deutschland is selected", () => {
    assert.deepEqual(
      parseLawReferenceWithSelectedJurisdiction("AktG § 1", "DE"),
      {
        lawCode: "AKTG",
        section: "1",
      },
    );
  });

  it("adds AT for KSchG when Österreich is selected", () => {
    assert.deepEqual(
      parseLawReferenceWithSelectedJurisdiction("KSchG § 1", "AT"),
      {
        lawCode: "KSCHG",
        section: "1",
        jurisdiction: "AT",
      },
    );
  });

  it("preserves DE/default for KSchG § 1 when Deutschland is selected", () => {
    assert.deepEqual(
      parseLawReferenceWithSelectedJurisdiction("KSchG § 1", "DE"),
      {
        lawCode: "KSCHG",
        section: "1",
      },
    );
  });

  it("adds AT for DSG § 1 when Österreich is selected", () => {
    assert.deepEqual(
      parseLawReferenceWithSelectedJurisdiction("DSG § 1", "AT"),
      {
        lawCode: "DSG",
        section: "1",
        jurisdiction: "AT",
      },
    );
  });

  describe("NIS2 jurisdiction enrichment", () => {
    it("resolves NIS2 alias to NIS2 under EU jurisdiction", () => {
      assert.deepEqual(
        parseLawReferenceWithSelectedJurisdiction("NIS2 Art. 7", "EU"),
        {
          lawCode: "NIS2",
          section: "7",
          referenceType: "article",
          jurisdiction: "EU",
          euCelex: "32022L2555",
          euDocumentType: "L",
        },
      );
    });

    it("resolves Art. form NIS2 alias to NIS2 under EU jurisdiction", () => {
      assert.deepEqual(
        parseLawReferenceWithSelectedJurisdiction("Art. 7 NIS2", "EU"),
        {
          lawCode: "NIS2",
          section: "7",
          referenceType: "article",
          jurisdiction: "EU",
          euCelex: "32022L2555",
          euDocumentType: "L",
        },
      );
    });

    it("rejects NIS2 alias under DE jurisdiction", () => {
      assert.equal(
        parseLawReferenceWithSelectedJurisdiction("NIS2 Art. 7", "DE"),
        null,
      );
    });

    it("rejects NIS2 alias under AT jurisdiction", () => {
      assert.equal(
        parseLawReferenceWithSelectedJurisdiction("NIS2 Art. 7", "AT"),
        null,
      );
    });

    it("rejects NIS2 alias under CH jurisdiction", () => {
      assert.equal(
        parseLawReferenceWithSelectedJurisdiction("NIS2 Art. 7", "CH"),
        null,
      );
    });

    it("canonicalizes direct CELEX 32022L2555 to NIS2 under EU jurisdiction", () => {
      assert.deepEqual(
        parseLawReferenceWithSelectedJurisdiction("32022L2555 Art. 7", "EU"),
        {
          lawCode: "NIS2",
          section: "7",
          referenceType: "article",
          jurisdiction: "EU",
          euCelex: "32022L2555",
          euDocumentType: "L",
        },
      );
    });

    it("resolves hyphenated NIS-2 alias to NIS2 under EU jurisdiction", () => {
      assert.deepEqual(
        parseLawReferenceWithSelectedJurisdiction("NIS-2 Art. 21", "EU"),
        {
          lawCode: "NIS2",
          section: "21",
          referenceType: "article",
          jurisdiction: "EU",
          euCelex: "32022L2555",
          euDocumentType: "L",
        },
      );
    });

    it("resolves spaced NIS 2 alias to NIS2 under EU jurisdiction", () => {
      assert.deepEqual(
        parseLawReferenceWithSelectedJurisdiction("NIS 2 Art. 21", "EU"),
        {
          lawCode: "NIS2",
          section: "21",
          referenceType: "article",
          jurisdiction: "EU",
          euCelex: "32022L2555",
          euDocumentType: "L",
        },
      );
    });

    it("resolves Art. form spaced NIS 2 alias to NIS2 under EU jurisdiction", () => {
      assert.deepEqual(
        parseLawReferenceWithSelectedJurisdiction("Art. 21 NIS 2", "EU"),
        {
          lawCode: "NIS2",
          section: "21",
          referenceType: "article",
          jurisdiction: "EU",
          euCelex: "32022L2555",
          euDocumentType: "L",
        },
      );
    });

    it("rejects spaced NIS 2 alias under DE jurisdiction", () => {
      assert.equal(
        parseLawReferenceWithSelectedJurisdiction("NIS 2 Art. 21", "DE"),
        null,
      );
    });

    it("rejects spaced NIS 2 alias under AT jurisdiction", () => {
      assert.equal(
        parseLawReferenceWithSelectedJurisdiction("NIS 2 Art. 21", "AT"),
        null,
      );
    });

    it("rejects spaced NIS 2 alias under CH jurisdiction", () => {
      assert.equal(
        parseLawReferenceWithSelectedJurisdiction("NIS 2 Art. 21", "CH"),
        null,
      );
    });
  });
});

describe("Batch 1 EU digital/cyber acts jurisdiction enrichment", () => {
  const acts = [
    {
      canonicalLawCode: "DSA",
      celex: "32022R2065",
      aliases: ["DSA", "DIGITAL SERVICES ACT"],
      section: "16",
      longNameInput: "DIGITAL SERVICES ACT Art. 16",
    },
    {
      canonicalLawCode: "DMA",
      celex: "32022R1925",
      aliases: ["DMA", "DIGITAL MARKETS ACT"],
      section: "5",
      longNameInput: "DIGITAL MARKETS ACT Art. 5",
    },
    {
      canonicalLawCode: "DORA",
      celex: "32022R2554",
      aliases: ["DORA"],
      section: "6",
      longNameInput: "DORA Art. 6",
    },
    {
      canonicalLawCode: "CRA",
      celex: "32024R2847",
      aliases: ["CRA", "CYBER RESILIENCE ACT"],
      section: "13",
      longNameInput: "CYBER RESILIENCE ACT Art. 13",
    },
    {
      canonicalLawCode: "DGA",
      celex: "32022R0868",
      aliases: ["DGA", "DATA GOVERNANCE ACT"],
      section: "5",
      longNameInput: "DATA GOVERNANCE ACT Art. 5",
    },
  ] as const;

  for (const act of acts) {
    it(`isolates ${act.canonicalLawCode} aliases to the selected EU jurisdiction`, () => {
      const acceptedForms = [
        ...act.aliases.map((alias) => `${alias} Art. ${act.section}`),
        ...act.aliases.map((alias) => `Art. ${act.section} ${alias}`),
      ];

      for (const input of acceptedForms) {
        assert.deepEqual(parseLawReferenceWithSelectedJurisdiction(input, "EU"), {
          lawCode: act.canonicalLawCode,
          section: act.section,
          referenceType: "article",
          jurisdiction: "EU",
          euCelex: act.celex,
          euDocumentType: "R",
        });
      }

      for (const jurisdiction of ["DE", "AT", "CH"] as const) {
        for (const input of acceptedForms) {
          assert.equal(parseLawReferenceWithSelectedJurisdiction(input, jurisdiction), null);
        }
      }
    });

    it(`canonicalizes direct CELEX ${act.celex} to ${act.canonicalLawCode} under EU jurisdiction`, () => {
      assert.deepEqual(
        parseLawReferenceWithSelectedJurisdiction(`${act.celex} Art. ${act.section}`, "EU"),
        {
          lawCode: act.canonicalLawCode,
          section: act.section,
          referenceType: "article",
          jurisdiction: "EU",
          euCelex: act.celex,
          euDocumentType: "R",
        },
      );
      assert.equal(
        parseLawReferenceWithSelectedJurisdiction(`${act.celex} Art. ${act.section}`, "DE"),
        null,
      );
    });
  }
});

describe("CH Phase 1C exact contract matrix", () => {
  const accepted = [
    ["OR Art. 1", "OR", "1"],
    ["Art. 1 OR", "OR", "1"],
    ["OR Art. 321a", "OR", "321a"],
    ["StGB Art. 111", "STGB", "111"],
    ["ZPO Art. 1", "ZPO", "1"],
    ["StPO Art. 1", "STPO", "1"],
    ["SchKG Art. 1", "SCHKG", "1"],
    ["VwVG Art. 1", "VWVG", "1"],
    ["BGG Art. 42", "BGG", "42"],
    ["DSG Art. 1", "DSG", "1"],
  ] as const;

  for (const [input, lawCode, section] of accepted) {
    it(`accepts ${input} for selected CH`, () => {
      assert.deepEqual(
        parseLawReferenceWithSelectedJurisdiction(input, "CH"),
        {
          lawCode,
          section,
          referenceType: "article",
          jurisdiction: "CH",
        },
      );
    });
  }

  for (const input of [
    "OR § 1",
    "StGB § 111",
    "ZPO § 1",
    "Art. 1 GG",
    "XYZ Art. 1",
  ]) {
    it(`rejects ${input} for selected CH`, () => {
      assert.equal(
        parseLawReferenceWithSelectedJurisdiction(input, "CH"),
        null,
      );
    });
  }

  it("preserves DE/default StGB § 211", () => {
    assert.deepEqual(
      parseLawReferenceWithSelectedJurisdiction("StGB § 211", "DE"),
      {
        lawCode: "STGB",
        section: "211",
      },
    );
  });

  it("preserves AT StGB § 75", () => {
    assert.deepEqual(
      parseLawReferenceWithSelectedJurisdiction("StGB § 75", "AT"),
      {
        lawCode: "STGB",
        section: "75",
        jurisdiction: "AT",
      },
    );
  });

  it("preserves an explicit DE reference under selected CH", () => {
    const reference: ParsedLawReference = {
      lawCode: "GG",
      section: "1",
      referenceType: "article",
      jurisdiction: "DE",
    };

    assert.deepEqual(enrichJurisdiction(reference, "CH"), reference);
  });

  it("preserves an explicit AT reference under selected CH", () => {
    assert.deepEqual(
      parseLawReferenceWithSelectedJurisdiction(
        "AT StGB § 75",
        "CH",
      ),
      {
        lawCode: "STGB",
        section: "75",
        jurisdiction: "AT",
      },
    );
  });

  it("preserves existing BV and ZGB article behavior", () => {
    assert.deepEqual(
      parseLawReferenceWithSelectedJurisdiction("Art. 8 BV", "CH"),
      {
        lawCode: "BV",
        section: "8",
        referenceType: "article",
        jurisdiction: "CH",
      },
    );

    assert.deepEqual(
      parseLawReferenceWithSelectedJurisdiction("ZGB Art. 1", "CH"),
      {
        lawCode: "ZGB",
        section: "1",
        referenceType: "article",
        jurisdiction: "CH",
      },
    );
  });
});

describe("EU CELEX identity equivalence", () => {
  it("DSGVO alias and direct 32016R0679 produce identical technical identity", () => {
    const alias = parseLawReferenceWithSelectedJurisdiction("DSGVO Art. 6", "EU")!;
    const direct = parseLawReferenceWithSelectedJurisdiction("32016R0679 Art. 6", "EU")!;
    assert.equal(alias.lawCode, direct.lawCode);
    assert.equal(alias.euCelex, direct.euCelex);
    assert.equal(alias.euDocumentType, direct.euDocumentType);
    assert.equal(alias.section, direct.section);
    assert.equal(alias.referenceType, direct.referenceType);
    assert.equal(alias.jurisdiction, direct.jurisdiction);
    assert.equal(alias.euCelex, "32016R0679");
    assert.equal(alias.euDocumentType, "R");
  });

  it("GDPR alias and direct 32016R0679 produce identical technical identity", () => {
    const alias = parseLawReferenceWithSelectedJurisdiction("GDPR Art. 6", "EU")!;
    const direct = parseLawReferenceWithSelectedJurisdiction("32016R0679 Art. 6", "EU")!;
    assert.equal(alias.euCelex, direct.euCelex);
    assert.equal(alias.euDocumentType, direct.euDocumentType);
    assert.equal(alias.lawCode, direct.lawCode);
  });

  it("AIACT alias and direct 32024R1689 produce identical technical identity", () => {
    const alias = parseLawReferenceWithSelectedJurisdiction("AIACT Art. 1", "EU")!;
    const direct = parseLawReferenceWithSelectedJurisdiction("32024R1689 Art. 1", "EU")!;
    assert.equal(alias.euCelex, direct.euCelex);
    assert.equal(alias.euDocumentType, direct.euDocumentType);
    assert.equal(alias.lawCode, direct.lawCode);
    assert.equal(alias.euCelex, "32024R1689");
  });

  it("DATA_ACT alias and direct 32023R2854 produce identical technical identity", () => {
    const alias = parseLawReferenceWithSelectedJurisdiction("DATA_ACT Art. 1", "EU")!;
    const direct = parseLawReferenceWithSelectedJurisdiction("32023R2854 Art. 1", "EU")!;
    assert.equal(alias.euCelex, direct.euCelex);
    assert.equal(alias.euDocumentType, direct.euDocumentType);
    assert.equal(alias.lawCode, direct.lawCode);
    assert.equal(alias.euCelex, "32023R2854");
  });

  it("Art. form alias and direct CELEX produce identical technical identity", () => {
    const alias = parseLawReferenceWithSelectedJurisdiction("Art. 6 DSGVO", "EU")!;
    const direct = parseLawReferenceWithSelectedJurisdiction("Art. 6 CELEX 32016R0679", "EU")!;
    assert.equal(alias.euCelex, direct.euCelex);
    assert.equal(alias.euDocumentType, direct.euDocumentType);
    assert.equal(alias.lawCode, direct.lawCode);
  });

  it("NIS2 alias and direct 32022L2555 produce identical technical identity", () => {
    const alias = parseLawReferenceWithSelectedJurisdiction("NIS2 Art. 7", "EU")!;
    const direct = parseLawReferenceWithSelectedJurisdiction("32022L2555 Art. 7", "EU")!;
    assert.equal(alias.lawCode, direct.lawCode);
    assert.equal(alias.euCelex, direct.euCelex);
    assert.equal(alias.euDocumentType, direct.euDocumentType);
    assert.equal(alias.section, direct.section);
    assert.equal(alias.referenceType, direct.referenceType);
    assert.equal(alias.jurisdiction, direct.jurisdiction);
    assert.equal(alias.euCelex, "32022L2555");
    assert.equal(alias.euDocumentType, "L");
  });
});

describe("CH Phase 1D exact contract matrix", () => {
  const accepted = [
    ["IPRG Art. 1", "IPRG"],
    ["Art. 1 IPRG", "IPRG"],
    ["DBG Art. 1", "DBG"],
    ["StHG Art. 1", "STHG"],
    ["AHVG Art. 1", "AHVG"],
    ["IVG Art. 1", "IVG"],
    ["ATSG Art. 1", "ATSG"],
    ["ArG Art. 1", "ARG"],
    ["SVG Art. 1", "SVG"],
    ["AIG Art. 1", "AIG"],
    ["KG Art. 1", "KG"],
    ["URG Art. 1", "URG"],
    ["PatG Art. 1", "PATG"],
    ["MSchG Art. 1", "MSCHG"],
  ] as const;

  for (const [input, lawCode] of accepted) {
    it(`accepts ${input} for selected CH`, () => {
      assert.deepEqual(
        parseLawReferenceWithSelectedJurisdiction(input, "CH"),
        {
          lawCode,
          section: "1",
          referenceType: "article",
          jurisdiction: "CH",
        },
      );
    });
  }

  for (const input of [
    "IPRG § 1",
    "DBG § 1",
    "ArG § 1",
    "MSchG § 1",
  ]) {
    it(`rejects ${input} for selected CH`, () => {
      assert.equal(
        parseLawReferenceWithSelectedJurisdiction(input, "CH"),
        null,
      );
    });
  }

  it("preserves existing BV, ZGB, DE, and AT behavior", () => {
    assert.deepEqual(
      parseLawReferenceWithSelectedJurisdiction("BV Art. 8", "CH"),
      {
        lawCode: "BV",
        section: "8",
        referenceType: "article",
        jurisdiction: "CH",
      },
    );

    assert.deepEqual(
      parseLawReferenceWithSelectedJurisdiction("ZGB Art. 1", "CH"),
      {
        lawCode: "ZGB",
        section: "1",
        referenceType: "article",
        jurisdiction: "CH",
      },
    );

    assert.deepEqual(
      parseLawReferenceWithSelectedJurisdiction("StGB § 211", "DE"),
      {
        lawCode: "STGB",
        section: "211",
      },
    );

    assert.deepEqual(
      parseLawReferenceWithSelectedJurisdiction("StGB § 75", "AT"),
      {
        lawCode: "STGB",
        section: "75",
        jurisdiction: "AT",
      },
    );
  });
});

describe("Wave 2 EU legal acts jurisdiction enrichment", () => {
  const acts = [
    { canonicalLawCode: "CER", celex: "32022L2557", documentType: "L" as const, aliases: ["CER", "CER DIRECTIVE", "CRITICAL ENTITIES RESILIENCE DIRECTIVE"], section: "10", longNameInput: "CRITICAL ENTITIES RESILIENCE DIRECTIVE Art. 10" },
    { canonicalLawCode: "EIDAS2", celex: "32024R1183", documentType: "R" as const, aliases: ["EIDAS2", "EIDAS 2", "EIDAS-2", "EUROPEAN DIGITAL IDENTITY FRAMEWORK"], section: "1", longNameInput: "EUROPEAN DIGITAL IDENTITY FRAMEWORK Art. 1" },
    { canonicalLawCode: "MICA", celex: "32023R1114", documentType: "R" as const, aliases: ["MICA", "MI-CA", "MARKETS IN CRYPTO-ASSETS"], section: "4", longNameInput: "MARKETS IN CRYPTO-ASSETS Art. 4" },
    { canonicalLawCode: "TFR", celex: "32023R1113", documentType: "R" as const, aliases: ["TFR", "TRANSFER OF FUNDS REGULATION"], section: "4", longNameInput: "TRANSFER OF FUNDS REGULATION Art. 4" },
    { canonicalLawCode: "OPEN_DATA", celex: "32019L1024", documentType: "L" as const, aliases: ["OPEN_DATA", "OPEN DATA", "OPEN DATA DIRECTIVE"], section: "5", longNameInput: "OPEN DATA DIRECTIVE Art. 5" },
    { canonicalLawCode: "DSM_COPYRIGHT", celex: "32019L0790", documentType: "L" as const, aliases: ["DSM_COPYRIGHT", "DSM COPYRIGHT", "DSM COPYRIGHT DIRECTIVE"], section: "17", longNameInput: "DSM COPYRIGHT DIRECTIVE Art. 17" },
    { canonicalLawCode: "DCD", celex: "32019L0770", documentType: "L" as const, aliases: ["DCD", "DIGITAL CONTENT DIRECTIVE"], section: "5", longNameInput: "DIGITAL CONTENT DIRECTIVE Art. 5" },
    { canonicalLawCode: "SGD", celex: "32019L0771", documentType: "L" as const, aliases: ["SGD", "SALE OF GOODS DIRECTIVE"], section: "5", longNameInput: "SALE OF GOODS DIRECTIVE Art. 5" },
    { canonicalLawCode: "OMNIBUS", celex: "32019L2161", documentType: "L" as const, aliases: ["OMNIBUS", "OMNIBUS DIRECTIVE"], section: "1", longNameInput: "OMNIBUS DIRECTIVE Art. 1" },
    { canonicalLawCode: "FFNPD", celex: "32018R1807", documentType: "R" as const, aliases: ["FFNPD", "FREE FLOW OF NON-PERSONAL DATA"], section: "4", longNameInput: "FREE FLOW OF NON-PERSONAL DATA Art. 4" },
    { canonicalLawCode: "TCO", celex: "32021R0784", documentType: "R" as const, aliases: ["TCO", "TERRORIST CONTENT ONLINE", "TERRORIST CONTENT ONLINE REGULATION"], section: "3", longNameInput: "TERRORIST CONTENT ONLINE REGULATION Art. 3" },
    { canonicalLawCode: "E_EVIDENCE_REG", celex: "32023R1543", documentType: "R" as const, aliases: ["E_EVIDENCE_REG", "E-EVIDENCE REGULATION", "E EVIDENCE REGULATION"], section: "5", longNameInput: "E-EVIDENCE REGULATION Art. 5" },
    { canonicalLawCode: "E_EVIDENCE_DIR", celex: "32023L1544", documentType: "L" as const, aliases: ["E_EVIDENCE_DIR", "E-EVIDENCE DIRECTIVE", "E EVIDENCE DIRECTIVE"], section: "3", longNameInput: "E-EVIDENCE DIRECTIVE Art. 3" },
    { canonicalLawCode: "ECSP", celex: "32020R1503", documentType: "R" as const, aliases: ["ECSP", "CROWDFUNDING REGULATION", "EUROPEAN CROWDFUNDING SERVICE PROVIDERS"], section: "4", longNameInput: "EUROPEAN CROWDFUNDING SERVICE PROVIDERS Art. 4" },
    { canonicalLawCode: "GPSR", celex: "32023R0988", documentType: "R" as const, aliases: ["GPSR", "GENERAL PRODUCT SAFETY REGULATION"], section: "5", longNameInput: "GENERAL PRODUCT SAFETY REGULATION Art. 5" },
  ] as const;

  for (const act of acts) {
    it(`isolates ${act.canonicalLawCode} aliases to the selected EU jurisdiction`, () => {
      const acceptedForms = [
        ...act.aliases.map((alias) => `${alias} Art. ${act.section}`),
        ...act.aliases.map((alias) => `Art. ${act.section} ${alias}`),
      ];

      for (const input of acceptedForms) {
        assert.deepEqual(parseLawReferenceWithSelectedJurisdiction(input, "EU"), {
          lawCode: act.canonicalLawCode,
          section: act.section,
          referenceType: "article",
          jurisdiction: "EU",
          euCelex: act.celex,
          euDocumentType: act.documentType,
        });
      }

      for (const jurisdiction of ["DE", "AT", "CH"] as const) {
        for (const input of acceptedForms) {
          assert.equal(parseLawReferenceWithSelectedJurisdiction(input, jurisdiction), null);
        }
      }
    });

    it(`canonicalizes direct CELEX ${act.celex} to ${act.canonicalLawCode} under EU jurisdiction`, () => {
      assert.deepEqual(
        parseLawReferenceWithSelectedJurisdiction(`${act.celex} Art. ${act.section}`, "EU"),
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
  }
});
