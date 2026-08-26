import { confirm, isCancel, log, select } from "@clack/prompts";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import pc from "picocolors";

import { applyOverlapResolution, type ResolveChoice } from "./overlap.js";
import { printBeforeAfter } from "./report.js";
import { scan } from "./scan.js";
import { archivePathFor, displayPath, readFileSafe } from "./sources.js";
import { trimMarkdown } from "./trim.js";
import type { Finding, FixAction, Overlap, ResolvedOptions } from "./types.js";

// ---------------------------------------------------------------------------
// concrete change for a finding (computed from fresh on-disk state)
// ---------------------------------------------------------------------------

const MARKER = "# added by ctxdiet";

type Change =
  | { kind: "write"; path: string; after: string; isNew: boolean }
  | { kind: "move"; path: string; to: string }
  | { kind: "move-many"; moves: Array<{ path: string; to: string }> }
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
      const existing = new Set(
        before.split("\n").map((l) => l.trim()).filter(Boolean)
      );
      const fresh = action.added.filter((p) => !existing.has(p));
      if (fresh.length === 0) return null;
      // Only stamp the marker once; re-running fix used to append a fresh
      // "# added by ctxdiet" header on every pass.
      const header = before.includes(MARKER) ? "" : `\n${MARKER}\n`;
      const after = before.replace(/\n*$/, "\n") + header + fresh.join("\n") + "\n";
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
    case "archive-many": {
      const moves = action.paths
        .filter((p) => fs.existsSync(p))
        .map((p) => ({ path: p, to: archivePathFor(p, action.home) }));
      return moves.length === 0 ? null : { kind: "move-many", moves };
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
  const servers = json["mcpServers"] as Record<string, unknown> | undefined;
  if (!servers || !(server in servers)) return null;
  const disabled = (json["mcpServers_disabledByCtxdiet"] as Record<string, unknown>) ?? {};
  disabled[server] = servers[server];
  delete servers[server];
  json["mcpServers_disabledByCtxdiet"] = disabled;
  return JSON.stringify(json, null, 2) + "\n";
}

/** One-line, human summary of a change — no raw diff. */
function summarize(f: Finding, change: Change, o: ResolvedOptions): string {
  const here = (p: string) => displayPath(p, o.path, o.home);
  switch (change.kind) {
    case "move":
      return `Archive ${here(change.path)} ${pc.dim("(" + (f.detail ?? f.title) + ")")}`;
    case "move-many":
      return (
        `Archive ${change.moves.length} file(s) ${pc.dim("(" + (f.detail ?? f.title) + ")")}\n` +
        change.moves.map((m) => pc.dim("    " + here(m.path))).join("\n")
      );
    case "mcp":
      return `Disable MCP server ${pc.bold(change.server)} in ${here(change.path)}`;
    case "write":
      if (change.isNew)
        return `Create ${here(change.path)} ${pc.dim("— ignore " + (f.detail ?? "heavy paths"))}`;
      if (f.category === "Ignore")
        return `Update ${here(change.path)} ${pc.dim("— add ignore patterns")}`;
      return `Trim ${here(change.path)} ${pc.green("-" + f.tokensPerSession + " tok")} ${pc.dim("(" + (f.detail ?? "") + ")")}`;
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

function archive(from: string, to: string): void {
  fs.mkdirSync(path.dirname(to), { recursive: true });
  try {
    fs.renameSync(from, to);
  } catch {
    fs.cpSync(from, to, { recursive: true });
    fs.rmSync(from, { recursive: true, force: true });
  }
}

function applyChange(change: Change): void {
  if (change.kind === "move") {
    archive(change.path, change.to);
    return;
  }
  if (change.kind === "move-many") {
    for (const m of change.moves) archive(m.path, m.to);
    return;
  }
  const isNewFile = change.kind === "write" && change.isNew;
  if (!isNewFile && fs.existsSync(change.path)) backup(change.path);
  fs.mkdirSync(path.dirname(change.path), { recursive: true });
  fs.writeFileSync(change.path, change.after, "utf8");
}

/** Open $EDITOR (fallback nano) on a temp file; return the merged single-line rule. */
function openEditor(a: string, b: string): string | null {
  const editor = process.env["VISUAL"] || process.env["EDITOR"] || "nano";
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ctxdiet-merge-"));
  const file = path.join(dir, "MERGE_RULE.txt");
  fs.writeFileSync(
    file,
    `# Merge these two rules into one. Edit below, then save & exit.\n` +
      `# Lines starting with # are ignored.\n${a}\n${b}\n`,
    "utf8"
  );
  // $EDITOR may carry arguments ("code --wait"); an empty or blank value must
  // not turn into spawnSync(undefined).
  const [cmd, ...args] = editor.trim().split(/\s+/).filter(Boolean);
  const res = cmd
    ? spawnSync(cmd, [...args, file], { stdio: "inherit" })
    : { error: new Error("no editor configured"), status: null };
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
