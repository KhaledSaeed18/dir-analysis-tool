# AGENTS.md

Instructions for coding agents (and people) working on dir-analysis-tool. `CLAUDE.md` imports this file.

## What dir-analysis-tool is

A zero-dependency npm package with two faces: a CLI (`dat`, also installed as `dir-analysis-tool`) and a typed library. It answers what takes up space in a directory: largest folders and files, type and extension breakdowns, duplicates, large, empty and stale files, size budgets for CI, directory comparisons, and why a scan skipped a path. Reports come as a terminal view, JSON, Markdown, CSV and a self-contained HTML file. It only reads what it scans; it never deletes or changes a file.

## Commands

| Command              | What it does                                                                        |
| -------------------- | ----------------------------------------------------------------------------------- |
| `pnpm install`       | Install dev dependencies (pnpm version pinned in `packageManager`)                  |
| `pnpm build`         | Build `dist/` (CLI, library and type declarations) with tsdown                      |
| `pnpm dev <args>`    | Run the CLI from source (Node strips the TypeScript types), e.g. `pnpm dev . -d`    |
| `pnpm test`          | Run the Vitest suite                                                                |
| `pnpm test:coverage` | Same, with v8 coverage and the threshold ratchet                                    |
| `pnpm schema`        | Regenerate `schema.json` from `src/config/schema.ts`; CI fails if it is out of date |
| `pnpm bench [dir]`   | Benchmark a scan: timings and peak RSS                                              |
| `pnpm banner`        | Render the README banner from a real scan (needs Chrome)                            |
| `pnpm check`         | Everything CI runs: typecheck, lint, format, build, coverage, publint and attw      |

Run `pnpm check` before pushing.

## Layout

| Path                 | Holds                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/core/`          | Everything that measures, and never prints: `scanner.ts` (bounded concurrent walk, one `lstat` per file), `limiter.ts`, `exclude.ts` and `gitignore.ts` (the pattern matcher), `analyze.ts`, `classify.ts`, `top.ts` (bounded heaps), `duplicates.ts` (staged hashing), `hash-pool.ts` (worker threads that read and hash large stages), `content.ts` (chunked byte-by-byte comparison, pooled buffers), `compare.ts`, `live.ts` (per-folder state that keeps `dat watch` reports up to date incrementally), `budgets.ts`, `compact.ts`, `explain.ts`, `options.ts`, `paths.ts` |
| `src/reporters/`     | One renderer per format behind `index.ts`: `pretty`, `markdown`, `csv`, `html`, and `explain` for `dat explain`                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `src/cli/`           | `program.ts` (`run(argv, io)` and the command registry), `commands/` (one file per command: `analyze`, `compare`, `explain`, `watch`, `init`), `command.ts` (the built-in argument parser), `options.ts` (flags to core options), `context.ts`, `io.ts` (exit codes, the real process), `progress.ts`, `prompt.ts`, `watcher.ts`, `main.ts`                                                                                                                                                                                                                                     |
| `src/config/`        | `schema.ts` (config fields, validation, and the source of `schema.json`), `load.ts` (discovery)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `src/format/`        | Byte, time, color and text helpers; `text.ts` escapes control characters in names                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `src/index.ts`       | The public library API; `src/types.ts` documents every JSON field                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `test/`              | Vitest: `unit/` (pure functions, renderers), `integration/` (real temporary trees through `fixture()`, the CLI through `cli()`, watch, init, hostile file names, the agent skill), `repo/` (the release configuration and the community files and issue forms)                                                                                                                                                                                                                                                                                                                  |
| `skills/`            | The official agent skill (`dir-analysis-tool/SKILL.md` and its JSON reference) and its evals; not part of the npm package                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `scripts/`           | `generate-schema.ts`, `bench.ts`, `banner.ts`: contributor tools, never shipped                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `schema.json`        | JSON Schema of the config file, shipped as `dir-analysis-tool/schema.json` and generated by `pnpm schema`                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `report.schema.json` | JSON Schema of every JSON report (`analyze`, compact, `compare`, both `explain` forms), shipped as `dir-analysis-tool/report.schema.json`; the `json()` test helper validates every report against it and fails on a field it doesn't declare                                                                                                                                                                                                                                                                                                                                   |
| `.github/`           | `workflows/ci.yml` (quality, Linux and Windows on Node 22/24/26, macOS on Node 22; a change touching only Markdown, `LICENSE` or `.github/assets` skips the test jobs), `workflows/release.yml` (CI without macOS, then semantic-release on Node 26 to npm through trusted publishing), `dependabot.yml` (weekly grouped `build`/`ci` updates, which never release), `ISSUE_TEMPLATE/` (bug, wrong result, feature, documentation, accessibility; blank issues are off), `pull_request_template.md`                                                                             |
| Community files      | `CONTRIBUTING.md` (setup, principles, commits, releases), `CODE_OF_CONDUCT.md` (Contributor Covenant 2.1), `SECURITY.md` (private vulnerability reporting, scope, provenance), `ACCESSIBILITY.md` (what the output and reports do for assistive technology, and their known limits)                                                                                                                                                                                                                                                                                             |

## Product rules

- **Zero runtime dependencies.** The CLI and the library use Node.js built-ins only. Optional integrations belong in separate packages.
- **The core never prints.** `src/core` returns plain data; everything user-facing happens in `src/cli` and `src/reporters`.
- **Results are JSON.** What the library returns is exactly what `--format json` prints, so every new field is serializable and documented in `src/types.ts` and `report.schema.json`.
- **Memory stays bounded.** Anything computed per file during a scan uses constant memory, unless the user opted into a report that lists those files.
- **Deterministic.** Sort by size, then by path with `comparePaths`, never by discovery order.
- **Stdout is for the report only.** Messages, warnings and progress go to stderr.
- **Read-only.** dat never deletes or changes a scanned file. It writes only the report files asked for and `dat init`'s config. A duplicate or a stale file is a finding, not permission to delete.
- **Say what isn't known.** Truncated lists, skipped directories and unreadable paths are reported, never silently dropped.
- **Untrusted names.** Every file name is escaped before output: control characters and bidirectional overrides in the terminal and Markdown, HTML escaping in the HTML report, formula neutralizing in CSV.
- **A stable contract (3.x).** Semver, as the README's "Stability" section promises. Commands, options, budget metrics, config keys, exit codes and library exports don't change or disappear in a minor release. The JSON report only gains fields: never remove, rename or retype one, and `schemaVersion` (and `explainVersion` for `dat explain --json`) changes only in a major. The wording and layout of the pretty, Markdown and HTML reports may change.
- **Cross-platform.** macOS, Linux and Windows, Node 22.12 or later.

## Keep everything in sync

Every change, whether a feature, a fix or a refactor, lands with all related material updated **in the same branch**. Nothing ships with docs that describe the old behavior. Before pushing, check each item that applies:

- [ ] The option descriptions in `src/cli/commands/*.ts`, which are the `--help` text
- [ ] `src/types.ts` and `report.schema.json` for every JSON field (the tests fail on an undeclared one), and `schema.json` (`pnpm schema`) for every config key
- [ ] `README.md`: "Why", "Quick start", the options tables, "Budgets in CI", "Output formats" and the JSON example, the config key table, "Library API", "Exit codes", "Stability", "FAQ"
- [ ] `skills/dir-analysis-tool/SKILL.md` and `references/json-output.md`, and the eval numbers (`test/integration/skill.test.ts` fails on a stale option or number)
- [ ] `AGENTS.md`: this file, when the layout, commands, rules or workflow change
- [ ] Tests: unit tests for pure logic, integration tests on real trees, and hostile names for anything that prints a path
- [ ] `.github/ISSUE_TEMPLATE/wrong_result.yml`: the command list (`test/repo/community.test.ts` fails on a missing or reordered command)
- [ ] `package.json` `description` and `keywords`, when the scope changes
- [ ] `CONTRIBUTING.md`, `SECURITY.md`, `ACCESSIBILITY.md` and `.github/pull_request_template.md`, when the commands, workflow, safety guarantees or output change

Search the repo for the old wording or numbers before you push.

## Workflow and conventions

- **Small conventional commits** (`feat:`, `fix:`, `perf:`, `refactor:`, `test:`, `docs:`, `ci:`, `build:`, `chore:`), enforced by commitlint, with body lines of at most 100 characters. `feat` releases a minor version, `fix` and `perf` a patch. npm shows the README from the last published version, so a README change that should reach npm is a `docs(readme):` commit, which releases a patch; other `docs:` commits never release. No `Co-Authored-By` or other attribution lines. Don't start a body line with `word:`, because it parses as a git trailer.
- **One branch and PR per release.** Pushing a `feat` or `fix` commit to `main` publishes to npm through semantic-release, so features go through a PR, and merging is the release. The maintainer approves each merge.
- **Merge with "rebase and merge",** the only method the repository allows, so every `feat` and `fix` lands in the changelog once.
- **Dependabot** opens at most one grouped pull request per group each Monday (npm minor and patch, npm major, GitHub Actions), for versions at least a week old. Its commits are `build(deps-dev)` and `ci(deps)`, so merging one never publishes; ship it with the next `feat` or `fix`. `@types/node` stays on the major of the oldest supported Node.
- **README links are absolute** (`https://github.com/KhaledSaeed18/dir-analysis-tool/blob/main/...`), because npm renders the README outside the repository.

## Gotchas

- `isolatedDeclarations` is on: exported values need explicit types.
- `pnpm dev` and the scripts run TypeScript directly, which needs Node 22.18 or later; the published package needs only 22.12.
- Coverage thresholds in `vitest.config.ts` are a ratchet: raise them as coverage grows, never lower them.
- Windows: keep fixture names portable, skip symlink and permission cases with `it.skipIf(isWindows)`, and compare file identities exactly, through `inodeKey`: NTFS file IDs often exceed 2^53, where a `Number` inode rounds (3.4.1 fixed distinct Windows files taken for hard links).
- Root ignores file permissions, so permission tests skip with `isRoot`.
- Running `npx dir-analysis-tool` inside this repository can pick the local package; smoke-test a published version from another folder with an exact version.
- semantic-release loads its changelog preset from its own install first, which under pnpm finds whatever was hoisted (commitlint depends on a newer preset). `pnpm-workspace.yaml` keeps the preset out of the hoist, and `test/repo/release-config.test.ts` fails on a preset the release can't render, since the release itself only runs after merging.
