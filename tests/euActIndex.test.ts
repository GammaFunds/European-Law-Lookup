import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import {
  addOrReplaceEntry,
  emptyEuActIndex,
  EU_ACT_INDEX_SCHEMA_VERSION,
  indexEntryForCelex,
  isEuActIndexEntryAvailableLanguage,
  parseStoredEuActIndex,
  searchEuActIndex,
  serializeEuActIndex,
  validateEuActIndexEntry,
  EuActIndexValidationError,
  type EuActIndexEntry,
} from "../src/law/euActIndex";
import { parseEuCelex } from "../src/law/euActRegistry";
import { cellarLanguageNativeName, isEuCellarLanguageCode } from "../src/law/euLanguages";
import {
  createEuActIndexLanguageAuthorizer,
  EuActLanguageExpressionUnavailableError,
} from "../src/law/providers/eurLexMapping";
import { EurLexLawProvider } from "../src/law/providers/EurLexLawProvider";
import { parseLawReferenceWithSelectedJurisdiction } from "../src/parser";

function entry(overrides: Partial<EuActIndexEntry> = {}): EuActIndexEntry {
  return {
    celex: "32016R0679",
    documentType: "R",
    year: "2016",
    number: "0679",
    titlesByLanguage: { eng: "Regulation (EU) 2016/679", deu: "Verordnung (EU) 2016/679" },
    availableLanguages: ["deu", "eng"],
    ...overrides,
  };
}

describe("euActIndex identity scope", () => {
  it("keeps an already-typed string usable in the invalid-language branch", () => {
    const candidate: string = "de";
    if (!isEuCellarLanguageCode(candidate)) {
      assert.equal(candidate.toUpperCase(), "DE");
    }
  });

  it("parses a valid original sector-3 regulation CELEX", () => {
    assert.ok(parseEuCelex("32016R0679"));
    assert.equal(parseEuCelex("32016R0679")?.documentType, "R");
  });

  it("rejects consolidation suffixed CELEX (32016R0679R(01))", () => {
    assert.equal(parseEuCelex("32016R0679R(01)"), null);
  });

  it("rejects corrigendum/suffixed corrective identities", () => {
    for (const celex of ["32016R0679C(01)", "32016R0679R(02)", "32016R0679(01)"]) {
      assert.equal(parseEuCelex(celex), null, celex);
    }
  });

  it("rejects non-sector-3 CELEX", () => {
    assert.equal(parseEuCelex("02016R0679"), null);
    assert.equal(parseEuCelex("62016R0679"), null);
  });

  it("rejects document types outside R/L/D", () => {
    assert.equal(parseEuCelex("32016C0679"), null);
    assert.equal(parseEuCelex("32016A0679"), null);
  });
});

describe("euActIndex entry validation", () => {
  it("accepts a well-formed entry", () => {
    assert.deepEqual(validateEuActIndexEntry(entry()), entry());
  });

  it("rejects a consolidation/suffixed CELEX", () => {
    assert.throws(() => validateEuActIndexEntry(entry({ celex: "32016R0679R(01)" })), EuActIndexValidationError);
  });

  it("rejects sector != 3", () => {
    assert.throws(() => validateEuActIndexEntry(entry({ celex: "02016R0679" })), EuActIndexValidationError);
  });

  it("rejects document type outside R/L/D", () => {
    assert.throws(() => validateEuActIndexEntry(entry({ celex: "32016C0679", documentType: "C" as never })), EuActIndexValidationError);
  });

  it("rejects CELEX identity mismatch between celex and documentType", () => {
    assert.throws(
      () => validateEuActIndexEntry(entry({ celex: "32016L0679", documentType: "R" })),
      EuActIndexValidationError,
    );
  });

  it("rejects an unknown available language (no silent fallback)", () => {
    assert.throws(
      () => validateEuActIndexEntry(entry({ availableLanguages: ["deu", "de"] })),
      EuActIndexValidationError,
    );
  });

  it("rejects a non-admitted language title key", () => {
    assert.throws(
      () => validateEuActIndexEntry(entry({ titlesByLanguage: { deu: "x", de: "y" } as Record<string, string> })),
      EuActIndexValidationError,
    );
  });

  it("rejects a malformed entry that is not an object", () => {
    assert.throws(() => validateEuActIndexEntry("32016R0679"), EuActIndexValidationError);
  });
});

describe("euActIndex stored round-trip", () => {
  it("round-trips through serialize/parse", () => {
    let index = emptyEuActIndex();
    index = addOrReplaceEntry(index, entry());
    index = addOrReplaceEntry(index, entry({ celex: "32022L2555", documentType: "L", year: "2022", number: "2555", availableLanguages: ["eng"] }));
    const stored = serializeEuActIndex(index, "2025-01-01T00:00:00.000Z");
    const parsed = parseStoredEuActIndex(stored);
    assert.equal(parsed.entries.size, 2);
    assert.ok(indexEntryForCelex(parsed, "32016R0679"));
    assert.ok(indexEntryForCelex(parsed, "32022L2555"));
  });

  it("rejects a stored index with an unsupported schema version", () => {
    assert.throws(
      () => parseStoredEuActIndex({ schemaVersion: 99, entries: [] }),
      EuActIndexValidationError,
    );
  });

  it("rejects a stored index that is not an object", () => {
    assert.throws(() => parseStoredEuActIndex(null), EuActIndexValidationError);
    assert.throws(() => parseStoredEuActIndex([entry()]), EuActIndexValidationError);
  });

  it("rejects a stored index with a duplicate CELEX", () => {
    const stored = {
      schemaVersion: EU_ACT_INDEX_SCHEMA_VERSION,
      lastSyncCheckpoint: null,
      generatedAt: "2025-01-01T00:00:00.000Z",
      entries: [
        entry(),
        entry(),
      ],
    };
    assert.throws(() => parseStoredEuActIndex(stored), EuActIndexValidationError);
  });

  it("rejects a stored index whose entries are not an array", () => {
    assert.throws(
      () => parseStoredEuActIndex({ schemaVersion: EU_ACT_INDEX_SCHEMA_VERSION, entries: {} }),
      EuActIndexValidationError,
    );
  });
});

describe("euActIndex discovery", () => {
  it("looks up an entry by CELEX", () => {
    const index = addOrReplaceEntry(emptyEuActIndex(), entry());
    assert.equal(indexEntryForCelex(index, "32016r0679")?.celex, "32016R0679");
    assert.equal(indexEntryForCelex(index, "31999R0001"), null);
  });

  it("reports available languages without silent fallback", () => {
    const e = entry({ availableLanguages: ["deu", "eng", "fra"] });
    assert.equal(isEuActIndexEntryAvailableLanguage(e, "eng"), true);
    assert.equal(isEuActIndexEntryAvailableLanguage(e, "gle"), false);
  });

  it("searches by CELEX, year, number, and title", () => {
    let index = emptyEuActIndex();
    index = addOrReplaceEntry(index, entry());
    index = addOrReplaceEntry(index, entry({ celex: "32022L2555", documentType: "L", year: "2022", number: "2555", titlesByLanguage: { eng: "Directive (EU) 2022/2555" } }));
    assert.equal(searchEuActIndex(index, "32022").length, 1);
    assert.equal(searchEuActIndex(index, "2555").length, 1);
    assert.equal(searchEuActIndex(index, "directive").length, 1);
    assert.equal(searchEuActIndex(index, "2022").length, 1);
    assert.equal(searchEuActIndex(index, "regulation").length, 1);
  });
});

describe("euActIndex language authorization", () => {
  const index = addOrReplaceEntry(
    emptyEuActIndex(),
    entry({ availableLanguages: ["deu", "eng", "fra"] }),
  );

  it("treats a missing index as unknown (never blocks direct lookup)", () => {
    const authorizer = createEuActIndexLanguageAuthorizer(null);
    assert.equal(authorizer.authorize("32016R0679", "ga"), "unknown");
  });

  it("treats an act absent from the index as unknown", () => {
    const authorizer = createEuActIndexLanguageAuthorizer(index);
    assert.equal(authorizer.authorize("31999R0001", "de"), "unknown");
  });

  it("authorizes a known available expression", () => {
    const authorizer = createEuActIndexLanguageAuthorizer(index);
    assert.equal(authorizer.authorize("32016R0679", "fra"), "available");
  });

  it("treats an index-absent language as unknown (advisory, not authoritative unavailable)", () => {
    const authorizer = createEuActIndexLanguageAuthorizer(index);
    assert.equal(authorizer.authorize("32016R0679", "gle"), "unknown");
  });
});

describe("EurLexLawProvider language authorization (no silent fallback)", () => {
  const reference = {
    lawCode: "32016R0679",
    section: "6",
    referenceType: "article" as const,
    jurisdiction: "EU" as const,
    language: "ga" as const,
    euCelex: "32016R0679",
    euDocumentType: "R" as const,
  };
  const html = `<!doctype html><html><head><meta name="celex" content="32016R0679"></head><body><h1 class="oj-doc-ti">Title</h1><div id="art_6"><p class="oj-sti-art">Title</p><p>Body.</p></div></body></html>`;
  function notice(celex: string): string {
    return `<?xml version="1.0"?><NOTICE type="identifier"><URI><VALUE>http://publications.europa.eu/resource/cellar/3e485e15-11bd-11e6-ba9a-01aa75ed71a1</VALUE><TYPE>cellar</TYPE><IDENTIFIER>3e485e15-11bd-11e6-ba9a-01aa75ed71a1</IDENTIFIER></URI><SAMEAS><URI><VALUE>http://publications.europa.eu/resource/celex/${celex}</VALUE><TYPE>celex</TYPE><IDENTIFIER>${celex}</IDENTIFIER></URI></SAMEAS></NOTICE>`;
  }
  function transportFor(celex: string) {
    return async (url: string, _options?: { headers?: Record<string, string> }) => ({
      ok: true,
      status: 200,
      text: async () => (url.includes("/celex/") ? notice(celex) : html),
      json: async () => ({}),
    });
  }

  it("no longer blocks on advisory index-negative language before Identifier Notice", async () => {
    const authorizer = createEuActIndexLanguageAuthorizer(
      addOrReplaceEntry(emptyEuActIndex(), entry({ availableLanguages: ["deu", "eng"] })),
    );
    const captured: Array<{ url: string }> = [];
    const provider = new EurLexLawProvider(
      async (url: string, _options?: { headers?: Record<string, string> }) => {
        captured.push({ url });
        return {
          ok: true,
          status: 200,
          text: async () => (url.includes("/celex/") ? notice("32016R0679") : html),
          json: async () => ({}),
        };
      },
      authorizer,
    );
    const section = await provider.getSection(reference);
    assert.ok(section);
    assert.equal(section?.euCelex, "32016R0679");
    assert.ok(captured.some((c) => c.url.includes("/celex/")), "Identifier Notice must be requested");
  });

  it("proceeds when the index does not know the act (unknown availability)", async () => {
    const authorizer = createEuActIndexLanguageAuthorizer(null);
    const provider = new EurLexLawProvider(transportFor("32016R0679"), authorizer);
    const section = await provider.getSection(reference);
    assert.ok(section);
    assert.equal(section?.euCelex, "32016R0679");
  });

  it("proceeds when the requested expression is available", async () => {
    const authorizer = createEuActIndexLanguageAuthorizer(
      addOrReplaceEntry(emptyEuActIndex(), entry({ availableLanguages: ["deu", "eng", "gle"] })),
    );
    const provider = new EurLexLawProvider(transportFor("32016R0679"), authorizer);
    const section = await provider.getSection(reference);
    assert.ok(section);
  });
});

describe("DE/AT/CH isolation preserved", () => {
  it("does not resolve EU aliases outside the EU jurisdiction", () => {
    assert.equal(parseLawReferenceWithSelectedJurisdiction("DSGVO Art. 6", "DE"), null);
    assert.equal(parseLawReferenceWithSelectedJurisdiction("DSGVO Art. 6", "AT"), null);
    assert.equal(parseLawReferenceWithSelectedJurisdiction("DSGVO Art. 6", "CH"), null);
    const eu = parseLawReferenceWithSelectedJurisdiction("DSGVO Art. 6", "EU");
    assert.equal(eu?.euCelex, "32016R0679");
  });
});



describe("future official CELLAR language expression (no static mapping entry)", () => {
  it("admits a CELLAR 3-letter language not present in EU_LANGUAGES into the index", () => {
    const entryRecord = validateEuActIndexEntry({
      celex: "32016R0679",
      documentType: "R",
      year: "2016",
      number: "0679",
      titlesByLanguage: { eng: "Regulation (EU) 2016/679" },
      availableLanguages: ["deu", "eng", "rus"],
    });
    assert.ok(entryRecord.availableLanguages.includes("rus"));
  });

  it("admits and transports the unknown language through the index and provider without a static whitelist", async () => {
    const index = addOrReplaceEntry(emptyEuActIndex(), entry({ availableLanguages: ["deu", "eng", "rus"] }));
    const authorizer = createEuActIndexLanguageAuthorizer(index);
    assert.equal(authorizer.authorize("32016R0679", "rus"), "available");

    const captured: Array<{ url: string; headers?: Record<string, string> }> = [];
    const noticeBody = '<NOTICE type="identifier"><URI><VALUE>http://publications.europa.eu/resource/cellar/3e485e15-11bd-11e6-ba9a-01aa75ed71a1</VALUE><TYPE>cellar</TYPE><IDENTIFIER>3e485e15-11bd-11e6-ba9a-01aa75ed71a1</IDENTIFIER></URI><SAMEAS><URI><VALUE>http://publications.europa.eu/resource/celex/32016R0679</VALUE><TYPE>celex</TYPE><IDENTIFIER>32016R0679</IDENTIFIER></URI></SAMEAS></NOTICE>';
    const htmlBody = '<!doctype html><html><head><meta name="celex" content="32016R0679"></head><body><h1 class="oj-doc-ti">Title</h1><div id="art_6"><p class="oj-sti-art">Title</p><p>Body.</p></div></body></html>';
    const transport = async (url: string, options?: { headers?: Record<string, string> }) => {
      captured.push({ url, headers: options?.headers });
      return {
        ok: true,
        status: 200,
        text: async () => (url.includes("/celex/") ? noticeBody : htmlBody),
        json: async () => ({}),
      };
    };
    const provider = new EurLexLawProvider(transport, authorizer);
    const reference = {
      lawCode: "32016R0679",
      section: "6",
      referenceType: "article" as const,
      jurisdiction: "EU" as const,
      language: "rus",
      euCelex: "32016R0679",
      euDocumentType: "R" as const,
    };
    const section = await provider.getSection(reference);
    assert.ok(section);
    const xhtmlRequest = captured.find((c) => c.url.includes("/cellar/"));
    assert.ok(xhtmlRequest);
    assert.equal(xhtmlRequest?.headers?.["Accept-Language"], "rus");
  });

  it("does not provide a friendly UI name for an unknown language (raw code is acceptable)", () => {
    assert.equal(cellarLanguageNativeName("rus"), null);
  });
});

describe("F5 raw CELEX identifier-notice authority ordering", () => {
  const html = `<!doctype html><html><head><meta name="celex" content="32016R0679"></head><body><h1 class="oj-doc-ti">Title</h1><div id="art_6"><p class="oj-sti-art">Title</p><p>Body.</p></div></body></html>`;
  const cellarUuid = "3e485e15-11bd-11e6-ba9a-01aa75ed71a1";
  function notice(celex: string): string {
    return `<?xml version="1.0"?><NOTICE type="identifier"><URI><VALUE>http://publications.europa.eu/resource/cellar/${cellarUuid}</VALUE><TYPE>cellar</TYPE><IDENTIFIER>${cellarUuid}</IDENTIFIER></URI><SAMEAS><URI><VALUE>http://publications.europa.eu/resource/celex/${celex}</VALUE><TYPE>celex</TYPE><IDENTIFIER>${celex}</IDENTIFIER></URI></SAMEAS></NOTICE>`;
  }

  interface CallCounts {
    notice: number;
    content: number;
  }

  function makeTransport(opts: { noticeCelex?: string; contentStatus?: number } = {}) {
    const noticeCelex = opts.noticeCelex ?? "32016R0679";
    const counts: CallCounts = { notice: 0, content: 0 };
    const transport = async (url: string, _options?: { headers?: Record<string, string> }) => {
      if (url.includes("/celex/")) {
        counts.notice++;
        return { ok: true, status: 200, text: async () => notice(noticeCelex), json: async () => ({}) };
      }
      counts.content++;
      return { ok: true, status: opts.contentStatus ?? 200, text: async () => html, json: async () => ({}) };
    };
    return { transport, counts };
  }

  const baseReference = {
    lawCode: "32016R0679",
    section: "6",
    referenceType: "article" as const,
    jurisdiction: "EU" as const,
    euCelex: "32016R0679",
    euDocumentType: "R" as const,
  };

  it("RED A: missing local index does not block Identifier Notice", async () => {
    const { transport, counts } = makeTransport();
    const provider = new EurLexLawProvider(transport, createEuActIndexLanguageAuthorizer(null));
    const section = await provider.getSection({ ...baseReference, language: "fra" });
    assert.ok(section);
    assert.equal(counts.notice, 1, "Identifier Notice must be requested when index is missing");
  });

  it("RED B: CELEX absent from index does not block Identifier Notice", async () => {
    const index = addOrReplaceEntry(emptyEuActIndex(), entry({ celex: "32022L2555", documentType: "L", year: "2022", number: "2555", availableLanguages: ["eng"] }));
    const { transport, counts } = makeTransport();
    const provider = new EurLexLawProvider(transport, createEuActIndexLanguageAuthorizer(index));
    const section = await provider.getSection({ ...baseReference, language: "fra" });
    assert.ok(section);
    assert.equal(counts.notice, 1, "Identifier Notice must be requested when CELEX is absent from index");
  });

  it("RED C: stale index negative language must NOT veto Identifier Notice", async () => {
    const index = addOrReplaceEntry(emptyEuActIndex(), entry({ availableLanguages: ["deu", "eng"] }));
    const { transport, counts } = makeTransport();
    const provider = new EurLexLawProvider(transport, createEuActIndexLanguageAuthorizer(index));
    const section = await provider.getSection({ ...baseReference, language: "fra" });
    assert.ok(section);
    assert.equal(section?.euCelex, "32016R0679");
    assert.equal(counts.notice, 1, "stale index negative language must not prevent Identifier Notice");
  });

  it("RED D: malformed CELEX makes zero authority requests", async () => {
    const { transport, counts } = makeTransport();
    const provider = new EurLexLawProvider(transport, createEuActIndexLanguageAuthorizer(null));
    const section = await provider.getSection({ ...baseReference, euCelex: "32016R0679R(01)", lawCode: "32016R0679R(01)" });
    assert.equal(section, null);
    assert.equal(counts.notice, 0, "no official authority request for structurally invalid CELEX");
  });

  it("RED E: Identifier Notice exact mismatch still rejects (no language content)", async () => {
    const index = addOrReplaceEntry(emptyEuActIndex(), entry({ availableLanguages: ["deu", "eng"] }));
    const { transport, counts } = makeTransport({ noticeCelex: "32022L2555" });
    const provider = new EurLexLawProvider(transport, createEuActIndexLanguageAuthorizer(index));
    const section = await provider.getSection({ ...baseReference, language: "fra" });
    assert.equal(section, null);
    assert.equal(counts.content, 0, "exact Notice mismatch must not fetch requested-language content");
  });

  it("RED F: stale index + valid Notice continues to requested-language content", async () => {
    const index = addOrReplaceEntry(emptyEuActIndex(), entry({ availableLanguages: ["deu", "eng"] }));
    const { transport, counts } = makeTransport();
    const provider = new EurLexLawProvider(transport, createEuActIndexLanguageAuthorizer(index));
    const section = await provider.getSection({ ...baseReference, language: "fra" });
    assert.ok(section);
    assert.equal(counts.notice, 1);
    assert.equal(counts.content, 1, "requested-language official content must be fetched after valid Notice");
  });

  it("RED G: actual authoritative language absence fails explicitly without fallback", async () => {
    const index = addOrReplaceEntry(emptyEuActIndex(), entry({ availableLanguages: ["deu", "eng"] }));
    const { transport, counts } = makeTransport({ contentStatus: 404 });
    const provider = new EurLexLawProvider(transport, createEuActIndexLanguageAuthorizer(index));
    await assert.rejects(
      () => provider.getSection({ ...baseReference, language: "fra" }),
      (error: unknown) =>
        error instanceof EuActLanguageExpressionUnavailableError
        && error.celex === "32016R0679"
        && error.language === "fra",
    );
    assert.equal(counts.notice, 1, "Notice still validated before content path");
    assert.equal(counts.content, 1, "no alternative-language fetch / fallback occurred");
  });
});
