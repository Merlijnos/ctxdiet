# Changelog

All notable changes to this project are documented here.

## [0.5.0]

Everything ctxdiet reported could be derived from config files alone — which
meant the two most expensive categories, MCP servers and skills, could only ever
be listed as "usage not confirmed". This release reads the evidence that was
already on disk.

### Added

- **Usage evidence.** ctxdiet now reads local session transcripts
  (`~/.claude/projects`) to prove which MCP servers, skills and subagents are
  actually invoked. "Usage not confirmed — disable only if you know" becomes
  "0 calls in 47 sessions over 62 days". Things you *do* use drop out of the
  report entirely, so what remains is worth reading.

  Local files only, nothing uploaded, and only tool *names* are read — never
  prompts, arguments or file contents. `--no-usage` turns it off. Below 5
  sessions or 7 days of history nothing is called unused, because a skill
  installed yesterday is not waste.

  The safety promise is unchanged: `--yes` still touches only provably-dead
  waste. Rare use is not no use, so acting on a never-used item takes an
  explicit `--include-unused`.

- **MCP server mode.** `ctxdiet mcp` serves the scan over stdio, so your agent
  can audit its own context when you ask why a session feels sluggish:

      claude mcp add ctxdiet -- npx -y ctxdiet mcp

  Two read-only tools — `ctxdiet_scan` and `ctxdiet_plan`. Writes are
  deliberately not exposed: `fix` rewrites your memory and MCP config, which is
  a decision to make with a summary in front of you, not one an agent takes
  mid-conversation. Adds no dependencies.

- **Context expressed as a share of the window.** "14,233 tokens" has no
  denominator; "5.5% of a 200k window" is the same fact in a unit people
  reason about. Shown in the header and the before/after block, and exposed as
  `contextWindowTokens` / `baselineShareOfWindow` in `--json`.

### Changed

- Findings carry `autoApply` separately from `confidence`, so "we are sure this
  is unused" and "this is safe to change unattended" stop being the same field.
- 98 tests, up from 72, covering the usage engine and the MCP wire protocol.

## [0.4.0]

The package had gone a while without an update. This release is mostly about
correctness: running it against a real `~/.claude` surfaced numbers that were
not just imprecise but impossible, and a trim that could change what a memory
file said.

### Fixed

- **The CLI crashed on part of its own supported Node range.** The CommonJS
  build did `require()` on `@clack/prompts`, which is ESM-only, so 0.3.0 threw
  `ERR_REQUIRE_ESM` on Node 20.0-20.18 and 22.0-22.11. The package is now ESM.
- **Unloadable files were priced as savings.** A `skills/` layout that nests
  (`skills/synced/<name>/SKILL.md`) was reported as "missing SKILL.md", sized
  by full recursive byte count, and offered up for archiving. On one machine
  that read as `-929,843 tokens/session` and grade F, and `--yes` would have
  archived eight working skills. Skill discovery recurses now, per-item counts
  are capped, and files the runtime cannot load are reported as clutter worth
  zero tokens — they can no longer drive the headline or the grade.
- **Trimming could change what a file said.** Duplicate headings were dropped
  globally, which reparented the following section under the previous heading,
  and identical lines were removed across the whole file. Heading removal is
  now limited to headings that introduce nothing, and line deduplication resets
  at each heading. Front matter, indented code, tilde fences, unterminated
  fences and table rows are all left alone.
- **Ignore files were barely matched.** `ignoreCovers` compared literal
  strings, so `**/node_modules/**`, `node_modules/*` and `/node_modules` were
  all reported as "weak". Ignore matching now follows the gitignore rules that
  decide this: negation, anchoring, directory-only patterns and wildcards.
- **`fix --json` applied nothing.** It printed what it would do and returned,
  so `fix --json --yes` in a pipeline was a no-op.
- Re-running `fix` stacked a duplicate `# added by ctxdiet` block on every
  pass, and the patterns it added did not necessarily cover the paths that
  triggered the finding.
- A blank `$EDITOR` crashed interactive duplicate merging.

### Added

- **@imports are followed.** Claude Code expands `@path/to/file` inside a
  memory file, and those files can import further files — all of it loaded
  every session. Only the top-level file used to be read, so lean-looking
  setups that import several rule files were the ones most understated.
- **Definitions are priced honestly.** Agents, skills and commands only inject
  their front-matter name and description into a session; the body is read on
  invocation. Both are now reported separately.
- **Project-scope definitions are scanned.** Only `~/.claude` was looked at, so
  a repo checking its subagents and commands into `.claude/` had that context
  counted as free. Archiving keeps a definition in the `.claude` directory it
  came from.
- **Eight more agents**: Amp, Cline, Roo Code, Continue, JetBrains Junie, Zed,
  Aider and Amazon Q Developer. Plus nested `AGENTS.md`, global Cursor and
  Windsurf rules, and Copilot's `.github/mcp.json`.
- **`--fail-on <grade>`** for a quality floor in CI, alongside `--max-tokens`.
  Also on the GitHub Action, where `max-tokens` is now optional.
- `--json` carries a `schemaVersion`, every finding carries the `path` it
  concerns, and overlaps are emitted in full rather than as a count.
- Invalid flags exit 2, so CI can tell a bad invocation from a failed gate.

### Changed

- **Node 22.12+** (was 20). Node 20 reached end of life in April 2026.
- Toolchain: TypeScript 7, commander 15, gpt-tokenizer 4, `@types/node` 26.
- `walkFiles` prunes heavy directories, so a nested `AGENTS.md` search no
  longer descends into `node_modules`.
- 72 tests, up from 2; 83% line coverage. The lockfile is committed and CI
  runs `npm ci` against Node 22 and 24.

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
