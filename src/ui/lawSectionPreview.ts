import { formatReferenceLabel } from "../law/referenceLabel";
import type { LawSection } from "../law/types";
import { cellarLanguageNativeName } from "../law/euLanguages";
import { localizedCacheStatus, type UiPresentationStrings } from "./i18n";

interface LawSectionPreviewOptions {
  includeMetadataFooter?: boolean;
  presentationStrings?: Pick<UiPresentationStrings, "live" | "cached" | "stale" | "englishTextVariantNotice" | "austrianConsolidatedNotice" | "euOfficialLanguageNotice" | "celex" | "sourceMetadata" | "cacheMetadata">;
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
  const metadataLines = buildMetadataLines(section, referenceLabel, includeMetadataFooter, options.presentationStrings);

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
  strings?: Partial<Pick<UiPresentationStrings, "live" | "cached" | "stale" | "englishTextVariantNotice" | "austrianConsolidatedNotice" | "euOfficialLanguageNotice" | "celex" | "sourceMetadata" | "cacheMetadata">>,
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
    ...strings,
  };
  const lines: string[] = [];
  if (section.sourceVariant === "translation-en") {
    lines.push(presentation.englishTextVariantNotice);
  }

  if (section.jurisdiction === "AT") {
    lines.push(presentation.austrianConsolidatedNotice);
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
    lines.push(
      presentation.sourceMetadata.replace("{provider}", section.providerLabel).replace("{lawCode}", section.lawCode).replace("{reference}", referenceLabel).replace("{date}", section.retrievedAt.slice(0, 10)),
      presentation.cacheMetadata.replace("{status}", localizedCacheStatus(section.cacheStatus, presentation)),
    );
  }

  return lines;
}
