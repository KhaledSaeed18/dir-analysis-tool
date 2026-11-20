# Contributing to dir-analysis-tool

Thanks for helping improve dir-analysis-tool. People put it in CI and decide what to clean up from what it reports, so every number it prints has to be right. This guide covers how to report a problem, how to set up the project, and what a pull request needs before it can be merged.

By taking part you agree to follow the [Code of Conduct](CODE_OF_CONDUCT.md).

## Contents

- [Ways to contribute](#ways-to-contribute)
- [Reporting a wrong result](#reporting-a-wrong-result)
- [Development setup](#development-setup)
- [Project layout](#project-layout)
- [Product rules](#product-rules)
- [Making a change](#making-a-change)
- [Agent skill](#agent-skill)
- [Commit messages](#commit-messages)
- [Pull requests](#pull-requests)
- [How releases work](#how-releases-work)

## Ways to contribute

| You want to                                                    | Do this                                                                                                                                                           |
| -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Report a size, count, duplicate or skipped path that is wrong  | Open a [wrong result](https://github.com/KhaledSaeed18/dir-analysis-tool/issues/new?template=wrong_result.yml) issue. These are the most valuable reports         |
| Report dat crashing, hanging or misbehaving                    | Open a [bug report](https://github.com/KhaledSaeed18/dir-analysis-tool/issues/new?template=bug_report.yml)                                                        |
| Propose a new report, option, format or library function       | Open a [feature request](https://github.com/KhaledSaeed18/dir-analysis-tool/issues/new?template=feature_request.yml) before writing code                          |
| Fix the docs                                                   | Open a pull request, or a [documentation issue](https://github.com/KhaledSaeed18/dir-analysis-tool/issues/new?template=documentation.yml)                         |
| Report something that is hard to use with assistive technology | Open an [accessibility issue](https://github.com/KhaledSaeed18/dir-analysis-tool/issues/new?template=accessibility.yml); see [ACCESSIBILITY.md](ACCESSIBILITY.md) |
| Report a security vulnerability                                | Don't open an issue. Follow [SECURITY.md](SECURITY.md)                                                                                                            |

For anything larger than a small fix, open an issue first. The [stability promise](https://github.com/KhaledSaeed18/dir-analysis-tool#stability) limits what a minor release may change, so it is worth agreeing on the shape of a change before you build it.

## Reporting a wrong result

A wrong number fails a budget for no reason or hides real waste. To make one reproducible:

1. Run the same command with `--json` (or `--compact` for a large tree) and keep the output.
2. Check the number another way where you can: `du -sh` or `du -sh --apparent-size` for sizes, `git check-ignore -v <path>` for `.gitignore`, `shasum -a 256` for duplicates.
3. Run `dat explain <path>` for a path that was counted or skipped unexpectedly; it names the rule that decided.
4. Give the smallest directory layout that shows it, your OS, the file system if it matters (hard links, case, sizes on disk), and the dat version.

## Development setup

You need:

- macOS, Linux or Windows.
- Node.js 22.18 or later. The published package runs on 22.12, but `pnpm dev`, the scripts and the tests run the TypeScript sources directly through Node's built-in type stripping.
- pnpm, at the version pinned in `packageManager` in `package.json` (`npm install --global pnpm@<version>`).

```bash
git clone https://github.com/KhaledSaeed18/dir-analysis-tool.git
cd dir-analysis-tool
pnpm install
pnpm check
```

`pnpm install` also sets up a Git hook that checks commit messages.

| Command                         | What it does                                                                   |
| ------------------------------- | ------------------------------------------------------------------------------ |
| `pnpm dev <args>`               | Run the CLI from `src/` without building, e.g. `pnpm dev ~/photos -d`          |
| `pnpm build`                    | Bundle `dist/` with tsdown, including type declarations                        |
| `pnpm test` / `pnpm test:watch` | Run the test suite once, or in watch mode                                      |
| `pnpm test:coverage`            | Run the tests with coverage and its thresholds                                 |
| `pnpm typecheck`                | Type-check with TypeScript 7                                                   |
| `pnpm lint` / `pnpm lint:fix`   | oxlint with type-aware rules; warnings fail                                    |
| `pnpm format`                   | Format everything with Prettier                                                |
| `pnpm schema`                   | Regenerate `schema.json` after changing config fields                          |
| `pnpm bench [directory]`        | Benchmark a scan                                                               |
| `pnpm check`                    | Everything CI runs: typecheck, lint, format, build, coverage, publint and attw |

### README banner

The banner is rendered from a real scan with the existing colors, typography and treemap layout:

```bash
pnpm banner /path/to/linux --subject "The Linux kernel source tree"
```

Google Chrome is required for rendering; set `CHROME` to another Chromium executable if needed. `pnpm banner --packages` renders the development dependencies instead. These are contributor tools, not runtime requirements for the published package.

## Project layout

```text
src/
  core/        scanning, exclusion rules, analysis, duplicates, comparison, budgets, explain
  reporters/   pretty (terminal), Markdown, CSV, HTML, and explain renderers
  config/      config file validation and discovery; the source of schema.json
  format/      byte, time, color, and text helpers
  cli/         commands, option parsing, progress, and file watching
  index.ts     the public library API
test/
  unit/        pure functions and renderers
  integration/ real temporary directory trees, the CLI, watch mode, init, and the agent skill
  repo/        the release configuration, the community files and the issue forms
skills/
  dir-analysis-tool/        the agent skill (SKILL.md and its reference); not part of the npm package
  evals/dir-analysis-tool/  eval prompts and the fixture generator, kept out of the installed skill
```

[AGENTS.md](AGENTS.md) maps the source tree in more detail, lists the gotchas (Windows file IDs, permission tests as root, the changelog preset) and is the reference for the rules below.

## Product rules

These rules decide whether a change can be merged. [AGENTS.md](AGENTS.md#product-rules) states them in full.

- **Zero runtime dependencies.** The CLI and the library use Node.js built-ins only.
- **The core never prints.** `src/core` returns plain data, and everything user-facing happens in `src/cli` and `src/reporters`.
- **Results are JSON.** What the library returns is exactly what `--format json` prints, so new fields must be serializable and documented in `src/types.ts` and `report.schema.json`; the tests reject any field a report contains that the schema doesn't declare.
- **Memory stays bounded.** Anything computed per file during a scan must use constant memory, unless the user opted into a report that lists those files.
- **Output is deterministic.** Sort by size, then by path with `comparePaths`, never by discovery order.
- **Stdout is for the report only.** Messages, warnings, and progress go to stderr.
- **Read-only.** dat never deletes or changes a scanned file, and every file name is escaped before it is printed, in every format.
- **A stable contract.** Within 3.x, commands, options, config keys, exit codes and library exports don't change or disappear, and the JSON report only gains fields.
- **Ordinary scans stay fast.** `explain` needs to know which rule decided, so it re-checks skipped entries one rule at a time through the scanner's `onSkip` hook. Keep that work off the normal scan path: the hook is unset unless `explain` runs.

## Making a change

1. Fork the repository and create a branch from `main`.
2. Make the change with tests. Tests create real directory trees with the `fixture()` helper in `test/helpers/fixture.ts`, which are removed after each test; CLI tests call `cli()` from `test/helpers/cli.ts`, which runs the program in-process with captured output. Every bug fix comes with a test that fails without it.
3. Keep it portable: CI runs the suite on Linux and Windows with Node 22, 24 and 26, and on macOS with Node 22. Keep file names portable and skip symlink or permission cases on Windows with `it.skipIf(isWindows)`.
4. Update everything the change touches in the same branch: the help text, `src/types.ts`, `report.schema.json`, `schema.json`, the README sections, the agent skill, `AGENTS.md` and this file. The [pull request template](.github/pull_request_template.md) has the full checklist.
5. Run `pnpm check`.

## Agent skill

`skills/dir-analysis-tool/SKILL.md` documents CLI options and JSON fields for coding agents. When you rename or remove an option, or change what the JSON reports, update the skill too: `test/integration/skill.test.ts` fails when the skill mentions an option the CLI no longer documents or when an expected number in `skills/evals/dir-analysis-tool/evals.json` no longer matches the CLI. The skill states the oldest CLI version it supports ("3.2 or later") and asks npx for that range; raise it when the skill starts relying on a newer option or JSON field, and the test checks that the stated version has been released. See [skills/README.md](skills/README.md) for running the evals in an agent.

## Commit messages

Commits follow [Conventional Commits](https://www.conventionalcommits.org), checked by commitlint. Keep commits small, one change each, with body lines of at most 100 characters.

| Type                                               | Use it for                                   | Releases        |
| -------------------------------------------------- | -------------------------------------------- | --------------- |
| `feat`                                             | A new report, option, command or library API | A minor version |
| `fix`, `perf`                                      | A bug fix, or a faster or lighter scan       | A patch version |
| `docs(readme)`                                     | A README change that should reach npm        | A patch version |
| `docs`, `test`, `refactor`, `build`, `ci`, `chore` | Everything else                              | Nothing         |

A breaking change needs a `BREAKING CHANGE:` footer and waits for a major release. npm shows the README from the last published version, which is why a README fix that users should see is a `docs(readme)` commit. In a commit body, don't start a line with a single word followed by a colon: Git reads it as a trailer.

## Pull requests

- Fill in the pull request template, including how you verified the change.
- CI runs the quality checks, a smoke test of the built CLI and the test suite. A change that only touches Markdown skips the test jobs.
- The maintainer reviews and merges with **rebase and merge**, the only method the repository allows, so each commit keeps its own changelog entry.

## How releases work

Merging to `main` is the release. [semantic-release](https://github.com/semantic-release/semantic-release) reads the commits since the last tag, picks the version, updates `CHANGELOG.md`, creates the GitHub release and publishes to npm from CI through trusted publishing, with [provenance](https://docs.npmjs.com/generating-provenance-statements). Nobody publishes from a laptop. Dependabot's weekly updates use `build` and `ci` commits, so they ship with the next `feat` or `fix`.
