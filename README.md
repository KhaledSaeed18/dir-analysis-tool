# dir-analysis-tool

[![npm version](https://img.shields.io/npm/v/dir-analysis-tool.svg)](https://www.npmjs.com/package/dir-analysis-tool)
[![CI](https://github.com/KhaledSaeed18/dir-analysis-tool/actions/workflows/ci.yml/badge.svg)](https://github.com/KhaledSaeed18/dir-analysis-tool/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js Version](https://img.shields.io/node/v/dir-analysis-tool.svg)](https://nodejs.org/)

A fast, memory-safe CLI for directory analysis — file classification, duplicate detection, large-file identification, HTML reports, and multiple export formats.

## Quick Start

```bash
npm install -g dir-analysis-tool   # install globally

dat                                 # analyze current directory
dat /path/to/project                # analyze any path
dat analyze . --json | jq .files   # pipe-safe JSON output
```

## Features

| Feature | Description |
|---|---|
| Single-pass streaming walk | No double I/O — files are stat'd once |
| Streaming MD5 hashing | Duplicate detection without loading files into RAM |
| TTY-aware progress | Progress bar only in interactive terminals; silent in pipes |
| File type classification | Images, videos, audio, documents, code, archives, other |
| Duplicate detection | Groups identical files by content hash; shows wasted space |
| Large-file detection | Configurable threshold in MB |
| Empty-file detection | Find all zero-byte files |
| Top-N largest files | Quick disk usage overview |
| HTML reports | Charts and tables, matrix/terminal aesthetic |
| CSV export | Full analysis, large files, or duplicates |
| Tree view | Visual directory structure (up to 1 000 files) |
| Watch mode | Debounced re-analysis on every filesystem change |
| Directory comparison | Side-by-side stats for two directories |
| Config file | `.dir-analyzer.json` for default settings |
| Interactive init | `dat init` creates the config file with prompts |

## CLI Reference

### `dat [directory]` / `dat analyze [directory]`

Analyze a directory. Defaults to the current working directory.

```bash
dat                              # analyze cwd
dat /path/to/project             # explicit path
dat analyze . --json             # JSON output (no ANSI, pipe-safe)
dat analyze . --tree             # directory tree view
dat analyze . --duplicates       # detect duplicate files
dat analyze . --large-files      # files > 100 MB
dat analyze . --large-files 50   # files > 50 MB
dat analyze . --empty-files      # detect zero-byte files
dat analyze . --top-n 20         # top 20 largest files
dat analyze . --html             # generate HTML report
dat analyze . --csv              # export to CSV
dat analyze . --exclude node_modules dist coverage
dat analyze . --max-depth 3      # limit scan depth
dat analyze . --min-size 1000    # files >= 1 KB only
dat analyze . --date-from 2024-01-01 --date-to 2024-12-31
```

**Options**

| Flag | Description |
|---|---|
| `--no-recursive` | Disable recursive scan |
| `-j, --json` | JSON output (suppresses progress, safe to pipe) |
| `--tree` | Show directory tree |
| `--no-types` | Hide file-type breakdown |
| `-e, --exclude <patterns...>` | Exclude dirs/files by name or glob |
| `-l, --large-files [mb]` | Detect large files (default threshold: 100 MB) |
| `-d, --duplicates` | Enable duplicate detection |
| `--empty-files` | Detect zero-byte files |
| `--top-n <n>` | Show top N largest files |
| `--max-depth <depth>` | Limit directory depth |
| `--min-size <bytes>` | Minimum file size filter |
| `--max-size <bytes>` | Maximum file size filter |
| `--date-from <YYYY-MM-DD>` | Files modified after this date |
| `--date-to <YYYY-MM-DD>` | Files modified before this date |
| `--csv [filename]` | Export full analysis to CSV |
| `--csv-large [filename]` | Export large-file list to CSV |
| `--csv-duplicates [filename]` | Export duplicate groups to CSV |
| `--html [filename]` | Generate HTML report with charts |
| `-c, --config [path]` | Path to config file |

---

### `dat watch [directory]`

Watch a directory and re-analyze automatically (debounced 2 s) after changes.

```bash
dat watch .
dat watch /path/to/project --duplicates --top-n 10
```

---

### `dat compare <dir1> <dir2>`

Compare two directories side by side.

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

---

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

`dat` searches for this file starting in the current directory and walking up the tree. CLI flags always override config values.

**Default excluded directories** (unless `clearDefaultExclusions: true`): `node_modules`, `.git`, `.svn`, `.hg`, `dist`, `build`, `.cache`

---

## JSON Output

All fields from a `dat analyze . --json` call:

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
  "largeFiles": [{ "path": "...", "size": 104857600, "sizeFormatted": "105 MB" }],
  "duplicateGroups": [{ "hash": "...", "size": 4096, "files": ["...", "..."], "wastedSpace": 4096 }],
  "duplicateStats": { "totalGroups": 3, "wastedSpace": 12288, "wastedSpaceFormatted": "12.3 kB" },
  "emptyFiles": [{ "path": "...", "mtime": "2024-01-01T00:00:00.000Z" }],
  "topLargestFiles": [{ "path": "...", "size": 1048576, "sizeFormatted": "1.05 MB" }],
  "treeView": "📁 project\n└── ..."
}
```

---

## Migrating from v1

| v1 | v2 |
|---|---|
| `dir-analysis-tool` | `dat` (or still `dir-analysis-tool`) |
| `--path <dir>` | positional argument: `dat <dir>` |
| `--interactive` | `dat init` (creates config) |
| `--progress` / `--no-progress` | auto-detected from TTY |
| `--large-files <bytes>` | `--large-files <mb>` (value now in MB) |
| `bin/` build output | `dist/` build output |

---

## Requirements

- Node.js >= 18.0.0
- pnpm (for development)

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[MIT](LICENSE)
