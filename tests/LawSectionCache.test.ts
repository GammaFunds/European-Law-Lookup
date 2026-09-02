import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import type { LawProvider } from "../src/law/LawProvider";
import {
  CachedLawProvider,
  InMemoryLawSectionCache,
  StoredLawSectionCache,
  lawSectionCacheKey,
} from "../src/law/LawSectionCache";
import {
  euLanguageCacheToken,
} from "../src/law/euLanguages";
import { buildCachedLawProviders } from "../src/law/cachedProviderComposition";
import { LawProviderUnavailableError } from "../src/law/errors";
import type { LawReference, LawSection } from "../src/law/types";
import { persistCacheToggleAndRefresh } from "../src/settingsRefresh";

describe("lawSectionCacheKey", () => {
  it("refreshes settings declaratively when available and falls back to display otherwise", async () => {
    const updateEvents: string[] = [];
    const updateState = { enableLawSectionCache: true };
    const updateSettings = async (patch: { enableLawSectionCache: boolean }) => {
      updateEvents.push(`persist:${patch.enableLawSectionCache}`);
      updateState.enableLawSectionCache = patch.enableLawSectionCache;
    };

    const updateTarget = {
      display() {
        updateEvents.push("display");
      },
      update() {
        updateEvents.push("update");
      },
    };

    const updateResult = await persistCacheToggleAndRefresh({
      enabled: false,
      target: updateTarget,
      updateSettings,
    });

    assert.deepEqual(updateEvents, ["persist:false", "update"]);
    assert.equal(updateState.enableLawSectionCache, false);
    assert.equal(updateResult.enableLawSectionCache, false);
    assert.equal(updateResult.ttlDisabled, true);
    assert.equal(updateResult.refreshedVia, "update");

    const fallbackEvents: string[] = [];
    const fallbackState = { enableLawSectionCache: true };
    const fallbackResult = await persistCacheToggleAndRefresh({
      enabled: true,
      target: {
        display() {
          fallbackEvents.push("display");
        },
      },
      updateSettings: async (patch: { enableLawSectionCache: boolean }) => {
        fallbackEvents.push(`persist:${patch.enableLawSectionCache}`);
        fallbackState.enableLawSectionCache = patch.enableLawSectionCache;
      },
    });

    assert.deepEqual(fallbackEvents, ["persist:true", "display"]);
    assert.equal(fallbackState.enableLawSectionCache, true);
    assert.equal(fallbackResult.enableLawSectionCache, true);
    assert.equal(fallbackResult.ttlDisabled, false);
    assert.equal(fallbackResult.refreshedVia, "display");
  });

  it("isolates EU official language cache keys without legacy fallback", async () => {
    const de = { lawCode: "DSGVO", section: "6", referenceType: "article" as const, jurisdiction: "EU" as const, language: "de" as const, euCelex: "32016R0679" as const };
    const en = { ...de, language: "en" as const };
    assert.equal(lawSectionCacheKey(de), "EU:32016R0679:art:6:de"); assert.equal(lawSectionCacheKey(en), "EU:32016R0679:art:6:en");
    const cache = new InMemoryLawSectionCache(); await cache.set(section({ ...de, language: "de", jurisdiction: "EU", referenceType: "article", lawCode: "DSGVO", euCelex: "32016R0679", text: "Deutsch" }));
    assert.equal((await cache.get(en))?.text, undefined); assert.equal((await cache.get(de))?.text, "Deutsch");
  });
  it("normalizes law code for cache keys", () => {
    assert.equal(lawSectionCacheKey({ lawCode: "bgb", section: "823" }), "BGB:823:official-de");
  });

  it("normalizes letter suffix casing for cache keys", () => {
    assert.equal(lawSectionCacheKey({ lawCode: "BGB", section: "312G" }), "BGB:312g:official-de");
    assert.equal(lawSectionCacheKey({ lawCode: "BGB", section: "312g" }), "BGB:312g:official-de");
    assert.equal(lawSectionCacheKey({ lawCode: "BGB", section: "823a" }), "BGB:823a:official-de");
    assert.equal(lawSectionCacheKey({ lawCode: "BGB", section: "823A" }), "BGB:823a:official-de");
  });

  it("distinguishes article references from section references", () => {
    assert.equal(
      lawSectionCacheKey({ lawCode: "GG", section: "1", referenceType: "article" }),
      "GG:art:1:official-de",
    );
    assert.equal(lawSectionCacheKey({ lawCode: "GG", section: "1" }), "GG:1:official-de");
  });

  it("distinguishes pure article and article-section cache keys", () => {
    assert.equal(
      lawSectionCacheKey({
        lawCode: "EGBGB",
        section: "1",
        referenceType: "article",
      }),
      "EGBGB:art:1:official-de",
    );
    assert.equal(
      lawSectionCacheKey({
        lawCode: "EGBGB",
        section: "229",
        subsection: "6",
        referenceType: "article",
      }),
      "EGBGB:art:229:sec:6:official-de",
    );
  });

  it("distinguishes DE and AT cache keys to prevent StGB collision", () => {
    const deKey = lawSectionCacheKey({ lawCode: "STGB", section: "242" });
    const atKey = lawSectionCacheKey({ lawCode: "STGB", section: "75", jurisdiction: "AT" });

    assert.equal(deKey, "STGB:242:official-de");
    assert.equal(atKey, "AT:STGB:75:official-de");
    assert.notEqual(deKey, atKey);
  });

  it("includes AT prefix for AT cache keys", () => {
    assert.equal(
      lawSectionCacheKey({ lawCode: "ABGB", section: "1295", jurisdiction: "AT" }),
      "AT:ABGB:1295:official-de",
    );
    assert.equal(
      lawSectionCacheKey({ lawCode: "ABGB", section: "1295", jurisdiction: "AT", sourceVariant: "translation-en" }),
      "AT:ABGB:1295:translation-en",
    );
  });

  it("does not add AT prefix for undefined jurisdiction (DE-compatible)", () => {
    assert.equal(
      lawSectionCacheKey({ lawCode: "ABGB", section: "1295" }),
      "ABGB:1295:official-de",
    );
  });

  it("distinguishes AT article cache keys", () => {
    assert.equal(
      lawSectionCacheKey({ lawCode: "B-VG", section: "144", referenceType: "article", jurisdiction: "AT" }),
      "AT:B-VG:art:144:official-de",
    );
  });

  it("distinguishes source variants in cache keys", () => {
    assert.equal(
      lawSectionCacheKey({ lawCode: "BGB", section: "823", sourceVariant: "translation-en" }),
      "BGB:823:translation-en",
    );
    assert.equal(
      lawSectionCacheKey({
        lawCode: "GG",
        section: "1",
        referenceType: "article",
        sourceVariant: "translation-en",
      }),
      "GG:art:1:translation-en",
    );
  });

  it("prefixes CH cache keys with CH:", () => {
    assert.equal(
      lawSectionCacheKey({ lawCode: "BV", section: "8", referenceType: "article", jurisdiction: "CH" }),
      "CH:BV:art:8:official-de",
    );
  });

  it("distinguishes CH ZGB Art. 1 from unprefixed ZGB Art. 1", () => {
    const chKey = lawSectionCacheKey({ lawCode: "ZGB", section: "1", referenceType: "article", jurisdiction: "CH" });
    const deKey = lawSectionCacheKey({ lawCode: "ZGB", section: "1", referenceType: "article" });
    assert.equal(chKey, "CH:ZGB:art:1:official-de");
    assert.equal(deKey, "ZGB:art:1:official-de");
    assert.notEqual(chKey, deKey);
  });

  it("uses exact CELEX-based EU cache keys for DSGVO", () => {
    const ref = { lawCode: "DSGVO", section: "6", referenceType: "article" as const, jurisdiction: "EU" as const, language: "de" as const, euCelex: "32016R0679" };
    assert.equal(lawSectionCacheKey(ref), "EU:32016R0679:art:6:de");
  });

  it("uses exact CELEX-based EU cache keys for AI Act", () => {
    const ref = { lawCode: "AIACT", section: "1", referenceType: "article" as const, jurisdiction: "EU" as const, language: "en" as const, euCelex: "32024R1689" };
    assert.equal(lawSectionCacheKey(ref), "EU:32024R1689:art:1:en");
  });

  it("uses exact CELEX-based EU cache keys for Data Act", () => {
    const ref = { lawCode: "DATA_ACT", section: "1", referenceType: "article" as const, jurisdiction: "EU" as const, language: "de" as const, euCelex: "32023R2854" };
    assert.equal(lawSectionCacheKey(ref), "EU:32023R2854:art:1:de");
  });

  it("DSGVO alias and direct CELEX produce the same EU cache key", () => {
    const aliasRef = { lawCode: "DSGVO", section: "6", referenceType: "article" as const, jurisdiction: "EU" as const, language: "de" as const, euCelex: "32016R0679" };
    const directRef = { lawCode: "32016R0679", section: "6", referenceType: "article" as const, jurisdiction: "EU" as const, language: "de" as const, euCelex: "32016R0679" };
    assert.equal(lawSectionCacheKey(aliasRef), lawSectionCacheKey(directRef));
  });

  it("AI Act alias and direct CELEX produce the same EU cache key", () => {
    const aliasRef = { lawCode: "AIACT", section: "1", referenceType: "article" as const, jurisdiction: "EU" as const, language: "de" as const, euCelex: "32024R1689" };
    const directRef = { lawCode: "32024R1689", section: "1", referenceType: "article" as const, jurisdiction: "EU" as const, language: "de" as const, euCelex: "32024R1689" };
    assert.equal(lawSectionCacheKey(aliasRef), lawSectionCacheKey(directRef));
  });

  it("EU cache keys have no legacy lawCode fallback", () => {
    const ref = { lawCode: "DSGVO", section: "6", referenceType: "article" as const, jurisdiction: "EU" as const, language: "de" as const, euCelex: "32016R0679" };
    const key = lawSectionCacheKey(ref);
    assert.ok(key);
    assert.ok(key.startsWith("EU:32016R0679:"));
    assert.doesNotMatch(key, /EU:DSGVO:/);
  });

  it("EU cache keys are isolated by language with no cross-language fallback", async () => {
    const deRef = { lawCode: "DSGVO", section: "6", referenceType: "article" as const, jurisdiction: "EU" as const, language: "de" as const, euCelex: "32016R0679" };
    const enRef = { ...deRef, language: "en" as const };
    assert.notEqual(lawSectionCacheKey(deRef), lawSectionCacheKey(enRef));
    const cache = new InMemoryLawSectionCache();
    await cache.set(section({ ...deRef, text: "Deutsch" }));
    assert.equal((await cache.get(enRef))?.text, undefined);
    assert.equal((await cache.get(deRef))?.text, "Deutsch");
  });

  it("returns null for EU cache key when CELEX is missing", () => {
    const ref = { lawCode: "DSGVO", section: "6", referenceType: "article" as const, jurisdiction: "EU" as const, language: "de" as const };
    assert.equal(lawSectionCacheKey(ref), null);
  });

  it("returns null for malformed EU CELEX", () => {
    const base = { lawCode: "DSGVO", section: "6", referenceType: "article" as const, jurisdiction: "EU" as const, language: "de" as const };
    assert.equal(lawSectionCacheKey({ ...base, euCelex: "MALFORMED" }), null);
    assert.equal(lawSectionCacheKey({ ...base, euCelex: "32016R" }), null);
    assert.equal(lawSectionCacheKey({ ...base, euCelex: "32016R067" }), null);
    assert.equal(lawSectionCacheKey({ ...base, euCelex: "32016R0678901" }), null);
  });

  it("returns null for non-sector-3 EU CELEX", () => {
    const base = { lawCode: "DSGVO", section: "6", referenceType: "article" as const, jurisdiction: "EU" as const, language: "de" as const };
    assert.equal(lawSectionCacheKey({ ...base, euCelex: "02016R0679" }), null);
    assert.equal(lawSectionCacheKey({ ...base, euCelex: "52016R0679" }), null);
  });

  it("returns null for unsupported EU CELEX document type", () => {
    const base = { lawCode: "DSGVO", section: "6", referenceType: "article" as const, jurisdiction: "EU" as const, language: "de" as const };
    assert.equal(lawSectionCacheKey({ ...base, euCelex: "32016C0679" }), null);
    assert.equal(lawSectionCacheKey({ ...base, euCelex: "32016A0679" }), null);
  });

  it("does not create or read EU:UNKNOWN cache entries", async () => {
    const ref = { lawCode: "DSGVO", section: "6", referenceType: "article" as const, jurisdiction: "EU" as const, language: "de" as const };
    const cache = new InMemoryLawSectionCache();
    const sectionWithNoCelex = section({ ...ref, text: "Test" });
    await cache.set(sectionWithNoCelex);
    assert.equal((await cache.get(ref))?.text, undefined);
  });

  it("StoredLawSectionCache skips write and read for EU references without CELEX", async () => {
    let savedEntries: Record<string, LawSection> | null = null;
    const cache = new StoredLawSectionCache({
      async load() { return savedEntries; },
      async save(entries) { savedEntries = entries; },
    });
    const ref = { lawCode: "DSGVO", section: "6", referenceType: "article" as const, jurisdiction: "EU" as const, language: "de" as const };
    await cache.set(section({ ...ref, text: "Test" }));
    assert.equal(savedEntries, null);
    assert.equal(await cache.get(ref), null);
  });

  it("InMemoryLawSectionCache skips write and read for malformed EU CELEX", async () => {
    const cache = new InMemoryLawSectionCache();
    const ref = { lawCode: "DSGVO", section: "6", referenceType: "article" as const, jurisdiction: "EU" as const, language: "de" as const, euCelex: "MALFORMED" };
    await cache.set(section({ ...ref, text: "Test" }));
    assert.equal((await cache.get(ref))?.text, undefined);
  });

  it("StoredLawSectionCache skips write and read for malformed EU CELEX", async () => {
    let savedEntries: Record<string, LawSection> | null = null;
    const cache = new StoredLawSectionCache({
      async load() { return savedEntries; },
      async save(entries) { savedEntries = entries; },
    });
    const ref = { lawCode: "DSGVO", section: "6", referenceType: "article" as const, jurisdiction: "EU" as const, language: "de" as const, euCelex: "32016C0679" };
    await cache.set(section({ ...ref, text: "Test" }));
    assert.equal(savedEntries, null);
    assert.equal(await cache.get(ref), null);
  });

  it("InMemoryLawSectionCache skips write and read for non-sector-3 EU CELEX", async () => {
    const cache = new InMemoryLawSectionCache();
    const ref = { lawCode: "DSGVO", section: "6", referenceType: "article" as const, jurisdiction: "EU" as const, language: "de" as const, euCelex: "02016R0679" };
    await cache.set(section({ ...ref, text: "Test" }));
    assert.equal((await cache.get(ref))?.text, undefined);
  });
});

describe("F4 euLanguageCacheToken fail-closed isolation", () => {
  it("RED 1: invalid explicit token does not collapse to de", () => {
    assert.notEqual(euLanguageCacheToken("xx"), "de");
    assert.equal(euLanguageCacheToken("xx"), null);
  });

  it("RED 1b: long invalid token fails closed", () => {
    assert.equal(euLanguageCacheToken("invalid"), null);
  });

  it("RED 2: invalid EU cache key fails closed", () => {
    const ref = { lawCode: "DSGVO", section: "1", referenceType: "article" as const, jurisdiction: "EU" as const, language: "xx" as const, euCelex: "32016R0679" };
    assert.equal(lawSectionCacheKey(ref), null);
  });

  it("RED 3: invalid language cannot read cached German section", async () => {
    const deRef = { lawCode: "DSGVO", section: "1", referenceType: "article" as const, jurisdiction: "EU" as const, language: "de" as const, euCelex: "32016R0679" };
    const xxRef = { ...deRef, language: "xx" as const };
    const cache = new InMemoryLawSectionCache();
    await cache.set(section({ ...deRef, text: "Deutsch" }));
    assert.equal((await cache.get(xxRef))?.text, undefined);
    assert.equal((await cache.get(deRef))?.text, "Deutsch");
  });

  it("RED 4: no usable EU cache entry is created for invalid language", async () => {
    const deRef = { lawCode: "DSGVO", section: "1", referenceType: "article" as const, jurisdiction: "EU" as const, language: "de" as const, euCelex: "32016R0679" };
    const xxRef = { ...deRef, language: "xx" as const };
    const cache = new InMemoryLawSectionCache();
    await cache.set(section({ ...xxRef, text: "Invalid" }));
    assert.equal((await cache.get(deRef))?.text, undefined);
    assert.equal((await cache.get(xxRef))?.text, undefined);
  });

  it("positive control: existing intentional identities remain valid", () => {
    assert.equal(euLanguageCacheToken(undefined), "de");
    assert.equal(euLanguageCacheToken("de"), "de");
    assert.equal(euLanguageCacheToken("deu"), "de");
    assert.equal(euLanguageCacheToken("fra"), "fr");
    assert.equal(euLanguageCacheToken("xyz"), "xyz");
  });

  it("positive control: distinct valid identities remain isolated", () => {
    const base = { lawCode: "DSGVO", section: "1", referenceType: "article" as const, jurisdiction: "EU" as const, euCelex: "32016R0679" };
    const deKey = lawSectionCacheKey({ ...base, language: "de" as const });
    const frKey = lawSectionCacheKey({ ...base, language: "fra" as const });
    const xyzKey = lawSectionCacheKey({ ...base, language: "xyz" as const });
    assert.notEqual(deKey, frKey);
    assert.notEqual(deKey, xyzKey);
    assert.notEqual(frKey, xyzKey);
  });
});

describe("CachedLawProvider", () => {
  it("does not call provider or cache during construction", () => {
    let providerCalls = 0;
    let cacheCalls = 0;

    new CachedLawProvider(
      lawProvider(async () => {
        providerCalls += 1;
        return section();
      }),
      {
        async get() {
          cacheCalls += 1;
          return null;
        },
        async set() {
          cacheCalls += 1;
        },
      },
      {
        allowedProviderIds: ["gesetze-im-internet"],
      },
    );

    assert.equal(providerCalls, 0);
    assert.equal(cacheCalls, 0);
  });

  it("does not call provider or cache while composing cached providers", () => {
    let providerCalls = 0;
    let cacheCalls = 0;
    const providers = [
      lawProvider(async () => {
        providerCalls += 1;
        return section();
      }),
    ];

    buildCachedLawProviders(
      providers,
      {
        async get() {
          cacheCalls += 1;
          return null;
        },
        async set() {
          cacheCalls += 1;
        },
      },
      {
        enableLawSectionCache: true,
        lawSectionCacheTtlDays: null,
      },
    );

    assert.equal(providerCalls, 0);
    assert.equal(cacheCalls, 0);
  });

  it("bypasses CachedLawProvider composition when cache is disabled", () => {
    const providers = [lawProvider(async () => section())];
    const cache = new InMemoryLawSectionCache();

    const composedProviders = buildCachedLawProviders(
      providers,
      cache,
      {
        enableLawSectionCache: false,
        lawSectionCacheTtlDays: null,
      },
    );

    assert.deepEqual(composedProviders, providers);
  });

  it("calls provider on cache miss and stores successful result", async () => {
    const cache = new InMemoryLawSectionCache();
    let calls = 0;
    const provider = new CachedLawProvider(
      lawProvider(async () => {
        calls += 1;
        return section();
      }),
      cache,
      {
        allowedProviderIds: ["gesetze-im-internet"],
      },
    );

    const result = await provider.getSection(reference());

    assert.equal(calls, 1);
    assert.equal(result?.cacheStatus, "live");
    assert.deepEqual(await cache.get(reference()), section());
  });

  it("prefers live provider result over cached allowed result", async () => {
    const cache = new InMemoryLawSectionCache();
    await cache.set(section({ text: "Cached provider text" }));
    let calls = 0;
    const provider = new CachedLawProvider(
      lawProvider(async () => {
        calls += 1;
        return section({ providerId: "neuris", text: "Live provider text" });
      }),
      cache,
      {
        allowedProviderIds: ["neuris", "gesetze-im-internet"],
      },
    );

    const result = await provider.getSection(reference());

    assert.equal(calls, 1);
    assert.equal(result?.providerId, "neuris");
    assert.equal(result?.cacheStatus, "live");
    assert.equal(result?.text, "Live provider text");
    assert.equal((await cache.get(reference()))?.providerId, "neuris");
  });

  it("returns cached neuris result when provider returns null and neuris is allowed", async () => {
    const cache = new InMemoryLawSectionCache();
    await cache.set(section({ providerId: "neuris", providerLabel: "Rechtsinformationen des Bundes" }));
    let calls = 0;
    const provider = new CachedLawProvider(
      lawProvider(async () => {
        calls += 1;
        return null;
      }),
      cache,
      {
        allowedProviderIds: ["neuris", "gesetze-im-internet"],
      },
    );

    const result = await provider.getSection(reference());

    assert.equal(calls, 1);
    assert.equal(result?.providerId, "neuris");
    assert.equal(result?.cacheStatus, "cached");
  });

  it("returns cached Gesetze im Internet result when provider returns null and Gesetze im Internet is allowed", async () => {
    const cache = new InMemoryLawSectionCache();
    await cache.set(section({ providerId: "gesetze-im-internet" }));
    let calls = 0;
    const provider = new CachedLawProvider(
      lawProvider(async () => {
        calls += 1;
        return null;
      }),
      cache,
      {
        allowedProviderIds: ["neuris", "gesetze-im-internet"],
      },
    );

    const result = await provider.getSection(reference());

    assert.equal(calls, 1);
    assert.equal(result?.providerId, "gesetze-im-internet");
    assert.equal(result?.cacheStatus, "cached");
  });

  it("canonicalizes pre-existing cached STGB display code on fallback", async () => {
    const cache = new InMemoryLawSectionCache();
    await cache.set(section({
      providerId: "gesetze-im-internet",
      sourceUrl: "https://www.gesetze-im-internet.de/stgb/__242.html",
      lawCode: "STGB",
      lawTitle: "Strafgesetzbuch",
      section: "242",
      heading: "Diebstahl",
      text: "Wer eine fremde bewegliche Sache wegnimmt.",
    }));
    const provider = new CachedLawProvider(
      lawProvider(async () => null),
      cache,
      {
        allowedProviderIds: ["neuris", "gesetze-im-internet"],
      },
    );

    const result = await provider.getSection({ lawCode: "STGB", section: "242" });

    assert.equal(result?.lawCode, "StGB");
    assert.equal(result?.cacheStatus, "cached");
  });

  it("returns cached GG article result without colliding with section-style keys", async () => {
    const cache = new InMemoryLawSectionCache();
    await cache.set(section({
      sourceUrl: "https://www.gesetze-im-internet.de/gg/art_1.html",
      lawCode: "GG",
      lawTitle: "Grundgesetz für die Bundesrepublik Deutschland",
      section: "1",
      referenceType: "article",
      heading: "Menschenwürde",
      text: "Die Würde des Menschen ist unantastbar.",
    }));
    const provider = new CachedLawProvider(
      lawProvider(async () => null),
      cache,
      {
        allowedProviderIds: ["neuris", "gesetze-im-internet"],
      },
    );

    const result = await provider.getSection({
      lawCode: "GG",
      section: "1",
      referenceType: "article",
    });

    assert.equal(result?.referenceType, "article");
    assert.equal(result?.lawCode, "GG");
    assert.equal(result?.cacheStatus, "cached");
  });

  it("keeps official and translation cache entries separate", async () => {
    const cache = new InMemoryLawSectionCache();
    await cache.set(section({ text: "German text" }));
    await cache.set(section({
      sourceVariant: "translation-en",
      sourceUrl: "https://www.gesetze-im-internet.de/englisch_bgb/englisch_bgb.html",
      heading: "Liability in damages",
      text: "English text",
    }));

    assert.equal((await cache.get(reference()))?.text, "German text");
    assert.equal(
      (await cache.get({ ...reference(), sourceVariant: "translation-en" }))?.text,
      "English text",
    );
  });

  it("reads legacy official-de section cache entries", async () => {
    const cache = new StoredLawSectionCache({
      async load() {
        return {
          "BGB:823": section({ text: "Legacy German text" }),
        };
      },
      async save() {
        throw new Error("should not write");
      },
    });

    assert.equal((await cache.get(reference()))?.text, "Legacy German text");
  });

  it("reads legacy official-de article cache entries", async () => {
    const cache = new StoredLawSectionCache({
      async load() {
        return {
          "GG:art:1": section({
            lawCode: "GG",
            lawTitle: "Grundgesetz für die Bundesrepublik Deutschland",
            section: "1",
            referenceType: "article",
            text: "Legacy article text",
          }),
        };
      },
      async save() {
        throw new Error("should not write");
      },
    });

    assert.equal(
      (await cache.get({
        lawCode: "GG",
        section: "1",
        referenceType: "article",
      }))?.text,
      "Legacy article text",
    );
  });

  it("does not use legacy official-de cache entries for translation requests", async () => {
    const cache = new StoredLawSectionCache({
      async load() {
        return {
          "BGB:823": section({ text: "Legacy German text" }),
        };
      },
      async save() {
        throw new Error("should not write");
      },
    });

    assert.equal(
      (
        await cache.get({
          ...reference(),
          sourceVariant: "translation-en",
        })
      )?.text,
      "Legacy German text",
    );
  });

  it("does not return cached AT ABGB official-de for AT ABGB translation-en", async () => {
    const cache = new StoredLawSectionCache({
      async load() {
        return {
          "AT:ABGB:1295:official-de": section({
            providerId: "neuris",
            lawCode: "ABGB",
            lawTitle: "Allgemeines bürgerliches Gesetzbuch",
            section: "1295",
            heading: "Schadensersatz",
            text: "AT German text",
          }),
        };
      },
      async save() {
        throw new Error("should not write");
      },
    });

    assert.equal(
      await cache.get({
        lawCode: "ABGB",
        section: "1295",
        jurisdiction: "AT",
        sourceVariant: "translation-en",
      }),
      null,
    );
  });

  it("does not return cached AT StGB official-de for AT StGB translation-en", async () => {
    const cache = new StoredLawSectionCache({
      async load() {
        return {
          "AT:STGB:242:official-de": section({
            providerId: "neuris",
            lawCode: "StGB",
            lawTitle: "Strafgesetzbuch",
            section: "242",
            heading: "Diebstahl",
            text: "AT German text",
          }),
        };
      },
      async save() {
        throw new Error("should not write");
      },
    });

    assert.equal(
      await cache.get({
        lawCode: "STGB",
        section: "242",
        jurisdiction: "AT",
        sourceVariant: "translation-en",
      }),
      null,
    );
  });

  it("does not return cached AT B-VG official-de for AT B-VG translation-en", async () => {
    const cache = new StoredLawSectionCache({
      async load() {
        return {
          "AT:B-VG:art:144:official-de": section({
            providerId: "neuris",
            lawCode: "B-VG",
            lawTitle: "Bundes-Verfassungsgesetz",
            section: "144",
            referenceType: "article",
            heading: "Erkenntnisse und Beschlüsse",
            text: "AT German text",
          }),
        };
      },
      async save() {
        throw new Error("should not write");
      },
    });

    assert.equal(
      await cache.get({
        lawCode: "B-VG",
        section: "144",
        referenceType: "article",
        jurisdiction: "AT",
        sourceVariant: "translation-en",
      }),
      null,
    );
  });

  it("returns cached AT B-VG translation-en for AT B-VG translation-en", async () => {
    const cache = new StoredLawSectionCache({
      async load() {
        return {
          "AT:B-VG:art:144:translation-en": section({
            providerId: "neuris",
            lawCode: "B-VG",
            lawTitle: "Bundes-Verfassungsgesetz",
            section: "144",
            referenceType: "article",
            sourceVariant: "translation-en",
            heading: "Findings and decisions",
            text: "AT English text",
          }),
        };
      },
      async save() {
        throw new Error("should not write");
      },
    });

    assert.equal(
      (
        await cache.get({
          lawCode: "B-VG",
          section: "144",
          referenceType: "article",
          jurisdiction: "AT",
          sourceVariant: "translation-en",
        })
      )?.text,
      "AT English text",
    );
  });

  it("reads official-de variant keys for translation requests before legacy fallback", async () => {
    const cache = new StoredLawSectionCache({
      async load() {
        return {
          "OWIG:1:official-de": section({
            lawCode: "OWiG",
            lawTitle: "Gesetz über Ordnungswidrigkeiten",
            section: "1",
            text: "Variant-key German text",
          }),
          "OWIG:1": section({
            lawCode: "OWiG",
            lawTitle: "Gesetz über Ordnungswidrigkeiten",
            section: "1",
            text: "Legacy German text",
          }),
        };
      },
      async save() {
        throw new Error("should not write");
      },
    });

    assert.equal(
      (
        await cache.get({
          lawCode: "OWIG",
          section: "1",
          sourceVariant: "translation-en",
        })
      )?.text,
      "Variant-key German text",
    );
  });

  it("writes new variant-aware cache keys", async () => {
    let entries: Record<string, LawSection> | null = null;
    const cache = new StoredLawSectionCache({
      async load() {
        return entries;
      },
      async save(nextEntries) {
        entries = nextEntries;
      },
    });

    await cache.set(section());

    assert.deepEqual(Object.keys(entries ?? {}), ["BGB:823:official-de"]);
  });

  it("does not return expired cached result after provider returns null", async () => {
    const cache = new InMemoryLawSectionCache();
    await cache.set(section({ retrievedAt: "2026-05-18T00:00:00.000Z" }));
    let calls = 0;
    const provider = new CachedLawProvider(
      lawProvider(async () => {
        calls += 1;
        return null;
      }),
      cache,
      {
        allowedProviderIds: ["gesetze-im-internet"],
        ttlDays: 1,
        now: () => new Date("2026-05-20T00:00:00.000Z"),
      },
    );

    assert.equal(await provider.getSection(reference()), null);
    assert.equal(calls, 1);
  });

  it("returns unexpired cached result after provider returns null", async () => {
    const cache = new InMemoryLawSectionCache();
    await cache.set(section({ retrievedAt: "2026-05-19T12:00:00.000Z" }));
    const provider = new CachedLawProvider(
      lawProvider(async () => null),
      cache,
      {
        allowedProviderIds: ["gesetze-im-internet"],
        ttlDays: 1,
        now: () => new Date("2026-05-20T00:00:00.000Z"),
      },
    );

    const result = await provider.getSection(reference());

    assert.equal(result?.cacheStatus, "cached");
    assert.equal(result?.text, "Fixture text");
  });

  it("retrieves cached uppercase letter suffix with lowercase reference section", async () => {
    const cache = new InMemoryLawSectionCache();
    await cache.set(section({ section: "312G" }));
    const provider = new CachedLawProvider(
      lawProvider(async () => null),
      cache,
      {
        allowedProviderIds: ["gesetze-im-internet"],
      },
    );

    const result = await provider.getSection({ lawCode: "BGB", section: "312g" });

    assert.equal(result?.section, "312G");
    assert.equal(result?.cacheStatus, "cached");
  });

  it("retrieves cached lowercase letter suffix with uppercase reference section", async () => {
    const cache = new InMemoryLawSectionCache();
    await cache.set(section({ section: "312g" }));
    const provider = new CachedLawProvider(
      lawProvider(async () => null),
      cache,
      {
        allowedProviderIds: ["gesetze-im-internet"],
      },
    );

    const result = await provider.getSection({ lawCode: "BGB", section: "312G" });

    assert.equal(result?.section, "312g");
    assert.equal(result?.cacheStatus, "cached");
  });

  it("ignores cached mock result when provider returns null and mock is not allowed", async () => {
    const cache = new InMemoryLawSectionCache();
    await cache.set(section({ providerId: "mock", providerLabel: "Mock Law Provider" }));
    let calls = 0;
    const provider = new CachedLawProvider(
      lawProvider(async () => {
        calls += 1;
        return null;
      }),
      cache,
      {
        allowedProviderIds: ["neuris", "gesetze-im-internet"],
      },
    );

    const result = await provider.getSection(reference());

    assert.equal(calls, 1);
    assert.equal(result, null);
  });

  it("returns cached mock result only when provider returns null and mock is explicitly allowed", async () => {
    const cache = new InMemoryLawSectionCache();
    await cache.set(section({ providerId: "mock", providerLabel: "Mock Law Provider" }));
    let calls = 0;
    const provider = new CachedLawProvider(
      lawProvider(async () => {
        calls += 1;
        return null;
      }),
      cache,
      {
        allowedProviderIds: ["neuris", "gesetze-im-internet", "mock"],
      },
    );

    const result = await provider.getSection(reference());

    assert.equal(calls, 1);
    assert.equal(result?.providerId, "mock");
    assert.equal(result?.providerLabel, "Mock Law Provider");
    assert.equal(result?.cacheStatus, "cached");
  });

  it("returns live result when cache write fails", async () => {
    let calls = 0;
    const provider = new CachedLawProvider(
      lawProvider(async () => {
        calls += 1;
        return section();
      }),
      {
        async get() {
          return null;
        },
        async set() {
          throw new Error("cache unavailable");
        },
      },
      {
        allowedProviderIds: ["gesetze-im-internet"],
      },
    );

    const result = await provider.getSection(reference());

    assert.equal(calls, 1);
    assert.equal(result?.cacheStatus, "live");
    assert.equal(result?.text, "Fixture text");
  });

  it("propagates provider failures without returning cached fallback", async () => {
    const cache = new InMemoryLawSectionCache();
    await cache.set(section());
    const provider = new CachedLawProvider(
      lawProvider(async () => {
        throw new LawProviderUnavailableError("fixture", "provider unavailable");
      }),
      cache,
      {
        allowedProviderIds: ["gesetze-im-internet"],
      },
    );

    await assert.rejects(
      provider.getSection(reference()),
      LawProviderUnavailableError,
    );
    assert.deepEqual(await cache.get(reference()), section());
  });

  it("does not return DE legacy STGB entries for AT STGB references", async () => {
    const cache = new StoredLawSectionCache({
      async load() {
        return {
          "STGB:75:official-de": section({
            providerId: "gesetze-im-internet",
            lawCode: "STGB",
            lawTitle: "Strafgesetzbuch",
            section: "75",
            heading: "DE legacy Diebstahl",
            text: "DE legacy text",
          }),
        };
      },
      async save() {
        throw new Error("should not write");
      },
    });

    assert.equal(
      await cache.get({ lawCode: "STGB", section: "75", jurisdiction: "AT" }),
      null,
    );
  });

  it("keeps existing DE legacy STGB entries readable for bare references", async () => {
    const cache = new StoredLawSectionCache({
      async load() {
        return {
          "STGB:75:official-de": section({
            providerId: "gesetze-im-internet",
            lawCode: "STGB",
            lawTitle: "Strafgesetzbuch",
            section: "75",
            heading: "Diebstahl",
            text: "Legacy German text",
          }),
        };
      },
      async save() {
        throw new Error("should not write");
      },
    });

    assert.equal((await cache.get({ lawCode: "STGB", section: "75" }))?.text, "Legacy German text");
  });

  it("does not cache null results", async () => {
    const cache = new InMemoryLawSectionCache();
    let calls = 0;
    const provider = new CachedLawProvider(
      lawProvider(async () => {
        calls += 1;
        return null;
      }),
      cache,
      {
        allowedProviderIds: ["gesetze-im-internet"],
      },
    );

    assert.equal(await provider.getSection(reference()), null);
    assert.equal(await cache.get(reference()), null);
    assert.equal(calls, 1);
  });

  it("CH reads do not return unprefixed legacy entries", async () => {
    const cache = new StoredLawSectionCache({
      async load() {
        return {
          "ZGB:art:1:official-de": {
            providerId: "gesetze-im-internet",
            providerLabel: "Gesetze im Internet",
            sourceUrl: "https://example.com",
            lawCode: "ZGB",
            lawTitle: "Zivilgesetzbuch",
            section: "1",
            referenceType: "article",
            sourceVariant: "official-de",
            heading: "Anwendung des Rechts",
            text: "DE legacy text",
            retrievedAt: "2026-07-10T00:00:00.000Z",
            cacheStatus: "live",
            isOfficialSource: true,
            isAuthoritativeText: false,
          },
        };
      },
      async save() {
        throw new Error("should not write");
      },
    });

    assert.equal(
      await cache.get({
        lawCode: "ZGB",
        section: "1",
        referenceType: "article",
        jurisdiction: "CH",
      }),
      null,
    );
  });

  it("writes and reads CH Fedlex cached section", async () => {
    const cache = new InMemoryLawSectionCache();
    await cache.set({
      providerId: "fedlex",
      providerLabel: "Fedlex / Bundesrecht der Schweiz",
      sourceUrl: "https://fedlex.data.admin.ch/eli/cc/1999/404/art_8",
      lawCode: "BV",
      lawTitle: "Bundesverfassung der Schweizerischen Eidgenossenschaft",
      section: "8",
      referenceType: "article",
      sourceVariant: "official-de",
      jurisdiction: "CH",
      heading: "Rechtsgleichheit",
      text: "Alle Menschen sind vor dem Gesetz gleich.",
      retrievedAt: "2026-07-10T00:00:00.000Z",
      cacheStatus: "live",
      isOfficialSource: true,
      isAuthoritativeText: true,
    });

    const result = await cache.get({
      lawCode: "BV",
      section: "8",
      referenceType: "article",
      jurisdiction: "CH",
    });

    assert.notEqual(result, null);
    assert.equal(result!.heading, "Rechtsgleichheit");
    assert.equal(result!.jurisdiction, "CH");
    assert.equal(result!.providerId, "fedlex");
  });

  it("stores CH Fedlex section with exact CH-prefixed key and isolates from DE lookups", async () => {
    let savedEntries: Record<string, LawSection> | null = null;
    const cache = new StoredLawSectionCache({
      async load() {
        return savedEntries;
      },
      async save(entries) {
        savedEntries = entries;
      },
    });

    await cache.set({
      providerId: "fedlex",
      providerLabel: "Fedlex / Bundesrecht der Schweiz",
      sourceUrl: "https://fedlex.data.admin.ch/eli/cc/1999/404/art_8",
      lawCode: "BV",
      lawTitle: "Bundesverfassung der Schweizerischen Eidgenossenschaft",
      section: "8",
      referenceType: "article",
      sourceVariant: "official-de",
      jurisdiction: "CH",
      heading: "Rechtsgleichheit",
      text: "Alle Menschen sind vor dem Gesetz gleich.",
      retrievedAt: "2026-07-10T00:00:00.000Z",
      cacheStatus: "live",
      isOfficialSource: true,
      isAuthoritativeText: true,
    });

    // Verify stored entries contain exactly the CH-prefixed key
    assert.notEqual(savedEntries, null);
    const storedKeys = Object.keys(savedEntries!);
    assert.ok(storedKeys.includes("CH:BV:art:8:official-de"));

    // Verify no unprefixed BV key was written
    assert.ok(!storedKeys.includes("BV:art:8:official-de"));

    // Verify stored section metadata
    const stored = savedEntries!["CH:BV:art:8:official-de"];
    assert.equal(stored.providerId, "fedlex");
    assert.equal(stored.jurisdiction, "CH");
    assert.equal(stored.referenceType, "article");

    // Verify CH lookup reads the saved CH entry
    const chResult = await cache.get({
      lawCode: "BV",
      section: "8",
      referenceType: "article",
      jurisdiction: "CH",
    });
    assert.notEqual(chResult, null);
    assert.equal(chResult!.heading, "Rechtsgleichheit");

    // Verify undefined/DE lookup does NOT read the CH-prefixed entry
    const deResult = await cache.get({
      lawCode: "BV",
      section: "8",
      referenceType: "article",
    });
    assert.equal(deResult, null);
  });
});

function lawProvider(getSection: LawProvider["getSection"]): LawProvider {
  return {
    id: "fixture",
    label: "Fixture Provider",
    getSection,
  };
}

function reference(): LawReference {
  return {
    lawCode: "BGB",
    section: "823",
  };
}

function section(overrides: Partial<LawSection> = {}): LawSection {
  return {
    providerId: "gesetze-im-internet",
    providerLabel: "Gesetze im Internet",
    sourceUrl: "https://www.gesetze-im-internet.de/bgb/__823.html",
    lawCode: "BGB",
    lawTitle: "Bürgerliches Gesetzbuch",
    section: "823",
    sourceVariant: "official-de",
    heading: "Schadensersatzpflicht",
    text: "Fixture text",
    retrievedAt: "2026-05-20T00:00:00.000Z",
    cacheStatus: "live",
    isOfficialSource: true,
    isAuthoritativeText: false,
    ...overrides,
  };
}
