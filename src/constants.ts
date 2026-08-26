// All numbers here are deliberate, documented heuristics. See README "How it
// estimates tokens". ctxdiet never claims exactness.

/** The one and only token heuristic: ~4 chars per token. */
export const CHARS_PER_TOKEN = 4;

/** Rough average token cost of one MCP server's injected tool schemas. */
export const MCP_SERVER_TOKEN_EST = 550;

/** A session reads only a fraction of a heavy dir; cap the per-path estimate. */
export const HEAVY_PATH_TOKEN_CAP = 5000;

/** Bound the directory walk so scanning stays fast on huge trees. */
export const HEAVY_WALK_MAX_FILES = 2000;
export const HEAVY_WALK_MAX_BYTES = 8 * 1024 * 1024;

/**
 * Context window per model, in tokens. Used only to express config cost as a
 * share of the window: "7% of every session is gone before you type" lands in
 * a way that "14,233 tokens" does not.
 */
export const CONTEXT_WINDOW: Record<string, number> = {
  opus: 200_000,
  sonnet: 200_000,
  haiku: 200_000,
};

/** Usage evidence: how far back to look, and the caps that keep a scan fast. */
export const USAGE_WINDOW_DAYS = 90;
export const USAGE_MAX_FILES = 400;
export const USAGE_MAX_BYTES = 64 * 1024 * 1024;

/** Below these, an absence of calls is not evidence of anything. */
export const USAGE_MIN_SESSIONS = 5;
export const USAGE_MIN_DAYS = 7;

/** Claude Code stops expanding @imports after this many hops; so do we. */
export const MEMORY_IMPORT_MAX_DEPTH = 5;

/** How deep to look for skill folders under a skills/ root (plugins nest them). */
export const DEFINITION_MAX_DEPTH = 4;

/** Ceiling on a single reported item, so one huge tree can't dwarf the report. */
export const DEFINITION_TOKEN_CAP = 20000;

/** A CLAUDE.md above this with no trimmable redundancy is flagged for manual review. */
export const LARGE_CLAUDEMD_TOKENS = 3000;

/** Grade thresholds on HIGH-confidence waste tokens/session. */
const GRADE_THRESHOLDS: ReadonlyArray<readonly [number, string]> = [
  [500, "A"],
  [2000, "B"],
  [5000, "C"],
  [10000, "D"],
];

export const GRADES = ["A", "B", "C", "D", "F"] as const;
export type Grade = (typeof GRADES)[number];

/** Lower is better. Used by --fail-on to compare a result against a floor. */
export function gradeRank(g: string): number {
  const i = (GRADES as readonly string[]).indexOf(g);
  return i < 0 ? GRADES.length : i;
}

export function grade(wasteTokens: number): string {
  for (const [limit, letter] of GRADE_THRESHOLDS) {
    if (wasteTokens < limit) return letter;
  }
  return "F";
}
