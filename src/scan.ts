import path from "node:path";

import { detectAgents, type AgentDef } from "./agents.js";
import { grade, LARGE_CLAUDEMD_TOKENS, MCP_SERVER_TOKEN_EST } from "./constants.js";
import { covers, parseIgnoreRules } from "./ignore.js";
import { resolveImports } from "./imports.js";
import { emptyUsage, readUsage, verdictFor, windowLabel, type UsageStats } from "./usage.js";
import { findOverlaps } from "./overlap.js";
import * as src from "./sources.js";
import { estimateTokens } from "./tokens.js";
import { trimMarkdown } from "./trim.js";
import type { Finding, Overlap, ResolvedOptions, ScanResult } from "./types.js";

interface HeavyPath {
  name: string;
  tokens: number;
  isDir: boolean;
}

/** Heavy dirs/files present in the project, sized once and reused per agent. */
function presentHeavyPaths(o: ResolvedOptions): HeavyPath[] {
  const out: HeavyPath[] = [];
  for (const name of [...src.HEAVY_DIRS, ...src.HEAVY_FILES]) {
    const full = path.join(o.path, name);
    const dir = src.isDir(full);
    if (!dir && !src.isFile(full)) continue;
    out.push({ name, tokens: src.estimatePathTokens(full), isDir: dir });
  }
  return out;
}

/**
 * Pure scan: detects active agents, reads their persistent context, returns
 * findings + metrics. No printing, no writes, so it is safe to call before/after a fix.
 */
export function scan(o: ResolvedOptions): ScanResult {
  const findings: Finding[] = [];
  const overlaps: Overlap[] = [];
  let baselineTokens = 0;

  const agents = detectAgents(o);
  const heavy = presentHeavyPaths(o);
  const usage = o.usage ? readUsage(o.home) : emptyUsage("disabled with --no-usage");

  for (const agent of agents) {
    baselineTokens += scanAgent(agent, o, heavy, findings, overlaps, usage);
  }

  const headlineSavings = findings
    .filter((f) => f.confidence === "high")
    .reduce((s, f) => s + f.tokensPerSession, 0);
  const lowConfidencePotential = findings
    .filter((f) => f.confidence === "low")
    .reduce((s, f) => s + f.tokensPerSession, 0);

  return {
    options: o,
    usage: {
      consulted: o.usage && usage.unavailable === undefined,
      sessions: usage.sessions,
      days: usage.days,
      conclusive: usage.conclusive,
      ...(usage.unavailable === undefined ? {} : { note: usage.unavailable }),
    },
    detectedAgents: agents.map((a) => ({ id: a.id, label: a.label })),
    findings,
    overlaps,
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
  findings: Finding[],
  overlaps: Overlap[],
  usage: UsageStats
): number {
  let baseline = 0;

  // --- Memory / instruction files (HIGH-confidence, auto-trimmable) ---
  // A memory file may pull in others with @imports; the whole tree is loaded
  // every session, so the whole tree is scanned and trimmed.
  const seen = new Set<string>();
  const queue = agent.memoryFiles(o).map((file) => ({ file, imported: false }));

  for (let i = 0; i < queue.length; i++) {
    const entry = queue[i];
    if (entry === undefined) continue;
    const { file, imported } = entry;
    if (seen.has(file) || !src.isFile(file)) continue;
    seen.add(file);

    for (const dep of resolveImports(file, src.readFileSafe, o.home)) {
      if (!seen.has(dep.path)) queue.push({ file: dep.path, imported: true });
    }

    const original = src.readFileSafe(file);
    const origTokens = estimateTokens(original);
    baseline += origTokens;

    const trimmed = trimMarkdown(original);
    const saved = origTokens - estimateTokens(trimmed);
    const label = src.displayPath(file, o.path, o.home);
    const via = imported ? " (imported)" : "";

    if (saved > 0) {
      findings.push({
        agent: agent.label,
        category: "Memory",
        title: `${label}${via}: ${saved.toLocaleString()} redundant tokens`,
        path: file,
        detail: "duplicate lines, blank runs, trailing whitespace",
        tokensPerSession: saved,
        confidence: "high",
        fixable: true,
        autoApply: true,
        action: { type: "trim", path: file },
      });
    } else if (origTokens > LARGE_CLAUDEMD_TOKENS) {
      findings.push({
        agent: agent.label,
        category: "Memory",
        title: `${label}${via}: large (${origTokens.toLocaleString()} tokens)`,
        path: file,
        detail: "no auto-trimmable redundancy; shorten manually",
        tokensPerSession: 0,
        confidence: "high",
        fixable: false,
        autoApply: false,
        manualReview: true,
      });
    }

    // Reworded-duplicate rules, resolved interactively in `fix`.
    for (const pair of findOverlaps(original)) {
      overlaps.push({ agent: agent.label, path: file, a: pair.a, b: pair.b });
    }
  }

  // --- Ignore file (HIGH-confidence, auto-fixable) ---
  if (agent.ignoreFile && heavy.length > 0) {
    const ignorePath = path.join(o.path, agent.ignoreFile);
    const content = src.isFile(ignorePath) ? src.readFileSafe(ignorePath) : null;
    const rules = parseIgnoreRules(content ?? "");
    const uncovered = heavy.filter((h) => !covers(rules, h.name, h.isDir));
    const heavyTokens = uncovered.reduce((s, h) => s + h.tokens, 0);

    if (uncovered.length > 0) {
      baseline += heavyTokens;
      const names = uncovered.map((h) => h.name);
      // Whatever we add has to actually cover what was found, or the same
      // finding comes back on the next run. Start from the uncovered paths,
      // then top up with any defaults the file is still missing.
      const added = src.uniq([
        ...uncovered.map((h) => (h.isDir ? `${h.name}/` : h.name)),
        ...src.missingDefaultPatterns(content ?? ""),
      ]);
      findings.push({
        agent: agent.label,
        category: "Ignore",
        title: content === null
          ? `${agent.ignoreFile} missing, ${uncovered.length} heavy path(s) unignored`
          : `${agent.ignoreFile} weak, ${uncovered.length} heavy path(s) unignored`,
        path: ignorePath,
        detail: names.join(", "),
        tokensPerSession: heavyTokens,
        confidence: "high",
        fixable: true,
        autoApply: true,
        action:
          content === null
            ? {
                type: "ignore-create",
                path: ignorePath,
                content: src.DEFAULT_IGNORE_PATTERNS.join("\n") + "\n",
              }
            : { type: "ignore-augment", path: ignorePath, added },
      });
    }
  }

  // --- MCP servers: priced from config, judged from session history ---
  for (const file of agent.mcpFiles(o)) {
    for (const server of src.readMcpServers(file)) {
      baseline += MCP_SERVER_TOKEN_EST;
      const verdict = verdictFor(usage, usage.servers, server);
      const where = src.displayPath(file, o.path, o.home);

      // In active use: it costs tokens, but that cost is buying something.
      // Reporting it as waste would train people to ignore the report.
      if (verdict.kind === "used") continue;

      const proven = verdict.kind === "unused";
      findings.push({
        agent: agent.label,
        category: "MCP",
        title: `${server} (${where})`,
        path: file,
        detail: proven
          ? `no calls to any ${server} tool; disable to reclaim its tool schemas`
          : "usage not confirmed; disable only if you know you don't use it",
        ...(proven ? { evidence: `0 calls in ${windowLabel(usage)}` } : {}),
        tokensPerSession: MCP_SERVER_TOKEN_EST,
        confidence: proven ? "high" : "low",
        fixable: true,
        // Rare use is not no use. Evidence promotes it into the headline, but
        // acting on it still takes --include-unused.
        autoApply: false,
        manualReview: !proven,
        action: { type: "mcp-disable", path: file, server },
      });
    }
  }

  // --- Definition inventory (Claude-style ~/.claude only) ---
  if (agent.ownsDefinitions) {
    const inv = src.scanDefinitions(o);

    // Unloadable artifacts cost no context, because the runtime never reads them.
    // They are still worth archiving, but as clutter, not as a saving. Rolling
    // them into one finding keeps a directory of stale files from burying the
    // findings that actually cost tokens.
    if (inv.dead.length > 0) {
      findings.push({
        agent: agent.label,
        category: "Definitions",
        title: `${inv.dead.length} unloadable file(s) in ~/.claude`,
        detail: src.summarizeReasons(inv.dead) + ". Clutter only, no context cost.",
        tokensPerSession: 0,
        confidence: "high",
        fixable: true,
        autoApply: true,
        action: { type: "archive-many", paths: inv.dead.map((d) => d.path), home: o.home },
      });
    }

    for (const definition of inv.real) {
      baseline += definition.tokens;
      const isSkill = definition.reason === "skill";
      const counts = isSkill ? usage.skills : usage.subagents;
      const verdict = verdictFor(usage, counts, definition.name);
      if (verdict.kind === "used") continue;

      const proven = verdict.kind === "unused";
      const cost =
        `${definition.tokens.toLocaleString()} tok of description loaded every session ` +
        `(+${definition.onDemandTokens.toLocaleString()} only when invoked)`;

      findings.push({
        agent: agent.label,
        category: "Definitions",
        title: src.displayPath(definition.path, o.path, o.home),
        path: definition.path,
        detail: proven
          ? `${cost}, never invoked`
          : `${cost}; remove only if you recognize it as unused`,
        ...(proven ? { evidence: `0 uses in ${windowLabel(usage)}` } : {}),
        tokensPerSession: definition.tokens,
        confidence: proven ? "high" : "low",
        fixable: true,
        autoApply: false,
        manualReview: !proven,
        action: {
          type: "archive",
          path: definition.path,
          archiveTo: src.archivePathFor(definition.path, o.home),
        },
      });
    }
  }

  return baseline;
}
