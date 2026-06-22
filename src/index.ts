#!/usr/bin/env node
import { Command } from "commander";
import os from "node:os";
import path from "node:path";

import { runFix } from "./fix";
import { printScanResult } from "./report";
import { scan } from "./scan";
import { detectModel } from "./sources";
import { Model, ResolvedOptions } from "./types";

interface RawOptions {
  path?: string;
  sessionsPerMonth?: string;
  model?: string;
  json?: boolean;
  dryRun?: boolean;
  yes?: boolean;
}

function resolveOptions(raw: RawOptions, modelFromCli: boolean): ResolvedOptions {
  const home = os.homedir();

  let model: Model;
  let modelDetected = false;
  if (modelFromCli) {
    const m = (raw.model ?? "sonnet").toLowerCase();
    if (m !== "opus" && m !== "sonnet" && m !== "haiku") {
      console.error(`Invalid --model "${raw.model}". Use opus, sonnet, or haiku.`);
      process.exit(1);
    }
    model = m;
  } else {
    const detected = detectModel(home);
    model = detected ?? "sonnet";
    modelDetected = detected !== null;
  }

  const parsed = Number.parseInt(raw.sessionsPerMonth ?? "100", 10);
  const sessionsPerMonth = Number.isFinite(parsed) && parsed > 0 ? parsed : 100;

  return {
    path: path.resolve(raw.path ?? process.cwd()),
    home,
    sessionsPerMonth,
    model,
    modelDetected,
    json: Boolean(raw.json),
    dryRun: Boolean(raw.dryRun),
    yes: Boolean(raw.yes),
  };
}

function addCommonOptions(cmd: Command): Command {
  return cmd
    .option("--path <dir>", "project directory to scan", process.cwd())
    .option("--sessions-per-month <n>", "sessions/month for cost estimate", "100")
    .option("--model <model>", "pricing model: opus|sonnet|haiku", "sonnet")
    .option("--json", "machine-readable JSON output")
    .option("--dry-run", "show changes but write nothing")
    .option("--yes", "apply all high-confidence fixes without prompting");
}

const program = new Command();
program
  .name("ctxdiet")
  .description("Detect, fix, and measure AI agent context-token waste.")
  .version("0.1.0");

addCommonOptions(program);
program.action(() => {
  const fromCli = program.getOptionValueSource("model") === "cli";
  const o = resolveOptions(program.opts<RawOptions>(), fromCli);
  printScanResult(scan(o), o);
});

const fix = program
  .command("fix")
  .description(
    "Generate fixes, show diffs, apply on confirmation, then show before/after."
  );
addCommonOptions(fix);
fix.action(async () => {
  const fromCli =
    fix.getOptionValueSource("model") === "cli" ||
    program.getOptionValueSource("model") === "cli";
  await runFix(resolveOptions(fix.optsWithGlobals<RawOptions>(), fromCli));
});

program.parseAsync(process.argv).catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
