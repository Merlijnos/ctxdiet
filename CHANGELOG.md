# Changelog

All notable changes to this project are documented here.

## [0.3.0]

- **Modern CLI UI.** Rebuilt output on `@clack/prompts` + `picocolors` (intro/outro,
  log, note boxes). Dropped `chalk`, `cli-table3`, and `diff` — fewer, lighter deps.
- **Summaries, not diffs.** `fix` shows a one-line summary per change and a `[y/N]`
  confirm, instead of dumping a raw unified diff.
- **Interactive duplicate resolution.** When reworded near-duplicate rules are found,
  `fix` walks each pair with Keep A / Keep B / Merge in editor / Skip. "Merge" opens
  `$EDITOR` (fallback `nano`) on a temp file and applies the merged result. Detection
  stays offline lexical word-overlap — no ML, no network.

## [0.2.0]

- **Accurate token counts.** Text files are now measured with a real BPE tokenizer
  (`gpt-tokenizer`, pure-JS, offline) instead of chars/4. Heavy directories still use a
  bounded byte estimate. No exact offline Claude tokenizer exists; the GPT-4 encoding is
  used as a close cross-model proxy.
- **CI budget gate.** `--max-tokens <n>` exits non-zero when context exceeds the budget —
  for pre-commit hooks and PR checks.
- **GitHub Action** (`action.yml`) and a **pre-commit hook** (`.pre-commit-hooks.yaml`).
- **Possible-duplicate detection.** Flags reworded near-duplicate rule lines (lexical
  overlap, offline) for manual merge — never auto-changed.
- Reframed around agent reasoning quality, not just cost.

## [0.1.1]

- Clearer scan output: problems show *what* and *why* per row; a clean setup says so
  plainly instead of printing an empty table.
- One-step flow: when a scan finds fixable issues in an interactive terminal, it offers
  to fix them right away (no separate `fix` command needed).
- Runtime notice when launched as `slimclaude` pointing to the new `ctxdiet` name.

## [0.1.0]

Initial release.

- **Detect → fix → measure** for AI coding-agent context-token waste.
- Multi-agent auto-detection: Claude Code, Codex / `AGENTS.md`, Cursor, Gemini CLI,
  Windsurf, GitHub Copilot. Only detected agents are scanned and reported.
- Per-agent detection of: bloated memory files, missing/weak ignore files, configured
  MCP servers, and orphaned Claude-style definitions.
- `ctxdiet` (scan) prints a per-agent findings table, a headline savings estimate,
  a letter grade, and a separate confidence-tiered review section.
- `ctxdiet fix` shows reviewable diffs, confirms per change (`[y/N]` / `--yes` /
  `--dry-run`), backs up every modified file, archives (never deletes), and prints a
  before/after savings table.
- Confidence tiers: only provably-dead waste counts toward the headline and `--yes`;
  usage-unconfirmed items (MCP servers, real definitions) are review-only and never
  touched by `--yes`.
- Token estimation via a documented chars/4 heuristic. No network, no telemetry,
  no session-history analysis.
