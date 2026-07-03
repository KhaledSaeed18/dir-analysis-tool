<div align="center">

<a href="https://www.npmjs.com/package/dir-analysis-tool">
  <img src=".github/assets/dir-analysis-tool-banner.png" alt="dir-analysis-tool, fast and memory-safe directory analysis for your terminal" width="100%" />
</a>

<h1>dir-analysis-tool</h1>

<p><strong>A fast, memory-safe CLI for directory analysis:</strong> file classification, duplicate detection, large-file identification, HTML reports, and multiple export formats.</p>

<p>
  <a href="https://www.npmjs.com/package/dir-analysis-tool"><img src="https://shieldcn.dev/npm/dir-analysis-tool.svg?logo=npm" alt="npm version" /></a>
  <a href="https://www.npmjs.com/package/dir-analysis-tool"><img src="https://shieldcn.dev/npm/dw/dir-analysis-tool.svg" alt="npm downloads" /></a>
  <a href="https://github.com/KhaledSaeed18/dir-analysis-tool/actions/workflows/ci.yml"><img src="https://shieldcn.dev/github/ci/KhaledSaeed18/dir-analysis-tool.svg" alt="CI status" /></a>
  <a href="https://www.npmjs.com/package/dir-analysis-tool"><img src="https://shieldcn.dev/npm/types/dir-analysis-tool.svg" alt="TypeScript types" /></a>
  <a href="LICENSE"><img src="https://shieldcn.dev/npm/license/dir-analysis-tool.svg?variant=secondary" alt="License: MIT" /></a>
</p>

<p>
  <a href="https://github.com/KhaledSaeed18/dir-analysis-tool/stargazers"><img src="https://shieldcn.dev/github/stars/KhaledSaeed18/dir-analysis-tool.svg?variant=outline" alt="GitHub stars" /></a>
  <a href="https://github.com/KhaledSaeed18/dir-analysis-tool/network/members"><img src="https://shieldcn.dev/github/forks/KhaledSaeed18/dir-analysis-tool.svg?variant=outline" alt="GitHub forks" /></a>
  <a href="https://github.com/KhaledSaeed18/dir-analysis-tool/issues"><img src="https://shieldcn.dev/github/issues/KhaledSaeed18/dir-analysis-tool.svg?variant=outline" alt="GitHub issues" /></a>
  <a href="https://github.com/KhaledSaeed18/dir-analysis-tool/pulls"><img src="https://shieldcn.dev/github/prs/KhaledSaeed18/dir-analysis-tool.svg?variant=outline" alt="GitHub pull requests" /></a>
  <a href="https://github.com/KhaledSaeed18/dir-analysis-tool/releases"><img src="https://shieldcn.dev/github/release/KhaledSaeed18/dir-analysis-tool.svg?variant=ghost" alt="Latest release" /></a>
</p>

</div>

---

## Why dir-analysis-tool?

`dat` walks any directory once, streams file hashes without loading them into memory, and gives you a clear picture of what is taking up space: the largest files, duplicated content, empty files, and a full breakdown by file type. It is safe to run on huge trees, safe to pipe into other tools, and ships a polished HTML report when you want to share results.

- **Single-pass and streaming.** One filesystem walk, streaming MD5 hashing, constant memory even on multi-gigabyte trees.
- **Actionable insights.** Duplicates with wasted-space totals, large and empty file detection, top-N largest, and a type breakdown.
- **Pipe-friendly.** `--json` emits clean, ANSI-free output, and the progress bar auto-disables outside a TTY.
- **Reports and exports.** Self-contained HTML report with charts, plus CSV export for full analysis, large files, or duplicates.
- **Configurable.** Project-level `.dir-analyzer.json`, an interactive generator, and CLI flags that always win.

## Table of Contents

- [Installation](#installation)
- [Quick Start](#quick-start)
- [Features](#features)
- [CLI Reference](#cli-reference)
  - [`dat analyze`](#dat-directory--dat-analyze-directory)
  - [`dat watch`](#dat-watch-directory)
  - [`dat compare`](#dat-compare-dir1-dir2)
  - [`dat init`](#dat-init)
- [Example Output](#example-output)
- [JSON Output](#json-output)
- [Configuration](#configuration)
- [Migrating from v1](#migrating-from-v1)
- [License](#license)

## Installation

Install globally to use the `dat` command anywhere:

```bash
npm install -g dir-analysis-tool
# or
pnpm add -g dir-analysis-tool
# or
yarn global add dir-analysis-tool
```

Prefer not to install? Run it on demand with `npx`:

```bash
npx dir-analysis-tool                 # analyze the current directory
npx dir-analysis-tool /path/to/scan   # analyze any path
```

Two binaries are installed and are fully interchangeable: **`dat`** (short) and **`dir-analysis-tool`** (full). This README uses `dat` throughout.

## Quick Start

```bash
dat                                 # analyze the current directory
dat /path/to/project                # analyze any path
dat analyze . --duplicates          # find duplicate files and wasted space
dat analyze . --large-files 50      # list files larger than 50 MB
dat analyze . --html                # generate a shareable HTML report
dat analyze . --json | jq .types    # pipe-safe JSON, no ANSI codes
```

## Features

| Feature | Description |
|---|---|
| **Single-pass streaming walk** | No double I/O. Every file is `stat`'d exactly once. |
| **Streaming MD5 hashing** | Duplicate detection without ever loading a file into RAM. |
| **TTY-aware progress** | Live progress in interactive terminals, silent and clean when piped. |
| **File-type classification** | Images, videos, audio, documents, code, archives, other. |
| **Duplicate detection** | Groups identical files by content hash and reports total wasted space. |
| **Large-file detection** | Configurable threshold in MB. |
| **Empty-file detection** | Surface every zero-byte file. |
| **Top-N largest files** | Instant disk-usage overview. |
| **HTML reports** | Self-contained page with charts and tables. |
| **CSV export** | Full analysis, large-file list, or duplicate groups. |
| **Tree view** | Visual directory structure (up to 1,000 files). |
| **Watch mode** | Debounced re-analysis on every filesystem change. |
| **Directory comparison** | Side-by-side stats for two directories. |
| **Config file** | `.dir-analyzer.json` for reusable defaults. |
| **Interactive init** | `dat init` generates the config file with prompts. |

## CLI Reference

### `dat [directory]` / `dat analyze [directory]`

Analyze a directory. This is the default command, so `dat` and `dat analyze` are equivalent. Defaults to the current working directory.

```bash
dat                              # analyze cwd
dat /path/to/project             # explicit path
dat analyze . --json             # JSON output (no ANSI, pipe-safe)
dat analyze . --tree             # directory tree view
dat analyze . --duplicates       # detect duplicate files
dat analyze . --large-files      # files > 100 MB (default threshold)
dat analyze . --large-files 50   # files > 50 MB
dat analyze . --empty-files      # detect zero-byte files
dat analyze . --top-n 20         # top 20 largest files
dat analyze . --html             # generate an HTML report
dat analyze . --csv              # export to CSV
dat analyze . --exclude node_modules dist coverage
dat analyze . --max-depth 3      # limit scan depth
dat analyze . --min-size 1000    # files >= 1 KB only
dat analyze . --date-from 2024-01-01 --date-to 2024-12-31
```

**Options**

| Flag | Description |
|---|---|
| `--no-recursive` | Disable recursive scan. |
| `-j, --json` | JSON output (suppresses progress, safe to pipe). |
| `--tree` | Show directory tree. |
| `--no-types` | Hide the file-type breakdown. |
| `-e, --exclude <patterns...>` | Exclude dirs/files by name or glob. |
| `-l, --large-files [mb]` | Detect large files (default threshold: 100 MB). |
| `-d, --duplicates` | Enable duplicate detection. |
| `--empty-files` | Detect zero-byte files. |
| `--top-n <n>` | Show the top N largest files. |
| `--max-depth <depth>` | Limit directory depth. |
| `--min-size <bytes>` | Minimum file-size filter. |
| `--max-size <bytes>` | Maximum file-size filter. |
| `--date-from <YYYY-MM-DD>` | Files modified on or after this date. |
| `--date-to <YYYY-MM-DD>` | Files modified on or before this date. |
| `--csv [filename]` | Export full analysis to CSV. |
| `--csv-large [filename]` | Export the large-file list to CSV. |
| `--csv-duplicates [filename]` | Export duplicate groups to CSV. |
| `--html [filename]` | Generate an HTML report with charts. |
| `-c, --config [path]` | Path to a config file (auto-detected by default). |

---

### `dat watch [directory]`

Watch a directory and re-analyze automatically (debounced 2 s) after each change. Accepts the same analysis flags as `dat analyze`.

```bash
dat watch .
dat watch /path/to/project --duplicates --top-n 10
```

---

### `dat compare <dir1> <dir2>`

Compare two directories side by side. Useful for diffing a build against its source, or comparing two versions of a project.

```bash
dat compare src/ dist/
dat compare /project-v1 /project-v2 --json
```

---

### `dat init`

Interactively create a `.dir-analyzer.json` config file in the current directory.

```bash
dat init
```

## Example Output

Running `dat analyze . --duplicates --top-n 3` on a project prints a color-coded summary:

```text
Directory: /Users/you/project
Total Size: 48.2 MB
Folders: 214
Files: 1,932

File Types:
  Images: 42
  Documents: 18
  Code: 1,806
  Archives: 3
  Other: 63

Duplicates: 4 groups, 6.1 MB wasted
  ab12cd...  (3 files, 2.0 MB each)
    src/assets/logo.png
    public/logo.png
    dist/logo.png

Top 3 Largest Files:
  1. dist/bundle.js, 5.4 MB
  2. assets/demo.mp4, 3.1 MB
  3. docs/manual.pdf, 1.2 MB
```

> Piping the same command with `--json` produces machine-readable output with no ANSI escape codes and no progress bar, ideal for CI and scripting.

## JSON Output

`dat analyze . --json` emits the full result object. Optional sections (`largeFiles`, `duplicateGroups`, `duplicateStats`, `emptyFiles`, `topLargestFiles`, `treeView`) appear only when the corresponding flag is enabled.

```jsonc
{
  "path": "/absolute/path",
  "totalSizeBytes": 12345678,
  "totalSizeFormatted": "12.3 MB",
  "totalSizeMB": 12.3,
  "folders": 42,
  "files": 512,
  "types": {
    "images": 10, "videos": 0, "documents": 5,
    "audio": 0, "code": 480, "archives": 2, "other": 15
  },
  "largeFiles": [
    { "path": "...", "size": 104857600, "sizeFormatted": "105 MB" }
  ],
  "duplicateGroups": [
    { "hash": "...", "size": 4096, "sizeFormatted": "4.1 kB",
      "files": ["...", "..."], "wastedSpace": 4096, "wastedSpaceFormatted": "4.1 kB" }
  ],
  "duplicateStats": {
    "totalGroups": 3, "wastedSpace": 12288, "wastedSpaceFormatted": "12.3 kB"
  },
  "emptyFiles": [
    { "path": "...", "mtime": "2024-01-01T00:00:00.000Z" }
  ],
  "topLargestFiles": [
    { "path": "...", "size": 1048576, "sizeFormatted": "1.05 MB" }
  ],
  "treeView": "project\n  ..."
}
```

## Configuration

Create `.dir-analyzer.json` in your project root (or run `dat init`):

```json
{
  "excludePatterns": ["coverage", "tmp", "__pycache__"],
  "clearDefaultExclusions": false,
  "largeSizeThresholdMB": 100,
  "enableDuplicateDetection": false,
  "maxDepth": -1,
  "topN": 10,
  "showEmptyFiles": false
}
```

| Key | Type | Default | Description |
|---|---|---|---|
| `excludePatterns` | `string[]` | `[]` | Names or globs (for example `*.log`) to exclude, on top of the defaults. |
| `clearDefaultExclusions` | `boolean` | `false` | When `true`, ignore the built-in default exclusions. |
| `largeSizeThresholdMB` | `number` | `100` | Large-file threshold in MB. |
| `enableDuplicateDetection` | `boolean` | `false` | Enable content-hash duplicate detection. |
| `maxDepth` | `number` | `-1` | Maximum directory depth (`-1` means unlimited). |
| `topN` | `number` | none | Number of largest files to report. |
| `showEmptyFiles` | `boolean` | `false` | Include zero-byte files in the report. |

`dat` searches for the config starting in the current directory and walking up the tree (both `.dir-analyzer.json` and `dir-analyzer.config.json` are recognized). **CLI flags always override config values.**

**Default excluded directories** (unless `clearDefaultExclusions: true`): `node_modules`, `.git`, `.svn`, `.hg`, `dist`, `build`, `.cache`.

## Migrating from v1

| v1 | v2 |
|---|---|
| `dir-analysis-tool` | `dat` (or still `dir-analysis-tool`) |
| `--path <dir>` | positional argument: `dat <dir>` |
| `--interactive` | `dat init` (creates config) |
| `--progress` / `--no-progress` | auto-detected from TTY |
| `--large-files <bytes>` | `--large-files <mb>` (value now in MB) |
| `bin/` build output | `dist/` build output |

## License

[MIT](LICENSE), by [Khaled Saeed](https://github.com/KhaledSaeed18).
