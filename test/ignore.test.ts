import assert from "node:assert/strict";
import { test } from "node:test";

import { covers, isIgnored, parseIgnoreRules } from "../src/ignore.js";

const rules = (s: string) => parseIgnoreRules(s);

test("recognises every spelling of an ignored directory", () => {
  for (const pattern of [
    "node_modules",
    "node_modules/",
    "/node_modules",
    "node_modules/*",
    "node_modules/**",
    "**/node_modules",
    "**/node_modules/**",
  ]) {
    assert.equal(covers(rules(pattern), "node_modules", true), true, pattern);
  }
});

test("does not claim coverage it does not have", () => {
  assert.equal(covers(rules("dist/"), "node_modules", true), false);
  assert.equal(covers(rules("node_modules_old"), "node_modules", true), false);
  assert.equal(covers(rules(""), "node_modules", true), false);
});

test("ignores comments and blank lines", () => {
  assert.equal(covers(rules("# node_modules\n\n"), "node_modules", true), false);
  assert.equal(covers(rules("# a comment\ndist/\n"), "dist", true), true);
});

test("a trailing slash restricts the rule to directories", () => {
  assert.equal(isIgnored(rules("build/"), "build", true), true);
  assert.equal(isIgnored(rules("build/"), "build", false), false);
  assert.equal(isIgnored(rules("build"), "build", false), true);
});

test("an unanchored pattern matches at any depth; a leading slash anchors", () => {
  assert.equal(isIgnored(rules("logs"), "src/logs", true), true);
  assert.equal(isIgnored(rules("/logs"), "src/logs", true), false);
  assert.equal(isIgnored(rules("/logs"), "logs", true), true);
});

test("an embedded slash anchors the pattern", () => {
  assert.equal(isIgnored(rules("src/logs"), "src/logs", true), true);
  assert.equal(isIgnored(rules("src/logs"), "a/src/logs", true), false);
});

test("wildcards do not cross directory separators", () => {
  assert.equal(isIgnored(rules("*.lock"), "Cargo.lock", false), true);
  assert.equal(isIgnored(rules("*.lock"), "sub/Cargo.lock", false), true);
  assert.equal(isIgnored(rules("*.log"), "package-lock.json", false), false);
  assert.equal(isIgnored(rules("a/*.lock"), "a/b/c.lock", false), false);
});

test("? matches a single character", () => {
  assert.equal(isIgnored(rules("file?.md"), "file1.md", false), true);
  assert.equal(isIgnored(rules("file?.md"), "file10.md", false), false);
});

test("negation re-includes, last match winning", () => {
  const r = rules("logs/\n!logs/keep\n");
  assert.equal(isIgnored(r, "logs", true), true);
  assert.equal(isIgnored(r, "logs/keep", true), false);
  // Order matters: a later broad rule wins over an earlier negation.
  assert.equal(isIgnored(rules("!logs/keep\nlogs/\n"), "logs/keep", true), true);
});

test("ignoring a directory ignores what is inside it", () => {
  assert.equal(isIgnored(rules("dist/"), "dist/assets/app.js", false), true);
});

test("regex metacharacters in a pattern are literal", () => {
  assert.equal(isIgnored(rules("a+b.txt"), "a+b.txt", false), true);
  assert.equal(isIgnored(rules("a+b.txt"), "aab.txt", false), false);
});

test("trailing whitespace is not part of the pattern", () => {
  assert.equal(isIgnored(rules("dist   "), "dist", true), true);
});
