## Summary

<!-- What this changes and why. Link the issue it resolves, e.g. "Closes #123". -->

## Type of change

<!-- The commit type decides the release: feat = minor, fix, perf and docs(readme) = patch, anything else = no release. -->

- [ ] `feat`: a new report, option, command, format or library function
- [ ] `fix`: a bug fix
- [ ] `perf`: a faster or lighter scan
- [ ] `docs`: documentation only (`docs(readme)` to publish the README to npm)
- [ ] `test`, `refactor`, `build`, `ci` or `chore`

## Contract

<!-- The 3.x stability promise: https://github.com/KhaledSaeed18/dir-analysis-tool#stability -->

- [ ] Commands, options, budget metrics, config keys, exit codes and library exports are unchanged, or only added to.
- [ ] The JSON report only gains fields, and `src/types.ts` documents each new one.
- [ ] Every file name is escaped in every output format.
- [ ] Memory stays bounded on a scan that doesn't ask for file lists.
- [ ] The core still has no runtime dependencies.

<!-- If a box doesn't hold, say why here. A breaking change needs a BREAKING CHANGE footer and waits for the next major. -->

## Kept in sync

<!-- Tick what this change touched, or strike through what doesn't apply. -->

- [ ] Option descriptions in `src/cli/commands/*.ts` (the `--help` text)
- [ ] `schema.json` (`pnpm schema`) for a new or changed config key
- [ ] `README.md`: options, budgets, output formats and the JSON example, config keys, library API, exit codes, FAQ
- [ ] `skills/dir-analysis-tool/` and its evals, for a changed option or JSON field
- [ ] `AGENTS.md` and `CONTRIBUTING.md`: layout, commands, rules or workflow
- [ ] `.github/ISSUE_TEMPLATE/wrong_result.yml`: the command list
- [ ] Tests: unit and integration cases, hostile file names for anything that prints a path
- [ ] `package.json` `description` and `keywords`, if the scope changed

## Verification

<!-- How you know it works. -->

- [ ] `pnpm check` passes
- [ ] Tested on: <!-- macOS, Linux, Windows -->
- [ ] For a performance change: `pnpm bench` before and after (the numbers, and the tree)
