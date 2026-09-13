import { formatReferenceLabel } from "../law/referenceLabel";
import { getLawSectionDisplayLabel } from "../law/CitationFormatter";
import type { LawSection } from "../law/types";
import { cellarLanguageNativeName } from "../law/euLanguages";
import { localizedCacheStatus, type UiPresentationStrings } from "./i18n";

interface LawSectionPreviewOptions {
  includeMetadataFooter?: boolean;
  presentationStrings?: Pick<UiPresentationStrings, "live" | "cached" | "stale" | "englishTextVariantNotice" | "austrianConsolidatedNotice" | "euOfficialLanguageNotice" | "celex" | "sourceMetadata" | "cacheMetadata"> & { finlandConsolidatedNotice?: string };
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
  const lawLabel = getLawSectionDisplayLabel(section);
  const metadataLines = buildMetadataLines(section, referenceLabel, lawLabel, includeMetadataFooter, options.presentationStrings);

  return {
    title: `${referenceLabel}${lawLabel ? ` ${lawLabel}` : ""}${heading}`,
    paragraphs: section.text.split("\n"),
    metadataLines,
  };
}

function buildMetadataLines(
  section: LawSection,
  referenceLabel: string,
  lawLabel: string | undefined,
  includeMetadataFooter: boolean,
  strings?: Partial<Pick<UiPresentationStrings, "live" | "cached" | "stale" | "englishTextVariantNotice" | "austrianConsolidatedNotice" | "euOfficialLanguageNotice" | "celex" | "sourceMetadata" | "cacheMetadata">> & { finlandConsolidatedNotice?: string },
): string[] {
  const presentation = {
    live: "live",
    cached: "cached",
    stale: "stale",
    englishTextVariantNotice: "Textvariante: Englischer Gesetzestext von Gesetze im Internet (nicht amtlich).",
    austrianConsolidatedNotice: "Bundesrecht konsolidiert; Informationsfassung, rechtlich unverbindlich.",
    euOfficialLanguageNotice: "Amtliche EU-Sprachfassung: {language}.",
    celex: "CELEX: {celex}.",
    sourceMetadata: "Quelle: {provider}, {lawCode}, {reference}, abgerufen am {date}.",
    cacheMetadata: "Cache: {status}.",
    finlandConsolidatedNotice: "Finlex consolidated text from an official source; the retrieved consolidated expression is marked non-authoritative.",
    ...strings,
  };
  const lines: string[] = [];
  if (section.sourceVariant === "translation-en") {
    lines.push(presentation.englishTextVariantNotice);
  }

  if (section.jurisdiction === "AT") {
    lines.push(presentation.austrianConsolidatedNotice);
  }
  if (section.jurisdiction === "FI" && !section.isAuthoritativeText) {
    lines.push(presentation.finlandConsolidatedNotice);
  }
  if (section.jurisdiction === "EU" && section.language) {
    const nativeName = cellarLanguageNativeName(section.language);
    if (nativeName) {
      lines.push(presentation.euOfficialLanguageNotice.replace("{language}", nativeName));
    }
  }

  if (section.jurisdiction === "EU" && section.euCelex) {
    lines.push(presentation.celex.replace("{celex}", section.euCelex));
  }

  if (includeMetadataFooter) {
    const sourceMetadata = presentation.sourceMetadata
      .replace(", {lawCode}", lawLabel ? `, ${lawLabel}` : "")
      .replace("{lawCode}", lawLabel ?? "")
      .replace("{provider}", section.providerLabel)
      .replace("{reference}", referenceLabel)
      .replace("{date}", section.retrievedAt.slice(0, 10));
    lines.push(
      sourceMetadata,
      presentation.cacheMetadata.replace("{status}", localizedCacheStatus(section.cacheStatus, presentation)),
    );
  }

  return lines;
}
