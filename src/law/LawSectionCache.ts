import { canonicalDisplayLawCode } from "./displayLawCode";
import { normalizeReferenceType } from "./referenceLabel";
import type { LawProvider } from "./LawProvider";
import type { LawReference, LawSection, LawSourceVariant } from "./types";
import { euLanguageCacheToken } from "./euLanguages";
import { parseEuCelex } from "./euActRegistry";

export interface LawSectionCache {
  get(reference: LawReference): Promise<LawSection | null>;
  set(section: LawSection): Promise<void>;
}

export interface LawSectionCacheStorage {
  load(): Promise<Record<string, LawSection> | null>;
  save(entries: Record<string, LawSection>): Promise<void>;
}

export interface CachedLawProviderOptions {
  allowedProviderIds: readonly string[];
  ttlDays?: number | null;
  now?: () => Date;
}

export function normalizeLawSourceVariant(sourceVariant?: LawSourceVariant): LawSourceVariant {
  return sourceVariant === "translation-en" ? "translation-en" : "official-de";
}

export function lawSectionCacheKey(reference: LawReference): string | null {
  if (reference.jurisdiction === "EU") {
    const celex = reference.euCelex?.trim().toUpperCase();
    if (!celex) return null;
    if (!parseEuCelex(celex)) return null;
    const languageToken = euLanguageCacheToken(reference.language);
    if (languageToken === null) return null;
    return `EU:${celex}:${euSectionKey(reference)}:${languageToken}`;
  }
  const jurisdiction = reference.jurisdiction === "AT" ? "AT:" : reference.jurisdiction === "CH" ? "CH:" : "";
  if (reference.jurisdiction === "CH") {
    const language = reference.language ?? "de";
    if (language !== "de" && language !== "fr" && language !== "it") return null;
    return `${jurisdiction}${legacyLawSectionCacheKey(reference)}:official-${language}`;
  }
  return `${jurisdiction}${legacyLawSectionCacheKey(reference)}:${normalizeLawSourceVariant(reference.sourceVariant)}`;
}

function euSectionKey(reference: LawReference): string {
  const section = reference.section.trim().toLowerCase();
  const subsection = reference.subsection?.trim().toLowerCase();
  if (normalizeReferenceType(reference.referenceType) === "article") {
    if (subsection) return `art:${section}:sec:${subsection}`;
    return `art:${section}`;
  }
  return section;
}

function legacyLawSectionCacheKey(reference: LawReference): string {
  const lawCode = reference.lawCode.trim().toUpperCase();
  const section = reference.section.trim().toLowerCase();
  const subsection = reference.subsection?.trim().toLowerCase();
  if (normalizeReferenceType(reference.referenceType) === "article") {
    if (subsection) {
      return `${lawCode}:art:${section}:sec:${subsection}`;
    }

    return `${lawCode}:art:${section}`;
  }

  return `${lawCode}:${section}`;
}

function cacheKeysForRead(reference: LawReference): string[] {
  const key = lawSectionCacheKey(reference);
  if (key === null) return [];
  if (reference.jurisdiction === "EU") {
    return [key];
  }
  if (reference.jurisdiction === "AT" || reference.jurisdiction === "CH") {
    return [key];
  }

  if (normalizeLawSourceVariant(reference.sourceVariant) === "translation-en") {
    return [
      key,
      lawSectionCacheKey({ ...reference, sourceVariant: "official-de" }),
      legacyLawSectionCacheKey(reference),
    ].filter((k): k is string => k !== null);
  }

  return [key, legacyLawSectionCacheKey(reference)];
}

export class InMemoryLawSectionCache implements LawSectionCache {
  private readonly entries = new Map<string, LawSection>();

  async get(reference: LawReference): Promise<LawSection | null> {
    for (const key of cacheKeysForRead(reference)) {
      const section = this.entries.get(key);
      if (section) {
        return cloneLawSection(section);
      }
    }

    return null;
  }

  async set(section: LawSection): Promise<void> {
    const key = lawSectionCacheKey(section);
    if (key === null) return;
    this.entries.set(key, cloneLawSection(section));
  }
}

export class StoredLawSectionCache implements LawSectionCache {
  constructor(private readonly storage: LawSectionCacheStorage) {}

  async get(reference: LawReference): Promise<LawSection | null> {
    const entries = await this.storage.load();
    for (const key of cacheKeysForRead(reference)) {
      const section = entries?.[key];
      if (section) {
        return cloneLawSection(section);
      }
    }

    return null;
  }

  async set(section: LawSection): Promise<void> {
    const key = lawSectionCacheKey(section);
    if (key === null) return;
    const entries = { ...((await this.storage.load()) ?? {}) };
    entries[key] = cloneLawSection(section);
    await this.storage.save(entries);
  }
}

export class CachedLawProvider implements LawProvider {
  readonly id = "cache";
  readonly label = "Local Law Section Cache";

  constructor(
    private readonly wrappedProvider: LawProvider,
    private readonly cache: LawSectionCache,
    private readonly options: CachedLawProviderOptions,
  ) {}

  async getSection(reference: LawReference): Promise<LawSection | null> {
    const liveSection = await this.wrappedProvider.getSection(reference);
    if (liveSection) {
      try {
        await this.cache.set(liveSection);
      } catch {
        // Cache writes are best-effort; a live provider result must remain usable.
      }

      return liveSection;
    }

    const cachedSection = await this.cache.get(reference);
    if (
      cachedSection &&
      this.isAllowedCachedProvider(cachedSection.providerId) &&
      this.isFreshCachedSection(cachedSection)
    ) {
      return {
        ...cachedSection,
        lawCode: canonicalDisplayLawCode(cachedSection.lawCode),
        cacheStatus: "cached",
      };
    }

    return null;
  }

  private isAllowedCachedProvider(providerId: string): boolean {
    return this.options.allowedProviderIds.includes(providerId);
  }

  private isFreshCachedSection(section: LawSection): boolean {
    if (this.options.ttlDays == null) {
      return true;
    }

    const retrievedAtMs = Date.parse(section.retrievedAt);
    if (!Number.isFinite(retrievedAtMs)) {
      return false;
    }

    const nowMs = (this.options.now ?? (() => new Date()))().getTime();
    const ttlMs = this.options.ttlDays * 24 * 60 * 60 * 1000;
    return nowMs - retrievedAtMs <= ttlMs;
  }
}

function cloneLawSection(section: LawSection): LawSection;
function cloneLawSection(section: LawSection | null): LawSection | null;
function cloneLawSection(section: LawSection | null): LawSection | null {
  return section ? { ...section } : null;
}
