# Denmark Retsinformation Architecture Design Specification

**Task:** ELL-DK-ARCHITECTURE-DESIGN-SPEC-1  
**Date:** 2026-09-16  
**Last Updated:** 2026-09-16 (Q1–Q4 Resolved)<br>
**Classification:** Architectural  
**Status:** Approved  
**Repository:** obsidian-de-law  
**Branch:** main  
**HEAD:** 67785409dc9b12af0608775f621d17982ae3e228

---

## 1. Context and Goals

### Why Denmark Is Being Added

Denmark (DK) is a new jurisdiction for European Law Lookup. Denmark participates in European legal interoperability through ELI (European Legislation Identifier) and publishes official legal texts via the Retsinformation system, operated by Civilstyrelsen under the Danish Ministry of Justice.

### Existing Uniform Lookup Lifecycle

Every supported jurisdiction follows a single lifecycle:

```
jurisdiction selection
  → autocomplete/discovery
    → explicit selection
      → reference entry
        → explicit lookup
          → preview
            → explicit insertion
```

This lifecycle is a hard UX invariant. DK must preserve it without introducing jurisdiction-specific behavioral forks.

### Official-Source-Only Requirement

All legal text, identity, and metadata must come from official Danish government sources. Unofficial aggregations, community mirrors, or undocumented APIs are rejected.

### Why a Curated Subset Is Rejected

A curated list of supported Danish laws (analogous to the German `gesetze-im-internet` approach) is rejected for v1 because:

- Denmark has no official title-search API compatible with the existing 250 ms autocomplete UX requirement.
- A curated subset provides incomplete coverage and false implicit currentness guarantees.
- Maintaining a curated list introduces ongoing manual curation burden without official backing.
- The repository architecture requires uniform discovery behavior across jurisdictions; a curated subset breaks this uniformity.

### Why Live Network Autocomplete Is Impossible Against the Harvest API

The Retsinformation harvest API (`https://api.retsinformation.dk/v1/Documents`) is a synchronization/harvest metadata endpoint. It is not an interactive title-search API:

- No authentication required, but the endpoint is designed for periodic synchronization, not interactive queries.
- Maximum **1 request per 10 seconds**.
- Service window: **03:00–23:45** (CET).
- Maximum **10-calendar-day lookback** for changed documents.
- **No arbitrary title search** — the endpoint returns documents changed since a given timestamp, not filtered by title.
- **No direct document lookup by ELI/year/number** — it is not a document retrieval endpoint.
- **No legal body text** — only metadata is returned.
- Not suitable for interactive autocomplete under any configuration.

### Why a Local Index Is Required

Because no official interactive search API exists, a local discovery index must be built and maintained. This index:

- Enables sub-250 ms local title search with zero network requests per keystroke.
- Preserves the uniform autocomplete lifecycle.
- Is bootstrapped from official sources: ELI sitemap index enumerates canonical identities, and required title/metadata is obtained from an official metadata source selected after Q1 is resolved.
- Is incrementally refreshed via the ELI Atom update feed.
- Provides the same UX parity as jurisdictions with network-based discovery (ES, FI, IT, NL) but via a local data store.

---

## 2. Source Authority Model

### Official Source

**Retsinformation / Civilstyrelsen** — the official Danish legal information system, operated by Civilstyrelsen under the Danish Ministry of Justice.

URL: `https://www.retsinformation.dk/`

### Formal Publication Source

**Lovtidende** — the official Danish Law Gazette, where new legislation is formally published.

### Supported v1 Legal-Text Scope

v1 supports promulgated legislation represented by canonical ELI resources, with preference for types compatible with the existing reference model:

- **LOV** (Lov) — Acts of Parliament
- **LBK** (Lovbekendtgørelse) — Consolidated acts

These types have paragraph-level structure (`§`) compatible with the existing `LawReference` model.

### Authority Claims

For concrete promulgated LOV/LBK text retrieved via canonical ELI identity:

```
isOfficialSource = true
isAuthoritativeText = true
```

However, an LBK (consolidated act) retrieved at a specific point in time does **not** guarantee a complete current legal state:

- Later amending acts may exist after the LBK consolidation date.
- The LBK text represents the state as of its consolidation date.
- v1 does **not** synthesize later amendments into the LBK text.

---

## 3. Canonical Identity

### Canonical Form

```
/eli/{pubMedia}/{year}/{number}
```

**pubMedia** — publication medium identifier (e.g., `lta` for Lovtidenden A /Lov og Forordningstidende)  
**year** — year of publication  
**number** — document number within the publication medium and year

### Examples

```
/eli/lta/2014/433    (Forvaltningsloven / The Administrative Procedure Act, LBK nr 433 af 22/04/2014)
```

This is the verified fixture identity. Only use independently verified identities in examples.

### Identity Requirements

| Requirement | Satisfied |
|---|---|
| Publication medium included | ✓ |
| Year included | ✓ |
| Number included | ✓ |
| Title-independent | ✓ |
| Stable across amendments | ✓ |
| Serializable to string | ✓ |
| Collision-resistant within supported scope | ✓ |

### Provider Admission Contract

`RetsinformationLawProvider` v1 admits only canonical ELI identities whose
request-side `pubMedia` is exactly `"lta"`. A syntactically valid canonical ELI
with any other `pubMedia` value fails closed before network retrieval. This is
an independent request-identity gate: admitting `lta` does not imply that
every `lta` document is supported.

After retrieval, the LexDania `DocumentType` is validated independently against
the approved v1 scope of `LOV`/`LOVH` and `LBK`/`LBKH`. The provider must not
infer `DocumentType` from `pubMedia`, and it must not invent or parse an XML
`pubMedia` field; `pubMedia` is taken from the canonical request identity.

### Excluded Identity Forms

- **Title as identity** — titles are not stable; same law may have different popular titles.
- **year/number without pubMedia** — ambiguous; multiple publication media exist.
- **Accession number as primary identity** — may be accepted as a source-backed alias in future design, but not as primary identity in v1.

---

## 4. Legal-Time Contract

This section defines the precise semantics of legal-time state for DK in v1.

### Definitions

| Term | Definition |
|---|---|
| **Concrete ELI document** | A specific, immutable promulgated source identified by canonical ELI identity. |
| **Latest known LBK** | The most recent official consolidation (Lovbekendtgørelse) that the system has verified exists. |
| **Complete current legal state** | The full text of a statute including all amendments through the current date. |

### Rules

1. **A concrete ELI document is an immutable source identity.** Once a canonical ELI identity is resolved to a document, that document's text does not change at that identity.

2. **An LBK is a formally promulgated consolidation.** It represents the act as consolidated at the date of that LBK's issuance.

3. **"Latest LBK" may only be claimed when source-backed lineage proves it.** The system may display "latest official consolidation" only when an official, source-backed relationship/lineage establishes that the selected LBK is the latest consolidation for that law. The sitemap or Atom feed alone do not establish same-law lineage. Until a proven version-lineage mechanism is available, the system must identify only the concrete ELI document, show its consolidation/publication date, and not claim "latest".

4. **Later amending acts may exist after that LBK.** The system does not claim to have incorporated all amendments published after the latest known LBK.

5. **v1 does NOT synthesize later amendments into the LBK text.** The text returned is the text of the concrete ELI document, not a synthesized "current state" text.

6. **v1 must NOT claim "complete current legal state" unless source evidence can prove that claim.** The system must not present text as the complete current statute when it cannot verify that no later amendments exist.

7. **Legal amendment metadata and synchronization/refresh metadata are distinct.** LexDania XML `<Change>` relations are source-backed legal/amendment relationships. Atom `reasonForChange`/`changeDate` values are source/update synchronization signals. Atom events alone MUST NOT be interpreted as proof of a legal amendment and MUST NOT independently trigger a "later amendments exist" claim. Only LexDania XML `<Change>` relations may support a legal-amendment assertion.

8. **Ambiguous or unverifiable currentness fails closed.** If the system cannot determine whether a given LBK reflects the complete current state, it must not claim currentness.

9. **Store-C recording is ancillary to immutable legal-text retrieval.** A
   synchronous throw or rejected Promise from
   `RetsinformationCurrentnessRecorder.record(...)` must not turn an otherwise
   fully verified `LawSection` into an unavailable or not-found result, and it
   must not be mapped to `LawProviderUnavailableError`.

10. **Recorder failure does not establish currentness.** If recording fails,
    the provider must not claim a successful currentness observation. Currentness
    remains unavailable/unverified; immutable verified document facts and legal
    text remain usable. The provider must not synthesize currentness, amendment
    state, or latest-LBK state from the failed call.

### User-Facing Semantics *(Q3 Resolved)*

The UI must convey the following semantic states:

- **Normal concrete LBK document:**
  "Official consolidated text dated {date}."

- **Fresh source-backed LexDania `<Change>` evidence establishes later amendments:**
  "Later amendments are recorded and may not be incorporated in this consolidation."

- **Currentness evidence is unavailable or stale:**
  "Currentness information could not be verified."

Rules:

- No "latest" wording in v1 unless Q5 is later resolved with source-backed same-law/version lineage.
- Atom synchronization signals alone never trigger the amendment warning.
- Warning text may be localized, but semantic meaning must remain equivalent.
- Immutable document facts remain displayable even when currentness evidence is unavailable.

A "Gå til seneste LBK" (go to latest LBK) version-lineage resolution feature is deferred until source-backed mechanics are established. This remains an open question (see Section 21, Q5).

---

## 5. Retsinformation Text Provider

### Component

`RetsinformationLawProvider`

### Primary Text Route

```
/eli/{pubMedia}/{year}/{number}/xml
```

### Expected Format

LexDania XML — the structured XML format published by the Danish legal information system (LexDania) for official legal texts.

### Provider Responsibilities

1. **Retrieve** concrete ELI XML from `https://www.retsinformation.dk/eli/{pubMedia}/{year}/{number}/xml`
2. **Validate** source identity matches the requested canonical ELI.
3. **Validate** expected document metadata (title, type, status, dates).
4. **Parse** document type and status from XML metadata.
5. **Structurally locate** the requested reference (§, stk.) using the XML's structural markup (Paragraf/@localId, Stk).
6. **Return** canonical legal text as structured `LawSection`.
7. **Surface** title and source metadata needed by the UI.
8. **Surface** legal-time and amendment metadata needed by the UI.
9. **Fail closed** on malformed or inconsistent XML.

Recording the verified observation in Store C is ancillary to this retrieval.
Recorder failure does not invalidate the verified legal text: the provider
returns the `LawSection` while leaving currentness unavailable/unverified, does
not claim a successful observation, and does not classify the recorder failure
as provider/network unavailability.

### Provider Return Contract

`RetsinformationLawProvider` implements the existing `LawProvider` interface:

```
getSection(reference: LawReference): Promise<LawSection | null>
```

- Returns `LawSection` on successful retrieval and structural match.
- Returns `null` when the requested reference (§ or stk.) is absent from the document, or when the document cannot be retrieved.
- Throws `LawProviderUnavailableError` for provider/network unavailability.
- The `ProviderRegistry` is responsible for converting an unresolved lookup (null return) into `LawSectionNotFoundError` for the UI layer.
- No DK-specific not-found exception is introduced.

### Provider Constraints

The provider must NOT:

- **Discover titles** — title discovery is the responsibility of `RetsinformationDiscoveryIndex`.
- **Synthesize amendments** — text is returned as-is from the official source.
- **Call unofficial APIs** — only official Retsinformation / LexDania endpoints are used.
- **Infer missing identity from title text** — canonical ELI identity is always the entry point.

### Error Conditions

| Condition | Behavior |
|---|---|
| Network failure | Throw `LawProviderUnavailableError` |
| XML parsing failure | Fail closed; return null |
| Identity mismatch (requested vs. returned ELI) | Fail closed |
| Unknown publication medium | Fail closed |
| Requested § absent from document | Return `null` |
| Requested stk. absent from § | Return `null` |

---

## 6. Reference Model

### v1 Supported References

| Reference | Example | Model |
|---|---|---|
| Paragraph | `§ 1` | paragraph + optional letter suffix |
| Paragraph with subsection | `§ 1, stk. 2` | paragraph + subsection (stk.) |

### Model

```
paragraph number        (required)
optional letter suffix  (e.g., "a" in "§ 9 a")
optional subsection     (e.g., "stk. 2")
```

### Excluded from v1

- Chapter-only lookup (no § reference)
- Annex/Bilag lookup
- Arbitrary nested clause/litra addressing
- Fuzzy reference guessing

### Structural Mapping

The LexDania XML uses structural elements that map directly:

| XML Element | Reference Component |
|---|---|
| `Paragraf/@localId` | paragraph number |
| `Stk` | subsection (stk.) |

Reference extraction uses source structure, not flattened-text regex extraction.

---

## 7. Discovery Index Architecture

### Components

Two components form the DK discovery layer, preserving the repository's existing generic discovery abstraction:

**`RetsinformationDiscoveryIndex`** — local official metadata/index storage. Manages the local discovery index (bootstrap, refresh, query, persistence). This is the data layer.

**`RetsinformationLawDiscovery`** — implementation of the repository's existing `LawDiscoveryProvider` interface. Queries the local index and presents results through the shared discovery seam. This is the adapter that `LawLookupModal` consumes.

### Purpose

Serve autocomplete locally with zero network requests per keystroke. The `LawLookupModal` continues consuming the shared `LawDiscoveryProvider` abstraction — DK is not a modal-specific or jurisdiction-specific discovery bypass.

### Minimum Indexed Fields

| Field | Description |
|---|---|
| `canonicalEli` | Canonical ELI identity (index key) |
| `popularTitle` | Short popular title (if available) |
| `documentTitle` | Full official document title |
| `documentType` | Law type (LOV, LBK, etc.) |
| `pubMedia` | Publication medium |
| `year` | Publication year |
| `number` | Document number |
| `status` | Document status (e.g., "in force", "repealed") |
| `startDate` | Platform/document validity start date (source-defined meaning) |
| `endDate` | Platform/document validity end date if applicable (source-defined meaning) |
| `changeDate` | Last change date (source/update synchronization signal) |

**Temporal field note:** `startDate`, `endDate`, and `status` retain their source-defined meaning as platform/document validity metadata. They must NOT be silently converted into substantive legal-effective/commencement dates unless the source contract explicitly proves that meaning.

### Optionally Indexed Fields

| Field | Description |
|---|---|
| `accessionNumber` | Accession number (source-backed alias) |
| `ministry` | Originating ministry/agency |
| `announcedIn` | Publication reference |
| `sourceUpdateTimestamp` | When the index entry was last refreshed/observed from source |
| `sitemapLastModified` | Exact `lastmod` observation from the official ELI sitemap entry; used only for source synchronization/reconciliation decisions; not a legal-effective date; not a currentness conclusion; not equivalent to `sourceUpdateTimestamp` |

### Index Key

The canonical ELI identity (`/eli/{pubMedia}/{year}/{number}`) serves as the unique index key.

### Discovery Query Behavior

```
query
  → local index lookup (substring/fuzzy match on title fields)
  → shared metadata ranker (LawMetadataSearch)
  → max 8 results
```

No jurisdiction-specific ranking fork unless proven necessary by user testing.

---

## 8. Index Bootstrap

This is the most architecturally significant component of DK support.

### Strategy

A deterministic bootstrap pipeline using official sources only.

### Bootstrap Pipeline

**Phase 1: ELI Enumeration**

Enumerate all canonical ELI resources from the official Retsinformation ELI sitemap.

- Source: `https://www.retsinformation.dk/eli/sitemap.xml`
- This is a **sitemap INDEX** — it does not directly enumerate ELI entries.
- The sitemap index references **21 sitemap pages**, each of which must be fetched to enumerate individual ELI entries.
- Bootstrap enumeration therefore requires:
  1. Fetch the sitemap index
  2. Fetch each referenced sitemap page
  3. Enumerate canonical ELI identities from the page entries
- **Constraint:** The sitemap pages may not contain sufficient title metadata directly

**Phase 2: Metadata Acquisition** *(Q1 Resolved)*

For each enumerated ELI entry, obtain required title/metadata from the selected official per-ELI JSON-LD metadata representation.

**Selected source:** `https://www.retsinformation.dk/eli/{pubMedia}/{year}/{number}.json`

- Content-Type: `application/ld+json`
- Official Retsinformation ELI JSON-LD representation
- Metadata-only; no legal body text returned
- One request per canonical ELI identity
- **Required bootstrap identity/title metadata:** `@id`, `eli:title`, `eli:type_document`; publication identity derivable/validated from canonical ELI (`pubMedia`/`year`/`number`).
- **Optional metadata consumed when present:** `eli:title_alternative`, `eli:responsibility_of`, `eli:in_force`, `eli:id_local`, `eli:changed_by`, `eli:consolidates`, and other source-backed metadata explicitly modeled by the index.
- Optional metadata absence must not invalidate an otherwise valid bootstrap entry unless that field is required by the final index schema.
- Do not invent missing optional values. Nullable/optional fields remain nullable.
- No source-field semantics may be upgraded beyond what the official source establishes.
- May additionally contain relations (`changed_by`, `consolidates`, `basis_for`)

Rejected alternatives (with rationale):

- **LexDania XML (`/xml`)** — contains full legal body text (~97 KB vs ~60 KB); heavier than necessary for metadata-only bootstrap.
- **Harvest API** — bounded 10-day lookback; does not return document titles; unsuitable for complete initial bootstrap.
- **ELI Atom feed** — bounded 60-day retention; cannot bootstrap full historical index.

The sitemap itself remains enumeration-only (URL + `lastmod`; no title/type/status metadata).

**Phase 3: Canonical Identity Validation**

Validate each entry:

- Canonical ELI identity is well-formed
- Publication medium, year, and number are present
- Metadata is consistent with the ELI identity
- Document type is recognized (LOV, LBK, etc.)

**Phase 4: Local Index Population**

Populate the local index with validated entries:

- Write entries to an index file (or in-memory structure)
- Track bootstrap progress for resumability
- Record generation timestamp

**Phase 5: Atomic Activation**

Persist the index atomically:

- Write to a temporary file
- Validate the complete written file
- Atomically rename/move to the active index file
- Only after successful activation, mark bootstrap as complete

### Concurrency and Rate Constraints *(Q2 Resolved)*

- The Harvest API has a documented constraint of **1 request per 10 seconds**. This limit applies **only** to the `/v1/Documents` synchronization endpoint and MUST NOT be transferred to the ELI representation endpoints without source evidence.
- **No documented numeric rate limit** was found for the `.json` or `/xml` ELI representation endpoints. The absence of rate-limit headers is NOT permission for unlimited crawling.
- Cloudflare was observed in the bounded probes and may be present on ELI representation requests (`cf-cache-status: DYNAMIC`).
- Bootstrap must use **conservative sequential access** by default with:
  - Explicit exponential backoff on errors
  - Retry/stop appropriately on 429/503
  - Honor `Retry-After` headers if present
  - Resumable bootstrap (progress persisted)
  - No aggressive crawling; no parallel bulk load
- Concurrency may only be increased later with source-backed evidence of safe automated access.
- The provider must NOT rely solely on HTTP Content-Type for the `/xml` endpoint. Valid LexDania XML may be returned with an incorrect `text/html` Content-Type. The provider must validate the response body structurally as LexDania XML and fail closed on malformed/non-LexDania content.

### Resumability

- Bootstrap progress is persisted (last successfully processed ELI entry).
- If bootstrap is interrupted, it can resume from the last checkpoint.
- No entry is written to the final index until its metadata is fully validated.

### Incomplete Bootstrap Behavior

- If bootstrap is incomplete, the index is not activated.
- The system reports "Index initializing" state to the user.
- Autocomplete is unavailable until bootstrap completes.
- The system does **not** fall back to a curated subset.

### Corruption Behavior

- If the index file is malformed or corrupted, it is rejected.
- The system attempts a fresh bootstrap.
- If no valid index exists, discovery is unavailable.

### Failure Behavior

- If bootstrap fails (network error, rate limit, malformed data), the last valid index (if any) remains active.
- If no prior valid index exists, discovery is unavailable and the system reports the state.
- No silent fallback to curated data.

---

## 9. Incremental Refresh

### Primary Update Source

The ELI Atom update feed at:

```
https://www.retsinformation.dk/eli/eli-update-feed.atom
```

This URL is verified against official documentation.

### Feed Retention

The Atom feed retains at least **60 days** of history. This is the minimum retention fact from the feasibility audit.

### Feed Contents

Each Atom entry contains:

| Field | Description |
|---|---|
| `id` | Canonical ELI identity |
| `updated` | Change date |
| `title` | Document title (at time of entry) |
| `reasonForChange` | Reason for the change (if available) |

### Refresh Requirements

1. **Idempotent and replay-safe:** Atom application is deterministic and idempotent. The same event may safely be reprocessed after interruption. Index mutation and watermark advancement must be ordered so a crash cannot silently skip an event. Watermark advances only after the corresponding candidate state has been durably validated and persisted. Duplicate feed entries must not create duplicate index entries.
2. **Two-path processing:** Atom refresh supports two cases:
   - **Existing canonical ELI:** refresh/revalidate its source metadata.
   - **Newly observed canonical ELI:** acquire required official metadata, validate identity, add to candidate index, then atomically activate.
3. **Synchronization triggers only:** Atom events are source/update synchronization signals. They MUST NOT themselves create legal amendment or currentness assertions.
4. **Sitemap reconciliation:** Periodically reconcile against the sitemap to detect entries that may have been added outside the feed's retention window.
5. **Never delete valid prior index entries:** If refresh fails, the last valid index remains active.
6. **Persist refresh watermark:** Record the last-processed Atom entry ID or timestamp only after durable persistence of the corresponding state.
7. **Detect retention-window gaps:** If the watermark is older than the feed's retention window, trigger full reconciliation.

### Atom Feed Retention Limitation

The Atom feed retains at least **60 days** of history. If the client misses updates longer than the retention window:

- The system must perform a full reconciliation/bootstrap rather than guessing.
- This is a controlled degradation, not an error state.

### Refresh Cadence *(Q4 Resolved)*

- **Incremental Atom refresh:** Eligible at most once per day. Perform when ≥24 hours since last successful incremental refresh. Do not perform unnecessary refreshes within the 24-hour window.
- **Ordinary full reconciliation:** Monthly. Eligible when >31 days since last successful full reconciliation.
- **Retention-gap recovery:** If the Atom history can no longer bridge the persisted watermark, trigger mandatory full reconciliation immediately. Do not guess or silently advance the watermark.

### Full Reconciliation Algorithm

When full reconciliation is triggered:

1. Fetch the sitemap index.
2. Fetch referenced sitemap pages.
3. Compare canonical ELI identities + sitemap `lastmod` against local index entries.
4. Identify:
   - New ELI resources (present in sitemap but absent from local index)
   - Changed ELI resources (sitemap `lastmod` differs from stored `sitemapLastModified`)
   - Unchanged resources (identity + `lastmod` match — skip re-download)
5. Fetch `.json` metadata **only** for new/changed ELI resources. Do NOT re-download every `.json` representation when identity + `lastmod` show no change.
6. Validate candidate index.
7. Atomically activate candidate.
8. Persist the new `sitemapLastModified` value only after durable activation.
9. `sitemapLastmod` must never be interpreted as substantive legal amendment evidence.

---

## 10. Index Storage and Versioning

### Versioned Index Format

```typescript
interface RetsinformationIndex {
  schemaVersion: number;           // Incremented on breaking schema changes
  source: "retsinformation-eli";  // Source identifier
  generatedAt: string;             // ISO 8601 timestamp of generation
  lastSuccessfulRefresh: string;   // ISO 8601 timestamp of last refresh
  feedWatermark: string;           // Last processed Atom entry ID/timestamp
  entries: RetsinformationIndexEntry[];
}

interface RetsinformationIndexEntry {
  canonicalEli: string;            // Index key
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

### Persistence Requirements

- **Atomic persistence:** Write to a temporary file, validate, then atomically rename to the active file.
- **Partial writes never become active.** If the write is interrupted mid-file, the old index remains active.
- **Schema mismatch:** Old incompatible schema versions fail closed (reject the index, trigger rebuild).
- **Malformed index:** Rejected; system triggers rebuild.
- **Old valid index remains usable:** When a refresh fails, the last valid index file stays active.
- **Fresh install without valid index:** Must communicate "discovery unavailable" state rather than silently reducing coverage. Must **not** fall back to a curated subset.

### Storage Location

Persisted in the Obsidian plugin's data directory (alongside `data.json`), using a file-based approach similar to `EuActIndexFileStorage`:

- Primary file: `dk-discovery-index.json` (or equivalent)
- Slot-based A/B persistence (optional, for atomicity guarantee)

---

## 11. Cache Model

### Separation of Concerns

Three distinct data stores must be maintained, each with a single authoritative owner:

**A. RetsinformationDiscoveryIndex**

Contains:

- Canonical discovery identity (canonical ELI)
- Title/search metadata (popularTitle, documentTitle)
- Document type, pubMedia, year, number
- Source synchronization/freshness metadata needed to maintain discovery (sourceUpdateTimestamp, changeDate)
- Source status as discovery metadata (status) — but this MUST NOT be treated as an independent legal-currentness conclusion

Does NOT own:

- Authoritative later-amendment relations
- Proven latest-LBK lineage
- Complete legal-currentness conclusions

**B. Legal-Text Cache**

Contains:

- Immutable section/content data bound to concrete canonical ELI identity
- No moving latest/current alias
- No indefinitely frozen mutable currentness evidence

Concrete ELI legal text is immutable at a given canonical identity and may be cached indefinitely under that identity.

**C. Retsinformation Currentness State / Resolver**

Keyed by canonical ELI identity. This is the single authoritative owner for currentness evidence.

Contains source-backed mutable evidence:

- Source document status observations
- LexDania legal `<Change>` relations
- Proven same-law/version lineage (if Q5 is later resolved)
- Observation/retrieval timestamp
- Freshness state

Atom/sitemap events MAY invalidate or trigger revalidation of C. They MUST NOT themselves create legal amendment or currentness assertions.

### Data Flow Rules

- Mutable DK currentness evidence must NOT be embedded into the indefinitely reusable legal-text cache (B).
- Cached/offline legal text without sufficiently fresh currentness evidence (C) must not produce a fresh "latest" or "later amendments" assertion. It may instead show only the immutable concrete-document facts and an appropriate unavailable/stale-currentness state.
- There must be one authoritative owner for currentness state (C), not copies in A and C.

### Legal-Text Cache Key

```
DK:{pubMedia}:{year}:{number}:{reference}
```

Or equivalently, derived from the canonical ELI identity and reference:

```
DK:lta:2014:433:§1 stk.2
```

### Immutability Constraint

Concrete promulgated ELI text is immutable at a given canonical identity. Once retrieved, the text for `/eli/lta/2014/433` does not change. This means:

- Legal-text cache entries for concrete ELI documents are safe to cache indefinitely.
- "Latest LBK for law X" is **not** the same cache identity as a concrete document. A request for "latest LBK" must resolve to a concrete ELI identity first, then cache under that concrete identity.
- Never cache a moving "current law" alias without an explicit version/currentness binding.

---

## 12. Parser / Direct Input

### Supported Direct Identity Forms (v1)

| Form | Example | Accepted |
|---|---|---|
| Full canonical Retsinformation ELI URL | `https://www.retsinformation.dk/eli/lta/2014/433` | ✓ |
| Canonical ELI path | `/eli/lta/2014/433` | ✓ |
| Abbreviated ELI path | `lta/2014/433` | ✓ |

### Rejected Forms

| Form | Example | Reason |
|---|---|---|
| year/number only | `2014/433` | Ambiguous; no publication medium |
| LBK number/year | `LBK 433/2014` | No deterministic identity mapping proven |
| Title-only | `Forvaltningsloven` | Not a stable identity |

### Parser Behavior

- Accept only source-backed, unambiguous forms.
- Validate that the parsed identity matches a known canonical ELI pattern.
- If the identity is ambiguous or invalid, fail closed.

### Normal UX

Title discovery + explicit selection remains the primary entry path. Direct identity input is an advanced shortcut.

---

## 13. Language Contract

### v1 Scope

Danish source text only.

### No Machine Translation

The system does **not** machine-translate Danish legal text into any other language. This is consistent with the existing architecture where machine translation is not performed for any jurisdiction.

### UI Localization

The Obsidian plugin UI may be localized independently (Danish UI strings exist in the i18n catalog). Legal content stays in source language regardless of UI language.

### Greenland / Faroe Islands

Greenland and Faroe Islands jurisdictional scope is **not** separately modeled in v1.

### No Silent Language Fallback

If Danish source text is requested and unavailable, the system fails closed. It does not silently fall back to another language.

---

## 14. Failure Model

### Fail-Closed Conditions

The system must fail closed (return an error rather than partial/inconsistent data) on:

| Condition | Behavior |
|---|---|
| Ambiguous title mapping | Reject; report ambiguity |
| Malformed discovery index | Reject; trigger rebuild |
| Incomplete canonical identity | Reject; fail closed |
| Invalid ELI redirect | Reject; fail closed |
| Source identity mismatch (requested ≠ returned) | Reject; fail closed |
| Unknown publication medium | Reject; fail closed |
| Malformed LexDania XML | Reject; fail closed |
| Requested § absent | Report not found |
| Requested stk. absent | Report not found |
| Ambiguous legal-time state | Fail closed; do not claim currentness |
| Index freshness gap beyond recoverable Atom history | Trigger full reconciliation |
| Source unavailable when no valid local state exists | Report unavailable; discovery unavailable |

### No Cross-Jurisdiction Fallback

If a DK lookup fails, the system does **not** attempt to find the law in another jurisdiction's sources.

### No Fabrication

The system must never fabricate:

- A title
- A canonical identity
- A reference
- A legal-time claim

---

## 15. UI / UX Contract

### Preserve Existing Modal Lifecycle

DK must use the same modal lifecycle as all other jurisdictions:

1. Jurisdiction selection (DK)
2. Autocomplete/discovery (local index)
3. Explicit selection
4. Reference entry
5. Explicit lookup (button press or Enter)
6. Preview
7. Explicit insertion

### Discovery

- Source: local index (no HTTP request per keystroke)
- Maximum results: 8
- Ranking: shared `LawMetadataSearch` ranker
- Selection: explicit click

### After Selection

- Show selected-law confirmation in the input field
- Prompt for § reference
- Do **not** auto-lookup on selection

### Placeholder Recommendations

For the split input layout:

- Law field: `Forvaltningsloven`
- Reference field: `§ 1`

For the single-field layout:

- `Forvaltningsloven § 1`

These are exact recommendations; they must be consistent with the existing jurisdiction-aware placeholder architecture in `LawLookupModal`.

### Legal-Time Warning UI

When the system determines that later amendments may exist after the selected LBK:

- Display a source-backed warning (not alarmist).
- Wording: "Later amendments may not be incorporated" or equivalent.
- Do not suppress the warning; it is an essential legal-time disclosure.
- The warning must be factual, not speculative.

### Currentness Data Flow

The DK legal-time warning path is composition-driven and testable:

1. `RetsinformationLawProvider` retrieves legal text and returns `LawSection | null`. The `LawProvider` interface remains unchanged.
2. The separate `Retsinformation Currentness State / Resolver` (Section 11, store C) holds mutable source-backed currentness evidence keyed by canonical ELI identity.
3. DK UI legal-time warnings consume the currentness state/resolver, not the legal-text cache.
4. Cached/offline legal text without sufficiently fresh currentness evidence must not produce a fresh "latest" or "later amendments" assertion. It shows only the immutable concrete-document facts and an appropriate stale-currentness indicator.
5. No modal-only DK network lookup is introduced; this path is provider/composition-driven.

---

## 16. Observability / User Feedback

### User-Visible States

| State | User Feedback |
|---|---|
| Index initializing | "Denmark index is loading…" or equivalent |
| Index unavailable | "Denmark discovery unavailable" or equivalent; no suggestions shown |
| Index stale but usable | Show suggestions with a subtle freshness indicator (if applicable) |
| Refresh failed | Non-intrusive indicator; suggestions still available from local index |
| Source lookup failed | "Unable to retrieve legal text" or equivalent error message |
| Document is historical | "This document may no longer be in force" (if status indicates) |
| Later amendments may exist | "Later amendments may not be incorporated" (see Section 15) |

### Internal Detail Suppression

Do not expose:

- Internal index schema versions
- Atom feed watermark values
- Bootstrap progress percentages
- Cache hit/miss statistics
- Internal error codes

---

## 17. Test Strategy

### Provider Tests

| Test Case | Description |
|---|---|
| Canonical ELI lookup | Retrieve text for a known canonical ELI identity; expect `LawSection` |
| XML structural parsing | Parse LexDania XML and extract §/stk. structure |
| § extraction | Extract paragraph text from XML by localId |
| stk. extraction | Extract subsection text from XML |
| Missing § returns null | Request a § that does not exist; expect `null` |
| Missing stk. returns null | Request a stk. that does not exist; expect `null` |
| Malformed XML returns null | Send malformed XML; expect `null` (fail closed) |
| Identity mismatch | Requested ELI does not returned ELI; expect fail-closed behavior |
| Later-amendment metadata | Verify LexDania XML `<Change>` amendment metadata is surfaced correctly; Atom sync signals are not treated as amendment evidence |
| ProviderUnavailableError on network failure | Network error produces `LawProviderUnavailableError`, not `null` |
| `/xml` valid LexDania body accepted with `text/html` header | Valid LexDania XML response is accepted even when HTTP Content-Type is `text/html`; provider validates body structurally |
| Malformed HTML/non-LexDania body rejected | Non-XML or non-LexDania response body is rejected; fail closed |

### Parser Tests

| Test Case | Description |
|---|---|
| Accepted DK references | Full URL, canonical path, abbreviated path |
| Rejected ambiguous identifiers | year/number only, LBK number/year |

### Discovery Tests

| Test Case | Description |
|---|---|
| Local index lookup | Query returns expected results from local index |
| Ranking | Results ranked correctly by shared ranker |
| ≤8 cap | Results capped at 8 |
| Stale query suppression | Old queries do not override newer results |
| No network request per keystroke | Verify zero HTTP calls during autocomplete |

### Index Tests

| Test Case | Description |
|---|---|
| Clean bootstrap | Full bootstrap from scratch succeeds |
| Interrupted bootstrap | Bootstrap resumes from checkpoint |
| Malformed state | Malformed index is rejected |
| Schema mismatch | Old schema version is rejected; triggers rebuild |
| Atomic activation | Partial writes do not become active |
| JSON-LD bootstrap metadata parsing | `.json` response is parsed correctly; title, type, number, status extracted |
| Sitemap lastmod unchanged → no refetch | When sitemap `lastmod` matches stored `sitemapLastModified`, `.json` is not re-fetched |
| New ELI → `.json` metadata acquisition | Newly discovered ELI triggers `.json` fetch and metadata population |
| Changed lastmod → `.json` metadata refresh | Changed `lastmod` triggers `.json` re-fetch and metadata update |
| 24h incremental refresh eligibility | Incremental refresh performed only when ≥24 hours since last successful refresh |
| ≤24h → no unnecessary incremental refresh | Refresh not performed within 24-hour window |
| >31d full reconciliation eligibility | Full reconciliation triggered when >31 days since last reconciliation |
| Atom retention gap → mandatory reconciliation | Watermark older than feed retention triggers immediate full reconciliation |
| 429 → backoff/retry policy | HTTP 429 triggers exponential backoff and retry |
| 503 → backoff/retry policy | HTTP 503 triggers exponential backoff and retry |
| Retry-After honored | `Retry-After` header is respected before next request |
| Stale currentness never produces fresh amendment assertion | Stale/unavailable currentness evidence does not trigger "later amendments" or "latest" claim |
| Q5 unresolved → no latest-LBK claim | No "latest LBK" or "latest consolidation" claim when Q5 lineage is unproven |
| Atom incremental refresh — existing ELI | Existing entry metadata is revalidated/updated |
| Atom incremental refresh — new ELI | Newly observed ELI is acquired, validated, and added |
| Atom replay/idempotence | Same Atom event reprocessed after crash produces identical index state; no duplicate entries |
| Watermark ordering | Watermark advances only after candidate state is durably persisted |
| Missed retention window | Full reconciliation triggered |
| Failed refresh retains valid index | Last valid index remains active |

### UI Tests

| Test Case | Description |
|---|---|
| Explicit selection | User must explicitly select a suggestion |
| Jurisdiction switch | Switching from DK to another jurisdiction resets state |
| Language switch preservation | Switching UI language preserves selected law identity |
| Jurisdiction-aware placeholder | Placeholder text updates for DK |
| No auto-lookup | Selection does not trigger lookup |

### Regression Tests

| Test Case | Description |
|---|---|
| All existing jurisdictions unchanged | No behavioral changes for DE, AT, CH, EU, ES, FI, IT, NL |

---

## 18. Implementation Slices

Each slice has an independently reviewable acceptance boundary.

### DK-A — Contracts / Parser / Canonical Identity

**Scope:**

- `LawJurisdiction` type addition: add `"DK"`
- `LawMetadataJurisdiction` type addition: add `"DK"` (in `lawMetadataSearch.ts`)
- DK parser patterns for canonical ELI identity forms
- Canonical identity type definitions and validation
- DK cache-key path generation

The existing `LawReference` already has `lawCode`, `section`, `subsection`, and `jurisdiction`. v1 uses:

- `lawCode` = canonical DK ELI identity
- `section` = Danish paragraph number/letter
- `subsection` = optional stk.

No `LawReference` field addition is planned unless a later implementation inspection proves it necessary.

**Acceptance:**

- DK jurisdiction recognized by type system
- Parser accepts full URL, canonical path, abbreviated path
- Parser rejects ambiguous forms
- Cache keys are deterministic and correct

### DK-B — Retsinformation Provider + Structural Reference Extraction

**Scope:**

- `RetsinformationLawProvider` implementation
- LexDania XML retrieval and parsing
- §/stk. structural extraction from XML
- Error handling (network, XML, identity mismatch)
- Metadata surfacing (title, type, dates, amendments)

**Acceptance:**

- Provider retrieves text for a known canonical ELI identity
- § and stk. extraction is structurally correct
- Fail-closed behavior on all error conditions
- Metadata is surfaced for UI consumption
- Valid LexDania XML accepted even with incorrect `text/html` Content-Type
- Non-LexDania or malformed body rejected (fail closed)

### DK-C — Discovery Index Storage / Schema / Bootstrap Core

**Scope:**

- `RetsinformationDiscoveryIndex` schema and storage
- A/B slot file persistence (or equivalent atomic write)
- Bootstrap pipeline: sitemap enumeration → metadata acquisition → validation → population → activation
- Resumability
- Incomplete/corrupted index handling

**Acceptance:**

- Clean bootstrap produces valid index
- Interrupted bootstrap resumes correctly
- Malformed index is rejected; old valid index remains
- Schema version mismatch triggers rebuild

### DK-D — Atom Incremental Refresh + Reconciliation

**Scope:**

- ELI Atom feed client
- Incremental refresh logic
- Watermark persistence
- Retention-window gap detection
- Full reconciliation trigger

**Acceptance:**

- New feed entries are processed deterministically
- Existing entries are updated correctly
- Stale watermark triggers full reconciliation
- Failed refresh does not invalidate active index

### DK-E — Modal / Provider Composition / UI Integration

**Scope:**

- DK discovery provider registration: `RetsinformationLawDiscovery` implementing the shared `LawDiscoveryProvider` seam, backed by `RetsinformationDiscoveryIndex`
- `RetsinformationLawProvider` registration in `ProviderRegistry`
- DK jurisdiction in `providerComposition.ts`
- Modal integration for DK (placeholder, legal-time warning, etc.)
- Cache integration

**Acceptance:**

- DK appears in jurisdiction dropdown
- Autocomplete uses local index with ≤8 results
- Selection + reference + lookup lifecycle works end-to-end
- Legal-time warning appears when applicable
- Existing jurisdictions are unaffected

### DK-F — Runtime Acceptance + Independent Review

**Scope:**

- End-to-end runtime testing with real sources (manual or automated)
- Performance validation (<250 ms autocomplete)
- Independent code review
- Full regression test pass

**Acceptance:**

- Autocomplete responds within 250 ms locally
- Legal text retrieval works for known canonical ELI identities
- All error conditions produce appropriate user feedback
- No regressions in existing jurisdictions

---

## 19. Likely Files / Components

### New Files (Eventually)

| Component | Likely Path |
|---|---|
| `RetsinformationLawProvider` | `src/law/providers/RetsinformationLawProvider.ts` |
| `RetsinformationDiscoveryIndex` | `src/law/providers/RetsinformationDiscoveryIndex.ts` |
| `RetsinformationLawDiscovery` | `src/law/providers/RetsinformationLawDiscovery.ts` |
| `RetsinformationDiscoveryIndexStorage` | `src/law/providers/RetsinformationDiscoveryIndexStorage.ts` |
| `RetsinformationAtomClient` | `src/law/providers/RetsinformationAtomClient.ts` |
| `RetsinformationParser` | `src/law/providers/RetsinformationParser.ts` (or integrated into `parser.ts`) |
| DK-specific types | `src/law/retsinformationTypes.ts` |

### Existing Files to Modify

| File | Change |
|---|---|
| `src/law/types.ts` | Add `"DK"` to `LawJurisdiction` |
| `src/law/lawMetadataSearch.ts` | Add `"DK"` to `LawMetadataJurisdiction` so `RetsinformationLawDiscovery` can emit normal `LawMetadataSearchEntry` values and reuse `searchLawMetadata`/shared ranking |
| `src/law/providerComposition.ts` | Add DK provider mapping and registration |
| `src/law/LawProvider.ts` | No change (existing interface is sufficient) |
| `src/law/ProviderRegistry.ts` | No change (generic registry) |
| `src/parser.ts` | Add DK parser dispatch |
| `src/main.ts` | Register DK provider and discovery index |
| `src/ui/LawLookupModal.ts` | Add DK-specific UI behaviors (placeholder, warning) |
| `src/law/LawSectionCache.ts` | Add DK cache key generation |
| `src/ui/i18nCatalog.ts` | Add DK-specific UI strings |

### Test Files (Eventually)

| Test File | Scope |
|---|---|
| `tests/RetsinformationLawProvider.test.ts` | Provider tests |
| `tests/RetsinformationDiscoveryIndex.test.ts` | Index bootstrap/refresh tests |
| `tests/RetsinformationParser.test.ts` | Parser tests |
| `tests/dkParser.test.ts` | DK-specific parser patterns |
| `tests/parser.test.ts` | Add DK cases to existing parser tests |

---

## 20. Non-Goals

The following are explicitly excluded from v1 DK support:

| Non-Goal | Rationale |
|---|---|
| Unofficial `retsinformation-api.dk` | Unofficial; not source-backed |
| Dynamic amendment synthesis | Not provable; fails legal-time contract |
| Legal advice / currentness guarantee | Out of scope; this is a reference tool, not legal advice |
| Machine translation | No machine translation for any jurisdiction |
| Greenland / Faroe special jurisdiction model | Not modeled in v1 |
| Chapter / Bilag lookup in v1 | Not compatible with existing reference model |
| Background daemon / service | Plugin runs within Obsidian; no background processes |
| Server-side infrastructure | Client-side only |
| Secrets / API credentials | Official sources are publicly accessible |
| Remote autocomplete per keystroke | Local index; no network per keystroke |
| Curated partial-coverage fallback | Explicitly rejected in this design |

---

## 21. Open Questions

### ~~Q1: Exact Official Metadata Source for Full Bootstrap~~ — RESOLVED

**Resolution:** Per-ELI official JSON-LD metadata representation.

Bootstrap metadata is obtained from `https://www.retsinformation.dk/eli/{pubMedia}/{year}/{number}.json` (`application/ld+json`). This endpoint returns complete metadata (title, popular title, type, number, status, ministry, accession number) without legal body text. One request per canonical ELI identity is required.

The sitemap provides enumeration (URLs + `lastmod`). The Atom feed (60-day retention) and Harvest API (10-day lookback) are unsuitable for complete initial bootstrap.

LexDania XML (`/xml`) remains the legal-text source for the provider, not the bootstrap metadata source.

### ~~Q2: Direct LexDania XML Operational Constraints~~ — RESOLVED

**Resolution:** Conservative access; no explicit numeric limit found for ELI representation endpoints.

No documented numeric rate limit was found for `/eli/.../xml` or `/eli/...json`. The Harvest API's 1-request/10-second limit applies only to `/v1/Documents` and must not be transferred to ELI representation endpoints without source evidence.

Approved access model: conservative sequential access, exponential backoff, honor Retry-After, retry/stop on 429/503, resumable bootstrap, no aggressive crawling. Concurrency may only be increased with source-backed evidence.

The provider must validate LexDania XML response bodies structurally and must not reject responses solely because of an incorrect HTTP Content-Type header (observed `text/html` for valid XML).

### ~~Q3: Exact User-Facing Wording for LBK vs. Amendment Warning~~ — RESOLVED

**Resolution:** Accepted legal-time wording contract (see Section 4, User-Facing Semantics).

- Normal LBK: "Official consolidated text dated {date}."
- Later amendments recorded: "Later amendments are recorded and may not be incorporated in this consolidation."
- Currentness unavailable: "Currentness information could not be verified."
- No "latest" wording in v1 unless Q5 is resolved.
- Atom sync signals alone never trigger amendment warning.

### ~~Q4: Appropriate Full-Reconciliation Cadence~~ — RESOLVED

**Resolution:** Daily incremental / monthly full reconciliation / retention-gap recovery (see Section 9, Refresh Cadence).

- Incremental Atom refresh: at most once per day (≥24 hours since last).
- Full reconciliation: monthly (>31 days since last).
- Retention-gap recovery: mandatory immediate full reconciliation.
- Selective refetch: `.json` fetched only for new/changed ELI; unchanged entries skipped.

### Q5: Official Same-Law / Version-Lineage Mechanism — OPEN

An official, source-backed mechanism to prove that a given LBK is the latest consolidation for a specific law (same-law lineage) has not been established. Without this mechanism, the system cannot claim "latest LBK" or implement a "Gå til seneste LBK" feature.

**Status:** Unresolved. The sitemap and Atom feed alone do not establish same-law lineage. This must be resolved before any "latest" claim or version-lineage navigation is implemented.

**v1 behavior while Q5 is unresolved:**

- Concrete ELI identity only.
- Publication/consolidation date may be shown.
- No "latest" claim.
- No automatic version-lineage navigation.

**Q5 is NOT a blocker for v1 implementation.**

---

## 22. Decision Record

| Decision ID | Value | Rationale |
|---|---|---|
| `DECISION_DISCOVERY` | `LOCAL_OFFICIAL_INDEX` | No official interactive title-search API exists; local index is the only viable path |
| `DECISION_NETWORK_AUTOCOMPLETE` | `NO` | Harvest API is not an interactive search endpoint; no per-keystroke HTTP |
| `DECISION_CURATED_FALLBACK` | `NO` | Curated subset breaks uniformity; incomplete coverage; manual curation burden |
| `DECISION_TEXT_SOURCE` | `OFFICIAL_LEXDANIA_XML` | Official LexDania XML is the authoritative legal text source |
| `DECISION_IDENTITY` | `CANONICAL_ELI` | `/eli/{pubMedia}/{year}/{number}` is stable, title-independent, collision-resistant |
| `DECISION_CURRENTNESS` | `LATEST_PROMULGATED_CONSOLIDATION_NOT_SYNTHETIC_CURRENT_STATE` | LBK is a consolidation, not a live current state; synthesis is not provable |
| `DECISION_LANGUAGE` | `DA_ONLY` | Danish source text only; no machine translation |
| `DECISION_UNOFFICIAL_API` | `REJECTED` | `retsinformation-api.dk` is unofficial; not source-backed |
| `DECISION_IMPLEMENTATION_MODE` | `SLICED_TDD` | Six slices with independent acceptance boundaries; TDD throughout |
| `DECISION_BOOTSTRAP_ENUMERATION` | `ELI_SITEMAP` | Canonical ELI identities enumerated from official sitemap index + 21 pages |
| `DECISION_BOOTSTRAP_METADATA` | `PER_ELI_JSON_LD` | Per-ELI JSON-LD `.json` endpoint; metadata-only; no body text; lighter than XML |
| `DECISION_BOOTSTRAP_ACCESS` | `CONSERVATIVE_SEQUENTIAL_RESUMABLE` | No documented numeric limit for ELI endpoints; conservative sequential with backoff |
| `DECISION_INCREMENTAL_REFRESH` | `DAILY_24H` | Atom incremental refresh eligible at most once per day |
| `DECISION_FULL_RECONCILIATION` | `MONTHLY_31D` | Full sitemap reconciliation monthly; selective refetch by lastmod |
| `DECISION_RETENTION_GAP` | `MANDATORY_FULL_RECONCILIATION` | Watermark older than feed retention triggers immediate full reconciliation |
| `DECISION_LATEST_LBK` | `DISABLED_UNTIL_SOURCE_BACKED_LINEAGE` | No "latest" claim in v1; Q5 must resolve same-law/version-lineage first |

---

*This specification is documentation only. No implementation is performed in this task.*
