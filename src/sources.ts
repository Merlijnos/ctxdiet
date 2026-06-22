import fs from "node:fs";
import path from "node:path";

import {
  HEAVY_PATH_TOKEN_CAP,
  HEAVY_WALK_MAX_BYTES,
  HEAVY_WALK_MAX_FILES,
} from "./constants";
import { estimateTokens, estimateTokensFromBytes } from "./tokens";
import { Model, ResolvedOptions } from "./types";

// ---------------------------------------------------------------------------
// fs helpers
// ---------------------------------------------------------------------------

export function isFile(p: string): boolean {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

export function isDir(p: string): boolean {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

export function exists(p: string): boolean {
  try {
    fs.statSync(p);
    return true;
  } catch {
    return false;
  }
}

export function readFileSafe(p: string): string {
  try {
    return fs.readFileSync(p, "utf8");
  } catch {
    return "";
  }
}

export function shortenPath(p: string, home: string): string {
  return p.startsWith(home) ? p.replace(home, "~") : p;
}

/** Readable path: project-relative inside the scan dir, ~ inside home, else absolute. */
export function displayPath(p: string, projectPath: string, home: string): string {
  if (p === projectPath) return ".";
  if (p.startsWith(projectPath + path.sep)) {
    return "./" + path.relative(projectPath, p);
  }
  if (p.startsWith(home)) return p.replace(home, "~");
  return p;
}

export function uniq<T>(items: T[]): T[] {
  return [...new Set(items)];
}

/** Best-effort read of the user's configured Claude model, for the cost estimate. */
export function detectModel(home: string): Model | null {
  for (const file of [
    path.join(home, ".claude", "settings.json"),
    path.join(home, ".claude.json"),
  ]) {
    if (!isFile(file)) continue;
    let json: unknown;
    try {
      json = JSON.parse(readFileSafe(file));
    } catch {
      continue;
    }
    const raw = (json as Record<string, unknown>)?.model;
    const value = typeof raw === "string" ? raw.toLowerCase() : "";
    if (value.includes("opus")) return "opus";
    if (value.includes("haiku")) return "haiku";
    if (value.includes("sonnet")) return "sonnet";
  }
  return null;
}

/** Recursively list files under `dir` whose name ends with one of `exts`. */
export function walkFiles(dir: string, exts: string[]): string[] {
  if (!isDir(dir)) return [];
  const out: string[] = [];
  const stack = [dir];
  while (stack.length && out.length < HEAVY_WALK_MAX_FILES) {
    const cur = stack.pop()!;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(cur, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      const full = path.join(cur, e.name);
      if (e.isDirectory()) {
        stack.push(full);
      } else if (e.isFile() && exts.some((x) => e.name.endsWith(x))) {
        out.push(full);
      }
    }
  }
  return out.sort();
}

// ---------------------------------------------------------------------------
// heavy paths + ignore files
// ---------------------------------------------------------------------------

export const HEAVY_DIRS = [
  // JS / web
  "node_modules", "dist", "build", "out", "coverage", "vendor",
  ".next", ".nuxt", ".svelte-kit", ".output", ".angular", ".turbo",
  ".parcel-cache", ".cache",
  // python
  ".venv", "venv", "__pycache__", ".pytest_cache", ".mypy_cache", ".ruff_cache",
  // rust / java / go / ios / infra
  "target", ".gradle", "Pods", ".terraform",
  // editor / misc
  ".idea", "tmp", "logs",
];

export const HEAVY_FILES = [
  "package-lock.json", "yarn.lock", "pnpm-lock.yaml", "bun.lockb", "deno.lock",
  "composer.lock", "Cargo.lock", "poetry.lock", "Pipfile.lock", "Gemfile.lock",
  "go.sum",
];

export const DEFAULT_IGNORE_PATTERNS = [
  "node_modules/", "dist/", "build/", "out/", "coverage/", "vendor/",
  ".next/", ".nuxt/", ".svelte-kit/", ".output/", ".turbo/", ".parcel-cache/", ".cache/",
  ".venv/", "venv/", "__pycache__/", ".pytest_cache/", ".mypy_cache/", ".ruff_cache/",
  "target/", ".gradle/", "Pods/", ".terraform/", ".idea/", "tmp/", "logs/",
  "*.lock", "package-lock.json", "yarn.lock", "pnpm-lock.yaml", "go.sum",
  "*.min.js", "*.min.css", "*.map", "*.log",
  ".env", ".env.*", ".DS_Store", ".git/",
];

export function parseIgnore(content: string): string[] {
  return content
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith("#"));
}

export function ignoreCovers(patterns: string[], name: string): boolean {
  const norm = patterns.map((p) => p.replace(/^\.\//, "").replace(/\/$/, ""));
  return norm.includes(name) || norm.includes("/" + name);
}

function walkBytes(dir: string): number {
  let bytes = 0;
  let files = 0;
  const stack = [dir];
  while (stack.length) {
    const cur = stack.pop()!;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(cur, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      const full = path.join(cur, e.name);
      if (e.isDirectory()) {
        stack.push(full);
      } else if (e.isFile()) {
        try {
          bytes += fs.statSync(full).size;
        } catch {
          /* ignore unreadable file */
        }
        files++;
      }
      if (files >= HEAVY_WALK_MAX_FILES || bytes >= HEAVY_WALK_MAX_BYTES) {
        return bytes;
      }
    }
  }
  return bytes;
}

/** Capped, bounded token estimate for a heavy dir or file that could be read. */
export function estimatePathTokens(p: string): number {
  let bytes = 0;
  if (isDir(p)) {
    bytes = walkBytes(p);
  } else {
    try {
      bytes = fs.statSync(p).size;
    } catch {
      bytes = 0;
    }
  }
  return Math.min(estimateTokensFromBytes(bytes), HEAVY_PATH_TOKEN_CAP);
}

// ---------------------------------------------------------------------------
// MCP servers (any JSON config exposing `mcpServers`)
// ---------------------------------------------------------------------------

export function readMcpServers(file: string): string[] {
  if (!isFile(file)) return [];
  let json: unknown;
  try {
    json = JSON.parse(readFileSafe(file));
  } catch {
    return []; // malformed JSON — skip rather than guess
  }
  const servers = (json as Record<string, unknown>)?.mcpServers;
  if (servers && typeof servers === "object") {
    return Object.keys(servers as Record<string, unknown>);
  }
  return [];
}

// ---------------------------------------------------------------------------
// Claude-specific definition inventory (agents / skills / commands)
// ---------------------------------------------------------------------------

const JUNK_RE = /(\.bak|\.orig|\.tmp|\.swp|~)$/i;
const JUNK_NAMES = new Set([".DS_Store", "Thumbs.db"]);

export interface DefRef {
  path: string;
  reason: string;
  tokens: number;
}

export interface DefInventory {
  /** HIGH-confidence, provably-dead artifacts (safe to archive). */
  dead: DefRef[];
  /** LOW-confidence real definitions (usage unconfirmed — review only). */
  real: DefRef[];
}

function dirTokens(dir: string): number {
  return estimateTokensFromBytes(walkBytes(dir));
}

export function scanDefinitions(o: ResolvedOptions): DefInventory {
  const dead: DefRef[] = [];
  const real: DefRef[] = [];
  const roots: Array<["agents" | "commands" | "skills", string]> = [
    ["agents", path.join(o.home, ".claude", "agents")],
    ["commands", path.join(o.home, ".claude", "commands")],
    ["skills", path.join(o.home, ".claude", "skills")],
  ];

  for (const [kind, root] of roots) {
    if (!isDir(root)) continue;
    if (kind === "skills") {
      scanSkillRoot(root, dead, real);
    } else {
      scanFlatRoot(root, dead, real);
    }
  }

  return { dead, real };
}

/** agents/ and commands/ hold .md definition files (possibly nested). */
function scanFlatRoot(root: string, dead: DefRef[], real: DefRef[]): void {
  const stack = [root];
  while (stack.length) {
    const cur = stack.pop()!;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(cur, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      const full = path.join(cur, e.name);
      if (e.isDirectory()) {
        stack.push(full);
        continue;
      }
      if (!e.isFile()) continue;
      classifyFile(full, e.name, dead, real);
    }
  }
}

/** skills/ holds one folder per skill, each requiring a SKILL.md. */
function scanSkillRoot(root: string, dead: DefRef[], real: DefRef[]): void {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    const full = path.join(root, e.name);
    if (e.isFile()) {
      classifyFile(full, e.name, dead, real);
      continue;
    }
    if (!e.isDirectory()) continue;
    const skillMd = path.join(full, "SKILL.md");
    if (!isFile(skillMd)) {
      dead.push({
        path: full,
        reason: "skill folder missing SKILL.md (cannot load)",
        tokens: dirTokens(full),
      });
      continue;
    }
    real.push({
      path: full,
      reason: "skill",
      tokens: estimateTokens(readFileSafe(skillMd)),
    });
  }
}

function classifyFile(
  full: string,
  name: string,
  dead: DefRef[],
  real: DefRef[]
): void {
  if (JUNK_NAMES.has(name) || JUNK_RE.test(name)) {
    dead.push({
      path: full,
      reason: "backup/temp artifact",
      tokens: estimateTokens(readFileSafe(full)),
    });
    return;
  }
  const content = readFileSafe(full);
  if (content.trim() === "") {
    dead.push({ path: full, reason: "empty definition file", tokens: 0 });
    return;
  }
  if (name.toLowerCase().endsWith(".md")) {
    real.push({ path: full, reason: "definition", tokens: estimateTokens(content) });
  }
}

export function archivePathFor(p: string, home: string): string {
  const base = path.join(home, ".claude");
  const rel = p.startsWith(base) ? path.relative(base, p) : path.basename(p);
  return path.join(home, ".claude", ".ctxdiet-archive", rel);
}
