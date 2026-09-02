import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import {
  buildTargetWorksQuery,
  buildWorkRecordQuery,
  buildWorkMetadataQuery,
  CellarMetadataClient,
  CellarMetadataError,
  parseCellarSparqlResults,
  parseCellarTargetWorkPage,
  parseCellarWorkRdf,
  type CellarWorkCursor,
  type CellarMetadataTransport,
} from "../src/law/providers/CellarMetadataClient";
import {
  CellarHttpRequestError,
  createCellarSparqlJsonFetcher,
  type RequestUrlLike,
} from "../src/law/httpTransport";

function sparqlFixture(bindings: unknown[]): unknown {
  return { results: { bindings } };
}

function binding(celex: string, languages: string, title?: { value: string; lang: string }): Record<string, unknown> {
  const b: Record<string, unknown> = {
    celex: { type: "literal", value: celex },
    languages: { type: "literal", value: languages },
  };
  if (title) b.title = { type: "literal", value: title.value, "xml:lang": title.lang };
  return b;
}

describe("CellarMetadataClient query construction", () => {
  it("builds a cursor-free target-works query without OFFSET", () => {
    const query = buildTargetWorksQuery(null, 5000);
    assert.match(query, /LIMIT 5000/);
    assert.doesNotMatch(query, /OFFSET/);
    assert.match(query, /\^celex:3\[0-9\]\{4\}\[RLD\]\[0-9\]\{4,6\}\$"/);
    assert.match(query, /ORDER BY STR\(\?workId\) STR\(\?work\)/);
    assert.match(query, /cdm:work_id_document/);
    assert.doesNotMatch(query, /cdm:id_celex/);
    assert.doesNotMatch(query, /cdm:work_has_expression/);
  });

  it("builds a single-work query for a valid CELEX only", () => {
    assert.match(buildWorkRecordQuery("32016R0679"), /VALUES \(\?celex \?celexUri\)/);
    assert.throws(() => buildWorkRecordQuery("02016R0679"), CellarMetadataError);
  });

  it("builds a single-work query for a valid six-digit CELEX only", () => {
    assert.match(buildWorkRecordQuery("32016R123456"), /VALUES \(\?celex \?celexUri\)/);
    assert.throws(() => buildWorkRecordQuery("32016R1234567"), CellarMetadataError);
  });

  it("uses the official WEMI expression and language relationships", () => {
    const query = buildWorkMetadataQuery("http://example.test/work", "32018R1805");
    assert.match(query, /cdm:expression_belongs_to_work/);
    assert.match(query, /cdm:expression_uses_language/);
    assert.match(query, /purl:identifier/);
    assert.doesNotMatch(query, /work_has_expression/);
    assert.doesNotMatch(query, /REPLACE\(STR\(\?expr\)/);
  });

  it("uses a strict tuple cursor and rejects malformed cursor input", () => {
    const cursor: CellarWorkCursor = {
      workId: "32016R123456",
      workUri: "http://example.test/work-1",
    };
    const query = buildTargetWorksQuery(cursor, 10);
    assert.match(query, /STR\(\?workId\) > "celex:32016R123456"/);
    assert.match(query, /STR\(\?work\) > "http:\/\/example\.test\/work-1"/);
    assert.doesNotMatch(query, /OFFSET/);
    assert.throws(() => buildTargetWorksQuery({ workId: "bad", workUri: "http://example.test/work" }, 10), CellarMetadataError);
    assert.throws(() => buildTargetWorksQuery({ workId: "32016R1234567", workUri: "http://example.test/work" }, 10), CellarMetadataError);
    assert.throws(() => buildTargetWorksQuery(null, 0), CellarMetadataError);
  });
});

describe("CellarMetadataClient SPARQL parsing", () => {
  it("parses target work records and maps expression languages", () => {
    const json = sparqlFixture([
      binding("32016R123456", "DEU ENG FRA", { value: "Regulation (EU) 2016/123456", lang: "eng" }),
    ]);
    const records = parseCellarSparqlResults(json);
    assert.equal(records.length, 1);
    assert.equal(records[0].celex, "32016R123456");
    assert.equal(records[0].documentType, "R");
    assert.deepEqual(records[0].availableLanguages, ["deu", "eng", "fra"]);
    assert.equal(records[0].titlesByLanguage.eng, "Regulation (EU) 2016/123456");
  });

  it("rejects malformed CELLAR metadata (missing results)", () => {
    assert.throws(() => parseCellarSparqlResults({}), CellarMetadataError);
    assert.throws(() => parseCellarSparqlResults({ results: {} }), CellarMetadataError);
  });

  it("rejects a non-target CELEX returned by CELLAR", () => {
    const json = sparqlFixture([binding("02016R0679", "DEU")]);
    assert.throws(() => parseCellarSparqlResults(json), CellarMetadataError);
  });

  it("rejects an out-of-scope document type returned by CELLAR", () => {
    const json = sparqlFixture([binding("32016C0679", "DEU")]);
    assert.throws(() => parseCellarSparqlResults(json), CellarMetadataError);
  });

  it("skips unknown expression languages rather than falling back", () => {
    const json = sparqlFixture([binding("32022L2555", "DEU XY ENG", { value: "Directive", lang: "eng" })]);
    const records = parseCellarSparqlResults(json);
    assert.deepEqual(records[0].availableLanguages, ["deu", "eng"]);
  });
});

const RDF_FIXTURE = `<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns:j.0="http://publications.europa.eu/ontology/cdm#" xmlns:purl="http://purl.org/dc/elements/1.1/" xmlns:owl="http://www.w3.org/2002/07/owl#">
  <rdf:Description rdf:about="http://publications.europa.eu/resource/celex/32016R0679">
    <owl:sameAs rdf:resource="http://publications.europa.eu/resource/cellar/uuid-123"/>
  </rdf:Description>
  <rdf:Description rdf:about="http://publications.europa.eu/resource/cellar/uuid-123">
    <j.0:work_id_document>celex:32016R0679</j.0:work_id_document>
    <owl:sameAs rdf:resource="http://publications.europa.eu/resource/celex/32016R0679"/>
  </rdf:Description>
  <rdf:Description rdf:about="http://example.test/expression.0001">
    <j.0:expression_belongs_to_work rdf:resource="http://publications.europa.eu/resource/cellar/uuid-123"/>
    <j.0:expression_uses_language rdf:resource="http://example.test/lang/deu"/>
    <j.0:title xml:lang="eng">Regulation (EU) 2016/679</j.0:title>
  </rdf:Description>
  <rdf:Description rdf:about="http://example.test/lang/deu">
    <purl:identifier>DEU</purl:identifier>
  </rdf:Description>
  <rdf:Description rdf:about="http://example.test/expression.0002">
    <j.0:expression_belongs_to_work rdf:resource="http://publications.europa.eu/resource/cellar/uuid-123"/>
    <j.0:expression_uses_language rdf:resource="http://example.test/lang/xyz"/>
  </rdf:Description>
  <rdf:Description rdf:about="http://example.test/lang/xyz">
    <purl:identifier>XYZ</purl:identifier>
  </rdf:Description>
</rdf:RDF>`;

describe("CellarMetadataClient RDF parsing", () => {
  it("extracts celex identity and expression languages from work RDF", () => {
    const record = parseCellarWorkRdf(RDF_FIXTURE, "32016R0679");
    assert.ok(record);
    assert.equal(record?.celex, "32016R0679");
    assert.equal(record?.documentType, "R");
    assert.deepEqual(record?.availableLanguages, ["deu", "xyz"]);
    assert.equal(record?.titlesByLanguage.eng, "Regulation (EU) 2016/679");
  });

  it("returns null for an empty or mismatched RDF", () => {
    assert.equal(parseCellarWorkRdf("", "32016R0679"), null);
    assert.equal(parseCellarWorkRdf(RDF_FIXTURE, "32099R9999"), null);
  });

  it("fetches a work record from RDF through the transport", async () => {
    const transport: CellarMetadataTransport = {
      fetchSparqlJson: async () => sparqlFixture([]),
      fetchWorkRdf: async (celex) => (celex === "32016R0679" ? RDF_FIXTURE : ""),
    };
    const client = new CellarMetadataClient(transport);
    const record = await client.fetchWorkRecordFromRdf("32016R0679");
    assert.equal(record?.celex, "32016R0679");
    assert.deepEqual(record?.availableLanguages, ["deu", "xyz"]);
  });
});

describe("CellarMetadataClient page fetch", () => {
  it("returns parsed records from the transport", async () => {
    const calls: string[] = [];
    const transport: CellarMetadataTransport = {
      fetchSparqlJson: async (query) => {
        calls.push(query);
        if (query.includes("work_id_document")) {
          return sparqlFixture([{ work: { type: "uri", value: "http://example.test/work" }, workId: { type: "literal", value: "celex:32016R0679" } }]);
        }
        return sparqlFixture([{ work: { type: "uri", value: "http://example.test/work" }, langCode: { type: "literal", value: "DEU" } }]);
      },
      fetchWorkRdf: async () => "",
    };
    const client = new CellarMetadataClient(transport, { pageSize: 100 });
    const page = await client.fetchTargetWorksPage(null, 100);
    assert.equal(page.records.length, 1);
    assert.equal(page.records[0].celex, "32016R0679");
    assert.equal(page.records[0].workUri, "http://example.test/work");
    assert.deepEqual(page.nextCursor, { workId: "32016R0679", workUri: "http://example.test/work" });
    assert.equal(calls.length, 2);
  });

  it("enriches several identities with one batch and preserves empty works", () => {
    const identities = [
      { work: "http://example.test/a", celex: "32016R0679" },
      { work: "http://example.test/b", celex: "32022L2555" },
    ];
    const page = parseCellarTargetWorkPage(
      sparqlFixture([
        { work: { type: "uri", value: identities[0].work }, langCode: { type: "literal", value: "DEU" } },
        { work: { type: "uri", value: identities[0].work }, langCode: { type: "literal", value: "XYZ" } },
      ]),
      identities,
      { workId: "32022L2555", workUri: identities[1].work },
    );
    assert.equal(page.records.length, 2);
    assert.deepEqual(page.records[0].availableLanguages, ["deu", "xyz"]);
    assert.deepEqual(page.records[1].availableLanguages, []);
    assert.equal(page.records[0].workUri, identities[0].work);
    assert.equal(page.records[1].workUri, identities[1].work);
  });
});

describe("CellarMetadataClient over the retry-aware SPARQL transport", () => {
  function retryAwareTransport(statuses: readonly number[], json: unknown): {
    transport: CellarMetadataTransport;
    calls: number;
    delays: number[];
  } {
    const state = { calls: 0, delays: [] as number[] };
    let attempt = 0;
    const requestUrl: RequestUrlLike = async () => {
      const status = statuses[Math.min(attempt, statuses.length - 1)];
      attempt += 1;
      state.calls = attempt;
      return { status, text: JSON.stringify(json), json };
    };
    const transport: CellarMetadataTransport = {
      fetchSparqlJson: createCellarSparqlJsonFetcher(requestUrl, {
        sleep: async (ms: number) => {
          state.delays.push(ms);
        },
      }),
      fetchWorkRdf: async () => "",
    };
    return {
      transport,
      get calls() {
        return state.calls;
      },
      delays: state.delays,
    };
  }

  it("recovers a single work record lookup from a transient 503", async () => {
    const scripted = retryAwareTransport([503, 200], sparqlFixture([binding("32016R0679", "DEU XYZ")]));
    const client = new CellarMetadataClient(scripted.transport);

    const record = await client.fetchWorkRecord("32016R0679");

    assert.equal(record?.celex, "32016R0679");
    assert.deepEqual(record?.availableLanguages, ["deu", "xyz"]);
    assert.equal(scripted.calls, 2);
    assert.deepEqual(scripted.delays, [500]);
  });

  it("fails the enumeration path with a sanitized HTTP error after four attempts", async () => {
    const scripted = retryAwareTransport([503, 503, 503, 503], sparqlFixture([]));
    const client = new CellarMetadataClient(scripted.transport, { pageSize: 10 });

    const error = await client.fetchTargetWorksPage(null, 10).then(
      () => null,
      (caught: unknown) => caught,
    );

    assert.ok(error instanceof CellarHttpRequestError);
    assert.equal(error.status, 503);
    assert.equal(error.attempts, 4);
    assert.equal(scripted.calls, 4);
    assert.deepEqual(scripted.delays, [500, 1000, 2000]);
  });

  it("does not retry a non-retryable 404 from the SPARQL endpoint", async () => {
    const scripted = retryAwareTransport([404, 200], sparqlFixture([binding("32016R0679", "DEU")]));
    const client = new CellarMetadataClient(scripted.transport);

    const error = await client.fetchWorkRecord("32016R0679").then(
      () => null,
      (caught: unknown) => caught,
    );

    assert.ok(error instanceof CellarHttpRequestError);
    assert.equal(error.status, 404);
    assert.equal(scripted.calls, 1);
    assert.deepEqual(scripted.delays, []);
  });
});

const VALID_URI = "http://example.test/work";

describe("F1 zero-number CELEX admission", () => {
  it("rejects a zero-number CELEX in the work record query", () => {
    assert.throws(() => buildWorkRecordQuery("32016R0000"), CellarMetadataError);
  });

  it("rejects a zero-number CELEX cursor in the target works query", () => {
    assert.throws(
      () => buildTargetWorksQuery({ workId: "32016R0000", workUri: VALID_URI }, 10),
      CellarMetadataError,
    );
  });

  it("returns null without transport for a zero-number fetchWorkRecord", async () => {
    let transportInvoked = false;
    const transport: CellarMetadataTransport = {
      fetchSparqlJson: async () => {
        transportInvoked = true;
        return sparqlFixture([]);
      },
      fetchWorkRdf: async () => "",
    };
    const client = new CellarMetadataClient(transport);
    const record = await client.fetchWorkRecord("32016R0000");
    assert.equal(record, null);
    assert.equal(transportInvoked, false);
  });

  it("returns null without transport for a zero-number fetchWorkRecordFromRdf", async () => {
    let transportInvoked = false;
    const transport: CellarMetadataTransport = {
      fetchSparqlJson: async () => sparqlFixture([]),
      fetchWorkRdf: async () => {
        transportInvoked = true;
        return "";
      },
    };
    const client = new CellarMetadataClient(transport);
    const record = await client.fetchWorkRecordFromRdf("32016R0000");
    assert.equal(record, null);
    assert.equal(transportInvoked, false);
  });

  it("emits a number > 0 restriction in the discovery SPARQL", () => {
    const query = buildTargetWorksQuery(null, 5000);
    assert.match(query, /FILTER\(\?cellarDocNumber > 0\)/);
    assert.match(query, /BIND\(xsd:integer\(SUBSTR\(STR\(\?workId\), 13\)\) AS \?cellarDocNumber\)/);
    assert.match(query, /PREFIX xsd: <http:\/\/www\.w3\.org\/2001\/XMLSchema#>/);
  });

  it("aligns client-side admission with parseEuCelex semantics", () => {
    assert.throws(() => buildWorkRecordQuery("31000R0001"), CellarMetadataError);
  });
});

function identityPageTransport(identities: Array<{ work: string; celex: string }>) {
  return {
    transport: {
      fetchSparqlJson: async (query: string) => {
        if (query.includes("work_id_document")) {
          return sparqlFixture(
            identities.map((id) => ({
              work: { type: "uri", value: id.work },
              workId: { type: "literal", value: `celex:${id.celex}` },
            })),
          );
        }
        return sparqlFixture([]);
      },
      fetchWorkRdf: async () => "",
    } as CellarMetadataTransport,
    calls: 0,
  };
}

describe("F2 keyset / page integrity", () => {
  it("rejects an internally unordered identity page", async () => {
    const { transport } = identityPageTransport([
      { work: "http://example.test/w1", celex: "32016R0679" },
      { work: "http://example.test/w2", celex: "32016R0123" },
    ]);
    const client = new CellarMetadataClient(transport, { pageSize: 10 });
    const error = await client.fetchTargetWorksPage(null, 10).then(
      () => null,
      (caught: unknown) => caught,
    );
    assert.ok(error instanceof CellarMetadataError);
  });

  it("rejects an exact duplicate identity tuple", async () => {
    const { transport } = identityPageTransport([
      { work: "http://example.test/w1", celex: "32016R0679" },
      { work: "http://example.test/w1", celex: "32016R0679" },
    ]);
    const client = new CellarMetadataClient(transport, { pageSize: 10 });
    const error = await client.fetchTargetWorksPage(null, 10).then(
      () => null,
      (caught: unknown) => caught,
    );
    assert.ok(error instanceof CellarMetadataError);
  });

  it("rejects a tuple that does not exceed the supplied input cursor", async () => {
    const { transport } = identityPageTransport([
      { work: "http://example.test/w1", celex: "32016R0679" },
      { work: "http://example.test/w2", celex: "32022L2555" },
    ]);
    const client = new CellarMetadataClient(transport, { pageSize: 10 });
    const error = await client
      .fetchTargetWorksPage({ workId: "32016R0679", workUri: "http://example.test/w1" }, 10)
      .then(
        () => null,
        (caught: unknown) => caught,
      );
    assert.ok(error instanceof CellarMetadataError);
  });

  it("rejects two distinct Work URIs for the same CELEX", async () => {
    const { transport } = identityPageTransport([
      { work: "http://example.test/w1", celex: "32016R0679" },
      { work: "http://example.test/w2", celex: "32016R0679" },
    ]);
    const client = new CellarMetadataClient(transport, { pageSize: 10 });
    const error = await client.fetchTargetWorksPage(null, 10).then(
      () => null,
      (caught: unknown) => caught,
    );
    assert.ok(error instanceof CellarMetadataError);
  });

  it("preserves strict tuple keyset ordering and nextCursor", async () => {
    const { transport } = identityPageTransport([
      { work: "http://example.test/w1", celex: "32016R0679" },
      { work: "http://example.test/w2", celex: "32022L2555" },
    ]);
    const client = new CellarMetadataClient(transport, { pageSize: 10 });
    const page = await client.fetchTargetWorksPage(null, 10);
    assert.equal(page.records.length, 2);
    assert.deepEqual(page.nextCursor, {
      workId: "32022L2555",
      workUri: "http://example.test/w2",
    });
    const query = buildTargetWorksQuery(null, 5000);
    assert.doesNotMatch(query, /OFFSET/);
    assert.match(query, /ORDER BY STR\(\?workId\) STR\(\?work\)/);
  });
});

describe("F2 inverse Work-URI/CELEX injectivity", () => {
  function inverseCollisionTransport() {
    let enrichmentRequests = 0;
    const transport: CellarMetadataTransport = {
      fetchSparqlJson: async (query: string) => {
        if (query.includes("work_id_document")) {
          return sparqlFixture([
            { work: { type: "uri", value: "http://example.test/shared" }, workId: { type: "literal", value: "celex:32016R0679" } },
            { work: { type: "uri", value: "http://example.test/shared" }, workId: { type: "literal", value: "celex:32022L2555" } },
          ]);
        }
        enrichmentRequests += 1;
        return sparqlFixture([]);
      },
      fetchWorkRdf: async () => "",
    };
    return { transport, getEnrichmentRequests: () => enrichmentRequests };
  }

  it("rejects a single Work URI mapped to two distinct CELEX identities", async () => {
    const { transport } = inverseCollisionTransport();
    const client = new CellarMetadataClient(transport, { pageSize: 10 });
    const error = await client.fetchTargetWorksPage(null, 10).then(
      () => null,
      (caught: unknown) => caught,
    );
    assert.ok(error instanceof CellarMetadataError);
  });

  it("rejects the inverse collision before any metadata enrichment", async () => {
    const { transport, getEnrichmentRequests } = inverseCollisionTransport();
    const client = new CellarMetadataClient(transport, { pageSize: 10 });
    const error = await client.fetchTargetWorksPage(null, 10).then(
      () => null,
      (caught: unknown) => caught,
    );
    assert.ok(error instanceof CellarMetadataError);
    assert.equal(getEnrichmentRequests(), 0);
  });

  it("preserves unambiguous Work URI -> CELEX identities", async () => {
    const { transport } = identityPageTransport([
      { work: "http://example.test/wA", celex: "32016R0679" },
      { work: "http://example.test/wB", celex: "32022L2555" },
    ]);
    const client = new CellarMetadataClient(transport, { pageSize: 10 });
    const page = await client.fetchTargetWorksPage(null, 10);
    assert.equal(page.records.length, 2);
    assert.deepEqual(page.nextCursor, {
      workId: "32022L2555",
      workUri: "http://example.test/wB",
    });
  });
});

function countingIdentityPageTransport(identities: Array<{ work: string; celex: string }>) {
  let identityRequests = 0;
  let enrichmentRequests = 0;
  const transport: CellarMetadataTransport = {
    fetchSparqlJson: async (query: string) => {
      if (query.includes("work_id_document")) {
        identityRequests += 1;
        return sparqlFixture(
          identities.map((id) => ({
            work: { type: "uri", value: id.work },
            workId: { type: "literal", value: `celex:${id.celex}` },
          })),
        );
      }
      enrichmentRequests += 1;
      return sparqlFixture([]);
    },
    fetchWorkRdf: async () => "",
  };
  return {
    transport,
    getIdentityRequests: () => identityRequests,
    getEnrichmentRequests: () => enrichmentRequests,
  };
}

describe("Aggregate Finding A pre-enrichment semantic discovery validation", () => {
  it("rejects a zero-number discovery CELEX before any metadata enrichment", async () => {
    const { transport, getIdentityRequests, getEnrichmentRequests } = countingIdentityPageTransport([
      { work: "https://publications.europa.eu/resource/cellar/zero-number-work", celex: "32016R0000" },
    ]);
    const client = new CellarMetadataClient(transport, { pageSize: 10 });
    const error = await client.fetchTargetWorksPage(null, 10).then(
      () => null,
      (caught: unknown) => caught,
    );
    assert.ok(error instanceof CellarMetadataError);
    assert.equal(getIdentityRequests(), 1);
    assert.equal(getEnrichmentRequests(), 0);
  });

  it("admits a valid 4-digit document-number discovery identity", async () => {
    const { transport, getIdentityRequests, getEnrichmentRequests } = countingIdentityPageTransport([
      { work: "https://publications.europa.eu/resource/cellar/w4", celex: "32016R0679" },
    ]);
    const client = new CellarMetadataClient(transport, { pageSize: 10 });
    const page = await client.fetchTargetWorksPage(null, 10);
    assert.deepEqual(
      page.records.map((record) => record.celex),
      ["32016R0679"],
    );
    assert.equal(page.records[0].number, "0679");
    assert.equal(getIdentityRequests(), 1);
    assert.equal(getEnrichmentRequests(), 1);
  });

  it("admits a valid 5-digit document-number discovery identity", async () => {
    const { transport } = countingIdentityPageTransport([
      { work: "https://publications.europa.eu/resource/cellar/w5", celex: "32016R01234" },
    ]);
    const client = new CellarMetadataClient(transport, { pageSize: 10 });
    const page = await client.fetchTargetWorksPage(null, 10);
    assert.deepEqual(
      page.records.map((record) => record.celex),
      ["32016R01234"],
    );
    assert.equal(page.records[0].number, "01234");
  });

  it("admits a valid 6-digit document-number discovery identity", async () => {
    const { transport } = countingIdentityPageTransport([
      { work: "https://publications.europa.eu/resource/cellar/w6", celex: "32016R123456" },
    ]);
    const client = new CellarMetadataClient(transport, { pageSize: 10 });
    const page = await client.fetchTargetWorksPage(null, 10);
    assert.deepEqual(
      page.records.map((record) => record.celex),
      ["32016R123456"],
    );
    assert.equal(page.records[0].number, "123456");
  });

  it("keeps rejecting an out-of-scope suffixed discovery CELEX before enrichment", async () => {
    const { transport, getIdentityRequests, getEnrichmentRequests } = countingIdentityPageTransport([
      { work: "https://publications.europa.eu/resource/cellar/wSuffix", celex: "32016R0679R(01)" },
    ]);
    const client = new CellarMetadataClient(transport, { pageSize: 10 });
    const error = await client.fetchTargetWorksPage(null, 10).then(
      () => null,
      (caught: unknown) => caught,
    );
    assert.ok(error instanceof CellarMetadataError);
    assert.equal(getIdentityRequests(), 1);
    assert.equal(getEnrichmentRequests(), 0);
  });

  it("retains the late defense-in-depth semantic parse in parseCellarTargetWorkPage", () => {
    assert.throws(
      () =>
        parseCellarTargetWorkPage(
          sparqlFixture([]),
          [{ work: "https://publications.europa.eu/resource/cellar/zero", celex: "32016R0000" }],
          null,
        ),
      CellarMetadataError,
    );
  });
});

describe("Aggregate Finding B discovery Work-URI provenance", () => {
  it("retains the discovery Work URI on every production record across batches", async () => {
    const { transport, getIdentityRequests, getEnrichmentRequests } = countingIdentityPageTransport([
      { work: "https://publications.europa.eu/resource/cellar/wA", celex: "32016R0679" },
      { work: "https://publications.europa.eu/resource/cellar/wB", celex: "32022L2555" },
      { work: "https://publications.europa.eu/resource/cellar/wC", celex: "32024R1689" },
    ]);
    const client = new CellarMetadataClient(transport, { pageSize: 10, metadataBatchSize: 2 });
    const page = await client.fetchTargetWorksPage(null, 10);
    assert.deepEqual(
      page.records.map((record) => ({ celex: record.celex, workUri: record.workUri })),
      [
        { celex: "32016R0679", workUri: "https://publications.europa.eu/resource/cellar/wA" },
        { celex: "32022L2555", workUri: "https://publications.europa.eu/resource/cellar/wB" },
        { celex: "32024R1689", workUri: "https://publications.europa.eu/resource/cellar/wC" },
      ],
    );
    assert.deepEqual(page.nextCursor, {
      workId: "32024R1689",
      workUri: "https://publications.europa.eu/resource/cellar/wC",
    });
    assert.equal(getIdentityRequests(), 1);
    assert.equal(getEnrichmentRequests(), 2);
  });

  it("does not retain Work URI provenance on single-work record lookups", async () => {
    const transport: CellarMetadataTransport = {
      fetchSparqlJson: async () => sparqlFixture([binding("32016R0679", "DEU")]),
      fetchWorkRdf: async () => "",
    };
    const client = new CellarMetadataClient(transport);
    const record = await client.fetchWorkRecord("32016R0679");
    assert.equal(record?.celex, "32016R0679");
    assert.equal((record as { workUri?: string }).workUri, undefined);
  });
});

describe("F3 requested Work identity", () => {
  it("rejects a returned record for a different CELEX than requested", async () => {
    const transport: CellarMetadataTransport = {
      fetchSparqlJson: async () => sparqlFixture([binding("32022L2555", "DEU")]),
      fetchWorkRdf: async () => "",
    };
    const client = new CellarMetadataClient(transport);
    const error = await client.fetchWorkRecord("32016R0679").then(
      () => null,
      (caught: unknown) => caught,
    );
    assert.ok(error instanceof CellarMetadataError);
  });

  it("rejects ambiguous multiple records", async () => {
    const transport: CellarMetadataTransport = {
      fetchSparqlJson: async () =>
        sparqlFixture([binding("32022L2555", "DEU"), binding("32022L2556", "DEU")]),
      fetchWorkRdf: async () => "",
    };
    const client = new CellarMetadataClient(transport);
    const error = await client.fetchWorkRecord("32016R0679").then(
      () => null,
      (caught: unknown) => caught,
    );
    assert.ok(error instanceof CellarMetadataError);
  });

  it("preserves the valid exact record", async () => {
    const transport: CellarMetadataTransport = {
      fetchSparqlJson: async () => sparqlFixture([binding("32016R0679", "DEU")]),
      fetchWorkRdf: async () => "",
    };
    const client = new CellarMetadataClient(transport);
    const record = await client.fetchWorkRecord("32016R0679");
    assert.equal(record?.celex, "32016R0679");
  });

  it("returns null when zero records are returned", async () => {
    const transport: CellarMetadataTransport = {
      fetchSparqlJson: async () => sparqlFixture([]),
      fetchWorkRdf: async () => "",
    };
    const client = new CellarMetadataClient(transport);
    const record = await client.fetchWorkRecord("32016R0679");
    assert.equal(record, null);
  });
});
