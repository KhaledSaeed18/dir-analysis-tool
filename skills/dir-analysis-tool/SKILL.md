---
name: dir-analysis-tool
description: Measure what takes up space in a repository or directory, find duplicate files and the space they waste, and check size budgets (bundle size, artifact size, file count) with the dir-analysis-tool CLI (`dat`). Use when someone asks why a repo, folder, build output, or Docker context is large, wants the biggest files or folders, wants duplicate assets found, or wants a size limit verified or enforced in CI. Read-only; it never deletes files.
license: MIT
compatibility: Requires Node.js 22.12 or later and a shell. Runs dir-analysis-tool 3.2 or later (below 4) from npm (installed or through npx); network access is needed only if npx must download it.
metadata:
  author: Khaled Saeed
  version: '1.0.0'
  homepage: https://github.com/KhaledSaeed18/dir-analysis-tool
---

# dir-analysis-tool

Answer size questions with measurements from `dir-analysis-tool`, a zero-dependency Node.js CLI. It scans a directory once and reports the largest folders and files, type breakdowns, duplicates, and budget results. It only reads files, except for report files you explicitly ask it to write.

## 1. Pick the command once

This skill is written for dir-analysis-tool **3.2 or later, below 4**. Run these checks in order and use the first one that prints such a version:

```bash
dir-analysis-tool --version                    # installed globally
npx --yes "dir-analysis-tool@^3.2" --version   # no install needed; downloads to the npx cache
```

Keep the quotes and the `^3.2` range: a plain `@3` lets npx reuse any older cached 3.x without checking for a newer one.

- If the global install prints an older 3.x, prefer the npx command, and suggest `npm install -g dir-analysis-tool@latest` to the user rather than running it yourself.
- If npx fails (no network, sandbox, registry error) and an older 3.x is installed, use that one: every command in this skill works from 3.0. Tell the user which version you ran.
- Never replace the tool with your own scripts (`du`, `find`, hashing code) without telling the user that you did and why. Measurements from your own script are not results from dir-analysis-tool.

The examples below write `dat` for whichever command worked. Only type a bare `dat` if `dat --version` prints a suitable version, because an unrelated program is also called `dat`. Inside the dir-analysis-tool source repository you can also use `node dist/cli.js` after `pnpm build`.

If Node.js is missing or older than 22.12, stop and tell the user; do not fall back to guessing sizes with other tools without saying so.

## 2. Ground rules

- **Use `--json` for facts and the pretty report for people.** JSON goes to stdout alone (progress and warnings go to stderr). Sizes in JSON are raw bytes; paths are relative to `root` and use `/`. The pretty report shortens lists to `--top` items (default 10), while JSON always contains every duplicate group and every budget result.
- **Read the exit code.** `0` success, `1` error (bad flag, missing directory), `2` a budget failed (the report is still complete and valid), `130` interrupted.
- **Know what was skipped.** `.git`, `.hg`, `.svn`, and `node_modules` are skipped by default; `summary.excluded` counts what was skipped. `--all` includes them. `-g` also honors `.gitignore`.
- **Quote budget rules and patterns.** `<` and `>` are shell redirections: always write `-b "size<=2MB"`, never `-b size<=2MB`. Quote globs too: `-e '*.map'`.
- **Mind the units.** `kB`, `MB`, `GB` are powers of 1000; `KiB`, `MiB`, `k`, `M` are powers of 1024. Reports use binary units unless you pass `--si`. Quote the user's unit back to them.
- **Never delete, move, or rewrite files on your own.** Report findings and proposed actions; act only on an explicit request, and only on the paths the user approved.
- **Report numbers with their scope**: the directory, the flags used (for example "excluding `.git` and `node_modules`"), and whether sizes are apparent size or on-disk size.

## 3. Investigate repository and directory size

1. Get the overview and the top level, including what is normally skipped:

   ```bash
   dat <dir> --all -t --tree-depth 1 -n 15
   ```

   The tree shows each top-level entry with its total size, so `.git/` and `node_modules/` appear with their real weight.

2. Get the default view (without `.git` and `node_modules`) and, in a Git repository, the view Git sees:

   ```bash
   dat <dir> -n 15            # what you would ship or back up, minus VCS and dependencies
   dat <dir> -g -n 15         # also drop everything .gitignore excludes (build output, logs)
   ```

   The difference between runs explains where space goes: version-control history, installed dependencies, ignored build output, or tracked files.

3. Drill into the biggest folder, or ask a narrower question:

   ```bash
   dat <dir>/<big-folder> -t --tree-depth 2
   dat <dir> -l 50MB                 # every file of at least 50 MB
   dat <dir> -x                      # breakdown by extension
   dat <dir> --min-size 10MB --stale 1y   # stale files among those of 10 MB or more (totals count only those)
   ```

4. For exact numbers, use JSON. Useful fields: `summary.bytes` (apparent size), `summary.diskBytes` (allocated, what `du` reports), `summary.files`, `summary.excluded`, `tree.children[]`, `largestDirectories[]`, `largestFiles[]`. See [references/json-output.md](references/json-output.md) for the fields and ready-made one-liners.

Report: total size and on-disk size, the few folders and files that account for most of it, how much sits in `.git`, `node_modules`, and ignored paths, and concrete next steps (for example, move large media to Git LFS, add a build folder to `.gitignore`, prune old artifacts). Large files already committed stay in `.git` history even after deletion; say so instead of promising savings.

## 4. Find duplicate assets

```bash
dat <dir> -d --json                                 # every duplicate group
dat <dir> -d --min-duplicate-size 10KiB --json      # ignore tiny files (icons, stubs, licenses)
dat <dir> -d -g -e 'fixtures/' --json               # skip ignored paths and intentional copies
```

How detection works: only files with equal sizes are compared, large files are pre-filtered by a sample, and every reported group is confirmed by a full SHA-256 hash of the contents. Empty files are never duplicates, and hard links to the same data are not copies. Names do not matter: `final.jpg` and `IMG_0001 copy.jpg` are duplicates when their bytes match, and two files with the same size but different bytes are not.

Read `duplicates` in the JSON: `count` (groups), `wastedBytes` (space freed by keeping one copy of each group), and `items[]` with `bytes`, `wastedBytes`, and `files[]` per group. Add `--top 0` to shorten the rest of the JSON if you only need duplicates.

Report each group with its file list and the space it wastes, largest first, and the total reclaimable space. Suggest which copy to keep (for example the one under the canonical source folder, not `backup/` or `export/`), and point out duplicates that may be intentional: vendored code, test fixtures, lockfiles, platform-specific copies. Do not remove anything unless asked.

## 5. Verify size budgets

A budget is `<metric><operator><value>` with operators `<`, `<=`, `>`, `>=`, `=`, `!=`. Pass one `-b` per rule.

| Metric                 | Measures                                                    |
| ---------------------- | ----------------------------------------------------------- |
| `size`, `disk`         | Total apparent size, total size on disk                     |
| `files`, `dirs`        | Number of files, number of folders                          |
| `largest`              | Size of the largest file                                    |
| `large`                | Number of files at least as big as `--large-files` (100MiB) |
| `duplicates`, `wasted` | Duplicate groups, bytes they waste                          |
| `empty`, `stale`       | Number of empty files, number of stale files                |
| `errors`               | Number of unreadable paths                                  |

```bash
dat dist -b "size<=2MB" -b "largest<500kB" --json        # check; exit code 2 if any rule fails
dat dist -b "size<=2MB" -e '*.map' --json                # exclude source maps from the measurement
dat . -g -b "duplicates=0" -b "wasted<1MB"               # no duplicates among files Git does not ignore
```

Important behavior:

- **Config files add budgets.** `dat` reads `.dir-analyzer.json` or `dir-analyzer.config.json` from the scanned directory or any parent, and its `budgets` are combined with your `-b` rules. Look at every entry in the `budgets` array, not only the rules you passed. Use `--no-config` only to answer "do just these rules pass?", and mention that the project config would add more.
- `budgets[]` in the JSON has `rule`, `metric`, `limit`, `actual`, and `passed` for every rule; sizes are bytes.
- The scan options apply to the budget: `-e`, `-g`, and default excludes change what is measured. State them in the answer.

Report each rule as passed or failed with the actual value against the limit, the overall result (exit code 2 means at least one failed), and for failures, what to look at (for example the largest files from `largestFiles[]`).

To enforce a budget in CI, a failing rule already fails the step. Do not add `--no-config` to a CI command just to make your rules the only ones: that silently drops the project's own budgets. If the config and the requested rules disagree, point out the conflict and suggest keeping one set of rules in the config.

```yaml
- name: Check the bundle size
  run: npx --yes dir-analysis-tool@3 dist -b "size<=2MB" -b "largest<=500kB" -f markdown >> "$GITHUB_STEP_SUMMARY"
```

To keep budgets in the repository instead, put them in `.dir-analyzer.json`:

```json
{
  "$schema": "https://unpkg.com/dir-analysis-tool@3/schema.json",
  "budgets": ["size<=2MB", "largest<=500kB"]
}
```

## 6. Troubleshooting

- `error Not a directory` or `error No such directory` (exit code `1`): check the path; the CLI analyzes directories, not single files.
- Numbers differ from `du`: `du` reports allocated blocks (`summary.diskBytes`), while the headline is apparent size; also check `--all` and hard links (counted once unless `--count-hardlinks`).
- Huge trees: the scan is fast and memory-bounded, but duplicate detection reads candidate files. Narrow it with `--min-duplicate-size 1MB` or a subdirectory first.
- Unreadable paths are listed in `errors[]`; mention them, because the totals exclude them.
- Other commands: `dat compare <before> <after>` explains what grew between two builds; `dat --help` lists every option.
