# Agent skill

[`dir-analysis-tool/`](dir-analysis-tool/SKILL.md) is the official [Agent Skill](https://agentskills.io) for dir-analysis-tool. It teaches coding agents to answer three kinds of questions with measurements instead of guesses:

- **Repository and directory size:** what takes the space, including `.git`, `node_modules`, and git-ignored build output.
- **Duplicate assets:** byte-identical files, grouped, with the space they waste and which copy to keep.
- **Size budgets:** whether a build output meets limits such as `size<=2MB` or `largest<=500kB`, and a ready-to-use CI step.

The skill drives the published CLI, version 3.2 or later (`dir-analysis-tool`, or `npx "dir-analysis-tool@^3.2"`), reads its JSON output, and never deletes files. It is a plain `SKILL.md` with one reference file, so it works in any agent that supports the Agent Skills format.

**Requirements:** Node.js 22.12 or later. If `dir-analysis-tool` 3.2 or later is not installed, the skill runs it through `npx`, which needs network access once.

## Install

### With the `skills` installer (any supported agent)

```bash
npx skills add KhaledSaeed18/dir-analysis-tool --skill dir-analysis-tool
```

It asks which agents to install for. Add `-g` to install for your user instead of the current project, or `-a <agent>` to choose agents up front (for example `-a claude-code -a codex`). Project installs go to `.agents/skills/`, which Codex, Gemini CLI, OpenCode, and GitHub Copilot read, plus a link in `.claude/skills/` for Claude Code.

### Gemini CLI

```bash
gemini skills install https://github.com/KhaledSaeed18/dir-analysis-tool.git --path skills/dir-analysis-tool
```

Add `--scope workspace` to install it for the current project only.

### Manually

Copy the `skills/dir-analysis-tool` folder into the folder your agent loads skills from:

| Agent                                       | Project           | User                           |
| ------------------------------------------- | ----------------- | ------------------------------ |
| Claude Code                                 | `.claude/skills/` | `~/.claude/skills/`            |
| Codex, Gemini CLI, OpenCode, GitHub Copilot | `.agents/skills/` | see your agent's documentation |
| Gemini CLI (also)                           | `.gemini/skills/` | `~/.gemini/skills/`            |

For example, for every project agent at once:

```bash
git clone --depth 1 https://github.com/KhaledSaeed18/dir-analysis-tool.git /tmp/dir-analysis-tool
mkdir -p .agents/skills && cp -R /tmp/dir-analysis-tool/skills/dir-analysis-tool .agents/skills/
```

Agents without Agent Skills support can still use it: add `skills/dir-analysis-tool/SKILL.md` to the agent's instructions or context.

## Use

Ask in your own words; the skill is picked by its description. For example:

- "Why is this repository 2 GB? The source is tiny."
- "Find duplicate images in `public/` and tell me how much space I would save."
- "Make CI fail if `dist/` goes over 2 MB or any file is bigger than 500 kB."

## Compatibility

Tested on macOS with the evals below. Each agent ran headless, with the skill installed in the project and never named in the prompt.

| Agent                         | Skill found and loaded                                                                     | Evals (4 prompts)                            |
| ----------------------------- | ------------------------------------------------------------------------------------------ | -------------------------------------------- |
| Claude Code 2.1               | Yes, from `.claude/skills/`                                                                | 4 of 4 correct, no files changed             |
| Codex CLI 0.164               | Yes, from `.agents/skills/`                                                                | 4 of 4 correct, no files changed             |
| OpenCode 2.1                  | Yes, from `.agents/skills/`                                                                | 4 of 4 correct, no files changed             |
| Gemini CLI 0.45               | Listed from `.gemini/skills/` and `.agents/skills/`; installs with `gemini skills install` | Not run: no model access on the test account |
| GitHub Copilot CLI, Qwen Code | Not tested                                                                                 | Not tested                                   |

Results depend on the model behind each agent; treat them as a smoke test, not a guarantee. Windows and Linux shells were not part of these runs, though the CLI itself is tested on both in CI.

## Evals

[`evals/dir-analysis-tool/`](evals/dir-analysis-tool/) holds the evaluation set; it is kept outside the skill folder so agents never see the expected answers.

- `make-fixtures.mjs` builds three deterministic trees (a repository with `.git`, `node_modules`, and ignored build output; a folder of copied photos and documents with look-alikes; a `dist/` folder with a project budget). `--verify` checks afterwards that the agent changed nothing.
- `evals.json` has four prompts with expected answers and checkable expectations (format of the skill-creator tooling).
- `trigger-queries.json` lists requests that should and should not activate the skill.

```bash
node skills/evals/dir-analysis-tool/make-fixtures.mjs /tmp/dat-evals
# Run each prompt from evals.json in your agent, with {fixtures} replaced by /tmp/dat-evals
node skills/evals/dir-analysis-tool/make-fixtures.mjs --verify /tmp/dat-evals
```

`test/integration/skill.test.ts` keeps all of this honest in CI: it validates the skill's frontmatter and links, fails if the skill mentions an option the CLI does not have, and checks the expected numbers in `evals.json` against the real CLI.
