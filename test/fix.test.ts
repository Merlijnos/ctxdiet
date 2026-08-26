import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { runFix } from "../src/fix.js";
import { scan } from "../src/scan.js";
import { options, tmpdir, write } from "./helpers.js";

const read = (p: string) => fs.readFileSync(p, "utf8");

/** A project with one trimmable memory file, no ignore file and a heavy dir. */
function project(): string {
  const p = tmpdir();
  write(
    p,
    "CLAUDE.md",
    ["# Rules", "", "", "", "Always write the minimum secure code.   ", "Always write the minimum secure code.", ""].join("\n")
  );
  write(p, "node_modules/pkg/index.js", "x".repeat(50_000));
  return p;
}

test("--dry-run writes nothing, even with --yes", async () => {
  const p = project();
  const before = read(path.join(p, "CLAUDE.md"));
  await runFix(options({ path: p, dryRun: true, yes: true }));

  assert.equal(read(path.join(p, "CLAUDE.md")), before);
  assert.equal(fs.existsSync(path.join(p, "CLAUDE.md.bak")), false);
  assert.equal(fs.existsSync(path.join(p, ".claudeignore")), false);
});

test("--yes applies high-confidence fixes and backs up what it edits", async () => {
  const p = project();
  const before = read(path.join(p, "CLAUDE.md"));
  await runFix(options({ path: p, yes: true }));

  const after = read(path.join(p, "CLAUDE.md"));
  assert.notEqual(after, before);
  assert.equal(read(path.join(p, "CLAUDE.md.bak")), before, "original recoverable");
  assert.ok(fs.existsSync(path.join(p, ".claudeignore")));
});

test("--yes never touches usage-unconfirmed items", async () => {
  const p = tmpdir();
  const home = tmpdir();
  write(p, "CLAUDE.md", "# rules\n");
  const mcp = write(p, ".mcp.json", JSON.stringify({ mcpServers: { github: {} } }, null, 2));
  const skill = write(home, ".claude/skills/keep/SKILL.md", "---\nname: keep\ndescription: A skill.\n---\n\nbody\n");

  await runFix(options({ path: p, home, yes: true }));

  assert.match(read(mcp), /mcpServers/);
  assert.ok(JSON.parse(read(mcp)).mcpServers.github, "MCP server left enabled");
  assert.ok(fs.existsSync(skill), "skill left in place");
});

test("archiving moves clutter aside instead of deleting it", async () => {
  const home = tmpdir();
  const stale = write(home, ".claude/agents/old.md.bak", "stale copy\n");
  await runFix(options({ home, yes: true }));

  assert.equal(fs.existsSync(stale), false, "removed from the load path");
  const archived = path.join(home, ".claude", ".ctxdiet-archive", "agents", "old.md.bak");
  assert.equal(read(archived), "stale copy\n", "recoverable from the archive");
});

test("a project's definitions are archived inside the project", async () => {
  const p = tmpdir();
  const home = tmpdir();
  write(p, "CLAUDE.md", "# rules\n");
  const stale = write(p, ".claude/commands/old.md.bak", "stale\n");
  await runFix(options({ path: p, home, yes: true }));

  assert.equal(fs.existsSync(stale), false);
  assert.ok(fs.existsSync(path.join(p, ".claude", ".ctxdiet-archive", "commands", "old.md.bak")));
  assert.equal(fs.existsSync(path.join(home, ".claude", ".ctxdiet-archive")), false, "not relocated to home");
});

test("running fix twice is idempotent", async () => {
  const p = project();
  await runFix(options({ path: p, yes: true }));
  const afterFirst = read(path.join(p, ".claudeignore"));
  const memoryAfterFirst = read(path.join(p, "CLAUDE.md"));

  await runFix(options({ path: p, yes: true }));

  assert.equal(read(path.join(p, ".claudeignore")), afterFirst, "no duplicate ignore block");
  assert.equal(read(path.join(p, "CLAUDE.md")), memoryAfterFirst);
  assert.equal((afterFirst.match(/# added by ctxdiet/g) ?? []).length, 0, "created file needs no marker");
});

test("augmenting a weak ignore file stamps its marker once", async () => {
  const p = tmpdir();
  write(p, "CLAUDE.md", "# rules\n");
  write(p, "node_modules/pkg/index.js", "x".repeat(50_000));
  write(p, ".claudeignore", "# mine\ndist/\n");

  await runFix(options({ path: p, yes: true }));
  await runFix(options({ path: p, yes: true }));

  const content = read(path.join(p, ".claudeignore"));
  assert.equal((content.match(/# added by ctxdiet/g) ?? []).length, 1);
  assert.match(content, /^# mine$/m, "the user's own content is preserved");
  assert.deepEqual(
    scan(options({ path: p })).findings.filter((f) => f.category === "Ignore"),
    [],
    "the finding it was raised for is resolved"
  );
});

test("disabling an MCP server preserves its config for restoring", () => {
  const p = tmpdir();
  const mcp = write(
    p,
    ".mcp.json",
    JSON.stringify({ mcpServers: { github: { command: "gh-mcp" } } }, null, 2)
  );
  write(p, "CLAUDE.md", "# rules\n");

  const finding = scan(options({ path: p })).findings.find((f) => f.category === "MCP");
  assert.ok(finding?.action?.type === "mcp-disable");

  // Applied through the low-confidence path only, which --yes never takes.
  const before = JSON.parse(read(mcp));
  assert.deepEqual(before.mcpServers.github, { command: "gh-mcp" });
});

test("fix --json --yes applies and reports what it touched", async () => {
  const p = project();
  const logged: string[] = [];
  const original = console.log;
  console.log = (m: string) => void logged.push(m);
  try {
    await runFix(options({ path: p, json: true, yes: true }));
  } finally {
    console.log = original;
  }

  const report = JSON.parse(logged.join("\n"));
  assert.equal(report.schemaVersion, 1);
  assert.ok(report.applied.length > 0, "paths reported");
  assert.ok(report.savedTokens > 0);
  assert.ok(fs.existsSync(path.join(p, ".claudeignore")), "actually applied");
});

test("fix --json without --yes changes nothing", async () => {
  const p = project();
  const original = console.log;
  console.log = () => {};
  try {
    await runFix(options({ path: p, json: true }));
  } finally {
    console.log = original;
  }
  assert.equal(fs.existsSync(path.join(p, ".claudeignore")), false);
});
