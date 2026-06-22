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
┌────────────────────────┬────────┬───┬───────┬────────┐
│                        │ Before │   │ After │  Saved │
├────────────────────────┼────────┼───┼───────┼────────┤
│ Context tokens/session │ 21,346 │ → │ 1,227 │ 20,119 │
│ Grade                  │     F  │ → │    A  │        │
└────────────────────────┴────────┴───┴───────┴────────┘
```

A repo using Claude Code + Cursor: trimmed duplicate memory lines, generated the missing
ignore files so `node_modules`/build output stops leaking into context, archived dead
`~/.claude` files. ~20k fewer tokens of noise the agent has to read every session.

## Agents

Auto-detected; only the ones you use are scanned.

| Agent          | Memory                                  | Ignore           |
| -------------- | --------------------------------------- | ---------------- |
| Claude Code    | `CLAUDE.md`, `~/.claude/CLAUDE.md`      | `.claudeignore`  |
| Codex          | `AGENTS.md`                             | —                |
| Cursor         | `.cursorrules`, `.cursor/rules/*.mdc`   | `.cursorignore`  |
| Gemini CLI     | `GEMINI.md`                             | `.geminiignore`  |
| Windsurf       | `.windsurfrules`                        | `.codeiumignore` |
| GitHub Copilot | `.github/copilot-instructions.md`       | —                |

## What it does

- **Finds** the noise: duplicate/repeated instruction lines, missing ignore files that let
  heavy dirs leak into context, MCP tool schemas reloaded every session, and dead
  `~/.claude` files (empty, `.bak`, broken skills).
- **Fixes** each with a diff you confirm. Never deletes (archives instead), always writes a
  `.bak`, and `--yes` only touches provably-dead waste.
- **Leaves alone** anything whose usage it can't verify (MCP servers, real skills) — listed
  for review, never auto-removed.

It also flags **reworded near-duplicate rules** for you to merge (lexical, offline — it
won't touch them).

Token counts use a real BPE tokenizer (`gpt-tokenizer`, offline) for text files and a
size estimate for directories. There's no exact offline Claude tokenizer, so the GPT-4
encoding is used as a close cross-model proxy — good for ranking what to cut, not a
billing figure.

## Keep it lean in CI

Fail a build or commit when context drifts past a budget:

```yaml
# .github/workflows/ctxdiet.yml
- uses: Merlijnos/ctxdiet@v0.2.0
  with:
    max-tokens: 8000
```

```yaml
# .pre-commit-config.yaml
- repo: https://github.com/Merlijnos/ctxdiet
  rev: v0.2.0
  hooks:
    - id: ctxdiet
      args: ["--max-tokens", "8000"]
```

Or directly: `npx ctxdiet --max-tokens 8000` (exits non-zero when over).

## Flags

```
--path <dir>                directory to scan (default: current)
--max-tokens <n>            CI budget: exit non-zero if context exceeds n tokens
--model <opus|sonnet|haiku> pricing for the optional $ estimate (default: sonnet)
--sessions-per-month <n>    default 100
--dry-run                   show diffs, write nothing
--yes                       apply without prompting
--json                      machine-readable output
```

Node 20+. MIT. Sponsor: https://github.com/sponsors/Merlijnos
