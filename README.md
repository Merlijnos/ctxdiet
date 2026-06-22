# ctxdiet

[![npm version](https://img.shields.io/npm/v/ctxdiet.svg)](https://www.npmjs.com/package/ctxdiet)
[![CI](https://github.com/Merlijnos/ctxdiet/actions/workflows/ci.yml/badge.svg)](https://github.com/Merlijnos/ctxdiet/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](./LICENSE)

Your AI coding agents reload the same context every session. ctxdiet finds the
waste, fixes it with diffs you approve, and shows what you saved. Local, no account.

```
npx ctxdiet        # scan, read-only
npx ctxdiet fix    # show diffs, confirm, apply, measure
```

## What one fix looks like

```
Before vs after
┌────────────────────────┬────────┬───┬───────┬────────┐
│                        │ Before │   │ After │  Saved │
├────────────────────────┼────────┼───┼───────┼────────┤
│ Context tokens/session │ 21,346 │ → │ 1,227 │ 20,119 │
│ $/month                │  $6.40 │ → │ $0.37 │  $6.04 │
│ Grade                  │     F  │ → │    A  │        │
└────────────────────────┴────────┴───┴───────┴────────┘
```

Real run on a repo using Claude Code + Cursor: trimmed duplicate memory lines,
created `.claudeignore` and `.cursorignore`, archived dead `~/.claude` files.

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

- **Finds:** duplicate memory lines, missing ignore files, MCP tool schemas, and
  dead `~/.claude` files (empty, `.bak`, broken skills).
- **Fixes** each with a diff you confirm. Never deletes (archives instead), always
  writes a `.bak`, and `--yes` only touches provably-dead waste.
- **Leaves alone** anything whose usage it can't verify (MCP servers, real skills).
  It doesn't read your history, so those are listed for review, never auto-removed.

Token numbers are a `chars / 4` estimate, not a tokenizer — close enough to rank waste.

## Flags

```
--path <dir>                directory to scan (default: current)
--model <opus|sonnet|haiku> pricing for the $ estimate (default: sonnet)
--sessions-per-month <n>    default 100
--dry-run                   show diffs, write nothing
--yes                       apply without prompting
--json                      machine-readable output
```

Node 20+. MIT. Sponsor: https://github.com/sponsors/Merlijnos
