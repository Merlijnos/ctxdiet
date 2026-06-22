import { log, note } from "@clack/prompts";
import pc from "picocolors";

import { monthlyCost } from "./pricing";
import { shortenPath } from "./sources";
import { Finding, ResolvedOptions, ScanResult } from "./types";

const fmt = (n: number) => Math.round(n).toLocaleString("en-US");
const usd = (n: number) => `$${n.toFixed(2)}`;

function dollars(tokens: number, o: ResolvedOptions): string {
  return usd(monthlyCost(tokens, o.sessionsPerMonth, o.model));
}

export function gradeBadge(g: string): string {
  if (g === "A" || g === "B") return pc.bgGreen(pc.black(` ${g} `));
  if (g === "C") return pc.bgYellow(pc.black(` ${g} `));
  return pc.bgRed(pc.white(` ${g} `));
}

export function printScanResult(r: ScanResult, o: ResolvedOptions): void {
  if (o.json) {
    console.log(JSON.stringify(toJson(r), null, 2));
    return;
  }

  log.message(`${pc.dim(shortenPath(o.path, o.home))}   grade ${gradeBadge(r.grade)}`);

  if (r.detectedAgents.length === 0) {
    log.warn(
      "No agent setup detected. Supported: Claude Code, Codex/AGENTS.md, " +
        "Cursor, Gemini CLI, Windsurf, GitHub Copilot."
    );
    methodNote(o);
    return;
  }

  log.info("Detected " + r.detectedAgents.map((a) => pc.cyan(a.label)).join(pc.dim(", ")));

  const high = r.findings.filter((f) => f.confidence === "high");
  const low = r.findings.filter((f) => f.confidence === "low");

  if (high.length === 0) {
    if (low.length === 0 && r.overlaps.length === 0) {
      log.success("Nothing to fix — your agent config is already lean.");
    } else {
      log.warn("No auto-fixable waste — but a few things below are worth a look.");
    }
  } else {
    const body = high
      .map((f) => {
        const save =
          f.tokensPerSession > 0
            ? pc.green(`-${fmt(f.tokensPerSession)} tok`)
            : pc.dim("review");
        const why = f.detail ? `\n  ${pc.dim(f.detail)}` : "";
        return `${pc.cyan(f.agent)} · ${f.title}  ${save}${why}`;
      })
      .join("\n\n");
    note(body, "Fixable waste");
    const across = r.detectedAgents.length > 1 ? `, ${r.detectedAgents.length} agents` : "";
    log.message(
      pc.bold("Fixable now: ") +
        pc.bold(pc.green(`~${fmt(r.headlineSavings)} tokens/session`)) +
        pc.dim(` (~${dollars(r.headlineSavings, o)}/mo${across})`)
    );
  }

  if (low.length > 0) {
    const body =
      low
        .map((f) => `${pc.cyan(f.agent)} · ${f.title}  ${pc.yellow(fmt(f.tokensPerSession) + " tok")}`)
        .join("\n") + `\n${pc.dim("Disable only what you know you don't use.")}`;
    note(body, "Review — usage unconfirmed");
  }

  if (r.overlaps.length > 0) {
    log.warn(
      `${r.overlaps.length} possible duplicate rule${r.overlaps.length > 1 ? "s" : ""} — ` +
        `resolve interactively with ${pc.bold("ctxdiet fix")}`
    );
  }

  methodNote(o);
}

function methodNote(o: ResolvedOptions): void {
  const modelNote = o.modelDetected ? " (from your Claude config)" : "";
  log.message(
    pc.dim(
      `Counts: GPT-4 tokenizer for files, size estimate for dirs (offline). ` +
        `Pricing ${o.model}${modelNote}, ${o.sessionsPerMonth} sessions/mo.`
    )
  );
}

export function printBeforeAfter(
  before: ScanResult,
  after: ScanResult,
  o: ResolvedOptions,
  lowApplied: number
): void {
  const saved = before.baselineTokens - after.baselineTokens;
  const beforeCost = monthlyCost(before.baselineTokens, o.sessionsPerMonth, o.model);
  const afterCost = monthlyCost(after.baselineTokens, o.sessionsPerMonth, o.model);
  const arrow = pc.dim("→");

  const body =
    `Context  ${fmt(before.baselineTokens)} ${arrow} ${pc.green(fmt(after.baselineTokens))}` +
    `   ${pc.green(`-${fmt(saved)} tok`)}\n` +
    `Cost     ${usd(beforeCost)} ${arrow} ${usd(afterCost)}/mo` +
    `   ${pc.green(`-${usd(beforeCost - afterCost)}`)}\n` +
    `Grade    ${gradeBadge(before.grade)} ${arrow} ${gradeBadge(after.grade)}`;
  note(body, "Before vs after");

  if (lowApplied > 0) {
    log.message(pc.dim(`Includes -${fmt(lowApplied)} tok from review items you disabled.`));
  }
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
    overlaps: r.overlaps.length,
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
