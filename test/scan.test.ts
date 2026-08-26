import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { scan } from "../src/scan.js";
import { options, tmpdir, write } from "./helpers.js";

test("a directory with no agent setup produces nothing", () => {
  const r = scan(options());
  assert.deepEqual(r.detectedAgents, []);
  assert.equal(r.findings.length, 0);
  assert.equal(r.headlineSavings, 0);
  assert.equal(r.grade, "A");
});

test("only the agents actually present are detected", () => {
  const p = tmpdir();
  write(p, "CLAUDE.md", "# rules\n");
  write(p, ".junie/guidelines.md", "Use tabs.\n");
  const ids = scan(options({ path: p })).detectedAgents.map((a) => a.id).sort();
  assert.deepEqual(ids, ["claude", "junie"]);
});

test("a globbed ignore file is not reported as weak", () => {
  const p = tmpdir();
  write(p, "CLAUDE.md", "# rules\n");
  write(p, "node_modules/pkg/index.js", "x".repeat(50_000));
  write(p, ".claudeignore", "**/node_modules/**\n");
  const ignore = scan(options({ path: p })).findings.filter((f) => f.category === "Ignore");
  assert.deepEqual(ignore, []);
});

test("a missing ignore file is reported with the heavy paths that leak", () => {
  const p = tmpdir();
  write(p, "CLAUDE.md", "# rules\n");
  write(p, "node_modules/pkg/index.js", "x".repeat(50_000));
  const f = scan(options({ path: p })).findings.find((x) => x.category === "Ignore");
  assert.ok(f, "ignore finding present");
  assert.match(f.detail ?? "", /node_modules/);
  assert.equal(f.confidence, "high");
  assert.ok(f.tokensPerSession > 0);
});

test("imported memory files count toward the baseline", () => {
  const p = tmpdir();
  write(p, "CLAUDE.md", "# rules\n\n@docs/style.md\n");
  const big = "Prefer explicit names over abbreviations in all code. ".repeat(40);
  write(p, "docs/style.md", `# Style\n\n${big}\n`);

  const withImport = scan(options({ path: p })).baselineTokens;
  fs.writeFileSync(path.join(p, "CLAUDE.md"), "# rules\n");
  const without = scan(options({ path: p })).baselineTokens;
  assert.ok(withImport > without + 200, `${withImport} should far exceed ${without}`);
});

test("a nested skills tree is not mistaken for a dead folder", () => {
  const home = tmpdir();
  write(home, ".claude/skills/synced/docx/SKILL.md", "---\nname: docx\ndescription: Word files.\n---\n\nbody\n");
  write(home, ".claude/skills/top/SKILL.md", "---\nname: top\ndescription: A skill.\n---\n\nbody\n");

  const r = scan(options({ home }));
  const dead = r.findings.filter((f) => f.title.includes("unloadable"));
  assert.deepEqual(dead, [], "no unloadable finding for a populated tree");
  const skills = r.findings.filter((f) => f.category === "Definitions");
  assert.equal(skills.length, 2);
});

test("unloadable clutter is grouped and costs zero tokens", () => {
  const home = tmpdir();
  write(home, ".claude/skills/broken/notes.txt", "no SKILL.md here\n");
  write(home, ".claude/agents/old.md.bak", "stale copy\n");
  write(home, ".claude/commands/empty.md", "   \n");

  const f = scan(options({ home })).findings.find((x) => x.title.includes("unloadable"));
  assert.ok(f, "grouped hygiene finding present");
  assert.equal(f.tokensPerSession, 0, "unloadable files cost no context");
  assert.equal(f.action?.type, "archive-many");
});

test("a live definition is priced by its front matter, not its body", () => {
  const home = tmpdir();
  const body = "Detailed instructions that are only read on invocation. ".repeat(80);
  write(home, ".claude/agents/rev.md", `---\nname: rev\ndescription: Reviews code.\n---\n\n${body}\n`);

  const f = scan(options({ home })).findings.find((x) => x.category === "Definitions");
  assert.ok(f);
  assert.equal(f.confidence, "low", "usage is unconfirmed");
  assert.ok(f.tokensPerSession < 40, `front matter only, got ${f.tokensPerSession}`);
});

test("project-scope definitions are scanned, not just the home directory", () => {
  const p = tmpdir();
  write(p, "CLAUDE.md", "# rules\n");
  write(p, ".claude/agents/local.md", "---\nname: local\ndescription: A project agent.\n---\n\nbody\n");
  const f = scan(options({ path: p })).findings.find((x) => x.category === "Definitions");
  assert.ok(f, "project agent found");
  assert.match(f.path ?? "", /\.claude[/\\]agents[/\\]local\.md$/);
});

test("MCP servers are review-only, never high confidence", () => {
  const p = tmpdir();
  write(p, "CLAUDE.md", "# rules\n");
  write(p, ".mcp.json", JSON.stringify({ mcpServers: { github: {}, linear: {} } }));
  const mcp = scan(options({ path: p })).findings.filter((f) => f.category === "MCP");
  assert.equal(mcp.length, 2);
  assert.ok(mcp.every((f) => f.confidence === "low" && f.manualReview));
});

test("malformed JSON config is skipped rather than guessed at", () => {
  const p = tmpdir();
  write(p, "CLAUDE.md", "# rules\n");
  write(p, ".mcp.json", "{ not json");
  assert.deepEqual(scan(options({ path: p })).findings.filter((f) => f.category === "MCP"), []);
});

test("reworded duplicate rules are flagged but never auto-fixed", () => {
  const p = tmpdir();
  write(
    p,
    "CLAUDE.md",
    "# Rules\n\n" +
      "- Always run the linter before you commit any change to the repo.\n" +
      "- Always run the linter before committing any change to this repo.\n"
  );
  const r = scan(options({ path: p }));
  assert.equal(r.overlaps.length, 1);
  assert.equal(r.findings.filter((f) => f.action?.type === "trim").length, 0);
});

test("a walk does not descend into heavy directories", () => {
  const p = tmpdir();
  write(p, "AGENTS.md", "# root\n");
  write(p, "node_modules/dep/AGENTS.md", "a dependency's instructions\n");
  const r = scan(options({ path: p }));
  assert.ok(!r.findings.some((f) => (f.path ?? "").includes("node_modules")));
});
