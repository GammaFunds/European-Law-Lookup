import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { buildLawSectionPreviewModel } from "../src/ui/lawSectionPreview";
import { getUiStrings } from "../src/ui/i18n";
import type { LawSection } from "../src/law/types";

describe("lawSectionPreview", () => {
  it("shows official EU language metadata without a national translation warning", () => {
    const preview = buildLawSectionPreviewModel({ providerId: "eur-lex", providerLabel: "EUR-Lex", lawCode: "DSGVO", lawTitle: "Regulation (EU) 2016/679", section: "6", referenceType: "article", jurisdiction: "EU", language: "en", text: "Lawful processing.", retrievedAt: "2026-07-10T12:00:00.000Z", cacheStatus: "live", isOfficialSource: true, isAuthoritativeText: true });
    assert.deepEqual(preview.metadataLines, ["Amtliche EU-Sprachfassung: English.", "Quelle: EUR-Lex, DSGVO, Art. 6, abgerufen am 2026-07-10.", "Cache: live."]);
  });

  it("uses injected presentation strings", () => {
    const preview = buildLawSectionPreviewModel({ providerId: "eur-lex", providerLabel: "EUR-Lex", lawCode: "DSGVO", lawTitle: "Regulation (EU) 2016/679", section: "6", referenceType: "article", jurisdiction: "EU", language: "en", text: "Lawful processing.", retrievedAt: "2026-07-10T12:00:00.000Z", cacheStatus: "live", isOfficialSource: true, isAuthoritativeText: true }, ({
      presentationStrings: {
        euOfficialLanguageNotice: "Version officielle de l’UE: {language}.",
        sourceMetadata: "Source: {provider}, {lawCode}, {reference}, consulté le {date}.",
        cacheMetadata: "Cache: {status}.",
      },
    } as never));
    assert.deepEqual(preview.metadataLines, ["Version officielle de l’UE: English.", "Source: EUR-Lex, DSGVO, Art. 6, consulté le 2026-07-10.", "Cache: live."]);
  });

  it("localizes every cache state in French preview metadata", () => {
    const presentationStrings = getUiStrings("fr");
    const expectedLabels = {
      live: presentationStrings.live,
      cached: presentationStrings.cached,
      stale: presentationStrings.stale,
    } as const;

    for (const [cacheStatus, localizedLabel] of Object.entries(expectedLabels)) {
      const preview = buildLawSectionPreviewModel({
        providerId: "mock",
        providerLabel: "Mock Law Provider",
        lawCode: "BGB",
        lawTitle: "Bürgerliches Gesetzbuch",
        section: "823",
        text: "Wer vorsätzlich handelt.",
        retrievedAt: "2026-07-10T12:00:00.000Z",
        cacheStatus: cacheStatus as LawSection["cacheStatus"],
        isOfficialSource: false,
        isAuthoritativeText: false,
      }, { presentationStrings });

      assert.equal(preview.metadataLines.at(-1), presentationStrings.cacheMetadata.replace("{status}", localizedLabel));
      assert.ok(!preview.metadataLines.at(-1)?.includes(cacheStatus));
    }
  });
  const section: LawSection = {
    providerId: "gesetze-im-internet",
    providerLabel: "Gesetze im Internet",
    sourceUrl: "https://www.gesetze-im-internet.de/stgb/__242.html",
    lawCode: "StGB",
    lawTitle: "Strafgesetzbuch",
    section: "242",
    heading: "Diebstahl",
    text: "(1) Wer eine fremde bewegliche Sache wegnimmt.\n(2) Der Versuch ist strafbar.",
    retrievedAt: "2026-05-20T12:34:56.000Z",
    cacheStatus: "cached",
    isOfficialSource: true,
    isAuthoritativeText: false,
  };

  it("builds a readable preview model with metadata by default", () => {
    const preview = buildLawSectionPreviewModel(section);

    assert.equal(preview.title, "§ 242 StGB – Diebstahl");
    assert.deepEqual(preview.paragraphs, [
      "(1) Wer eine fremde bewegliche Sache wegnimmt.",
      "(2) Der Versuch ist strafbar.",
    ]);
    assert.deepEqual(preview.metadataLines, [
      "Quelle: Gesetze im Internet, StGB, § 242, abgerufen am 2026-05-20.",
      "Cache: cached.",
    ]);
  });

  it("omits metadata lines when disabled", () => {
    const preview = buildLawSectionPreviewModel(section, {
      includeMetadataFooter: false,
    });

    assert.equal(preview.title, "§ 242 StGB – Diebstahl");
    assert.deepEqual(preview.metadataLines, []);
  });

  it("keeps the translation notice when source and cache metadata are disabled", () => {
    const preview = buildLawSectionPreviewModel({
      providerId: "gesetze-im-internet",
      providerLabel: "Gesetze im Internet",
      sourceUrl: "https://www.gesetze-im-internet.de/englisch_gg/englisch_gg.html",
      lawCode: "GG",
      lawTitle: "Grundgesetz für die Bundesrepublik Deutschland",
      section: "1",
      referenceType: "article",
      sourceVariant: "translation-en",
      heading: "Human dignity",
      text: "(1) Human dignity shall be inviolable.",
      retrievedAt: "2026-05-22T12:34:56.000Z",
      cacheStatus: "cached",
      isOfficialSource: true,
      isAuthoritativeText: false,
    }, {
      includeMetadataFooter: false,
    });

    assert.deepEqual(preview.metadataLines, [
      "Textvariante: Englischer Gesetzestext von Gesetze im Internet (nicht amtlich).",
    ]);
  });

  it("uses Art. labels for GG article previews", () => {
    const preview = buildLawSectionPreviewModel({
      providerId: "gesetze-im-internet",
      providerLabel: "Gesetze im Internet",
      sourceUrl: "https://www.gesetze-im-internet.de/gg/art_1.html",
      lawCode: "GG",
      lawTitle: "Grundgesetz für die Bundesrepublik Deutschland",
      section: "1",
      referenceType: "article",
      heading: "Menschenwürde",
      text: "(1) Die Würde des Menschen ist unantastbar.",
      retrievedAt: "2026-05-20T12:34:56.000Z",
      cacheStatus: "cached",
      isOfficialSource: true,
      isAuthoritativeText: false,
    });

    assert.equal(preview.title, "Art. 1 GG – Menschenwürde");
    assert.deepEqual(preview.metadataLines, [
      "Quelle: Gesetze im Internet, GG, Art. 1, abgerufen am 2026-05-20.",
      "Cache: cached.",
    ]);
  });

  it("uses Art. labels for EGBGB pure article previews", () => {
    const preview = buildLawSectionPreviewModel({
      providerId: "gesetze-im-internet",
      providerLabel: "Gesetze im Internet",
      sourceUrl: "https://www.gesetze-im-internet.de/bgbeg/BJNR006049896.html",
      lawCode: "EGBGB",
      lawTitle: "Einführungsgesetz zum Bürgerlichen Gesetzbuche",
      section: "1",
      referenceType: "article",
      text: "Das Bürgerliche Gesetzbuch tritt am 1. Januar 1900 in Kraft.",
      retrievedAt: "2026-05-21T12:34:56.000Z",
      cacheStatus: "cached",
      isOfficialSource: true,
      isAuthoritativeText: false,
    });

    assert.equal(preview.title, "Art. 1 EGBGB");
    assert.deepEqual(preview.metadataLines, [
      "Quelle: Gesetze im Internet, EGBGB, Art. 1, abgerufen am 2026-05-21.",
      "Cache: cached.",
    ]);
  });

  it("uses combined article-section labels for EGBGB previews", () => {
    const preview = buildLawSectionPreviewModel({
      providerId: "gesetze-im-internet",
      providerLabel: "Gesetze im Internet",
      sourceUrl: "https://www.gesetze-im-internet.de/bgbeg/art_229__6.html",
      lawCode: "EGBGB",
      lawTitle: "Einführungsgesetz zum Bürgerlichen Gesetzbuche",
      section: "229",
      subsection: "6",
      referenceType: "article",
      heading: "Überleitungsvorschrift",
      text: "Diese Vorschrift gilt fort.",
      retrievedAt: "2026-05-21T12:34:56.000Z",
      cacheStatus: "cached",
      isOfficialSource: true,
      isAuthoritativeText: false,
    });

    assert.equal(preview.title, "Art. 229 § 6 EGBGB – Überleitungsvorschrift");
    assert.deepEqual(preview.metadataLines, [
      "Quelle: Gesetze im Internet, EGBGB, Art. 229 § 6, abgerufen am 2026-05-21.",
      "Cache: cached.",
    ]);
  });

  it("marks English translations while keeping preview metadata aligned with inserted content", () => {
    const preview = buildLawSectionPreviewModel({
      providerId: "gesetze-im-internet",
      providerLabel: "Gesetze im Internet",
      sourceUrl: "https://www.gesetze-im-internet.de/englisch_bgb/englisch_bgb.html",
      lawCode: "BGB",
      lawTitle: "Bürgerliches Gesetzbuch",
      section: "823",
      sourceVariant: "translation-en",
      heading: "Liability in damages",
      text: "(1) A person who unlawfully injures another is liable in damages.",
      retrievedAt: "2026-05-22T12:34:56.000Z",
      cacheStatus: "cached",
      isOfficialSource: true,
      isAuthoritativeText: false,
    });

    assert.equal(preview.title, "§ 823 BGB – Liability in damages");
    assert.deepEqual(preview.metadataLines, [
      "Textvariante: Englischer Gesetzestext von Gesetze im Internet (nicht amtlich).",
      "Quelle: Gesetze im Internet, BGB, § 823, abgerufen am 2026-05-22.",
      "Cache: cached.",
    ]);
  });

  it("includes Austrian RIS Bundesrecht konsolidiert status in AT preview", () => {
    const preview = buildLawSectionPreviewModel({
      providerId: "ris",
      providerLabel: "RIS / Rechtsinformationssystem des Bundes",
      sourceUrl: "https://www.ris.bka.gv.at/NormDokument.wxe?Abfrage=Bundesnormen&Gesetzesnummer=10001622&Paragraf=1295",
      lawCode: "ABGB",
      lawTitle: "Allgemeines bürgerliches Gesetzbuch",
      section: "1295",
      jurisdiction: "AT",
      heading: "Schadenersatz",
      text: "(1) Jedermann ist berechtigt, von dem Schädiger den Ersatz des Schadens zu fordern.",
      retrievedAt: "2026-06-01T12:34:56.000Z",
      cacheStatus: "live",
      isOfficialSource: true,
      isAuthoritativeText: false,
    });

    assert.deepEqual(preview.metadataLines, [
      "Bundesrecht konsolidiert; Informationsfassung, rechtlich unverbindlich.",
      "Quelle: RIS / Rechtsinformationssystem des Bundes, ABGB, § 1295, abgerufen am 2026-06-01.",
      "Cache: live.",
    ]);
  });

  it("does not add Austrian status line for DE preview sections", () => {
    const preview = buildLawSectionPreviewModel({
      providerId: "gesetze-im-internet",
      providerLabel: "Gesetze im Internet",
      sourceUrl: "https://www.gesetze-im-internet.de/stgb/__242.html",
      lawCode: "StGB",
      lawTitle: "Strafgesetzbuch",
      section: "242",
      heading: "Diebstahl",
      text: "(1) Wer eine fremde bewegliche Sache wegnimmt.",
      retrievedAt: "2026-06-01T12:34:56.000Z",
      cacheStatus: "live",
      isOfficialSource: true,
      isAuthoritativeText: false,
    });

    assert.equal(preview.metadataLines.filter((l) => l.includes("Bundesrecht")).length, 0);
  });

  it("does not add a translation notice for official-de fallback previews", () => {
    const preview = buildLawSectionPreviewModel({
      providerId: "gesetze-im-internet",
      providerLabel: "Gesetze im Internet",
      sourceUrl: "https://www.gesetze-im-internet.de/stgb/__999.html",
      lawCode: "StGB",
      lawTitle: "Strafgesetzbuch",
      section: "999",
      sourceVariant: "official-de",
      heading: "Deutsche Ersatznorm",
      text: "Deutscher amtlicher Ersatztext.",
      retrievedAt: "2026-05-22T12:34:56.000Z",
      cacheStatus: "cached",
      isOfficialSource: true,
      isAuthoritativeText: false,
    });

    assert.deepEqual(preview.metadataLines, [
      "Quelle: Gesetze im Internet, StGB, § 999, abgerufen am 2026-05-22.",
      "Cache: cached.",
    ]);
  });

  it("includes CELEX metadata for EU previews", () => {
    const preview = buildLawSectionPreviewModel({
      providerId: "eur-lex",
      providerLabel: "EUR-Lex",
      lawCode: "DSGVO",
      lawTitle: "Regulation (EU) 2016/679",
      section: "6",
      referenceType: "article",
      jurisdiction: "EU",
      language: "de",
      text: "Rechtmäßigkeit der Verarbeitung.",
      retrievedAt: "2026-07-10T12:00:00.000Z",
      cacheStatus: "live",
      isOfficialSource: true,
      isAuthoritativeText: true,
      euCelex: "32016R0679",
      euDocumentType: "R",
    });

    assert.ok(preview.metadataLines.some((l) => l === "CELEX: 32016R0679."));
  });

  it("includes CELEX metadata even when metadata footer is disabled", () => {
    const preview = buildLawSectionPreviewModel({
      providerId: "eur-lex",
      providerLabel: "EUR-Lex",
      lawCode: "DSGVO",
      lawTitle: "Regulation (EU) 2016/679",
      section: "6",
      referenceType: "article",
      jurisdiction: "EU",
      language: "de",
      text: "Rechtmäßigkeit der Verarbeitung.",
      retrievedAt: "2026-07-10T12:00:00.000Z",
      cacheStatus: "live",
      isOfficialSource: true,
      isAuthoritativeText: true,
      euCelex: "32016R0679",
      euDocumentType: "R",
    }, { includeMetadataFooter: false });

    assert.ok(preview.metadataLines.some((l) => l === "CELEX: 32016R0679."));
    assert.ok(!preview.metadataLines.some((l) => l.startsWith("Quelle:")));
    assert.ok(!preview.metadataLines.some((l) => l.startsWith("Cache:")));
  });

  it("does not include CELEX metadata for DE previews", () => {
    const preview = buildLawSectionPreviewModel({
      providerId: "gesetze-im-internet",
      providerLabel: "Gesetze im Internet",
      sourceUrl: "https://www.gesetze-im-internet.de/stgb/__242.html",
      lawCode: "StGB",
      lawTitle: "Strafgesetzbuch",
      section: "242",
      heading: "Diebstahl",
      text: "(1) Wer eine fremde bewegliche Sache wegnimmt.",
      retrievedAt: "2026-06-01T12:34:56.000Z",
      cacheStatus: "live",
      isOfficialSource: true,
      isAuthoritativeText: false,
    });

    assert.ok(!preview.metadataLines.some((l) => l.includes("CELEX")));
  });

  it("does not include CELEX metadata for AT previews", () => {
    const preview = buildLawSectionPreviewModel({
      providerId: "ris",
      providerLabel: "RIS / Rechtsinformationssystem des Bundes",
      sourceUrl: "https://www.ris.bka.gv.at/NormDokument.wxe",
      lawCode: "ABGB",
      lawTitle: "Allgemeines bürgerliches Gesetzbuch",
      section: "1295",
      jurisdiction: "AT",
      heading: "Schadenersatz",
      text: "(1) Jedermann ist berechtigt.",
      retrievedAt: "2026-06-01T12:34:56.000Z",
      cacheStatus: "live",
      isOfficialSource: true,
      isAuthoritativeText: false,
    });

    assert.ok(!preview.metadataLines.some((l) => l.includes("CELEX")));
  });
});
