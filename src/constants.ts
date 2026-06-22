// All numbers here are deliberate, documented heuristics — see README "How it
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

/** A CLAUDE.md above this with no trimmable redundancy is flagged for manual review. */
export const LARGE_CLAUDEMD_TOKENS = 3000;

/** Grade thresholds on HIGH-confidence waste tokens/session. */
const GRADE_THRESHOLDS: ReadonlyArray<readonly [number, string]> = [
  [500, "A"],
  [2000, "B"],
  [5000, "C"],
  [10000, "D"],
];

export function grade(wasteTokens: number): string {
  for (const [limit, letter] of GRADE_THRESHOLDS) {
    if (wasteTokens < limit) return letter;
  }
  return "F";
}
