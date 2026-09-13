import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { FinlexLawDiscovery } from "../src/law/providers/FinlexLawDiscovery";
import type { LawProviderHttpResponse, LawProviderHttpTransport } from "../src/law/httpTransport";
import { LawDiscoveryMalformedResponseError, LawDiscoveryUnavailableError } from "../src/law/LawDiscovery";

const XML = `<?xml version="1.0"?><akomaNtoso xmlns="http://docs.oasis-open.org/legaldocml/ns/akn/3.0"><act><meta><identification><FRBRWork><FRBRuri value="/akn/fi/act/statute-consolidated/2018/729"/><FRBRcountry value="fi"/><FRBRsubtype value="statute-consolidated"/><FRBRnumber value="729"/><FRBRauthoritative value="false"/></FRBRWork><FRBRExpression><FRBRuri value="/akn/fi/act/statute-consolidated/2018/729/fin@20260281"/><FRBRlanguage language="fin"/></FRBRExpression></identification></meta><body><docTitle>Tieliikennelaki</docTitle></body></act></akomaNtoso>`;

function response(status: number, value: string, json = false): LawProviderHttpResponse {
  return { ok: status >= 200 && status < 300, status, text: async () => value, json: async () => json ? JSON.parse(value) : value };
}

function transportFor(responses: LawProviderHttpResponse[], urls: string[]): LawProviderHttpTransport {
  return async (url) => { urls.push(url); const next = responses.shift(); if (!next) throw new Error("unexpected request"); return next; };
}

describe("FinlexLawDiscovery", () => {
  it("discovers a canonical statute identity through the deterministic AKN resource", async () => {
    const urls: string[] = [];
    const discovery = new FinlexLawDiscovery(async (url) => {
      urls.push(url);
      return response(200, XML);
    });

    const result = await discovery.search("729/2018");

    assert.deepEqual(result, {
      kind: "results",
      entries: [{
        jurisdiction: "FI", canonicalInput: "729/2018", title: "Tieliikennelaki",
        sourceUrl: "https://opendata.finlex.fi/finlex/avoindata/v1/akn/fi/act/statute-consolidated/2018/729/fin@latest",
        year: "2018", number: "729",
      }],
    });
    assert.deepEqual(urls, ["https://opendata.finlex.fi/finlex/avoindata/v1/akn/fi/act/statute-consolidated/2018/729/fin@latest"]);
  });

  it("returns empty and never falls back to title search when a direct identity is missing", async () => {
    const urls: string[] = [];
    const discovery = new FinlexLawDiscovery(async (url) => {
      urls.push(url);
      return response(404, "");
    });

    assert.deepEqual(await discovery.search("729/2018"), { kind: "no-results", entries: [] });
    assert.deepEqual(urls, ["https://opendata.finlex.fi/finlex/avoindata/v1/akn/fi/act/statute-consolidated/2018/729/fin@latest"]);
  });

  it("fails closed for malformed, mismatched, and unavailable direct identity responses", async () => {
    const malformed = new FinlexLawDiscovery(async () => response(200, "<broken>"));
    await assert.rejects(() => malformed.search("729/2018"), LawDiscoveryMalformedResponseError);

    const mismatched = new FinlexLawDiscovery(async () => response(200, XML.replace("value=\"729\"", "value=\"730\"")));
    await assert.rejects(() => mismatched.search("729/2018"), LawDiscoveryMalformedResponseError);

    const unavailable = new FinlexLawDiscovery(async () => response(503, ""));
    await assert.rejects(() => unavailable.search("729/2018"), LawDiscoveryUnavailableError);

    const transportFailure = new FinlexLawDiscovery(async () => { throw new Error("offline"); });
    await assert.rejects(() => transportFailure.search("729/2018"), LawDiscoveryUnavailableError);
  });

  it("does not route provider-invalid identities through the direct endpoint", async () => {
    const invalid = ["0/2018", "729/0", "/2018", "729/", "2018/729", "729/2018/1", "72 9/2018", "+729/2018", "729.0/2018", "x729/2018"];
    for (const input of invalid) {
      const urls: string[] = [];
      const discovery = new FinlexLawDiscovery(async (url) => {
        urls.push(url);
        return response(200, "[]", true);
      });
      assert.deepEqual(await discovery.search(input), { kind: "no-results", entries: [] });
      assert.equal(urls.length, 1);
      assert.match(urls[0], /\/statute-consolidated\/list\?/);
      assert.doesNotMatch(urls[0], /\/statute-consolidated\/\d{4}\/\d+\/fin@latest$/);
    }
  });

  it("uses the official encoded title endpoint and verifies AKN identity", async () => {
    const urls: string[] = [];
    const discovery = new FinlexLawDiscovery(transportFor([
      response(200, '[{"akn_uri":"https://opendata.finlex.fi/finlex/avoindata/v1/akn/fi/act/statute-consolidated/2018/729/fin@20260281","status":"MODIFIED"}]', true),
      response(200, XML),
    ], urls));

    const result = await discovery.search("Tieliikenne laki");

    assert.equal(result.kind, "results");
    assert.deepEqual(result.entries[0], {
      jurisdiction: "FI", canonicalInput: "729/2018", title: "Tieliikennelaki",
      sourceUrl: "https://opendata.finlex.fi/finlex/avoindata/v1/akn/fi/act/statute-consolidated/2018/729/fin@20260281",
      year: "2018", number: "729",
    });
    assert.match(urls[0], /\/statute-consolidated\/list\?/);
    assert.match(urls[0], /titleContains=Tieliikenne%20laki/);
    assert.match(urls[0], /langAndVersion=fin%40latest/);
    assert.match(urls[0], /isInForce=true/);
  });

  it("enforces the two-character minimum and caps the official list request at eight", async () => {
    let calls = 0;
    const discovery = new FinlexLawDiscovery(async () => { calls += 1; return response(200, "[]", true); });
    assert.deepEqual(await discovery.search("T"), { kind: "no-results", entries: [] });
    assert.equal(calls, 0);
  });

  it("distinguishes empty, malformed, and unavailable responses", async () => {
    const empty = new FinlexLawDiscovery(async () => response(200, "[]", true));
    assert.deepEqual(await empty.search("zz"), { kind: "no-results", entries: [] });
    const malformed = new FinlexLawDiscovery(async () => response(200, "{}", true));
    await assert.rejects(() => malformed.search("zz"), LawDiscoveryMalformedResponseError);
    const unavailable = new FinlexLawDiscovery(async () => response(429, "", true));
    await assert.rejects(() => unavailable.search("zz"), LawDiscoveryUnavailableError);
  });

  it("rejects a candidate whose verified AKN identity does not match its URI", async () => {
    const discovery = new FinlexLawDiscovery(transportFor([
      response(200, '[{"akn_uri":"https://opendata.finlex.fi/finlex/avoindata/v1/akn/fi/act/statute-consolidated/2018/729/fin@20260281"}]', true),
      response(200, XML.replace("value=\"729\"", "value=\"730\"")),
    ], []));
    await assert.rejects(() => discovery.search("Tieliikenne"), LawDiscoveryMalformedResponseError);
  });
});
