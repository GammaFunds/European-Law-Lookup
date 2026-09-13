import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import type { LawProviderHttpResponse } from "../src/law/httpTransport";
import { NormattivaLawDiscovery } from "../src/law/providers/NormattivaLawDiscovery";
import type { NormattivaPostTransport } from "../src/law/providers/NormattivaLawProvider";

function response(status: number, value: unknown): LawProviderHttpResponse {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(value),
    json: async () => value,
  };
}

function candidate(index = 0): Record<string, unknown> {
  return {
    dataGU: "2005-05-16",
    codiceRedazionale: `005G${String(104 + index).padStart(4, "0")}`,
    titoloAtto: index === 0 ? "[Codice dell'amministrazione digitale.\r ]" : `Act ${index}`,
    descrizioneAtto: index === 0 ? "DECRETO LEGISLATIVO 7 marzo 2005, n. 82" : `FORMAL ACT ${index}`,
    denominazioneAtto: "DECRETO LEGISLATIVO",
    dataEmanazione: "2005-03-07T00:00:00Z",
    numeroProvvedimento: String(82 + index),
    numeroGU: "112",
  };
}

function civilCodeCandidate(): Record<string, unknown> {
  return {
    dataGU: "1942-04-04",
    codiceRedazionale: "042U0262",
    titoloAtto: "REGIO DECRETO 16 marzo 1942, n. 262",
    descrizioneAtto: "REGIO DECRETO 16 marzo 1942, n. 262",
    denominazioneAtto: "REGIO DECRETO",
    dataEmanazione: "1942-03-16T00:00:00Z",
    numeroProvvedimento: "262",
    numeroGU: "79",
  };
}

function requestSensitiveResponse(body: Record<string, unknown>): unknown {
  if (body.orderType === "recente") {
    return { listaAtti: [candidate(9)] };
  }
  const query = body.testoRicerca;
  return { listaAtti: query === "Codice civile" ? [civilCodeCandidate()] : [candidate()] };
}

describe("Normattiva discovery", () => {
  it("enforces the two-character minimum without requesting", async () => {
    let calls = 0;
    const post: NormattivaPostTransport = async () => {
      calls += 1;
      return response(200, { data: [] });
    };
    const discovery = new NormattivaLawDiscovery(post, "https://example.invalid");
    assert.deepEqual(await discovery.search("x"), { kind: "no-results", entries: [] });
    assert.equal(calls, 0);
  });

  it("uses default relevance so CAD is returned instead of recent distractors", async () => {
    const calls: Array<{ url: string; body: unknown }> = [];
    const post: NormattivaPostTransport = async (url, body) => {
      const parsed = JSON.parse(body) as Record<string, unknown>;
      calls.push({ url, body: parsed });
      return response(200, requestSensitiveResponse(parsed));
    };
    const discovery = new NormattivaLawDiscovery(post, "https://example.invalid");
    const result = await discovery.search("Codice dell'amministrazione digitale");
    assert.equal(calls[0]?.url, "https://example.invalid/api/v1/ricerca/semplice");
    assert.deepEqual(calls[0]?.body, {
      testoRicerca: "Codice dell'amministrazione digitale",
      paginazione: { paginaCorrente: 1, numeroElementiPerPagina: 8 },
    });
    assert.equal(result.kind, "results");
    assert.equal(result.entries[0]?.jurisdiction, "IT");
    assert.equal(result.entries[0]?.sourceUrl, undefined);
    assert.equal(result.entries[0]?.title, "[Codice dell'amministrazione digitale.\r ]");
    assert.equal(result.entries[0]?.normattivaAct?.title, "DECRETO LEGISLATIVO 7 marzo 2005, n. 82");
    assert.equal(result.entries[0]?.canonicalInput, "normattiva:2005-05-16:005G0104");
    assert.equal(result.entries[0]?.normattivaAct?.guDate, "2005-05-16");
    assert.equal(result.entries[0]?.normattivaAct?.actNumber, 82);
  });

  it("uses default relevance so Codice civile is returned with source-native identity", async () => {
    const calls: Record<string, unknown>[] = [];
    const post: NormattivaPostTransport = async (_url, body) => {
      const parsed = JSON.parse(body) as Record<string, unknown>;
      calls.push(parsed);
      return response(200, requestSensitiveResponse(parsed));
    };
    const result = await new NormattivaLawDiscovery(post, "https://example.invalid").search("Codice civile");
    assert.equal(calls[0]?.orderType, undefined);
    assert.equal(result.kind, "results");
    assert.equal(result.entries[0]?.title, "REGIO DECRETO 16 marzo 1942, n. 262");
    assert.equal(result.entries[0]?.canonicalInput, "normattiva:1942-04-04:042U0262");
  });

  it("caps accepted server results at eight", async () => {
    const post: NormattivaPostTransport = async () => response(200, { data: Array.from({ length: 12 }, (_, i) => candidate(i)) });
    const result = await new NormattivaLawDiscovery(post, "https://example.invalid").search("law");
    assert.equal(result.kind, "results");
    assert.equal(result.entries.length, 8);
  });

  it("drops malformed candidates without deriving identity from title", async () => {
    const malformed = [
      { ...candidate(), dataGU: undefined },
      { ...candidate(), codiceRedazionale: undefined },
      { ...candidate(), dataGU: "2026-02-30" },
      { titolo: "DECRETO LEGISLATIVO 7 marzo 2005, n. 82" },
    ];
    const result = await new NormattivaLawDiscovery(async () => response(200, { data: malformed }), "https://example.invalid").search("law");
    assert.deepEqual(result, { kind: "no-results", entries: [] });
  });

  it("fails closed when the formal act description is missing", async () => {
    const result = await new NormattivaLawDiscovery(async () => response(200, {
      data: [{ ...candidate(), descrizioneAtto: undefined }],
    }), "https://example.invalid").search("law");
    assert.deepEqual(result, { kind: "no-results", entries: [] });
  });

  it("distinguishes empty, malformed, transport, and HTTP failure responses", async () => {
    const empty = await new NormattivaLawDiscovery(async () => response(200, { data: [] }), "https://example.invalid").search("zz");
    assert.deepEqual(empty, { kind: "no-results", entries: [] });
    await assert.rejects(
      () => new NormattivaLawDiscovery(async () => response(200, {}), "https://example.invalid").search("zz"),
      /malformed/i,
    );
    await assert.rejects(
      () => new NormattivaLawDiscovery(async () => { throw new Error("offline"); }, "https://example.invalid").search("zz"),
      /unavailable/i,
    );
    await assert.rejects(
      () => new NormattivaLawDiscovery(async () => response(503, {}), "https://example.invalid").search("zz"),
      /unavailable/i,
    );
  });
});
