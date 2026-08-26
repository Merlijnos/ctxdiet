# ctxdiet

[![npm version](https://img.shields.io/npm/v/ctxdiet.svg)](https://www.npmjs.com/package/ctxdiet)
[![CI](https://github.com/Merlijnos/ctxdiet/actions/workflows/ci.yml/badge.svg)](https://github.com/Merlijnos/ctxdiet/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](./LICENSE)

Every session starts by loading your memory files, their imports, your ignore-file
gaps, every MCP server's tool schemas, and every skill and subagent description,
all before you type a word. Bloat there doesn't just cost money; it buries the guidance
you actually care about, so the model skims and drifts.

ctxdiet measures that startup cost, **proves which of it you never use**, and reclaims
it. Local, offline, no account.

```
npx ctxdiet        # scan, read-only
npx ctxdiet fix    # summary per change, confirm, apply
```

> Prompt caching makes repeated context *cheaper*, not *better to read*. Bloat still
> fills the context window and degrades the model's attention. ctxdiet is about keeping
> instructions sharp, not just the bill low.

## Evidence, not guesswork

Most of what a scanner can tell you is obvious from your config. The expensive part
isn't: an MCP server costs ~550 tokens of tool schemas every session whether or not
you've ever called it, and no config file records that.

Your session transcripts do. ctxdiet reads them locally and turns the question back
into an answer:

```
Claude Code · Gmail (./.mcp.json)  -550 tok
  no calls to any Gmail tool; disable to reclaim its tool schemas
  evidence: 0 calls in 47 sessions over 62 days
```

Servers and skills you *do* use drop out of the report entirely, so what's left is
worth reading.

- **Local only.** Nothing is uploaded. It reads tool *names* only, never prompts,
  arguments, or file contents. `--no-usage` turns it off completely.
- **Honest about thin evidence.** Under 5 sessions or 7 days of history, nothing is
  called unused, because a skill you installed yesterday isn't waste. The report always
  states the window it read.
- **Evidence doesn't override consent.** `--yes` still only touches provably-dead
  waste. Rare use is not no use, so disabling a never-used server takes an explicit
  `--include-unused`.

## Use it from your agent

```
claude mcp add ctxdiet -- npx -y ctxdiet mcp
```

Then ask "why is my context so big?" and the agent answers with real numbers.
Two read-only tools: `ctxdiet_scan` and `ctxdiet_plan`.

Writes are deliberately not exposed over MCP. `fix` rewrites your memory files and
MCP config. That's a decision to make with a summary in front of you, not one an
agent takes mid-conversation because it seemed helpful.

## How it compares

ctxdiet is the only one of these that changes anything.

| | What it does | Overlap |
| --- | --- | --- |
| **ctxdiet** | Audits what loads *before you type*, proves what's unused, reclaims it | n/a |
| [ccusage](https://github.com/ryoppippi/ccusage) | Reports what you already spent, from usage logs | Both read local history; ccusage measures spend, ctxdiet cuts the fixed cost |
| [rulesync](https://github.com/dyoshikawa/rulesync) | Generates and syncs rule files across agents | Complementary: it keeps your rules in sync, ctxdiet keeps them lean |
| [repomix](https://github.com/yamadashy/repomix) | Packs repo *code* into a prompt | Different input: per-prompt code, not per-session config |

Run ctxdiet alongside any of them.

## What one cleanup looks like

```
Before vs after
Context  21,346 → 1,227   -20,119 tok
Window   10.7% of a 200k window → 0.6% of a 200k window
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
| Codex            | `AGENTS.md` (including nested)                 | none             |
| Cursor           | `.cursorrules`, `.cursor/rules/*.mdc`         | `.cursorignore`  |
| Gemini CLI       | `GEMINI.md`                                   | `.geminiignore`  |
| Windsurf         | `.windsurfrules`, `.windsurf/rules/*.md`      | `.codeiumignore` |
| GitHub Copilot   | `.github/copilot-instructions.md`             | none             |
| Amp              | `AGENT.md`                                    | none             |
| Cline            | `.clinerules`                                 | `.clineignore`   |
| Roo Code         | `.roorules`, `.roo/rules/*.md`                | `.rooignore`     |
| Continue         | `.continue/rules/*.md`                        | none             |
| JetBrains Junie  | `.junie/guidelines.md`                        | none             |
| Zed              | `.rules`                                      | none             |
| Aider            | `CONVENTIONS.md`                              | `.aiderignore`   |
| Amazon Q         | `.amazonq/rules/*.md`                         | none             |

Claude-style definitions (`agents/`, `skills/`, `commands/`) are inventoried at
both scopes: `~/.claude` and the project's own `.claude`.

## What it does

- **Finds** the noise: instruction lines pasted twice, missing ignore files that let heavy
  dirs leak into context, MCP tool schemas reloaded every session, and definitions whose
  descriptions are injected into every session whether or not you use them.
- **Follows `@imports`.** A memory file that pulls in other files loads all of them every
  session, transitively. Scanning only the top-level file understates exactly the setups
  most worth trimming.
- **Fixes** each with a summary you confirm. Never deletes (archives instead), always
  writes a `.bak`, and `--yes` only touches provably-dead waste.
- **Leaves alone** anything whose usage it can't verify (MCP servers, real skills). Those
  are listed for review, never auto-removed.

It also flags **reworded near-duplicate rules** and lets you resolve them interactively
(keep one, or merge in your editor). Lexical and offline, no ML.

### How it counts

Text files are measured with a real BPE tokenizer (`gpt-tokenizer`, offline); directories
are estimated from size. There's no exact offline Claude tokenizer, so the GPT-4 encoding
is used as a close cross-model proxy: good for ranking what to cut, not a billing figure.

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
- uses: Merlijnos/ctxdiet@v0.5.0
  with:
    max-tokens: 8000
    fail-on: B        # optional quality floor, independent of the token budget
```

```yaml
# .pre-commit-config.yaml
- repo: https://github.com/Merlijnos/ctxdiet
  rev: v0.5.0
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
--no-usage                  skip local session history; judge config alone
--include-unused            let --yes act on items history shows are never used
--dry-run                   show what would change, write nothing
--yes                       apply high-confidence fixes without prompting
--json                      machine-readable output (carries a schemaVersion)
```

Exit codes: `0` clean, `1` a gate failed, `2` the invocation was wrong.

`ctxdiet fix --json --yes` applies high-confidence fixes non-interactively and prints
the paths it touched, so it's usable from a script.

Commands: `ctxdiet` (scan), `ctxdiet fix` (apply), `ctxdiet mcp` (serve over stdio).

Node 22.12+. MIT. Sponsor: https://github.com/sponsors/Merlijnos
