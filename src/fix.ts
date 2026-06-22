import { createTwoFilesPatch } from "diff";
import chalk from "chalk";
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";

import { printBeforeAfter, toJson } from "./report";
import { scan } from "./scan";
import { displayPath, readFileSafe } from "./sources";
import { trimMarkdown } from "./trim";
import { FixAction, ResolvedOptions } from "./types";

// ---------------------------------------------------------------------------
// Change model — the concrete edit a finding maps to.
// ---------------------------------------------------------------------------

type Change =
  | {
      kind: "write";
      path: string;
      before: string;
      after: string;
      isNew: boolean;
    }
  | { kind: "move"; path: string; to: string }
  | {
      kind: "mcp";
      path: string;
      before: string;
      after: string;
      server: string;
    };

/** Build the concrete change from fresh on-disk state (reflects prior edits). */
function buildChange(action: FixAction): Change | null {
  switch (action.type) {
    case "trim": {
      const before = readFileSafe(action.path);
      const after = trimMarkdown(before);
      if (before === after) return null;
      return { kind: "write", path: action.path, before, after, isNew: false };
    }
    case "ignore-create": {
      return {
        kind: "write",
        path: action.path,
        before: "",
        after: action.content,
        isNew: true,
      };
    }
    case "ignore-augment": {
      const before = readFileSafe(action.path);
      const body = before.replace(/\n*$/, "\n");
      const after = body + "\n# added by ctxdiet\n" + action.added.join("\n") + "\n";
      return { kind: "write", path: action.path, before, after, isNew: false };
    }
    case "mcp-disable": {
      const before = readFileSafe(action.path);
      const after = disableMcpServer(before, action.server);
      if (after === null || after === before) return null;
      return { kind: "mcp", path: action.path, before, after, server: action.server };
    }
    case "archive": {
      return { kind: "move", path: action.path, to: action.archiveTo };
    }
  }
}

function disableMcpServer(content: string, server: string): string | null {
  let json: Record<string, unknown>;
  try {
    json = JSON.parse(content);
  } catch {
    return null;
  }
  const servers = json.mcpServers as Record<string, unknown> | undefined;
  if (!servers || !(server in servers)) return null;
  const disabled =
    (json.mcpServers_disabledByCtxdiet as Record<string, unknown>) ?? {};
  disabled[server] = servers[server];
  delete servers[server];
  json.mcpServers_disabledByCtxdiet = disabled;
  return JSON.stringify(json, null, 2) + "\n";
}

// ---------------------------------------------------------------------------
// rendering + applying
// ---------------------------------------------------------------------------

function colorizeDiff(patch: string): string {
  return patch
    .split("\n")
    .map((line) => {
      if (line.startsWith("+++") || line.startsWith("---")) return chalk.dim(line);
      if (line.startsWith("@@")) return chalk.cyan(line);
      if (line.startsWith("+")) return chalk.green(line);
      if (line.startsWith("-")) return chalk.red(line);
      return line;
    })
    .join("\n");
}

function printChange(change: Change, o: ResolvedOptions): void {
  const rel = displayPath(change.path, o.path, o.home);
  if (change.kind === "move") {
    console.log(
      "  " +
        chalk.red("archive ") +
        rel +
        chalk.dim("  →  ") +
        displayPath(change.to, o.path, o.home)
    );
    return;
  }
  if (change.kind === "mcp") {
    console.log("  " + chalk.bold(rel));
    console.log(
      "    " +
        chalk.red(`- mcpServers.${change.server}`) +
        chalk.dim("  (kept under ") +
        chalk.green(`mcpServers_disabledByCtxdiet.${change.server}`) +
        chalk.dim(", reversible — JSON is reserialized, .bak saved)")
    );
    return;
  }
  const label = change.isNew ? `${rel} (new file)` : rel;
  const patch = createTwoFilesPatch(label, label, change.before, change.after, "", "", {
    context: 2,
  });
  // Drop the noisy "Index:"/"===" header lines and trailing tabs the diff lib adds.
  const cleaned = patch
    .split("\n")
    .filter((l) => !l.startsWith("Index: ") && !/^=+$/.test(l))
    .map((l) => (l.startsWith("--- ") || l.startsWith("+++ ") ? l.replace(/\s+$/, "") : l))
    .join("\n");
  console.log(colorizeDiff(cleaned));
}

function backup(p: string): void {
  if (!fs.existsSync(p)) return;
  let bak = p + ".bak";
  if (fs.existsSync(bak)) bak = `${p}.bak.${Date.now()}`;
  fs.copyFileSync(p, bak);
}

function applyChange(change: Change): void {
  if (change.kind === "move") {
    fs.mkdirSync(path.dirname(change.to), { recursive: true });
    try {
      fs.renameSync(change.path, change.to);
    } catch {
      // cross-device or dir move fallback: copy then remove.
      fs.cpSync(change.path, change.to, { recursive: true });
      fs.rmSync(change.path, { recursive: true, force: true });
    }
    return;
  }
  // write / mcp — back up any existing file before overwriting.
  const isNewFile = change.kind === "write" && change.isNew;
  if (!isNewFile && fs.existsSync(change.path)) backup(change.path);
  fs.mkdirSync(path.dirname(change.path), { recursive: true });
  fs.writeFileSync(change.path, change.after, "utf8");
}

// ---------------------------------------------------------------------------
// prompt
// ---------------------------------------------------------------------------

function confirm(question: string): Promise<boolean> {
  if (!process.stdin.isTTY) return Promise.resolve(false);
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise((resolve) => {
    rl.question(`${question} [y/N] `, (answer) => {
      rl.close();
      resolve(/^y(es)?$/i.test(answer.trim()));
    });
  });
}

// ---------------------------------------------------------------------------
// runFix
// ---------------------------------------------------------------------------

export async function runFix(o: ResolvedOptions): Promise<void> {
  const before = scan(o);
  const high = before.findings.filter(
    (f) => f.confidence === "high" && f.fixable && f.action
  );
  const low = before.findings.filter(
    (f) => f.confidence === "low" && f.fixable && f.action
  );

  if (high.length === 0 && low.length === 0) {
    if (o.json) {
      console.log(JSON.stringify({ message: "nothing to fix", before: toJson(before) }, null, 2));
    } else {
      console.log(chalk.green("\nNothing to fix — your setup is already lean.\n"));
    }
    return;
  }

  let lowApplied = 0;

  // ---- HIGH-confidence: normal [y/N] / --yes / --dry-run flow ----
  if (high.length > 0 && !o.json) {
    console.log(chalk.bold("\nHigh-confidence fixes\n"));
  }
  for (const f of high) {
    const change = buildChange(f.action!);
    if (!change) continue;
    if (!o.json) {
      console.log(chalk.bold(`• ${f.agent} · ${f.category} — ${f.title}`));
      printChange(change, o);
    }
    const go = decideHigh(o, () => confirm("Apply this change?"));
    await applyIf(go, change, o);
  }

  // ---- LOW-confidence: explicit interactive prompt only, never --yes ----
  if (low.length > 0) {
    if (o.yes) {
      if (!o.json) {
        console.log(
          chalk.yellow(
            `\nSkipped ${low.length} usage-unconfirmed item(s) (MCP servers / definitions). ` +
              `--yes never touches these — re-run \`ctxdiet fix\` without --yes to review them.`
          )
        );
      }
    } else if (o.json) {
      // non-interactive: cannot prompt, leave for interactive review.
    } else {
      console.log(chalk.yellow.bold("\nReview items — usage not confirmed\n"));
      console.log(
        chalk.dim(
          "ctxdiet can't see your history. Only disable what you know you don't use.\n"
        )
      );
      for (const f of low) {
        const change = buildChange(f.action!);
        if (!change) continue;
        console.log(chalk.bold(`• ${f.agent} · ${f.category} — ${f.title}`));
        printChange(change, o);
        const verb = f.action!.type === "mcp-disable" ? "Disable" : "Archive";
        const go = o.dryRun
          ? false
          : await confirm(
              `${verb} this? Only do this if you know it's unused.`
            );
        if (go && !o.dryRun) {
          applyChange(change);
          lowApplied += f.tokensPerSession;
          console.log(chalk.green("  applied\n"));
        } else {
          console.log(chalk.dim("  skipped\n"));
        }
      }
    }
  }

  // ---- measure ----
  const after = scan(o);
  if (o.json) {
    console.log(
      JSON.stringify(
        {
          dryRun: o.dryRun,
          before: toJson(before),
          after: toJson(after),
          savedTokens: before.baselineTokens - after.baselineTokens,
        },
        null,
        2
      )
    );
    return;
  }

  if (o.dryRun) {
    console.log(chalk.yellow("\nDry run — no files were written."));
  }
  printBeforeAfter(before, after, o, lowApplied);
}

function decideHigh(o: ResolvedOptions, ask: () => Promise<boolean>): Promise<boolean> {
  if (o.dryRun) return Promise.resolve(false);
  if (o.yes) return Promise.resolve(true);
  if (o.json) return Promise.resolve(false); // json non-interactive
  return ask();
}

async function applyIf(
  go: Promise<boolean>,
  change: Change,
  o: ResolvedOptions
): Promise<void> {
  const ok = await go;
  if (ok && !o.dryRun) {
    applyChange(change);
    if (!o.json) console.log(chalk.green("  applied\n"));
  } else if (!o.json && !o.dryRun) {
    console.log(chalk.dim("  skipped\n"));
  } else if (!o.json) {
    console.log();
  }
}
