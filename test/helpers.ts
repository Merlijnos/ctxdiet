import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import type { ResolvedOptions } from "../src/types.js";

export function tmpdir(prefix = "ctxdiet-"): string {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
}

/** Write a file, creating parent directories. Path is relative to `root`. */
export function write(root: string, rel: string, content: string): string {
  const full = path.join(root, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content, "utf8");
  return full;
}

export function options(over: Partial<ResolvedOptions> = {}): ResolvedOptions {
  return {
    version: "0.0.0-test",
    path: tmpdir("ctxdiet-proj-"),
    home: tmpdir("ctxdiet-home-"),
    sessionsPerMonth: 100,
    model: "sonnet",
    modelDetected: false,
    maxTokens: null,
    failOn: null,
    usage: false,
    includeUnused: false,
    json: true,
    dryRun: false,
    yes: false,
    ...over,
  };
}
