import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it } from "node:test";
import {
  defaultLawSourceVariantForLanguage,
  getUiStrings,
  resolveUiLanguage,
} from "../src/ui/i18n";
const { UI_LANGUAGE_CODES } = require("../src/ui/i18n") as { UI_LANGUAGE_CODES: string[] };
import { defaultEuLawLanguage } from "../src/law/euLanguages";
import { parseLawReferenceWithSelectedJurisdiction } from "../src/parser";
import { addOrReplaceEntry, emptyEuActIndex } from "../src/law/euActIndex";
import { EU_OFFICIAL_TITLES_32016R0679 } from "./fixtures/euOfficialTitles32016R0679";

const REQUIRED_UI_STRING_KEYS = [
  "commandName", "enableLocalLawTextCache", "enableLocalLawTextCacheDescription", "defaultLawTextSource",
  "germanOfficialText", "englishTranslationWhenAvailable", "cacheExpirationInDays", "cacheExpirationInDaysDescription",
  "noExpirationPlaceholder", "supportedLaws", "supportedLawsDescription", "sectionReferences", "articleReferences",
  "selectedLawContinueWithReference",
  "inputLayout", "oneLineInputLayout", "twoFieldInputLayout", "lawLegalAct", "referenceInput",
  "defaultJurisdiction", "defaultJurisdictionDescription",
  "intentionallyUnsupportedCandidates", "ggArticleOnlyNote", "unsupportedCandidatesNote", "code", "law", "referenceType",
  "examples", "lookUpLawTitle", "lawReferencePlaceholder", "lookUpLawButton", "noLookupRunYet", "noRecognizedCitation",
  "lookingUpLaw", "noCitationFound", "useEnglishTranslationWhenAvailable", "englishTranslationUnavailableForCitation",
  "insertSourceAndCacheNote", "insertIntoCurrentNote", "noActiveMarkdownEditorFound", "jurisdictionLabel", "jurisdictionGermany",
  "jurisdictionAustria", "jurisdictionSwitzerland", "jurisdictionSpain", "jurisdictionEuropeanUnion", "euTextLanguage", "defaultEuTextLanguage",
  "defaultEuTextLanguageDescription", "euLanguageExpressionUnavailable", "acceptedInputFormats", "directCelexCitation",
  "structuredArticleFirst", "structuredActFirst", "knownAlias", "exactOfficialTitle", "euDirectCelexExamples",
  "euStructuredCitationExample", "euActFirstExample", "euAliasExamples", "euExactTitleExample", "euScopeNote", "source",
  "retrievedOn", "cache", "live", "cached", "stale", "englishTextVariantNotice", "austrianConsolidatedNotice",
  "euOfficialLanguageNotice", "celex", "sourceMetadata", "cacheMetadata", "swissOfficialTextLanguage", "unexpectedLookupFailure",
  "refreshEuActIndex",
  "spainAcceptedInputFormats", "spainInputExamples", "spainScopeNote",
] as const;

// Every identical value is authorized by locale and exact key; no key has a global exemption.
const IDENTICAL_VALUE_ALLOWLIST: Record<string, Partial<Record<string, string>>> = {
  bg: { euDirectCelexExamples: "Parser-stable CELEX syntax intentionally uses Art.", euAliasExamples: "Curated parser aliases are language-neutral.", celex: "CELEX syntax is language-neutral." },
  cs: { euDirectCelexExamples: "Parser-stable CELEX syntax intentionally uses Art.", euAliasExamples: "Curated parser aliases are language-neutral.", celex: "CELEX syntax is language-neutral." },
  da: { euDirectCelexExamples: "Parser-stable CELEX syntax intentionally uses Art.", euAliasExamples: "Curated parser aliases are language-neutral.", cache: "Technical cache label.", live: "Technical runtime-state label.", celex: "CELEX syntax is language-neutral.", cacheMetadata: "Technical cache metadata label." },
  de: { euDirectCelexExamples: "Parser-stable CELEX syntax intentionally uses Art.", euAliasExamples: "Curated parser aliases are language-neutral.", celex: "CELEX syntax is language-neutral." },
  el: { euDirectCelexExamples: "Parser-stable CELEX syntax intentionally uses Art.", euAliasExamples: "Curated parser aliases are language-neutral.", celex: "CELEX syntax is language-neutral." },
  es: { jurisdictionAustria: "Official country name is shared.", euDirectCelexExamples: "Parser-stable CELEX syntax intentionally uses Art.", euAliasExamples: "Curated parser aliases are language-neutral.", celex: "CELEX syntax is language-neutral." },
  et: { jurisdictionAustria: "Official country name is shared.", euDirectCelexExamples: "Parser-stable CELEX syntax intentionally uses Art.", euAliasExamples: "Curated parser aliases are language-neutral.", celex: "CELEX syntax is language-neutral." },
  fi: { euDirectCelexExamples: "Parser-stable CELEX syntax intentionally uses Art.", euAliasExamples: "Curated parser aliases are language-neutral.", celex: "CELEX syntax is language-neutral." },
  fr: { source: "Shared legal-source label.", euDirectCelexExamples: "Parser-stable CELEX syntax intentionally uses Art.", euAliasExamples: "Curated parser aliases are language-neutral.", celex: "CELEX syntax is language-neutral." },
  ga: { euDirectCelexExamples: "Parser-stable CELEX syntax intentionally uses Art.", euAliasExamples: "Curated parser aliases are language-neutral.", celex: "CELEX syntax is language-neutral." },
  hr: { euDirectCelexExamples: "Parser-stable CELEX syntax intentionally uses Art.", euAliasExamples: "Curated parser aliases are language-neutral.", celex: "CELEX syntax is language-neutral." },
  hu: { euDirectCelexExamples: "Parser-stable CELEX syntax intentionally uses Art.", euAliasExamples: "Curated parser aliases are language-neutral.", celex: "CELEX syntax is language-neutral." },
  it: { jurisdictionAustria: "Official country name is shared.", euDirectCelexExamples: "Parser-stable CELEX syntax intentionally uses Art.", euAliasExamples: "Curated parser aliases are language-neutral.", celex: "CELEX syntax is language-neutral." },
  lt: { euDirectCelexExamples: "Parser-stable CELEX syntax intentionally uses Art.", euAliasExamples: "Curated parser aliases are language-neutral.", celex: "CELEX syntax is language-neutral." },
  lv: { euDirectCelexExamples: "Parser-stable CELEX syntax intentionally uses Art.", euAliasExamples: "Curated parser aliases are language-neutral.", celex: "CELEX syntax is language-neutral." },
  mt: { euDirectCelexExamples: "Parser-stable CELEX syntax intentionally uses Art.", euAliasExamples: "Curated parser aliases are language-neutral.", celex: "CELEX syntax is language-neutral." },
  nl: { code: "Technical code label.", euDirectCelexExamples: "Parser-stable CELEX syntax intentionally uses Art.", euAliasExamples: "Curated parser aliases are language-neutral.", cache: "Technical cache label.", live: "Technical runtime-state label.", celex: "CELEX syntax is language-neutral.", cacheMetadata: "Technical cache metadata label." },
  pl: { jurisdictionAustria: "Official country name is shared.", euDirectCelexExamples: "Parser-stable CELEX syntax intentionally uses Art.", euAliasExamples: "Curated parser aliases are language-neutral.", celex: "CELEX syntax is language-neutral." },
  pt: { euDirectCelexExamples: "Parser-stable CELEX syntax intentionally uses Art.", euAliasExamples: "Curated parser aliases are language-neutral.", cache: "Technical cache label.", celex: "CELEX syntax is language-neutral." },
  ro: { jurisdictionAustria: "Official country name is shared.", euDirectCelexExamples: "Parser-stable CELEX syntax intentionally uses Art.", euAliasExamples: "Curated parser aliases are language-neutral.", celex: "CELEX syntax is language-neutral." },
  sk: { euDirectCelexExamples: "Parser-stable CELEX syntax intentionally uses Art.", euAliasExamples: "Curated parser aliases are language-neutral.", celex: "CELEX syntax is language-neutral." },
  sl: { euDirectCelexExamples: "Parser-stable CELEX syntax intentionally uses Art.", euAliasExamples: "Curated parser aliases are language-neutral.", celex: "CELEX syntax is language-neutral." },
  sv: { euDirectCelexExamples: "Parser-stable CELEX syntax intentionally uses Art.", euAliasExamples: "Curated parser aliases are language-neutral.", celex: "CELEX syntax is language-neutral." },
};

function isAllowedIdenticalKey(code: string, key: string): boolean {
  return Boolean(IDENTICAL_VALUE_ALLOWLIST[code]?.[key]);
}

describe("ui i18n", () => {
  it("uses German for de locales", () => {
    assert.equal(resolveUiLanguage("de"), "de");
    assert.equal(resolveUiLanguage("de-DE"), "de");
    assert.equal(getUiStrings("de-AT").lookUpLawTitle, "Gesetz nachschlagen");
    assert.equal(getUiStrings("de").supportedLaws, "Unterstützte Gesetze");
    assert.equal(
      getUiStrings("de").useEnglishTranslationWhenAvailable,
      "Englischen Gesetzestext anzeigen, sofern vorhanden",
    );
    assert.equal(getUiStrings("de").defaultLawTextSource, "Standard-Gesetzestextquelle");
    assert.equal(
      getUiStrings("de").englishTranslationWhenAvailable,
      "Englischer Gesetzestext, sofern vorhanden",
    );
    assert.equal(
      getUiStrings("de").unsupportedCandidatesNote,
      "SGB XIII wird bewusst nicht als geltendes SGB-Buch unterstützt.",
    );
  });

  it("falls back to English for en and unknown locales", () => {
    assert.equal(resolveUiLanguage("en"), "en");
    assert.equal(resolveUiLanguage("fr"), "fr");
    assert.equal(resolveUiLanguage(undefined), "en");
    assert.equal(getUiStrings("en-GB").lookUpLawTitle, "Look up law");
    assert.equal(getUiStrings("unknown").supportedLaws, "Supported laws");
    assert.equal(
      getUiStrings("en").englishTranslationUnavailableForCitation,
      "No verified English translation is configured for this citation.",
    );
    assert.equal(getUiStrings("en").defaultLawTextSource, "Default law text source");
    assert.equal(
      getUiStrings("en").useEnglishTranslationWhenAvailable,
      "Show English law text when available",
    );
    assert.equal(
      getUiStrings("en").unsupportedCandidatesNote,
      "SGB XIII is intentionally not supported as a current SGB book.",
    );
  });

  it("rejects malformed locale tags before extracting a primary language", () => {
    for (const malformed of ["de-", "fr__invalid", "de--AT", "-fr", "_"]) {
      assert.equal(resolveUiLanguage(malformed), "en", malformed);
    }
    assert.equal(resolveUiLanguage("de_DE"), "de");
    assert.equal(resolveUiLanguage("de-DE"), "de");
    assert.equal(resolveUiLanguage("fr-FR"), "fr");
    assert.equal(resolveUiLanguage("pt-PT"), "pt");
  });

  it("admits exactly the EU official UI languages with complete catalogs", () => {
    assert.deepEqual(UI_LANGUAGE_CODES, ["bg", "cs", "da", "de", "el", "en", "es", "et", "fi", "fr", "ga", "hr", "hu", "it", "lt", "lv", "mt", "nl", "pl", "pt", "ro", "sk", "sl", "sv"]);
    for (const code of UI_LANGUAGE_CODES) {
      assert.equal(resolveUiLanguage(code), code);
      const strings = getUiStrings(code);
      for (const value of Object.values(strings)) assert.notEqual(value.trim(), "");
      if (code !== "en") assert.notEqual(strings, getUiStrings("en"));
    }
    assert.equal(resolveUiLanguage("fr-FR"), "fr");
    assert.equal(resolveUiLanguage("pt-PT"), "pt");
    assert.equal(resolveUiLanguage("pl-PL"), "pl");
    assert.equal(resolveUiLanguage("el-GR"), "el");
    assert.equal(resolveUiLanguage(null), "en");
    assert.equal(resolveUiLanguage("xx-YY"), "en");
  });

  it("requires every admitted catalog to have exactly the independent complete key set", () => {
    const expected = [...REQUIRED_UI_STRING_KEYS].sort();
    for (const code of UI_LANGUAGE_CODES) {
      assert.deepEqual(Object.keys(getUiStrings(code)).sort(), expected, code);
    }
  });

  it("localizes selected-law guidance with both required placeholders", () => {
    for (const code of UI_LANGUAGE_CODES) {
      const template = (getUiStrings(code) as unknown as Record<string, string>).selectedLawContinueWithReference;
      assert.equal(typeof template, "string", `${code} selected-law guidance`);
      assert.match(template, /\{law\}/u, `${code} selected-law guidance law placeholder`);
      assert.match(template, /\{reference\}/u, `${code} selected-law guidance reference placeholder`);
    }
  });

  it("has no ordinary English prose in the German catalog", () => {
    const english = getUiStrings("en");
    const german = getUiStrings("de");
    const technicalIdentities = new Set([
      "CELEX: {celex}.",
      "Art. 1 32016R0679; 32016R0679 Art. 1; CELEX: 32016R0679 Art. 1",
      "Art. 1 AI Act; AI Act Art. 1; Art. 1 Data Act",
    ]);
    const unexpected = Object.entries(german)
      .filter(([key, value]) => value === english[key as keyof typeof english] && !technicalIdentities.has(value))
      .map(([key, value]) => `${key}=${value}`);
    assert.deepEqual(unexpected, []);
    for (const key of ["noRecognizedCitation", "unexpectedLookupFailure", "euLanguageExpressionUnavailable", "englishTranslationUnavailableForCitation"] as const) {
      assert.notEqual(german[key], english[key], key);
    }
  });

  it("keeps the original sector-3 R/L/D limitation in the six scope notes", () => {
    for (const code of ["cs", "da", "et", "fi", "lv", "sv"] as const) {
      assert.match(getUiStrings(code).euScopeNote, /3\s*R\/L\/D/i, code);
    }
  });

  it("does not exempt the ordinary Regulation title from localization", () => {
    for (const code of ["hu", "lt", "nl", "sk"] as const) {
      assert.notEqual(getUiStrings(code).euExactTitleExample, "Regulation (EU) 2016/679", code);
    }
  });

  it("uses suffixless semantics rather than unabridged semantics in the corrected scope notes", () => {
    const semanticAnchors = {
      bg: { suffixless: /без\s+суфикс/u, wrong: /несъкратен/u },
      de: { suffixless: /ohne\s+Suffix/u, wrong: /ungekürzte/u },
      lt: { suffixless: /be\s+priesagos/u, wrong: /nesutrumpint/u },
    } as const;
    for (const [code, anchors] of Object.entries(semanticAnchors)) {
      const note = getUiStrings(code).euScopeNote;
      assert.match(note, anchors.suffixless, `${code} must mean without a suffix`);
      assert.doesNotMatch(note, anchors.wrong, `${code} must not mean unabridged`);
      assert.match(note, /3\s*R\/L\/D/i, `${code} retains sector scope`);
    }
  });

  it("has an independently localized settings anchor for every non-English locale", () => {
    const anchors: Record<string, string> = {
      bg: "Поддържани закони", cs: "Podporované zákony", da: "Understøttede love", el: "Υποστηριζόμενοι νόμοι", es: "Leyes compatibles", et: "Toetatud seadused", fi: "Tuetut lait", fr: "Lois prises en charge", ga: "Dlíthe tacaithe", hr: "Podržani zakoni", hu: "Támogatott jogszabályok", it: "Leggi supportate", lt: "Palaikomi įstatymai", lv: "Atbalstītie likumi", mt: "Liġijiet appoġġati", nl: "Ondersteunde wetten", pl: "Obsługiwane ustawy", pt: "Leis suportadas", ro: "Legi acceptate", sk: "Podporované zákony", sl: "Podprti zakoni", sv: "Lagar som stöds",
    };
    for (const [code, expected] of Object.entries(anchors)) assert.equal(getUiStrings(code).supportedLaws, expected, code);
  });

  it("advertises parser-backed structured EU examples for every UI language", () => {
    for (const code of UI_LANGUAGE_CODES) {
      const result = parseLawReferenceWithSelectedJurisdiction(getUiStrings(code).euStructuredCitationExample, "EU", null);
      assert.equal(result?.jurisdiction, "EU", code);
      assert.equal(result?.euCelex, "32016R0679", code);
      assert.equal(result?.section, "1", code);
    }
  });

  it("keeps every displayed EU input example backed by the real parser and resolver", () => {
    const celex = "32016R0679";
    for (const code of UI_LANGUAGE_CODES) {
      const strings = getUiStrings(code);
      const directExamples = strings.euDirectCelexExamples.split(/[;·]/u).map((example) => example.trim());
      const aliasExamples = strings.euAliasExamples.split(/[;·]/u).map((example) => example.trim());

      for (const example of directExamples) {
        assert.notEqual(example, "", `${code} direct example must not be empty`);
        const result = parseLawReferenceWithSelectedJurisdiction(example, "EU");
        assert.equal(result?.jurisdiction, "EU", `${code} direct: ${example}`);
        assert.equal(result?.section, "1", `${code} direct: ${example}`);
        assert.equal(result?.euCelex, celex, `${code} direct: ${example}`);
      }

      for (const example of aliasExamples) {
        assert.notEqual(example, "", `${code} alias example must not be empty`);
        const result = parseLawReferenceWithSelectedJurisdiction(example, "EU");
        assert.equal(result?.jurisdiction, "EU", `${code} alias: ${example}`);
        assert.equal(result?.section, "1", `${code} alias: ${example}`);
        const expectedCelex = example.toLowerCase().includes("data act") ? "32023R2854" : "32024R1689";
        assert.equal(result?.euCelex, expectedCelex, `${code} alias: ${example}`);
      }

      for (const [label, example] of [
        ["article-first", strings.euStructuredCitationExample],
        ["act-first", strings.euActFirstExample],
      ] as const) {
        const result = parseLawReferenceWithSelectedJurisdiction(example, "EU");
        assert.equal(result?.jurisdiction, "EU", `${code} ${label}: ${example}`);
        assert.equal(result?.section, "1", `${code} ${label}: ${example}`);
        assert.equal(result?.euCelex, celex, `${code} ${label}: ${example}`);
      }

      const expected = EU_OFFICIAL_TITLES_32016R0679[code as keyof typeof EU_OFFICIAL_TITLES_32016R0679];
      assert.equal(strings.euExactTitleExample, `Art. 1 ${expected.title}`, `${code} title must match frozen EU authority`);
      const exactTitleIndex = addOrReplaceEntry(emptyEuActIndex(), {
        celex: expected.celex,
        documentType: "R",
        year: "2016",
        number: "0679",
        titlesByLanguage: Object.fromEntries(Object.entries(EU_OFFICIAL_TITLES_32016R0679).map(([locale, evidence]) => [({ bg: "bul", cs: "ces", da: "dan", de: "deu", el: "ell", en: "eng", es: "spa", et: "est", fi: "fin", fr: "fra", ga: "gle", hr: "hrv", hu: "hun", it: "ita", lt: "lit", lv: "lav", mt: "mlt", nl: "nld", pl: "pol", pt: "por", ro: "ron", sk: "slk", sl: "slv", sv: "swe" } as const)[locale as keyof typeof EU_OFFICIAL_TITLES_32016R0679], evidence.title])),
        availableLanguages: ["bul", "ces", "dan", "deu", "ell", "eng", "spa", "est", "fin", "fra", "gle", "hrv", "hun", "ita", "lit", "lav", "mlt", "nld", "pol", "por", "ron", "slk", "slv", "swe"],
      });
      const exactTitleResult = parseLawReferenceWithSelectedJurisdiction(
        strings.euExactTitleExample,
        "EU",
        exactTitleIndex,
      );
      assert.equal(exactTitleResult?.jurisdiction, "EU", `${code} exact title`);
      assert.equal(exactTitleResult?.section, "1", `${code} exact title`);
      assert.equal(exactTitleResult?.euCelex, celex, `${code} exact title`);
    }
  });

  it("detects a wrong-language exact title even when that title independently resolves", () => {
    const titlesByLanguage = Object.fromEntries(Object.entries(EU_OFFICIAL_TITLES_32016R0679).map(([locale, evidence]) => [({ bg: "bul", cs: "ces", da: "dan", de: "deu", el: "ell", en: "eng", es: "spa", et: "est", fi: "fin", fr: "fra", ga: "gle", hr: "hrv", hu: "hun", it: "ita", lt: "lit", lv: "lav", mt: "mlt", nl: "nld", pl: "pol", pt: "por", ro: "ron", sk: "slk", sl: "slv", sv: "swe" } as const)[locale as keyof typeof EU_OFFICIAL_TITLES_32016R0679], evidence.title]));
    const index = addOrReplaceEntry(emptyEuActIndex(), { celex: "32016R0679", documentType: "R", year: "2016", number: "0679", titlesByLanguage, availableLanguages: Object.keys(titlesByLanguage) });
    const wrongLanguageExample = `Art. 1 ${EU_OFFICIAL_TITLES_32016R0679.nl.title}`;
    assert.notEqual(wrongLanguageExample, `Art. 1 ${EU_OFFICIAL_TITLES_32016R0679.lt.title}`);
    assert.equal(parseLawReferenceWithSelectedJurisdiction(wrongLanguageExample, "EU", index)?.euCelex, "32016R0679");
    assert.notEqual(getUiStrings("lt").euExactTitleExample, wrongLanguageExample, "Lithuanian catalog title must reject the Dutch title");
  });

  it("has representative localized modal and action anchors", () => {
    const expected = {
      bg: ["Търсене на закон", "Официален език на швейцарския текст"],
      el: ["Αναζήτηση νόμου", "Επίσημη γλώσσα ελβετικού κειμένου"],
      fr: ["Rechercher une loi", "Langue officielle du texte suisse"],
      ga: ["Dlí a chuardach", "Teanga oifigiúil téacs na hEilvéise"],
      pl: ["Wyszukaj ustawę", "Język urzędowego tekstu szwajcarskiego"],
      pt: ["Consultar lei", "Idioma oficial do texto suíço"],
      fi: ["Hae laki", "Sveitsin virallisen tekstin kieli"],
    };
    for (const [code, [title, swissLabel]] of Object.entries(expected)) {
      assert.equal(getUiStrings(code).lookUpLawTitle, title, code);
      assert.equal(getUiStrings(code).swissOfficialTextLanguage, swissLabel, code);
    }
  });

  it("fully localizes Batch A catalogs without unexpected English-identical values", () => {
    const batch = ["bg", "el", "fr", "ga", "pl", "pt"] as const;
    const anchors = {
      bg: {
        supportedLaws: "Поддържани закони",
        supportedLawsDescription: "Този списък показва изрично поддържаните закони; справките все пак се изпълняват на живо чрез веригата от доставчици.",
        lookUpLawTitle: "Търсене на закон",
        noRecognizedCitation: "Няма разпознато цитиране.",
        insertIntoCurrentNote: "Вмъкване в текущата бележка",
        swissOfficialTextLanguage: "Официален език на швейцарския текст",
        euScopeNote: "Структурираните цитирания се поддържат на всичките 24 официални езика на ЕС. Поддържаните общи актове остават в оригиналния си вид без суфикс на сектор 3 R/L/D. Точното съвпадение с официалното заглавие зависи от локалния индекс на метаданните на ЕС; непълни или приблизителни заглавия не се разрешават мълчаливо. Самостоятелно въведени година и номер не се приемат мълчаливо. Неподдържаните класове CELEX продължават да се отхвърлят. Машинен превод не се генерира.",
      },
      el: {
        supportedLaws: "Υποστηριζόμενοι νόμοι",
        supportedLawsDescription: "Αυτή η λίστα εμφανίζει τους νόμους που υποστηρίζονται ρητά· οι αναζητήσεις εξακολουθούν να εκτελούνται ζωντανά μέσω της αλυσίδας παρόχων.",
        lookUpLawTitle: "Αναζήτηση νόμου",
        noRecognizedCitation: "Δεν αναγνωρίστηκε παραπομπή.",
        insertIntoCurrentNote: "Εισαγωγή στην τρέχουσα σημείωση",
        swissOfficialTextLanguage: "Επίσημη γλώσσα ελβετικού κειμένου",
        euScopeNote: "Οι δομημένες παραπομπές υποστηρίζονται και στις 24 επίσημες γλώσσες της ΕΕ. Οι υποστηριζόμενες γενικές πράξεις παραμένουν στην αρχική, χωρίς επίθημα, μορφή τομέα 3 R/L/D. Η ακριβής αντιστοίχιση επίσημου τίτλου εξαρτάται από τον τοπικό δείκτη μεταδεδομένων της ΕΕ· οι μερικοί ή ασαφείς τίτλοι δεν επιλύονται σιωπηρά. Η εισαγωγή μόνο έτους και αριθμού δεν γίνεται δεκτή σιωπηρά. Οι μη υποστηριζόμενες κλάσεις CELEX εξακολουθούν να απορρίπτονται. Δεν δημιουργείται αυτόματη μετάφραση.",
      },
      fr: {
        supportedLaws: "Lois prises en charge",
        supportedLawsDescription: "Cette liste présente les lois explicitement prises en charge ; les recherches sont néanmoins effectuées en direct via la chaîne de fournisseurs.",
        lookUpLawTitle: "Rechercher une loi",
        noRecognizedCitation: "Aucune citation reconnue.",
        insertIntoCurrentNote: "Insérer dans la note actuelle",
        swissOfficialTextLanguage: "Langue officielle du texte suisse",
        euScopeNote: "Les citations structurées sont prises en charge dans les 24 langues officielles de l’UE. Les actes génériques pris en charge conservent leur forme originale non suffixée de secteur 3 R/L/D. La correspondance exacte avec le titre officiel dépend de l’index local des métadonnées de l’UE ; les titres partiels ou approximatifs ne sont pas résolus silencieusement. Une simple année accompagnée d’un numéro n’est pas acceptée silencieusement. Les classes CELEX non prises en charge restent rejetées. Aucune traduction automatique n’est générée.",
      },
      ga: {
        supportedLaws: "Dlíthe tacaithe",
        supportedLawsDescription: "Taispeánann an liosta seo na dlíthe a dtacaítear leo go sainráite; reáchtáiltear cuardaigh beo fós trí shlabhra na soláthraithe.",
        lookUpLawTitle: "Dlí a chuardach",
        noRecognizedCitation: "Níor aithníodh aon tagairt.",
        insertIntoCurrentNote: "Ionsáigh sa nóta reatha",
        swissOfficialTextLanguage: "Teanga oifigiúil téacs na hEilvéise",
        euScopeNote: "Tacaítear le tagairtí struchtúrtha i ngach ceann de 24 teanga oifigiúla an Aontais Eorpaigh. Fanann na gníomhartha cineálacha a dtacaítear leo ina mbunfhoirm gan iarmhír de chuid earnáil 3 R/L/D. Braitheann meaitseáil bheacht an teidil oifigiúil ar innéacs meiteashonraí áitiúil an AE; ní réitítear teidil pháirteacha ná doiléire go ciúin. Ní ghlactar go ciúin le hionchur bliana/uimhreach amháin. Diúltaítear fós do ranganna CELEX nach dtacaítear leo. Ní ghintear aistriúchán meaisín.",
      },
      pl: {
        supportedLaws: "Obsługiwane ustawy",
        supportedLawsDescription: "Ta lista przedstawia wyraźnie obsługiwane ustawy; wyszukiwanie nadal odbywa się na żywo za pośrednictwem łańcucha dostawców.",
        lookUpLawTitle: "Wyszukaj ustawę",
        noRecognizedCitation: "Nie rozpoznano cytowania.",
        insertIntoCurrentNote: "Wstaw do bieżącej notatki",
        swissOfficialTextLanguage: "Język urzędowego tekstu szwajcarskiego",
        euScopeNote: "Cytowania strukturalne są obsługiwane we wszystkich 24 językach urzędowych UE. Obsługiwane akty ogólne zachowują oryginalną, pozbawioną przyrostka postać sektora 3 R/L/D. Dokładne dopasowanie tytułu urzędowego zależy od lokalnego indeksu metadanych UE; tytuły częściowe lub przybliżone nie są rozstrzygane po cichu. Samodzielne podanie roku i numeru nie jest po cichu akceptowane. Nieobsługiwane klasy CELEX nadal są odrzucane. Tłumaczenie maszynowe nie jest generowane.",
      },
      pt: {
        supportedLaws: "Leis suportadas",
        supportedLawsDescription: "Esta lista apresenta as leis explicitamente suportadas; as consultas continuam a ser executadas em direto através da cadeia de fornecedores.",
        lookUpLawTitle: "Consultar lei",
        noRecognizedCitation: "Não foi reconhecida nenhuma citação.",
        insertIntoCurrentNote: "Inserir na nota atual",
        swissOfficialTextLanguage: "Idioma oficial do texto suíço",
        euScopeNote: "As citações estruturadas são suportadas nas 24 línguas oficiais da UE. Os atos genéricos suportados mantêm a forma original sem sufixo do setor 3 R/L/D. A correspondência exata com o título oficial depende do índice local de metadados da UE; os títulos parciais ou aproximados não são resolvidos silenciosamente. A introdução isolada de ano e número não é aceite silenciosamente. As classes CELEX não suportadas continuam a ser rejeitadas. Não é gerada tradução automática.",
      },
    } as const;
    const failures: string[] = [];
    for (const code of batch) {
      const strings = getUiStrings(code);
      for (const [key, value] of Object.entries(strings)) {
        if (value === getUiStrings("en")[key as keyof typeof strings] && !isAllowedIdenticalKey(code, key)) {
          failures.push(`${code}.${key}=${value}`);
        }
      }
    }
    assert.deepEqual(failures, [], `Unexpected English-identical values:\n${failures.join("\n")}`);
    for (const code of batch) {
      const strings = getUiStrings(code);
      for (const [key, value] of Object.entries(anchors[code])) assert.equal(strings[key as keyof typeof strings], value, `${code}.${key}`);
    }
  });

  it("fully localizes Batch B catalogs without unexpected English-identical values", () => {
    const batch = ["cs", "da", "et", "fi", "lv", "sv"] as const;
    const anchors = {
      cs: {
        supportedLaws: "Podporované zákony",
        supportedLawsDescription: "Tento seznam uvádí výslovně podporované zákony; vyhledávání přesto probíhá živě prostřednictvím řetězce poskytovatelů.",
        lookUpLawTitle: "Vyhledat zákon",
        noRecognizedCitation: "Nebyla rozpoznána žádná citace.",
        insertIntoCurrentNote: "Vložit do aktuální poznámky",
        swissOfficialTextLanguage: "Úřední jazyk švýcarského textu",
        euScopeNote: "Strukturované citace podporuje všech 24 úředních jazyků EU. Přesné názvy závisejí na místním indexu metadat; neúplné názvy se neřeší automaticky. Samostatný rok a číslo se nepřijímá. Nepodporované třídy CELEX se odmítají. Strojový překlad se nevytváří.",
      },
      da: {
        supportedLaws: "Understøttede love",
        supportedLawsDescription: "Denne liste viser love, der udtrykkeligt understøttes; opslag udføres stadig live gennem leverandørkæden.",
        lookUpLawTitle: "Slå lov op",
        noRecognizedCitation: "Ingen genkendt henvisning.",
        insertIntoCurrentNote: "Indsæt i den aktuelle note",
        swissOfficialTextLanguage: "Schweizisk officielt tekstsprog",
        euScopeNote: "Strukturerede henvisninger understøttes på alle 24 officielle EU-sprog. Præcise titler afhænger af det lokale metadataindeks; delvise titler fortolkes ikke stiltiende. År og nummer alene accepteres ikke. Ikke-understøttede CELEX-klasser afvises. Der genereres ingen maskinoversættelse.",
      },
      et: {
        supportedLaws: "Toetatud seadused",
        supportedLawsDescription: "See loend näitab sõnaselgelt toetatud seadusi; päringud tehakse endiselt otse teenusepakkujate ahela kaudu.",
        lookUpLawTitle: "Otsi seadust",
        noRecognizedCitation: "Tuvastatud viidet ei ole.",
        insertIntoCurrentNote: "Lisa praegusesse märkmesse",
        swissOfficialTextLanguage: "Šveitsi ametliku teksti keel",
        euScopeNote: "Struktureeritud viiteid toetatakse kõigis 24 ELi ametlikus keeles. Täpsed pealkirjad sõltuvad kohalikust metaandmete indeksist; osalisi pealkirju ei lahendata vaikimisi. Ainult aastat ja numbrit ei aktsepteerita. Toetamata CELEX-klassid lükatakse tagasi. Masintõlget ei looda.",
      },
      fi: {
        supportedLaws: "Tuetut lait",
        supportedLawsDescription: "Tässä luettelossa ovat nimenomaisesti tuetut lait; haut tehdään silti reaaliaikaisesti palveluntarjoajien ketjun kautta.",
        lookUpLawTitle: "Hae laki",
        noRecognizedCitation: "Tunnistettua viitettä ei löytynyt.",
        insertIntoCurrentNote: "Lisää nykyiseen muistiinpanoon",
        swissOfficialTextLanguage: "Sveitsin virallisen tekstin kieli",
        euScopeNote: "Rakenteisia viittauksia tuetaan kaikilla 24 EU:n virallisella kielellä. Tarkat nimet riippuvat paikallisesta metatietohakemistosta; osittaisia nimiä ei tulkita hiljaisesti. Pelkkää vuotta ja numeroa ei hyväksytä. Tukemattomat CELEX-luokat hylätään. Konekäännöksiä ei tuoteta.",
      },
      lv: {
        supportedLaws: "Atbalstītie likumi",
        supportedLawsDescription: "Šajā sarakstā ir norādīti skaidri atbalstītie likumi; meklēšana joprojām notiek tiešsaistē, izmantojot pakalpojumu sniedzēju ķēdi.",
        lookUpLawTitle: "Meklēt likumu",
        noRecognizedCitation: "Atpazīta atsauce nav atrasta.",
        insertIntoCurrentNote: "Ievietot pašreizējā piezīmē",
        swissOfficialTextLanguage: "Šveices oficiālā teksta valoda",
        euScopeNote: "Strukturētas atsauces tiek atbalstītas visās 24 ES oficiālajās valodās. Precīzi nosaukumi ir atkarīgi no lokālā metadatu indeksa; daļēji nosaukumi netiek klusi atrisināti. Gads un numurs vieni paši netiek pieņemti. Neatbalstītas CELEX klases tiek noraidītas. Mašīntulkojums netiek ģenerēts.",
      },
      sv: {
        supportedLaws: "Lagar som stöds",
        supportedLawsDescription: "Den här listan visar lagar som uttryckligen stöds; sökningar görs fortfarande direkt via leverantörskedjan.",
        lookUpLawTitle: "Slå upp lag",
        noRecognizedCitation: "Ingen hänvisning kunde identifieras.",
        insertIntoCurrentNote: "Infoga i den aktuella anteckningen",
        swissOfficialTextLanguage: "Officiellt språk för schweizisk text",
        euScopeNote: "Strukturerade hänvisningar stöds på alla 24 officiella EU-språk. Exakta titlar beror på det lokala metadataindexet; ofullständiga titlar löses inte automatiskt. Enbart år och nummer godtas inte. CELEX-klasser som inte stöds avvisas. Ingen maskinöversättning skapas.",
      },
    } as const;
    const failures: string[] = [];
    for (const code of batch) {
      const strings = getUiStrings(code);
      for (const [key, value] of Object.entries(strings)) {
        if (value === getUiStrings("en")[key as keyof typeof strings] && !isAllowedIdenticalKey(code, key)) {
          failures.push(`${code}.${key}=${value}`);
        }
      }
    }
    assert.deepEqual(failures, [], `Unexpected English-identical values:\n${failures.join("\n")}`);
    for (const code of batch) {
      const strings = getUiStrings(code);
      for (const [key, value] of Object.entries(anchors[code])) {
        if (key !== "euScopeNote") assert.equal(strings[key as keyof typeof strings], value, `${code}.${key}`);
      }
    }
  });

  it("fully localizes Batch C catalogs without unexpected English-identical values", () => {
    const batch = ["es", "hr", "it", "mt", "ro", "sl"] as const;
    const anchors = {
      es: {
        supportedLaws: "Leyes compatibles", supportedLawsDescription: "Esta lista muestra las leyes admitidas explícitamente; las consultas siguen ejecutándose en directo a través de la cadena de proveedores.", lookUpLawTitle: "Buscar ley", noRecognizedCitation: "No se reconoció ninguna cita.", insertIntoCurrentNote: "Insertar en la nota actual", swissOfficialTextLanguage: "Idioma oficial del texto suizo", euScopeNote: "Las citas estructuradas son compatibles con las 24 lenguas oficiales de la UE. Los actos genéricos admitidos conservan su forma original sin sufijo del sector 3 R/L/D. La coincidencia exacta con el título oficial depende del índice local de metadatos de la UE; los títulos parciales o aproximados no se resuelven silenciosamente. La entrada aislada de año y número no se admite silenciosamente. Las clases CELEX no compatibles siguen rechazándose. No se genera traducción automática.",
      },
      hr: {
        supportedLaws: "Podržani zakoni", supportedLawsDescription: "Ovaj popis prikazuje izričito podržane zakone; pretraživanja se i dalje izvršavaju uživo putem lanca pružatelja.", lookUpLawTitle: "Pretraži zakon", noRecognizedCitation: "Nije prepoznat nijedan citat.", insertIntoCurrentNote: "Umetni u trenutačnu bilješku", swissOfficialTextLanguage: "Službeni jezik švicarskog teksta", euScopeNote: "Strukturirani citati podržani su na sva 24 službena jezika EU-a. Podržani opći akti zadržavaju izvorni oblik sektora 3 R/L/D bez sufiksa. Točno podudaranje sa službenim naslovom ovisi o lokalnom indeksu metapodataka EU-a; nepotpuni ili približni naslovi ne rješavaju se prešutno. Samostalan unos godine i broja ne prihvaća se prešutno. Nepodržane klase CELEX i dalje se odbacuju. Strojni prijevod se ne generira.",
      },
      it: {
        supportedLaws: "Leggi supportate", supportedLawsDescription: "Questo elenco mostra le leggi esplicitamente supportate; le ricerche vengono comunque eseguite in tempo reale tramite la catena di fornitori.", lookUpLawTitle: "Cerca legge", noRecognizedCitation: "Nessuna citazione riconosciuta.", insertIntoCurrentNote: "Inserisci nella nota corrente", swissOfficialTextLanguage: "Lingua ufficiale del testo svizzero", euScopeNote: "Le citazioni strutturate sono supportate in tutte le 24 lingue ufficiali dell’UE. Gli atti generici supportati mantengono la forma originale senza suffisso del settore 3 R/L/D. La corrispondenza esatta con il titolo ufficiale dipende dall’indice locale dei metadati dell’UE; i titoli parziali o approssimativi non vengono risolti silenziosamente. L’inserimento isolato di anno e numero non viene accettato silenziosamente. Le classi CELEX non supportate continuano a essere rifiutate. Non viene generata alcuna traduzione automatica.",
      },
      mt: {
        supportedLaws: "Liġijiet appoġġati", supportedLawsDescription: "Din il-lista turi l-liġijiet appoġġati b’mod espliċitu; it-tfittxijiet xorta jsiru direttament permezz tal-katina tal-fornituri.", lookUpLawTitle: "Fittex liġi", noRecognizedCitation: "Ma ġiet rikonoxxuta l-ebda ċitazzjoni.", insertIntoCurrentNote: "Daħħal fin-nota attwali", swissOfficialTextLanguage: "Lingwa uffiċjali tat-test Żvizzeru", euScopeNote: "Iċ-ċitazzjonijiet strutturati huma appoġġati fl-24 lingwa uffiċjali kollha tal-UE. L-atti ġeneriċi appoġġati jibqgħu fil-forma oriġinali tagħhom mingħajr suffiss tas-settur 3 R/L/D. It-tqabbil eżatt mat-titolu uffiċjali jiddependi mill-indiċi lokali tal-metadata tal-UE; titoli parzjali jew approssimattivi ma jiġux solvuti b’mod impliċitu. Dħul ta’ sena u numru waħedhom ma jiġix aċċettat b’mod impliċitu. Il-klassijiet CELEX mhux appoġġati jibqgħu jiġu rrifjutati. Ma tiġi ġġenerata l-ebda traduzzjoni awtomatika.",
      },
      ro: {
        supportedLaws: "Legi acceptate", supportedLawsDescription: "Această listă prezintă legile acceptate în mod explicit; căutările se efectuează în continuare în timp real prin lanțul furnizorilor.", lookUpLawTitle: "Caută legea", noRecognizedCitation: "Nu a fost recunoscută nicio citare.", insertIntoCurrentNote: "Inserează în nota curentă", swissOfficialTextLanguage: "Limba oficială a textului elvețian", euScopeNote: "Citărilor structurate li se oferă suport în toate cele 24 de limbi oficiale ale UE. Actele generice acceptate își păstrează forma originală, fără sufix, din sectorul 3 R/L/D. Potrivirea exactă cu titlul oficial depinde de indexul local de metadate al UE; titlurile parțiale sau aproximative nu sunt rezolvate în mod silențios. Introducerea izolată a anului și numărului nu este acceptată în mod silențios. Clasele CELEX neacceptate continuă să fie respinse. Nu se generează traducere automată.",
      },
      sl: {
        supportedLaws: "Podprti zakoni", supportedLawsDescription: "Ta seznam prikazuje izrecno podprte zakone; poizvedbe se še vedno izvajajo v živo prek verige ponudnikov.", lookUpLawTitle: "Poišči zakon", noRecognizedCitation: "Prepoznanega sklica ni.", insertIntoCurrentNote: "Vstavi v trenutno opombo", swissOfficialTextLanguage: "Jezik uradnega švicarskega besedila", euScopeNote: "Strukturirani sklici so podprti v vseh 24 uradnih jezikih EU. Podprti splošni akti ohranjajo izvirno obliko sektorja 3 R/L/D brez pripone. Natančno ujemanje z uradnim naslovom je odvisno od lokalnega indeksa metapodatkov EU; delni ali približni naslovi se ne razrešijo tiho. Samostojen vnos leta in številke se ne sprejme tiho. Nepodprti razredi CELEX se še naprej zavračajo. Strojni prevod se ne ustvarja.",
      },
    } as const;
    const failures: string[] = [];
    for (const code of batch) {
      const strings = getUiStrings(code);
      for (const [key, value] of Object.entries(strings)) {
        if (value === getUiStrings("en")[key as keyof typeof strings] && !isAllowedIdenticalKey(code, key)) failures.push(`${code}.${key}=${value}`);
      }
    }
    assert.deepEqual(failures, [], `Unexpected English-identical values:\n${failures.join("\n")}`);
    for (const code of batch) {
      const strings = getUiStrings(code);
      for (const [key, value] of Object.entries(anchors[code])) assert.equal(strings[key as keyof typeof strings], value, `${code}.${key}`);
    }
  });

  it("fully localizes Batch D catalogs without unexpected English-identical values", () => {
    const batch = ["hu", "lt", "nl", "sk"] as const;
    const anchors = {
      hu: {
        supportedLaws: "Támogatott jogszabályok",
        supportedLawsDescription: "Ez a lista a kifejezetten támogatott jogszabályokat mutatja; a keresések továbbra is élőben, a szolgáltatói láncon keresztül futnak.",
        lookUpLawTitle: "Jogszabály keresése",
        noRecognizedCitation: "Nem sikerült felismerni hivatkozást.",
        insertIntoCurrentNote: "Beillesztés az aktuális jegyzetbe",
        swissOfficialTextLanguage: "A svájci hivatalos szöveg nyelve",
        euScopeNote: "A strukturált hivatkozások mind a 24 uniós hivatalos nyelven támogatottak. A támogatott általános jogi aktusok megőrzik eredeti, utótag nélküli, 3 R/L/D szektorbeli formájukat. A hivatalos cím pontos egyeztetése a helyi uniós metaadatindexétől függ; a részleges vagy hozzávetőleges címeket a rendszer nem oldja fel hallgatólagosan. Az önmagában megadott év és szám nem fogadható el hallgatólagosan. A nem támogatott CELEX-osztályokat továbbra is elutasítjuk. Gépi fordítás nem készül.",
      },
      lt: {
        supportedLaws: "Palaikomi įstatymai",
        supportedLawsDescription: "Šiame sąraše pateikiami aiškiai palaikomi įstatymai; užklausos ir toliau vykdomos tiesiogiai per teikėjų grandinę.",
        lookUpLawTitle: "Ieškoti įstatymo",
        noRecognizedCitation: "Atpažinta citata nerasta.",
        insertIntoCurrentNote: "Įterpti į dabartinę pastabą",
        swissOfficialTextLanguage: "Šveicarijos oficialaus teksto kalba",
        euScopeNote: "Struktūrinės citatos palaikomos visomis 24 oficialiosiomis ES kalbomis. Palaikomi bendrieji teisės aktai išlaiko pradinę formą be priesagos iš 3 R/L/D sektoriaus. Tikslus oficialaus pavadinimo sutapatinimas priklauso nuo vietinio ES metaduomenų indekso; daliniai ar apytiksliai pavadinimai nebyliai nenustatomi. Vien tik metų ir numerio įvestis nebyliai nepriimama. Nepalaikomos CELEX klasės ir toliau atmetamos. Mašininis vertimas negeneruojamas.",
      },
      nl: {
        supportedLaws: "Ondersteunde wetten",
        supportedLawsDescription: "Deze lijst toont de uitdrukkelijk ondersteunde wetten; zoekopdrachten worden nog steeds live via de keten van aanbieders uitgevoerd.",
        lookUpLawTitle: "Wet opzoeken",
        noRecognizedCitation: "Geen herkenbare citatie gevonden.",
        insertIntoCurrentNote: "Invoegen in de huidige notitie",
        swissOfficialTextLanguage: "Officiële taal van de Zwitserse tekst",
        euScopeNote: "Gestructureerde citaten worden ondersteund in alle 24 officiële EU-talen. Ondersteunde algemene handelingen behouden hun oorspronkelijke, niet-gesuffixeerde vorm uit sector 3 R/L/D. Een exacte overeenkomst met de officiële titel hangt af van de lokale EU-metadata-index; gedeeltelijke of globale titels worden niet stilzwijgend opgelost. Alleen een jaartal en nummer worden niet stilzwijgend aanvaard. Niet-ondersteunde CELEX-klassen blijven geweigerd. Er wordt geen automatische vertaling gegenereerd.",
      },
      sk: {
        supportedLaws: "Podporované zákony",
        supportedLawsDescription: "Tento zoznam uvádza výslovne podporované zákony; vyhľadávanie naďalej prebieha naživo prostredníctvom reťazca poskytovateľov.",
        lookUpLawTitle: "Vyhľadať zákon",
        noRecognizedCitation: "Nenašla sa žiadna rozpoznaná citácia.",
        insertIntoCurrentNote: "Vložiť do aktuálnej poznámky",
        swissOfficialTextLanguage: "Úradný jazyk švajčiarskeho textu",
        euScopeNote: "Štruktúrované citácie sú podporované vo všetkých 24 úradných jazykoch EÚ. Podporované všeobecné akty si zachovávajú pôvodnú formu sektora 3 R/L/D bez prípony. Presná zhoda s úradným názvom závisí od miestneho registra metadát EÚ; čiastočné alebo približné názvy sa nerozpoznávajú potichu. Samostatný rok a číslo sa potichu neprijímajú. Nepodporované triedy CELEX sa naďalej odmietajú. Strojový preklad sa nevytvára.",
      },
    } as const;
    const failures: string[] = [];
    for (const code of batch) {
      const strings = getUiStrings(code);
      for (const [key, value] of Object.entries(strings)) {
        if (value === getUiStrings("en")[key as keyof typeof strings] && !isAllowedIdenticalKey(code, key)) failures.push(`${code}.${key}=${value}`);
      }
    }
    assert.deepEqual(failures, [], `Unexpected English-identical values:\n${failures.join("\n")}`);
    for (const code of batch) {
      const strings = getUiStrings(code);
      for (const [key, value] of Object.entries(anchors[code])) assert.equal(strings[key as keyof typeof strings], value, `${code}.${key}`);
    }
  });

  it("contains no admitted-locale English fallback construction", () => {
    const source = readFileSync(resolve(process.cwd(), "src/ui/i18nCatalog.ts"), "utf8");
    assert.doesNotMatch(source, /materializeCatalog|\.\.\.en|\?\?\s*en\[|\|\|\s*en\[|Object\.assign\(en|merge.*English/i);
  });

  it("uses official-de when nothing is stored on German locales", () => {
    assert.equal(defaultLawSourceVariantForLanguage("de"), "official-de");
    assert.equal(defaultLawSourceVariantForLanguage("de-DE"), "official-de");
  });

  it("uses official-de when nothing is stored on non-German or unknown locales", () => {
    assert.equal(defaultLawSourceVariantForLanguage("en"), "official-de");
    assert.equal(defaultLawSourceVariantForLanguage("fr"), "official-de");
    assert.equal(defaultLawSourceVariantForLanguage(undefined), "official-de");
  });

  it("provides German Switzerland label", () => {
    assert.equal(getUiStrings("de").jurisdictionSwitzerland, "Schweiz");
  });

  it("provides English Switzerland label", () => {
    assert.equal(getUiStrings("en").jurisdictionSwitzerland, "Switzerland");
  });

  it("provides EU labels and resolves stored, locale, then German defaults", () => {
    assert.equal(getUiStrings("de").jurisdictionEuropeanUnion, "Europäische Union"); assert.equal(getUiStrings("en").jurisdictionEuropeanUnion, "European Union");
    assert.equal(defaultEuLawLanguage("fr-FR"), "fr"); assert.equal(defaultEuLawLanguage("xx", "pl"), "pl"); assert.equal(defaultEuLawLanguage("xx"), "de");
  });

  it("uses the corrected Dutch input-layout label", () => {
    assert.equal(getUiStrings("nl").inputLayout, "Invoerlay-out");
  });

  it("preserves existing Germany and Austria labels", () => {
    assert.equal(getUiStrings("de").jurisdictionGermany, "Deutschland");
    assert.equal(getUiStrings("de").jurisdictionAustria, "Österreich");
    assert.equal(getUiStrings("en").jurisdictionGermany, "Germany");
    assert.equal(getUiStrings("en").jurisdictionAustria, "Austria");
  });

  it("uses official-de for existing plugin data without a stored variant on non-German locales", () => {
    assert.equal(
      defaultLawSourceVariantForLanguage("en", undefined),
      "official-de",
    );
  });

  it("uses official-de for existing plugin data without a stored variant on German locales", () => {
    assert.equal(
      defaultLawSourceVariantForLanguage("de", undefined),
      "official-de",
    );
  });

  it("keeps a stored official-de value even on non-German locales", () => {
    assert.equal(
      defaultLawSourceVariantForLanguage("en", "official-de"),
      "official-de",
    );
  });

  it("keeps a stored translation-en value even on German locales", () => {
    assert.equal(
      defaultLawSourceVariantForLanguage("de", "translation-en"),
      "translation-en",
    );
  });
});
