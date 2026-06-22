import chalk from "chalk";
import Table from "cli-table3";

import { monthlyCost } from "./pricing";
import { shortenPath } from "./sources";
import { Finding, Overlap, ResolvedOptions, ScanResult } from "./types";

const fmt = (n: number) => Math.round(n).toLocaleString("en-US");
const usd = (n: number) => `$${n.toFixed(2)}`;

function dollars(tokens: number, o: ResolvedOptions): string {
  return usd(monthlyCost(tokens, o.sessionsPerMonth, o.model));
}

function gradeBadge(g: string): string {
  const paint =
    g === "A" || g === "B"
      ? chalk.bgGreen.black
      : g === "C"
      ? chalk.bgYellow.black
      : chalk.bgRed.white;
  return paint.bold(` ${g} `);
}

function methodNote(o: ResolvedOptions): void {
  const modelNote = o.modelDetected ? " (from your Claude config)" : "";
  console.log();
  console.log(
    chalk.dim(
      `Counts: GPT-4 tokenizer for files, size estimate for dirs (offline). ` +
        `Pricing: ${o.model}${modelNote}, ${o.sessionsPerMonth} sessions/month.`
    )
  );
  console.log();
}

function printReview(r: ScanResult, low: Finding[], o: ResolvedOptions): void {
  console.log();
  console.log(chalk.yellow.bold("Review — ctxdiet won't change these on its own"));
  console.log(
    chalk.dim("They cost tokens every session; only you know if they're still in use.")
  );
  const table = new Table({
    head: ["Agent", "Item", "Est. tokens/session"].map((h) => chalk.dim(h)),
    colAligns: ["left", "left", "right"],
    style: { head: [], border: [] },
  });
  for (const f of low) {
    table.push([f.agent, f.title, chalk.yellow(fmt(f.tokensPerSession))]);
  }
  console.log(table.toString());
  console.log(
    chalk.yellow(
      `Optional: ~${fmt(r.lowConfidencePotential)} tokens/session ` +
        `(~${dollars(r.lowConfidencePotential, o)}/month) if you disable what you don't need.`
    )
  );
}

function printOverlaps(overlaps: Overlap[]): void {
  console.log();
  console.log(chalk.cyan.bold("Possible duplicate rules — consider merging"));
  console.log(
    chalk.dim("Reworded near-duplicates. ctxdiet won't merge these — your call.")
  );
  let lastFile = "";
  for (const ov of overlaps) {
    if (ov.file !== lastFile) {
      console.log("  " + chalk.bold(ov.file));
      lastFile = ov.file;
    }
    console.log("    " + chalk.dim("- ") + ov.a);
    console.log("    " + chalk.dim("- ") + ov.b);
  }
}

export function printScanResult(r: ScanResult, o: ResolvedOptions): void {
  if (o.json) {
    console.log(JSON.stringify(toJson(r), null, 2));
    return;
  }

  console.log();
  console.log(
    chalk.bold("ctxdiet") +
      chalk.dim(`  ·  ${shortenPath(o.path, o.home)}  ·  grade `) +
      gradeBadge(r.grade)
  );

  if (r.detectedAgents.length === 0) {
    console.log();
    console.log(
      chalk.dim(
        "No agent setup detected here. Supported: Claude Code, Codex/AGENTS.md, " +
          "Cursor, Gemini CLI, Windsurf, GitHub Copilot."
      )
    );
    console.log();
    return;
  }

  console.log(
    chalk.dim("Detected: ") +
      r.detectedAgents.map((a) => chalk.cyan(a.label)).join(chalk.dim(", "))
  );

  const high = r.findings.filter((f) => f.confidence === "high");
  const low = r.findings.filter((f) => f.confidence === "low");

  // Clean: nothing auto-fixable. Say so plainly instead of an empty table.
  if (high.length === 0) {
    console.log();
    if (low.length === 0 && r.overlaps.length === 0) {
      console.log(chalk.green("Nothing to fix — your agent config is already lean."));
    } else {
      console.log(
        chalk.green("No auto-fixable waste.") +
          chalk.dim(" A few things below are worth a look.")
      );
      if (low.length > 0) printReview(r, low, o);
      if (r.overlaps.length > 0) printOverlaps(r.overlaps);
    }
    methodNote(o);
    return;
  }

  // Fixable findings: one row each, with the "why" under the title.
  console.log();
  const table = new Table({
    head: ["Agent", "Problem", "Saves/session", "$/mo"].map((h) => chalk.bold(h)),
    colAligns: ["left", "left", "right", "right"],
    style: { head: [], border: [] },
  });
  for (const f of high) {
    const problem = f.detail ? `${f.title}\n${chalk.dim(f.detail)}` : f.title;
    table.push([
      f.agent,
      problem,
      f.tokensPerSession > 0 ? chalk.green(fmt(f.tokensPerSession)) : chalk.dim("0"),
      f.tokensPerSession > 0 ? chalk.green(dollars(f.tokensPerSession, o)) : chalk.dim("$0.00"),
    ]);
  }
  console.log(table.toString());
  console.log();

  console.log(
    chalk.bold("Fixable now: ") +
      chalk.bold.green(
        `~${fmt(r.headlineSavings)} tokens/session (~${dollars(r.headlineSavings, o)}/month)`
      ) +
      (r.detectedAgents.length > 1
        ? chalk.dim(` across ${r.detectedAgents.length} agents`)
        : "")
  );

  if (low.length > 0) printReview(r, low, o);
  if (r.overlaps.length > 0) printOverlaps(r.overlaps);
  methodNote(o);
}

// ---------------------------------------------------------------------------
// before/after money shot
// ---------------------------------------------------------------------------

export function printBeforeAfter(
  before: ScanResult,
  after: ScanResult,
  o: ResolvedOptions,
  lowApplied: number
): void {
  const savedTokens = before.baselineTokens - after.baselineTokens;
  const beforeCost = monthlyCost(before.baselineTokens, o.sessionsPerMonth, o.model);
  const afterCost = monthlyCost(after.baselineTokens, o.sessionsPerMonth, o.model);

  const arrow = chalk.dim("→");
  const table = new Table({
    head: ["", "Before", "", "After", "Saved"].map((h) => chalk.bold(h)),
    colAligns: ["left", "right", "left", "right", "right"],
    style: { head: [], border: [] },
  });

  table.push([
    "Context tokens/session",
    fmt(before.baselineTokens),
    arrow,
    fmt(after.baselineTokens),
    chalk.green(fmt(savedTokens)),
  ]);
  table.push([
    "$/month",
    usd(beforeCost),
    arrow,
    usd(afterCost),
    chalk.green(usd(beforeCost - afterCost)),
  ]);
  table.push(["Grade", gradeBadge(before.grade), arrow, gradeBadge(after.grade), ""]);

  console.log();
  console.log(chalk.bold("Before vs after"));
  console.log(table.toString());
  if (lowApplied > 0) {
    console.log(
      chalk.dim(
        `Includes ~${fmt(lowApplied)} tokens/session from review items you chose to disable.`
      )
    );
  }
  console.log();
}

// ---------------------------------------------------------------------------
// JSON serialization (no large blobs)
// ---------------------------------------------------------------------------

export function toJson(r: ScanResult) {
  const { options } = r;
  return {
    path: options.path,
    model: options.model,
    sessionsPerMonth: options.sessionsPerMonth,
    method: "GPT-4 tokenizer for files, size estimate for dirs — offline; not a billing figure",
    detectedAgents: r.detectedAgents,
    grade: r.grade,
    baselineTokens: r.baselineTokens,
    headlineSavingsTokens: r.headlineSavings,
    headlineSavingsUsdPerMonth: Number(
      monthlyCost(r.headlineSavings, options.sessionsPerMonth, options.model).toFixed(2)
    ),
    lowConfidencePotentialTokens: r.lowConfidencePotential,
    findings: r.findings.map((f: Finding) => ({
      agent: f.agent,
      category: f.category,
      title: f.title,
      detail: f.detail,
      tokensPerSession: f.tokensPerSession,
      confidence: f.confidence,
      fixable: f.fixable,
      manualReview: f.manualReview ?? false,
    })),
  };
}
