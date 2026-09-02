import { formatReferenceLabel } from "./referenceLabel";
import type { LawSection } from "./types";
import { cellarLanguageNativeName } from "./euLanguages";

interface CitationFormatterOptions {
  includeMetadataFooter?: boolean;
}

export function formatLawSectionAsMarkdown(
  section: LawSection,
  options: CitationFormatterOptions = {},
): string {
  const heading = section.heading ? ` – ${section.heading}` : "";
  const retrievedDate = section.retrievedAt.slice(0, 10);
  const includeMetadataFooter = options.includeMetadataFooter !== false;
  const referenceLabel = formatReferenceLabel(section);

  const lines = [
    `> **${referenceLabel} ${section.lawCode}${heading}**`,
    ">",
    ...section.text.split("\n").map((line) => `> ${line}`),
  ];

  if (section.sourceVariant === "translation-en") {
    lines.push("", "Textvariante: Englischer Gesetzestext von Gesetze im Internet (nicht amtlich).");
  }

  if (section.jurisdiction === "AT") {
    lines.push("", "Bundesrecht konsolidiert; Informationsfassung, rechtlich unverbindlich.");
  }

  if (section.jurisdiction === "EU" && section.language) {
    const nativeName = cellarLanguageNativeName(section.language);
    if (nativeName) {
      lines.push("", `Amtliche EU-Sprachfassung: ${nativeName}.`);
    }
  }

  if (section.jurisdiction === "EU" && section.euCelex) {
    lines.push(`CELEX: ${section.euCelex}.`);
  }

  if (includeMetadataFooter) {
    lines.push(
      "",
      `Quelle: ${section.providerLabel}, ${section.lawCode}, ${referenceLabel}, abgerufen am ${retrievedDate}.`,
      `Cache: ${section.cacheStatus}.`,
    );
  }

  return lines.join("\n");
}
