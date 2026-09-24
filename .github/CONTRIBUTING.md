# Contributing to European Law Lookup

Thank you for contributing to European Law Lookup.

## Reporting bugs and requesting enhancements

Use the repository's GitHub issue tracker for reproducible bugs, feature requests, and other non-security feedback:

https://github.com/GammaFunds/European-Law-Lookup/issues

Before opening an issue, check whether an existing issue already covers the same problem or request. For bugs, include the plugin version, Obsidian version, jurisdiction or lookup form involved, steps to reproduce, expected behavior, and observed behavior when those details are relevant.

Do not report security vulnerabilities in a public issue. Follow the private reporting process in [SECURITY.md](SECURITY.md) instead.

## Development setup

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

## Contribution process

1. Create a focused branch from the current `main` branch.
2. Make only the changes needed for the issue or improvement being addressed.
3. Add or update tests when behavior changes.
4. Run the relevant tests, lint, and build locally.
5. Ensure generated release artifacts are consistent with the source when the change affects them.
6. Open a pull request against `main` and explain the purpose, scope, and validation performed.
7. Wait for the required repository checks to pass before merging.

The `main` branch is protected. Changes are expected to arrive through pull requests rather than direct commits.

## Contribution requirements

Contributions should:

- keep unrelated changes out of the pull request;
- preserve existing behavior outside the requested scope;
- avoid committing credentials, tokens, personal data, local caches, or other secrets;
- use official or governmental legal-information sources for provider behavior;
- include tests for material behavior changes where practical;
- keep lint and the full test suite passing;
- keep generated artifacts synchronized when a source change affects them.

For legal-source changes, document the relevant official source behavior and avoid presenting non-authoritative consolidated text as authoritative.

## Security-sensitive changes

Changes to release workflows, permissions, dependency handling, source retrieval, parsing of untrusted remote content, or other security-sensitive paths should be narrowly scoped and receive additional review through the repository's automated security checks.
