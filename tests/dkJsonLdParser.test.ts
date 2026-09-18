import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { parseRetsinformationJsonLd } from "../src/law/providers/RetsinformationDiscoveryIndex";

const ELI = "http://data.europa.eu/eli/ontology#";
const resourceId = "https://www.retsinformation.dk/eli/lta/2014/433";
const observedAt = "2026-09-18T10:00:00.000Z";

function fixture(overrides: Record<string, unknown> = {}): unknown[] {
  return [
    {
      "@id": resourceId,
      "@type": `${ELI}LegalResource`,
      [`${ELI}number`]: [{ "@value": "433" }],
      [`${ELI}type_document`]: [{ "@id": "http://www.retsinformation.dk/eli/resource/authority/type_document#LBKH" }],
      [`${ELI}responsibility_of`]: [{ "@value": "Justitsministeriet" }],
      [`${ELI}id_local`]: [{ "@value": "A20140043329" }],
      ...overrides,
    },
    {
      "@id": `${resourceId}/dan`,
      "@type": `${ELI}LegalExpression`,
      [`${ELI}realizes`]: [{ "@id": resourceId }],
      [`${ELI}title`]: [{ "@value": "Bekendtgørelse af forvaltningsloven" }],
      [`${ELI}title_alternative`]: [{ "@value": "Forvaltningsloven" }],
    },
  ];
}

describe("Retsinformation JSON-LD parser", () => {
  it("parses the official top-level graph and derives canonical identity fields", () => {
    assert.deepEqual(parseRetsinformationJsonLd(JSON.stringify(fixture()), "/eli/lta/2014/433", observedAt), {
      canonicalEli: "/eli/lta/2014/433",
      popularTitle: "Forvaltningsloven",
      documentTitle: "Bekendtgørelse af forvaltningsloven",
      documentType: "LBKH",
      pubMedia: "lta",
      year: "2014",
      number: "433",
      status: null,
      startDate: null,
      endDate: null,
      changeDate: null,
      accessionNumber: "A20140043329",
      ministry: "Justitsministeriet",
      announcedIn: null,
      sourceUpdateTimestamp: observedAt,
    });
  });

  it("supports an object with a JSON-LD @graph", () => {
    const result = parseRetsinformationJsonLd(JSON.stringify({ "@context": { eli: ELI }, "@graph": fixture() }), resourceId, observedAt);
    assert.equal(result?.canonicalEli, "/eli/lta/2014/433");
    assert.equal(result?.documentTitle, "Bekendtgørelse af forvaltningsloven");
  });

  it("requires the selected resource and an expression that realizes it", () => {
    const noResource = fixture().map((node) => ({ ...(node as object), ...(node as { "@id": string })["@id"] === resourceId ? { "@id": `${resourceId}/other` } : {} }));
    const noExpression = fixture().slice(0, 1);
    assert.equal(parseRetsinformationJsonLd(JSON.stringify(noResource), "/eli/lta/2014/433", observedAt), null);
    assert.equal(parseRetsinformationJsonLd(JSON.stringify(noExpression), "/eli/lta/2014/433", observedAt), null);
  });

  it("fails closed for foreign namespaces, missing required metadata, and a mismatched source number", () => {
    const foreignType = fixture({ "@type": "https://example.test/LegalResource" });
    const missingTitle = fixture();
    (missingTitle[1] as Record<string, unknown>)[`${ELI}title`] = undefined;
    const missingType = fixture();
    delete (missingType[0] as Record<string, unknown>)[`${ELI}type_document`];
    const wrongNumber = fixture({ [`${ELI}number`]: [{ "@value": "999" }] });
    assert.equal(parseRetsinformationJsonLd(JSON.stringify(foreignType), "/eli/lta/2014/433", observedAt), null);
    assert.equal(parseRetsinformationJsonLd(JSON.stringify(missingTitle), "/eli/lta/2014/433", observedAt), null);
    assert.equal(parseRetsinformationJsonLd(JSON.stringify(missingType), "/eli/lta/2014/433", observedAt), null);
    assert.equal(parseRetsinformationJsonLd(JSON.stringify(wrongNumber), "/eli/lta/2014/433", observedAt), null);
  });

  it("does not require optional source metadata", () => {
    const minimal = fixture();
    delete (minimal[0] as Record<string, unknown>)[`${ELI}responsibility_of`];
    delete (minimal[0] as Record<string, unknown>)[`${ELI}id_local`];
    delete (minimal[1] as Record<string, unknown>)[`${ELI}title_alternative`];
    const result = parseRetsinformationJsonLd(JSON.stringify(minimal), "/eli/lta/2014/433", observedAt);
    assert.equal(result?.popularTitle, null);
    assert.equal(result?.ministry, null);
    assert.equal(result?.accessionNumber, null);
  });
});
