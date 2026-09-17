# Denmark Retsinformation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Denmark support to European Law Lookup using official Retsinformation / ELI / LexDania sources while preserving the shared lookup lifecycle and fail-closed legal-time model.

**Architecture:** Denmark uses a local canonical-ELI discovery index populated from the official Retsinformation sitemap plus per-ELI JSON-LD metadata and exposed through the existing `LawDiscoveryProvider` seam. Concrete legal text is retrieved from canonical LexDania XML by `RetsinformationLawProvider`; mutable legal-currentness evidence is recorded through a DK-specific recorder into a separate resolver/store so the generic `LawProvider.getSection(): Promise<LawSection | null>` contract and the immutable section cache remain unchanged.

**Tech Stack:** TypeScript 5.7, Obsidian plugin API, `node:test` + `node:assert`, esbuild, ESLint, official Retsinformation ELI/JSON-LD/LexDania sources

**Spec:** `docs/superpowers/specs/2026-09-16-denmark-retsinformation-design.md`

**Plan baseline:** `main@e798046199e3cd2fd9a7b0a4054a03eeceda788b`

## Global Constraints

- Preserve the lifecycle: jurisdiction → autocomplete/discovery → explicit selection → visible selected state → reference entry → explicit lookup → preview → explicit insertion.
- DK autocomplete is local only, uses the shared `searchLawMetadata(...)` ranker, existing ~250 ms debounce/stale-result machinery, and max 8 results. No HTTP per keystroke.
- Official sources only: Retsinformation / ELI / LexDania. `retsinformation-api.dk` remains rejected.
- Canonical identity is `/eli/{pubMedia}/{year}/{number}`. Accepted bare identity forms are full canonical URL, canonical path, and abbreviated path; reject `year/number`, `LBK number/year`, and title-only identity.
- `LawReference.section` remains required. A bare ELI identity is never returned as an incomplete `LawReference` and never defaults to § 1.
- v1 references: explicit `§ N`, optional letter suffix such as `§ 9 a`, optional `stk.` such as `§ 1, stk. 2`.
- XML URL is `https://www.retsinformation.dk${canonicalEli}/xml`; JSON-LD URL is `https://www.retsinformation.dk${canonicalEli}.json`. Never duplicate the `/eli` path segment during URL construction.
- Validate LexDania structurally, not by `Content-Type` alone. Valid XML with `text/html` may be accepted after body validation; malformed/non-LexDania bodies fail closed.
- Bootstrap is sitemap index/pages → canonical ELI + exact sitemap `lastmod` → per-ELI official JSON-LD → validation → candidate → semantic read-back → atomic activation.
- Bootstrap is sequential, conservative, resumable and all-or-nothing. Required metadata failure never activates a partial index. Optional metadata stays nullable. No curated fallback.
- `saveCandidate` and `activateCandidate` are separate transitions; candidate equality is semantic, not count-only.
- Refresh timing is three separate contracts: incremental due at ≥24h; ordinary full reconciliation due at >31d; mandatory retention-gap recovery when persisted Atom watermark can no longer be bridged by available feed history (official feed history is at least 60 days).
- Failed Atom metadata acquisition cannot be skipped while advancing watermark beyond it. Atom ordering is deterministic by `(updated, id)`.
- `sitemapLastModified`, Atom `reasonForChange`/`changeDate`, and refresh timestamps are synchronization metadata only; they never create a legal-amendment/currentness assertion.
- Three owners stay separate: A) discovery index; B) immutable concrete-ELI legal-text cache; C) currentness resolver/store. Mutable currentness evidence never lives in B.
- Store C receives source-backed observations only from successful verified LexDania retrieval. Atom/sitemap changes may invalidate C but never create amendment evidence.
- Q5 remains OPEN/non-blocking. No latest-LBK claim, latest navigation, amendment synthesis, or lineage inference from ordering.
- Danish legal text only. No machine translation or silent language fallback.
- All 24 UI locales receive DK strings through the existing overlay architecture.
- No automatic commits. Every task ends at a controller checkpoint.

## Authoritative Decision Record

| Decision ID | Value |
|---|---|
| `DECISION_DISCOVERY` | `LOCAL_OFFICIAL_INDEX` |
| `DECISION_NETWORK_AUTOCOMPLETE` | `NO` |
| `DECISION_CURATED_FALLBACK` | `NO` |
| `DECISION_TEXT_SOURCE` | `OFFICIAL_LEXDANIA_XML` |
| `DECISION_IDENTITY` | `CANONICAL_ELI` |
| `DECISION_CURRENTNESS` | `LATEST_PROMULGATED_CONSOLIDATION_NOT_SYNTHETIC_CURRENT_STATE` |
| `DECISION_LANGUAGE` | `DA_ONLY` |
| `DECISION_UNOFFICIAL_API` | `REJECTED` |
| `DECISION_IMPLEMENTATION_MODE` | `SLICED_TDD` |
| `DECISION_BOOTSTRAP_ENUMERATION` | `ELI_SITEMAP` |
| `DECISION_BOOTSTRAP_METADATA` | `PER_ELI_JSON_LD` |
| `DECISION_BOOTSTRAP_ACCESS` | `CONSERVATIVE_SEQUENTIAL_RESUMABLE` |
| `DECISION_INCREMENTAL_REFRESH` | `DAILY_24H` |
| `DECISION_FULL_RECONCILIATION` | `MONTHLY_31D` |
| `DECISION_RETENTION_GAP` | `MANDATORY_FULL_RECONCILIATION` |
| `DECISION_LATEST_LBK` | `DISABLED_UNTIL_SOURCE_BACKED_LINEAGE` |

## Source Contracts Used by the Plan

- Canonical ELI: `https://www.retsinformation.dk/eli/{pubMedia}/{year}/{number}`.
- XML: canonical ELI + `/xml`.
- JSON-LD: canonical ELI + `.json`.
- Official ELI ontology property namespace: `http://data.europa.eu/eli/ontology#`.
- Retsinformation `type_document` authority values: `http://www.retsinformation.dk/eli/resource/authority/type_document#...`.
- Sitemap: `https://www.retsinformation.dk/eli/sitemap.xml`, entries contain `loc` and `lastmod`.
- Atom: `https://www.retsinformation.dk/eli/eli-update-feed.atom`, at least 60 days history.
- LexDania parsing may rely on audited/source-backed names: `Meta`, `DocumentType`, `AccessionNumber`, `DocumentId`, `UniqueDocumentId`, `DocumentTitle`, `Year`, `Number`, `DiesSigni`, `Status`, `PopularTitle`, `AnnouncedIn`, `StartDate`, `EndDate`, `Ministry`, `Change`, `Ref_Accn`, `Ref_Af`, `Ref_Text`, `DokumentIndhold`, `Paragraf/@localId`, `Stk`, and recursive text under source-backed nested structures such as `Index`, `Indentatio`, `Rubrica`. Production parsing must not depend on any unverified dedicated subsection-text leaf element.

## Native Test Command Convention

The repository uses the native `node:test` / `node:assert` pipeline. A focused cycle is:

```bash
rm -rf test-dist
npx tsc -p tsconfig.test.json
node --test test-dist/tests/<focused-file>.test.js
```

Tests import:

```typescript
import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
```

## Task Index

| Slice | Task | Deliverable |
|---|---:|---|
| DK-A | 1 | Jurisdiction type contracts |
| DK-A | 2 | Canonical ELI identity normalizer + explicit DK reference parser |
| DK-A | 3 | Concrete-ELI DK cache key |
| DK-B | 4 | HTTP response-header seam + bounded DK retry helper |
| DK-B | 5 | LexDania XML structural parser |
| DK-B | 6 | `RetsinformationLawProvider` + response identity + recorder seam |
| DK-C | 7 | Index schema + semantic A/B persistence |
| DK-C | 8 | Official JSON-LD graph parser |
| DK-C | 9 | Sitemap enumeration with `lastmod` |
| DK-C | 10 | Concrete bootstrap checkpoint persistence |
| DK-C | 11 | All-or-nothing bootstrap + corruption/rebuild behavior |
| DK-D | 12 | Atom feed parser + canonical event ordering |
| DK-D | 13 | Independent 24h / 31d schedule gates |
| DK-D | 14 | Durable incremental refresh + watermark semantics |
| DK-D | 15 | Selective full reconciliation + retention-gap recovery |
| DK-E | 16 | Currentness store/resolver + invalidation semantics |
| DK-E | 17 | Local discovery adapter using shared ranker |
| DK-E | 18 | Plugin data/storage/bootstrap/refresh lifecycle |
| DK-E | 19 | Provider composition wiring |
| DK-E | 20 | Modal identity injection / dropdown / currentness UI |
| DK-E | 21 | 24-locale DK i18n overlay |
| DK-F | 22 | Final regression/runtime/review gates |

---

# Slice DK-A — Contracts / Parser / Canonical Identity

### Task 1: Add DK to Jurisdiction Types

**Slice:** DK-A

**Files:**
- Modify: `src/law/types.ts`
- Modify: `src/law/lawMetadataSearch.ts`
- Modify: `src/law/providerComposition.ts`
- Modify: `src/ui/LawLookupModal.ts`
- Create/Test: `tests/dkTypes.test.ts`

The provider-composition and modal changes are compile/exhaustiveness bridges
required by the shared jurisdiction contracts, not activation of DK runtime
behavior. `providerComposition` receives an inert fail-closed `DK: []` entry;
Task 19 remains responsible for real DK provider registration. The
`JURISDICTION_EXAMPLES` record receives the already-approved inert DK example
only; Task 20 remains responsible for dropdown/UI exposure.

**Interfaces:**
- Produces: `LawJurisdiction` including `"DK"`.
- Produces: `LawMetadataJurisdiction` including `"DK"`.

- [ ] Write failing compile-time test:

```typescript
import type { LawMetadataJurisdiction } from "../src/law/lawMetadataSearch";
import type { LawJurisdiction } from "../src/law/types";
const jurisdiction: LawJurisdiction = "DK";
const metadataJurisdiction: LawMetadataJurisdiction = "DK";
void jurisdiction;
void metadataJurisdiction;
```

- [ ] Run RED: `rm -rf test-dist && npx tsc -p tsconfig.test.json`. Expected: `"DK"` is rejected by current unions.
- [ ] Add `"DK"` to both unions, add the inert `DK: []` provider-composition
  exhaustiveness bridge, and add the inert approved DK modal example; no
  other behavior.
- [ ] Run GREEN: `rm -rf test-dist && npx tsc -p tsconfig.test.json && node --test test-dist/tests/dkTypes.test.js`.
- [ ] Run neighboring parser/i18n tests after compilation.
- [ ] Run `npm run lint` and `git diff --check`.
- [ ] Fresh review gate: corrected six-file scope only; verify the two
  production unions, the inert provider-composition and modal compile bridges,
  and the test, with no runtime DK activation or Task 2 leakage.
- [ ] **Controller checkpoint: do not commit until explicit approval.**

### Task 2: Canonical ELI Identity Normalizer and Explicit DK Reference Parser

**Slice:** DK-A

**Files:**
- Create: `src/law/providers/retsinformationIdentity.ts`
- Modify: `src/parser.ts`
- Create/Test: `tests/dkParser.test.ts`

**Interfaces:**
- Produces `DkCanonicalEli { canonicalEli; pubMedia; year; number }`.
- Produces `parseDkCanonicalEli(input): DkCanonicalEli | null` for bare identity forms.
- `parseLawReferenceWithSelectedJurisdiction(input, "DK")` returns a `LawReference` only when an explicit § reference exists.

- [ ] Write failing tests:

```typescript
import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { parseDkCanonicalEli } from "../src/law/providers/retsinformationIdentity";
import { parseLawReferenceWithSelectedJurisdiction } from "../src/parser";

describe("DK identity/reference boundary", () => {
  it("normalizes bare identity but does not fabricate LawReference.section", () => {
    for (const input of [
      "https://www.retsinformation.dk/eli/lta/2014/433",
      "/eli/lta/2014/433",
      "lta/2014/433",
    ]) {
      assert.deepEqual(parseDkCanonicalEli(input), {
        canonicalEli: "/eli/lta/2014/433", pubMedia: "lta", year: "2014", number: "433",
      });
      assert.equal(parseLawReferenceWithSelectedJurisdiction(input, "DK"), null);
    }
  });

  it("accepts explicit paragraph, letter suffix and stk.", () => {
    assert.deepEqual(
      parseLawReferenceWithSelectedJurisdiction("/eli/lta/2014/433 § 1, stk. 2", "DK"),
      { lawCode: "/eli/lta/2014/433", section: "1", subsection: "stk. 2", referenceType: "section", jurisdiction: "DK" },
    );
    assert.deepEqual(
      parseLawReferenceWithSelectedJurisdiction("lta/2014/433 § 9 a", "DK"),
      { lawCode: "/eli/lta/2014/433", section: "9 a", referenceType: "section", jurisdiction: "DK" },
    );
  });

  it("rejects ambiguous identity forms", () => {
    for (const input of ["2014/433", "LBK 433/2014", "Forvaltningsloven"]) {
      assert.equal(parseDkCanonicalEli(input), null);
    }
  });
});
```

- [ ] Run RED with native compile. Expected: missing identity module/DK parser path.
- [ ] Implement `parseDkCanonicalEli` with full URL/path/abbreviated patterns; normalize to lowercase canonical path.
- [ ] Implement `parseDkLawReference` in `src/parser.ts`: split explicit `§`, normalize optional spaced letter suffix to `"9 a"`, optional subsection to `"stk. N"`, then call `parseDkCanonicalEli` for the identity part. Bare identity returns `null` from the LawReference parser.
- [ ] Dispatch `selectedJurisdiction === "DK"` before generic parsing.
- [ ] Run GREEN: `rm -rf test-dist && npx tsc -p tsconfig.test.json && node --test test-dist/tests/dkParser.test.js test-dist/tests/parser.test.js`.
- [ ] Run `npm run lint` and `git diff --check`.
- [ ] Fresh review gate: no incomplete/fabricated `LawReference` and `§ 9 a` is covered.
- [ ] **Controller checkpoint: do not commit until explicit approval.**

### Task 3: Canonical DK Legal-Text Cache Key

**Slice:** DK-A

**Files:**
- Modify: `src/law/LawSectionCache.ts`
- Create/Test: `tests/dkCacheKey.test.ts`

**Interfaces:**
- Consumes canonical DK `LawReference`.
- Produces `DK:<canonical-eli>:<section>[:<subsection>]` in lowercase.
- DK read path uses only the DK canonical key; no DE legacy/source-variant fallback.

- [ ] Write failing `node:test` assertions for `/eli/lta/2014/433`, uppercase input normalization, and `stk. 2`.
- [ ] Run RED with native compile + focused test.
- [ ] Add DK branch before generic fallback and add DK to `cacheKeysForRead` single-key jurisdictions.
- [ ] Run GREEN plus existing `LawSectionCache` tests.
- [ ] Run `npm run lint` and `git diff --check`.
- [ ] Fresh review gate: no moving `latest/current` cache alias.
- [ ] **Controller checkpoint: do not commit until explicit approval.**


---

# Slice DK-B — Retsinformation Provider + Structural Reference Extraction

### Task 4: Response-Header Seam and Bounded DK Retry Helper

**Slice:** DK-B

**Files:**
- Modify: `src/law/httpTransport.ts`
- Create: `src/law/providers/retsinformationHttp.ts`
- Create/Test: `tests/httpTransportHeaders.test.ts`
- Create/Test: `tests/retsinformationHttp.test.ts`

**Interfaces:**
- Extend `LawProviderHttpResponse` with optional `headers?: Record<string, string>`.
- Extend local `RequestUrlResponseLike` with the same optional headers.
- `createObsidianRequestUrlTransport(...)` forwards `response.headers` without changing current call sites.
- Produce `requestRetsinformationWithRetry(fetchFn, url, options): Promise<LawProviderHttpResponse>`.

- [ ] Write failing transport test:

```typescript
import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { createObsidianRequestUrlTransport } from "../src/law/httpTransport";

describe("requestUrl response headers", () => {
  it("preserves Retry-After", async () => {
    const transport = createObsidianRequestUrlTransport(async () => ({
      status: 429,
      text: "",
      json: null,
      headers: { "retry-after": "3" },
    }));
    const response = await transport("https://example.invalid");
    assert.equal(response.headers?.["retry-after"], "3");
  });
});
```

- [ ] In `tests/retsinformationHttp.test.ts`, define an in-file scripted transport helper that returns a chosen status sequence and exposes call count. Test: 429 retries; 503 retries; non-retryable 4xx fails immediately; `Retry-After: 3` results in injected `sleep(3000)`; absent header uses bounded delays `[500, 1000, 2000]`; maximum total attempts is 4; network exceptions retry with the same bound.
- [ ] Run RED: `rm -rf test-dist && npx tsc -p tsconfig.test.json`. Expected: headers/retry helper missing.
- [ ] Extend both local response interfaces and return `headers: response.headers` in `createObsidianRequestUrlTransport`.
- [ ] Implement `requestRetsinformationWithRetry`: retry only network exceptions, HTTP 429 and 503; honor integer-second `Retry-After`; otherwise use 500/1000/2000 ms; 4 total attempts; injected `sleep` for tests; no parallel fan-out.
- [ ] Run GREEN: compile, then `node --test test-dist/tests/httpTransportHeaders.test.js test-dist/tests/retsinformationHttp.test.js`.
- [ ] Run existing HTTP transport tests, `npm run lint`, `git diff --check`.
- [ ] Fresh review gate: no unrelated provider behavior changes; no numeric ELI rate limit invented.
- [ ] **Controller checkpoint: do not commit until explicit approval.**

### Task 5: LexDania XML Structural Parser

**Slice:** DK-B

**Files:**
- Create: `src/law/providers/retsinformationLexDania.ts`
- Create/Test: `tests/retsinformationLexDania.test.ts`

**Interfaces:**
- Produce `LexDaniaDocument`, `LexDaniaChangeEvidence`, `LexDaniaParagraph`.
- Produce `parseLexDaniaXml(xml: string): LexDaniaDocument | null`.
- Produce `findLexDaniaReference(document, section, subsection): { text: string } | null`.
- Text extraction is recursive under `Paragraf`/`Stk`; production code must not depend on unverified leaf tag names.

- [ ] Write failing tests using only source-backed names. Use a minimal XML fixture with `Dokument`, `Meta`, the audited metadata element names, `DokumentIndhold`, `Paragraf localId`, `Stk`, and recursive `Rubrica`/`Index`/`Indentatio` text. Do not introduce an unverified dedicated subsection-text leaf element.
- [ ] The fixture must cover: `DocumentType`, `AccessionNumber`, `DocumentId`, `UniqueDocumentId`, `DocumentTitle`, `PopularTitle`, `Year`, `Number`, `DiesSigni`, `Status`, `StartDate`, `EndDate`, `Ministry`, one `<Change>` with `Ref_Accn`/`Ref_Af`/`Ref_Text`, paragraph `§1` with two `Stk`, and `§9 a`.
- [ ] Assert metadata extraction, `Change` extraction, §1 combined text, `§1, stk. 2`, `§9 a`, missing § → `null`, missing stk. → `null`, malformed XML → `null`, HTML/non-LexDania → `null`.
- [ ] Run RED with native compile + focused test.
- [ ] Implement a namespace-tolerant XML tree parser following existing repository parser style. Require `Dokument` root, `Meta` and `DokumentIndhold`; parse only known metadata names. Build paragraph records from `Paragraf/@localId`. For subsection selection, use direct `Stk` child order unless a verified source-backed identifier exists. `nodeText(...)` recursively joins descendant text.
- [ ] Normalize only explicit paragraph ID forms needed by source evidence/tests (`§1`, `§ 1`, `§9 a`, `§ 9 a`); do not fuzzy-guess arbitrary identifiers.
- [ ] Run GREEN for `retsinformationLexDania.test.js`.
- [ ] Run `npm run lint`, `git diff --check`.
- [ ] Fresh review gate: no invented XML leaf dependency; only LexDania `<Change>` is legal amendment evidence.
- [ ] **Controller checkpoint: do not commit until explicit approval.**

### Task 6: RetsinformationLawProvider, Response Identity, and Recorder Seam

**Slice:** DK-B

**Files:**
- Create: `src/law/providers/RetsinformationLawProvider.ts`
- Create/Test: `tests/RetsinformationLawProvider.test.ts`

**Interfaces:**
- Implements unchanged `LawProvider.getSection(reference: LawReference): Promise<LawSection | null>`.
- Consumes `parseDkCanonicalEli`, `requestRetsinformationWithRetry`, `parseLexDaniaXml`, `findLexDaniaReference`.
- Produces DK-specific recorder contract for Store C:

```typescript
export interface RetsinformationCurrentnessObservation {
  canonicalEli: string;
  documentType: string | null;
  documentDate: string | null;
  sourceStatus: string | null;
  changes: readonly LexDaniaChangeEvidence[];
  observedAt: string;
}

export interface RetsinformationCurrentnessRecorder {
  record(observation: RetsinformationCurrentnessObservation): Promise<void> | void;
}
```

- Constructor contract: `new RetsinformationLawProvider(fetchFn, recorder?, now?, origin?)`.

- [ ] In the test file, define `response(status, body, headers?)` returning a full `LawProviderHttpResponse` fake.
- [ ] Write RED assertions for exact URL `https://www.retsinformation.dk/eli/lta/2014/433/xml`; 404 → `null`; network/retry exhaustion → `LawProviderUnavailableError`; malformed body → `null`; valid LexDania accepted even with `content-type: text/html`; missing §/stk. → `null`; success returns DK/da/official/authoritative `LawSection`.
- [ ] Write pubMedia admission RED: `/eli/lta/2014/433` is admitted to retrieval; a syntactically valid canonical ELI with non-`lta` `pubMedia` returns `null` with zero fetches; no XML `pubMedia` field is invented or parsed; LexDania `DocumentType` validation remains a separate check against supported `LOV`/`LOVH` and `LBK`/`LBKH` values.
- [ ] Write identity RED: requested `/eli/lta/2014/433` with response `Year=2020` or `Number=999` returns `null` and records no observation. The request-side `pubMedia` gate is independent of response `DocumentType` validation.
- [ ] Write recorder RED: successful verified retrieval records exactly one observation containing source status, document date and LexDania `<Change>` evidence; invalid/malformed/mismatched retrieval records none.
- [ ] Write recorder-failure RED: a synchronous recorder throw and a rejected recorder Promise both leave an otherwise verified `LawSection` usable; neither is mapped to `LawProviderUnavailableError`, and neither yields a currentness-success claim.
- [ ] Run RED with native compile + focused test.
- [ ] Implement provider URL as `${origin}${identity.canonicalEli}/xml`; never append a second `/eli`.
- [ ] Validate supported canonical identity, request-side `pubMedia === "lta"`, response year/number and supported source `DocumentType` (`LOV`/`LOVH` or `LBK`/`LBKH`) before reference extraction. Return `null` for structural/identity/reference absence; throw `LawProviderUnavailableError` only for provider/network unavailability.
- [ ] Record currentness observation only after successful response identity validation and LexDania parse. Treat synchronous or Promise recorder failure as ancillary best-effort failure: preserve the verified `LawSection`, leave currentness unavailable/unverified, make no currentness/amendment/latest-LBK claim, and do not change `LawProvider` or `LawSection` types.
- [ ] Run GREEN for provider + LexDania + retry tests and relevant ProviderRegistry tests.
- [ ] Run `npm run lint`, `git diff --check`.
- [ ] Fresh review gate: currentness leaves the provider only via recorder; generic provider contract stays unchanged.
- [ ] **Controller checkpoint: do not commit until explicit approval.**


---

# Slice DK-C — Discovery Index Storage / Schema / Bootstrap

### Task 7: Index Schema and Semantic A/B Persistence

**Slice:** DK-C

**Files:**
- Create: `src/law/providers/RetsinformationDiscoveryIndex.ts`
- Create: `src/law/providers/RetsinformationDiscoveryIndexStorage.ts`
- Create/Test: `tests/dkDiscoveryIndexStorage.test.ts`

**Interfaces:**

```typescript
export interface RetsinformationIndex {
  schemaVersion: 1;
  source: "retsinformation-eli";
  generatedAt: string;
  lastSuccessfulRefresh: string | null;
  lastSuccessfulIncrementalRefresh: string | null;
  lastSuccessfulFullReconciliation: string | null;
  feedWatermark: string | null;
  entries: RetsinformationIndexEntry[];
}

export interface RetsinformationIndexEntry {
  canonicalEli: string;
  popularTitle: string | null;
  documentTitle: string;
  documentType: string;
  pubMedia: string;
  year: string;
  number: string;
  status: string | null;
  startDate: string | null;
  endDate: string | null;
  changeDate: string | null;
  accessionNumber: string | null;
  ministry: string | null;
  announcedIn: string | null;
  sourceUpdateTimestamp: string | null;
  sitemapLastModified: string | null;
}
```

- Produces `parseStoredRetsinformationIndex(raw: unknown): RetsinformationIndex` that throws on malformed/incompatible schema.
- Produces `RetsinformationDiscoveryIndexStorage` with `loadActive`, `loadCandidate`, `saveCandidate`, `activateCandidate`, `discardCandidate`.
- Adds the separate incremental/full timestamps required by Q4 while retaining spec field `lastSuccessfulRefresh`.

- [ ] Write failing A/B tests with an in-file memory adapter implementing `exists/read/write/remove` and in-file metadata persistence.
- [ ] Assert initial `loadActive()` is `null`; `saveCandidate(index)` does not alter active; `loadCandidate()` equals intended candidate; `activateCandidate(index)` promotes only the semantically equal candidate; corrupt read-back rejects; mismatched candidate rejects; schema mismatch rejects; `discardCandidate()` leaves active unchanged.
- [ ] Run RED with native pipeline.
- [ ] Implement strict persisted-index parser and semantic equality across every index metadata field and every entry field in deterministic `canonicalEli` order. Never validate only schema/count.
- [ ] Implement A/B storage with serialized mutation tail, inactive-slot writes, read-back parse/equality, explicit candidate metadata, intended-candidate equality on activation, and safe discard.
- [ ] Run GREEN for storage tests plus existing `EuActIndexFileStorage` tests.
- [ ] Run `npm run lint`, `git diff --check`.
- [ ] Fresh review gate: candidate write and activation remain distinct.
- [ ] **Controller checkpoint: do not commit until explicit approval.**

### Task 8: Official ELI JSON-LD Graph Parser

**Slice:** DK-C

**Files:**
- Modify: `src/law/providers/RetsinformationDiscoveryIndex.ts`
- Create/Test: `tests/dkJsonLdParser.test.ts`

**Interfaces:**
- Produces `parseRetsinformationJsonLd(json, canonicalEli, observedAt): Omit<RetsinformationIndexEntry, "sitemapLastModified"> | null`.
- Supports a top-level JSON-LD array or an object with `@graph`.
- Uses official ELI namespace `http://data.europa.eu/eli/ontology#` and Retsinformation authority values.

- [ ] Write failing fixture using exact official ontology URIs, not a guessed namespace:

```typescript
const ELI = "http://data.europa.eu/eli/ontology#";
const resourceId = "https://www.retsinformation.dk/eli/lta/2014/433";
const fixture = JSON.stringify([
  {
    "@id": resourceId,
    "@type": `${ELI}LegalResource`,
    [`${ELI}number`]: [{ "@value": "433" }],
    [`${ELI}type_document`]: [{ "@id": "http://www.retsinformation.dk/eli/resource/authority/type_document#LBKH" }],
    [`${ELI}responsibility_of`]: [{ "@value": "Justitsministeriet" }],
    [`${ELI}id_local`]: [{ "@value": "A20140043329" }],
  },
  {
    "@id": `${resourceId}/dan`,
    "@type": `${ELI}LegalExpression`,
    [`${ELI}realizes`]: [{ "@id": resourceId }],
    [`${ELI}title`]: [{ "@value": "Bekendtgørelse af forvaltningsloven" }],
    [`${ELI}title_alternative`]: [{ "@value": "Forvaltningsloven" }],
  },
]);
```

- [ ] Test required source identity/title/type; optional alternative title/responsibility/in-force/id-local/changed_by/consolidates absent without failure; mismatched resource `@id` returns `null`; missing title/type returns `null`; object `@graph` form works.
- [ ] Run RED.
- [ ] Implement helpers `jsonLdNodes`, `hasJsonLdType`, `jsonLdStrings`, `jsonLdIds` to normalize primitive/array/`@value`/`@id` representations.
- [ ] Select the `LegalResource` whose `@id` equals `https://www.retsinformation.dk${canonicalEli}` and a `LegalExpression` whose `realizes` references that resource. Derive pubMedia/year/number only from `parseDkCanonicalEli(canonicalEli)` and cross-check source number when present.
- [ ] Map optional source metadata only when present. ELI relations stay discovery/source metadata, not Store C amendment evidence.
- [ ] Run GREEN for JSON-LD tests.
- [ ] Run `npm run lint`, `git diff --check`.
- [ ] Fresh review gate: no fabricated namespace, no duplicated `/eli` path segment, optional fields remain nullable.
- [ ] **Controller checkpoint: do not commit until explicit approval.**

### Task 9: Sitemap Enumeration with Exact `lastmod`

**Slice:** DK-C

**Files:**
- Create: `src/law/providers/RetsinformationSitemap.ts`
- Create/Test: `tests/dkSitemap.test.ts`

**Interfaces:**

```typescript
export interface RetsinformationSitemapEntry {
  canonicalEli: string;
  sitemapLastModified: string | null;
}
```

- Produces `enumerateRetsinformationSitemap(fetchFn, options): Promise<RetsinformationSitemapEntry[]>`.
- Consumes `requestRetsinformationWithRetry` and `parseDkCanonicalEli`.

- [ ] Write failing tests with one sitemap index referencing two page URLs and page fixtures containing `<url><loc>...<lastmod>...</lastmod></url>` entries.
- [ ] Assert exact `lastmod` preservation, canonicalization, deterministic sort by `canonicalEli`, rejection of foreign/noncanonical entries, and page-fetch failure propagation rather than silently returning an incomplete set.
- [ ] Run RED.
- [ ] Implement sequential enumeration: fetch official sitemap index, parse referenced page URLs, fetch pages one at a time through bounded retry, parse each URL record, normalize only valid canonical Retsinformation ELI resources, sort deterministically.
- [ ] Run GREEN for sitemap tests.
- [ ] Run `npm run lint`, `git diff --check`.
- [ ] Fresh review gate: `sitemapLastModified` is verbatim synchronization evidence only.
- [ ] **Controller checkpoint: do not commit until explicit approval.**

### Task 10: Concrete Bootstrap Checkpoint Persistence

**Slice:** DK-C

**Files:**
- Modify: `src/law/providers/RetsinformationDiscoveryIndexStorage.ts`
- Create/Test: `tests/dkBootstrapCheckpoint.test.ts`

**Interfaces:**

```typescript
export interface RetsinformationBootstrapCheckpoint {
  schemaVersion: 1;
  startedAt: string;
  sitemapEntries: RetsinformationSitemapEntry[];
  nextEntryIndex: number;
  validatedEntries: RetsinformationIndexEntry[];
}
```

- Adds `loadBootstrapCheckpoint()`, `saveBootstrapCheckpoint(checkpoint)`, `clearBootstrapCheckpoint()`.
- Uses dedicated `${baseDir}/dk-discovery-bootstrap.json`; checkpoint state is never active discovery state.

- [ ] Write failing round-trip, malformed/schema-mismatch, failed-write, clear, `nextEntryIndex` bounds, and “validated identity belongs to already processed sitemap prefix” tests with the same memory adapter pattern.
- [ ] Run RED.
- [ ] Implement a strict checkpoint parser and serialized checkpoint writes using the existing storage mutation tail.
- [ ] Run GREEN for checkpoint + A/B storage tests.
- [ ] Run `npm run lint`, `git diff --check`.
- [ ] Fresh review gate: resumability is persisted data, not an in-memory promise/comment.
- [ ] **Controller checkpoint: do not commit until explicit approval.**

### Task 11: All-or-Nothing Bootstrap and Corruption/Rebuild Behavior

**Slice:** DK-C

**Files:**
- Create: `src/law/providers/RetsinformationBootstrap.ts`
- Create/Test: `tests/dkBootstrap.test.ts`

**Interfaces:**
- Produces `bootstrapRetsinformationIndex(storage, fetchFn, options): Promise<RetsinformationIndex>`.
- Consumes sitemap enumeration, JSON-LD parser, checkpoint persistence, semantic A/B storage and bounded retry.
- Metadata URL builder is exactly `https://www.retsinformation.dk${canonicalEli}.json`.

- [ ] In the test file, define a complete scripted transport map for exact sitemap/index/page/`.json` URLs and request counts.
- [ ] Test clean bootstrap; optional JSON-LD fields absent; required metadata failure on item N rejects and leaves previous active unchanged; no prior active remains unavailable; interrupted run resumes from checkpoint without refetching prior validated metadata; candidate activates only after every enumerated identity is validated; successful activation clears checkpoint; malformed/schema-incompatible active state is rejected and caller can initiate fresh bootstrap.
- [ ] Run RED.
- [ ] Implement bootstrap: load valid checkpoint or enumerate complete sitemap and persist a new checkpoint; sequentially fetch each pending `.json`; on every successful parse append entry with that sitemap item's exact `sitemapLastModified`, advance `nextEntryIndex`, save the checkpoint before continuing. Required acquisition/validation failure throws.
- [ ] When complete, build full candidate, `saveCandidate`, `activateCandidate(candidate)`, clear checkpoint, then return active candidate. Never activate an incomplete candidate.
- [ ] Set `generatedAt` and `lastSuccessfulRefresh` on success. Keep incremental/full timestamps and feed watermark null unless the implementation explicitly and consistently treats bootstrap as a full reconciliation; if so, encode that choice in tests and one place only.
- [ ] Run GREEN for bootstrap + checkpoint + storage + JSON-LD + sitemap tests.
- [ ] Run `npm run lint`, `git diff --check`.
- [ ] Fresh review gate: all-or-nothing, resumable, sequential, no curated fallback.
- [ ] **Controller checkpoint: do not commit until explicit approval.**


---

# Slice DK-D — Atom Incremental Refresh + Reconciliation

### Task 12: Atom Feed Parser and Canonical Event Ordering

**Slice:** DK-D

**Files:**
- Create: `src/law/providers/RetsinformationAtom.ts`
- Create/Test: `tests/dkAtom.test.ts`

**Interfaces:**

```typescript
export interface RetsinformationAtomEntry {
  id: string; // normalized canonical ELI path
  updated: string;
  title: string;
  reasonForChange: string | null;
  changeDate: string | null;
}
```

- Produces `parseRetsinformationAtom(xml): RetsinformationAtomEntry[]`.
- Produces deterministic `compareAtomEntries(a, b)`.
- Produces opaque string watermark helpers `atomWatermark(entry)` and `parseAtomWatermark(token)` encoding `(updated, id)`.

- [ ] Write failing tests: absolute Retsinformation URL and canonical path IDs both normalize to `/eli/...`; foreign/noncanonical IDs are rejected; duplicate `(updated,id)` entries deduplicate; output sorts ascending by `updated` then `id`; `reasonForChange` and `changeDate` are preserved as sync metadata; watermark round-trips exactly.
- [ ] Run RED with native pipeline.
- [ ] Implement namespace-tolerant Atom parsing and deterministic sort/dedup. Do not expose any legal-amendment/currentness boolean.
- [ ] Run GREEN for `dkAtom.test.js`.
- [ ] Run `npm run lint`, `git diff --check`.
- [ ] Fresh review gate: Atom is synchronization evidence only.
- [ ] **Controller checkpoint: do not commit until explicit approval.**

### Task 13: Independent 24h and 31d Schedule Gates

**Slice:** DK-D

**Files:**
- Create: `src/law/providers/RetsinformationRefreshSchedule.ts`
- Create/Test: `tests/dkRefreshSchedule.test.ts`

**Interfaces:**
- Produces `isIncrementalRefreshDue(lastSuccessfulIncrementalRefresh, now): boolean`.
- Produces `isOrdinaryFullReconciliationDue(lastSuccessfulFullReconciliation, now): boolean`.
- These helpers do not inspect Atom retention and do not conflate it with the 31-day cadence.

- [ ] Write exact boundary RED tests: `<24h` false, `=24h` true, `>24h` true, null/invalid due; `<=31d` false, `>31d` true, null/invalid due.
- [ ] Run RED.
- [ ] Implement separate constants/functions for 24 hours and 31 days.
- [ ] Run GREEN for schedule tests.
- [ ] Run `npm run lint`, `git diff --check`.
- [ ] Fresh review gate: no retention constant is set to 31 days.
- [ ] **Controller checkpoint: do not commit until explicit approval.**

### Task 14: Durable Incremental Refresh and Watermark Semantics

**Slice:** DK-D

**Files:**
- Create: `src/law/providers/RetsinformationRefresh.ts`
- Create/Test: `tests/dkIncrementalRefresh.test.ts`

**Interfaces:**
- Produces `performRetsinformationIncrementalRefresh(storage, fetchFn, options): Promise<{ processedCount: number; feedWatermark: string | null }>`.
- `options` includes injected `now`, `sleep`, and optional `onSourceChanged(canonicalEli, observedAt)` invalidation callback.
- Consumes Atom parser, JSON-LD parser, A/B storage, retry helper, 24h schedule helper.

- [ ] In the test file define a complete exact-URL scripted transport plus helper that seeds active index through `saveCandidate` + `activateCandidate`.
- [ ] Write RED cases: <24h returns without network; due refresh fetches Atom; replay is idempotent; existing/new ELI revalidates via `.json`; duplicate event does not duplicate entry; metadata failure rejects and leaves active index + watermark unchanged; if first of two events fails, watermark does not pass it; source-changed callback fires only for successfully processed source events.
- [ ] Run RED.
- [ ] Implement incremental refresh: parse/sort events; select events strictly after parsed watermark; clone active index; process sequentially; fail whole candidate on first required metadata failure; update/add entries deterministically.
- [ ] Persist `lastSuccessfulIncrementalRefresh`, `lastSuccessfulRefresh` and final watermark inside the candidate before `saveCandidate`/`activateCandidate`. Do not write watermark in a separate later mutation.
- [ ] Run GREEN for incremental + Atom + schedule tests.
- [ ] Run `npm run lint`, `git diff --check`.
- [ ] Fresh review gate: no failed event can be skipped by advancing the watermark; replay remains safe.
- [ ] **Controller checkpoint: do not commit until explicit approval.**

### Task 15: Selective Full Reconciliation and Retention-Gap Recovery

**Slice:** DK-D

**Files:**
- Modify: `src/law/providers/RetsinformationRefresh.ts`
- Create/Test: `tests/dkFullReconciliation.test.ts`
- Create/Test: `tests/dkRetentionGap.test.ts`

**Interfaces:**
- Produces `performRetsinformationFullReconciliation(...)`.
- Produces `atomHistoryBridgesWatermark(feedEntries, feedWatermark): boolean` using actual available feed history and exact persisted watermark; no 31-day shortcut.
- Full reconciliation compares incoming `{canonicalEli, sitemapLastModified}` to stored `{canonicalEli, sitemapLastModified}`.

- [ ] Write selective reconciliation RED: unchanged identity+lastmod performs zero `.json` request; new identity fetches `.json`; changed lastmod fetches `.json`; required metadata failure preserves old active; successful candidate stores incoming lastmod; absent-from-current-sitemap local entries are not silently deleted without a separately approved deletion contract.
- [ ] Write ordinary cadence RED proving full reconciliation is due only >31 days since `lastSuccessfulFullReconciliation`.
- [ ] Write retention-gap RED: exact persisted watermark present in returned feed is bridgeable; watermark older than oldest available returned event and absent from feed is not bridgeable and mandates full reconciliation immediately. This check is independent of ordinary 31-day cadence. Treat “at least 60 days” as an official source guarantee, not as a legal-currentness TTL.
- [ ] Run RED.
- [ ] Implement selective full reconciliation sequentially through sitemap + per-ELI metadata only for new/changed lastmod. Persist `lastSuccessfulFullReconciliation`, `lastSuccessfulRefresh`, and new sitemap lastmod values only in the durable activated candidate.
- [ ] Call `onSourceChanged` only for new/changed source identities so Store C can invalidate; do not create amendment evidence from that callback.
- [ ] Implement mandatory recovery orchestration: when available Atom history cannot bridge the persisted watermark, run full reconciliation before any watermark advancement. After a successful mandatory full reconciliation has rebuilt current index state, set `feedWatermark` to the deterministic high-water mark of the same fetched Atom snapshot inside the durable reconciliation candidate; if reconciliation fails, keep the old active index and old watermark unchanged. Add both success/failure assertions.
- [ ] Run GREEN for full reconciliation + retention-gap + schedule + incremental tests.
- [ ] Run `npm run lint`, `git diff --check`.
- [ ] Fresh review gate: 24h, >31d, and retention-gap remain three distinct semantics.
- [ ] **Controller checkpoint: do not commit until explicit approval.**


---

# Slice DK-E — Currentness / Discovery / Main / Modal / I18n

### Task 16: Store C — Currentness Resolver and Invalidation

**Slice:** DK-E

**Files:**
- Create: `src/law/providers/RetsinformationCurrentness.ts`
- Create/Test: `tests/dkCurrentness.test.ts`

**Interfaces:**
- Implements `RetsinformationCurrentnessRecorder` from Task 6.
- Produces `RetsinformationCurrentnessResolver` with `record`, `invalidate`, `resolve`.
- No arbitrary age TTL. Freshness is evidence-order based: an observation is fresh when it exists and no later invalidation exists for that canonical ELI.

```typescript
export interface StoredRetsinformationCurrentnessEntry {
  canonicalEli: string;
  documentType: string | null;
  documentDate: string | null;
  sourceStatus: string | null;
  changes: RetsinformationChangeEvidence[];
  observedAt: string;
  invalidatedAt: string | null;
}

export interface StoredRetsinformationCurrentnessState {
  entries: Record<string, StoredRetsinformationCurrentnessEntry>;
}

export type RetsinformationCurrentnessView =
  | { state: "unavailable" }
  | { state: "stale"; documentDate: string | null }
  | {
      state: "fresh";
      documentType: string | null;
      documentDate: string | null;
      sourceStatus: string | null;
      changes: readonly RetsinformationChangeEvidence[];
    };
```

- [ ] Write failing tests: `record` stores a source-backed observation; later `invalidate` makes it stale; a newer subsequent `record` makes it fresh again; unknown identity resolves `unavailable`; invalidation API has no way to add `changes`; only recorder observation supplies LexDania `<Change>` evidence; serialization round-trip preserves state.
- [ ] Run RED.
- [ ] Implement resolver with injected persistence callbacks `read(): StoredRetsinformationCurrentnessState` and `save(next): Promise<void>`. `record` canonicalizes key and writes observation. `invalidate(canonicalEli, invalidatedAt)` only moves invalidation timestamp forward. `resolve` compares `observedAt` vs `invalidatedAt`; no 60-day freshness constant exists.
- [ ] Run GREEN for currentness tests.
- [ ] Run `npm run lint`, `git diff --check`.
- [ ] Fresh review gate: Store C is sole mutable currentness owner; legal-text cache type remains unchanged.
- [ ] **Controller checkpoint: do not commit until explicit approval.**

### Task 17: Local RetsinformationLawDiscovery Using Shared Ranker

**Slice:** DK-E

**Files:**
- Create: `src/law/providers/RetsinformationLawDiscovery.ts`
- Create/Test: `tests/RetsinformationLawDiscovery.test.ts`

**Interfaces:**
- Implements `LawDiscoveryProvider` with `jurisdiction = "DK"` and `sourceLabel = "Retsinformation / LexDania"`.
- Constructor: `new RetsinformationLawDiscovery(getIndex: () => RetsinformationIndex | null, getState: () => "ready" | "initializing" | "unavailable")`.
- Produces `RetsinformationDiscoveryInitializingError` for the explicit initializing state; throws existing `LawDiscoveryUnavailableError` when no usable index exists and state is unavailable.
- Maps index entries to `LawMetadataSearchEntry[]` then calls `searchLawMetadata({ query, jurisdiction: "DK", entries, limit: 8 })`.

- [ ] In the test file define a typed `makeIndex(entries)` helper that fills all non-entry index fields with deterministic values.
- [ ] Write failing tests: popular-title match, official-title alternate match, shared rank order, exact max-8 cap, short query no-results, null index + `initializing` throws `RetsinformationDiscoveryInitializingError`, null index + `unavailable` throws `LawDiscoveryUnavailableError`, and constructor has no HTTP dependency.
- [ ] Run RED.
- [ ] Implement adapter mapping `popularTitle ?? documentTitle` to `title`, the other title to `alternateTitles`, canonical ELI to `canonicalInput`, and official URL to `sourceUrl`. Delegate ranking and cap to `searchLawMetadata`; do not implement a parallel substring ranker.
- [ ] Run GREEN plus existing lawMetadataSearch tests.
- [ ] Run `npm run lint`, `git diff --check`.
- [ ] Fresh review gate: autocomplete path performs zero network requests.
- [ ] **Controller checkpoint: do not commit until explicit approval.**

### Task 18: Main Plugin Data, Storage, Bootstrap and Refresh Lifecycle

**Slice:** DK-E

**Files:**
- Modify: `src/main.ts`
- Create/Test: `tests/dkMainLifecycle.test.ts`

**Interfaces:**
- Extend `DeLawPluginData` with `dkDiscoveryIndexStore?: RetsinformationIndexStoreMetadata` and `dkCurrentnessState?: StoredRetsinformationCurrentnessState`.
- Add fields:
  - `private dkDiscoveryIndex: RetsinformationIndex | null = null`
  - `private dkDiscoveryIndexStorage!: RetsinformationDiscoveryIndexStorage`
  - `private dkDiscoveryState: "ready" | "initializing" | "unavailable" = "unavailable"`
  - `private readonly dkDiscoveryRefreshSingleFlight = new AsyncSingleFlight<void>()`
  - `private dkCurrentnessResolver!: RetsinformationCurrentnessResolver`
- Add exact private methods:
  - `createDkDiscoveryIndexStorage(): RetsinformationDiscoveryIndexStorage`
  - `loadDkDiscoveryIndex(storage): Promise<RetsinformationIndex | null>`
  - `createDkCurrentnessResolver(): RetsinformationCurrentnessResolver`
  - `refreshDkDiscoveryIndexIfNeeded(): Promise<void>`
  - `refreshDkDiscoveryIndex(): Promise<void>`
- Modal discovery map uses `new RetsinformationLawDiscovery(() => this.dkDiscoveryIndex, () => this.dkDiscoveryState)`. Do not introduce an undefined index getter; the discovery provider closes over concrete plugin fields.

- [ ] Write failing lifecycle tests following existing mocked-plugin patterns. Assert DK storage/resolver are initialized before registry rebuild, last valid active index loads with state `ready`, discovery provider closes over `dkDiscoveryIndex` + `dkDiscoveryState`, no-active-index transitions `unavailable → initializing → ready` on successful background bootstrap, failed first bootstrap transitions to `unavailable`, active index uses 24h/31d/retention-gap logic, refresh failure preserves last active index/state `ready`, and currentness persistence uses serialized `mutatePluginData` writes.
- [ ] Run RED.
- [ ] Implement DK storage in plugin directory via vault adapter, with metadata persistence through `mutatePluginData`.
- [ ] Implement currentness resolver persistence through `dkCurrentnessState` in plugin data.
- [ ] Startup order: load plugin data/settings → create currentness resolver → create/load DK index storage → set `dkDiscoveryState` from load result → rebuild provider registry → add DK discovery provider to modal map → schedule `void this.refreshDkDiscoveryIndexIfNeeded()`. Set `initializing` before a first bootstrap and `ready` only after validated activation/reload.
- [ ] Implement refresh under `AsyncSingleFlight`: no active index → bootstrap; otherwise run due incremental and mandatory retention-gap recovery; ordinary full reconciliation only when >31d. After success reload active index into `this.dkDiscoveryIndex`.
- [ ] Pass `onSourceChanged: (eli, at) => this.dkCurrentnessResolver.invalidate(eli, at)` into incremental/full reconciliation.
- [ ] Run GREEN for lifecycle tests and neighboring EU index-storage/main tests.
- [ ] Run `npm run lint`, `git diff --check`.
- [ ] Fresh review gate: no startup secrets/auth, no per-keystroke network, last valid index survives failed refresh.
- [ ] **Controller checkpoint: do not commit until explicit approval.**

### Task 19: Provider Composition Wiring

**Slice:** DK-E

**Files:**
- Modify: `src/law/providerComposition.ts`
- Modify: `src/law/cachedProviderComposition.ts` only if verified explicit provider-ID allowlist requires DK
- Modify: `src/main.ts`
- Create/Test: `tests/dkProviderComposition.test.ts`

**Interfaces:**
- Adds `DK: ["retsinformation"]` to `PROVIDER_IDS_BY_JURISDICTION`.
- Extends `ProviderCompositionOptions` with `retsinformationCurrentnessRecorder?: RetsinformationCurrentnessRecorder`.
- `buildLawProviders` instantiates `RetsinformationLawProvider` with shared HTTP transport and injected recorder.
- Main `rebuildProviderRegistry()` supplies `this.dkCurrentnessResolver` as recorder.

- [ ] Write failing composition tests with a no-network transport. Assert build contains exactly one provider id `retsinformation`; `providersForReference` selects it for DK and never for other jurisdictions; injected recorder reaches provider in provider-focused integration test.
- [ ] Inspect `cachedProviderComposition.ts`: if it contains an explicit allowed-provider list, add `retsinformation` and focused regression because concrete ELI text is immutable and cacheable indefinitely. If there is no explicit list, make no unrelated edit.
- [ ] Run RED.
- [ ] Implement minimal composition only.
- [ ] Run GREEN for composition, provider and cache tests.
- [ ] Run `npm run lint`, `git diff --check`.
- [ ] Fresh review gate: no cross-jurisdiction fallback; recorder injection explicit.
- [ ] **Controller checkpoint: do not commit until explicit approval.**

### Task 20: Modal DK Identity Injection, Dropdown, Placeholders and Currentness UI

**Slice:** DK-E

**Files:**
- Modify: `src/ui/LawLookupModal.ts`
- Modify: `src/main.ts` only to pass read-only currentness accessor into modal settings/options
- Modify/Test: `tests/LawLookupModal.test.ts`

**Interfaces:**
- `normalizeJurisdiction` accepts `"DK"` in modal and main settings normalization.
- `JURISDICTION_LABEL_KEYS` includes `jurisdictionDenmark`.
- `JURISDICTION_EXAMPLES` adds `DK: { law: "Forvaltningsloven", reference: "§ 1", single: "Forvaltningsloven § 1" }`.
- Dropdown adds DK while preserving EU-first and locale-sorted non-EU ordering.
- DK selected-law display behaves like IT/NL: user sees human title; explicit lookup swaps selected title for canonical `canonicalInput` before parsing.
- Modal gets read-only currentness accessor such as `getDkCurrentness?(canonicalEli: string): RetsinformationCurrentnessView`; no DK network call is introduced in modal.
- Modal recognizes `RetsinformationDiscoveryInitializingError` from the DK discovery adapter and renders `dkIndexInitializing`; an unavailable DK adapter renders `dkDiscoveryUnavailable` through the existing error path.

- [ ] Extend the existing modal test harness with executable DK tests. Assert DK option exists and ordering invariant holds; selecting a DK suggestion displays title; selection itself makes zero provider lookups; split-layout `§ 1` with selected law yields canonical parser input `/eli/lta/2014/433 § 1`; editing law text clears selection; jurisdiction change clears selection/current preview; stale DK discovery response cannot overwrite newer query.
- [ ] Add executable currentness UI tests after successful DK lookup:
  - fresh LBK/no changes → consolidated-date semantic string;
  - fresh Store C with `<Change>` evidence → later-amendment warning;
  - stale/unavailable Store C → unavailable-currentness warning;
  - Atom-only invalidation → stale/unavailable, never amendment warning;
  - source status indicating no longer in force → `dkHistoricalNotice` in addition to the applicable currentness state;
  - non-DK behavior unchanged.
- [ ] Add executable discovery-state assertions: DK `initializing` shows `dkIndexInitializing`, DK unavailable shows `dkDiscoveryUnavailable`, and neither state creates suggestion buttons.
- [ ] Run RED with native compile + `node --test test-dist/tests/LawLookupModal.test.js`.
- [ ] Implement DK by extending existing title-display/identity-injection conditions, not with a DK-specific lookup fork. Reuse existing discovery debounce/revision mechanism unchanged.
- [ ] Read Store C only after successful DK lookup via accessor. Do not add currentness fields to `LawSection`.
- [ ] Run GREEN for modal + parser + discovery tests.
- [ ] Run `npm run lint`, `git diff --check`.
- [ ] Fresh review gate: explicit selection/reference/lookup lifecycle and EU-first ordering preserved.
- [ ] **Controller checkpoint: do not commit until explicit approval.**

### Task 21: DK I18n Overlay for All 24 UI Languages

**Slice:** DK-E

**Files:**
- Modify: `src/ui/i18n.ts`
- Modify: `src/ui/i18nCatalog.ts`
- Modify/Test: `tests/i18n.test.ts`

**Interfaces:**
- Add DK keys to `UiStrings` in `src/ui/i18n.ts`.
- Export `DENMARK_UI_STRINGS` from `src/ui/i18nCatalog.ts` following FI/IT/NL overlay pattern.
- Spread `DENMARK_UI_STRINGS[language]` in `getUiStrings`.

Required keys:

```typescript
interface DenmarkUiStrings {
  jurisdictionDenmark: string;
  dkScopeNote: string;
  dkInputFormats: string;
  dkInputExamples: string;
  dkConsolidatedNotice: string;
  dkLaterAmendmentsWarning: string;
  dkCurrentnessUnavailable: string;
  dkIndexInitializing: string;
  dkDiscoveryUnavailable: string;
  dkHistoricalNotice: string;
}
```

Canonical English semantics:
- `Official consolidated text dated {date}.`
- `Later amendments are recorded and may not be incorporated in this consolidation.`
- `Currentness information could not be verified.`

Canonical Danish semantics:
- `Officiel konsolideret tekst dateret {date}.`
- `Senere ændringer er registreret og er muligvis ikke indarbejdet i denne konsolidering.`
- `Aktualitetsinformation kunne ikke verificeres.`
- `dkHistoricalNotice` must state factually that the concrete document may no longer be in force when the source status says so; it must not make a latest/current-state claim.

- [ ] Extend existing i18n tests using exported `UI_LANGUAGE_CODES`, not a duplicate language list. For every locale assert every DK key is non-empty; English exact baselines; Danish exact three strings above; `{date}` retained in every consolidated-notice string; existing catalog completeness remains green.
- [ ] Run RED.
- [ ] Implement `DENMARK_UI_STRINGS` for all 24 locales. These are UI translations only; legal source text remains Danish.
- [ ] Run GREEN for `i18n.test.js`.
- [ ] Run `npm run lint`, `git diff --check`.
- [ ] Fresh review gate: no missing-locale fallback for required DK keys; initializing/unavailable/historical strings are wired; Danish warning means “may not be incorporated”.
- [ ] **Controller checkpoint: do not commit until explicit approval.**


---

# Slice DK-F — Final Runtime Acceptance and Independent Review

### Task 22: Full Verification, Runtime Acceptance Gate and Fresh Independent Review

**Slice:** DK-F

**Files:**
- No new production file by default.
- Tests change only if an independently identified coverage gap is explicitly approved before editing.
- Generated `main.js` may change only as the normal repository build artifact and must be verified accordingly.

**Interfaces:**
- Consumes all DK-A through DK-E deliverables.
- Produces verification evidence only; no release/version/tag/deploy action.

- [ ] Run focused DK suite after clean compile:

```bash
rm -rf test-dist
npx tsc -p tsconfig.test.json
node --test \
  test-dist/tests/dkTypes.test.js \
  test-dist/tests/dkParser.test.js \
  test-dist/tests/dkCacheKey.test.js \
  test-dist/tests/httpTransportHeaders.test.js \
  test-dist/tests/retsinformationHttp.test.js \
  test-dist/tests/retsinformationLexDania.test.js \
  test-dist/tests/RetsinformationLawProvider.test.js \
  test-dist/tests/dkDiscoveryIndexStorage.test.js \
  test-dist/tests/dkJsonLdParser.test.js \
  test-dist/tests/dkSitemap.test.js \
  test-dist/tests/dkBootstrapCheckpoint.test.js \
  test-dist/tests/dkBootstrap.test.js \
  test-dist/tests/dkAtom.test.js \
  test-dist/tests/dkRefreshSchedule.test.js \
  test-dist/tests/dkIncrementalRefresh.test.js \
  test-dist/tests/dkFullReconciliation.test.js \
  test-dist/tests/dkRetentionGap.test.js \
  test-dist/tests/dkCurrentness.test.js \
  test-dist/tests/RetsinformationLawDiscovery.test.js \
  test-dist/tests/dkMainLifecycle.test.js \
  test-dist/tests/dkProviderComposition.test.js \
  test-dist/tests/LawLookupModal.test.js \
  test-dist/tests/i18n.test.js
```

Expected: all focused tests pass.

- [ ] Run full repository tests:

```bash
npm test
```

Expected: all tests pass, including EU, DE, AT, CH, ES, FI, IT and NL regressions.

- [ ] Run lint:

```bash
npm run lint
```

Expected: exit 0.

- [ ] Run production build:

```bash
npm run build
```

Expected: exit 0. Record generated `main.js` SHA-256 and verify it is the normal build artifact for the candidate source tree.

- [ ] Run scope/whitespace gates:

```bash
git diff --check
git status --short
git diff --name-only
```

Expected: no whitespace errors; exact approved DK scope only; no unrelated files, secrets, version/tag/release metadata.

- [ ] Static Q5/currentness audit: no production/UI path claims “latest LBK” or adds latest navigation; no Atom/sitemap field is used as amendment evidence; legal-text cache contains no Store C mutable state; no cross-jurisdiction fallback.
- [ ] Fresh independent code review after automated gates. Review provider fail-closed semantics, URL/identity construction, official JSON-LD contract, A/B activation, bootstrap resumability, watermark durability, 24h/31d/retention-gap separation, Store C ownership, shared discovery ranker, modal lifecycle, and i18n semantics.
- [ ] Runtime/manual Obsidian acceptance — **STOP FOR CONTROLLER APPROVAL FIRST**. Do not install to the vault or alter runtime plugin files before explicit authorization. After approval use `/eli/lta/2014/433` / Forvaltningsloven and verify local autocomplete, ≤8 suggestions, explicit selection, no auto-lookup, `§ 1`, a verified `§ 1, stk. 2` path, preview, explicit insertion, official-source metadata, and currentness UI without any “latest” claim.
- [ ] Verification-before-completion: after any review/runtime fix, rerun relevant automated gates and final diff-scope check before claiming completion.
- [ ] **Controller checkpoint: do not commit, merge, tag, release or deploy until explicit approval.**

---

## Implementation Dependency Order

1. DK-A Tasks 1–3 establish jurisdiction types, canonical identity/reference parsing and immutable concrete-ELI cache identity.
2. DK-B Task 4 establishes header/retry support before DK source clients consume it; Tasks 5–6 add source-backed XML parsing and provider/recorder seam.
3. DK-C Tasks 7–11 establish index schema, semantic A/B state, official JSON-LD parsing, sitemap enumeration, real checkpoint persistence and all-or-nothing bootstrap.
4. DK-D Tasks 12–15 establish Atom normalization, independent scheduling, durable incremental processing, selective reconciliation and retention-gap recovery.
5. DK-E Task 16 implements Store C before composition; Tasks 17–21 wire discovery, plugin lifecycle, provider chain, modal lifecycle/currentness UI and 24-locale strings.
6. DK-F Task 22 verifies the complete candidate. Runtime installation remains separately authorized.

## Q5 Hard Gate

Q5 (same-law/version lineage) remains OPEN and non-blocking. No task in this plan may:

- state or imply that a selected LBK is the latest LBK;
- implement “go to latest LBK” navigation;
- infer lineage from sitemap or Atom ordering;
- treat ELI `changed_by`/`consolidates` as sufficient proof of the exact “latest LBK” claim without a separately approved source audit proving that use;
- synthesize later amendments into concrete ELI text.

Allowed v1 behavior is limited to concrete source-backed document identity/text, immutable document facts, and Store C currentness observations from verified LexDania evidence.

## Spec Coverage Map

| Spec section | Implemented by tasks |
|---|---|
| 1 Context/lifecycle/local-index rationale | 17, 18, 20, 22 |
| 2 Authority/supported source | 5, 6, 8, 22 |
| 3 Canonical identity | 2, 3, 6, 8, 9 |
| 4 Legal-time contract | 6, 16, 20, 21, 22 |
| 5 Text provider | 4, 5, 6 |
| 6 Reference model | 2, 5, 6 |
| 7 Discovery architecture | 7, 17 |
| 8 Bootstrap | 4, 8, 9, 10, 11 |
| 9 Incremental refresh | 12, 13, 14, 15 |
| 10 Index storage/versioning | 7, 10, 11 |
| 11 A/B/C cache/currentness separation | 3, 6, 16, 18, 19, 20 |
| 12 Parser/direct input | 2, 20 |
| 13 Language | 6, 21 |
| 14 Failure model | 2, 5, 6, 7, 8, 9, 11, 14, 15, 22 |
| 15 UI/UX | 17, 20, 21 |
| 16 Observability/user feedback | 18, 20, 21 |
| 17 Test strategy | 1–22 |
| 18 Provider/cache integration | 3, 6, 19 |
| 19 Security/privacy | 4, 18, 22 |
| 20 Slice implementation strategy | 1–22 |
| 21 Open questions Q1–Q5 | 8, 9, 11, 13, 15, 16, Q5 hard gate |
| 22 Decision record | authoritative table above; enforced throughout |

## Plan Self-Review Checklist

- [ ] Every material spec requirement maps to tasks in the table above.
- [ ] All 16 exact `DECISION_*` records appear unchanged.
- [ ] Every production symbol is produced before a later task consumes it.
- [ ] Test runner is exclusively the repository-native `node:test` / `node:assert` pipeline.
- [ ] No bare ELI becomes an incomplete/fabricated `LawReference`.
- [ ] XML/JSON URL construction cannot duplicate the canonical `/eli` segment.
- [ ] LexDania parser does not require any unverified dedicated subsection-text leaf element or other invented leaf names.
- [ ] JSON-LD uses official ELI ontology namespace and official Retsinformation authority values.
- [ ] `saveCandidate` and `activateCandidate` remain separate.
- [ ] 24h incremental, >31d ordinary full reconciliation, and Atom retention-gap recovery remain distinct.
- [ ] Retry-After uses an explicit response-header seam.
- [ ] Store C freshness has no invented 60-day TTL.
- [ ] Discovery uses `searchLawMetadata` and no network per keystroke.
- [ ] DK main lifecycle has explicit fields/methods and no undefined index-access placeholder.
- [ ] All 24 locales receive DK strings; Danish amendment warning means “may not be incorporated”.
- [ ] Every task ends with a controller checkpoint and contains no automatic commit step.
- [ ] No release/version/tag/deploy step is included.
