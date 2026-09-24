# Changelog

All notable changes to European Law Lookup are documented in this file.

## [0.6.1] - 2026-09-24

### Fixed

- Explicitly declared TypeScript libraries for modern APIs already used by the providers and removed redundant Finlex metadata type assertions.

### Scope and safety

- No runtime or provider behavior changed.

## [0.6.0] - 2026-09-23

### Added

- Finland support through Finlex.
- Italy support through Normattiva.
- Netherlands support through BWB.

### Removed

- Denmark integration from runtime support.

## [0.5.4] - 2026-09-11

### Fixed

- Resolved Obsidian review warnings in the production code and strengthened the corresponding lint rules.
- Added support for full EU citations in law-title autocomplete while preserving jurisdiction-scoped lookup behavior.

## [0.5.3] - 2026-09-11

### Fixed

- Restored Spain / BOE law lookup across discovery, provider integration, metadata search, and the lookup modal.

## [0.5.2] - 2026-09-09

### Fixed

- Replaced `String.prototype.matchAll()` in Spain / BOE permalink parsing with an ES2018-compatible `RegExp.exec()` loop.

### Scope and safety

- No lookup semantics, BOE identity validation, dependencies, or minimum Obsidian version changed.

## [0.5.1] - 2026-09-09

### Added

- Added Spain / BOE law lookup.

### Fixed

- Removed a `:has()` selector from settings styles for broader Obsidian compatibility.

## [0.5.0] - 2026-09-07

### Added

- Added jurisdiction-scoped law-title autocomplete.
- Added autocomplete support backed by the production EU act index.
- Added selected-law confirmation before reference entry.

### Documentation

- Updated the public documentation for the 0.5.0 lookup workflow and supported features.

## [0.4.3] - 2026-09-06

### Changed

- Raised the minimum supported Obsidian version to 1.13.0.
- Updated `eslint-plugin-obsidianmd` to 0.4.2.
- Completed the declarative settings path and removed the legacy settings-refresh implementation.

### Fixed

- Tightened EU language type handling and settings rendering around the declarative Obsidian settings API.

## [0.4.2] - 2026-09-05

### Changed

- Updated the Obsidian development API dependency to 1.13.0 while retaining the then-declared 1.8.0 minimum runtime version.
- Updated the public plugin description and README wording.

### Improved

- Expanded the declarative settings surface and its regression coverage.

## [0.4.1] - 2026-09-05

### Fixed

- Addressed additional Obsidian and TypeScript lint findings, including timer usage and redundant type assertions.
- Tightened EU notice parsing so ordinary opening tags remain accepted while self-closing URI-like tags are rejected.

### Quality

- Added stricter lint checks for unnecessary assertions, redundant type constituents, useless escapes, and Obsidian timer usage.

## [0.4.0] - 2026-09-05

### Changed

- Adopted the public product name **European Law Lookup** while retaining the existing plugin identifier for compatibility.

### Improved

- Improved multilingual EU and Swiss law lookup.
- Strengthened EU act-index persistence and refresh handling, citation parsing, language handling, cache behavior, and lookup UI coverage.

## [0.3.0] - 2026-09-02

### Added

- Generic CELEX support for original, unsuffixed sector-3 R (regulation), L (directive), and D (decision) acts, resolved directly from the official CELEX identifier without curated per-act mappings.
- A self-updating local CELLAR act index that discovers newly published supported EU acts independently of plugin releases.
- The CELLAR Identifier Notice as the legal-identity authority for each resolved EU act.
- Dynamic handling of official EU publication languages for generic acts, without silent fallback to other languages and without machine translation.
- AI Act and Data Act support through the same generic EU act architecture.

### Scope and safety

- The local act index is advisory only and is not a legal authority; the Identifier Notice remains the authority for an act's legal identity.
- Unsupported CELEX classes remain rejected.
- Consolidated versions, corrigenda, recitals, annexes, treaties, case law, and preparatory acts are not silently admitted.
- The plugin never generates translations.
- Requested languages are not rewritten by stale index metadata.

## [0.2.2] - 2026-07-17

### Fixed

- Removed type-aware scanner warnings from provider parsing and replaced the remaining generic Obsidian element helpers with specialized helpers.
- Added declarative settings search support with the legacy `display()` fallback for Obsidian versions below 1.13.0.
- Removed irregular whitespace and unused constants.
- Resolved the reported `prefer-create-el` findings in source; no plugin-owned TypeScript `document.createElement` calls were present.
- Added GitHub artifact attestations for release bundles.

### Scope and safety

- No provider, parsing, lookup, cache, formatting, legal-source, network-domain, or insertion behavior changed.
- Existing network disclosures remain accurate.

## [0.2.1] - 2026-07-17

### Fixed

- Removed the redundant product name from the plugin description to satisfy the community-plugin manifest review.

## [0.2.0] - 2026-07-16

### Added

- A jurisdiction selector for Germany, Austria, and Switzerland.
- Explicit Austrian RIS support for 24 federal laws.
- Published English B-VG article text as the only Austrian English-language slice.
- German article lookup for 23 explicitly mapped Swiss federal laws through Fedlex.
- A multilingual GDPR/DSGVO article-lookup pilot with 24 official EU languages through Cellar and EUR-Lex.
- Jurisdiction-specific supported-law catalogs and example inputs in the plugin settings.
- Jurisdiction- and language-aware cache isolation.
- German and English plugin UI localization based on the active Obsidian locale.

### Improved

- The visible plugin title now reflects its German, Austrian, and Swiss legal scope.
- Legal-text preview, source metadata, insertion controls, and keyboard-accessible jurisdiction tabs.
- RIS extraction to exclude navigation, scripts, metadata chrome, and footer content.
- Provider boundaries for colliding abbreviations such as StGB, DSG, and ZPO.
- Source-status wording for RIS consolidated informational text.
- Reproducible production builds and broader parser, provider, cache, formatter, UI, and collision regression coverage.

### Scope and safety

- Law text is inserted only after an explicit user action.
- Provider requests occur only for user-initiated lookups.
- The plugin does not send note contents to legal-information providers.
- The plugin never generates translations.
- EU functionality remains limited to the GDPR/DSGVO pilot; generic CELEX lookup, arbitrary EU acts, consolidated versions, recitals, annexes, and the AI Act are not included.
- Swiss cantonal law and general Austrian English translations are not included.
- The plugin is a research and productivity tool and does not provide legal advice.

## Earlier 0.1.x releases

The 0.1.x line established the German federal-law lookup, preview, explicit insertion, local cache, published-English-source support for selected German laws, and the initial release structure.
