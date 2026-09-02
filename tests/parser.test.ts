import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { parseLawReference, parseLawReferenceWithSelectedJurisdiction } from "../src/parser";

describe("parseLawReference", () => {
  it("parses GG article-first references", () => {
    assert.deepEqual(parseLawReference("Art. 1 GG"), {
      lawCode: "GG",
      section: "1",
      referenceType: "article",
    });
    assert.deepEqual(parseLawReference("Artikel 1 GG"), {
      lawCode: "GG",
      section: "1",
      referenceType: "article",
    });
    assert.deepEqual(parseLawReference("Art 1 GG"), {
      lawCode: "GG",
      section: "1",
      referenceType: "article",
    });
    assert.deepEqual(parseLawReference("art. 1 gg"), {
      lawCode: "GG",
      section: "1",
      referenceType: "article",
    });
    assert.deepEqual(parseLawReference("art 1 gg"), {
      lawCode: "GG",
      section: "1",
      referenceType: "article",
    });
    assert.deepEqual(parseLawReference("artikel 1 gg"), {
      lawCode: "GG",
      section: "1",
      referenceType: "article",
    });
  });

  it("parses GG law-code-first article references", () => {
    assert.deepEqual(parseLawReference("GG Art. 1"), {
      lawCode: "GG",
      section: "1",
      referenceType: "article",
    });
    assert.deepEqual(parseLawReference("GG Artikel 1"), {
      lawCode: "GG",
      section: "1",
      referenceType: "article",
    });
    assert.deepEqual(parseLawReference("GG art 1"), {
      lawCode: "GG",
      section: "1",
      referenceType: "article",
    });
    assert.deepEqual(parseLawReference("GG artikel 1"), {
      lawCode: "GG",
      section: "1",
      referenceType: "article",
    });
  });

  it("parses direct six-digit EU CELEX article references", () => {
    assert.deepEqual(parseLawReferenceWithSelectedJurisdiction("Art. 1 CELEX 32016R123456", "EU"), {
      lawCode: "32016R123456",
      section: "1",
      referenceType: "article",
      jurisdiction: "EU",
      euCelex: "32016R123456",
      euDocumentType: "R",
    });
  });

  it("parses explicit EGBGB pure article references", () => {
    assert.deepEqual(parseLawReference("Art. 1 EGBGB"), {
      lawCode: "EGBGB",
      section: "1",
      referenceType: "article",
    });
    assert.deepEqual(parseLawReference("Artikel 1 EGBGB"), {
      lawCode: "EGBGB",
      section: "1",
      referenceType: "article",
    });
    assert.deepEqual(parseLawReference("EGBGB Art. 1"), {
      lawCode: "EGBGB",
      section: "1",
      referenceType: "article",
    });
    assert.deepEqual(parseLawReference("EGBGB Artikel 1"), {
      lawCode: "EGBGB",
      section: "1",
      referenceType: "article",
    });
  });

  it("parses explicit EGBGB article-section references", () => {
    assert.deepEqual(parseLawReference("Art. 229 § 1 EGBGB"), {
      lawCode: "EGBGB",
      section: "229",
      subsection: "1",
      referenceType: "article",
    });
    assert.deepEqual(parseLawReference("art. 229 § 1 egbgb"), {
      lawCode: "EGBGB",
      section: "229",
      subsection: "1",
      referenceType: "article",
    });
    assert.deepEqual(parseLawReference("EGBGB Art. 229 § 1"), {
      lawCode: "EGBGB",
      section: "229",
      subsection: "1",
      referenceType: "article",
    });
    assert.deepEqual(parseLawReference("Art 229 § 1 EGBGB"), {
      lawCode: "EGBGB",
      section: "229",
      subsection: "1",
      referenceType: "article",
    });
    assert.deepEqual(parseLawReference("EGBGB Art 229 § 1"), {
      lawCode: "EGBGB",
      section: "229",
      subsection: "1",
      referenceType: "article",
    });
    assert.deepEqual(parseLawReference("Art. 246a § 1 EGBGB"), {
      lawCode: "EGBGB",
      section: "246a",
      subsection: "1",
      referenceType: "article",
    });
    assert.deepEqual(parseLawReference("EGBGB Art. 246a § 1"), {
      lawCode: "EGBGB",
      section: "246a",
      subsection: "1",
      referenceType: "article",
    });
    assert.deepEqual(parseLawReference("Artikel 229 § 1 EGBGB"), {
      lawCode: "EGBGB",
      section: "229",
      subsection: "1",
      referenceType: "article",
    });
    assert.deepEqual(parseLawReference("EGBGB Artikel 229 § 1"), {
      lawCode: "EGBGB",
      section: "229",
      subsection: "1",
      referenceType: "article",
    });
    assert.deepEqual(parseLawReference("Artikel 246a § 1 EGBGB"), {
      lawCode: "EGBGB",
      section: "246a",
      subsection: "1",
      referenceType: "article",
    });
    assert.deepEqual(parseLawReference("EGBGB Artikel 246a § 1"), {
      lawCode: "EGBGB",
      section: "246a",
      subsection: "1",
      referenceType: "article",
    });
    assert.deepEqual(parseLawReference("Art. 229 § 6 EGBGB"), {
      lawCode: "EGBGB",
      section: "229",
      subsection: "6",
      referenceType: "article",
    });
    assert.deepEqual(parseLawReference("EGBGB Art. 229 § 67"), {
      lawCode: "EGBGB",
      section: "229",
      subsection: "67",
      referenceType: "article",
    });
    assert.deepEqual(parseLawReference("Artikel 247 § 3 EGBGB"), {
      lawCode: "EGBGB",
      section: "247",
      subsection: "3",
      referenceType: "article",
    });
    assert.deepEqual(parseLawReference("EGBGB Artikel 247 § 3"), {
      lawCode: "EGBGB",
      section: "247",
      subsection: "3",
      referenceType: "article",
    });
  });

  it("parses law-code-first references with section sign", () => {
    assert.deepEqual(parseLawReference("FreizügG/EU § 1"), {
      lawCode: "FREIZÜGG/EU",
      section: "1",
    });
    assert.deepEqual(parseLawReference("BVerfGG § 1"), {
      lawCode: "BVERFGG",
      section: "1",
    });
    assert.deepEqual(parseLawReference("BDSG § 1"), {
      lawCode: "BDSG",
      section: "1",
    });
    assert.deepEqual(parseLawReference("UWG § 1"), {
      lawCode: "UWG",
      section: "1",
    });
    assert.deepEqual(parseLawReference("VVG § 1"), {
      lawCode: "VVG",
      section: "1",
    });
    assert.deepEqual(parseLawReference("AGG § 1"), {
      lawCode: "AGG",
      section: "1",
    });
    assert.deepEqual(parseLawReference("GWB § 1"), {
      lawCode: "GWB",
      section: "1",
    });
    assert.deepEqual(parseLawReference("KWG § 1"), {
      lawCode: "KWG",
      section: "1",
    });
    assert.deepEqual(parseLawReference("KAGB § 1"), {
      lawCode: "KAGB",
      section: "1",
    });
    assert.deepEqual(parseLawReference("OWiG § 1"), {
      lawCode: "OWIG",
      section: "1",
    });
    assert.deepEqual(parseLawReference("BGB § 823"), {
      lawCode: "BGB",
      section: "823",
    });
    assert.deepEqual(parseLawReference("StGB § 242"), {
      lawCode: "STGB",
      section: "242",
    });
  });

  it("parses law-code-first references without section sign", () => {
    assert.deepEqual(parseLawReference("FreizügG/EU 1"), {
      lawCode: "FREIZÜGG/EU",
      section: "1",
    });
    assert.deepEqual(parseLawReference("BVerfGG 1"), {
      lawCode: "BVERFGG",
      section: "1",
    });
    assert.deepEqual(parseLawReference("BDSG 1"), {
      lawCode: "BDSG",
      section: "1",
    });
    assert.deepEqual(parseLawReference("UWG 1"), {
      lawCode: "UWG",
      section: "1",
    });
    assert.deepEqual(parseLawReference("VVG 1"), {
      lawCode: "VVG",
      section: "1",
    });
    assert.deepEqual(parseLawReference("AGG 1"), {
      lawCode: "AGG",
      section: "1",
    });
    assert.deepEqual(parseLawReference("GWB 1"), {
      lawCode: "GWB",
      section: "1",
    });
    assert.deepEqual(parseLawReference("KWG 1"), {
      lawCode: "KWG",
      section: "1",
    });
    assert.deepEqual(parseLawReference("OWiG 1"), {
      lawCode: "OWIG",
      section: "1",
    });
    assert.deepEqual(parseLawReference("BGB 823"), {
      lawCode: "BGB",
      section: "823",
    });
    assert.deepEqual(parseLawReference("GwG 10"), {
      lawCode: "GWG",
      section: "10",
    });
    assert.deepEqual(parseLawReference("StGB 242"), {
      lawCode: "STGB",
      section: "242",
    });
  });

  it("parses explicit spaced SGB law-code-first references", () => {
    assert.deepEqual(parseLawReference("SGB V § 1"), {
      lawCode: "SGB V",
      section: "1",
    });
    assert.deepEqual(parseLawReference("SGB III § 1"), {
      lawCode: "SGB III",
      section: "1",
    });
    assert.deepEqual(parseLawReference("SGB IX 1"), {
      lawCode: "SGB IX",
      section: "1",
    });
    assert.deepEqual(parseLawReference("SGB X 1"), {
      lawCode: "SGB X",
      section: "1",
    });
    assert.deepEqual(parseLawReference("SGB XIV 1"), {
      lawCode: "SGB XIV",
      section: "1",
    });
    assert.deepEqual(parseLawReference("SGB I 1"), {
      lawCode: "SGB I",
      section: "1",
    });
    assert.deepEqual(parseLawReference("SGB II 1"), {
      lawCode: "SGB II",
      section: "1",
    });
  });

  it("parses section-first references with section sign", () => {
    assert.deepEqual(parseLawReference("§ 1 FreizügG/EU"), {
      lawCode: "FREIZÜGG/EU",
      section: "1",
    });
    assert.deepEqual(parseLawReference("§ 1 BVerfGG"), {
      lawCode: "BVERFGG",
      section: "1",
    });
    assert.deepEqual(parseLawReference("§ 1 BDSG"), {
      lawCode: "BDSG",
      section: "1",
    });
    assert.deepEqual(parseLawReference("§ 1 UWG"), {
      lawCode: "UWG",
      section: "1",
    });
    assert.deepEqual(parseLawReference("§ 1 VVG"), {
      lawCode: "VVG",
      section: "1",
    });
    assert.deepEqual(parseLawReference("§ 1 AGG"), {
      lawCode: "AGG",
      section: "1",
    });
    assert.deepEqual(parseLawReference("§ 1 GWB"), {
      lawCode: "GWB",
      section: "1",
    });
    assert.deepEqual(parseLawReference("§ 1 KWG"), {
      lawCode: "KWG",
      section: "1",
    });
    assert.deepEqual(parseLawReference("§ 1 OWiG"), {
      lawCode: "OWIG",
      section: "1",
    });
    assert.deepEqual(parseLawReference("§ 823 BGB"), {
      lawCode: "BGB",
      section: "823",
    });
    assert.deepEqual(parseLawReference("§ 242 StGB"), {
      lawCode: "STGB",
      section: "242",
    });
  });

  it("parses explicit spaced SGB section-first references", () => {
    assert.deepEqual(parseLawReference("1 BDSG"), {
      lawCode: "BDSG",
      section: "1",
    });
    assert.deepEqual(parseLawReference("1 UWG"), {
      lawCode: "UWG",
      section: "1",
    });
    assert.deepEqual(parseLawReference("1 VVG"), {
      lawCode: "VVG",
      section: "1",
    });
    assert.deepEqual(parseLawReference("1 AGG"), {
      lawCode: "AGG",
      section: "1",
    });
    assert.deepEqual(parseLawReference("1 GWB"), {
      lawCode: "GWB",
      section: "1",
    });
    assert.deepEqual(parseLawReference("1 KWG"), {
      lawCode: "KWG",
      section: "1",
    });
    assert.deepEqual(parseLawReference("§ 1 SGB V"), {
      lawCode: "SGB V",
      section: "1",
    });
    assert.deepEqual(parseLawReference("§ 1 SGB III"), {
      lawCode: "SGB III",
      section: "1",
    });
    assert.deepEqual(parseLawReference("1 SGB IX"), {
      lawCode: "SGB IX",
      section: "1",
    });
    assert.deepEqual(parseLawReference("1 SGB X"), {
      lawCode: "SGB X",
      section: "1",
    });
    assert.deepEqual(parseLawReference("1 SGB XIV"), {
      lawCode: "SGB XIV",
      section: "1",
    });
    assert.deepEqual(parseLawReference("1 SGB I"), {
      lawCode: "SGB I",
      section: "1",
    });
    assert.deepEqual(parseLawReference("1 SGB II"), {
      lawCode: "SGB II",
      section: "1",
    });
  });

  it("parses section-first references without section sign", () => {
    assert.deepEqual(parseLawReference("1 FreizügG/EU"), {
      lawCode: "FREIZÜGG/EU",
      section: "1",
    });
    assert.deepEqual(parseLawReference("1 BVerfGG"), {
      lawCode: "BVERFGG",
      section: "1",
    });
    assert.deepEqual(parseLawReference("1 OWiG"), {
      lawCode: "OWIG",
      section: "1",
    });
    assert.deepEqual(parseLawReference("823 BGB"), {
      lawCode: "BGB",
      section: "823",
    });
    assert.deepEqual(parseLawReference("823a BGB"), {
      lawCode: "BGB",
      section: "823a",
    });
    assert.deepEqual(parseLawReference("312g BGB"), {
      lawCode: "BGB",
      section: "312g",
    });
    assert.deepEqual(parseLawReference("312G BGB"), {
      lawCode: "BGB",
      section: "312G",
    });
    assert.deepEqual(parseLawReference("242 StGB"), {
      lawCode: "STGB",
      section: "242",
    });
  });

  it("returns null for unsupported input", () => {
    assert.equal(parseLawReference("not a law reference"), null);
    assert.equal(parseLawReference("Art. 1 BGB"), null);
    assert.equal(parseLawReference("§ 1 EGBGB"), null);
    assert.equal(parseLawReference("EGBGB § 1"), null);
    assert.equal(parseLawReference("EGBGB 1"), null);
    assert.equal(parseLawReference("1 EGBGB"), null);
  });

  it("parses AT ABGB references with jurisdiction AT and various orderings", () => {
    assert.deepEqual(parseLawReference("AT ABGB § 1295"), {
      lawCode: "ABGB",
      section: "1295",
      jurisdiction: "AT",
    });
    assert.deepEqual(parseLawReference("AT § 1295 ABGB"), {
      lawCode: "ABGB",
      section: "1295",
      jurisdiction: "AT",
    });
    assert.deepEqual(parseLawReference("ABGB AT § 1295"), {
      lawCode: "ABGB",
      section: "1295",
      jurisdiction: "AT",
    });
    assert.deepEqual(parseLawReference("§ 1295 ABGB AT"), {
      lawCode: "ABGB",
      section: "1295",
      jurisdiction: "AT",
    });
    assert.deepEqual(parseLawReference("AT ABGB 1295"), {
      lawCode: "ABGB",
      section: "1295",
      jurisdiction: "AT",
    });
    assert.deepEqual(parseLawReference("AT 1295 ABGB"), {
      lawCode: "ABGB",
      section: "1295",
      jurisdiction: "AT",
    });
  });

  it("parses AT StGB references with jurisdiction AT", () => {
    assert.deepEqual(parseLawReference("AT StGB § 75"), {
      lawCode: "STGB",
      section: "75",
      jurisdiction: "AT",
    });
    assert.deepEqual(parseLawReference("AT § 75 StGB"), {
      lawCode: "STGB",
      section: "75",
      jurisdiction: "AT",
    });
    assert.deepEqual(parseLawReference("StGB AT § 75"), {
      lawCode: "STGB",
      section: "75",
      jurisdiction: "AT",
    });
    assert.deepEqual(parseLawReference("§ 75 StGB AT"), {
      lawCode: "STGB",
      section: "75",
      jurisdiction: "AT",
    });
  });

  it("parses AT B-VG article references with jurisdiction AT", () => {
    assert.deepEqual(parseLawReference("AT B-VG Art. 144"), {
      lawCode: "B-VG",
      section: "144",
      referenceType: "article",
      jurisdiction: "AT",
    });
    assert.deepEqual(parseLawReference("AT Art. 144 B-VG"), {
      lawCode: "B-VG",
      section: "144",
      referenceType: "article",
      jurisdiction: "AT",
    });
    assert.deepEqual(parseLawReference("B-VG Art. 144 AT"), {
      lawCode: "B-VG",
      section: "144",
      referenceType: "article",
      jurisdiction: "AT",
    });
    assert.deepEqual(parseLawReference("Art. 144 B-VG AT"), {
      lawCode: "B-VG",
      section: "144",
      referenceType: "article",
      jurisdiction: "AT",
    });
  });

  it("does not add jurisdiction for bare StGB references", () => {
    const result = parseLawReference("StGB § 75");
    assert.notEqual(result, null);
    assert.equal(result!.jurisdiction, undefined);
    assert.equal(result!.lawCode, "STGB");
    assert.equal(result!.section, "75");

    const result2 = parseLawReference("§ 242 StGB");
    assert.notEqual(result2, null);
    assert.equal(result2!.jurisdiction, undefined);
    assert.equal(result2!.lawCode, "STGB");
    assert.equal(result2!.section, "242");
  });

  it("parses AT ABGB § 1294", () => {
    assert.deepEqual(parseLawReference("AT ABGB § 1294"), {
      lawCode: "ABGB",
      section: "1294",
      jurisdiction: "AT",
    });
  });
});
