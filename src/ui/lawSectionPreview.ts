import { formatReferenceLabel } from "../law/referenceLabel";
import type { LawSection } from "../law/types";
import { cellarLanguageNativeName } from "../law/euLanguages";

interface LawSectionPreviewOptions {
  includeMetadataFooter?: boolean;
}

export interface LawSectionPreviewModel {
  title: string;
  paragraphs: string[];
  metadataLines: string[];
}

export function buildLawSectionPreviewModel(
  section: LawSection,
  options: LawSectionPreviewOptions = {},
): LawSectionPreviewModel {
  const heading = section.heading ? ` – ${section.heading}` : "";
  const includeMetadataFooter = options.includeMetadataFooter !== false;
  const referenceLabel = formatReferenceLabel(section);
  const metadataLines = buildMetadataLines(section, referenceLabel, includeMetadataFooter);

  return {
    title: `${referenceLabel} ${section.lawCode}${heading}`,
    paragraphs: section.text.split("\n"),
    metadataLines,
  };
}

function buildMetadataLines(
  section: LawSection,
  referenceLabel: string,
  includeMetadataFooter: boolean,
): string[] {
  const lines: string[] = [];
  if (section.sourceVariant === "translation-en") {
    lines.push("Textvariante: Englischer Gesetzestext von Gesetze im Internet (nicht amtlich).");
  }

  if (section.jurisdiction === "AT") {
    lines.push("Bundesrecht konsolidiert; Informationsfassung, rechtlich unverbindlich.");
  }
  if (section.jurisdiction === "EU" && section.language) {
    const nativeName = cellarLanguageNativeName(section.language);
    if (nativeName) {
      lines.push(`Amtliche EU-Sprachfassung: ${nativeName}.`);
    }
  }

  if (section.jurisdiction === "EU" && section.euCelex) {
    lines.push(`CELEX: ${section.euCelex}.`);
  }

  if (includeMetadataFooter) {
    lines.push(
      `Quelle: ${section.providerLabel}, ${section.lawCode}, ${referenceLabel}, abgerufen am ${section.retrievedAt.slice(0, 10)}.`,
      `Cache: ${section.cacheStatus}.`,
    );
  }

  return lines;
}
