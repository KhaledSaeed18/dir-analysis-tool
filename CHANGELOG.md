# Changelog

## [3.5.4](https://github.com/KhaledSaeed18/dir-analysis-tool/compare/v3.5.3...v3.5.4) (2026-11-25)

### Bug Fixes

* **analyze:** sort tree and extension ties by code point, like every other list ([f7d527a](https://github.com/KhaledSaeed18/dir-analysis-tool/commit/f7d527a59c5b5ec5fb241246b7a77868e52225fb)), closes [#26](https://github.com/KhaledSaeed18/dir-analysis-tool/issues/26)
* **explain:** list broken symbolic links followed with -L ([2f3f897](https://github.com/KhaledSaeed18/dir-analysis-tool/commit/2f3f897360b7a53843c04611c99b514236e6ae5f)), closes [#22](https://github.com/KhaledSaeed18/dir-analysis-tool/issues/22)

## [3.5.3](https://github.com/KhaledSaeed18/dir-analysis-tool/compare/v3.5.2...v3.5.3) (2026-11-24)

### Bug Fixes

* **cli:** report unwritable output paths plainly, before the scan ([2245228](https://github.com/KhaledSaeed18/dir-analysis-tool/commit/22452289ebe0846708acf1f6c8e499a2590ee167)), closes [#25](https://github.com/KhaledSaeed18/dir-analysis-tool/issues/25)
* **compare:** make -n 0 hide every list in pretty and Markdown output ([2610934](https://github.com/KhaledSaeed18/dir-analysis-tool/commit/26109348b35718ee748996942706bb93ed9aeabb)), closes [#21](https://github.com/KhaledSaeed18/dir-analysis-tool/issues/21)

## [3.5.2](https://github.com/KhaledSaeed18/dir-analysis-tool/compare/v3.5.1...v3.5.2) (2026-11-24)

### Bug Fixes

* **watch:** check the root once before scanning or watching ([5284316](https://github.com/KhaledSaeed18/dir-analysis-tool/commit/528431608135f2b73bb0f1d9ff124be7ea3379d4)), closes [#20](https://github.com/KhaledSaeed18/dir-analysis-tool/issues/20)
* **watch:** exit 130 when stopped with Ctrl+C ([081de98](https://github.com/KhaledSaeed18/dir-analysis-tool/commit/081de98ed3b6c517c292db1437d77d0ec6ae1a76)), closes [#30](https://github.com/KhaledSaeed18/dir-analysis-tool/issues/30)
* **watch:** notice a deleted root on Windows ([7ca270f](https://github.com/KhaledSaeed18/dir-analysis-tool/commit/7ca270f97e0ff1bebb8ea790d5199abad6b6f51c))
* **watch:** report every change when polling, not only size changes ([9152734](https://github.com/KhaledSaeed18/dir-analysis-tool/commit/915273424d7f46f0a6641c3acd17e548070ad3ef)), closes [#29](https://github.com/KhaledSaeed18/dir-analysis-tool/issues/29)
* **watch:** stop -o inside the watched folder from re-triggering itself ([745af69](https://github.com/KhaledSaeed18/dir-analysis-tool/commit/745af69b8b6da5cb740c4249a597663d598cf185)), closes [#28](https://github.com/KhaledSaeed18/dir-analysis-tool/issues/28)
* **watch:** wait for a deleted root and report again once it is back ([a8a3a61](https://github.com/KhaledSaeed18/dir-analysis-tool/commit/a8a3a61298e6661265114c51d3938cfe43b5a70f)), closes [#19](https://github.com/KhaledSaeed18/dir-analysis-tool/issues/19)
* **watch:** write JSON reports to -o instead of stdout ([336d5a6](https://github.com/KhaledSaeed18/dir-analysis-tool/commit/336d5a6afe532e8c35abc1dd417a511b7a969d24)), closes [#18](https://github.com/KhaledSaeed18/dir-analysis-tool/issues/18)

## [3.5.1](https://github.com/KhaledSaeed18/dir-analysis-tool/compare/v3.5.0...v3.5.1) (2026-11-22)

### Bug Fixes

* accept only documented ages and dates in date filters ([61ef02c](https://github.com/KhaledSaeed18/dir-analysis-tool/commit/61ef02c2e2e1f4d5ca0bf319cc2a7d7606351465)), closes [#17](https://github.com/KhaledSaeed18/dir-analysis-tool/issues/17)
* **cli:** keep the exit code when the reader closes stdout early ([78e00f7](https://github.com/KhaledSaeed18/dir-analysis-tool/commit/78e00f7e7fe2f329651c05144bab3ca64c090a25)), closes [#27](https://github.com/KhaledSaeed18/dir-analysis-tool/issues/27)
* **config:** stop unitless large-file sizes from meaning bytes by accident ([6efa273](https://github.com/KhaledSaeed18/dir-analysis-tool/commit/6efa2733cf68aef60e3446dde10b7e52dde72862)), closes [#23](https://github.com/KhaledSaeed18/dir-analysis-tool/issues/23)
* **config:** warn about the deprecated "maxDepth": -1 ([f973b1f](https://github.com/KhaledSaeed18/dir-analysis-tool/commit/f973b1f8686dad88800ad89982602ed64035c5e7)), closes [#24](https://github.com/KhaledSaeed18/dir-analysis-tool/issues/24)

## [3.5.0](https://github.com/KhaledSaeed18/dir-analysis-tool/compare/v3.4.1...v3.5.0) (2026-11-20)

### Features

* ship a JSON Schema for every JSON report ([853d6d2](https://github.com/KhaledSaeed18/dir-analysis-tool/commit/853d6d2f30cb5bb0f4edfa84fbf01ff40742a4b2))

## [3.4.1](https://github.com/KhaledSaeed18/dir-analysis-tool/compare/v3.4.0...v3.4.1) (2026-11-20)

### Bug Fixes

* compare exact file IDs so Windows files are not mistaken for hard links ([aa407a6](https://github.com/KhaledSaeed18/dir-analysis-tool/commit/aa407a6bb14059e6b1f97786e4d5e5f401602781))

## [3.4.0](https://github.com/KhaledSaeed18/dir-analysis-tool/compare/v3.3.1...v3.4.0) (2026-11-20)

### Features

* **analyze:** add --compact for bounded one-line JSON ([67c3573](https://github.com/KhaledSaeed18/dir-analysis-tool/commit/67c357354bad6f89f752e2a9d2977663d4df09f5))

## [3.3.1](https://github.com/KhaledSaeed18/dir-analysis-tool/compare/v3.3.0...v3.3.1) (2026-11-11)

### Bug Fixes

* **explain:** name the path as typed when it is outside the root ([edc1c79](https://github.com/KhaledSaeed18/dir-analysis-tool/commit/edc1c793c11386da489e258e3077f8e5e1bed5b0))
* **explain:** stop listing "and N more" lines with --limit 0 ([2727cd6](https://github.com/KhaledSaeed18/dir-analysis-tool/commit/2727cd648d736c619c47c7950e3e4120678fffb2))

## [3.3.0](https://github.com/KhaledSaeed18/dir-analysis-tool/compare/v3.2.1...v3.3.0) (2026-11-11)

### Features

* add dat explain to show why a scan skips a path ([42dc67d](https://github.com/KhaledSaeed18/dir-analysis-tool/commit/42dc67d1a9a4a8f337f0b705f203a96db098d330))

## [3.2.1](https://github.com/KhaledSaeed18/dir-analysis-tool/compare/v3.2.0...v3.2.1) (2026-11-06)

### Bug Fixes

* **core:** match Git on ignore rules and stop wildcard rules from hanging ([c83654b](https://github.com/KhaledSaeed18/dir-analysis-tool/commit/c83654b59c1fa3b6a752ad9593b539f252b0b824))
* **reporters:** escape control characters from file names ([e04ed41](https://github.com/KhaledSaeed18/dir-analysis-tool/commit/e04ed4160c289644b023d435b3042c896bacdd39))

## [3.2.0](https://github.com/KhaledSaeed18/dir-analysis-tool/compare/v3.1.0...v3.2.0) (2026-10-29)

### Features

* **skills:** add the official agent skill for size, duplicates, and budgets ([dbfbef7](https://github.com/KhaledSaeed18/dir-analysis-tool/commit/dbfbef70e16cb325859c2dd30dcda01bfa6abcef))
* **skills:** add the official agent skill for size, duplicates, and budgets ([#4](https://github.com/KhaledSaeed18/dir-analysis-tool/issues/4)) ([fd3f0e3](https://github.com/KhaledSaeed18/dir-analysis-tool/commit/fd3f0e3030a876cb731cb5960bce6113807d5ff5))

## [3.1.0](https://github.com/KhaledSaeed18/dir-analysis-tool/compare/v3.0.1...v3.1.0) (2026-10-21)

### Features

* ship with zero runtime dependencies ([82d0877](https://github.com/KhaledSaeed18/dir-analysis-tool/commit/82d08775ecf3ca7c23c147eea71142ef2314c7bd))

### Bug Fixes

* **core:** honor bare wildcard gitignore rules ([791a3a6](https://github.com/KhaledSaeed18/dir-analysis-tool/commit/791a3a6968e81b6d89dbc1c03a42eea23e2bfb4b))

### Performance Improvements

* **core:** hash duplicate candidates with one read per small file ([6712ab5](https://github.com/KhaledSaeed18/dir-analysis-tool/commit/6712ab57b41c51b585012828a9cc850514c26822))
* **core:** match gitignore rules with an in-house matcher ([4ebacca](https://github.com/KhaledSaeed18/dir-analysis-tool/commit/4ebacca1beca511fedd6792a715355cc0b9ca0f2))

## [3.0.1](https://github.com/KhaledSaeed18/dir-analysis-tool/compare/v3.0.0...v3.0.1) (2026-10-19)

### Bug Fixes

* do not report unreadable folders as empty ([b870457](https://github.com/KhaledSaeed18/dir-analysis-tool/commit/b870457ab644ba0745a9b491f96e99a2c0fadd75))
* issues found testing 3.0.0 end to end ([#3](https://github.com/KhaledSaeed18/dir-analysis-tool/issues/3)) ([446a8a7](https://github.com/KhaledSaeed18/dir-analysis-tool/commit/446a8a7112cc07ae2f3b64d3c2e0b71f3e64549a))
* make reports clearer and the HTML report easier to scan ([a7eee99](https://github.com/KhaledSaeed18/dir-analysis-tool/commit/a7eee99d883b554b0cb92ca8c640287bfc04d8d3))
* report a mistyped size or age as invalid ([e4b6642](https://github.com/KhaledSaeed18/dir-analysis-tool/commit/e4b664224eb8579c8a1ae952e3303eb9f003a70e))

### Performance Improvements

* throttle progress updates while finding duplicates ([2c0019c](https://github.com/KhaledSaeed18/dir-analysis-tool/commit/2c0019c56feac871572e13961771aba7db586c37))

## [3.0.0](https://github.com/KhaledSaeed18/dir-analysis-tool/compare/v2.0.7...v3.0.0) (2026-10-18)

### ⚠ BREAKING CHANGES

* dir-analysis-tool v3 (#1)
* Requires Node.js 22.12 or later. The JSON output has a
new versioned shape (schemaVersion 3) with raw byte counts and
root-relative paths. Sizes use binary units by default (--si for
decimal). Progress and status messages go to stderr. dist/ and build/ are
no longer excluded by default (.git, .hg, .svn, and node_modules still
are). --exclude takes one pattern per flag, --empty-files is now --empty,
--date-from/--date-to are now --newer-than/--older-than, and
--csv-large/--csv-duplicates were folded into --csv. Config keys were
renamed; v1 and v2 keys are still read, with a deprecation warning.

### Features

* dir-analysis-tool v3 ([#1](https://github.com/KhaledSaeed18/dir-analysis-tool/issues/1)) ([055c032](https://github.com/KhaledSaeed18/dir-analysis-tool/commit/055c032090b1efe01376a585ad64fd596241ab76))
* explain how to include default-excluded folders ([3fd71ad](https://github.com/KhaledSaeed18/dir-analysis-tool/commit/3fd71adcdf517d930494ee0a30f5db47084d0868))
* rewrite the analysis engine and CLI for v3 ([0245b56](https://github.com/KhaledSaeed18/dir-analysis-tool/commit/0245b5623eedead964dcf08a21140bd23e2b4935))

### Bug Fixes

* read a bare --large-files number as MiB, as v2 did ([d3d5c1b](https://github.com/KhaledSaeed18/dir-analysis-tool/commit/d3d5c1b3f8b9e5160eced63cabbf60d2536f7b3d))

## [2.0.7](https://github.com/KhaledSaeed18/dir-analysis-tool/compare/v2.0.6...v2.0.7) (2026-07-03)

## [2.0.6](https://github.com/KhaledSaeed18/dir-analysis-tool/compare/v2.0.5...v2.0.6) (2026-04-28)


### Bug Fixes

* **dependencies:** update package versions to specific ranges ([bce651e](https://github.com/KhaledSaeed18/dir-analysis-tool/commit/bce651ec04c59a28c4a5b03ef8f27023c48ed985))

## [2.0.5](https://github.com/KhaledSaeed18/dir-analysis-tool/compare/v2.0.4...v2.0.5) (2026-04-28)


### Bug Fixes

* **release:** remove id-token permission from workflow ([1cc498d](https://github.com/KhaledSaeed18/dir-analysis-tool/commit/1cc498d238faa3c1e4576d220443b0341e596fac))

## [2.0.4](https://github.com/KhaledSaeed18/dir-analysis-tool/compare/v2.0.3...v2.0.4) (2026-04-28)


### Bug Fixes

* **release:** restore NPM_TOKEN in release step environment ([e29f8f7](https://github.com/KhaledSaeed18/dir-analysis-tool/commit/e29f8f7db4aba5fd0486caacffdcd7146626a569))

## [2.0.3](https://github.com/KhaledSaeed18/dir-analysis-tool/compare/v2.0.2...v2.0.3) (2026-04-28)


### Bug Fixes

* **release:** remove registry-url from setup-node step in release workflow ([0d1f8e7](https://github.com/KhaledSaeed18/dir-analysis-tool/commit/0d1f8e7c1e882b62de6f4a46fed00b52c11ea682))

## [2.0.2](https://github.com/KhaledSaeed18/dir-analysis-tool/compare/v2.0.1...v2.0.2) (2026-04-28)


### Bug Fixes

* **release:** remove redundant NPM_TOKEN and NODE_AUTH_TOKEN from release workflow ([2887d57](https://github.com/KhaledSaeed18/dir-analysis-tool/commit/2887d5773274be5cbe7c4e1aa3e64e540d7f9e37))

## [2.0.1](https://github.com/KhaledSaeed18/dir-analysis-tool/compare/v2.0.0...v2.0.1) (2026-04-27)


### Bug Fixes

* **release:** update release workflow and clean up commit-analyzer configuration ([1a8d165](https://github.com/KhaledSaeed18/dir-analysis-tool/commit/1a8d165d2deb8018fee4d368f32a5fdecc3e633a))

# [2.0.0](https://github.com/KhaledSaeed18/dir-analysis-tool/compare/v1.0.1...v2.0.0) (2026-04-27)


### Bug Fixes

* **release:** restore npm auth fallback and enforce major bump ([6a1ceb3](https://github.com/KhaledSaeed18/dir-analysis-tool/commit/6a1ceb376ad6751b92dd4a2437c2418d1deecc04))

## [1.0.1](https://github.com/KhaledSaeed18/dir-analysis-tool/compare/v1.0.0...v1.0.1) (2026-04-27)


### Bug Fixes

* **release:** update release workflow and configuration for semantic-release ([fc9d475](https://github.com/KhaledSaeed18/dir-analysis-tool/commit/fc9d475f38053de7a94e918fc1dc8bcc4a006412))

# 1.0.0 (2026-04-27)


* feat!: v2 complete rewrite with streaming engine and subcommands ([5f88ed7](https://github.com/KhaledSaeed18/dir-analysis-tool/commit/5f88ed79645cca0dee953659281f3c8efc62d62e))


### Bug Fixes

* **ci:** install semantic-release plugins as devDependencies ([4ed6f7d](https://github.com/KhaledSaeed18/dir-analysis-tool/commit/4ed6f7db83ecfdd3ffc9cfa2219b648a4c1d1477))
* update clone URL in contributing guidelines ([6ad9e23](https://github.com/KhaledSaeed18/dir-analysis-tool/commit/6ad9e237ccc24aa9e304d8f1bdf85c2b3257def2))
* Update tool name references and version in documentation and code ([386ec62](https://github.com/KhaledSaeed18/dir-analysis-tool/commit/386ec62a5b42abff13437974faf373d355ef7df8))


### Features

* add contributing guidelines and pull request template ([9c08cf3](https://github.com/KhaledSaeed18/dir-analysis-tool/commit/9c08cf30cfa83da2907e47cb8dc96426db6a9d4a))
* Implement interactive directory analysis tool ([a8dd1f9](https://github.com/KhaledSaeed18/dir-analysis-tool/commit/a8dd1f9bc49401fb4ed46f378f1d0561a9177d95))


### BREAKING CHANGES

* - binary renamed to dat (dir-analysis-tool still works)
- --large-files now accepts MB instead of bytes
- --interactive removed (use `dat init`)
- --progress/--no-progress removed (auto-detected)
- build output moved from bin/ to dist/
