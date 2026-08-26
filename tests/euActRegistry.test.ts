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
      "AIACT", "AI_ACT", "AIA", "AI-ACT", "AI ACT", "EU AI ACT", "AI-GESETZ", "KI-VO", "AI-VO",
      "DSGVO", "GDPR", "RGPD", "RODO",
      "DATA_ACT", "DATA ACT",
    ].sort());
  });

  it("resolves the AI Act CELEX and rejects every unregistered CELEX", () => {
    assert.equal(euActForCelex("32024R1689")?.canonicalLawCode, "AIACT");
    assert.equal(euActForCelex("32019L0790"), null);
    assert.equal(euActForCelex("32016R0679")?.canonicalLawCode, "DSGVO");
    assert.equal(euActForCelex("32023R2854")?.canonicalLawCode, "DATA_ACT");
    assert.equal(euActForCelex("32023R2855"), null);
  });

  it("creates exact synthetic entries for valid unregistered sector-3 acts", () => {
    for (const [celex, documentType] of [["32022R2065", "R"], ["32022L2555", "L"], ["32022D1234", "D"]] as const) {
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
});
