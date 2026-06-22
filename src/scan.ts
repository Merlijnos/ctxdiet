import path from "node:path";

import { AgentDef, detectAgents } from "./agents";
import { grade, LARGE_CLAUDEMD_TOKENS, MCP_SERVER_TOKEN_EST } from "./constants";
import * as src from "./sources";
import { estimateTokens } from "./tokens";
import { trimMarkdown } from "./trim";
import { Finding, ResolvedOptions, ScanResult } from "./types";

interface HeavyPath {
  name: string;
  tokens: number;
}

/** Heavy dirs/files present in the project, sized once and reused per agent. */
function presentHeavyPaths(o: ResolvedOptions): HeavyPath[] {
  const out: HeavyPath[] = [];
  for (const name of [...src.HEAVY_DIRS, ...src.HEAVY_FILES]) {
    const full = path.join(o.path, name);
    if (!src.isFile(full) && !src.isDir(full)) continue;
    out.push({ name, tokens: src.estimatePathTokens(full) });
  }
  return out;
}

/**
 * Pure scan: detects active agents, reads their persistent context, returns
 * findings + metrics. No printing, no writes — safe to call before/after a fix.
 */
export function scan(o: ResolvedOptions): ScanResult {
  const findings: Finding[] = [];
  let baselineTokens = 0;

  const agents = detectAgents(o);
  const heavy = presentHeavyPaths(o);

  for (const agent of agents) {
    baselineTokens += scanAgent(agent, o, heavy, findings);
  }

  const headlineSavings = findings
    .filter((f) => f.confidence === "high")
    .reduce((s, f) => s + f.tokensPerSession, 0);
  const lowConfidencePotential = findings
    .filter((f) => f.confidence === "low")
    .reduce((s, f) => s + f.tokensPerSession, 0);

  return {
    options: o,
    detectedAgents: agents.map((a) => ({ id: a.id, label: a.label })),
    findings,
    baselineTokens,
    headlineSavings,
    lowConfidencePotential,
    grade: grade(headlineSavings),
  };
}

/** Scan a single agent; returns its baseline-token contribution. */
function scanAgent(
  agent: AgentDef,
  o: ResolvedOptions,
  heavy: HeavyPath[],
  findings: Finding[]
): number {
  let baseline = 0;

  // --- Memory / instruction files (HIGH-confidence, auto-trimmable) ---
  for (const file of agent.memoryFiles(o)) {
    if (!src.isFile(file)) continue;
    const original = src.readFileSafe(file);
    const origTokens = estimateTokens(original);
    baseline += origTokens;

    const trimmed = trimMarkdown(original);
    const saved = origTokens - estimateTokens(trimmed);
    const label = src.displayPath(file, o.path, o.home);

    if (saved > 0) {
      findings.push({
        agent: agent.label,
        category: "Memory",
        title: `${label}: ${saved.toLocaleString()} redundant tokens`,
        detail: "duplicate lines, blank runs, trailing whitespace",
        tokensPerSession: saved,
        confidence: "high",
        fixable: true,
        action: { type: "trim", path: file },
      });
    } else if (origTokens > LARGE_CLAUDEMD_TOKENS) {
      findings.push({
        agent: agent.label,
        category: "Memory",
        title: `${label}: large (${origTokens.toLocaleString()} tokens)`,
        detail: "no auto-trimmable redundancy — shorten manually",
        tokensPerSession: 0,
        confidence: "high",
        fixable: false,
        manualReview: true,
      });
    }
  }

  // --- Ignore file (HIGH-confidence, auto-fixable) ---
  if (agent.ignoreFile && heavy.length > 0) {
    const ignorePath = path.join(o.path, agent.ignoreFile);
    const ignoreExists = src.isFile(ignorePath);
    const content = ignoreExists ? src.readFileSafe(ignorePath) : null;
    const patterns = content ? src.parseIgnore(content) : [];
    const uncovered = heavy.filter((h) => !src.ignoreCovers(patterns, h.name));
    const heavyTokens = uncovered.reduce((s, h) => s + h.tokens, 0);

    if (uncovered.length > 0) {
      baseline += heavyTokens;
      const names = uncovered.map((h) => h.name);
      const missingDefaults = src.DEFAULT_IGNORE_PATTERNS.filter(
        (p) => !patterns.includes(p)
      );
      findings.push({
        agent: agent.label,
        category: "Ignore",
        title: content === null
          ? `${agent.ignoreFile} missing — ${uncovered.length} heavy path(s) unignored`
          : `${agent.ignoreFile} weak — ${uncovered.length} heavy path(s) unignored`,
        detail: names.join(", "),
        tokensPerSession: heavyTokens,
        confidence: "high",
        fixable: true,
        action:
          content === null
            ? {
                type: "ignore-create",
                path: ignorePath,
                content: src.DEFAULT_IGNORE_PATTERNS.join("\n") + "\n",
              }
            : { type: "ignore-augment", path: ignorePath, added: missingDefaults },
      });
    }
  }

  // --- MCP servers (LOW-confidence, review only) ---
  for (const file of agent.mcpFiles(o)) {
    for (const server of src.readMcpServers(file)) {
      baseline += MCP_SERVER_TOKEN_EST;
      findings.push({
        agent: agent.label,
        category: "MCP",
        title: `${server} (${src.displayPath(file, o.path, o.home)})`,
        detail: "usage not confirmed — disable only if you know you don't use it",
        tokensPerSession: MCP_SERVER_TOKEN_EST,
        confidence: "low",
        fixable: true,
        manualReview: true,
        action: { type: "mcp-disable", path: file, server },
      });
    }
  }

  // --- Definition inventory (Claude-style ~/.claude only) ---
  if (agent.ownsDefinitions) {
    const inv = src.scanDefinitions(o);
    for (const dead of inv.dead) {
      baseline += dead.tokens;
      findings.push({
        agent: agent.label,
        category: "Definitions",
        title: `${src.displayPath(dead.path, o.path, o.home)} — ${dead.reason}`,
        tokensPerSession: dead.tokens,
        confidence: "high",
        fixable: true,
        action: {
          type: "archive",
          path: dead.path,
          archiveTo: src.archivePathFor(dead.path, o.home),
        },
      });
    }
    for (const real of inv.real) {
      baseline += real.tokens;
      findings.push({
        agent: agent.label,
        category: "Definitions",
        title: src.displayPath(real.path, o.path, o.home),
        detail: "usage not confirmed — remove only if you recognize it as unused",
        tokensPerSession: real.tokens,
        confidence: "low",
        fixable: true,
        manualReview: true,
        action: {
          type: "archive",
          path: real.path,
          archiveTo: src.archivePathFor(real.path, o.home),
        },
      });
    }
  }

  return baseline;
}
