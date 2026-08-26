# ctxdiet

[![npm version](https://img.shields.io/npm/v/ctxdiet.svg)](https://www.npmjs.com/package/ctxdiet)
[![CI](https://github.com/Merlijnos/ctxdiet/actions/workflows/ci.yml/badge.svg)](https://github.com/Merlijnos/ctxdiet/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](./LICENSE)

Bloated agent instructions make your coding agent *worse*. Duplicate and conflicting
rules bury the signal, so the model skims, drifts, and ignores the guidance you actually
care about. ctxdiet finds the dead weight in your agent config, trims it with diffs you
approve, and shows the context you reclaimed. Local, no account.

> Prompt caching makes repeated context *cheaper* — not *better to read*. Bloat still
> fills the context window and degrades the model's attention. ctxdiet is about keeping
> instructions sharp, not just the bill low.

```
npx ctxdiet        # scan, read-only
npx ctxdiet fix    # show diffs, confirm, apply
```

## What one cleanup looks like

```
Before vs after
Context  21,346 → 1,227   -20,119 tok
Cost     $6.40  → $0.37/mo   -$6.03
Grade    F → A
```

A repo using Claude Code + Cursor: trimmed memory lines pasted twice, generated the
missing ignore files so `node_modules`/build output stops leaking into context, and
followed the `@imports` that were pulling three more rule files into every session.

## Agents

Auto-detected; only the ones you use are scanned.

| Agent            | Memory                                        | Ignore           |
| ---------------- | --------------------------------------------- | ---------------- |
| Claude Code      | `CLAUDE.md`, `~/.claude/CLAUDE.md`            | `.claudeignore`  |
| Codex            | `AGENTS.md` (including nested)                 | —                |
| Cursor           | `.cursorrules`, `.cursor/rules/*.mdc`         | `.cursorignore`  |
| Gemini CLI       | `GEMINI.md`                                   | `.geminiignore`  |
| Windsurf         | `.windsurfrules`, `.windsurf/rules/*.md`      | `.codeiumignore` |
| GitHub Copilot   | `.github/copilot-instructions.md`             | —                |
| Amp              | `AGENT.md`                                    | —                |
| Cline            | `.clinerules`                                 | `.clineignore`   |
| Roo Code         | `.roorules`, `.roo/rules/*.md`                | `.rooignore`     |
| Continue         | `.continue/rules/*.md`                        | —                |
| JetBrains Junie  | `.junie/guidelines.md`                        | —                |
| Zed              | `.rules`                                      | —                |
| Aider            | `CONVENTIONS.md`                              | `.aiderignore`   |
| Amazon Q         | `.amazonq/rules/*.md`                         | —                |

Claude-style definitions (`agents/`, `skills/`, `commands/`) are inventoried at
both scopes — `~/.claude` and the project's own `.claude`.

## What it does

- **Finds** the noise: instruction lines pasted twice, missing ignore files that let heavy
  dirs leak into context, MCP tool schemas reloaded every session, and definitions whose
  descriptions are injected into every session whether or not you use them.
- **Follows `@imports`.** A memory file that pulls in other files loads all of them every
  session, transitively. Scanning only the top-level file understates exactly the setups
  most worth trimming.
- **Fixes** each with a summary you confirm. Never deletes (archives instead), always
  writes a `.bak`, and `--yes` only touches provably-dead waste.
- **Leaves alone** anything whose usage it can't verify (MCP servers, real skills) — listed
  for review, never auto-removed.

It also flags **reworded near-duplicate rules** and lets you resolve them interactively
(keep one, or merge in your editor) — lexical and offline, no ML.

### How it counts

Text files are measured with a real BPE tokenizer (`gpt-tokenizer`, offline); directories
are estimated from size. There's no exact offline Claude tokenizer, so the GPT-4 encoding
is used as a close cross-model proxy — good for ranking what to cut, not a billing figure.

Two rules keep the numbers honest:

- **Only what loads counts.** Agents, skills and commands inject their front-matter
  name and description into every session; the body is read when you invoke them. The
  per-session figure is the front matter, with the body reported separately.
- **Unloadable files are worth zero tokens.** A broken skill folder or a stale `.bak`
  costs disk, not context. ctxdiet offers to archive them, but they never count toward
  the headline or the grade.

## Keep it lean in CI

Fail a build or commit when context drifts past a budget:

```yaml
# .github/workflows/ctxdiet.yml
- uses: Merlijnos/ctxdiet@v0.4.0
  with:
    max-tokens: 8000
    fail-on: B        # optional quality floor, independent of the token budget
```

```yaml
# .pre-commit-config.yaml
- repo: https://github.com/Merlijnos/ctxdiet
  rev: v0.4.0
  hooks:
    - id: ctxdiet
      args: ["--max-tokens", "8000"]
```

Or directly: `npx ctxdiet --max-tokens 8000` (exits non-zero when over).

## Flags

```
--path <dir>                directory to scan (default: current)
--max-tokens <n>            CI budget: exit non-zero if context exceeds n tokens
--fail-on <grade>           CI gate: exit non-zero if the grade is worse than this (A-F)
--model <opus|sonnet|haiku> pricing for the optional $ estimate (default: sonnet)
--sessions-per-month <n>    default 100
--dry-run                   show what would change, write nothing
--yes                       apply high-confidence fixes without prompting
--json                      machine-readable output (carries a schemaVersion)
```

Exit codes: `0` clean, `1` a gate failed, `2` the invocation was wrong.

`ctxdiet fix --json --yes` applies high-confidence fixes non-interactively and prints
the paths it touched — usable from a script.

Node 22.12+. MIT. Sponsor: https://github.com/sponsors/Merlijnos
