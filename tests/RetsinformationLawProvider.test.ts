import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { LawProviderUnavailableError } from "../src/law/errors";
import type { LawProviderHttpResponse } from "../src/law/httpTransport";
import type { LawReference } from "../src/law/types";
import {
  RetsinformationLawProvider,
  type RetsinformationCurrentnessObservation,
} from "../src/law/providers/RetsinformationLawProvider";

const NOW = "2026-09-17T12:00:00.000Z";
const URL = "https://www.retsinformation.dk/eli/lta/2014/433/xml";

function response(
  status: number,
  body: string,
  headers: Record<string, string> = {},
): LawProviderHttpResponse {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers,
    text: async () => body,
    json: async () => JSON.parse(body),
  };
}

const xml = (documentType = "LOV", year = "2014", number = "433") => `
<Dokument>
  <Meta>
    <DocumentType>${documentType}</DocumentType>
    <AccessionNumber>ACC-433</AccessionNumber>
    <DocumentId>DOC-433</DocumentId>
    <UniqueDocumentId>UNIQUE-433</UniqueDocumentId>
    <DocumentTitle>Forvaltningsloven</DocumentTitle>
    <PopularTitle>Forvaltningsloven</PopularTitle>
    <Year>${year}</Year>
    <Number>${number}</Number>
    <DiesSigni>2014-04-22</DiesSigni>
    <Status>Gældende</Status>
    <StartDate>2014-05-01</StartDate>
    <EndDate>2020-01-01</EndDate>
    <Ministry>Justitsministeriet</Ministry>
    <AnnouncedIn>Lovtidende A</AnnouncedIn>
    <Change><Ref_Accn>ACC-OLD</Ref_Accn><Ref_Af>2017-01-01</Ref_Af><Ref_Text>Changed</Ref_Text></Change>
  </Meta>
  <DokumentIndhold>
    <Paragraf localId="§ 1">
      <Rubrica>Scope</Rubrica>
      <Stk><Index>First paragraph</Index></Stk>
      <Stk><Indentatio>Second paragraph</Indentatio></Stk>
    </Paragraf>
    <Paragraf localId="§ 9 a"><Rubrica>Letter paragraph</Rubrica></Paragraf>
  </DokumentIndhold>
</Dokument>`;

type Fetch = (url: string) => Promise<LawProviderHttpResponse>;

function provider(fetchFn: Fetch, recorder?: { record(observation: RetsinformationCurrentnessObservation): Promise<void> | void }) {
  return new RetsinformationLawProvider(fetchFn, recorder, () => NOW);
}

async function withImmediateRetrySleep<T>(run: () => Promise<T>): Promise<T> {
  const globalWithWindow = globalThis as unknown as {
    window?: { setTimeout(callback: () => void, ms: number): unknown };
  };
  const previousWindow = globalWithWindow.window;
  globalWithWindow.window = {
    setTimeout(callback: () => void) {
      callback();
      return 0;
    },
  };
  try {
    return await run();
  } finally {
    if (previousWindow === undefined) delete globalWithWindow.window;
    else globalWithWindow.window = previousWindow;
  }
}

function reference(overrides: Partial<LawReference> = {}): LawReference {
  return {
    lawCode: "/eli/lta/2014/433",
    section: "1",
    referenceType: "section" as const,
    jurisdiction: "DK" as const,
    ...overrides,
  };
}

describe("RetsinformationLawProvider", () => {
  it("requests the exact canonical XML URL and returns a verified LOV section", async () => {
    const calls: string[] = [];
    const result = await provider(async (url) => {
      calls.push(url);
      return response(200, xml(), { "content-type": "text/html" });
    }).getSection(reference());

    assert.deepEqual(calls, [URL]);
    assert.deepEqual(result, {
      providerId: "retsinformation",
      providerLabel: "Retsinformation",
      sourceUrl: "https://www.retsinformation.dk/eli/lta/2014/433",
      lawCode: "/eli/lta/2014/433",
      lawTitle: "Forvaltningsloven",
      section: "1",
      referenceType: "section",
      jurisdiction: "DK",
      language: "da",
      text: "Scope First paragraph Second paragraph",
      retrievedAt: NOW,
      cacheStatus: "live",
      isOfficialSource: true,
      isAuthoritativeText: true,
    });
  });

  it("admits an omitted language as the Danish-source default", async () => {
    const result = await provider(async () => response(200, xml())).getSection(reference());

    assert.equal(result?.language, "da");
  });

  it("admits explicit Danish language and reaches transport", async () => {
    let fetches = 0;
    const result = await provider(async () => {
      fetches += 1;
      return response(200, xml());
    }).getSection(reference({ language: "da" }));

    assert.equal(result?.language, "da");
    assert.equal(fetches, 1);
  });

  it("rejects explicit English language before fetch and recording", async () => {
    let fetches = 0;
    let records = 0;
    const result = await provider(async () => {
      fetches += 1;
      return response(200, xml());
    }, { record: () => { records += 1; } }).getSection(reference({ language: "en" }));

    assert.equal(result, null);
    assert.equal(fetches, 0);
    assert.equal(records, 0);
  });

  it("rejects another explicit language before fetch and recording", async () => {
    let fetches = 0;
    let records = 0;
    const result = await provider(async () => {
      fetches += 1;
      return response(200, xml());
    }, { record: () => { records += 1; } }).getSection(reference({ language: "de" }));

    assert.equal(result, null);
    assert.equal(fetches, 0);
    assert.equal(records, 0);
  });

  it("admits an omitted sourceVariant without synthesizing one", async () => {
    const result = await provider(async () => response(200, xml())).getSection(reference());

    assert.equal(result?.sourceVariant, undefined);
  });

  it("rejects translation-en sourceVariant before fetch and recording", async () => {
    let fetches = 0;
    let records = 0;
    const result = await provider(async () => {
      fetches += 1;
      return response(200, xml());
    }, { record: () => { records += 1; } }).getSection(reference({ sourceVariant: "translation-en" }));

    assert.equal(result, null);
    assert.equal(fetches, 0);
    assert.equal(records, 0);
  });

  it("rejects the other typed sourceVariant before fetch and recording", async () => {
    let fetches = 0;
    let records = 0;
    const result = await provider(async () => {
      fetches += 1;
      return response(200, xml());
    }, { record: () => { records += 1; } }).getSection(reference({ sourceVariant: "official-de" }));

    assert.equal(result, null);
    assert.equal(fetches, 0);
    assert.equal(records, 0);
  });

  it("rejects non-DK, unsupported references, malformed identities, and non-lta identities without fetching or recording", async () => {
    let fetches = 0;
    let records = 0;
    const fetchFn = async () => { fetches += 1; return response(200, xml()); };
    const lawProvider = provider(fetchFn, { record: () => { records += 1; } });
    assert.equal(await lawProvider.getSection(reference({ jurisdiction: "DE" })), null);
    assert.equal(await lawProvider.getSection(reference({ referenceType: "article" })), null);
    assert.equal(await lawProvider.getSection(reference({ lawCode: "not-an-eli" })), null);
    assert.equal(records, 0);
    assert.equal(await lawProvider.getSection(reference({ lawCode: "/eli/lov/2014/433" })), null);
    assert.equal(records, 0);
    assert.equal(fetches, 0);
  });

  it("maps 404 to null and network or exhausted retry failures to unavailable", async () => {
    let notFoundRecords = 0;
    assert.equal(await provider(async () => response(404, ""), {
      record: () => { notFoundRecords += 1; },
    }).getSection(reference()), null);
    assert.equal(notFoundRecords, 0);

    let networkFetches = 0;
    let networkRecords = 0;
    await withImmediateRetrySleep(() => assert.rejects(
      provider(async () => {
        networkFetches += 1;
        throw new Error("offline");
      }, { record: () => { networkRecords += 1; } }).getSection(reference()),
      LawProviderUnavailableError,
    ));
    assert.equal(networkFetches, 4);
    assert.equal(networkRecords, 0);

    let retryFetches = 0;
    let retryRecords = 0;
    await withImmediateRetrySleep(() => assert.rejects(
      provider(async () => {
        retryFetches += 1;
        return response(503, "");
      }, { record: () => { retryRecords += 1; } }).getSection(reference()),
      LawProviderUnavailableError,
    ));
    assert.equal(retryFetches, 4);
    assert.equal(retryRecords, 0);
  });

  it("fails closed for malformed and non-LexDania successful bodies", async () => {
    let malformedXmlRecords = 0;
    assert.equal(await provider(async () => response(200, "<broken"), {
      record: () => { malformedXmlRecords += 1; },
    }).getSection(reference()), null);
    assert.equal(malformedXmlRecords, 0);

    let nonLexDaniaRecords = 0;
    assert.equal(await provider(async () => response(200, "<html>not law</html>"), {
      record: () => { nonLexDaniaRecords += 1; },
    }).getSection(reference()), null);
    assert.equal(nonLexDaniaRecords, 0);
  });

  it("binds response year and number, and independently gates DocumentType", async () => {
    let records = 0;
    const recorder = { record: () => { records += 1; } };
    assert.equal(await provider(async () => response(200, xml("LOV", "2020")), recorder).getSection(reference()), null);
    assert.equal(await provider(async () => response(200, xml("LOV", "2014", "999")), recorder).getSection(reference()), null);
    assert.equal(await provider(async () => response(200, xml("BEK")), recorder).getSection(reference()), null);
    assert.equal(records, 0);
  });

  it("returns LBK, subsection, and letter references while rejecting missing references", async () => {
    const lawProvider = provider(async () => response(200, xml("LBK")));
    const lbk = await lawProvider.getSection(reference({ subsection: "stk. 2" }));
    assert.equal(lbk?.text, "Second paragraph");
    assert.equal(lbk?.lawTitle, "Forvaltningsloven");
    const letter = await lawProvider.getSection(reference({ section: "9 a" }));
    assert.equal(letter?.text, "Letter paragraph");
    assert.equal(await lawProvider.getSection(reference({ section: "2" })), null);
    assert.equal(await lawProvider.getSection(reference({ subsection: "stk. 3" })), null);
  });

  it("records one source-backed observation only after verified retrieval", async () => {
    const observations: RetsinformationCurrentnessObservation[] = [];
    const result = await provider(async () => response(200, xml()), {
      record: (observation) => { observations.push(observation); },
    }).getSection(reference());
    assert.ok(result);
    assert.deepEqual(observations, [{
      canonicalEli: "/eli/lta/2014/433",
      documentType: "LOV",
      documentDate: "2014-04-22",
      sourceStatus: "Gældende",
      changes: [{ accessionNumber: "ACC-OLD", effectiveDate: "2017-01-01", text: "Changed" }],
      observedAt: NOW,
    }]);
  });

  it("preserves verified legal text when recorder throws or rejects", async () => {
    const throwing = provider(async () => response(200, xml()), { record: () => { throw new Error("store unavailable"); } });
    const rejected = provider(async () => response(200, xml()), { record: async () => { throw new Error("store unavailable"); } });
    assert.equal((await throwing.getSection(reference()))?.text, "Scope First paragraph Second paragraph");
    assert.equal((await rejected.getSection(reference()))?.isAuthoritativeText, true);
    await assert.doesNotReject(rejected.getSection(reference()));
  });
});
