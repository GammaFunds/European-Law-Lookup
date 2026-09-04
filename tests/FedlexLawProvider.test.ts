import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { FedlexLawProvider } from "../src/law/providers/FedlexLawProvider";
import {
  buildFedlexQueryBody,
  convertFedlexHtmlToText,
  extractFedlexArticleFromResponse,
  getSupportedFedlexLaws,
  mapFedlexReference,
  mapFedlexToLawSection,
  normalizeArticleId,
  normalizeFedlexHeading,
} from "../src/law/providers/fedlexMapping";
import type { FedlexArticleData } from "../src/law/providers/fedlexMapping";

const bvArt8Fixture = {
  hits: {
    hits: [
      {
        _source: {
          title: "<p>BV Art. 8</p>",
          contentParent: "https://fedlex.data.admin.ch/eli/cc/1999/404",
        },
        inner_hits: {
          deContent: {
            hits: {
              hits: [
                {
                  _source: {
                    id: "art_8",
                    title: "<p>Rechtsgleichheit</p>",
                    content:
                      "<p>Alle Menschen sind vor dem Gesetz gleich.</p><p>(2) Niemand darf wegen seiner Herkunft, seiner Rasse, seines Geschlechts, seines Alters, seiner Sprache, seiner sozialen Stellung, seiner Lebensform, seiner religiösen, weltanschaulichen oder politischen Überzeugung oder wegen einer körperlichen, geistigen oder psychischen Behinderung diskriminiert werden.</p><p>(3) Mann und Frau sind gleichberechtigt. Das Gesetz sorgt für ihre tatsächliche Gleichstellung, vor allem in Familie, Ausbildung und Arbeit.</p><p>(4) Das Gesetz sieht Massnahmen zur Beseitigung von Benachteiligungen der Behinderten vor.</p>",
                    order: 1,
                    itemUri:
                      "https://fedlex.data.admin.ch/eli/cc/1999/404/art_8",
                  },
                },
              ],
            },
          },
        },
      },
    ],
  },
};

const bvArt41Fixture = {
  hits: {
    hits: [
      {
        _source: {
          title: "<p>BV Art. 41</p>",
          contentParent: "https://fedlex.data.admin.ch/eli/cc/1999/404",
        },
        inner_hits: {
          deContent: {
            hits: {
              hits: [
                {
                  _source: {
                    id: "art_41",
                    title: "<p>Sozialziele</p>",
                    content:
                      "<p>Bund und Kantone setzen sich in Ergänzung von Eigenverantwortung und privater Initiative dafür ein, dass</p><p>a. jede Person an der sozialen Sicherheit teilhat;</p><p>b. jede Person die für ihre Gesundheit notwendige Pflege erhält;</p><p>c. Familien als Gemeinschaften von Erwachsenen und Kindern geschützt und gefördert werden;</p><p>d. jede Person die ihrer Leistungsfähigkeit entsprechende Ausbildung erhält;</p><p>e. jede Person eine angemessene und zumutbare Arbeit zu angemessenen Bedingungen findet;</p><p>f. jede Person zu angemessenen Bedingungen Wohnung finden kann.</p>",
                    order: 41,
                    itemUri:
                      "https://fedlex.data.admin.ch/eli/cc/1999/404/art_41",
                  },
                },
              ],
            },
          },
        },
      },
    ],
  },
};

const zgbArt1Fixture = {
  hits: {
    hits: [
      {
        _source: {
          title: "<p>ZGB Art. 1</p>",
          contentParent: "https://fedlex.data.admin.ch/eli/cc/24/233_245_233",
        },
        inner_hits: {
          deContent: {
            hits: {
              hits: [
                {
                  _source: {
                    id: "art_1",
                    title: "<p>Anwendung des Rechts</p>",
                    content:
                      "<p><sup>(1)</sup> Das Gesetz findet auf alle Rechtsfragen Anwendung, nach deren Wortlaut oder Auslegung eine Bestimmung getroffen werden kann.</p><p><sup>(2)</sup> Kann dem Gesetz keine Vorschrift entnommen werden, so soll das Gericht nach Gewohnheitsrecht und, wo auch ein solches fehlt, nach der Regel entscheiden, die es als Gesetzgeber aufstellen würde.</p><p><sup>(3)</sup> Es folgt dabei bewährter Lehre und Überlieferung.</p>",
                    order: 1,
                    itemUri:
                      "https://fedlex.data.admin.ch/eli/cc/24/233_245_233/art_1",
                  },
                },
              ],
            },
          },
        },
      },
    ],
  },
};

const emptyHitsFixture = {
  hits: {
    hits: [],
  },
};

describe("Fedlex mapping helpers", () => {
  it("maps BV Art. 8 to work URI and article number", () => {
    const result = mapFedlexReference({
      lawCode: "BV",
      section: "8",
      referenceType: "article",
      jurisdiction: "CH",
    });

    assert.notEqual(result, null);
    assert.equal(
      result!.workUri,
      "https://fedlex.data.admin.ch/eli/cc/1999/404",
    );
    assert.equal(result!.articleNumber, "8");
  });

  it("maps ZGB Art. 1 to work URI and article number", () => {
    const result = mapFedlexReference({
      lawCode: "ZGB",
      section: "1",
      referenceType: "article",
      jurisdiction: "CH",
    });

    assert.notEqual(result, null);
    assert.equal(
      result!.workUri,
      "https://fedlex.data.admin.ch/eli/cc/24/233_245_233",
    );
    assert.equal(result!.articleNumber, "1");
  });

  it("maps OR Art. 1 to work URI and article number", () => {
    const result = mapFedlexReference({
      lawCode: "OR",
      section: "1",
      referenceType: "article",
      jurisdiction: "CH",
    });

    assert.notEqual(result, null);
    assert.equal(
      result!.workUri,
      "https://fedlex.data.admin.ch/eli/cc/27/317_321_377",
    );
    assert.equal(result!.articleNumber, "1");
  });

  it("maps STGB Art. 1 to work URI and article number", () => {
    const result = mapFedlexReference({
      lawCode: "STGB",
      section: "1",
      referenceType: "article",
      jurisdiction: "CH",
    });

    assert.notEqual(result, null);
    assert.equal(
      result!.workUri,
      "https://fedlex.data.admin.ch/eli/cc/54/757_781_799",
    );
    assert.equal(result!.articleNumber, "1");
  });

  it("maps ZPO Art. 1 to work URI", () => {
    const result = mapFedlexReference({
      lawCode: "ZPO",
      section: "1",
      referenceType: "article",
      jurisdiction: "CH",
    });

    assert.notEqual(result, null);
    assert.equal(
      result!.workUri,
      "https://fedlex.data.admin.ch/eli/cc/2010/262",
    );
  });

  it("maps STPO Art. 1 to work URI", () => {
    const result = mapFedlexReference({
      lawCode: "STPO",
      section: "1",
      referenceType: "article",
      jurisdiction: "CH",
    });

    assert.notEqual(result, null);
    assert.equal(
      result!.workUri,
      "https://fedlex.data.admin.ch/eli/cc/2010/267",
    );
  });

  it("maps SCHKG Art. 1 to work URI", () => {
    const result = mapFedlexReference({
      lawCode: "SCHKG",
      section: "1",
      referenceType: "article",
      jurisdiction: "CH",
    });

    assert.notEqual(result, null);
    assert.equal(
      result!.workUri,
      "https://fedlex.data.admin.ch/eli/cc/11/529_488_529",
    );
  });

  it("maps VWVG Art. 1 to work URI", () => {
    const result = mapFedlexReference({
      lawCode: "VWVG",
      section: "1",
      referenceType: "article",
      jurisdiction: "CH",
    });

    assert.notEqual(result, null);
    assert.equal(
      result!.workUri,
      "https://fedlex.data.admin.ch/eli/cc/1969/737_757_755",
    );
  });

  it("maps BGG Art. 1 to work URI", () => {
    const result = mapFedlexReference({
      lawCode: "BGG",
      section: "1",
      referenceType: "article",
      jurisdiction: "CH",
    });

    assert.notEqual(result, null);
    assert.equal(
      result!.workUri,
      "https://fedlex.data.admin.ch/eli/cc/2006/218",
    );
  });

  it("maps DSG Art. 1 to work URI", () => {
    const result = mapFedlexReference({
      lawCode: "DSG",
      section: "1",
      referenceType: "article",
      jurisdiction: "CH",
    });

    assert.notEqual(result, null);
    assert.equal(
      result!.workUri,
      "https://fedlex.data.admin.ch/eli/cc/2022/491",
    );
  });

  it("maps exact metadata for all eight new Swiss laws", () => {
    const cases = [
      {
        key: "OR",
        workUri: "https://fedlex.data.admin.ch/eli/cc/27/317_321_377",
        lawTitle: "Obligationenrecht",
        displayLawCode: "OR",
      },
      {
        key: "STGB",
        workUri: "https://fedlex.data.admin.ch/eli/cc/54/757_781_799",
        lawTitle: "Schweizerisches Strafgesetzbuch",
        displayLawCode: "StGB",
      },
      {
        key: "ZPO",
        workUri: "https://fedlex.data.admin.ch/eli/cc/2010/262",
        lawTitle: "Schweizerische Zivilprozessordnung",
        displayLawCode: "ZPO",
      },
      {
        key: "STPO",
        workUri: "https://fedlex.data.admin.ch/eli/cc/2010/267",
        lawTitle: "Schweizerische Strafprozessordnung",
        displayLawCode: "StPO",
      },
      {
        key: "SCHKG",
        workUri: "https://fedlex.data.admin.ch/eli/cc/11/529_488_529",
        lawTitle: "Bundesgesetz über Schuldbetreibung und Konkurs",
        displayLawCode: "SchKG",
      },
      {
        key: "VWVG",
        workUri:
          "https://fedlex.data.admin.ch/eli/cc/1969/737_757_755",
        lawTitle: "Verwaltungsverfahrensgesetz",
        displayLawCode: "VwVG",
      },
      {
        key: "BGG",
        workUri: "https://fedlex.data.admin.ch/eli/cc/2006/218",
        lawTitle: "Bundesgerichtsgesetz",
        displayLawCode: "BGG",
      },
      {
        key: "DSG",
        workUri: "https://fedlex.data.admin.ch/eli/cc/2022/491",
        lawTitle: "Datenschutzgesetz",
        displayLawCode: "DSG",
      },
    ] as const;

    for (const candidate of cases) {
      const reference = {
        lawCode: candidate.key,
        section: "1",
        referenceType: "article" as const,
        jurisdiction: "CH" as const,
      };

      const mapped = mapFedlexReference(reference);
      assert.notEqual(mapped, null);
      assert.equal(mapped!.workUri, candidate.workUri);

      const section = mapFedlexToLawSection({
        reference,
        articleData: {
          id: "art_1",
          title: "<p>Art. 1 Test</p>",
          content: "<p>Test.</p>",
          itemUri: `${candidate.workUri}/art_1`,
        },
        providerId: "fedlex",
        providerLabel: "Fedlex / Bundesrecht der Schweiz",
        retrievedAt: "2026-07-10T00:00:00.000Z",
      });

      assert.equal(section.lawCode, candidate.displayLawCode);
      assert.equal(section.lawTitle, candidate.lawTitle);
    }
  });

  it("maps exact metadata for all 13 Swiss Phase 1D laws", () => {
    const cases = [
      {
        key: "IPRG",
        workUri:
          "https://fedlex.data.admin.ch/eli/cc/1988/1776_1776_1776",
        lawTitle:
          "Bundesgesetz über das Internationale Privatrecht",
        displayLawCode: "IPRG",
      },
      {
        key: "DBG",
        workUri:
          "https://fedlex.data.admin.ch/eli/cc/1991/1184_1184_1184",
        lawTitle: "Bundesgesetz über die direkte Bundessteuer",
        displayLawCode: "DBG",
      },
      {
        key: "STHG",
        workUri:
          "https://fedlex.data.admin.ch/eli/cc/1991/1256_1256_1256",
        lawTitle:
          "Bundesgesetz über die Harmonisierung der direkten Steuern der Kantone und Gemeinden",
        displayLawCode: "StHG",
      },
      {
        key: "AHVG",
        workUri:
          "https://fedlex.data.admin.ch/eli/cc/63/837_843_843",
        lawTitle:
          "Bundesgesetz über die Alters- und Hinterlassenenversicherung",
        displayLawCode: "AHVG",
      },
      {
        key: "IVG",
        workUri:
          "https://fedlex.data.admin.ch/eli/cc/1959/827_857_845",
        lawTitle: "Bundesgesetz über die Invalidenversicherung",
        displayLawCode: "IVG",
      },
      {
        key: "ATSG",
        workUri:
          "https://fedlex.data.admin.ch/eli/cc/2002/510",
        lawTitle:
          "Bundesgesetz über den Allgemeinen Teil des Sozialversicherungsrechts",
        displayLawCode: "ATSG",
      },
      {
        key: "ARG",
        workUri:
          "https://fedlex.data.admin.ch/eli/cc/1966/57_57_57",
        lawTitle:
          "Bundesgesetz über die Arbeit in Industrie, Gewerbe und Handel",
        displayLawCode: "ArG",
      },
      {
        key: "SVG",
        workUri:
          "https://fedlex.data.admin.ch/eli/cc/1959/679_705_685",
        lawTitle: "Strassenverkehrsgesetz",
        displayLawCode: "SVG",
      },
      {
        key: "AIG",
        workUri:
          "https://fedlex.data.admin.ch/eli/cc/2007/758",
        lawTitle: "Ausländer- und Integrationsgesetz",
        displayLawCode: "AIG",
      },
      {
        key: "KG",
        workUri:
          "https://fedlex.data.admin.ch/eli/cc/1996/546_546_546",
        lawTitle:
          "Bundesgesetz über Kartelle und andere Wettbewerbsbeschränkungen",
        displayLawCode: "KG",
      },
      {
        key: "URG",
        workUri:
          "https://fedlex.data.admin.ch/eli/cc/1993/1798_1798_1798",
        lawTitle:
          "Bundesgesetz über das Urheberrecht und verwandte Schutzrechte",
        displayLawCode: "URG",
      },
      {
        key: "PATG",
        workUri:
          "https://fedlex.data.admin.ch/eli/cc/1955/871_893_899",
        lawTitle: "Bundesgesetz über die Erfindungspatente",
        displayLawCode: "PatG",
      },
      {
        key: "MSCHG",
        workUri:
          "https://fedlex.data.admin.ch/eli/cc/1993/274_274_274",
        lawTitle:
          "Bundesgesetz über den Schutz von Marken und Herkunftsangaben",
        displayLawCode: "MSchG",
      },
    ] as const;

    for (const candidate of cases) {
      const reference = {
        lawCode: candidate.key,
        section: "1",
        referenceType: "article" as const,
        jurisdiction: "CH" as const,
      };

      const mapped = mapFedlexReference(reference);
      assert.notEqual(mapped, null);
      assert.equal(mapped!.workUri, candidate.workUri);
      assert.equal(mapped!.articleNumber, "1");

      const section = mapFedlexToLawSection({
        reference,
        articleData: {
          id: "art_1",
          title: "<p>Art. 1 Test</p>",
          content: "<p>Test.</p>",
          itemUri: `${candidate.workUri}/art_1`,
        },
        providerId: "fedlex",
        providerLabel: "Fedlex / Bundesrecht der Schweiz",
        retrievedAt: "2026-07-10T00:00:00.000Z",
      });

      assert.equal(section.lawCode, candidate.displayLawCode);
      assert.equal(section.lawTitle, candidate.lawTitle);
      assert.equal(section.section, "1");
      assert.equal(section.referenceType, "article");
      assert.equal(section.jurisdiction, "CH");
    }
  });

  it("returns null for an unsupported CH law", () => {
    assert.equal(
      mapFedlexReference({
        lawCode: "XYZ",
        section: "1",
        referenceType: "article",
        jurisdiction: "CH",
      }),
      null,
    );
  });

  it("returns null for non-CH jurisdiction", () => {
    const result = mapFedlexReference({
      lawCode: "BV",
      section: "8",
      referenceType: "article",
    });

    assert.equal(result, null);
  });

  it("returns null for CH § references", () => {
    const result = mapFedlexReference({
      lawCode: "BV",
      section: "8",
      referenceType: "section",
      jurisdiction: "CH",
    });

    assert.equal(result, null);
  });

  it("builds Fedlex ES query body with work URI and article number", () => {
    const body = buildFedlexQueryBody(
      "https://fedlex.data.admin.ch/eli/cc/1999/404",
      "8",
    ) as Record<string, unknown>;

    const query = body.query as Record<string, unknown>;
    const bool = query.bool as Record<string, unknown>;
    const must = bool.must as Array<Record<string, unknown>>;

    const term = (must[0] as Record<string, unknown>)
      .term as Record<string, string>;
    assert.equal(
      term["contentParent.keyword"],
      "https://fedlex.data.admin.ch/eli/cc/1999/404",
    );
  });


  it("extracts article data from BV Art. 8 response", () => {
    const data = extractFedlexArticleFromResponse(bvArt8Fixture);

    assert.notEqual(data, null);
    assert.equal(data!.id, "art_8");
    assert.equal(data!.title, "<p>Rechtsgleichheit</p>");
    assert.match(
      data!.content!,
      /Alle Menschen sind vor dem Gesetz gleich/,
    );
    assert.equal(data!.order, 1);
    assert.equal(
      data!.itemUri,
      "https://fedlex.data.admin.ch/eli/cc/1999/404/art_8",
    );
  });

  it("extracts article data from BV Art. 41 with Fedlex id art_41", () => {
    const data = extractFedlexArticleFromResponse(bvArt41Fixture);

    assert.notEqual(data, null);
    assert.equal(data!.id, "art_41");
    assert.equal(data!.title, "<p>Sozialziele</p>");
    assert.match(data!.content!, /Bund und Kantone setzen sich/);
  });

  it("extracts article data from ZGB Art. 1 response", () => {
    const data = extractFedlexArticleFromResponse(zgbArt1Fixture);

    assert.notEqual(data, null);
    assert.equal(data!.id, "art_1");
    assert.match(
      data!.content!,
      /Das Gesetz findet auf alle Rechtsfragen Anwendung/,
    );
  });


  it("returns null for empty hits response", () => {
    const data = extractFedlexArticleFromResponse(emptyHitsFixture);
    assert.equal(data, null);
  });

  it("returns null for null response", () => {
    const data = extractFedlexArticleFromResponse(null);
    assert.equal(data, null);
  });

  it("converts Fedlex HTML title to plain text", () => {
    const text = convertFedlexHtmlToText("<p>Rechtsgleichheit</p>");
    assert.equal(text, "Rechtsgleichheit");
  });

  it("converts Fedlex HTML content with paragraphs to plain text", () => {
    const html =
      "<p>(1) Das Gesetz findet auf alle Rechtsfragen Anwendung.</p><p>(2) Kann dem Gesetz keine Vorschrift entnommen werden.</p>";
    const text = convertFedlexHtmlToText(html);

    assert.match(text, /\(1\) Das Gesetz findet/);
    assert.match(text, /\(2\) Kann dem Gesetz keine/);
  });

  it("converts sup paragraph numbers to readable text", () => {
    const html =
      "<p><sup>(1)</sup> Das Gesetz findet auf alle Rechtsfragen Anwendung.</p>";
    const text = convertFedlexHtmlToText(html);

    assert.match(text, /\(1\)/);
    assert.match(text, /Das Gesetz findet/);
  });

  it("normalizes heading by removing leading article label", () => {
    const heading = normalizeFedlexHeading(
      '<h6 class="heading"><b>Art. 8</b> Rechtsgleichheit</h6>',
      "8",
    );
    assert.equal(heading, "Rechtsgleichheit");
  });

  it("normalizes heading with Art format (no period)", () => {
    const heading = normalizeFedlexHeading('<p>Art 8 Rechtsgleichheit</p>', "8");
    assert.equal(heading, "Rechtsgleichheit");
  });

  it("normalizes heading with Artikel format", () => {
    const heading = normalizeFedlexHeading('<p>Artikel 8 Rechtsgleichheit</p>', "8");
    assert.equal(heading, "Rechtsgleichheit");
  });

  it("returns undefined for empty heading after normalization", () => {
    const heading = normalizeFedlexHeading('<p>Art. 8</p>', "8");
    assert.equal(heading, undefined);
  });

  it("preserves article number appearing later in title", () => {
    const heading = normalizeFedlexHeading('<p>Art. 8 Abs. 8 Satz 2</p>', "8");
    assert.equal(heading, "Abs. 8 Satz 2");
  });

  it("normalizes article ID for numeric-only section", () => {
    assert.equal(normalizeArticleId("8"), "art_8");
    assert.equal(normalizeArticleId("41"), "art_41");
    assert.equal(normalizeArticleId("1"), "art_1");
  });

  it("normalizes article ID for number-plus-letter section", () => {
    assert.equal(normalizeArticleId("321a"), "art_321_a");
    assert.equal(normalizeArticleId("321A"), "art_321_a");
    assert.equal(normalizeArticleId("8a"), "art_8_a");
  });

  it("builds Fedlex query body with normalized article ID for 321a", () => {
    const body = buildFedlexQueryBody(
      "https://fedlex.data.admin.ch/eli/cc/27/317_321_377",
      "321a",
    ) as Record<string, unknown>;

    const query = body.query as Record<string, unknown>;
    const bool = query.bool as Record<string, unknown>;
    const must = bool.must as Array<Record<string, unknown>>;
    const nested = must[1] as Record<string, unknown>;
    const nestedQuery = (nested.nested as Record<string, unknown>)
      .query as Record<string, unknown>;
    assert.equal(
      (nestedQuery.term as Record<string, string>)["deContent.id.keyword"],
      "art_321_a",
    );
  });

  it("builds Fedlex query body with normalized article ID for uppercase 321A", () => {
    const body = buildFedlexQueryBody(
      "https://fedlex.data.admin.ch/eli/cc/27/317_321_377",
      "321A",
    ) as Record<string, unknown>;

    const query = body.query as Record<string, unknown>;
    const bool = query.bool as Record<string, unknown>;
    const must = bool.must as Array<Record<string, unknown>>;
    const nested = must[1] as Record<string, unknown>;
    const nestedQuery = (nested.nested as Record<string, unknown>)
      .query as Record<string, unknown>;

    assert.equal(
      (nestedQuery.term as Record<string, string>)["deContent.id.keyword"],
      "art_321_a",
    );
  });

  it("normalizes heading with spaced-letter Art. 321 a for section 321a", () => {
    const heading = normalizeFedlexHeading(
      "<p>Art. 321 a Pflichten des Arbeitnehmers</p>",
      "321a",
    );
    assert.equal(heading, "Pflichten des Arbeitnehmers");
  });

  it("normalizes heading with compact Art. 321a for section 321a", () => {
    const heading = normalizeFedlexHeading(
      "<p>Art. 321a Pflichten des Arbeitnehmers</p>",
      "321a",
    );
    assert.equal(heading, "Pflichten des Arbeitnehmers");
  });

  it("formats dl/dt/dd as readable line", () => {
    const html = '<dl><dt>a.</dt><dd>jede Person an der sozialen Sicherheit teilhat;</dd></dl>';
    const text = convertFedlexHtmlToText(html);
    assert.match(text, /a\./);
    assert.match(text, /jede Person an der sozialen Sicherheit teilhat/);
  });

  it("removes script and style block contents", () => {
    const html = '<p>Main content</p><script>var x = 1;</script><style>.cls{}</style><p>After</p>';
    const text = convertFedlexHtmlToText(html);
    assert.doesNotMatch(text, /var x = 1/);
    assert.doesNotMatch(text, /\.cls/);
    assert.match(text, /Main content/);
    assert.match(text, /After/);
  });

  it("does not contain raw HTML tags in output", () => {
    const html = '<p><sup>1</sup> Alle <b>Menschen</b> sind vor dem Gesetz gleich.</p><h6>Art. 8</h6>';
    const text = convertFedlexHtmlToText(html);
    assert.doesNotMatch(text, /<p/);
    assert.doesNotMatch(text, /<h6/);
    assert.doesNotMatch(text, /<sup/);
    assert.doesNotMatch(text, /<dl/);
    assert.doesNotMatch(text, /<dt/);
    assert.doesNotMatch(text, /<dd/);
    assert.doesNotMatch(text, /<script/);
    assert.doesNotMatch(text, /<style/);
  });

  it("preserves multiple paragraph line separation", () => {
    const html = '<p>First paragraph.</p><p>Second paragraph.</p><p>Third paragraph.</p>';
    const text = convertFedlexHtmlToText(html);
    const lines = text.split("\n").filter((l) => l.length > 0);
    assert.equal(lines.length >= 3, true);
    assert.match(lines[0], /First paragraph/);
    assert.match(lines[1], /Second paragraph/);
    assert.match(lines[2], /Third paragraph/);
  });

  it("maps BV Art. 8 into LawSection with CH metadata", () => {
    const articleData: FedlexArticleData = {
      id: "art_8",
      title: "<p>Rechtsgleichheit</p>",
      content:
        "<p>Alle Menschen sind vor dem Gesetz gleich.</p>",
      order: 1,
      itemUri: "https://fedlex.data.admin.ch/eli/cc/1999/404/art_8",
    };

    const section = mapFedlexToLawSection({
      reference: {
        lawCode: "BV",
        section: "8",
        referenceType: "article",
        jurisdiction: "CH",
      },
      articleData,
      providerId: "fedlex",
      providerLabel: "Fedlex / Bundesrecht der Schweiz",
      retrievedAt: "2026-07-10T00:00:00.000Z",
    });

    assert.equal(section.providerId, "fedlex");
    assert.equal(
      section.providerLabel,
      "Fedlex / Bundesrecht der Schweiz",
    );
    assert.equal(section.sourceUrl, articleData.itemUri);
    assert.equal(section.lawCode, "BV");
    assert.equal(
      section.lawTitle,
      "Bundesverfassung der Schweizerischen Eidgenossenschaft",
    );
    assert.equal(section.section, "8");
    assert.equal(section.referenceType, "article");
    assert.equal(section.sourceVariant, "official-de");
    assert.equal(section.jurisdiction, "CH");
    assert.equal(section.heading, "Rechtsgleichheit");
    assert.match(
      section.text,
      /Alle Menschen sind vor dem Gesetz gleich/,
    );
    assert.equal(section.cacheStatus, "live");
    assert.equal(section.isOfficialSource, true);
    assert.equal(section.isAuthoritativeText, true);
  });

  it("maps ZGB Art. 1 into LawSection", () => {
    const articleData: FedlexArticleData = {
      id: "art_1",
      title: "<p>Anwendung des Rechts</p>",
      content:
        "<p>Das Gesetz findet auf alle Rechtsfragen Anwendung.</p>",
      order: 1,
      itemUri: "https://fedlex.data.admin.ch/eli/cc/24/233_245_233/art_1",
    };

    const section = mapFedlexToLawSection({
      reference: {
        lawCode: "ZGB",
        section: "1",
        referenceType: "article",
        jurisdiction: "CH",
      },
      articleData,
      providerId: "fedlex",
      providerLabel: "Fedlex / Bundesrecht der Schweiz",
      retrievedAt: "2026-07-10T00:00:00.000Z",
    });

    assert.equal(section.lawCode, "ZGB");
    assert.equal(section.jurisdiction, "CH");
    assert.equal(section.heading, "Anwendung des Rechts");
    assert.match(
      section.text,
      /Das Gesetz findet auf alle Rechtsfragen Anwendung/,
    );
  });

  it("maps OR Art. 321a into LawSection while preserving the raw section", () => {
    const articleData: FedlexArticleData = {
      id: "art_321_a",
      title: "<p>Art. 321 a Pflichten des Arbeitnehmers</p>",
      content: "<p>Der Arbeitnehmer hat die ihm übertragene Arbeit sorgfältig auszuführen.</p>",
      order: 321,
      itemUri:
        "https://fedlex.data.admin.ch/eli/cc/27/317_321_377/art_321_a",
    };

    const section = mapFedlexToLawSection({
      reference: {
        lawCode: "OR",
        section: "321a",
        referenceType: "article",
        jurisdiction: "CH",
      },
      articleData,
      providerId: "fedlex",
      providerLabel: "Fedlex / Bundesrecht der Schweiz",
      retrievedAt: "2026-07-10T00:00:00.000Z",
    });

    assert.equal(section.lawCode, "OR");
    assert.equal(section.lawTitle, "Obligationenrecht");
    assert.equal(section.section, "321a");
    assert.equal(section.referenceType, "article");
    assert.equal(section.jurisdiction, "CH");
    assert.equal(section.heading, "Pflichten des Arbeitnehmers");
    assert.equal(section.sourceVariant, "official-de");
  });

  it("maps StGB Art. 111 into LawSection with canonical display metadata", () => {
    const articleData: FedlexArticleData = {
      id: "art_111",
      title: "<p>Art. 111 Tötung</p>",
      content: "<p>Wer vorsätzlich einen Menschen tötet, wird bestraft.</p>",
      order: 111,
      itemUri:
        "https://fedlex.data.admin.ch/eli/cc/54/757_781_799/art_111",
    };

    const section = mapFedlexToLawSection({
      reference: {
        lawCode: "STGB",
        section: "111",
        referenceType: "article",
        jurisdiction: "CH",
      },
      articleData,
      providerId: "fedlex",
      providerLabel: "Fedlex / Bundesrecht der Schweiz",
      retrievedAt: "2026-07-10T00:00:00.000Z",
    });

    assert.equal(section.lawCode, "StGB");
    assert.equal(section.lawTitle, "Schweizerisches Strafgesetzbuch");
    assert.equal(section.section, "111");
    assert.equal(section.heading, "Tötung");
    assert.equal(section.jurisdiction, "CH");
  });

  it("maps ZPO Art. 1 into LawSection with the verified work metadata", () => {
    const articleData: FedlexArticleData = {
      id: "art_1",
      title: "<p>Art. 1 Gegenstand</p>",
      content: "<p>Dieses Gesetz regelt das Verfahren vor den kantonalen Instanzen.</p>",
      order: 1,
      itemUri:
        "https://fedlex.data.admin.ch/eli/cc/2010/262/art_1",
    };

    const section = mapFedlexToLawSection({
      reference: {
        lawCode: "ZPO",
        section: "1",
        referenceType: "article",
        jurisdiction: "CH",
      },
      articleData,
      providerId: "fedlex",
      providerLabel: "Fedlex / Bundesrecht der Schweiz",
      retrievedAt: "2026-07-10T00:00:00.000Z",
    });

    assert.equal(section.lawCode, "ZPO");
    assert.equal(section.lawTitle, "Schweizerische Zivilprozessordnung");
    assert.equal(section.section, "1");
    assert.equal(section.heading, "Gegenstand");
    assert.equal(section.jurisdiction, "CH");
  });

  it("returns stable Swiss supported-law diagnostics metadata", () => {
    const laws = getSupportedFedlexLaws();

    assert.equal(laws.length, 23);

    const sorted = [...laws].sort((a, b) =>
      a.displayLawCode.localeCompare(b.displayLawCode, "de"),
    );
    for (let i = 0; i < laws.length; i++) {
      assert.equal(laws[i], sorted[i]);
    }

    for (const law of laws) {
      assert.equal(law.referenceType, "article");
    }

    const bv = laws.find((l) => l.displayLawCode === "BV")!;
    assert.equal(bv.lawTitle, "Bundesverfassung der Schweizerischen Eidgenossenschaft");

    const zgb = laws.find((l) => l.displayLawCode === "ZGB")!;
    assert.equal(zgb.lawTitle, "Zivilgesetzbuch");

    const or = laws.find((l) => l.displayLawCode === "OR")!;
    assert.equal(or.lawTitle, "Obligationenrecht");

    const stgb = laws.find((l) => l.displayLawCode === "StGB")!;
    assert.equal(stgb.lawTitle, "Schweizerisches Strafgesetzbuch");

    const mschg = laws.find((l) => l.displayLawCode === "MSchG")!;
    assert.equal(mschg.lawTitle, "Bundesgesetz über den Schutz von Marken und Herkunftsangaben");

    for (const law of laws) {
      assert.ok(law.exampleInputs.includes(`Art. 1 ${law.displayLawCode}`));
      assert.ok(law.exampleInputs.includes(`${law.displayLawCode} Art. 1`));
    }
  });
});

describe("FedlexLawProvider", () => {
  it("returns official French content and coherent CH language metadata", async () => {
    const provider = new FedlexLawProvider(
      "https://www.fedlex.admin.ch",
      async (_url, body) => {
        assert.match(body, /frContent/);
        return {
          ok: true,
          status: 200,
          text: async () => "",
          json: async () => ({ hits: { hits: [{ inner_hits: { frContent: { hits: { hits: [{ _source: {
            id: "art_1",
            title: "<p>Application du droit</p>",
            content: "<p>La loi s'applique à toutes les questions juridiques.</p>",
          } }] } } } }] } }),
        };
      },
    );

    const section = await provider.getSection({
      lawCode: "ZGB",
      section: "1",
      referenceType: "article",
      jurisdiction: "CH",
      language: "fr",
    });

    assert.notEqual(section, null);
    assert.equal(section!.language, "fr");
    assert.equal(section!.section, "1");
    assert.match(section!.text, /La loi s'applique/);
  });

  it("returns official Italian content and coherent CH language metadata", async () => {
    const provider = new FedlexLawProvider(
      "https://www.fedlex.admin.ch",
      async (_url, body) => {
        assert.match(body, /itContent/);
        return {
          ok: true,
          status: 200,
          text: async () => "",
          json: async () => ({ hits: { hits: [{ inner_hits: { itContent: { hits: { hits: [{ _source: {
            id: "art_1",
            title: "<p>Applicazione del diritto</p>",
            content: "<p>La legge si applica a tutte le questioni giuridiche.</p>",
          } }] } } } }] } }),
        };
      },
    );

    const section = await provider.getSection({
      lawCode: "ZGB",
      section: "1",
      referenceType: "article",
      jurisdiction: "CH",
      language: "it",
    });

    assert.notEqual(section, null);
    assert.equal(section!.language, "it");
    assert.equal(section!.section, "1");
    assert.match(section!.text, /La legge si applica/);
  });

  it("fails closed for an unsupported explicit CH language", async () => {
    let calls = 0;
    const provider = new FedlexLawProvider("https://www.fedlex.admin.ch", async () => {
      calls++;
      return { ok: true, status: 200, text: async () => "", json: async () => ({}) };
    });

    const section = await provider.getSection({
      lawCode: "ZGB",
      section: "1",
      referenceType: "article",
      jurisdiction: "CH",
      language: "es",
    });

    assert.equal(section, null);
    assert.equal(calls, 0);
  });
  it("resolves CH BV Art. 8 through fixture-backed fetch", async () => {
    const provider = new FedlexLawProvider(
      "https://www.fedlex.admin.ch",
      async () => ({
        ok: true,
        status: 200,
        text: async () => JSON.stringify(bvArt8Fixture),
        json: async () => bvArt8Fixture,
      }),
    );

    const section = await provider.getSection({
      lawCode: "BV",
      section: "8",
      referenceType: "article",
      jurisdiction: "CH",
    });

    assert.notEqual(section, null);
    assert.equal(section!.heading, "Rechtsgleichheit");
    assert.match(
      section!.text,
      /Alle Menschen sind vor dem Gesetz gleich/,
    );
    assert.equal(section!.jurisdiction, "CH");
    assert.equal(section!.lawCode, "BV");
    assert.equal(section!.referenceType, "article");
  });

  it("resolves CH BV Art. 41 through fixture-backed fetch", async () => {
    const provider = new FedlexLawProvider(
      "https://www.fedlex.admin.ch",
      async () => ({
        ok: true,
        status: 200,
        text: async () => JSON.stringify(bvArt41Fixture),
        json: async () => bvArt41Fixture,
      }),
    );

    const section = await provider.getSection({
      lawCode: "BV",
      section: "41",
      referenceType: "article",
      jurisdiction: "CH",
    });

    assert.notEqual(section, null);
    assert.match(
      section!.text,
      /Bund und Kantone setzen sich/,
    );
    assert.equal(section!.jurisdiction, "CH");
  });

  it("captures Fedlex transport arguments for BV Art. 41", async () => {
    let capturedUrl: string | undefined;
    let capturedBody: string | undefined;
    const transport = async (url: string, body: string) => {
      capturedUrl = url;
      capturedBody = body;
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify(bvArt41Fixture),
        json: async () => bvArt41Fixture,
      };
    };

    const provider = new FedlexLawProvider(
      "https://www.fedlex.admin.ch",
      transport,
    );

    const section = await provider.getSection({
      lawCode: "BV",
      section: "41",
      referenceType: "article",
      jurisdiction: "CH",
    });

    // Verify URL
    assert.equal(
      capturedUrl,
      "https://www.fedlex.admin.ch/elasticsearch/proxy/_search?index=data",
    );

    // Verify body is a valid JSON string
    assert.equal(typeof capturedBody, "string");
    const parsed = JSON.parse(capturedBody!);

    // Verify contentParent.keyword
    assert.equal(
      parsed.query.bool.must[0].term["contentParent.keyword"],
      "https://fedlex.data.admin.ch/eli/cc/1999/404",
    );

    // Verify nested path
    assert.equal(parsed.query.bool.must[1].nested.path, "deContent");

    // Verify deContent.id.keyword = art_41
    assert.equal(
      parsed.query.bool.must[1].nested.query.term["deContent.id.keyword"],
      "art_41",
    );

    // Verify inner_hits requests _source: true
    assert.equal(parsed.query.bool.must[1].nested.inner_hits._source, true);

    // Verify section is returned correctly
    assert.notEqual(section, null);
    assert.match(
      section!.text,
      /Bund und Kantone setzen sich/,
    );
    assert.equal(section!.jurisdiction, "CH");
  });

  it("resolves CH ZGB Art. 1 through fixture-backed fetch", async () => {
    const provider = new FedlexLawProvider(
      "https://www.fedlex.admin.ch",
      async () => ({
        ok: true,
        status: 200,
        text: async () => JSON.stringify(zgbArt1Fixture),
        json: async () => zgbArt1Fixture,
      }),
    );

    const section = await provider.getSection({
      lawCode: "ZGB",
      section: "1",
      referenceType: "article",
      jurisdiction: "CH",
    });

    assert.notEqual(section, null);
    assert.equal(section!.jurisdiction, "CH");
    assert.equal(section!.lawCode, "ZGB");
    assert.match(
      section!.text,
      /Das Gesetz findet auf alle Rechtsfragen Anwendung/,
    );
  });

  it("returns null for OR Art. 1 with empty response", async () => {
    const provider = new FedlexLawProvider(
      "https://www.fedlex.admin.ch",
      async () => ({
        ok: true,
        status: 200,
        text: async () => JSON.stringify(emptyHitsFixture),
        json: async () => emptyHitsFixture,
      }),
    );

    const section = await provider.getSection({
      lawCode: "OR",
      section: "1",
      referenceType: "article",
      jurisdiction: "CH",
    });

    assert.equal(section, null);
  });

  it("returns null for CH § references", async () => {
    const provider = new FedlexLawProvider(
      "https://www.fedlex.admin.ch",
      async () => ({
        ok: true,
        status: 200,
        text: async () => JSON.stringify(emptyHitsFixture),
        json: async () => emptyHitsFixture,
      }),
    );

    const section = await provider.getSection({
      lawCode: "BV",
      section: "1",
      referenceType: "section",
      jurisdiction: "CH",
    });

    assert.equal(section, null);
  });

  it("returns null for non-CH references", async () => {
    const provider = new FedlexLawProvider(
      "https://www.fedlex.admin.ch",
      async () => ({
        ok: true,
        status: 200,
        text: async () => JSON.stringify(bvArt8Fixture),
        json: async () => bvArt8Fixture,
      }),
    );

    const section = await provider.getSection({
      lawCode: "BV",
      section: "8",
      referenceType: "article",
    });

    assert.equal(section, null);
  });

  it("returns null on 404 response", async () => {
    const provider = new FedlexLawProvider(
      "https://www.fedlex.admin.ch",
      async () => ({
        ok: false,
        status: 404,
        text: async () => "not found",
        json: async () => ({}),
      }),
    );

    const section = await provider.getSection({
      lawCode: "BV",
      section: "999",
      referenceType: "article",
      jurisdiction: "CH",
    });

    assert.equal(section, null);
  });

  it("returns null on non-OK non-404 response without throwing", async () => {
    const provider = new FedlexLawProvider(
      "https://www.fedlex.admin.ch",
      async () => ({
        ok: false,
        status: 500,
        text: async () => "server error",
        json: async () => ({}),
      }),
    );

    const section = await provider.getSection({
      lawCode: "BV",
      section: "8",
      referenceType: "article",
      jurisdiction: "CH",
    });

    assert.equal(section, null);
  });

  it("returns null when fetch rejects (network error)", async () => {
    const provider = new FedlexLawProvider(
      "https://www.fedlex.admin.ch",
      async () => {
        throw new Error("network unavailable");
      },
    );

    const section = await provider.getSection({
      lawCode: "BV",
      section: "8",
      referenceType: "article",
      jurisdiction: "CH",
    });

    assert.equal(section, null);
  });

  it("returns null on missing article (empty hits)", async () => {
    const provider = new FedlexLawProvider(
      "https://www.fedlex.admin.ch",
      async () => ({
        ok: true,
        status: 200,
        text: async () => JSON.stringify(emptyHitsFixture),
        json: async () => emptyHitsFixture,
      }),
    );

    const section = await provider.getSection({
      lawCode: "BV",
      section: "999",
      referenceType: "article",
      jurisdiction: "CH",
    });

    assert.equal(section, null);
  });
});
