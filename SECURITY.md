# Security policy

## Supported versions

Only the latest major version receives fixes. At the moment that is 3.x.

## Reporting a vulnerability

Please report vulnerabilities privately through [GitHub security advisories](https://github.com/KhaledSaeed18/dir-analysis-tool/security/advisories/new), not in a public issue. Include the version, your platform, and steps to reproduce. You can expect a first response within a few days.

## Scope notes

`dat` only reads the directories you point it at. It writes files only when you ask for a report file (`--output`, `--html`, `--csv`, or `dat init`). HTML reports are self-contained and declare a Content-Security-Policy that blocks all network requests, and CSV exports neutralize cells that a spreadsheet could run as formulas. Releases are published from GitHub Actions with npm provenance, so you can verify that a published version was built from this repository.
