export type Model = "opus" | "sonnet" | "haiku";

/** Agent-agnostic finding type. */
export type Category = "Memory" | "Ignore" | "MCP" | "Definitions";

export type Confidence = "high" | "low";

export interface ResolvedOptions {
  /** ctxdiet's own version, for the MCP handshake. */
  version: string;
  /** Project directory being scanned. */
  path: string;
  /** Home directory holding global agent config (~/.claude, ~/.codex, …). */
  home: string;
  sessionsPerMonth: number;
  model: Model;
  /** True when the model was auto-detected from Claude config, not passed in. */
  modelDetected: boolean;
  /** CI budget: exit non-zero if baseline context exceeds this. null = off. */
  maxTokens: number | null;
  /** CI gate: exit non-zero if the grade is worse than this. null = off. */
  failOn: string | null;
  /** Read local session history to prove what is actually used. */
  usage: boolean;
  /** Let `--yes` also act on evidence-backed unused items. */
  includeUnused: boolean;
  json: boolean;
  dryRun: boolean;
  yes: boolean;
}

export type FixAction =
  | { type: "trim"; path: string }
  | { type: "ignore-create"; path: string; content: string }
  | { type: "ignore-augment"; path: string; added: string[] }
  | { type: "mcp-disable"; path: string; server: string }
  | { type: "archive"; path: string; archiveTo: string }
  | { type: "archive-many"; paths: string[]; home: string };

export interface Finding {
  /** Human label of the agent this finding belongs to, e.g. "Claude Code". */
  agent: string;
  category: Category;
  /** Short "what was found" line for the table. */
  title: string;
  /** Absolute path this finding is about, when it is about one file. */
  path?: string;
  detail?: string;
  tokensPerSession: number;
  confidence: Confidence;
  /** Whether `fix` can act on it at all (false = pure manual review note). */
  fixable: boolean;
  /**
   * Safe for `--yes` on its own. True only for provably-dead waste. An
   * evidence-backed "unused for 62 days" can be high confidence and still
   * require `--include-unused`: rare use is not no use, and disabling an MCP
   * server someone needs once a month is a worse outcome than leaving it.
   */
  autoApply: boolean;
  /** What the session history showed, when it was consulted. */
  evidence?: string;
  manualReview?: boolean;
  action?: FixAction;
}

/** Reportable summary of the session-history scan. */
export interface UsageSummary {
  consulted: boolean;
  sessions: number;
  days: number;
  conclusive: boolean;
  note?: string;
}

export interface DetectedAgent {
  id: string;
  label: string;
}

/** A reworded-duplicate rule pair, flagged for interactive resolution in `fix`. */
export interface Overlap {
  agent: string;
  /** Absolute path to the file containing the pair (for editing). */
  path: string;
  a: string;
  b: string;
}

export interface ScanResult {
  options: ResolvedOptions;
  /** How the usage evidence was gathered, for reporting. */
  usage: UsageSummary;
  detectedAgents: DetectedAgent[];
  findings: Finding[];
  overlaps: Overlap[];
  /** Full persistent context estimate (drives the before/after total row). */
  baselineTokens: number;
  /** HIGH-confidence savings only: the green headline and the grade. */
  headlineSavings: number;
  /** LOW-confidence potential, reported separately and explicitly unconfirmed. */
  lowConfidencePotential: number;
  grade: string;
}
