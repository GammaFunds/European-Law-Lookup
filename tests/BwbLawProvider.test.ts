import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import type { LawProviderHttpResponse, LawProviderHttpTransport } from "../src/law/httpTransport";

const { BwbLawProvider } = require("../src/law/providers/BwbLawProvider") as {
  BwbLawProvider: new (baseUrl: string, fetchFn: LawProviderHttpTransport, currentDate?: () => string) => { getSection(reference: Record<string, string>): Promise<Record<string, unknown> | null> };
};

const XML = `<?xml version="1.0"?><toestand bwb-id="BWBR0005537" bwb-ng-vast-deel="http://wetten.overheid.nl/id/BWBR0005537/2026-08-15/0"><wetgeving xml:lang="nl"><meta-data><owmskern><dcterms:title>Algemene wet bestuursrecht</dcterms:title></owmskern></meta-data><artikel label="Artikel 1:1"><kop><label>Artikel</label><nr>1:1</nr></kop><al>Deze wet verstaat onder bestuursorgaan:</al></artikel></wetgeving></toestand>`;
function response(text: string, status = 200): LawProviderHttpResponse { return { ok: status >= 200 && status < 300, status, text: async () => text, json: async () => JSON.parse(text) }; }
function discoveryXml(): string {
  return `<searchRetrieveResponse xmlns="http://docs.oasis-open.org/ns/search-ws/sruResponse"><numberOfRecords>1</numberOfRecords><records><record><recordData><gzd xmlns="http://standaarden.overheid.nl/sru" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:overheidbwb="http://standaarden.overheid.nl/bwb/terms/"><originalData><overheidbwb:meta><owmskern><dcterms:identifier>BWBR0005537</dcterms:identifier><dcterms:title>Algemene wet bestuursrecht</dcterms:title></owmskern><bwbipm><overheidbwb:toestand>http://wetten.overheid.nl/id/BWBR0005537/2026-08-15/0</overheidbwb:toestand><overheidbwb:geldigheidsperiode_startdatum>2026-01-01</overheidbwb:geldigheidsperiode_startdatum><overheidbwb:geldigheidsperiode_einddatum>9999-12-31</overheidbwb:geldigheidsperiode_einddatum><overheidbwb:zichtperiode_startdatum>2026-01-01</overheidbwb:zichtperiode_startdatum><overheidbwb:zichtperiode_einddatum>9999-12-31</overheidbwb:zichtperiode_einddatum></bwbipm></overheidbwb:meta></originalData><enrichedData><overheidbwb:locatie_toestand>https://repository.officiele-overheidspublicaties.nl/bwb/BWBR0005537/2026-08-15_0/xml/BWBR0005537_2026-08-15_0.xml</overheidbwb:locatie_toestand></enrichedData></gzd></recordData></record></records></searchRetrieveResponse>`;
}

function providerForDate(date: string, calls: string[]): InstanceType<typeof BwbLawProvider> {
  return new BwbLawProvider("https://example.test/sru/Search", async (url) => {
    calls.push(url);
    return response(url.includes("repository") ? XML : discoveryXml());
  }, () => date);
}

describe("BwbLawProvider", () => {
  it("resolves current toestand and extracts a source-backed article", async () => {
    const urls: string[] = [];
    const fetchFn: LawProviderHttpTransport = async (url) => { urls.push(url); return response(url.includes("repository") ? XML : `<searchRetrieveResponse xmlns="http://docs.oasis-open.org/ns/search-ws/sruResponse"><numberOfRecords>1</numberOfRecords><records><record><recordData><gzd xmlns="http://standaarden.overheid.nl/sru" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:overheidbwb="http://standaarden.overheid.nl/bwb/terms/"><originalData><overheidbwb:meta><owmskern><dcterms:identifier>BWBR0005537</dcterms:identifier><dcterms:title>Algemene wet bestuursrecht</dcterms:title></owmskern><bwbipm><overheidbwb:toestand>http://wetten.overheid.nl/id/BWBR0005537/2026-08-15/0</overheidbwb:toestand><overheidbwb:geldigheidsperiode_startdatum>2026-08-15</overheidbwb:geldigheidsperiode_startdatum><overheidbwb:geldigheidsperiode_einddatum>9999-12-31</overheidbwb:geldigheidsperiode_einddatum><overheidbwb:zichtperiode_startdatum>2026-08-15</overheidbwb:zichtperiode_startdatum><overheidbwb:zichtperiode_einddatum>9999-12-31</overheidbwb:zichtperiode_einddatum></bwbipm></overheidbwb:meta></originalData><enrichedData><overheidbwb:locatie_toestand>https://repository.officiele-overheidspublicaties.nl/bwb/BWBR0005537/2026-08-15_0/xml/BWBR0005537_2026-08-15_0.xml</overheidbwb:locatie_toestand></enrichedData></gzd></recordData></record></records></searchRetrieveResponse>`); };
    const section = await new BwbLawProvider("https://example.test/sru/Search", fetchFn, () => "2026-09-14").getSection({ lawCode: "BWBR0005537", section: "1:1", jurisdiction: "NL" });
    assert.equal(section?.providerId, "bwb"); assert.equal(section?.section, "Artikel 1:1"); assert.equal(section?.language, "nl"); assert.equal(section?.text, "Deze wet verstaat onder bestuursorgaan:"); assert.equal(urls.length, 2);
  });

  it("rejects invalid current dates before any network request", async () => {
    for (const date of ["2026-99-99", "2026-02-30", "2026-00-01", "2026-01-00", "0000-01-01", "2026-1-1", "not-a-date"]) {
      const calls: string[] = [];
      const section = await providerForDate(date, calls).getSection({ lawCode: "BWBR0005537", section: "1:1", jurisdiction: "NL" });
      assert.equal(section, null, date);
      assert.equal(calls.length, 0, date);
    }
  });

  it("accepts a valid leap date and rejects a non-leap February 29", async () => {
    const leapCalls: string[] = [];
    assert.ok(await providerForDate("2028-02-29", leapCalls).getSection({ lawCode: "BWBR0005537", section: "1:1", jurisdiction: "NL" }));
    assert.equal(leapCalls.length, 2);

    const nonLeapCalls: string[] = [];
    assert.equal(await providerForDate("2027-02-29", nonLeapCalls).getSection({ lawCode: "BWBR0005537", section: "1:1", jurisdiction: "NL" }), null);
    assert.equal(nonLeapCalls.length, 0);
  });

  it("matches an alphabetic Article suffix without loosening unrelated labels", async () => {
    const calls: string[] = [];
    const provider = new BwbLawProvider("https://example.test/sru/Search", async (url) => {
      calls.push(url);
      return response(url.includes("repository") ? XML.replace(/1:1/gu, "1a") : discoveryXml());
    }, () => "2026-09-14");

    const matching = await provider.getSection({ lawCode: "BWBR0005537", section: "1A", jurisdiction: "NL" });
    assert.equal(matching?.section, "Artikel 1a");
    assert.equal(matching?.text, "Deze wet verstaat onder bestuursorgaan:");
    assert.equal(calls.length, 2);
    assert.equal(await provider.getSection({ lawCode: "BWBR0005537", section: "1B", jurisdiction: "NL" }), null);
  });
});
