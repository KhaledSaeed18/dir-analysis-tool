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
