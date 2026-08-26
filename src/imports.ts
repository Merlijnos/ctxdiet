import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { MEMORY_IMPORT_MAX_DEPTH } from "./constants.js";

/**
 * Memory files pull in other files.
 *
 * Claude Code expands `@path/to/file` inside CLAUDE.md, and the imported file
 * may import further files. Every one of them lands in the context window at
 * session start, so a 400-token CLAUDE.md that imports four style guides is
 * not a 400-token setup. Scanning only the top-level file understated exactly
 * the setups most worth trimming.
 *
 * Matching the runtime: imports inside fenced code or inline backticks are not
 * expanded, `~` resolves against the home directory, relative paths resolve
 * against the importing file, and a cycle stops rather than recursing forever.
 */
const IMPORT = /(^|\s)@((?:[~./][^\s`]*)|(?:[A-Za-z0-9_.-]+\/[^\s`]*))/g;

export interface ImportedFile {
  path: string;
  /** Import depth: 1 for a file named directly by the memory file. */
  depth: number;
}

/** Import specifiers named by `content`, in source order. */
export function parseImports(content: string): string[] {
  const out: string[] = [];
  let fence: string | null = null;

  for (const raw of content.split("\n")) {
    const fenceMatch = /^\s{0,3}(`{3,}|~{3,})/.exec(raw);
    if (fence !== null) {
      if (fenceMatch && (fenceMatch[1] ?? "").startsWith(fence)) fence = null;
      continue;
    }
    if (fenceMatch) {
      fence = fenceMatch[1] ?? "```";
      continue;
    }
    // Drop inline code spans before looking for imports.
    const line = raw.replace(/`[^`]*`/g, "");
    for (const m of line.matchAll(IMPORT)) {
      const spec = m[2];
      if (spec !== undefined) out.push(spec);
    }
  }
  return out;
}

function resolveImport(spec: string, fromFile: string, home: string): string | null {
  let target = spec;
  if (target.startsWith("~")) {
    target = path.join(home, target.slice(1));
  } else if (!path.isAbsolute(target)) {
    target = path.resolve(path.dirname(fromFile), target);
  }
  try {
    return fs.statSync(target).isFile() ? target : null;
  } catch {
    return null;
  }
}

/**
 * Every file transitively imported by `entry`, deduplicated and cycle-safe.
 * `entry` itself is not included.
 */
export function resolveImports(
  entry: string,
  readFile: (p: string) => string,
  home: string = os.homedir()
): ImportedFile[] {
  const seen = new Set<string>([entry]);
  const found: ImportedFile[] = [];
  let frontier: Array<{ file: string; depth: number }> = [{ file: entry, depth: 0 }];

  while (frontier.length > 0) {
    const next: Array<{ file: string; depth: number }> = [];
    for (const { file, depth } of frontier) {
      if (depth >= MEMORY_IMPORT_MAX_DEPTH) continue;
      for (const spec of parseImports(readFile(file))) {
        const resolved = resolveImport(spec, file, home);
        if (resolved === null || seen.has(resolved)) continue;
        seen.add(resolved);
        found.push({ path: resolved, depth: depth + 1 });
        next.push({ file: resolved, depth: depth + 1 });
      }
    }
    frontier = next;
  }
  return found;
}
