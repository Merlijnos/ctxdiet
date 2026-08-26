import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { parseImports, resolveImports } from "../src/imports.js";
import { tmpdir, write } from "./helpers.js";

const read = (p: string) => fs.readFileSync(p, "utf8");

test("finds imports and skips code", () => {
  const content =
    "See @docs/style.md and @./local.md and @~/global.md.\n" +
    "Not `@inline/code.md`.\n" +
    "```\n@fenced/file.md\n```\n" +
    "user@example.com is not an import\n";
  assert.deepEqual(parseImports(content), ["docs/style.md", "./local.md", "~/global.md"]);
});

test("resolves relative, home and nested imports", () => {
  const root = tmpdir();
  const home = tmpdir();
  const entry = write(root, "CLAUDE.md", "@docs/style.md and @~/global.md\n");
  write(root, "docs/style.md", "@./deep.md\n");
  write(root, "docs/deep.md", "leaf\n");
  write(home, "global.md", "leaf\n");

  const found = resolveImports(entry, read, home).map((f) => f.path).sort();
  assert.deepEqual(found, [
    path.join(home, "global.md"),
    path.join(root, "docs/deep.md"),
    path.join(root, "docs/style.md"),
  ].sort());
});

test("reports depth and never returns the entry itself", () => {
  const root = tmpdir();
  const entry = write(root, "CLAUDE.md", "@a.md\n");
  write(root, "a.md", "@b.md\n");
  write(root, "b.md", "leaf\n");
  const found = resolveImports(entry, read, root);
  assert.deepEqual(
    found.map((f) => [path.basename(f.path), f.depth]),
    [["a.md", 1], ["b.md", 2]]
  );
});

test("a cycle terminates", () => {
  const root = tmpdir();
  const entry = write(root, "CLAUDE.md", "@a.md\n");
  write(root, "a.md", "@CLAUDE.md\n@b.md\n");
  write(root, "b.md", "@a.md\n");
  const found = resolveImports(entry, read, root).map((f) => path.basename(f.path));
  assert.deepEqual(found.sort(), ["a.md", "b.md"]);
});

test("missing and non-file targets are skipped", () => {
  const root = tmpdir();
  fs.mkdirSync(path.join(root, "adir"));
  const entry = write(root, "CLAUDE.md", "@nope.md\n@adir\n");
  assert.deepEqual(resolveImports(entry, read, root), []);
});
