# JSON output reference

`dat <dir> --json` prints one JSON document (`"schemaVersion": 3`) on stdout. Sizes are bytes, dates are ISO 8601, and paths are relative to `root` with `/` separators on every platform. Optional sections exist only when their report is on.

| Field                            | Present          | Contents                                                                                                   |
| -------------------------------- | ---------------- | ---------------------------------------------------------------------------------------------------------- |
| `root`                           | always           | Absolute path of the analyzed directory                                                                    |
| `settings`                       | always           | The effective scan settings, including `defaultExcludes`, `gitignore`, `exclude`                           |
| `summary`                        | always           | `bytes`, `diskBytes`, `files`, `directories`, `largestFileBytes`, `excluded`, ...                          |
| `types`                          | always           | Per category (`code`, `images`, `videos`, ...): `files`, `bytes`                                           |
| `extensions[]`                   | always           | `extension`, `files`, `bytes`, largest first                                                               |
| `largestDirectories[]`           | always (`--top`) | `path`, `bytes`, `files`                                                                                   |
| `largestFiles[]`                 | always (`--top`) | `path`, `bytes`, `modified`                                                                                |
| `tree`                           | `-t`             | Nested `name`, `path`, `type`, `bytes`, `files`, `children[]` (up to max(`--top`, 10) children per folder) |
| `largeFiles`                     | `-l [size]`      | `threshold`, `count`, `bytes`, `items[]`                                                                   |
| `duplicates`                     | `-d`             | `count` (groups), `files`, `bytes`, `wastedBytes`, `items[]`                                               |
| `duplicates.items[]`             | `-d`             | `hash` (SHA-256), `bytes` (per copy), `wastedBytes`, `files[]`                                             |
| `staleFiles`                     | `--stale [when]` | `modifiedBefore`, `count`, `bytes`, `items[]`                                                              |
| `emptyFiles`, `emptyDirectories` | `--empty`        | `count`, `items[]` (folder items are plain paths)                                                          |
| `budgets[]`                      | `-b` or config   | `rule`, `metric`, `operator`, `limit`, `actual`, `passed`                                                  |
| `errors[]`                       | always           | Up to 100 unreadable paths (`summary.errors` has the count); totals exclude them                           |

`--top <n>` limits `largestDirectories` and `largestFiles` (and the lists in the pretty report). It does not limit `duplicates.items` or `budgets`.

## One-liners

`node` is always available where `dat` runs, so these use it; `jq` equivalents are shown where they are shorter.

```bash
# Total, on-disk size, and file count
dat . --json | node -e 'const r=JSON.parse(require("fs").readFileSync(0,"utf8"));console.log(r.summary.bytes,r.summary.diskBytes,r.summary.files)'
dat . --json | jq '.summary | {bytes, diskBytes, files, excluded}'

# Top-level entries by size (include .git and node_modules)
dat . --all -t --tree-depth 1 -n 30 --json | jq -r '.tree.children[] | "\(.bytes)\t\(.path)"'

# Duplicate groups, largest waste first, and the total
dat . -d -n 0 --json | jq -r '.duplicates.items[] | "\(.wastedBytes)\t\(.files | join(" | "))"'
dat . -d -n 0 --json | jq '.duplicates.wastedBytes'

# Budget results; the exit code is 2 when any rule fails
dat dist -b "size<=2MB" -b "largest<500kB" -n 0 --json | jq -c '.budgets[] | {rule, actual, limit, passed}'
```

PowerShell can read the same output with `dat . --json | ConvertFrom-Json`. In PowerShell and `cmd.exe`, keep budget rules in double quotes (`-b "size<=2MB"`).

Human-friendly sizes: `--si` makes the pretty report use kB/MB; JSON is always bytes. Convert with `bytes / 1024 ** 2` for MiB or `bytes / 1e6` for MB, and name the unit you used.
