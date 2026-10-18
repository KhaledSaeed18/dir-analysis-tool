# Contributing

Thanks for helping improve dir-analysis-tool. Bug reports, ideas, and pull requests are all welcome.

## Setup

You need Node.js 22.18 or later (the sources run directly through Node's built-in TypeScript support) and pnpm. The repository pins its pnpm version through the `packageManager` field.

```bash
git clone https://github.com/KhaledSaeed18/dir-analysis-tool.git
cd dir-analysis-tool
pnpm install
pnpm dev ~/some/directory -d         # run the CLI from source
```

## Scripts

| Script                          | What it does                                              |
| ------------------------------- | --------------------------------------------------------- |
| `pnpm dev <args>`               | Run the CLI from `src/` without building                  |
| `pnpm build`                    | Bundle `dist/` with tsdown, including type declarations   |
| `pnpm test` / `pnpm test:watch` | Run the test suite once, or in watch mode                 |
| `pnpm test:coverage`            | Run the tests with coverage thresholds                    |
| `pnpm typecheck`                | Type-check with TypeScript 7                              |
| `pnpm lint` / `pnpm lint:fix`   | Lint with oxlint, including type-aware rules              |
| `pnpm format`                   | Format with Prettier                                      |
| `pnpm schema`                   | Regenerate `schema.json` after changing config fields     |
| `pnpm bench [directory]`        | Benchmark a scan                                          |
| `pnpm check`                    | Everything CI runs. Run it before opening a pull request. |

## Project layout

```text
src/
  core/        scanning, exclusion rules, analysis, duplicates, comparison, budgets
  reporters/   pretty (terminal), Markdown, CSV, and HTML renderers
  config/      config file validation and discovery; the source of schema.json
  format/      byte, time, color, and text helpers
  cli/         commands, option parsing, progress, and file watching
  index.ts     the public library API
test/
  unit/        pure functions and renderers
  integration/ real temporary directory trees, the CLI, watch mode, and init
```

A few principles keep the code base consistent:

- **The core never prints.** `src/core` returns plain data, and everything user-facing happens in `src/cli` and `src/reporters`.
- **Results are JSON.** What the library returns is exactly what `--format json` prints, so new fields must be serializable and documented in `src/types.ts`.
- **Memory stays bounded.** Anything computed per file during a scan must use constant memory, unless the user opted into a report that lists those files.
- **Output is deterministic.** Sort by size, then by path with `comparePaths`, never by discovery order.
- **Stdout is for the report only.** Messages, warnings, and progress go to stderr.

## Tests

Tests create real directory trees with the `fixture()` helper in `test/helpers/fixture.ts`; they are removed after each test. CLI tests call `cli()` from `test/helpers/cli.ts`, which runs the program in-process with captured output. Every bug fix should come with a test that fails without it. CI runs the suite on Linux, macOS, and Windows with Node 22, 24, and 26, so keep file names portable and skip symlink or permission cases on Windows with `it.skipIf(isWindows)`.

## Commits and releases

Commits follow [Conventional Commits](https://www.conventionalcommits.org), and a commit hook checks them. Releases are automated: every push to `main` runs CI, then semantic-release picks the version from the commit messages, publishes to npm with provenance, and updates `CHANGELOG.md`.

| Commit type                                              | Release                              |
| -------------------------------------------------------- | ------------------------------------ |
| `fix:`                                                   | patch                                |
| `feat:`                                                  | minor                                |
| `feat!:` or a `BREAKING CHANGE:` footer                  | major                                |
| `docs(readme):`                                          | patch, so the npm page stays current |
| `docs:`, `test:`, `refactor:`, `build:`, `ci:`, `chore:` | none                                 |

## Code of conduct

This project follows the [Contributor Covenant](CODE_OF_CONDUCT.md). Be kind and constructive.
