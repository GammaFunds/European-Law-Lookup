import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { FinlexLawProvider } from "../src/law/providers/FinlexLawProvider";
import { LawProviderUnavailableError } from "../src/law/errors";
import type { LawProviderHttpResponse, LawProviderHttpTransport } from "../src/law/httpTransport";

const XML = `<?xml version="1.0"?><akomaNtoso xmlns="http://docs.oasis-open.org/legaldocml/ns/akn/3.0"><act><meta><identification><FRBRWork><FRBRuri value="/akn/fi/act/statute-consolidated/2018/729"/><FRBRcountry value="fi"/><FRBRsubtype value="statute-consolidated"/><FRBRnumber value="729"/><FRBRauthoritative value="false"/></FRBRWork><FRBRExpression><FRBRuri value="/akn/fi/act/statute-consolidated/2018/729/fin@20260281"/><FRBRlanguage language="fin"/></FRBRExpression></identification></meta><body><docTitle>Tieliikennelaki</docTitle><chapter><section eId="chp_1__sec_1"><num>1 §</num><heading>Soveltamisala</heading><subsection><content><p>Tämä laki koskee liikennettä tiellä.</p></content></subsection></section></chapter></body></act></akomaNtoso>`;

function response(status: number, text: string): LawProviderHttpResponse {
  return { ok: status >= 200 && status < 300, status, text: async () => text, json: async () => JSON.parse(text) };
}

describe("FinlexLawProvider", () => {
  it("returns the verified Finnish section from actual structural semantics", async () => {
    let requested = "";
    const provider = new FinlexLawProvider("https://opendata.finlex.fi/finlex/avoindata/v1", async (url) => { requested = url; return response(200, XML); });
    const section = await provider.getSection({ lawCode: "729/2018", section: "1", jurisdiction: "FI" as never, language: "fin" });
    assert.equal(requested, "https://opendata.finlex.fi/finlex/avoindata/v1/akn/fi/act/statute-consolidated/2018/729/fin@latest");
    assert.deepEqual(section && { ...section, retrievedAt: undefined }, {
      providerId: "finlex", providerLabel: "Finlex", lawCode: "729/2018", lawTitle: "Tieliikennelaki",
      section: "1", referenceType: "section", jurisdiction: "FI", language: "fin", heading: "Soveltamisala",
      text: "Tämä laki koskee liikennettä tiellä.",
      sourceUrl: requested, retrievedAt: undefined, cacheStatus: "live", isOfficialSource: true, isAuthoritativeText: false,
    });
  });

  it("isolates Swedish source text and preserves the same statute identity", async () => {
    const swedish = XML.replace(/fin@20260281/g, "swe@20260281").replace(/language=\"fin\"/g, "language=\"swe\"").replace("Tämä laki koskee liikennettä tiellä.", "Denna lag gäller trafik på väg.").replace("Soveltamisala", "Tillämpningsområde");
    const provider = new FinlexLawProvider("https://opendata.finlex.fi/finlex/avoindata/v1", async () => response(200, swedish));
    const section = await provider.getSection({ lawCode: "729/2018", section: "1", jurisdiction: "FI" as never, language: "swe" });
    assert.equal(section?.lawCode, "729/2018"); assert.equal(section?.language, "swe"); assert.equal(section?.text, "Denna lag gäller trafik på väg.");
  });

  it("resolves an independent consolidated Finnish act by its own FRBR identity", async () => {
    const constitution = XML
      .replace(/2018\/729/g, "1999/731")
      .replace(/729/g, "731")
      .replace(/Tieliikennelaki/g, "Suomen perustuslaki")
      .replace(/Soveltamisala/g, "Valtiosääntö")
      .replace("Tämä laki koskee liikennettä tiellä.", "Suomi on täysivaltainen tasavalta.")
      .replace(/fin@20260281/g, "fin@20180817");
    const provider = new FinlexLawProvider("https://example.invalid", async () => response(200, constitution));
    const section = await provider.getSection({ lawCode: "731/1999", section: "1", jurisdiction: "FI" as never, language: "fin" });
    assert.equal(section?.lawCode, "731/1999");
    assert.equal(section?.lawTitle, "Suomen perustuslaki");
    assert.equal(section?.text, "Suomi on täysivaltainen tasavalta.");
  });

  it("returns null for an unknown section and rejects identity or language mismatches", async () => {
    const provider = new FinlexLawProvider("https://example.invalid", async () => response(200, XML));
    assert.equal(await provider.getSection({ lawCode: "729/2018", section: "99", jurisdiction: "FI" as never, language: "fin" }), null);
    await assert.rejects(() => provider.getSection({ lawCode: "730/2018", section: "1", jurisdiction: "FI" as never, language: "fin" }), /unavailable|identity/i);
    await assert.rejects(() => new FinlexLawProvider("https://example.invalid", async () => response(200, XML.replace(/language=\"fin\"/g, "language=\"swe\""))).getSection({ lawCode: "729/2018", section: "1", jurisdiction: "FI" as never, language: "fin" }), /unavailable|language/i);
    await assert.rejects(() => new FinlexLawProvider("https://example.invalid", async () => response(200, XML.replace("/2018/729/fin@20260281", "/2019/729/fin@20260281"))).getSection({ lawCode: "729/2018", section: "1", jurisdiction: "FI" as never, language: "fin" }), /unavailable|identity/i);
    assert.equal(await provider.getSection({ lawCode: "000729/2018", section: "1", jurisdiction: "FI" as never, language: "fin" }), null);
    assert.equal(await provider.getSection({ lawCode: "0/0000", section: "1", jurisdiction: "FI" as never, language: "fin" }), null);
  });

  it("rejects consolidated documents whose authority metadata is true", async () => {
    const provider = new FinlexLawProvider("https://example.invalid", async () => response(200, XML.replace('FRBRauthoritative value="false"', 'FRBRauthoritative value="true"')));
    await assert.rejects(
      () => provider.getSection({ lawCode: "729/2018", section: "1", jurisdiction: "FI" as never, language: "fin" }),
      LawProviderUnavailableError,
    );
  });

  it("rejects consolidated documents with missing or invalid authority metadata", async () => {
    for (const authority of [
      XML.replace('<FRBRauthoritative value="false"/>', ""),
      XML.replace('FRBRauthoritative value="false"', 'FRBRauthoritative value="maybe"'),
    ]) {
      const provider = new FinlexLawProvider("https://example.invalid", async () => response(200, authority));
      await assert.rejects(
        () => provider.getSection({ lawCode: "729/2018", section: "1", jurisdiction: "FI" as never, language: "fin" }),
        LawProviderUnavailableError,
      );
    }
  });

  it("rejects non-whitespace character data outside the document element", async () => {
    const provider = new FinlexLawProvider("https://example.invalid", async () => response(200, `${XML}trailing`));
    await assert.rejects(
      () => provider.getSection({ lawCode: "729/2018", section: "1", jurisdiction: "FI" as never, language: "fin" }),
      LawProviderUnavailableError,
    );
  });

  it("accepts valid XML with normal surrounding whitespace", async () => {
    const provider = new FinlexLawProvider("https://example.invalid", async () => response(200, ` \n${XML}\n `));
    assert.equal((await provider.getSection({ lawCode: "729/2018", section: "1", jurisdiction: "FI" as never, language: "fin" }))?.text, "Tämä laki koskee liikennettä tiellä.");
  });

  it("fails closed for malformed XML and treats 404/429 as null/unavailable", async () => {
    const malformed = new FinlexLawProvider("https://example.invalid", async () => response(200, "<broken>"));
    await assert.rejects(() => malformed.getSection({ lawCode: "729/2018", section: "1", jurisdiction: "FI" as never, language: "fin" }), LawProviderUnavailableError);
    const missing = new FinlexLawProvider("https://example.invalid", async () => response(404, ""));
    assert.equal(await missing.getSection({ lawCode: "729/2018", section: "1", jurisdiction: "FI" as never, language: "fin" }), null);
    const limited = new FinlexLawProvider("https://example.invalid", async () => response(429, ""));
    await assert.rejects(() => limited.getSection({ lawCode: "729/2018", section: "1", jurisdiction: "FI" as never, language: "fin" }), LawProviderUnavailableError);
  });
});
