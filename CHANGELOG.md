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
