# European Law Lookup

**European Law Lookup** brings official European legal text into Obsidian with an EU-first workflow, while continuing to support selected German, Austrian, and Swiss law.

Look up supported EU regulations, directives, and decisions by human-readable citation or CELEX identifier, choose from the 24 official EU languages, preview the retrieved legal text and source information, and insert the formatted result into your active note only when you explicitly confirm the insertion.

## Highlights

- **EU-first legal lookup** for supported sector-3 regulations, directives, and decisions.
- **Human-readable EU citations** such as `Richtlinie 2011/61/EU Art. 1` and `Verordnung (EU) 2024/3110 Art. 1`.
- **Direct CELEX lookup** such as `32016R0679 Art. 1`.
- **24 official EU languages** for official EU legal text when the requested language expression is available.
- **Germany, Austria, and Switzerland** remain available as additional jurisdictions.
- **Official-source retrieval** from EUR-Lex / Publications Office CELLAR, Gesetze im Internet, RIS, and Fedlex.
- **Preview before insertion** so a lookup never modifies a note without an explicit user action.
- **Source-aware metadata** for citations, retrieval dates, jurisdiction, language, cache state, and source status where available.
- **Local caching** of successful legal-text lookups.
- **No AI-generated legal text and no machine-generated translations.**

## Demo

![European Law Lookup demo](assets/german-law-lookup-demo.gif)

## European Union

EU legislation is the primary focus of European Law Lookup.

The local EU metadata index discovers supported sector-3 acts from the Publications Office CELLAR. The index is used to resolve legal-act identity and available official language expressions; legal text is retrieved from the authoritative provider path when you perform a lookup.

### Supported EU act families

The generic EU index admits supported sector-3 CELEX acts of these document types:

- Regulations (`R`)
- Directives (`L`)
- Decisions (`D`)

The current lookup workflow is article-oriented.

### EU input examples

Human-readable references:

- `Richtlinie 2011/61/EU Art. 1`
- `Verordnung (EU) 2024/3110 Art. 1`
- `Art. 6 DSGVO`
- `GDPR Art. 6`

Direct CELEX references:

- `32016R0679 Art. 1`

Human-readable resolution is intentionally fail-closed where a reference is ambiguous. Direct CELEX input remains available for supported acts.

### EU languages

European Law Lookup supports the 24 official EU languages for EU legal text:

Bulgarian, Croatian, Czech, Danish, Dutch, English, Estonian, Finnish, French, German, Greek, Hungarian, Irish, Italian, Latvian, Lithuanian, Maltese, Polish, Portuguese, Romanian, Slovak, Slovenian, Spanish, and Swedish.

The plugin requests official language expressions from EU sources. It does not generate translations. If the requested official expression is unavailable, the provider path follows the plugin's defined language/fallback rules rather than inventing text.

### EU metadata refresh

The EU act index is stored locally in dedicated compact index files instead of inside the normal Obsidian plugin settings document.

A stale index may be refreshed in the background when the plugin loads. This refresh contacts the Publications Office CELLAR and can take time because it validates a large public corpus. The last-known-good local index remains the authority until a new candidate index has been completely written and activated.

A metadata refresh is separate from an individual legal-text lookup.

### Current EU boundaries

European Law Lookup does **not** claim generic support for every possible CELEX resource or document component.

The current generic EU workflow is focused on supported sector-3 regulations, directives, and decisions and on article lookup. Recitals, annexes, corrigenda, arbitrary non-`R`/`L`/`D` document families, and other unsupported reference forms remain outside the guaranteed scope unless explicitly added in a future release.

## Germany

The German scope covers selected federal laws through the validated **Gesetze im Internet** provider path.

Examples:

- `§ 823 BGB`
- `BGB 823`
- `§ 242 StGB`
- `SGB V § 1`
- `Art. 1 GG`
- `Art. 229 § 6 EGBGB`

Published English legal text is used only for explicitly configured official or published sources. If no supported English source exists, the lookup uses the configured German official-text behavior. The plugin never creates its own translation.

The complete supported-law catalog and example inputs are available in the plugin settings.

## Austria

The Austrian scope covers 24 explicitly mapped federal laws through **RIS (Rechtsinformationssystem des Bundes)**.

Examples:

- `§ 1295 ABGB`
- `§ 75 StGB`
- `Art. 144 B-VG`
- `§ 1 GmbHG`
- `§ 35a DSG`

German and Austrian laws with the same abbreviation remain isolated by jurisdiction.

RIS consolidated federal-law text is an informational, legally non-binding version and is not presented as an authentic Federal Law Gazette publication.

The complete supported-law catalog is available in the plugin settings.

## Switzerland

The Swiss scope covers article references for 23 explicitly mapped federal laws through **Fedlex**.

Examples:

- `Art. 8 BV`
- `Art. 1 ZGB`
- `Art. 1 OR`
- `Art. 1 DSG`

Supported Swiss legal-text languages are:

- German
- French
- Italian

The settings UI also presents the official full titles of the mapped Swiss laws in these languages.

Swiss section-style references, cantonal law, and unlisted federal laws remain outside the current scope.

## How it works

1. Open the command palette.
2. Run the law lookup command.
3. Select the jurisdiction.
4. Enter a supported legal reference.
5. Select the desired legal-text language where applicable.
6. Review the legal text, citation, and source information.
7. Insert the result into the active note.

The plugin never inserts or changes note content without an explicit insertion action.

## Sources and legal status

European Law Lookup retrieves legal information from public official or governmental legal-information services:

- **European Union:** Publications Office CELLAR and EUR-Lex.
- **Germany:** Gesetze im Internet.
- **Austria:** RIS, Bundesrecht konsolidiert.
- **Switzerland:** Fedlex.

The plugin is a research and productivity tool, not legal advice.

Always verify legal text, version, applicability, consolidation status, and source status against the relevant official publication before relying on it.

## Privacy and network access

- Note contents are not sent to legal-information providers.
- The plugin does not use AI services to generate legal text.
- The plugin never generates translations.
- Legal-text network requests occur when you start a lookup that is not satisfied by the configured local cache.
- A stale EU metadata index may trigger a background CELLAR metadata refresh when the plugin loads.
- The EU metadata refresh concerns public act metadata; it does not upload note contents.
- Successful legal-text results may be cached locally according to the plugin settings.
- The EU metadata index is persisted locally in dedicated plugin files.

## Installation

### Obsidian Community Plugins

Install **European Law Lookup** from Obsidian's Community Plugins directory and enable it under **Settings → Community plugins**.

### Manual installation

The technical plugin identifier intentionally remains `german-law-lookup` for compatibility with existing installations.

Create or use:

```text
<your-vault>/.obsidian/plugins/german-law-lookup/
```

Copy exactly these release assets into it:

- `manifest.json`
- `main.js`
- `styles.css`

Reload Obsidian and enable **European Law Lookup**.

## Compatibility and rename note

Version 0.4.0 introduces the public name **European Law Lookup**.

The visible plugin name and repository branding change, but the Obsidian plugin ID remains:

```text
german-law-lookup
```

Keeping the existing ID preserves continuity for current installations and updates.

The GitHub repository is intended to move from `german-law-lookup` to `european-law-lookup` after the 0.4.0 release is published and verified.

## Development

Install the locked dependencies:

```bash
npm ci
```

Run the complete test suite:

```bash
npm test
```

Run lint:

```bash
npm run lint
```

Build the production bundle:

```bash
npm run build
```

## Release assets

An Obsidian release contains:

- `manifest.json`
- `main.js`
- `styles.css`

`versions.json` remains in the repository to map plugin versions to their minimum supported Obsidian version.

Do not include `node_modules`, test output, source maps, local EU index files, or other development/runtime-local files in release assets.

## License

MIT. See [LICENSE](LICENSE).
