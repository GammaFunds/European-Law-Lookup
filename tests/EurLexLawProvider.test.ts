import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { EU_LANGUAGES } from "../src/law/euLanguages";
import { LawProviderUnavailableError } from "../src/law/errors";
import {
  buildEurLexFetchRequest,
  buildEurLexSectionUrl,
  buildEurLexXhtmlFetchRequest,
  EUR_LEX_DSGVO_CELLAR_URL,
  EUR_LEX_AIACT_CELLAR_URL,
  EUR_LEX_DATA_ACT_CELLAR_URL,
  resolveEuCelexIdentity,
} from "../src/law/providers/eurLexMapping";
import { EurLexLawProvider } from "../src/law/providers/EurLexLawProvider";

const reference = {
  lawCode: "DSGVO",
  section: "6",
  referenceType: "article" as const,
  jurisdiction: "EU" as const,
  language: "de" as const,
};

const html = `<!doctype html><html><head><meta name="celex" content="32016R0679"></head><body><h1 class="oj-doc-ti">Verordnung (EU) 2016/679</h1><div id="art_6"><p class="oj-ti-art">Artikel 6</p><p class="oj-sti-art">Rechtmäßigkeit der Verarbeitung</p><p><strong>Absatz</strong> 1 &amp; Inhalt.</p><div><p>Ein verschachtelter Absatz.</p></div><ol><li>Eintrag eins</li><li>Eintrag zwei</li></ol><script>bad()</script><style>.x{}</style></div><div id="art_7"><p>Artikel 7 darf nicht erscheinen.</p></div></body></html>`;
const entityHtml = `<!doctype html><html><head><meta name="celex" content="32016R0679"></head><body><h1 class="oj-doc-ti">Verordnung (EU) 2016/679</h1><div id="art_6"><p class="oj-ti-art">Artikel 6</p><p class="oj-sti-art">Rechtmäßigkeit der Verarbeitung</p><p>Decimal &#169; Hex &#x20AC; Max &#x10FFFF; Invalid &#x110000; Big &#999999999999; Surrogate &#xD800; Named &amp; Entity.</p></div></body></html>`;
function identifierNotice(celex: string): string {
  return `<?xml version="1.0"?><NOTICE type="identifier"><URI><VALUE>http://publications.europa.eu/resource/cellar/3e485e15-11bd-11e6-ba9a-01aa75ed71a1</VALUE><TYPE>cellar</TYPE><IDENTIFIER>3e485e15-11bd-11e6-ba9a-01aa75ed71a1</IDENTIFIER></URI><SAMEAS><URI><VALUE>http://publications.europa.eu/resource/celex/${celex}</VALUE><TYPE>celex</TYPE><IDENTIFIER>${celex}</IDENTIFIER></URI></SAMEAS></NOTICE>`;
}

const validCellarUri = "<URI><VALUE>http://publications.europa.eu/resource/cellar/3e485e15-11bd-11e6-ba9a-01aa75ed71a1</VALUE><TYPE>cellar</TYPE><IDENTIFIER>3e485e15-11bd-11e6-ba9a-01aa75ed71a1</IDENTIFIER></URI>";
const validCelexUri = (celex = "32016R0679") => `<URI><VALUE>http://publications.europa.eu/resource/celex/${celex}</VALUE><TYPE>celex</TYPE><IDENTIFIER>${celex}</IDENTIFIER></URI>`;
const validNoticeBody = (extra = "") => `<?xml version="1.0"?><NOTICE type="identifier">${validCellarUri}${validCelexUri()}${extra}</NOTICE>`;
const noticeBodyWithoutDeclaration = `<NOTICE type="identifier">${validCellarUri}${validCelexUri()}</NOTICE>`;

async function resultForNotice(notice: string): Promise<{ section: Awaited<ReturnType<EurLexLawProvider["getSection"]>>; calls: number }> {
  let calls = 0;
  const section = await new EurLexLawProvider(async (_url, options) => {
    calls++;
    return {
      ok: true,
      status: 200,
      text: async () => calls === 1 ? notice : html,
      json: async () => options,
    };
  }).getSection(reference);
  return { section, calls };
}

function transport(status = 200, body = html) {
  let call = 0;
  return async (url: string, options?: { headers?: Record<string, string> }) => ({
    ok: status >= 200 && status < 300,
    status,
    text: async () => call++ === 0 ? identifierNotice(url.match(/celex\/(3\d{4}[RLD]\d{4})/)?.[1] ?? "32016R0679") : body,
    json: async () => ({ url, options }),
  });
}

describe("EurLexLawProvider", () => {
  it("builds the official Cellar fetch request with exact headers", () => {
    assert.deepEqual(buildEurLexFetchRequest(reference), {
      url: EUR_LEX_DSGVO_CELLAR_URL,
      headers: {
        Accept: "application/xml;notice=identifiers",
      },
    });
  });

  it("resolves registered EU aliases through the generic act mapping", () => {
    assert.deepEqual(buildEurLexFetchRequest({ ...reference, lawCode: "GDPR" }), {
      url: EUR_LEX_DSGVO_CELLAR_URL,
      headers: {
        Accept: "application/xml;notice=identifiers",
      },
    });
    assert.equal(
      buildEurLexSectionUrl({ ...reference, lawCode: "GDPR" }),
      "https://eur-lex.europa.eu/eli/reg/2016/679/oj/deu/html",
    );
  });

  it("maps an unregistered CELEX directly to Cellar and its generic ELI URL", () => {
    const genericReference = { ...reference, lawCode: "32022R2065" };
    assert.equal(buildEurLexFetchRequest(genericReference)?.url, "https://publications.europa.eu/resource/celex/32022R2065");
    assert.equal(
      buildEurLexSectionUrl(genericReference),
      "https://eur-lex.europa.eu/eli/reg/2022/2065/oj/deu/html",
    );
  });

  it("resolves AI Act aliases through the generic act mapping", () => {
    const aiActRef = { ...reference, lawCode: "AIACT" };
    assert.deepEqual(buildEurLexFetchRequest(aiActRef), {
      url: EUR_LEX_AIACT_CELLAR_URL,
      headers: {
        Accept: "application/xml;notice=identifiers",
      },
    });
    assert.equal(
      buildEurLexSectionUrl(aiActRef),
      "https://eur-lex.europa.eu/eli/reg/2024/1689/oj/deu/html",
    );
    assert.deepEqual(buildEurLexFetchRequest({ ...reference, lawCode: "AI-ACT" }), {
      url: EUR_LEX_AIACT_CELLAR_URL,
      headers: {
        Accept: "application/xml;notice=identifiers",
      },
    });
    assert.equal(
      buildEurLexSectionUrl({ ...reference, lawCode: "AIA" }),
      "https://eur-lex.europa.eu/eli/reg/2024/1689/oj/deu/html",
    );
    assert.deepEqual(buildEurLexFetchRequest({ ...reference, lawCode: "KI-VO" }), {
      url: EUR_LEX_AIACT_CELLAR_URL,
      headers: {
        Accept: "application/xml;notice=identifiers",
      },
    });
  });

  it("resolves Data Act aliases through the generic act mapping", () => {
    const dataActRef = { ...reference, lawCode: "DATA_ACT" };
    assert.deepEqual(buildEurLexFetchRequest(dataActRef), {
      url: EUR_LEX_DATA_ACT_CELLAR_URL,
      headers: {
        Accept: "application/xml;notice=identifiers",
      },
    });
    assert.equal(
      buildEurLexSectionUrl(dataActRef),
      "https://eur-lex.europa.eu/eli/reg/2023/2854/oj/deu/html",
    );
    assert.deepEqual(buildEurLexFetchRequest({ ...reference, lawCode: "DATA ACT" }), {
      url: EUR_LEX_DATA_ACT_CELLAR_URL,
      headers: {
        Accept: "application/xml;notice=identifiers",
      },
    });
  });

  it("builds language-specific official ELI URLs and identifier notice requests", () => {
    for (const language of EU_LANGUAGES) {
      const nextReference = { ...reference, language: language.code };
      assert.equal(
        buildEurLexSectionUrl(nextReference),
        `https://eur-lex.europa.eu/eli/reg/2016/679/oj/${language.eliCode}/html`,
      );
      assert.deepEqual(buildEurLexFetchRequest(nextReference), {
        url: EUR_LEX_DSGVO_CELLAR_URL,
        headers: {
          Accept: "application/xml;notice=identifiers",
        },
      });
    }
  });

  it("keeps representative EU language headers aligned", () => {
    for (const code of ["de", "en", "fr", "ga", "pl"] as const) {
      const fetchRequest = buildEurLexFetchRequest({ ...reference, language: code });
      assert.equal(fetchRequest?.headers.Accept, "application/xml;notice=identifiers");
    }
  });

  it("builds the validated Cellar UUID XHTML request", () => {
    assert.deepEqual(buildEurLexXhtmlFetchRequest(reference, "3e485e15-11bd-11e6-ba9a-01aa75ed71a1"), {
      url: "https://publications.europa.eu/resource/cellar/3e485e15-11bd-11e6-ba9a-01aa75ed71a1",
      headers: {
        Accept: "application/xhtml+xml",
        "Accept-Language": "deu",
        "Accept-Max-Cs-Size": "8388608",
      },
    });
    assert.equal(buildEurLexXhtmlFetchRequest(reference, "not-a-uuid"), null);
  });

  it("does not fetch unsupported references", async () => {
    let calls = 0;
    const provider = new EurLexLawProvider(async () => {
      calls++;
      return {
        ok: true,
        status: 200,
        text: async () => html,
        json: async () => ({}),
      };
    });

    assert.equal(await provider.getSection({ ...reference, jurisdiction: "DE" }), null);
    assert.equal(await provider.getSection({ ...reference, lawCode: "BGB" }), null);
    assert.equal(await provider.getSection({ ...reference, referenceType: "section" }), null);
    assert.equal(calls, 0);
  });

  it("uses the Cellar request, preserves the visible ELI source URL, and strips article labels", async () => {
    const calls: Array<{ url: string; options?: { headers?: Record<string, string> } }> = [];
    let call = 0;
    const provider = new EurLexLawProvider(async (url, options) => {
      calls.push({ url, options });
      return {
        ok: true,
        status: 200,
        text: async () => call++ === 0 ? identifierNotice("32016R0679") : html,
        json: async () => ({}),
      };
    });

    const section = await provider.getSection(reference);

    assert.deepEqual(calls, [
      {
        url: EUR_LEX_DSGVO_CELLAR_URL,
        options: {
          headers: {
            Accept: "application/xml;notice=identifiers",
          },
        },
      },
      {
        url: "https://publications.europa.eu/resource/cellar/3e485e15-11bd-11e6-ba9a-01aa75ed71a1",
        options: {
          headers: {
            Accept: "application/xhtml+xml",
            "Accept-Language": "deu",
            "Accept-Max-Cs-Size": "8388608",
          },
        },
      },
    ]);
    assert.equal(section?.sourceUrl, "https://eur-lex.europa.eu/eli/reg/2016/679/oj/deu/html");
    assert.deepEqual(
      {
        providerId: section?.providerId,
        providerLabel: section?.providerLabel,
        lawCode: section?.lawCode,
        lawTitle: section?.lawTitle,
        section: section?.section,
        referenceType: section?.referenceType,
        jurisdiction: section?.jurisdiction,
        language: section?.language,
        cacheStatus: section?.cacheStatus,
        isOfficialSource: section?.isOfficialSource,
        isAuthoritativeText: section?.isAuthoritativeText,
      },
      {
        providerId: "eur-lex",
        providerLabel: "EUR-Lex",
        lawCode: "DSGVO",
        lawTitle: "Verordnung (EU) 2016/679",
        section: "6",
        referenceType: "article",
        jurisdiction: "EU",
        language: "de",
        cacheStatus: "live",
        isOfficialSource: true,
        isAuthoritativeText: true,
      },
    );
    assert.match(section!.text, /Absatz 1 & Inhalt/);
    assert.match(section!.text, /Ein verschachtelter Absatz/);
    assert.match(section!.text, /Eintrag eins\nEintrag zwei/);
    assert.doesNotMatch(section!.text, /Artikel 6|Rechtmäßigkeit|Artikel 7|bad|<script|<style/);
  });

  it("keeps a generic CELEX as the returned law code", async () => {
    const genericHtml = `<!doctype html><html><head><meta name="celex" content="32022L2555"></head><body><h1 class="oj-doc-ti">Title</h1><div id="art_6"><p class="oj-sti-art">Title</p><p>Body.</p></div></body></html>`;
    const section = await new EurLexLawProvider(transport(200, genericHtml)).getSection({
      ...reference,
      lawCode: "32022L2555",
    });
    assert.equal(section?.lawCode, "32022L2555");
  });

  it("supports a final article and rejects every non-200 response class", async () => {
    const finalArticle = await new EurLexLawProvider(
      transport(200, "<html><head><meta name=\"celex\" content=\"32016R0679\"></head><body><h1 class='oj-doc-ti'>Title</h1><div id='art_99'><p>Last article.</p></div></body></html>"),
    ).getSection({ ...reference, section: "99" });
    assert.equal(finalArticle?.text, "Last article.");

    assert.equal(await new EurLexLawProvider(transport(404)).getSection(reference), null);
    await assert.rejects(
      () => new EurLexLawProvider(transport(202)).getSection(reference),
      LawProviderUnavailableError,
    );
    await assert.rejects(
      () => new EurLexLawProvider(transport(303)).getSection(reference),
      LawProviderUnavailableError,
    );
    await assert.rejects(
      () => new EurLexLawProvider(transport(500)).getSection(reference),
      LawProviderUnavailableError,
    );
    await assert.rejects(
      () => new EurLexLawProvider(async () => {
        throw new Error("offline");
      }).getSection(reference),
      LawProviderUnavailableError,
    );
  });

  it("returns null for malformed and challenge documents", async () => {
    assert.equal(
      await new EurLexLawProvider(transport(200, "<html><body><div id='art_6'>Just a moment</div></body></html>")).getSection(reference),
      null,
    );
    assert.equal(
      await new EurLexLawProvider(transport(200, "<div id='art_6'>Malformed fragment</div>")).getSection(reference),
      null,
    );
  });

  it("decodes valid numeric entities and preserves invalid ones without throwing", async () => {
    const section = await new EurLexLawProvider(transport(200, entityHtml)).getSection(reference);

    assert.ok(section);
    assert.match(section!.text, /Decimal © Hex €/);
    assert.match(section!.text, /\u{10FFFF}/u);
    assert.match(section!.text, /Invalid &#x110000;/);
    assert.match(section!.text, /Big &#999999999999;/);
    assert.match(section!.text, /Surrogate &#xD800;/);
    assert.match(section!.text, /Named & Entity\./);
  });

  it("returns null for non-EU jurisdiction", async () => {
    const provider = new EurLexLawProvider(transport());
    assert.equal(await provider.getSection({ ...reference, jurisdiction: "DE" }), null);
    assert.equal(await provider.getSection({ ...reference, jurisdiction: "AT" }), null);
  });

  it("returns null when euCelex is missing and lawCode is unresolvable", async () => {
    const provider = new EurLexLawProvider(transport());
    assert.equal(await provider.getSection({ ...reference, euCelex: undefined, lawCode: "UNKNOWN" }), null);
  });

  it("returns celex identity in the produced LawSection", async () => {
    const section = await new EurLexLawProvider(transport()).getSection(reference);
    assert.ok(section);
    assert.equal(section!.euCelex, "32016R0679");
    assert.equal(section!.euDocumentType, "R");
  });

  it("returns celex identity for AI Act section", async () => {
    const aiActHtml = `<!doctype html><html><head><meta name="celex" content="32024R1689"></head><body><h1 class="oj-doc-ti">Title</h1><div id="art_1"><p class="oj-sti-art">Title</p><p>Body.</p></div></body></html>`;
    const aiRef = { ...reference, lawCode: "AIACT", euCelex: "32024R1689", section: "1" };
    const section = await new EurLexLawProvider(transport(200, aiActHtml)).getSection(aiRef);
    assert.ok(section);
    assert.equal(section!.euCelex, "32024R1689");
    assert.equal(section!.euDocumentType, "R");
  });

  it("returns null for non-sector-3 CELEX", async () => {
    const provider = new EurLexLawProvider(transport());
    assert.equal(await provider.getSection({ ...reference, lawCode: "02016R0679", euCelex: "02016R0679" }), null);
    assert.equal(await provider.getSection({ ...reference, lawCode: "52016R0679", euCelex: "52016R0679" }), null);
  });

  it("returns null for unsupported document types", async () => {
    const provider = new EurLexLawProvider(transport());
    assert.equal(await provider.getSection({ ...reference, lawCode: "32016C0679", euCelex: "32016C0679" }), null);
  });

  it("identity mismatch between euCelex and lawCode fails closed", async () => {
    const mismatchedRef = { ...reference, lawCode: "AIACT", euCelex: "32016R0679" };
    const section = await new EurLexLawProvider(transport()).getSection(mismatchedRef);
    assert.equal(section, null);
  });

  it("identity mismatch between euDocumentType and CELEX-parsed type fails closed", async () => {
    const mismatchedRef = { ...reference, lawCode: "DSGVO", euCelex: "32016R0679", euDocumentType: "L" as const };
    const section = await new EurLexLawProvider(transport()).getSection(mismatchedRef);
    assert.equal(section, null);
  });

  it("ignores mismatching CELEX metadata in returned XHTML", async () => {
    const celexMismatchHtml = `<!doctype html><html><head><meta name="celex" content="32023R2854"></head><body><div id="art_6"><p class="oj-sti-art">Title</p><p>Body text.</p></div></body></html>`;
    const section = await new EurLexLawProvider(transport(200, celexMismatchHtml)).getSection(reference);
    assert.ok(section);
  });

  it("accepts XHTML without a duplicate CELEX identity field", async () => {
    const noCelexHtml = `<!doctype html><html><head></head><body><h1 class="oj-doc-ti">Verordnung</h1><div id="art_6"><p class="oj-sti-art">Title</p><p>Body text.</p></div></body></html>`;
    const section = await new EurLexLawProvider(transport(200, noCelexHtml)).getSection(reference);
    assert.ok(section);
  });

  it("returned HTML with matching CELEX preserves isAuthoritativeText", async () => {
    const celexMatchHtml = `<!doctype html><html><head><meta name="celex" content="32016R0679"></head><body><h1 class="oj-doc-ti">Verordnung</h1><div id="art_6"><p class="oj-sti-art">Title</p><p>Body text.</p></div></body></html>`;
    const section = await new EurLexLawProvider(transport(200, celexMatchHtml)).getSection(reference);
    assert.ok(section);
    assert.equal(section!.isOfficialSource, true);
    assert.equal(section!.isAuthoritativeText, true);
  });

  it("uses the validated Notice identity when XHTML metadata disagrees", async () => {
    const mismatchHtml = `<!doctype html><html><head><meta name="celex" content="32023R2854"></head><body><div id="art_6"><p class="oj-sti-art">Title</p><p>Body text for art 6.</p></div></body></html>`;
    const section = await new EurLexLawProvider(transport(200, mismatchHtml)).getSection(reference);
    assert.ok(section);
  });

  it("does not treat arbitrary meta descriptions as identity fields", async () => {
    const descriptionHtml = `<!doctype html><html><head><meta name="description" content="Regulation 32016R0679 on data protection."></head><body><div id="art_6"><p class="oj-sti-art">Title</p><p>Body text.</p></div></body></html>`;
    const section = await new EurLexLawProvider(transport(200, descriptionHtml)).getSection(reference);
    assert.ok(section);
  });

  it("does not treat arbitrary head data-value attributes as identity fields", async () => {
    const dataValueHtml = `<!doctype html><html><head><meta property="og:title" data-value="32016R0679"></head><body><div id="art_6"><p class="oj-sti-art">Title</p><p>Body text.</p></div></body></html>`;
    const section = await new EurLexLawProvider(transport(200, dataValueHtml)).getSection(reference);
    assert.ok(section);
  });

  it("accepts CELEX from a recognized meta name=celex identity field", async () => {
    const recognizedHtml = `<!doctype html><html><head><meta name="celex" content="32016R0679"></head><body><div id="art_6"><p class="oj-sti-art">Title</p><p>Body text.</p></div></body></html>`;
    const section = await new EurLexLawProvider(transport(200, recognizedHtml)).getSection(reference);
    assert.ok(section);
    assert.equal(section!.isOfficialSource, true);
    assert.equal(section!.isAuthoritativeText, true);
    assert.equal(section!.euCelex, "32016R0679");
  });

  it("does not treat arbitrary celex-prefixed id attributes as identity fields", async () => {
    const idCelexHtml = `<!doctype html><html><head></head><body><div id="celex-32016R0679"></div><div id="art_6"><p class="oj-sti-art">Title</p><p>Body text.</p></div></body></html>`;
    const section = await new EurLexLawProvider(transport(200, idCelexHtml)).getSection(reference);
    assert.ok(section);
  });

  it("does not treat arbitrary underscore-delimited CELEX ids as identity fields", async () => {
    const idUnderscoreHtml = `<!doctype html><html><head></head><body><div id="CELEX_32016R0679"></div><div id="art_6"><p class="oj-sti-art">Title</p><p>Body text.</p></div></body></html>`;
    const section = await new EurLexLawProvider(transport(200, idUnderscoreHtml)).getSection(reference);
    assert.ok(section);
  });

  it("ignores mismatching ELI data-value in XHTML", async () => {
    const eliMismatchHtml = `<!doctype html><html><head></head><body><span data-eli-document-id-type="celex" data-value="32023R2854"></span><div id="art_6"><p class="oj-sti-art">Title</p><p>Body text.</p></div></body></html>`;
    const section = await new EurLexLawProvider(transport(200, eliMismatchHtml)).getSection(reference);
    assert.ok(section);
  });

  it("ignores malformed ELI data-value in XHTML", async () => {
    const eliMalformedHtml = `<!doctype html><html><head></head><body><span data-eli-document-id-type="celex" data-value="NOTACELEX"></span><div id="art_6"><p class="oj-sti-art">Title</p><p>Body text.</p></div></body></html>`;
    const section = await new EurLexLawProvider(transport(200, eliMalformedHtml)).getSection(reference);
    assert.ok(section);
  });

  it("rejects unqualified data-value without matching identity-type attribute", async () => {
    const unqualifiedHtml = `<!doctype html><html><head></head><body><span data-value="32016R0679"></span><div id="art_6"><p class="oj-sti-art">Title</p><p>Body text.</p></div></body></html>`;
    const section = await new EurLexLawProvider(transport(200, unqualifiedHtml)).getSection(reference);
    assert.ok(section);
  });

  it("accepts CELEX from a recognized ELI identity signal", async () => {
    const eliHtml = `<!doctype html><html><head></head><body><span data-eli-document-id-type="celex" data-value="32016R0679"></span><div id="art_6"><p class="oj-sti-art">Title</p><p>Body text.</p></div></body></html>`;
    const section = await new EurLexLawProvider(transport(200, eliHtml)).getSection(reference);
    assert.ok(section);
    assert.equal(section!.isOfficialSource, true);
    assert.equal(section!.isAuthoritativeText, true);
    assert.equal(section!.euCelex, "32016R0679");
  });

  it("rejects a CELEX URI whose VALUE identifies another CELEX", async () => {
    let calls = 0;
    const wrongValueNotice = identifierNotice("32016R0679").replace(
      "http://publications.europa.eu/resource/celex/32016R0679",
      "http://publications.europa.eu/resource/celex/32023R2854",
    );
    const section = await new EurLexLawProvider(async (_url, options) => {
      calls++;
      return {
        ok: true,
        status: 200,
        text: async () => wrongValueNotice,
        json: async () => options,
      };
    }).getSection(reference);
    assert.equal(section, null);
    assert.equal(calls, 1);
  });

  it("rejects conflicting valid Cellar UUID identities", async () => {
    let calls = 0;
    const conflictingNotice = identifierNotice("32016R0679").replace(
      "</NOTICE>",
      "<URI><VALUE>https://publications.europa.eu/resource/cellar/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa</VALUE><TYPE>cellar</TYPE><IDENTIFIER>aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa</IDENTIFIER></URI></NOTICE>",
    );
    const section = await new EurLexLawProvider(async (_url, options) => {
      calls++;
      return {
        ok: true,
        status: 200,
        text: async () => conflictingNotice,
        json: async () => options,
      };
    }).getSection(reference);
    assert.equal(section, null);
    assert.equal(calls, 1);
  });

  it("does not use mismatching XHTML CELEX metadata as identity", async () => {
    const mismatchingHtml = "<!doctype html><html><head><meta name=\"description\" content=\"32023R2854\"></head><body><div id=\"art_6\"><p>Body.</p><span data-eli-document-id-type=\"celex\" data-value=\"32023R2854\"></span></div></body></html>";
    const section = await new EurLexLawProvider(transport(200, mismatchingHtml)).getSection(reference);
    assert.ok(section);
    assert.equal(section!.isAuthoritativeText, true);
  });

  it("rejects an identifier NOTICE nested inside an outer NOTICE", async () => {
    const notice = `<NOTICE type="object"><WRAPPER>${validNoticeBody().replace(/^<\?xml[^>]*\?>/, "")}</WRAPPER></NOTICE>`;
    const result = await resultForNotice(notice);
    assert.equal(result.section, null);
    assert.equal(result.calls, 1);
  });

  it("rejects an identifier NOTICE inside an arbitrary wrapper", async () => {
    const notice = `<WRAPPER>${validNoticeBody().replace(/^<\?xml[^>]*\?>/, "")}</WRAPPER>`;
    const result = await resultForNotice(notice);
    assert.equal(result.section, null);
    assert.equal(result.calls, 1);
  });

  it("rejects extra sibling NOTICE structure", async () => {
    const notice = `${validNoticeBody()}<NOTICE type="object"></NOTICE>`;
    const result = await resultForNotice(notice);
    assert.equal(result.section, null);
    assert.equal(result.calls, 1);
  });

  it("rejects a valid Cellar block followed by a malformed Cellar UUID block", async () => {
    const result = await resultForNotice(validNoticeBody("<URI><TYPE>cellar</TYPE><IDENTIFIER>not-a-uuid</IDENTIFIER><VALUE>http://publications.europa.eu/resource/cellar/not-a-uuid</VALUE></URI>"));
    assert.equal(result.section, null);
    assert.equal(result.calls, 1);
  });

  it("rejects a Cellar block whose additional candidate has a mismatching VALUE UUID", async () => {
    const result = await resultForNotice(validNoticeBody("<URI><TYPE>cellar</TYPE><IDENTIFIER>3e485e15-11bd-11e6-ba9a-01aa75ed71a1</IDENTIFIER><VALUE>http://publications.europa.eu/resource/cellar/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa</VALUE></URI>"));
    assert.equal(result.section, null);
    assert.equal(result.calls, 1);
  });

  it("rejects Cellar identity fields hidden inside a URI wrapper", async () => {
    const notice = validNoticeBody(`<URI><WRAPPER><TYPE>cellar</TYPE><IDENTIFIER>aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa</IDENTIFIER><VALUE>https://publications.europa.eu/resource/cellar/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa</VALUE></WRAPPER></URI>`);
    const result = await resultForNotice(notice);
    assert.equal(result.section, null);
    assert.equal(result.calls, 1);
  });

  it("rejects CELEX identity fields hidden inside a URI wrapper", async () => {
    const notice = validNoticeBody(`<URI><WRAPPER><TYPE>celex</TYPE><IDENTIFIER>32023R2854</IDENTIFIER><VALUE>https://publications.europa.eu/resource/celex/32023R2854</VALUE></WRAPPER></URI>`);
    const result = await resultForNotice(notice);
    assert.equal(result.section, null);
    assert.equal(result.calls, 1);
  });

  it("rejects unexpected structural text", async () => {
    const notice = validNoticeBody().replace("<NOTICE type=\"identifier\">", "<NOTICE type=\"identifier\">unexpected");
    const result = await resultForNotice(notice);
    assert.equal(result.section, null);
    assert.equal(result.calls, 1);
  });

  it("rejects a lowercase NOTICE root", async () => {
    const notice = validNoticeBody().replace("<NOTICE type=\"identifier\">", "<notice type=\"identifier\">").replace("</NOTICE>", "</notice>");
    const result = await resultForNotice(notice);
    assert.equal(result.section, null);
    assert.equal(result.calls, 1);
  });

  it("rejects an invalid Cellar namespace candidate without a Cellar TYPE", async () => {
    const result = await resultForNotice(validNoticeBody("<URI><TYPE>eli</TYPE><IDENTIFIER>bad</IDENTIFIER><VALUE>https://publications.europa.eu/resource/cellar/not-a-uuid</VALUE></URI>"));
    assert.equal(result.section, null);
    assert.equal(result.calls, 1);
  });

  it("accepts one valid Cellar block with ordinary ELI and OJ URI blocks", async () => {
    const result = await resultForNotice(validNoticeBody("<URI><TYPE>eli</TYPE><IDENTIFIER>x</IDENTIFIER><VALUE>https://eur-lex.europa.eu/eli/reg/2016/679/oj</VALUE></URI><URI><TYPE>oj</TYPE><IDENTIFIER>x</IDENTIFIER><VALUE>https://eur-lex.europa.eu/oj</VALUE></URI>"));
    assert.ok(result.section);
    assert.equal(result.calls, 2);
  });

  it("accepts the real-style identifier notice shape", async () => {
    const result = await resultForNotice(identifierNotice("32016R0679"));
    assert.ok(result.section);
    assert.equal(result.calls, 2);
  });

  it("accepts real-style XHTML without CELEX or ELI markers", async () => {
    const result = await resultForNotice(validNoticeBody());
    assert.ok(result.section);
    assert.equal(result.calls, 2);
  });

  it("does not request XHTML for invalid metadata even when XHTML is perfect", async () => {
    const result = await resultForNotice(`<NOTICE type="object">${validCellarUri}${validCelexUri()}</NOTICE>`);
    assert.equal(result.section, null);
    assert.equal(result.calls, 1);
  });

  it("rejects a declaration whose target name runs <?xml into trailing junk", async () => {
    const result = await resultForNotice(`<?xmlfoo?>${noticeBodyWithoutDeclaration}`);
    assert.equal(result.section, null);
    assert.equal(result.calls, 1);
  });

  it("rejects a declaration whose target name extends <?xml with garbage", async () => {
    const result = await resultForNotice(`<?xml-garbage?>${noticeBodyWithoutDeclaration}`);
    assert.equal(result.section, null);
    assert.equal(result.calls, 1);
  });

  it("rejects <?xml?> without required whitespace after the target name", async () => {
    const result = await resultForNotice(`<?xml?>${noticeBodyWithoutDeclaration}`);
    assert.equal(result.section, null);
    assert.equal(result.calls, 1);
  });

  it("rejects an unquoted garbage attribute in the declaration", async () => {
    const result = await resultForNotice(`<?xml version="1.0" garbage?>${noticeBodyWithoutDeclaration}`);
    assert.equal(result.section, null);
    assert.equal(result.calls, 1);
  });

  it("rejects an unknown quoted attribute in the declaration", async () => {
    const result = await resultForNotice(`<?xml version="1.0" garbage="yes"?>${noticeBodyWithoutDeclaration}`);
    assert.equal(result.section, null);
    assert.equal(result.calls, 1);
  });

  it("rejects declaration attributes placed before the mandatory version", async () => {
    const result = await resultForNotice(`<?xml garbage="yes" version="1.0"?>${noticeBodyWithoutDeclaration}`);
    assert.equal(result.section, null);
    assert.equal(result.calls, 1);
  });

  it("rejects an unsupported declaration version", async () => {
    const result = await resultForNotice(`<?xml version="2.0"?>${noticeBodyWithoutDeclaration}`);
    assert.equal(result.section, null);
    assert.equal(result.calls, 1);
  });

  it("rejects a duplicated declaration version field", async () => {
    const result = await resultForNotice(`<?xml version="1.0" version="1.0"?>${noticeBodyWithoutDeclaration}`);
    assert.equal(result.section, null);
    assert.equal(result.calls, 1);
  });

  it("rejects an unbounded standalone value", async () => {
    const result = await resultForNotice(`<?xml version="1.0" standalone="maybe"?>${noticeBodyWithoutDeclaration}`);
    assert.equal(result.section, null);
    assert.equal(result.calls, 1);
  });

  it("rejects extra attributes after a valid encoding declaration", async () => {
    const result = await resultForNotice(`<?xml version="1.0" encoding="UTF-8" extra="x"?>${noticeBodyWithoutDeclaration}`);
    assert.equal(result.section, null);
    assert.equal(result.calls, 1);
  });

  it("rejects a duplicated XML declaration", async () => {
    const result = await resultForNotice(`<?xml version="1.0"?><?xml version="1.0"?>${noticeBodyWithoutDeclaration}`);
    assert.equal(result.section, null);
    assert.equal(result.calls, 1);
  });

  it("rejects an XML declaration after a structural token", async () => {
    const notice = noticeBodyWithoutDeclaration.replace(
      "<NOTICE type=\"identifier\">",
      "<NOTICE type=\"identifier\"><?xml version=\"1.0\"?>",
    );
    const result = await resultForNotice(notice);
    assert.equal(result.section, null);
    assert.equal(result.calls, 1);
  });

  it("rejects non-XML processing instructions", async () => {
    const result = await resultForNotice(`<?foo bar?>${noticeBodyWithoutDeclaration}`);
    assert.equal(result.section, null);
    assert.equal(result.calls, 1);
  });

  it("rejects an unterminated XML declaration", async () => {
    const result = await resultForNotice(`<?xml version="1.0"${noticeBodyWithoutDeclaration}`);
    assert.equal(result.section, null);
    assert.equal(result.calls, 1);
  });

  it("accepts an identifier notice without any XML declaration", async () => {
    const result = await resultForNotice(noticeBodyWithoutDeclaration);
    assert.ok(result.section);
    assert.equal(result.calls, 2);
  });

  it("accepts a bounded double-quoted version 1.0 declaration", async () => {
    const result = await resultForNotice(`<?xml version="1.0"?>${noticeBodyWithoutDeclaration}`);
    assert.ok(result.section);
    assert.equal(result.calls, 2);
  });

  it("accepts a bounded single-quoted version 1.0 declaration", async () => {
    const result = await resultForNotice(`<?xml version='1.0'?>${noticeBodyWithoutDeclaration}`);
    assert.ok(result.section);
    assert.equal(result.calls, 2);
  });

  it("accepts a bounded double-quoted encoding declaration", async () => {
    const result = await resultForNotice(`<?xml version="1.0" encoding="UTF-8"?>${noticeBodyWithoutDeclaration}`);
    assert.ok(result.section);
    assert.equal(result.calls, 2);
  });

  it("accepts a bounded single-quoted version and encoding declaration", async () => {
    const result = await resultForNotice(`<?xml version='1.0' encoding='UTF-8'?>${noticeBodyWithoutDeclaration}`);
    assert.ok(result.section);
    assert.equal(result.calls, 2);
  });

  it("accepts a bounded encoding and standalone declaration", async () => {
    const result = await resultForNotice(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>${noticeBodyWithoutDeclaration}`);
    assert.ok(result.section);
    assert.equal(result.calls, 2);
  });

  it("accepts a bounded standalone declaration without encoding", async () => {
    const result = await resultForNotice(`<?xml version="1.0" standalone="no"?>${noticeBodyWithoutDeclaration}`);
    assert.ok(result.section);
    assert.equal(result.calls, 2);
  });

  it("accepts surrounding whitespace around a valid declaration", async () => {
    const result = await resultForNotice(`\n  <?xml version="1.0"?>\n  ${noticeBodyWithoutDeclaration}`);
    assert.ok(result.section);
    assert.equal(result.calls, 2);
  });
});
