# Changelog

All notable changes to this project are documented here.

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
