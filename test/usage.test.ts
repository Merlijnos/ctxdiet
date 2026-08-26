import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { emptyUsage, readUsage, verdictFor, windowLabel } from "../src/usage.js";
import { tmpdir } from "./helpers.js";

/** Write `days` days of transcript, each with the given tool_use blocks. */
function history(
  home: string,
  days: number,
  blocks: Array<{ name: string; input?: Record<string, unknown> }>
): void {
  const dir = path.join(home, ".claude", "projects", "-repo");
  fs.mkdirSync(dir, { recursive: true });
  for (let i = 0; i < days; i++) {
    const day = `2026-08-${String(10 + i).padStart(2, "0")}`;
    const lines = blocks.map((b) =>
      JSON.stringify({
        type: "assistant",
        timestamp: `${day}T10:00:00.000Z`,
        message: { content: [{ type: "tool_use", name: b.name, input: b.input ?? {} }] },
      })
    );
    fs.writeFileSync(path.join(dir, `s${i}.jsonl`), lines.join("\n") + "\n");
  }
}

test("no history at all is reported as unavailable, not as 'unused'", () => {
  const u = readUsage(tmpdir());
  assert.equal(u.sessions, 0);
  assert.equal(u.conclusive, false);
  assert.ok(u.unavailable);
  assert.equal(verdictFor(u, u.servers, "github").kind, "unknown");
});

test("counts MCP calls per server and per tool", () => {
  const home = tmpdir();
  history(home, 8, [
    { name: "mcp__github__create_pr" },
    { name: "mcp__github__list_issues" },
    { name: "Bash" },
  ]);
  const u = readUsage(home);
  assert.equal(u.servers.get("github"), 16);
  assert.equal(u.tools.get("mcp__github__create_pr"), 8);
  assert.equal(u.sessions, 8);
});

test("a tool named in the system prompt but never called is not 'used'", () => {
  // Transcripts embed every tool definition. Scanning for the name anywhere in
  // the file reported every configured server as used: the exact inversion
  // this feature exists to avoid.
  const home = tmpdir();
  const dir = path.join(home, ".claude", "projects", "-repo");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, "s.jsonl"),
    JSON.stringify({
      type: "system",
      timestamp: "2026-08-10T10:00:00.000Z",
      message: {
        content: [
          { type: "text", text: 'available: "mcp__Gmail__send_message", "mcp__Notion__search"' },
        ],
      },
    }) + "\n"
  );
  const u = readUsage(home);
  assert.equal(u.servers.get("Gmail"), undefined);
  assert.equal(u.servers.get("Notion"), undefined);
});

test("records skill and subagent invocations", () => {
  const home = tmpdir();
  history(home, 8, [
    { name: "Skill", input: { skill: "docx" } },
    { name: "Task", input: { subagent_type: "Explore" } },
  ]);
  const u = readUsage(home);
  assert.equal(u.skills.get("docx"), 8);
  assert.equal(u.subagents.get("Explore"), 8);
});

test("thin history can never conclude that something is unused", () => {
  const home = tmpdir();
  history(home, 2, [{ name: "Bash" }]); // below the session and day floors
  const u = readUsage(home);
  assert.equal(u.conclusive, false);
  assert.equal(verdictFor(u, u.servers, "Gmail").kind, "unknown");
});

test("enough history turns an absence of calls into a verdict", () => {
  const home = tmpdir();
  history(home, 8, [{ name: "mcp__github__create_pr" }]);
  const u = readUsage(home);
  assert.equal(u.conclusive, true);
  assert.deepEqual(verdictFor(u, u.servers, "github"), { kind: "used", calls: 8 });
  assert.deepEqual(verdictFor(u, u.servers, "Gmail"), { kind: "unused" });
});

test("transcripts older than the window are ignored", () => {
  const home = tmpdir();
  history(home, 8, [{ name: "Bash" }]);
  const dir = path.join(home, ".claude", "projects", "-repo");
  const old = new Date(Date.now() - 400 * 86_400_000);
  for (const f of fs.readdirSync(dir)) fs.utimesSync(path.join(dir, f), old, old);
  assert.equal(readUsage(home).sessions, 0);
});

test("malformed transcript lines are skipped, not fatal", () => {
  const home = tmpdir();
  history(home, 8, [{ name: "mcp__github__create_pr" }]);
  const dir = path.join(home, ".claude", "projects", "-repo");
  fs.appendFileSync(path.join(dir, "s0.jsonl"), "{ not json\n\n");
  const u = readUsage(home);
  assert.equal(u.servers.get("github"), 8);
});

test("window label and empty helper read correctly", () => {
  const home = tmpdir();
  history(home, 8, [{ name: "Bash" }]);
  assert.equal(windowLabel(readUsage(home)), "8 sessions over 8 days");
  assert.equal(windowLabel({ ...emptyUsage(), sessions: 1, days: 1 }), "1 session over 1 day");
});
