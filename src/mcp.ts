import path from "node:path";
import readline from "node:readline";

import { printableScan } from "./report.js";
import { scan } from "./scan.js";
import type { ResolvedOptions } from "./types.js";

/**
 * ctxdiet as an MCP server, so the agent can audit its own context.
 *
 * "Why is my context so big?" is a question people ask the agent, not a CLI.
 * Exposing the scan over MCP lets Claude Code answer it directly, with real
 * numbers, instead of guessing.
 *
 * Read-only by design. `fix` rewrites memory files, ignore files and MCP
 * config; that is a decision a person should make with a summary in front of
 * them, not something an agent does mid-conversation because it seemed
 * helpful. The server reports and plans, and the human runs `ctxdiet fix`.
 *
 * Implemented directly against the JSON-RPC wire format rather than pulling in
 * an SDK: the surface is an initialize handshake and two tools, and the whole
 * point of this package is not making people install things they don't need.
 */
const PROTOCOL_VERSION = "2025-06-18";
const SUPPORTED = new Set(["2025-06-18", "2025-03-26", "2024-11-05"]);

interface Request {
  jsonrpc: "2.0";
  id?: string | number | null;
  method?: string;
  params?: Record<string, unknown>;
}

const TOOLS = [
  {
    name: "ctxdiet_scan",
    title: "Audit persistent agent context",
    description:
      "Measure the context every session loads before the user types: memory files and " +
      "their @imports, ignore-file gaps letting heavy directories leak in, MCP tool " +
      "schemas, and agent/skill/command descriptions. Returns findings, a token " +
      "baseline, its share of the context window, and a grade. Read-only.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Directory to scan. Defaults to the working directory." },
        usage: {
          type: "boolean",
          description:
            "Read local session history to prove which MCP servers and skills are " +
            "actually used. Default true. Never leaves the machine.",
        },
      },
    },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  },
  {
    name: "ctxdiet_plan",
    title: "Preview what a fix would change",
    description:
      "Dry run: the changes `ctxdiet fix` would make, and the tokens each would " +
      "reclaim, without writing anything. Use to explain the work before a human " +
      "runs it. Writes are deliberately not exposed over MCP.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Directory to plan against." },
      },
    },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  },
];

function ok(id: Request["id"], result: unknown): string {
  return JSON.stringify({ jsonrpc: "2.0", id, result });
}

function fail(id: Request["id"], code: number, message: string): string {
  return JSON.stringify({ jsonrpc: "2.0", id, error: { code, message } });
}

/** MCP tool results carry human-readable text plus the machine-readable object. */
function toolResult(id: Request["id"], payload: unknown, summary: string): string {
  return ok(id, {
    content: [{ type: "text", text: summary }],
    structuredContent: payload as Record<string, unknown>,
  });
}

function optionsFor(base: ResolvedOptions, params: Record<string, unknown>): ResolvedOptions {
  const raw = params["path"];
  const usage = params["usage"];
  return {
    ...base,
    path: typeof raw === "string" && raw !== "" ? path.resolve(raw) : base.path,
    usage: typeof usage === "boolean" ? usage : base.usage,
    json: true,
  };
}

function handle(req: Request, base: ResolvedOptions): string | null {
  const { id, method } = req;
  const params = req.params ?? {};

  switch (method) {
    case "initialize": {
      const asked = params["protocolVersion"];
      const version = typeof asked === "string" && SUPPORTED.has(asked) ? asked : PROTOCOL_VERSION;
      return ok(id, {
        protocolVersion: version,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "ctxdiet", version: base.version },
        instructions:
          "Call ctxdiet_scan to measure what a session loads before the user types. " +
          "Report the grade, the baseline and its share of the context window, then the " +
          "findings worth acting on. Applying changes is not available here; tell the " +
          "user to run `npx ctxdiet fix`.",
      });
    }
    // Notifications carry no id and must never be answered.
    case "notifications/initialized":
    case "notifications/cancelled":
      return null;
    case "ping":
      return ok(id, {});
    case "tools/list":
      return ok(id, { tools: TOOLS });
    case "tools/call": {
      const name = params["name"];
      const args = (params["arguments"] as Record<string, unknown>) ?? {};
      if (name !== "ctxdiet_scan" && name !== "ctxdiet_plan") {
        return fail(id, -32602, `Unknown tool: ${String(name)}`);
      }
      try {
        const o = optionsFor(base, args);
        const result = scan(o);
        const report = printableScan(result, o);
        if (name === "ctxdiet_scan") {
          return toolResult(id, report, summarize(report));
        }
        const plan = result.findings
          .filter((f) => f.fixable && f.action)
          .map((f) => ({
            change: f.title,
            reclaims: f.tokensPerSession,
            needsConfirmation: !f.autoApply,
            evidence: f.evidence ?? null,
          }));
        return toolResult(
          id,
          { dryRun: true, changes: plan },
          plan.length === 0
            ? "Nothing to change. This setup is already lean."
            : `${plan.length} change(s) available. Run \`npx ctxdiet fix\` to apply.`
        );
      } catch (err) {
        return ok(id, {
          content: [{ type: "text", text: err instanceof Error ? err.message : String(err) }],
          isError: true,
        });
      }
    }
    default:
      // A notification we don't handle still gets no reply.
      return id === undefined || id === null
        ? null
        : fail(id, -32601, `Method not found: ${String(method)}`);
  }
}

function summarize(report: Record<string, unknown>): string {
  const grade = String(report["grade"]);
  const baseline = Number(report["baselineTokens"] ?? 0).toLocaleString("en-US");
  const share = report["baselineShareOfWindow"];
  const savings = Number(report["headlineSavingsTokens"] ?? 0).toLocaleString("en-US");
  return (
    `Grade ${grade}. ${baseline} tokens of persistent context (${String(share)}% of the window). ` +
    `${savings} tokens/session are reclaimable.`
  );
}

/**
 * Serve on stdio until stdin closes. Nothing but JSON-RPC may reach stdout,
 * because a stray log line breaks the transport, so diagnostics go to stderr.
 */
export async function runMcpServer(base: ResolvedOptions): Promise<void> {
  const rl = readline.createInterface({ input: process.stdin, terminal: false });
  process.stderr.write(`ctxdiet MCP server ready (protocol ${PROTOCOL_VERSION})\n`);

  for await (const line of rl) {
    const text = line.trim();
    if (text === "") continue;

    let req: Request;
    try {
      req = JSON.parse(text) as Request;
    } catch {
      process.stdout.write(fail(null, -32700, "Parse error") + "\n");
      continue;
    }

    let response: string | null;
    try {
      response = handle(req, base);
    } catch (err) {
      response = fail(req.id ?? null, -32603, err instanceof Error ? err.message : String(err));
    }
    if (response !== null) process.stdout.write(response + "\n");
  }
}
