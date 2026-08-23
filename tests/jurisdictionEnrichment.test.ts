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
      });
    }

    assert.deepEqual(
      parseLawReferenceWithSelectedJurisdiction("32024R1689 Art. 1", "EU"),
      {
        lawCode: "AIACT",
        section: "1",
        referenceType: "article",
        jurisdiction: "EU",
      },
    );
    assert.deepEqual(
      parseLawReferenceWithSelectedJurisdiction("32023R2854 Art. 1", "EU"),
      {
        lawCode: "DATA_ACT",
        section: "1",
        referenceType: "article",
        jurisdiction: "EU",
      },
    );
    assert.equal(
      parseLawReferenceWithSelectedJurisdiction("32016R0679 Art. 6", "DE"),
      null,
    );
  });

  it("parses valid unregistered CELEX articles only for EU", () => {
    for (const [input, lawCode, section] of [
      ["32022R2065 Art. 12", "32022R2065", "12"],
      ["Art. 7 32022L2555", "32022L2555", "7"],
      ["CELEX:32022D1234 Art. 1", "32022D1234", "1"],
    ] as const) {
      assert.deepEqual(parseLawReferenceWithSelectedJurisdiction(input, "EU"), {
        lawCode,
        section,
        referenceType: "article",
        jurisdiction: "EU",
      });
      assert.equal(parseLawReferenceWithSelectedJurisdiction(input, "DE"), null);
    }

    for (const input of ["bad Art. 1", "02022R2065 Art. 1", "52022R2065 Art. 1", "32022C2065 Art. 1", "DSA Art. 1"]) {
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
