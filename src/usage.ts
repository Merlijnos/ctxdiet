import fs from "node:fs";
import path from "node:path";

import {
  USAGE_MAX_BYTES,
  USAGE_MAX_FILES,
  USAGE_MIN_DAYS,
  USAGE_MIN_SESSIONS,
  USAGE_WINDOW_DAYS,
} from "./constants.js";

/**
 * Evidence of what a setup actually uses, read from local session transcripts.
 *
 * Every other finding ctxdiet reports is provable from config alone. MCP
 * servers, skills and subagents are not: their cost is visible, their value is
 * not, so they could only ever be listed as "usage not confirmed — disable only
 * if you know you don't use it". That puts the work back on the user, which is
 * the opposite of the point.
 *
 * Claude Code already writes the answer to disk. `~/.claude/projects/**\/*.jsonl`
 * records every tool call, and MCP tools are namespaced `mcp__<server>__<tool>`,
 * skills arrive as a `Skill` call naming the skill, and subagents as a `Task`
 * call naming the type. Reading it turns "we can't tell" into "0 calls in 47
 * sessions over 62 days".
 *
 * Local files only. No network, nothing uploaded, and `--no-usage` turns the
 * whole thing off. Only tool *names* are extracted — never prompts, arguments
 * or file contents.
 */
export interface UsageStats {
  /** Invocation count per tool name, e.g. "mcp__github__create_pr" -> 12. */
  tools: Map<string, number>;
  /** MCP server name -> total calls across all of its tools. */
  servers: Map<string, number>;
  /** Skill name -> invocations. */
  skills: Map<string, number>;
  /** Subagent type -> invocations. */
  subagents: Map<string, number>;
  /** Distinct transcripts read. */
  sessions: number;
  /** Days between the oldest and newest activity seen. */
  days: number;
  /** True when enough history exists to argue from an absence of calls. */
  conclusive: boolean;
  /** Set when history could not be read at all. */
  unavailable?: string;
}

export function emptyUsage(reason?: string): UsageStats {
  return {
    tools: new Map(),
    servers: new Map(),
    skills: new Map(),
    subagents: new Map(),
    sessions: 0,
    days: 0,
    conclusive: false,
    ...(reason === undefined ? {} : { unavailable: reason }),
  };
}

/**
 * A transcript contains every tool *definition* too — the system prompt lists
 * every MCP tool available. Scanning for names anywhere in the file therefore
 * reports every configured server as "used", which is exactly backwards. Only
 * a `tool_use` block counts, so lines that could hold one are parsed properly
 * and everything else is skipped without paying for JSON.parse.
 */
const TOOL_USE_HINT = '"tool_use"';

interface ToolUse {
  name: string;
  input: Record<string, unknown>;
}

function toolUsesIn(line: string): ToolUse[] {
  if (!line.includes(TOOL_USE_HINT)) return [];
  let record: unknown;
  try {
    record = JSON.parse(line);
  } catch {
    return [];
  }
  const message = (record as { message?: { content?: unknown } })?.message;
  const content = message?.content;
  if (!Array.isArray(content)) return [];

  const out: ToolUse[] = [];
  for (const block of content) {
    if (typeof block !== "object" || block === null) continue;
    const b = block as { type?: unknown; name?: unknown; input?: unknown };
    if (b.type !== "tool_use" || typeof b.name !== "string") continue;
    out.push({
      name: b.name,
      input: (typeof b.input === "object" && b.input !== null
        ? (b.input as Record<string, unknown>)
        : {}),
    });
  }
  return out;
}

/** `mcp__<server>__<tool>` -> server name. */
function mcpServerOf(toolName: string): string | null {
  const m = /^mcp__(.+?)__/.exec(toolName);
  return m?.[1] ?? null;
}

const DAY = /^(\d{4}-\d{2}-\d{2})T/;

const bump = (m: Map<string, number>, k: string, n = 1) => m.set(k, (m.get(k) ?? 0) + n);

/** Cheap timestamp read; avoids parsing lines that hold no tool call. */
function extractTimestamp(line: string): string | null {
  const m = /"timestamp"\s*:\s*"([^"]+)"/.exec(line);
  return m?.[1] ?? null;
}

interface Transcript {
  file: string;
  mtimeMs: number;
  size: number;
}

/** Session transcripts, newest first. */
function transcripts(home: string): Transcript[] {
  const root = path.join(home, ".claude", "projects");
  const out: Transcript[] = [];
  const stack = [root];
  while (stack.length > 0 && out.length < USAGE_MAX_FILES * 4) {
    const cur = stack.pop();
    if (cur === undefined) break;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(cur, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      const full = path.join(cur, e.name);
      if (e.isDirectory()) {
        stack.push(full);
      } else if (e.isFile() && e.name.endsWith(".jsonl")) {
        try {
          const st = fs.statSync(full);
          out.push({ file: full, mtimeMs: st.mtimeMs, size: st.size });
        } catch {
          /* unreadable transcript */
        }
      }
    }
  }
  return out.sort((a, b) => b.mtimeMs - a.mtimeMs);
}

/**
 * Read recent transcripts and tally what was invoked.
 *
 * Bounded on every axis — file count, total bytes and age — so a scan stays
 * fast on a machine with years of history. Newest transcripts are read first,
 * so hitting a cap costs the oldest evidence, which matters least.
 */
export function readUsage(home: string, now: number = Date.now()): UsageStats {
  const files = transcripts(home);
  if (files.length === 0) return emptyUsage("no session history found");

  const stats = emptyUsage();
  const cutoff = now - USAGE_WINDOW_DAYS * 86_400_000;
  const dates = new Set<string>();
  let bytes = 0;

  for (const t of files) {
    if (stats.sessions >= USAGE_MAX_FILES || bytes >= USAGE_MAX_BYTES) break;
    if (t.mtimeMs < cutoff) continue;

    let text: string;
    try {
      text = fs.readFileSync(t.file, "utf8");
    } catch {
      continue;
    }
    bytes += text.length;
    stats.sessions++;

    for (const line of text.split("\n")) {
      if (line === "") continue;

      const day = DAY.exec(extractTimestamp(line) ?? "");
      if (day?.[1] !== undefined) dates.add(day[1]);

      for (const use of toolUsesIn(line)) {
        bump(stats.tools, use.name);

        const server = mcpServerOf(use.name);
        if (server !== null) bump(stats.servers, server);

        if (use.name === "Skill" && typeof use.input["skill"] === "string") {
          bump(stats.skills, use.input["skill"]);
        }
        const subagent = use.input["subagent_type"];
        if (typeof subagent === "string") bump(stats.subagents, subagent);
      }
    }
  }

  if (dates.size > 0) {
    const sorted = [...dates].sort();
    const first = Date.parse(`${sorted[0]}T00:00:00Z`);
    const last = Date.parse(`${sorted[sorted.length - 1]}T00:00:00Z`);
    stats.days = Math.max(1, Math.round((last - first) / 86_400_000) + 1);
  }

  // An absence of calls only means something once there is enough history for
  // the absence to be surprising. A skill installed yesterday is not unused.
  stats.conclusive = stats.sessions >= USAGE_MIN_SESSIONS && stats.days >= USAGE_MIN_DAYS;
  return stats;
}

/** How the observation window should be described in a finding. */
export function windowLabel(u: UsageStats): string {
  const s = `${u.sessions} session${u.sessions === 1 ? "" : "s"}`;
  const d = `${u.days} day${u.days === 1 ? "" : "s"}`;
  return `${s} over ${d}`;
}

export type Verdict =
  | { kind: "used"; calls: number }
  | { kind: "unused" }
  | { kind: "unknown" };

/** Whether `name` shows up in `counts`, given the evidence is strong enough. */
export function verdictFor(u: UsageStats, counts: Map<string, number>, name: string): Verdict {
  const calls = counts.get(name) ?? 0;
  if (calls > 0) return { kind: "used", calls };
  if (!u.conclusive) return { kind: "unknown" };
  return { kind: "unused" };
}
