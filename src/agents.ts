import path from "node:path";

import { exists, isDir, isFile, uniq, walkFiles } from "./sources.js";
import type { ResolvedOptions } from "./types.js";

/**
 * A coding agent and the persistent-context files it loads every session.
 * ctxdiet auto-detects which agents a repo (or the home dir) actually uses
 * and only scans/tailors output for those.
 */
export interface AgentDef {
  id: string;
  label: string;
  /** Persistent memory/instruction files this agent reads (project + global). */
  memoryFiles(o: ResolvedOptions): string[];
  /** Project-relative dedicated ignore filename, if the agent has one. */
  ignoreFile?: string;
  /** JSON config files that may expose an `mcpServers` map. */
  mcpFiles(o: ResolvedOptions): string[];
  /** Paths whose existence proves the agent is in use here. */
  detectSignals(o: ResolvedOptions): string[];
  /** Whether this agent owns the Claude-style ~/.claude definition inventory. */
  ownsDefinitions?: boolean;
}

const P = (o: ResolvedOptions, ...parts: string[]) => path.join(o.path, ...parts);
const H = (o: ResolvedOptions, ...parts: string[]) => path.join(o.home, ...parts);

export const AGENTS: AgentDef[] = [
  {
    id: "claude",
    label: "Claude Code",
    ownsDefinitions: true,
    memoryFiles: (o) =>
      uniq([P(o, "CLAUDE.md"), P(o, ".claude", "CLAUDE.md"), H(o, ".claude", "CLAUDE.md")]),
    ignoreFile: ".claudeignore",
    mcpFiles: (o) =>
      uniq([
        P(o, ".mcp.json"),
        P(o, ".claude", "settings.json"),
        H(o, ".claude.json"),
        H(o, ".claude", "settings.json"),
      ]),
    detectSignals: (o) => [
      P(o, "CLAUDE.md"),
      P(o, ".claude"),
      P(o, ".claudeignore"),
      P(o, ".mcp.json"),
      H(o, ".claude"),
    ],
  },
  {
    id: "amp",
    label: "Amp",
    memoryFiles: (o) => uniq([P(o, "AGENT.md"), H(o, ".config", "amp", "AGENT.md")]),
    mcpFiles: (o) => uniq([H(o, ".config", "amp", "settings.json")]),
    detectSignals: (o) => [P(o, "AGENT.md"), H(o, ".config", "amp")],
  },
  {
    id: "cline",
    label: "Cline",
    memoryFiles: (o) =>
      uniq([P(o, ".clinerules"), ...walkFiles(P(o, ".clinerules"), [".md"])]),
    ignoreFile: ".clineignore",
    mcpFiles: (o) => uniq([P(o, ".cline", "mcp.json")]),
    detectSignals: (o) => [P(o, ".clinerules"), P(o, ".clineignore")],
  },
  {
    id: "roo",
    label: "Roo Code",
    memoryFiles: (o) =>
      uniq([P(o, ".roorules"), ...walkFiles(P(o, ".roo", "rules"), [".md"])]),
    ignoreFile: ".rooignore",
    mcpFiles: (o) => uniq([P(o, ".roo", "mcp.json")]),
    detectSignals: (o) => [P(o, ".roorules"), P(o, ".roo"), P(o, ".rooignore")],
  },
  {
    id: "continue",
    label: "Continue",
    memoryFiles: (o) => walkFiles(P(o, ".continue", "rules"), [".md"]),
    mcpFiles: (o) => uniq([P(o, ".continue", "mcp.json")]),
    detectSignals: (o) => [P(o, ".continue")],
  },
  {
    id: "junie",
    label: "JetBrains Junie",
    memoryFiles: (o) => uniq([P(o, ".junie", "guidelines.md")]),
    mcpFiles: () => [],
    detectSignals: (o) => [P(o, ".junie")],
  },
  {
    id: "zed",
    label: "Zed",
    memoryFiles: (o) => uniq([P(o, ".rules")]),
    mcpFiles: () => [],
    detectSignals: (o) => [P(o, ".rules")],
  },
  {
    id: "aider",
    label: "Aider",
    memoryFiles: (o) => uniq([P(o, "CONVENTIONS.md")]),
    ignoreFile: ".aiderignore",
    mcpFiles: () => [],
    detectSignals: (o) => [P(o, "CONVENTIONS.md"), P(o, ".aider.conf.yml"), P(o, ".aiderignore")],
  },
  {
    id: "amazonq",
    label: "Amazon Q Developer",
    memoryFiles: (o) => walkFiles(P(o, ".amazonq", "rules"), [".md"]),
    mcpFiles: (o) => uniq([P(o, ".amazonq", "mcp.json"), H(o, ".aws", "amazonq", "mcp.json")]),
    detectSignals: (o) => [P(o, ".amazonq")],
  },
  {
    id: "codex",
    label: "Codex / AGENTS.md",
    // AGENTS.md is the cross-tool convention now, and it nests: the runtime
    // reads the one nearest the file being edited, so a repo can carry several.
    memoryFiles: (o) =>
      uniq([P(o, "AGENTS.md"), H(o, ".codex", "AGENTS.md"), ...walkFiles(o.path, ["AGENTS.md"])]),
    mcpFiles: () => [],
    detectSignals: (o) => [P(o, "AGENTS.md"), H(o, ".codex")],
  },
  {
    id: "cursor",
    label: "Cursor",
    memoryFiles: (o) =>
      uniq([
        P(o, ".cursorrules"),
        ...walkFiles(P(o, ".cursor", "rules"), [".mdc", ".md"]),
        ...walkFiles(H(o, ".cursor", "rules"), [".mdc", ".md"]),
      ]),
    ignoreFile: ".cursorignore",
    mcpFiles: (o) => uniq([P(o, ".cursor", "mcp.json"), H(o, ".cursor", "mcp.json")]),
    detectSignals: (o) => [P(o, ".cursorrules"), P(o, ".cursor"), P(o, ".cursorignore")],
  },
  {
    id: "gemini",
    label: "Gemini CLI",
    memoryFiles: (o) => uniq([P(o, "GEMINI.md"), H(o, ".gemini", "GEMINI.md")]),
    ignoreFile: ".geminiignore",
    mcpFiles: (o) => uniq([H(o, ".gemini", "settings.json"), P(o, ".gemini", "settings.json")]),
    detectSignals: (o) => [P(o, "GEMINI.md"), P(o, ".gemini"), H(o, ".gemini")],
  },
  {
    id: "windsurf",
    label: "Windsurf",
    memoryFiles: (o) =>
      uniq([
        P(o, ".windsurfrules"),
        ...walkFiles(P(o, ".windsurf", "rules"), [".md"]),
        ...walkFiles(H(o, ".codeium", "windsurf", "memories"), [".md"]),
      ]),
    ignoreFile: ".codeiumignore",
    mcpFiles: (o) => uniq([H(o, ".codeium", "windsurf", "mcp_config.json")]),
    detectSignals: (o) => [P(o, ".windsurfrules"), P(o, ".windsurf")],
  },
  {
    id: "copilot",
    label: "GitHub Copilot",
    memoryFiles: (o) =>
      uniq([
        P(o, ".github", "copilot-instructions.md"),
        ...walkFiles(P(o, ".github", "instructions"), [".instructions.md", ".md"]),
      ]),
    mcpFiles: (o) => uniq([P(o, ".vscode", "mcp.json"), P(o, ".github", "mcp.json")]),
    detectSignals: (o) => [
      P(o, ".github", "copilot-instructions.md"),
      P(o, ".github", "instructions"),
    ],
  },
];

/** Agents with at least one existing signal (project- or home-level). */
export function detectAgents(o: ResolvedOptions): AgentDef[] {
  return AGENTS.filter((a) => a.detectSignals(o).some((sig) => exists(sig) && (isFile(sig) || isDir(sig))));
}
