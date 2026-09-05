import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { formatLawSectionAsMarkdown } from "../src/law/CitationFormatter";
import { getUiStrings } from "../src/ui/i18n";
import type { LawSection } from "../src/law/types";

describe("formatLawSectionAsMarkdown", () => {
  it("labels official EU language versions without a translation warning", () => {
    const markdown = formatLawSectionAsMarkdown({ providerId: "eur-lex", providerLabel: "EUR-Lex", lawCode: "DSGVO", lawTitle: "Regulation (EU) 2016/679", section: "6", referenceType: "article", jurisdiction: "EU", language: "en", text: "Lawful processing.", retrievedAt: "2026-07-10T12:00:00.000Z", cacheStatus: "live", isOfficialSource: true, isAuthoritativeText: true });
    assert.match(markdown, /^Amtliche EU-Sprachfassung: English\.$/m);
    assert.doesNotMatch(markdown, /Englischer Gesetzestext von Gesetze im Internet/);
  });

  it("uses injected presentation strings for Markdown metadata", () => {
    const markdown = formatLawSectionAsMarkdown({ providerId: "eur-lex", providerLabel: "EUR-Lex", lawCode: "DSGVO", lawTitle: "Regulation (EU) 2016/679", section: "6", referenceType: "article", jurisdiction: "EU", language: "en", text: "Lawful processing.", retrievedAt: "2026-07-10T12:00:00.000Z", cacheStatus: "live", isOfficialSource: true, isAuthoritativeText: true }, ({
      presentationStrings: {
        euOfficialLanguageNotice: "Version officielle de l’UE: {language}.",
        sourceMetadata: "Source: {provider}, {lawCode}, {reference}, consulté le {date}.",
        cacheMetadata: "Cache: {status}.",
      },
    } as never));
    assert.match(markdown, /Version officielle de l’UE: English\./);
    assert.match(markdown, /Source: EUR-Lex, DSGVO, Art\. 6, consulté le 2026-07-10\./);
  });

  it("localizes cached and stale states in French Markdown metadata", () => {
    const presentationStrings = getUiStrings("fr");
    const sections: Array<[LawSection["cacheStatus"], string]> = [
      ["cached", presentationStrings.cached],
      ["stale", presentationStrings.stale],
    ];

    for (const [cacheStatus, localizedLabel] of sections) {
      const markdown = formatLawSectionAsMarkdown({
        providerId: "mock",
        providerLabel: "Mock Law Provider",
        lawCode: "BGB",
        lawTitle: "Bürgerliches Gesetzbuch",
        section: "823",
        text: "Wer vorsätzlich handelt.",
        retrievedAt: "2026-07-10T12:00:00.000Z",
        cacheStatus,
        isOfficialSource: false,
        isAuthoritativeText: false,
      }, { presentationStrings });

      assert.ok(markdown.includes(presentationStrings.cacheMetadata.replace("{status}", localizedLabel)));
      assert.ok(!markdown.includes(presentationStrings.cacheMetadata.replace("{status}", cacheStatus)));
    }
  });
  const section: LawSection = {
    providerId: "mock",
    providerLabel: "Mock Law Provider",
    lawCode: "BGB",
    lawTitle: "Bürgerliches Gesetzbuch",
    section: "823",
    heading: "Schadensersatzpflicht",
    text: "Wer vorsätzlich handelt.",
    retrievedAt: "2026-05-19T12:34:56.000Z",
    cacheStatus: "cached",
    isOfficialSource: false,
    isAuthoritativeText: false,
  };

  it("includes source and cache metadata by default", () => {
    assert.equal(
      formatLawSectionAsMarkdown(section),
      [
        "> **§ 823 BGB – Schadensersatzpflicht**",
        ">",
        "> Wer vorsätzlich handelt.",
        "",
        "Quelle: Mock Law Provider, BGB, § 823, abgerufen am 2026-05-19.",
        "Cache: cached.",
      ].join("\n"),
    );
  });

  it("omits source and cache metadata when disabled", () => {
    assert.equal(
      formatLawSectionAsMarkdown(section, { includeMetadataFooter: false }),
      [
        "> **§ 823 BGB – Schadensersatzpflicht**",
        ">",
        "> Wer vorsätzlich handelt.",
      ].join("\n"),
    );
  });

  it("preserves heading and section text when metadata is omitted", () => {
    const markdown = formatLawSectionAsMarkdown(section, {
      includeMetadataFooter: false,
    });

    assert.match(markdown, /^> \*\*§ 823 BGB – Schadensersatzpflicht\*\*/m);
    assert.match(markdown, /^> Wer vorsätzlich handelt\.$/m);
    assert.doesNotMatch(markdown, /^Quelle:/m);
    assert.doesNotMatch(markdown, /^Cache:/m);
  });

  it("formats a law section with citation metadata", () => {
    const section: LawSection = {
      providerId: "mock",
      providerLabel: "Mock Law Provider",
      lawCode: "BGB",
      lawTitle: "Bürgerliches Gesetzbuch",
      section: "823",
      heading: "Schadensersatzpflicht",
      text: "Wer vorsätzlich handelt.",
      retrievedAt: "2026-05-19T12:34:56.000Z",
      cacheStatus: "cached",
      isOfficialSource: false,
      isAuthoritativeText: false,
    };

    assert.equal(
      formatLawSectionAsMarkdown(section),
      [
        "> **§ 823 BGB – Schadensersatzpflicht**",
        ">",
        "> Wer vorsätzlich handelt.",
        "",
        "Quelle: Mock Law Provider, BGB, § 823, abgerufen am 2026-05-19.",
        "Cache: cached.",
      ].join("\n"),
    );
  });

  it("uses canonical display abbreviations in formatted headings", () => {
    const markdown = formatLawSectionAsMarkdown({
      providerId: "gesetze-im-internet",
      providerLabel: "Gesetze im Internet",
      lawCode: "StGB",
      lawTitle: "Strafgesetzbuch",
      section: "242",
      heading: "Diebstahl",
      text: "Wer eine fremde bewegliche Sache wegnimmt.",
      retrievedAt: "2026-05-20T12:34:56.000Z",
      cacheStatus: "live",
      isOfficialSource: true,
      isAuthoritativeText: false,
    });

    assert.match(markdown, /^> \*\*§ 242 StGB – Diebstahl\*\*/m);
    assert.doesNotMatch(markdown, /§ 242 STGB/);
  });

  it("formats GG article references with Art. labels in heading and metadata", () => {
    const markdown = formatLawSectionAsMarkdown({
      providerId: "gesetze-im-internet",
      providerLabel: "Gesetze im Internet",
      lawCode: "GG",
      lawTitle: "Grundgesetz für die Bundesrepublik Deutschland",
      section: "1",
      referenceType: "article",
      heading: "Menschenwürde",
      text: "Die Würde des Menschen ist unantastbar.",
      retrievedAt: "2026-05-20T12:34:56.000Z",
      cacheStatus: "live",
      isOfficialSource: true,
      isAuthoritativeText: false,
    });

    assert.match(markdown, /^> \*\*Art\. 1 GG – Menschenwürde\*\*/m);
    assert.match(
      markdown,
      /^Quelle: Gesetze im Internet, GG, Art\. 1, abgerufen am 2026-05-20\.$/m,
    );
    assert.doesNotMatch(markdown, /§ 1 GG/);
  });

  it("formats EGBGB pure article references with Art. labels", () => {
    const markdown = formatLawSectionAsMarkdown({
      providerId: "gesetze-im-internet",
      providerLabel: "Gesetze im Internet",
      lawCode: "EGBGB",
      lawTitle: "Einführungsgesetz zum Bürgerlichen Gesetzbuche",
      section: "1",
      referenceType: "article",
      text: "Das Bürgerliche Gesetzbuch tritt am 1. Januar 1900 in Kraft.",
      retrievedAt: "2026-05-21T12:34:56.000Z",
      cacheStatus: "live",
      isOfficialSource: true,
      isAuthoritativeText: false,
    });

    assert.match(markdown, /^> \*\*Art\. 1 EGBGB\*\*/m);
    assert.match(
      markdown,
      /^Quelle: Gesetze im Internet, EGBGB, Art\. 1, abgerufen am 2026-05-21\.$/m,
    );
    assert.doesNotMatch(markdown, /§ 1 EGBGB/);
  });

  it("formats EGBGB article-section references with Art. and § labels", () => {
    const markdown = formatLawSectionAsMarkdown({
      providerId: "gesetze-im-internet",
      providerLabel: "Gesetze im Internet",
      lawCode: "EGBGB",
      lawTitle: "Einführungsgesetz zum Bürgerlichen Gesetzbuche",
      section: "229",
      subsection: "6",
      referenceType: "article",
      heading: "Überleitungsvorschrift",
      text: "Diese Vorschrift gilt fort.",
      retrievedAt: "2026-05-21T12:34:56.000Z",
      cacheStatus: "live",
      isOfficialSource: true,
      isAuthoritativeText: false,
    });

    assert.match(markdown, /^> \*\*Art\. 229 § 6 EGBGB – Überleitungsvorschrift\*\*/m);
    assert.match(
      markdown,
      /^Quelle: Gesetze im Internet, EGBGB, Art\. 229 § 6, abgerufen am 2026-05-21\.$/m,
    );
    assert.doesNotMatch(markdown, /§ 229 EGBGB/);
  });

  it("marks English translations while keeping the German footer structure", () => {
    const markdown = formatLawSectionAsMarkdown({
      providerId: "gesetze-im-internet",
      providerLabel: "Gesetze im Internet",
      lawCode: "BGB",
      lawTitle: "Bürgerliches Gesetzbuch",
      section: "823",
      sourceVariant: "translation-en",
      heading: "Liability in damages",
      text: "A person who unlawfully injures another is liable in damages.",
      retrievedAt: "2026-05-22T12:34:56.000Z",
      cacheStatus: "live",
      isOfficialSource: true,
      isAuthoritativeText: false,
    });

    assert.match(
      markdown,
      /^Textvariante: Englischer Gesetzestext von Gesetze im Internet \(nicht amtlich\)\.$/m,
    );
    assert.match(
      markdown,
      /^Quelle: Gesetze im Internet, BGB, § 823, abgerufen am 2026-05-22\.$/m,
    );
  });

  it("keeps the translation notice even when source and cache metadata are disabled", () => {
    const markdown = formatLawSectionAsMarkdown({
      providerId: "gesetze-im-internet",
      providerLabel: "Gesetze im Internet",
      lawCode: "GG",
      lawTitle: "Grundgesetz für die Bundesrepublik Deutschland",
      section: "1",
      referenceType: "article",
      sourceVariant: "translation-en",
      heading: "Human dignity",
      text: "Human dignity shall be inviolable.",
      retrievedAt: "2026-05-22T12:34:56.000Z",
      cacheStatus: "live",
      isOfficialSource: true,
      isAuthoritativeText: false,
    }, { includeMetadataFooter: false });

    assert.match(
      markdown,
      /^Textvariante: Englischer Gesetzestext von Gesetze im Internet \(nicht amtlich\)\.$/m,
    );
    assert.doesNotMatch(markdown, /^Quelle:/m);
    assert.doesNotMatch(markdown, /^Cache:/m);
  });

  it("includes Austrian RIS Bundesrecht konsolidiert status in AT sections", () => {
    const markdown = formatLawSectionAsMarkdown({
      providerId: "ris",
      providerLabel: "RIS / Rechtsinformationssystem des Bundes",
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

    assert.match(
      markdown,
      /^Bundesrecht konsolidiert; Informationsfassung, rechtlich unverbindlich\.$/m,
    );
    assert.match(markdown, /^Quelle: RIS \/ Rechtsinformationssystem des Bundes, ABGB, § 1295, abgerufen am 2026-06-01\.$/m);
    assert.match(markdown, /^Cache: live\.$/m);
  });

  it("does not add Austrian status line for DE sections", () => {
    const markdown = formatLawSectionAsMarkdown({
      providerId: "gesetze-im-internet",
      providerLabel: "Gesetze im Internet",
      lawCode: "StGB",
      lawTitle: "Strafgesetzbuch",
      section: "242",
      heading: "Diebstahl",
      text: "Wer eine fremde bewegliche Sache wegnimmt.",
      retrievedAt: "2026-06-01T12:34:56.000Z",
      cacheStatus: "live",
      isOfficialSource: true,
      isAuthoritativeText: false,
    });

    assert.doesNotMatch(markdown, /Bundesrecht konsolidiert/);
  });

  it("does not add a translation notice for official-de fallback content", () => {
    const markdown = formatLawSectionAsMarkdown({
      providerId: "gesetze-im-internet",
      providerLabel: "Gesetze im Internet",
      lawCode: "StGB",
      lawTitle: "Strafgesetzbuch",
      section: "999",
      sourceVariant: "official-de",
      heading: "Deutsche Ersatznorm",
      text: "Deutscher amtlicher Ersatztext.",
      retrievedAt: "2026-05-22T12:34:56.000Z",
      cacheStatus: "live",
      isOfficialSource: true,
      isAuthoritativeText: false,
    });

    assert.doesNotMatch(
      markdown,
      /^Textvariante: Englischer Gesetzestext von Gesetze im Internet \(nicht amtlich\)\.$/m,
    );
  });

  it("includes CELEX metadata for EU sections", () => {
    const markdown = formatLawSectionAsMarkdown({
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

    assert.match(markdown, /CELEX: 32016R0679\./m);
  });

  it("includes CELEX metadata even when metadata footer is disabled", () => {
    const markdown = formatLawSectionAsMarkdown({
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

    assert.match(markdown, /CELEX: 32016R0679\./m);
    assert.doesNotMatch(markdown, /^Quelle:/m);
    assert.doesNotMatch(markdown, /^Cache:/m);
  });

  it("does not include CELEX metadata for DE sections", () => {
    const markdown = formatLawSectionAsMarkdown({
      providerId: "gesetze-im-internet",
      providerLabel: "Gesetze im Internet",
      lawCode: "StGB",
      lawTitle: "Strafgesetzbuch",
      section: "242",
      heading: "Diebstahl",
      text: "Wer eine fremde bewegliche Sache wegnimmt.",
      retrievedAt: "2026-05-20T12:34:56.000Z",
      cacheStatus: "live",
      isOfficialSource: true,
      isAuthoritativeText: false,
    });

    assert.doesNotMatch(markdown, /CELEX:/);
  });

  it("does not include CELEX metadata for AT sections", () => {
    const markdown = formatLawSectionAsMarkdown({
      providerId: "ris",
      providerLabel: "RIS / Rechtsinformationssystem des Bundes",
      lawCode: "ABGB",
      lawTitle: "Allgemeines bürgerliches Gesetzbuch",
      section: "1295",
      jurisdiction: "AT",
      heading: "Schadenersatz",
      text: "Jedermann ist berechtigt.",
      retrievedAt: "2026-06-01T12:34:56.000Z",
      cacheStatus: "live",
      isOfficialSource: true,
      isAuthoritativeText: false,
    });

    assert.doesNotMatch(markdown, /CELEX:/);
  });
});
