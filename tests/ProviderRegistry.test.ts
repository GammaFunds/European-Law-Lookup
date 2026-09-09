import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import type { LawProvider } from "../src/law/LawProvider";
import { LawSectionNotFoundError, ProviderRegistry } from "../src/law/ProviderRegistry";
import { LawProviderUnavailableError } from "../src/law/errors";
import type { LawReference, LawSection } from "../src/law/types";

function section(providerId: string, providerLabel: string): LawSection {
  return {
    providerId,
    providerLabel,
    lawCode: "BGB",
    lawTitle: "Bürgerliches Gesetzbuch",
    section: "823",
    text: "Test text",
    retrievedAt: "2026-05-19T00:00:00.000Z",
    cacheStatus: "cached",
    isOfficialSource: false,
    isAuthoritativeText: false,
  };
}

function provider(id: string, result: LawSection | null, calls: string[]): LawProvider {
  return {
    id,
    label: id,
    async getSection(_reference: LawReference) {
      calls.push(id);
      return result;
    },
  };
}

describe("ProviderRegistry", () => {
  it("returns the first non-null provider result in priority order", async () => {
    const calls: string[] = [];
    const resolved = section("second", "Second Provider");
    const registry = new ProviderRegistry([
      provider("neuris", null, calls),
      provider("gesetze-im-internet", resolved, calls),
      provider("ris", section("third", "Third Provider"), calls),
    ]);

    const result = await registry.getSection({ lawCode: "BGB", section: "823" });

    assert.deepEqual(calls, ["neuris", "gesetze-im-internet"]);
    assert.equal(result.providerId, "second");
    assert.equal(result.providerLabel, "Second Provider");
  });

  it("throws a typed error when no provider resolves the reference", async () => {
    const registry = new ProviderRegistry([provider("neuris", null, [])]);

    await assert.rejects(
      registry.getSection({ lawCode: "BGB", section: "999" }),
      LawSectionNotFoundError,
    );
  });

  it("does not continue to later providers after a provider failure", async () => {
    const calls: string[] = [];
    const failingProvider: LawProvider = {
      id: "neuris",
      label: "Official Provider",
      async getSection(_reference: LawReference) {
        calls.push("neuris");
        throw new LawProviderUnavailableError("neuris", "official lookup failed");
      },
    };
    const registry = new ProviderRegistry([
      failingProvider,
      provider("gesetze-im-internet", section("mock", "Mock Provider"), calls),
    ]);

    await assert.rejects(
      registry.getSection({ lawCode: "BGB", section: "823" }),
      LawProviderUnavailableError,
    );
    assert.deepEqual(calls, ["neuris"]);
  });
});
