export type Model = "opus" | "sonnet" | "haiku";

/** Agent-agnostic finding type. */
export type Category = "Memory" | "Ignore" | "MCP" | "Definitions";

export type Confidence = "high" | "low";

export interface ResolvedOptions {
  /** Project directory being scanned. */
  path: string;
  /** Home directory holding global agent config (~/.claude, ~/.codex, …). */
  home: string;
  sessionsPerMonth: number;
  model: Model;
  /** True when the model was auto-detected from Claude config, not passed in. */
  modelDetected: boolean;
  json: boolean;
  dryRun: boolean;
  yes: boolean;
}

export type FixAction =
  | { type: "trim"; path: string }
  | { type: "ignore-create"; path: string; content: string }
  | { type: "ignore-augment"; path: string; added: string[] }
  | { type: "mcp-disable"; path: string; server: string }
  | { type: "archive"; path: string; archiveTo: string };

export interface Finding {
  /** Human label of the agent this finding belongs to, e.g. "Claude Code". */
  agent: string;
  category: Category;
  /** Short "what was found" line for the table. */
  title: string;
  detail?: string;
  tokensPerSession: number;
  confidence: Confidence;
  /** Whether `fix` can act on it at all (false = pure manual review note). */
  fixable: boolean;
  manualReview?: boolean;
  action?: FixAction;
}

export interface DetectedAgent {
  id: string;
  label: string;
}

export interface ScanResult {
  options: ResolvedOptions;
  detectedAgents: DetectedAgent[];
  findings: Finding[];
  /** Full persistent context estimate (drives the before/after total row). */
  baselineTokens: number;
  /** HIGH-confidence savings only — the green headline and the grade. */
  headlineSavings: number;
  /** LOW-confidence potential, reported separately and explicitly unconfirmed. */
  lowConfidencePotential: number;
  grade: string;
}
