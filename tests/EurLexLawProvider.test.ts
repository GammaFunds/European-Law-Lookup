import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { EU_LANGUAGES } from "../src/law/euLanguages";
import { LawProviderUnavailableError } from "../src/law/errors";
import {
  buildEurLexFetchRequest,
  buildEurLexSectionUrl,
  EUR_LEX_DSGVO_CELLAR_URL,
} from "../src/law/providers/eurLexMapping";
import { EurLexLawProvider } from "../src/law/providers/EurLexLawProvider";

const reference = {
  lawCode: "DSGVO",
  section: "6",
  referenceType: "article" as const,
  jurisdiction: "EU" as const,
  language: "de" as const,
};

const html = `<!doctype html><html><body><h1 class="oj-doc-ti">Verordnung (EU) 2016/679</h1><div id="art_6"><p class="oj-ti-art">Artikel 6</p><p class="oj-sti-art">Rechtmäßigkeit der Verarbeitung</p><p><strong>Absatz</strong> 1 &amp; Inhalt.</p><div><p>Ein verschachtelter Absatz.</p></div><ol><li>Eintrag eins</li><li>Eintrag zwei</li></ol><script>bad()</script><style>.x{}</style></div><div id="art_7"><p>Artikel 7 darf nicht erscheinen.</p></div></body></html>`;
const entityHtml = `<!doctype html><html><body><h1 class="oj-doc-ti">Verordnung (EU) 2016/679</h1><div id="art_6"><p class="oj-ti-art">Artikel 6</p><p class="oj-sti-art">Rechtmäßigkeit der Verarbeitung</p><p>Decimal &#169; Hex &#x20AC; Max &#x10FFFF; Invalid &#x110000; Big &#999999999999; Surrogate &#xD800; Named &amp; Entity.</p></div></body></html>`;

function transport(status = 200, body = html) {
  return async (url: string, options?: { headers?: Record<string, string> }) => ({
    ok: status >= 200 && status < 300,
    status,
    text: async () => body,
    json: async () => ({ url, options }),
  });
}

describe("EurLexLawProvider", () => {
  it("builds the official Cellar fetch request with exact headers", () => {
    assert.deepEqual(buildEurLexFetchRequest(reference), {
      url: EUR_LEX_DSGVO_CELLAR_URL,
      headers: {
        Accept: "application/xhtml+xml",
        "Accept-Language": "deu",
        "Accept-Max-Cs-Size": "8388608",
      },
    });
  });

  it("resolves registered EU aliases through the generic act mapping", () => {
    assert.deepEqual(buildEurLexFetchRequest({ ...reference, lawCode: "GDPR" }), {
      url: EUR_LEX_DSGVO_CELLAR_URL,
      headers: {
        Accept: "application/xhtml+xml",
        "Accept-Language": "deu",
        "Accept-Max-Cs-Size": "8388608",
      },
    });
    assert.equal(
      buildEurLexSectionUrl({ ...reference, lawCode: "GDPR" }),
      "https://eur-lex.europa.eu/eli/reg/2016/679/oj/deu/html",
    );
  });

  it("builds language-specific official ELI URLs and Cellar headers", () => {
    for (const language of EU_LANGUAGES) {
      const nextReference = { ...reference, language: language.code };
      assert.equal(
        buildEurLexSectionUrl(nextReference),
        `https://eur-lex.europa.eu/eli/reg/2016/679/oj/${language.eliCode}/html`,
      );
      assert.deepEqual(buildEurLexFetchRequest(nextReference), {
        url: EUR_LEX_DSGVO_CELLAR_URL,
        headers: {
          Accept: "application/xhtml+xml",
          "Accept-Language": language.eliCode,
          "Accept-Max-Cs-Size": "8388608",
        },
      });
    }
  });

  it("keeps representative EU language headers aligned", () => {
    const languages = new Map(EU_LANGUAGES.map((item) => [item.code, item.eliCode]));
    for (const code of ["de", "en", "fr", "ga", "pl"] as const) {
      const fetchRequest = buildEurLexFetchRequest({ ...reference, language: code });
      assert.equal(fetchRequest?.headers["Accept-Language"], languages.get(code));
    }
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
    const provider = new EurLexLawProvider(async (url, options) => {
      calls.push({ url, options });
      return {
        ok: true,
        status: 200,
        text: async () => html,
        json: async () => ({}),
      };
    });

    const section = await provider.getSection(reference);

    assert.deepEqual(calls, [
      {
        url: EUR_LEX_DSGVO_CELLAR_URL,
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

  it("supports a final article and rejects every non-200 response class", async () => {
    const finalArticle = await new EurLexLawProvider(
      transport(200, "<html><body><h1 class='oj-doc-ti'>Title</h1><div id='art_99'><p>Last article.</p></div></body></html>"),
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
});
