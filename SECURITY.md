# Security policy

## Supported versions

dir-analysis-tool follows [semantic versioning](https://semver.org). Security fixes go into the latest 3.x release. Upgrading within 3.x is safe by design: the [stability promise](https://github.com/KhaledSaeed18/dir-analysis-tool#stability) keeps commands, options, exit codes, the JSON report and the library API compatible.

| Version | Supported                     |
| ------- | ----------------------------- |
| 3.x     | Yes, the latest minor release |
| < 3.0   | No. Upgrade to 3.x            |

## Reporting a vulnerability

**Please don't report vulnerabilities in public issues, discussions or pull requests.**

Report them privately through GitHub: open the repository's [Security tab and choose "Report a vulnerability"](https://github.com/KhaledSaeed18/dir-analysis-tool/security/advisories/new). Only the maintainer can see the report. If you can't use GitHub, email [khaled18saeed@gmail.com](mailto:khaled18saeed@gmail.com) with "dir-analysis-tool security" in the subject.

A useful report includes:

- the version (`dat --version`), your OS and your Node.js version,
- the exact command, or the library call, and the options or config file it used,
- what happened and what an attacker gains from it,
- a minimal reproduction, such as a small directory layout or a file name that triggers the problem.

## What happens next

dir-analysis-tool is maintained by one person, so these are goals, not guarantees:

- an acknowledgement within 3 working days,
- an assessment, and a plan or a reason for declining, within 10 working days,
- a fix released as soon as it is ready, with a [GitHub security advisory](https://github.com/KhaledSaeed18/dir-analysis-tool/security/advisories) and a CVE where one applies.

Please keep the report private until the fix is released. You'll be credited in the advisory unless you ask not to be.

## Scope

dir-analysis-tool reads directories that may hold files from anyone: downloads, archives, a pull request's checkout. Their names and contents are untrusted input.

**In scope**, as vulnerabilities:

- **Output injection.** A file or folder name reaching your terminal or a report unescaped. Names are escaped in every format: control characters and bidirectional overrides in the terminal and Markdown, HTML escaping in the HTML report, JSON escaping, and CSV cells that a spreadsheet could run as formulas are neutralized. A name that gets through, for example to move the cursor, change the window title, run script in the HTML report or a formula in a spreadsheet, is a vulnerability.
- **The HTML report.** It is one self-contained file whose Content-Security-Policy blocks every network request. A report that loads anything from the network, or runs script that came from the scanned tree, is a vulnerability.
- **Writing or changing files.** `dat` writes only the report files you ask for (`--output`, `--html`, `--csv`) and the config file `dat init` creates. It never deletes or modifies scanned files. Anything else it writes is a vulnerability.
- **Escaping the scan.** Following a symbolic link out of the scanned directory without `--follow-symlinks`, or reading the contents of scanned files other than `.gitignore` and config files, except for `--duplicates` and `compare --content`.
- **Resource exhaustion from crafted input.** A file name, `.gitignore` pattern or directory shape that makes a scan hang or use unbounded memory, beyond what the README's FAQ describes.
- **The release pipeline.** Anything that could let someone other than the maintainer publish a version to npm.

**Out of scope:**

- **What you point it at.** `dat` reads with your privileges. Scanning a directory you can read is not a vulnerability, even if it holds secrets; don't share reports of private directories.
- **Development dependencies.** The published package has no runtime dependencies. Advisories in dev tooling don't reach users unless they affect the published files; Dependabot handles them.

## Verifying a release

Releases are published from GitHub Actions through npm trusted publishing, with a signed [provenance statement](https://docs.npmjs.com/generating-provenance-statements) that ties the package to the commit and workflow that built it. To check what you installed:

```sh
npm audit signatures
```

The package's npm page also shows the provenance under "Provenance".
