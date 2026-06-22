import { confirm, isCancel, log, select } from "@clack/prompts";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import pc from "picocolors";

import { applyOverlapResolution, ResolveChoice } from "./overlap";
import { printBeforeAfter } from "./report";
import { scan } from "./scan";
import { displayPath, readFileSafe } from "./sources";
import { trimMarkdown } from "./trim";
import { Finding, FixAction, Overlap, ResolvedOptions } from "./types";

// ---------------------------------------------------------------------------
// concrete change for a finding (computed from fresh on-disk state)
// ---------------------------------------------------------------------------

type Change =
  | { kind: "write"; path: string; after: string; isNew: boolean }
  | { kind: "move"; path: string; to: string }
  | { kind: "mcp"; path: string; after: string; server: string };

function buildChange(action: FixAction): Change | null {
  switch (action.type) {
    case "trim": {
      const before = readFileSafe(action.path);
      const after = trimMarkdown(before);
      return before === after ? null : { kind: "write", path: action.path, after, isNew: false };
    }
    case "ignore-create":
      return { kind: "write", path: action.path, after: action.content, isNew: true };
    case "ignore-augment": {
      const before = readFileSafe(action.path);
      const after = before.replace(/\n*$/, "\n") + "\n# added by ctxdiet\n" + action.added.join("\n") + "\n";
      return { kind: "write", path: action.path, after, isNew: false };
    }
    case "mcp-disable": {
      const before = readFileSafe(action.path);
      const after = disableMcpServer(before, action.server);
      return after === null || after === before
        ? null
        : { kind: "mcp", path: action.path, after, server: action.server };
    }
    case "archive":
      return { kind: "move", path: action.path, to: action.archiveTo };
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
  const disabled = (json.mcpServers_disabledByCtxdiet as Record<string, unknown>) ?? {};
  disabled[server] = servers[server];
  delete servers[server];
  json.mcpServers_disabledByCtxdiet = disabled;
  return JSON.stringify(json, null, 2) + "\n";
}

/** One-line, human summary of a change — no raw diff. */
function summarize(f: Finding, change: Change, o: ResolvedOptions): string {
  const where = displayPath(change.path, o.path, o.home);
  switch (change.kind) {
    case "move":
      return `Archive ${where} ${pc.dim("(" + (f.detail ?? f.title) + ")")}`;
    case "mcp":
      return `Disable MCP server ${pc.bold(change.server)} in ${where}`;
    case "write":
      if (change.isNew) return `Create ${where} ${pc.dim("— ignore " + (f.detail ?? "heavy paths"))}`;
      if (f.category === "Ignore") return `Update ${where} ${pc.dim("— add ignore patterns")}`;
      return `Trim ${where} ${pc.green("-" + f.tokensPerSession + " tok")} ${pc.dim("(" + (f.detail ?? "") + ")")}`;
  }
}

// ---------------------------------------------------------------------------
// filesystem
// ---------------------------------------------------------------------------

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
      fs.cpSync(change.path, change.to, { recursive: true });
      fs.rmSync(change.path, { recursive: true, force: true });
    }
    return;
  }
  const isNewFile = change.kind === "write" && change.isNew;
  if (!isNewFile && fs.existsSync(change.path)) backup(change.path);
  fs.mkdirSync(path.dirname(change.path), { recursive: true });
  fs.writeFileSync(change.path, change.after, "utf8");
}

/** Open $EDITOR (fallback nano) on a temp file; return the merged single-line rule. */
function openEditor(a: string, b: string): string | null {
  const editor = process.env.EDITOR || process.env.VISUAL || "nano";
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ctxdiet-merge-"));
  const file = path.join(dir, "MERGE_RULE.txt");
  fs.writeFileSync(
    file,
    `# Merge these two rules into one. Edit below, then save & exit.\n` +
      `# Lines starting with # are ignored.\n${a}\n${b}\n`,
    "utf8"
  );
  const [cmd, ...args] = editor.split(/\s+/);
  const res = spawnSync(cmd, [...args, file], { stdio: "inherit" });
  let merged: string | null = null;
  if (!res.error && (res.status === 0 || res.status === null)) {
    const text = fs
      .readFileSync(file, "utf8")
      .split("\n")
      .filter((l) => !l.startsWith("#"))
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
    merged = text === "" ? null : text;
  }
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
  return merged;
}

// ---------------------------------------------------------------------------
// prompts
// ---------------------------------------------------------------------------

export async function promptConfirm(message: string): Promise<boolean> {
  if (!process.stdin.isTTY) return false;
  const res = await confirm({ message });
  return !isCancel(res) && res === true;
}

/** Interactive duplicate resolution. Returns tokens reclaimed (best-effort). */
async function resolveOverlaps(overlaps: Overlap[], o: ResolvedOptions): Promise<number> {
  log.step(
    `${overlaps.length} possible duplicate rule${overlaps.length > 1 ? "s" : ""} — choose what to keep`
  );
  let touched = 0;

  for (const ov of overlaps) {
    const where = displayPath(ov.path, o.path, o.home);
    const choice = await select({
      message: `${pc.dim(where)}\n  A: ${ov.a}\n  B: ${ov.b}`,
      options: [
        { value: "a", label: "Keep A", hint: ov.a.slice(0, 48) },
        { value: "b", label: "Keep B", hint: ov.b.slice(0, 48) },
        { value: "merge", label: "Merge in editor" },
        { value: "skip", label: "Skip" },
      ],
      initialValue: "skip",
    });
    if (isCancel(choice)) break;

    const pick = choice as ResolveChoice;
    if (pick === "skip") continue;

    let merged: string | undefined;
    if (pick === "merge") {
      const result = openEditor(ov.a, ov.b);
      if (result === null) {
        log.warn("  merge cancelled — skipped");
        continue;
      }
      merged = result;
    }

    const before = readFileSafe(ov.path);
    const next = applyOverlapResolution(before, ov.a, ov.b, pick, merged);
    if (next === null || next === before) {
      log.warn("  couldn't locate the lines — skipped");
      continue;
    }
    backup(ov.path);
    fs.writeFileSync(ov.path, next, "utf8");
    touched++;
    log.success(`  ${where} updated`);
  }
  return touched;
}

// ---------------------------------------------------------------------------
// runFix
// ---------------------------------------------------------------------------

export async function runFix(o: ResolvedOptions): Promise<void> {
  const before = scan(o);
  const high = before.findings.filter((f) => f.confidence === "high" && f.fixable && f.action);
  const low = before.findings.filter((f) => f.confidence === "low" && f.fixable && f.action);
  const overlaps = before.overlaps;

  if (o.json) {
    console.log(
      JSON.stringify(
        {
          dryRun: o.dryRun,
          fixable: high.length,
          review: low.length,
          overlaps: overlaps.length,
          fixableSavingsTokens: before.headlineSavings,
        },
        null,
        2
      )
    );
    return;
  }

  if (high.length === 0 && low.length === 0 && overlaps.length === 0) {
    log.success("Nothing to fix — your setup is already lean.");
    return;
  }

  const interactive = process.stdin.isTTY && !o.dryRun;
  let lowApplied = 0;

  // ---- HIGH-confidence: summary + confirm (auto under --yes, preview under --dry-run) ----
  for (const f of high) {
    const change = buildChange(f.action!);
    if (!change) continue;
    log.step(summarize(f, change, o));
    let go = false;
    if (o.dryRun) go = false;
    else if (o.yes) go = true;
    else if (interactive) go = await promptConfirm("Apply this change?");
    if (go) {
      applyChange(change);
      log.success("  applied");
    } else if (!o.dryRun) {
      log.message(pc.dim("  skipped"));
    }
  }

  // ---- LOW-confidence: explicit confirm only; never under --yes ----
  if (low.length > 0) {
    if (o.yes) {
      log.warn(
        `Skipped ${low.length} usage-unconfirmed item(s). --yes never touches these — ` +
          `run \`ctxdiet fix\` without --yes to review.`
      );
    } else if (interactive) {
      for (const f of low) {
        const change = buildChange(f.action!);
        if (!change) continue;
        log.step(summarize(f, change, o) + pc.dim("  (usage unconfirmed)"));
        if (await promptConfirm("Disable this? Only if you know it's unused.")) {
          applyChange(change);
          lowApplied += f.tokensPerSession;
          log.success("  done");
        } else {
          log.message(pc.dim("  skipped"));
        }
      }
    }
  }

  // ---- Overlaps: interactive resolution (the critical fix) ----
  if (overlaps.length > 0) {
    if (interactive) await resolveOverlaps(overlaps, o);
    else if (o.yes) log.warn(`${overlaps.length} duplicate-rule pair(s) need an interactive choice — skipped under --yes.`);
  }

  if (o.dryRun) log.message(pc.yellow("Dry run — no files were written."));
  const after = scan(o);
  printBeforeAfter(before, after, o, lowApplied);
}
