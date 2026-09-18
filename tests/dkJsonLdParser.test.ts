import { strict as assert } from "node:assert";
import { test } from "node:test";
import { parseRetsinformationJsonLd } from "../src/law/providers/RetsinformationDiscoveryIndex";

const ELI = "http://data.europa.eu/eli/ontology#";
const canonicalEli = "/eli/lta/2014/433";
const resourceId = `https://retsinformation.dk${canonicalEli}`;
const observedAt = "2026-09-18T12:34:56.789Z";
const typeDocumentId = "http://www.retsinformation.dk/eli/resource/authority/type_document#LBKH";
const fullStatus = `${ELI}InForce-inForce`;

function resource(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    "@id": resourceId,
    "@type": [`${ELI}LegalResource`],
    [`${ELI}number`]: [{ "@value": "433" }],
    [`${ELI}type_document`]: [{ "@id": typeDocumentId }],
    ...overrides,
  };
}

function expression(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    "@id": `${resourceId}/dan`,
    "@type": [`${ELI}LegalExpression`],
    [`${ELI}realizes`]: [{ "@value": resourceId }],
    [`${ELI}title`]: [{ "@value": "  Bekendtgørelse af forvaltningsloven\r\n" }],
    ...overrides,
  };
}

function graph(resourceOverrides: Record<string, unknown> = {}, expressionOverrides: Record<string, unknown> = {}) {
  return [resource(resourceOverrides), expression(expressionOverrides)];
}

function parse(json: unknown, eli = canonicalEli) {
  return parseRetsinformationJsonLd(json, eli, observedAt);
}

test("accepts an official top-level array and maps required and optional metadata", () => {
  const result = parse(
    graph(
      {
        [`${ELI}responsibility_of`]: [{ "@value": "Justitsministeriet" }],
        [`${ELI}id_local`]: [{ "@value": "A20140043329" }],
        [`${ELI}in_force`]: [{ "@id": fullStatus }],
      },
      { [`${ELI}title_alternative`]: [{ "@value": "Forvaltningsloven" }] },
    ),
  );

  assert.deepEqual(result, {
    canonicalEli,
    popularTitle: "Forvaltningsloven",
    documentTitle: "Bekendtgørelse af forvaltningsloven",
    documentType: "LBKH",
    pubMedia: "lta",
    year: "2014",
    number: "433",
    status: fullStatus,
    startDate: null,
    endDate: null,
    changeDate: null,
    accessionNumber: "A20140043329",
    ministry: "Justitsministeriet",
    announcedIn: null,
    sourceUpdateTimestamp: observedAt,
  });
});

test("accepts an @graph object, string @types, and realizes via @id", () => {
  const result = parse({
    "@graph": graph(
      { "@type": `${ELI}LegalResource` },
      {
        "@type": `${ELI}LegalExpression`,
        [`${ELI}realizes`]: [{ "@id": resourceId }],
      },
    ),
  });
  assert.equal(result?.documentTitle, "Bekendtgørelse af forvaltningsloven");
});

test("requires exact no-www resource identity and exact realizing expression", () => {
  assert.equal(parse(graph({ "@id": `https://www.retsinformation.dk${canonicalEli}` })), null);
  assert.equal(parse(graph({ "@id": "https://foreign.example/eli/lta/2014/433" })), null);
  assert.equal(
    parse(graph({}, { [`${ELI}realizes`]: [{ "@value": `${resourceId}/other` }] })),
    null,
  );
});

test("requires a valid canonical identity, title, document type, and matching source number", () => {
  assert.equal(parse(graph(), "/eli/lta/not-a-year/433"), null);
  assert.equal(parse(graph({}, { [`${ELI}title`]: undefined })), null);
  assert.equal(parse(graph({}, { [`${ELI}title`]: [{ "@value": " \r\n " }] })), null);
  assert.equal(parse(graph({ [`${ELI}type_document`]: undefined })), null);
  assert.equal(parse(graph({ [`${ELI}number`]: [{ "@value": "999" }] })), null);
});

test("derives canonical identity only from the input ELI", () => {
  const result = parse(
    graph({
      [`${ELI}number`]: [{ "@value": "433" }],
      [`${ELI}pub_media`]: [{ "@value": "wrong" }],
      [`${ELI}year`]: [{ "@value": "1900" }],
    }),
  );
  assert.equal(result?.pubMedia, "lta");
  assert.equal(result?.year, "2014");
  assert.equal(result?.number, "433");
});

test("keeps absent optional metadata nullable and preserves the full status identifier", () => {
  const result = parse(graph());
  assert.equal(result?.popularTitle, null);
  assert.equal(result?.ministry, null);
  assert.equal(result?.accessionNumber, null);
  assert.equal(result?.status, null);
  assert.equal(result?.sourceUpdateTimestamp, observedAt);
});

test("does not map dates or infer state from relations", () => {
  const result = parse(
    graph(
      {
        [`${ELI}date_document`]: [{ "@value": "2014-01-01" }],
        [`${ELI}date_publication`]: [{ "@value": "2014-02-01" }],
        [`${ELI}changed_by`]: [{ "@id": "https://example.test/change" }],
        [`${ELI}consolidates`]: [{ "@id": "https://example.test/consolidated" }],
        [`${ELI}basis_for`]: [{ "@id": "https://example.test/basis" }],
      },
      { [`${ELI}title_alternative`]: [{ "@value": "  Alt\nTitle  " }] },
    ),
  );
  assert.equal(result?.popularTitle, "Alt\nTitle");
  assert.equal(result?.startDate, null);
  assert.equal(result?.endDate, null);
  assert.equal(result?.changeDate, null);
  assert.equal(result?.announcedIn, null);
  assert.equal(Object.keys(result ?? {}).includes("latestLbk"), false);
  assert.equal(Object.keys(result ?? {}).includes("lineage"), false);
});

test("returns null for malformed top-level shapes and unusable relationship nodes", () => {
  assert.equal(parse(null), null);
  assert.equal(parse({}), null);
  assert.equal(parse({ "@graph": "not-an-array" }), null);
  assert.equal(parse(["not-a-node"]), null);
  assert.equal(parse(graph({}, { [`${ELI}realizes`]: [{ "@value": 42 }, { "@id": null }] })), null);
});
