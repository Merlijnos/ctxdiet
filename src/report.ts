import chalk from "chalk";
import Table from "cli-table3";

import { monthlyCost } from "./pricing";
import { shortenPath } from "./sources";
import { Finding, ResolvedOptions, ScanResult } from "./types";

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
    chalk.dim("Detected agents: ") +
      r.detectedAgents.map((a) => chalk.cyan(a.label)).join(chalk.dim(", "))
  );
  console.log();

  const high = r.findings.filter((f) => f.confidence === "high");
  const low = r.findings.filter((f) => f.confidence === "low");

  const table = new Table({
    head: ["Agent", "Type", "Finding", "Tokens/session", "$/month"].map((h) =>
      chalk.bold(h)
    ),
    colAligns: ["left", "left", "left", "right", "right"],
    style: { head: [], border: [] },
  });

  for (const agent of r.detectedAgents) {
    const items = high.filter((f) => f.agent === agent.label);
    if (items.length === 0) {
      const hasReview = low.some((f) => f.agent === agent.label);
      table.push([
        agent.label,
        "—",
        hasReview
          ? chalk.dim("review items below")
          : chalk.green("clean"),
        chalk.dim("0"),
        chalk.dim("$0.00"),
      ]);
      continue;
    }
    for (const f of items) {
      table.push([
        agent.label,
        f.category,
        f.title,
        f.tokensPerSession > 0
          ? chalk.green(fmt(f.tokensPerSession))
          : chalk.dim("0"),
        f.tokensPerSession > 0
          ? chalk.green(dollars(f.tokensPerSession, o))
          : chalk.dim("$0.00"),
      ]);
    }
  }
  console.log(table.toString());
  console.log();

  // Headline — the whole pitch.
  const acrossNote =
    r.detectedAgents.length > 1
      ? chalk.dim(` (summed across ${r.detectedAgents.length} agents)`)
      : "";
  console.log(
    chalk.bold("Estimated savings if fixed: ") +
      chalk.bold.green(
        `~${fmt(r.headlineSavings)} tokens/session (~${dollars(
          r.headlineSavings,
          o
        )}/month)`
      ) +
      acrossNote
  );

  // LOW-confidence review section — explicitly not counted above.
  if (low.length > 0) {
    console.log();
    console.log(
      chalk.yellow.bold("Review — ctxdiet won't change these on its own")
    );
    console.log(
      chalk.dim(
        "They cost tokens every session; only you know if they're still in use."
      )
    );
    const reviewTable = new Table({
      head: ["Agent", "Type", "Item", "Est. tokens/session"].map((h) =>
        chalk.dim(h)
      ),
      colAligns: ["left", "left", "left", "right"],
      style: { head: [], border: [] },
    });
    for (const f of low) {
      reviewTable.push([
        f.agent,
        f.category,
        f.title,
        chalk.yellow(fmt(f.tokensPerSession)),
      ]);
    }
    console.log(reviewTable.toString());
    console.log(
      chalk.yellow(
        `Optional: ~${fmt(r.lowConfidencePotential)} tokens/session ` +
          `(~${dollars(r.lowConfidencePotential, o)}/month) if you disable what you don't need.`
      )
    );
  }

  const modelNote = o.modelDetected ? " (from your Claude config)" : "";
  console.log();
  console.log(
    chalk.dim(
      `Estimate: chars/4 at ${o.model} pricing${modelNote}, ${o.sessionsPerMonth} sessions/month. ` +
        `Run \`npx ctxdiet fix\` to apply.`
    )
  );
  console.log();
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
    method: "chars/4 heuristic — estimate only; usage history not analyzed",
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
