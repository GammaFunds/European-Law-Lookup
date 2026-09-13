import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { resolve } from "node:path";
import type { LawProviderHttpResponse } from "../src/law/httpTransport";
import type { LawReference } from "../src/law/types";
import type { NormattivaActMetadata } from "../src/law/types";
import { NormattivaLawDiscovery } from "../src/law/providers/NormattivaLawDiscovery";
import { LawProviderUnavailableError } from "../src/law/errors";
import {
  formatLocalCalendarDate,
  NormattivaLawProvider,
  NormattivaSourceContractError,
  parseNormattivaLawCode,
} from "../src/law/providers/NormattivaLawProvider";

const CAD = {
  dataGU: "2005-05-16",
  codiceRedazionale: "005G0104",
  title: "DECRETO LEGISLATIVO 7 marzo 2005, n. 82",
  actType: "DECRETO LEGISLATIVO",
  actDate: "2005-03-07",
  actNumber: 82,
  guNumber: 112,
};

const ARTICLE_HTML = `
  <div class="bodyTesto">
    <h2 class="article-num-akn" id="art_20">Art. 20</h2>
    <div class="art-commi-div-akn">
      <div class="art-comma-div-akn"><span class="comma-num-akn">1. </span><span class="art_text_in_comma">Primo <a href="https://example.invalid">comma</a>. </span></div>
      <div class="art-comma-div-akn"><span class="comma-num-akn">2. </span><span class="art_text_in_comma">Secondo comma.</span></div>
    </div>
  </div>`;

const CC = {
  dataGU: "1942-04-04",
  codiceRedazionale: "042U0262",
  title: "REGIO DECRETO 16 marzo 1942, n. 262",
  actType: "REGIO DECRETO",
  actDate: "1942-03-16",
  actNumber: 262,
  guNumber: 79,
};

const CC_ARTICLE_HTML = `<div class="bodyTesto"><h2 class="article-num-akn" id="art_1">Art. 1</h2><div class="art-comma-div-akn">&Egrave; approvato il testo del Codice civile.</div></div>`;

function response(status: number, value: unknown): LawProviderHttpResponse {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(value),
    json: async () => value,
  };
}

function detailResponse(overrides: Record<string, unknown> = {}): unknown {
  return {
    code: null,
    message: null,
    data: {
      atto: {
        titolo: CAD.title,
        articoloHtml: ARTICLE_HTML,
        tipoProvvedimentoDescrizione: CAD.actType,
        annoProvvedimento: 2005,
        meseProvvedimento: 3,
        giornoProvvedimento: 7,
        numeroProvvedimento: CAD.actNumber,
        annoGU: 2005,
        meseGU: 5,
        giornoGU: 16,
        numeroGU: CAD.guNumber,
        dataGU: CAD.dataGU,
        codiceRedazionale: CAD.codiceRedazionale,
        articoloDataInizioVigenza: "20180127",
        articoloDataFineVigenza: "99999999",
        ...overrides,
      },
      lista: null,
    },
    success: true,
  };
}

function productionShapedCadDetailResponse(): unknown {
  const value = detailResponse() as { data: { atto: Record<string, unknown> } };
  const { dataGU: _dataGU, codiceRedazionale: _codiceRedazionale, ...atto } = value.data.atto;
  return {
    ...value,
    data: { atto },
  };
}

function ccDetailResponse(overrides: Record<string, unknown> = {}): unknown {
  const base = detailResponse() as { data: Record<string, unknown> };
  return {
    ...base,
    data: {
      lista: null,
      atto: {
        titolo: CC.title,
        articoloHtml: CC_ARTICLE_HTML,
        tipoProvvedimentoDescrizione: CC.actType,
        annoProvvedimento: 1942,
        meseProvvedimento: 3,
        giornoProvvedimento: 16,
        numeroProvvedimento: CC.actNumber,
        annoGU: 1942,
        meseGU: 4,
        giornoGU: 4,
        numeroGU: CC.guNumber,
        dataGU: CC.dataGU,
        codiceRedazionale: CC.codiceRedazionale,
        articoloDataInizioVigenza: "19441110",
        articoloDataFineVigenza: "99999999",
        ...overrides,
      },
    },
  };
}

function reference(overrides: Partial<LawReference> = {}): LawReference {
  return {
    lawCode: "normattiva:2005-05-16:005G0104",
    section: "20",
    referenceType: "article",
    jurisdiction: "IT",
    language: "it",
    normattivaAct: {
      title: CAD.title,
      actType: CAD.actType,
      actDate: CAD.actDate,
      actNumber: CAD.actNumber,
      guDate: CAD.dataGU,
      guNumber: CAD.guNumber,
    },
    ...(overrides as object),
  } as LawReference;
}

function providerFor(value: unknown, calls: Array<{ url: string; body: unknown }>): NormattivaLawProvider {
  return new NormattivaLawProvider("https://example.invalid", async (url, body) => {
    calls.push({ url, body: JSON.parse(body) });
    return response(200, value);
  }, () => "2026-09-12");
}

function requestSensitiveCadProvider(calls: Array<{ url: string; body: unknown }>): NormattivaLawProvider {
  return new NormattivaLawProvider("https://example.invalid", async (url, body) => {
    const parsedBody = JSON.parse(body) as Record<string, unknown>;
    calls.push({ url, body: parsedBody });
    if (parsedBody.dataGU !== CAD.dataGU || parsedBody.codiceRedazionale !== CAD.codiceRedazionale) {
      return response(404, { message: "Atto non trovato" });
    }
    return response(200, productionShapedCadDetailResponse());
  }, () => "2026-09-12");
}

function ccReference(): LawReference {
  return {
    lawCode: "normattiva:1942-04-04:042U0262",
    section: "1",
    referenceType: "article",
    jurisdiction: "IT",
    language: "it",
    normattivaAct: {
      title: CC.title,
      actType: CC.actType,
      actDate: CC.actDate,
      actNumber: CC.actNumber,
      guDate: CC.dataGU,
      guNumber: CC.guNumber,
    },
  };
}

type DirectDetailResponseParser = (
  value: unknown,
  selectedAct: NormattivaActMetadata,
  expectedDataGU: string,
  expectedCodiceRedazionale: string,
  article: number,
  requestedDate: string,
) => unknown;

function loadDetailResponseParserForTest(): {
  parseDetailResponse: DirectDetailResponseParser;
  sourceContractError: typeof NormattivaSourceContractError;
} {
  const filename = resolve(__dirname, "../src/law/providers/NormattivaLawProvider.js");
  const source = readFileSync(filename, "utf8");
  const NodeModule = require("node:module") as typeof import("node:module");
  const isolatedModule = new NodeModule(filename);
  isolatedModule.filename = filename;
  const compilerModule = isolatedModule as typeof isolatedModule & {
    _compile(source: string, filename: string): void;
  };
  compilerModule._compile(`${source}\nmodule.exports.__test_parseDetailResponse = parseDetailResponse;\n`, filename);
  const isolatedExports = isolatedModule.exports as typeof isolatedModule.exports & {
    __test_parseDetailResponse: DirectDetailResponseParser;
    NormattivaSourceContractError: typeof NormattivaSourceContractError;
  };
  return {
    parseDetailResponse: isolatedExports.__test_parseDetailResponse,
    sourceContractError: isolatedExports.NormattivaSourceContractError,
  };
}

describe("Normattiva identity and Article provider", () => {
  it("binds discovery display and formal identity titles across the CAD detail lookup", async () => {
    const discovery = new NormattivaLawDiscovery(async () => response(200, {
      listaAtti: [{
        dataGU: CAD.dataGU,
        codiceRedazionale: CAD.codiceRedazionale,
        titoloAtto: "[Codice dell'amministrazione digitale.\r ]",
        descrizioneAtto: CAD.title,
        denominazioneAtto: CAD.actType,
        dataEmanazione: "2005-03-07T00:00:00Z",
        numeroProvvedimento: "82",
        numeroGU: "112",
      }],
    }), "https://example.invalid");
    const discovered = await discovery.search("Codice");
    assert.equal(discovered.kind, "results");
    const entry = discovered.entries[0];
    assert.ok(entry);
    const calls: Array<{ url: string; body: unknown }> = [];
    const provider = requestSensitiveCadProvider(calls);
    const section = await provider.getSection({
      lawCode: entry.canonicalInput!,
      section: "20",
      referenceType: "article",
      jurisdiction: "IT",
      language: "it",
      normattivaAct: entry.normattivaAct,
    });
    assert.equal(entry.title, "[Codice dell'amministrazione digitale.\r ]");
    assert.equal(entry.normattivaAct?.title, CAD.title);
    assert.equal(section?.section, "20");
    assert.equal(section?.text.includes("Primo comma."), true);
    assert.equal(calls.length, 1);
  });

  it("rejects a deliberately incorrect formal identity title", async () => {
    const wrongTitle = "DECRETO LEGISLATIVO 7 marzo 2005, n. 999";
    await assert.rejects(() => requestSensitiveCadProvider([]).getSection(reference({
      normattivaAct: { ...reference().normattivaAct!, title: wrongTitle },
    })), (error: unknown) => error instanceof NormattivaSourceContractError);
  });
  it("parses canonical source-native identities losslessly", () => {
    assert.deepEqual(parseNormattivaLawCode("normattiva:2005-05-16:005G0104"), {
      dataGU: "2005-05-16",
      codiceRedazionale: "005G0104",
    });
    assert.deepEqual(parseNormattivaLawCode("normattiva:1942-04-04:042U0262"), {
      dataGU: "1942-04-04",
      codiceRedazionale: "042U0262",
    });
    for (const value of [
      "normattiva:2026-02-30:005G0104",
      "normattiva:2005-05-16:",
      "normattiva:2005-05-16:005G0104 ",
      "URN:NIR:stato:decreto.legislativo:2005-03-07;82",
      "DECRETO LEGISLATIVO 7 marzo 2005, n. 82",
      "normattiva:2005-05-16:005G0104 Art. 20",
    ]) assert.equal(parseNormattivaLawCode(value), null, value);
  });

  it("retrieves CAD Article 20 with exact source coordinates and requested date", async () => {
    const calls: Array<{ url: string; body: unknown }> = [];
    const provider = providerFor(detailResponse(), calls);
    const section = await provider.getSection(reference());

    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, "https://example.invalid/api/v1/atto/dettaglio-atto");
    assert.deepEqual(calls[0].body, {
      dataGU: "2005-05-16",
      codiceRedazionale: "005G0104",
      idArticolo: 20,
      dataVigenza: "2026-09-12",
    });
    assert.equal(section?.lawCode, "normattiva:2005-05-16:005G0104");
    assert.equal(section?.section, "20");
    assert.equal(section?.language, "it");
    assert.equal(section?.isOfficialSource, true);
    assert.equal(section?.isAuthoritativeText, false);
  });

  it("accepts the production-shaped CAD response only for the exact request pair", async () => {
    const calls: Array<{ url: string; body: unknown }> = [];
    const section = await requestSensitiveCadProvider(calls).getSection(reference());
    assert.equal(section?.text.includes("Art. 20"), true);
    assert.equal(section?.text.includes("Primo comma."), true);
    assert.equal(calls.length, 1);

    for (const [lawCode, guDate] of [
      ["normattiva:2006-05-16:005G0104", "2006-05-16"],
      ["normattiva:2005-05-16:006G0104", "2005-05-16"],
      ["normattiva:1942-04-04:005G0104", "1942-04-04"],
    ] as const) {
      const mismatchCalls: Array<{ url: string; body: unknown }> = [];
      const mismatch = await requestSensitiveCadProvider(mismatchCalls).getSection(reference({
        lawCode,
        normattivaAct: { ...reference().normattivaAct!, guDate },
      }));
      assert.equal(mismatch, null);
      assert.equal(mismatchCalls.length, 1);
    }
  });

  it("uses local calendar components for the default current date", async () => {
    const calls: Array<{ body: unknown }> = [];
    const RealDate = Date;
    assert.equal(formatLocalCalendarDate(new RealDate(2026, 8, 12, 0, 15)), "2026-09-12");
    class BoundaryDate extends RealDate {
      constructor(...args: any[]) {
        if (args.length !== 0) {
          super(...args as ConstructorParameters<typeof Date>);
        } else {
          super(2026, 8, 12, 0, 15);
        }
      }

      toISOString(): string {
        return "2026-09-11T22:15:00.000Z";
      }
    }

    try {
      globalThis.Date = BoundaryDate as unknown as DateConstructor;
      await new NormattivaLawProvider("https://example.invalid", async (_url, body) => {
        calls.push({ body: JSON.parse(body) });
        return response(200, detailResponse());
      }).getSection(reference());
    } finally {
      globalThis.Date = RealDate;
    }

    assert.equal((calls[0]?.body as { dataVigenza: string }).dataVigenza, "2026-09-12");
  });

  it("retrieves Codice civile Article 1 in Italian only", async () => {
    const calls: Array<{ url: string; body: unknown }> = [];
    const section = await new NormattivaLawProvider("https://example.invalid", async (url, body) => {
      calls.push({ url, body: JSON.parse(body) });
      return response(200, ccDetailResponse());
    }, () => "2026-09-12").getSection(ccReference());
    assert.equal(section?.lawCode, "normattiva:1942-04-04:042U0262");
    assert.equal(section?.text.includes("Codice civile"), true);
    assert.deepEqual(calls[0]?.body, {
      dataGU: "1942-04-04",
      codiceRedazionale: "042U0262",
      idArticolo: 1,
      dataVigenza: "2026-09-12",
    });
  });

  it("rejects a response proving a different Article", async () => {
    const provider = providerFor(detailResponse({ articoloHtml: ARTICLE_HTML.replace(/art_20|Art\. 20/gu, "art_1").replace("Art. 1", "Art. 1") }), []);
    await assert.rejects(() => provider.getSection(reference()), /unavailable|Article|articolo/i);
  });

  it("rejects a correct marker ID when the visible Article number is wrong", async () => {
    const html = `<h2 class="article-num-akn" id="art_20">Art. 21</h2><p>Meaningful Article body.</p>`;
    await assert.rejects(
      () => providerFor(detailResponse({ articoloHtml: html }), []).getSection(reference()),
      (error: unknown) => error instanceof NormattivaSourceContractError,
    );
  });

  it("fails closed for an Article 0 request even when the transport would return Article 1", async () => {
    const calls: Array<{ body: unknown }> = [];
    const provider = new NormattivaLawProvider(
      "https://example.invalid",
      async (_url, body) => {
        calls.push({ body: JSON.parse(body) });
        return response(200, ccDetailResponse());
      },
      () => "2026-09-12",
    );

    const section = await provider.getSection({ ...ccReference(), section: "0" });
    assert.equal(section, null);
    assert.deepEqual(calls, []);
  });

  it("directly rejects an Article 1 response for an Article 0 request", () => {
    const { parseDetailResponse, sourceContractError } = loadDetailResponseParserForTest();
    assert.throws(
      () => parseDetailResponse(ccDetailResponse(), {
        title: CC.title,
        actType: CC.actType,
        actDate: CC.actDate,
        actNumber: CC.actNumber,
        guDate: CC.dataGU,
        guNumber: CC.guNumber,
      }, CC.dataGU, CC.codiceRedazionale, 0, "2026-09-12"),
      (error: unknown) => {
        assert.equal(error instanceof sourceContractError, true);
        assert.match((error as Error).message, /Article marker mismatch/iu);
        return true;
      },
    );
  });

  it("rejects a marker-only Article body", async () => {
    const html = `<h2 class="article-num-akn" id="art_20">Art. 20</h2>`;
    await assert.rejects(
      () => providerFor(detailResponse({ articoloHtml: html }), []).getSection(reference()),
      (error: unknown) => error instanceof NormattivaSourceContractError,
    );
  });

  it("rejects an Article marker followed only by raw whitespace", async () => {
    const html = `<h2 class="article-num-akn" id="art_20">Art. 20</h2>\n\t   `;
    await assert.rejects(
      () => providerFor(detailResponse({ articoloHtml: html }), []).getSection(reference()),
      (error: unknown) => error instanceof NormattivaSourceContractError,
    );
  });

  it("rejects an Article marker followed only by empty structural content", async () => {
    const html = `<h2 class="article-num-akn" id="art_20">Art. 20</h2>\n<p>   </p><div></div>`;
    await assert.rejects(
      () => providerFor(detailResponse({ articoloHtml: html }), []).getSection(reference()),
      (error: unknown) => error instanceof NormattivaSourceContractError,
    );
  });

  it("rejects a response proving a different base act", async () => {
    const provider = providerFor(detailResponse({ numeroProvvedimento: 83 }), []);
    await assert.rejects(() => provider.getSection(reference()), /unavailable|identity|act/i);
  });

  it("rejects conflicting returned type, date, GU, and echoed code", async () => {
    for (const override of [
      { tipoProvvedimentoDescrizione: "LEGGE" },
      { annoProvvedimento: 2006 },
      { numeroGU: 113 },
      { dataGU: "1942-04-04" },
      { codiceRedazionale: "042U0262" },
    ]) {
      const provider = providerFor(detailResponse(override), []);
      await assert.rejects(() => provider.getSection(reference()), /unavailable|identity|act/i);
    }
  });

  it("rejects successful responses with partial returned source identity", async () => {
    for (const override of [
      { dataGU: undefined },
      { codiceRedazionale: undefined },
    ]) {
      await assert.rejects(
        () => providerFor(detailResponse(override), []).getSection(reference()),
        /unavailable|identity|act/i,
      );
    }
  });

  it("accepts successful responses when both source identity echoes are absent", async () => {
    const section = await providerFor(productionShapedCadDetailResponse(), []).getSection(reference());
    assert.equal(section?.lawCode, "normattiva:2005-05-16:005G0104");
    assert.equal(section?.text.includes("Primo comma."), true);
  });

  it("rejects successful responses with mismatched returned source identity", async () => {
    for (const override of [
      { dataGU: "2006-05-16" },
      { codiceRedazionale: "006G0104" },
    ]) {
      await assert.rejects(
        () => providerFor(detailResponse(override), []).getSection(reference()),
        /unavailable|identity|act/i,
      );
    }
  });

  it("fails closed for malformed success shapes and ambiguity", async () => {
    const baseAtto = (detailResponse() as { data: { atto: Record<string, unknown> } }).data.atto;
    for (const value of [
      {},
      { data: null },
      { data: { atto: null, lista: null } },
      { data: { atto: baseAtto, lista: [baseAtto] } },
      { data: { atto: { ...baseAtto, articoloHtml: "" }, lista: null } },
    ]) {
      const provider = providerFor(value, []);
      await assert.rejects(() => provider.getSection(reference()), /unavailable|missing|ambiguous|Article/i);
    }
  });

  it("classifies malformed HTTP-200 contract responses as source-contract failures", async () => {
    const baseAtto = (detailResponse() as { data: { atto: Record<string, unknown> } }).data.atto;
    const cases = [
      {},
      { data: { atto: baseAtto, lista: [baseAtto] } },
      detailResponse({ dataGU: undefined }),
      detailResponse({ dataGU: "2006-05-16" }),
    ];

    for (const value of cases) {
      await assert.rejects(
        () => providerFor(value, []).getSection(reference()),
        (error: unknown) => {
          assert.equal(error instanceof NormattivaSourceContractError, true);
          assert.equal(error instanceof LawProviderUnavailableError, false);
          return true;
        },
      );
    }

    const invalidJsonProvider = new NormattivaLawProvider(
      "https://example.invalid",
      async () => ({
        ok: true,
        status: 200,
        text: async () => "not-json",
        json: async () => { throw new Error("invalid JSON"); },
      }),
      () => "2026-09-12",
    );
    await assert.rejects(
      () => invalidJsonProvider.getSection(reference()),
      (error: unknown) => {
        assert.equal(error instanceof NormattivaSourceContractError, true);
        assert.equal(error instanceof LawProviderUnavailableError, false);
        return true;
      },
    );
  });

  it("rejects missing, duplicate, and mismatched Article markers", async () => {
    const variants = [
      ARTICLE_HTML.replace(/<h2[\s\S]*?<\/h2>/u, ""),
      ARTICLE_HTML.replace("</h2>", "</h2><h2 class=\"article-num-akn\" id=\"art_20\">Art. 20</h2>"),
      ARTICLE_HTML.replace("art_20", "art_21").replace("Art. 20", "Art. 21"),
    ];
    for (const html of variants) {
      await assert.rejects(() => providerFor(detailResponse({ articoloHtml: html }), []).getSection(reference()), /unavailable|marker|Article/i);
    }
  });

  it("rejects a response whose validity interval excludes the requested date", async () => {
    const provider = providerFor(detailResponse({ articoloDataInizioVigenza: "20270101" }), []);
    await assert.rejects(() => provider.getSection(reference()), /unavailable|valid/i);
  });

  it("validates malformed interval endpoints and handles only the open sentinel", async () => {
    for (const override of [
      { articoloDataInizioVigenza: "20181301" },
      { articoloDataFineVigenza: "20261301" },
      { articoloDataFineVigenza: "00000000" },
    ]) {
      await assert.rejects(() => providerFor(detailResponse(override), []).getSection(reference()), /unavailable|valid/i);
    }
    const section = await providerFor(detailResponse({ articoloDataFineVigenza: "99999999" }), []).getSection(reference());
    assert.equal(section?.validTo, undefined);
  });

  it("rejects invalid dates and unsupported Article forms before transport", async () => {
    for (const [date, section] of [["2026-02-30", "20"], ["2026-13-01", "20"], ["2026-09-12", "0"], ["2026-09-12", "-1"], ["2026-09-12", "13-bis"]]) {
      let calls = 0;
      const provider = new NormattivaLawProvider("https://example.invalid", async () => {
        calls += 1;
        return response(200, detailResponse());
      }, () => date);
      assert.equal(await provider.getSection({ ...reference(), section }), null);
      assert.equal(calls, 0);
    }
  });

  it("maps HTML to bounded text while preserving visible links and stripping scripts/styles", async () => {
    const html = `<div class="bodyTesto"><h2 class="article-num-akn" id="art_20">Art. 20</h2><div>Uno &amp; <a href="/x">due</a>.</div><script>leak()</script><style>.x{}</style><div>Tre.</div></div>`;
    const section = await providerFor(detailResponse({ articoloHtml: html }), []).getSection(reference());
    assert.equal(section?.text.includes("Uno & due."), true);
    assert.equal(section?.text.includes("leak"), false);
    assert.equal(section?.text.includes(".x"), false);
    assert.equal(section?.text.includes("Tre."), true);
  });

  it("preserves live status and non-authoritative official-source semantics", async () => {
    const section = await providerFor(detailResponse(), []).getSection(reference());
    assert.equal(section?.cacheStatus, "live");
    assert.equal(section?.isOfficialSource, true);
    assert.equal(section?.isAuthoritativeText, false);
    assert.equal(section?.sourceUrl, undefined);
  });

  it("distinguishes not-found, bad request, transport, and server failures", async () => {
    const missing = new NormattivaLawProvider("https://example.invalid", async () => response(404, {}), () => "2026-09-12");
    assert.equal(await missing.getSection(reference()), null);
    const badRequest = new NormattivaLawProvider("https://example.invalid", async () => response(400, {}), () => "2026-09-12");
    await assert.rejects(() => badRequest.getSection(reference()), (error: unknown) => {
      assert.equal((error as Error).name, "NormattivaSourceContractError");
      assert.equal((error as { status?: number }).status, 400);
      assert.equal(error instanceof NormattivaSourceContractError, true);
      assert.equal(error instanceof LawProviderUnavailableError, false);
      return true;
    });
    for (const status of [500, 503]) {
      const provider = new NormattivaLawProvider("https://example.invalid", async () => response(status, {}), () => "2026-09-12");
      await assert.rejects(() => provider.getSection(reference()), (error: unknown) => {
        assert.equal(error instanceof LawProviderUnavailableError, true);
        assert.equal(error instanceof NormattivaSourceContractError, false);
        return true;
      });
    }
    const unavailable = new NormattivaLawProvider("https://example.invalid", async () => { throw new Error("offline"); }, () => "2026-09-12");
    await assert.rejects(() => unavailable.getSection(reference()), (error: unknown) => {
      assert.equal(error instanceof LawProviderUnavailableError, true);
      assert.equal(error instanceof NormattivaSourceContractError, false);
      return true;
    });
  });
});
