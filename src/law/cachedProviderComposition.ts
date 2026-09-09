import type { LawProvider } from "./LawProvider";
import { providersForReference } from "./providerComposition";
import {
  CachedLawProvider,
  type LawSectionCache,
} from "./LawSectionCache";

export interface CachedProviderCompositionOptions {
  enableLawSectionCache: boolean;
  lawSectionCacheTtlDays: number | null;
  enableMockLawProvider?: boolean;
  now?: () => Date;
}

export function buildCachedLawProviders(
  providers: LawProvider[],
  cache: LawSectionCache,
  options: CachedProviderCompositionOptions,
): LawProvider[] {
  if (!options.enableLawSectionCache) {
    return providers;
  }

  return [
    new CachedLawProvider(
      createProviderChain(providers),
      cache,
      {
        allowedProviderIds: allowedCachedProviderIds(options.enableMockLawProvider === true),
        ttlDays: options.lawSectionCacheTtlDays,
        now: options.now,
      },
    ),
  ];
}

export function allowedCachedProviderIds(enableMockLawProvider: boolean): string[] {
  return enableMockLawProvider
    ? ["eur-lex", "fedlex", "neuris", "gesetze-im-internet", "ris", "boe", "mock"]
    : ["eur-lex", "fedlex", "neuris", "gesetze-im-internet", "ris", "boe"];
}

function createProviderChain(providers: LawProvider[]): LawProvider {
  return {
    id: "provider-chain",
    label: "Provider chain",
    async getSection(reference) {
      for (const provider of providersForReference(providers, reference)) {
        const section = await provider.getSection(reference);
        if (section) {
          return section;
        }
      }

      return null;
    },
  };
}
