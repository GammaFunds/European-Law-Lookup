import { formatReferenceLabel } from "./referenceLabel";
import type { LawSection } from "./types";
import { cellarLanguageNativeName } from "./euLanguages";
import { localizedCacheStatus, type UiPresentationStrings } from "../ui/i18n";

interface CitationFormatterOptions {
  includeMetadataFooter?: boolean;
  presentationStrings?: Pick<UiPresentationStrings, "live" | "cached" | "stale" | "englishTextVariantNotice" | "austrianConsolidatedNotice" | "euOfficialLanguageNotice" | "celex" | "sourceMetadata" | "cacheMetadata">;
}

export function getLawSectionDisplayLabel(section: LawSection): string | undefined {
  if (section.jurisdiction === "IT") {
    const lawTitle = section.lawTitle.trim();
    return lawTitle || undefined;
  }
  return section.lawCode;
}

export function formatLawSectionAsMarkdown(
  section: LawSection,
  options: CitationFormatterOptions = {},
): string {
  const heading = section.heading ? ` – ${section.heading}` : "";
  const retrievedDate = section.retrievedAt.slice(0, 10);
  const includeMetadataFooter = options.includeMetadataFooter !== false;
  const referenceLabel = formatReferenceLabel(section);
  const lawLabel = getLawSectionDisplayLabel(section);
  const strings = {
    live: "live",
    cached: "cached",
    stale: "stale",
    englishTextVariantNotice: "Textvariante: Englischer Gesetzestext von Gesetze im Internet (nicht amtlich).",
    austrianConsolidatedNotice: "Bundesrecht konsolidiert; Informationsfassung, rechtlich unverbindlich.",
    euOfficialLanguageNotice: "Amtliche EU-Sprachfassung: {language}.",
    celex: "CELEX: {celex}.",
    sourceMetadata: "Quelle: {provider}, {lawCode}, {reference}, abgerufen am {date}.",
    cacheMetadata: "Cache: {status}.",
    ...options.presentationStrings,
  };

  const lines = [
    `> **${referenceLabel}${lawLabel ? ` ${lawLabel}` : ""}${heading}**`,
    ">",
    ...section.text.split("\n").map((line) => `> ${line}`),
  ];

  if (section.sourceVariant === "translation-en") {
    lines.push("", strings.englishTextVariantNotice);
  }

  if (section.jurisdiction === "AT") {
    lines.push("", strings.austrianConsolidatedNotice);
  }

  if (section.jurisdiction === "EU" && section.language) {
    const nativeName = cellarLanguageNativeName(section.language);
    if (nativeName) {
      lines.push("", strings.euOfficialLanguageNotice.replace("{language}", nativeName));
    }
  }

  if (section.jurisdiction === "EU" && section.euCelex) {
    lines.push(strings.celex.replace("{celex}", section.euCelex));
  }

  if (includeMetadataFooter) {
    const sourceMetadata = strings.sourceMetadata
      .replace(", {lawCode}", lawLabel ? `, ${lawLabel}` : "")
      .replace("{lawCode}", lawLabel ?? "")
      .replace("{provider}", section.providerLabel)
      .replace("{reference}", referenceLabel)
      .replace("{date}", retrievedDate);
    lines.push(
      "",
      sourceMetadata,
      strings.cacheMetadata.replace("{status}", localizedCacheStatus(section.cacheStatus, strings)),
    );
  }

  return lines.join("\n");
}
