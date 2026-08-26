#!/usr/bin/env node
import { intro, outro } from "@clack/prompts";
import { Command } from "commander";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import pc from "picocolors";

import { promptConfirm, runFix } from "./fix.js";
import { printScanResult } from "./report.js";
import { scan } from "./scan.js";
import { GRADES, gradeRank } from "./constants.js";
import { detectModel } from "./sources.js";
import type { Model, ResolvedOptions } from "./types.js";

/** Single source of truth: package.json, read from the installed layout. */
function readVersion(): string {
  try {
    const pkg = createRequire(import.meta.url)("../../package.json") as { version?: string };
    return pkg.version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

const VERSION = readVersion();
const BANNER = pc.bgCyan(pc.black(" ctxdiet "));

/** When launched as `slimclaude`, nudge toward the new name (the old one still works). */
function renameBannerIfNeeded(): void {
  const invokedAs = path.basename(process.argv[1] ?? "");
  if (/slimclaude/i.test(invokedAs)) {
    process.stderr.write(
      pc.dim("note: slimclaude is now ctxdiet — switch with `npm i ctxdiet` (this still works)\n")
    );
  }
}

interface RawOptions {
  path?: string;
  sessionsPerMonth?: string;
  model?: string;
  maxTokens?: string;
  failOn?: string;
  json?: boolean;
  dryRun?: boolean;
  yes?: boolean;
  usage?: boolean;
  includeUnused?: boolean;
}

/** Wrong invocation, distinct from a gate that legitimately failed. */
const EXIT_USAGE = 2;

function usageError(message: string): never {
  console.error(message);
  process.exit(EXIT_USAGE);
}

function resolveOptions(raw: RawOptions, modelFromCli: boolean): ResolvedOptions {
  const home = os.homedir();

  let model: Model;
  let modelDetected = false;
  if (modelFromCli) {
    const m = (raw.model ?? "sonnet").toLowerCase();
    if (m !== "opus" && m !== "sonnet" && m !== "haiku") {
      usageError(`Invalid --model "${raw.model}". Use opus, sonnet, or haiku.`);
    }
    model = m;
  } else {
    const detected = detectModel(home);
    model = detected ?? "sonnet";
    modelDetected = detected !== null;
  }

  const parsed = Number.parseInt(raw.sessionsPerMonth ?? "100", 10);
  const sessionsPerMonth = Number.isFinite(parsed) && parsed > 0 ? parsed : 100;

  let maxTokens: number | null = null;
  if (raw.maxTokens != null) {
    const n = Number.parseInt(raw.maxTokens, 10);
    if (!Number.isFinite(n) || n <= 0) {
      usageError(`Invalid --max-tokens "${raw.maxTokens}". Use a positive integer.`);
    }
    maxTokens = n;
  }

  let failOn: string | null = null;
  if (raw.failOn != null) {
    const g = raw.failOn.toUpperCase();
    if (!(GRADES as readonly string[]).includes(g)) {
      usageError(`Invalid --fail-on "${raw.failOn}". Use one of ${GRADES.join(", ")}.`);
    }
    failOn = g;
  }

  return {
    path: path.resolve(raw.path ?? process.cwd()),
    home,
    sessionsPerMonth,
    model,
    modelDetected,
    maxTokens,
    failOn,
    json: Boolean(raw.json),
    dryRun: Boolean(raw.dryRun),
    yes: Boolean(raw.yes),
    usage: raw.usage !== false,
    includeUnused: Boolean(raw.includeUnused),
  };
}

function addCommonOptions(cmd: Command): Command {
  return cmd
    .option("--path <dir>", "project directory to scan", process.cwd())
    .option("--sessions-per-month <n>", "sessions/month for cost estimate", "100")
    .option("--model <model>", "pricing model: opus|sonnet|haiku", "sonnet")
    .option("--max-tokens <n>", "CI budget: exit non-zero if context exceeds n tokens")
    .option("--fail-on <grade>", "CI gate: exit non-zero if the grade is worse than this (A-F)")
    .option("--json", "machine-readable JSON output")
    .option("--dry-run", "show changes but write nothing")
    .option("--yes", "apply all high-confidence fixes without prompting")
    .option("--no-usage", "skip local session history; judge config alone")
    .option(
      "--include-unused",
      "let --yes also disable items the session history shows are never used"
    );
}

const program = new Command();
program
  .name("ctxdiet")
  .description("Detect, fix, and measure AI agent context-token waste.")
  .version(VERSION);

addCommonOptions(program);
program.action(async () => {
  renameBannerIfNeeded();
  const fromCli = program.getOptionValueSource("model") === "cli";
  const o = resolveOptions(program.opts<RawOptions>(), fromCli);
  const result = scan(o);

  if (!o.json) intro(BANNER);
  printScanResult(result, o);

  // CI gates — checks, not interactive flows.
  if (o.maxTokens != null || o.failOn != null) {
    const failures: string[] = [];
    const used = result.baselineTokens.toLocaleString("en-US");

    if (o.maxTokens != null && result.baselineTokens > o.maxTokens) {
      failures.push(`over budget: ${used} > ${o.maxTokens.toLocaleString("en-US")} context tokens`);
    }
    if (o.failOn != null && gradeRank(result.grade) > gradeRank(o.failOn)) {
      failures.push(`grade ${result.grade} is worse than the ${o.failOn} floor`);
    }

    if (failures.length > 0) {
      if (!o.json) outro(pc.red(failures.join("; ")));
      process.exit(1);
    }
    if (!o.json) {
      const passed = o.maxTokens != null ? `within budget: ${used} context tokens` : `grade ${result.grade}`;
      outro(pc.green(passed));
    }
    return;
  }

  if (o.json) return;

  const fixable = result.findings.filter((f) => f.confidence === "high" && f.fixable && f.action);
  if (fixable.length === 0 && result.overlaps.length === 0) {
    outro(pc.dim("Nothing to apply."));
    return;
  }

  // One-step flow: offer to fix right here instead of making the user re-run.
  if (process.stdin.isTTY && !o.dryRun) {
    const bits: string[] = [];
    if (fixable.length > 0) bits.push(`fix ${fixable.length} issue${fixable.length > 1 ? "s" : ""}`);
    if (result.overlaps.length > 0) bits.push(`resolve ${result.overlaps.length} duplicate${result.overlaps.length > 1 ? "s" : ""}`);
    if (await promptConfirm(`${bits.join(" and ")} now?`)) {
      await runFix(o);
      outro(pc.green("Done."));
      return;
    }
  }
  outro(pc.dim("Run `npx ctxdiet fix` to apply."));
});

const fix = program
  .command("fix")
  .description("Show a summary per change, confirm, apply, then report before/after.");
addCommonOptions(fix);
fix.action(async () => {
  renameBannerIfNeeded();
  const fromCli =
    fix.getOptionValueSource("model") === "cli" || program.getOptionValueSource("model") === "cli";
  const o = resolveOptions(fix.optsWithGlobals<RawOptions>(), fromCli);
  if (!o.json) intro(pc.bgCyan(pc.black(" ctxdiet fix ")));
  await runFix(o);
  if (!o.json) outro(pc.green("Done."));
});

program.parseAsync(process.argv).catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
