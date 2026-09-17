import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import {
  InMemoryLawSectionCache,
  StoredLawSectionCache,
  lawSectionCacheKey,
} from "../src/law/LawSectionCache";
import type { LawReference, LawSection } from "../src/law/types";

const dkReference: LawReference = {
  jurisdiction: "DK",
  lawCode: "/eli/lta/2014/433",
  section: "1",
  referenceType: "section",
};

describe("canonical Danish cache keys", () => {
  it("uses the isolated DK key for a canonical section reference", () => {
    assert.equal(lawSectionCacheKey(dkReference), "DK:/eli/lta/2014/433:1");
  });

  it("normalizes uppercase ELI identities to the same key", () => {
    assert.equal(
      lawSectionCacheKey({ ...dkReference, lawCode: "/ELI/LTA/2014/433" }),
      "DK:/eli/lta/2014/433:1",
    );
  });

  it("preserves a normalized subsection in the DK key", () => {
    assert.equal(
      lawSectionCacheKey({ ...dkReference, subsection: "stk. 2" }),
      "DK:/eli/lta/2014/433:1:stk. 2",
    );
  });

  it("does not split DK keys by source variant", () => {
    const keys = [undefined, "official-de", "translation-en"].map((sourceVariant) =>
      lawSectionCacheKey({ ...dkReference, sourceVariant: sourceVariant as LawReference["sourceVariant"] }),
    );

    assert.deepEqual(keys, [
      "DK:/eli/lta/2014/433:1",
      "DK:/eli/lta/2014/433:1",
      "DK:/eli/lta/2014/433:1",
    ]);
  });
});

describe("Danish cache read isolation", () => {
  it("reads the canonical DK key and not a legacy unprefixed key", async () => {
    const canonicalSection = dkSection("canonical DK text");
    const cache = new InMemoryLawSectionCache();

    await cache.set(canonicalSection);
    assert.equal((await cache.get(dkReference))?.text, "canonical DK text");
  });

  it("does not read a legacy DE-style entry for a DK reference", async () => {
    const cache = new StoredLawSectionCache({
      async load() {
        return {
          "/ELI/LTA/2014/433:1": dkSection("legacy DE-style text"),
        };
      },
      async save() {
        throw new Error("should not write");
      },
    });

    assert.equal(await cache.get(dkReference), null);
  });
});

function dkSection(text: string): LawSection {
  return {
    providerId: "retsinformation",
    providerLabel: "Retsinformation",
    sourceUrl: "https://www.retsinformation.dk/eli/lta/2014/433",
    lawCode: "/eli/lta/2014/433",
    lawTitle: "Fixture Danish law",
    section: "1",
    referenceType: "section",
    jurisdiction: "DK",
    text,
    retrievedAt: "2026-09-16T00:00:00.000Z",
    cacheStatus: "live",
    isOfficialSource: true,
    isAuthoritativeText: true,
  };
}
