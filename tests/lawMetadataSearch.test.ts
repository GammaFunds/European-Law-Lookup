import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

type Jurisdiction = "DE" | "AT" | "CH" | "EU";
type MatchKind = "exact-alias" | "title-prefix" | "title-contains" | "eu-technical";

interface SearchEntry {
  jurisdiction: Jurisdiction;
  canonicalInput: string;
  title: string;
  aliases?: readonly string[];
  alternateTitles?: readonly string[];
  celex?: string;
  year?: string;
  number?: string;
}

interface SearchSuggestion extends SearchEntry {
  matchKind: MatchKind;
  matchedTitle?: string;
}

const { searchLawMetadata } = require("../src/law/lawMetadataSearch") as {
  searchLawMetadata(params: {
    query: string;
    jurisdiction: Jurisdiction;
    entries: readonly SearchEntry[];
    limit?: number;
  }): SearchSuggestion[];
};

const jurisdictionEntries: SearchEntry[] = [
  {
    jurisdiction: "DE",
    canonicalInput: "BDSG",
    title: "Bundesdatenschutzgesetz",
    aliases: ["BDSG"],
  },
  {
    jurisdiction: "AT",
    canonicalInput: "DSG",
    title: "Datenschutzgesetz",
    aliases: ["DSG"],
  },
  {
    jurisdiction: "CH",
    canonicalInput: "DSG",
    title: "Bundesgesetz über den Datenschutz (Datenschutzgesetz, DSG)",
    aliases: ["DSG"],
    alternateTitles: [
      "Loi fédérale sur la protection des données",
      "Legge federale sulla protezione dei dati",
    ],
  },
  {
    jurisdiction: "EU",
    canonicalInput: "32024R1689",
    title: "Regulation (EU) 2024/1689",
    aliases: ["AIACT", "AI ACT", "EU AI ACT", "KI-VO"],
    alternateTitles: [
      "Artificial Intelligence Act",
      "Verordnung über künstliche Intelligenz",
      "Règlement sur l’intelligence artificielle",
    ],
    celex: "32024R1689",
    year: "2024",
    number: "1689",
  },
];

describe("law metadata autocomplete", () => {
  it("returns no suggestions before two trimmed characters", () => {
    assert.deepEqual(searchLawMetadata({ query: "", jurisdiction: "DE", entries: jurisdictionEntries }), []);
    assert.deepEqual(searchLawMetadata({ query: " d ", jurisdiction: "DE", entries: jurisdictionEntries }), []);
  });

  it("strictly isolates suggestions to the selected jurisdiction", () => {
    assert.deepEqual(
      searchLawMetadata({ query: "datenschutz", jurisdiction: "DE", entries: jurisdictionEntries }).map((entry) => entry.canonicalInput),
      ["BDSG"],
    );
    assert.deepEqual(
      searchLawMetadata({ query: "datenschutz", jurisdiction: "AT", entries: jurisdictionEntries }).map((entry) => entry.canonicalInput),
      ["DSG"],
    );
    assert.deepEqual(
      searchLawMetadata({ query: "datenschutz", jurisdiction: "CH", entries: jurisdictionEntries }).map((entry) => entry.canonicalInput),
      ["DSG"],
    );
    assert.deepEqual(
      searchLawMetadata({ query: "datenschutz", jurisdiction: "EU", entries: jurisdictionEntries }),
      [],
    );
  });

  it("searches all supplied EU title languages", () => {
    const english = searchLawMetadata({ query: "artificial", jurisdiction: "EU", entries: jurisdictionEntries });
    assert.equal(english[0]?.canonicalInput, "32024R1689");
    assert.equal(english[0]?.matchedTitle, "Artificial Intelligence Act");

    const german = searchLawMetadata({ query: "künstliche", jurisdiction: "EU", entries: jurisdictionEntries });
    assert.equal(german[0]?.canonicalInput, "32024R1689");
    assert.equal(german[0]?.matchedTitle, "Verordnung über künstliche Intelligenz");
  });

  it("ranks exact aliases before title prefixes, title contains, and EU technical identity", () => {
    const entries: SearchEntry[] = [
      { jurisdiction: "EU", canonicalInput: "ALIAS", title: "Unrelated", aliases: ["42"] },
      { jurisdiction: "EU", canonicalInput: "PREFIX", title: "42 Regulation" },
      { jurisdiction: "EU", canonicalInput: "CONTAINS", title: "Regulation number 42" },
      { jurisdiction: "EU", canonicalInput: "TECH", title: "Unrelated technical act", celex: "32024R0042", year: "2024", number: "42" },
    ];

    const results = searchLawMetadata({ query: "42", jurisdiction: "EU", entries });
    assert.deepEqual(results.map((entry) => entry.canonicalInput), ["ALIAS", "PREFIX", "CONTAINS", "TECH"]);
    assert.deepEqual(results.map((entry) => entry.matchKind), ["exact-alias", "title-prefix", "title-contains", "eu-technical"]);
  });

  it("caps results at eight suggestions by default", () => {
    const entries = Array.from({ length: 12 }, (_, index): SearchEntry => ({
      jurisdiction: "DE",
      canonicalInput: `D${index}`,
      title: `Data law ${String(index).padStart(2, "0")}`,
    }));
    assert.equal(searchLawMetadata({ query: "da", jurisdiction: "DE", entries }).length, 8);
  });

  it("does not fuzzy-match misspellings", () => {
    assert.deepEqual(
      searchLawMetadata({ query: "datnschutz", jurisdiction: "DE", entries: jurisdictionEntries }),
      [],
    );
  });
});
