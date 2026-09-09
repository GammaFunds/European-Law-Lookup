import type { LawProvider } from "./LawProvider";
import { providersForReference } from "./providerComposition";
import type { LawReference, LawSection } from "./types";

export class LawSectionNotFoundError extends Error {
  constructor(reference: LawReference) {
    super(`No law provider resolved ${reference.lawCode} § ${reference.section}.`);
    this.name = "LawSectionNotFoundError";
  }
}

export class ProviderRegistry {
  constructor(private readonly providers: LawProvider[]) {}

  async getSection(reference: LawReference): Promise<LawSection> {
    for (const provider of providersForReference(this.providers, reference)) {
      const section = await provider.getSection(reference);
      if (section) {
        return section;
      }
    }

    throw new LawSectionNotFoundError(reference);
  }
}
