import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { runFix } from "../src/fix";
import { scan } from "../src/scan";
import { ResolvedOptions } from "../src/types";

function tmpdir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function options(over: Partial<ResolvedOptions>): ResolvedOptions {
  return {
    path: tmpdir("slim-proj-"),
    home: tmpdir("slim-home-"),
    sessionsPerMonth: 100,
    model: "sonnet",
    modelDetected: false,
    json: true,
    dryRun: false,
    yes: false,
    ...over,
  };
}

test("scan runs without crashing on a dir with no Claude Code setup", () => {
  const o = options({});
  const result = scan(o);
  assert.equal(result.findings.length, 0);
  assert.equal(result.headlineSavings, 0);
  assert.equal(result.grade, "A");
});

test("fix --dry-run writes nothing", async () => {
  const projectPath = tmpdir("slim-proj-");
  const home = tmpdir("slim-home-");

  // A CLAUDE.md with provably-redundant content + no .claudeignore + a heavy dir.
  const claudeMd = path.join(projectPath, "CLAUDE.md");
  fs.writeFileSync(
    claudeMd,
    [
      "# Rules",
      "",
      "",
      "",
      "Always write the minimum secure code that solves the task.   ",
      "Always write the minimum secure code that solves the task.",
      "# Rules",
    ].join("\n")
  );
  fs.mkdirSync(path.join(projectPath, "node_modules", "pkg"), { recursive: true });
  fs.writeFileSync(
    path.join(projectPath, "node_modules", "pkg", "index.js"),
    "x".repeat(5000)
  );

  const before = fs.readFileSync(claudeMd, "utf8");

  const o = options({
    path: projectPath,
    home,
    json: true,
    dryRun: true,
    yes: true, // even with --yes, dry-run must not write
  });
  await runFix(o);

  assert.equal(fs.readFileSync(claudeMd, "utf8"), before, "CLAUDE.md unchanged");
  assert.equal(fs.existsSync(claudeMd + ".bak"), false, "no .bak created");
  assert.equal(
    fs.existsSync(path.join(projectPath, ".claudeignore")),
    false,
    ".claudeignore not created"
  );
});
