import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { buildLawProviders } from "../src/law/providerComposition";
import { allowedCachedProviderIds, buildCachedLawProviders } from "../src/law/cachedProviderComposition";
import { ProviderRegistry } from "../src/law/ProviderRegistry";
import type { LawProvider } from "../src/law/LawProvider";
import type { LawReference, LawSection } from "../src/law/types";

function testSection(providerId: string, reference: LawReference): LawSection {
  return {
    providerId,
    providerLabel: providerId,
    lawCode: reference.lawCode,
    lawTitle: "Test law",
    section: reference.section,
    text: providerId,
    retrievedAt: "2026-09-09T00:00:00.000Z",
    cacheStatus: "live",
    isOfficialSource: true,
    isAuthoritativeText: false,
  };
}

function recordingProvider(
  id: string,
  calls: string[],
  result: "null" | "section" = "null",
): LawProvider {
  return {
    id,
    label: id,
    async getSection(reference) {
      calls.push(id);
      return result === "section" ? testSection(id, reference) : null;
    },
  };
}

function routingProviders(calls: string[], winner: string): LawProvider[] {
  return [
    recordingProvider("eur-lex", calls, winner === "eur-lex" ? "section" : "null"),
    recordingProvider("fedlex", calls, winner === "fedlex" ? "section" : "null"),
    recordingProvider("neuris", calls, winner === "neuris" ? "section" : "null"),
    recordingProvider("gesetze-im-internet", calls, winner === "gesetze-im-internet" ? "section" : "null"),
    recordingProvider("ris", calls, winner === "ris" ? "section" : "null"),
    recordingProvider("boe", calls, winner === "boe" ? "section" : "null"),
  ];
}

describe("provider composition", () => {
  it("registers only runtime providers by default", () => {
    const providers = buildLawProviders();

    assert.deepEqual(
      providers.map((provider) => provider.id),
      ["eur-lex", "fedlex", "neuris", "gesetze-im-internet", "ris", "boe"],
    );
  });

  it("registers MockLawProvider only when explicitly enabled", () => {
    const providers = buildLawProviders({ enableMockLawProvider: true });

    assert.deepEqual(
      providers.map((provider) => provider.id),
      ["eur-lex", "fedlex", "neuris", "gesetze-im-internet", "ris", "boe", "mock"],
    );
  });

  it("does not call the configured transport while composing providers", () => {
    let calls = 0;

    buildLawProviders({
      httpTransport: async () => {
        calls += 1;
        return {
          ok: true,
          status: 200,
          json: async () => ({}),
          text: async () => "",
        };
      },
    });

    assert.equal(calls, 0);
  });

  it("permits cached EUR-Lex sections", () => {
    assert.deepEqual(allowedCachedProviderIds(false), ["eur-lex", "fedlex", "neuris", "gesetze-im-internet", "ris", "boe"]);
  });

  it("isolates ES invocation to BOE", async () => {
    const calls: string[] = [];
    const registry = new ProviderRegistry(routingProviders(calls, "boe"));

    await registry.getSection({ lawCode: "BOE-A-2015-10566", section: "1", jurisdiction: "ES" });

    assert.deepEqual(calls, ["boe"]);
  });

  it("preserves DE Neuris then Gesetze fallback", async () => {
    const calls: string[] = [];
    const providers = routingProviders(calls, "gesetze-im-internet");
    const registry = new ProviderRegistry(providers);

    await registry.getSection({ lawCode: "BGB", section: "823", jurisdiction: "DE" });

    assert.deepEqual(calls, ["neuris", "gesetze-im-internet"]);
  });

  it("routes EU only to Eur-Lex", async () => {
    const calls: string[] = [];
    const registry = new ProviderRegistry(routingProviders(calls, "eur-lex"));

    await registry.getSection({ lawCode: "DSGVO", section: "6", jurisdiction: "EU" });

    assert.deepEqual(calls, ["eur-lex"]);
  });

  it("routes AT only to RIS", async () => {
    const calls: string[] = [];
    const registry = new ProviderRegistry(routingProviders(calls, "ris"));

    await registry.getSection({ lawCode: "ABGB", section: "1295", jurisdiction: "AT" });

    assert.deepEqual(calls, ["ris"]);
  });

  it("routes CH only to Fedlex", async () => {
    const calls: string[] = [];
    const registry = new ProviderRegistry(routingProviders(calls, "fedlex"));

    await registry.getSection({ lawCode: "BV", section: "8", jurisdiction: "CH" });

    assert.deepEqual(calls, ["fedlex"]);
  });

  it("preserves DE routing for an undefined jurisdiction", async () => {
    const calls: string[] = [];
    const registry = new ProviderRegistry(routingProviders(calls, "gesetze-im-internet"));

    await registry.getSection({ lawCode: "BGB", section: "823" });

    assert.deepEqual(calls, ["neuris", "gesetze-im-internet"]);
  });

  it("applies the same jurisdiction isolation through cached composition", async () => {
    const calls: string[] = [];
    const composed = buildCachedLawProviders(
      routingProviders(calls, "boe"),
      { async get() { return null; }, async set() {} },
      { enableLawSectionCache: true, lawSectionCacheTtlDays: null },
    );

    await new ProviderRegistry(composed).getSection({ lawCode: "BOE-A-2015-10566", section: "1", jurisdiction: "ES" });

    assert.deepEqual(calls, ["boe"]);
  });
});
