import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import type { LawProviderHttpResponse, LawProviderHttpTransport } from "../src/law/httpTransport";
const { BwbLawDiscovery } = require("../src/law/providers/BwbLawDiscovery") as {
  BwbLawDiscovery: new (fetchFn: LawProviderHttpTransport, baseUrl?: string) => { search(query: string): Promise<{ kind: string; entries: Array<Record<string, unknown>> }> };
};

const SRU = `<?xml version="1.0"?><searchRetrieveResponse xmlns="http://docs.oasis-open.org/ns/search-ws/sruResponse"><version>2.0</version><numberOfRecords>1</numberOfRecords><records><record><recordData><gzd xmlns="http://standaarden.overheid.nl/sru" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:overheidbwb="http://standaarden.overheid.nl/bwb/terms/"><originalData><overheidbwb:meta><owmskern><dcterms:identifier>BWBR0005537</dcterms:identifier><dcterms:title>Algemene wet bestuursrecht</dcterms:title></owmskern><bwbipm><overheidbwb:toestand>http://wetten.overheid.nl/id/BWBR0005537/2026-08-15/0</overheidbwb:toestand></bwbipm></overheidbwb:meta></originalData><enrichedData><overheidbwb:locatie_toestand>https://repository.officiele-overheidspublicaties.nl/bwb/BWBR0005537/2026-08-15_0/xml/BWBR0005537_2026-08-15_0.xml</overheidbwb:locatie_toestand></enrichedData></gzd></recordData></record></records></searchRetrieveResponse>`;

function response(text: string, status = 200): LawProviderHttpResponse {
  return { ok: status >= 200 && status < 300, status, text: async () => text, json: async () => JSON.parse(text) };
}

describe("BwbLawDiscovery", () => {
  it("returns a source-backed BWBR result and bounds SRU requests", async () => {
    const urls: string[] = [];
    const fetchFn: LawProviderHttpTransport = async (url) => { urls.push(url); return response(SRU); };
    const result = await new BwbLawDiscovery(fetchFn, "https://example.test/sru/Search").search("Algemene");
    assert.equal(result.kind, "results");
    assert.deepEqual(result.entries[0], {
      jurisdiction: "NL", canonicalInput: "BWBR0005537", title: "Algemene wet bestuursrecht",
      sourceUrl: "https://repository.officiele-overheidspublicaties.nl/bwb/BWBR0005537/2026-08-15_0/xml/BWBR0005537_2026-08-15_0.xml",
    });
    const request = new URL(urls[0]);
    assert.equal(request.searchParams.get("maximumRecords"), "8");
  });
});
