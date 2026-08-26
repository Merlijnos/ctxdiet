import assert from "node:assert/strict";
import { test } from "node:test";

import { applyOverlapResolution, findOverlaps, stripMarker } from "../src/overlap.js";

const A = "Always run the linter before you commit any change to the repo.";
const B = "Always run the linter before committing any change to this repo.";

test("flags reworded duplicates and ignores unrelated rules", () => {
  const pairs = findOverlaps(`- ${A}\n- ${B}\n- Deploy from the main branch only after review.\n`);
  assert.equal(pairs.length, 1);
  assert.deepEqual([pairs[0]?.a, pairs[0]?.b], [A, B]);
});

test("exact duplicates are left to the trimmer", () => {
  assert.deepEqual(findOverlaps(`- ${A}\n- ${A}\n`), []);
});

test("code fences and headings are not rules", () => {
  assert.deepEqual(findOverlaps("```\n" + A + "\n" + B + "\n```\n"), []);
  assert.deepEqual(findOverlaps(`## ${A}\n## ${B}\n`), []);
});

test("keeping A removes B and preserves list markers", () => {
  const content = `# Rules\n- ${A}\n- ${B}\n`;
  assert.equal(applyOverlapResolution(content, A, B, "a"), `# Rules\n- ${A}\n`);
});

test("keeping B removes A", () => {
  const content = `# Rules\n- ${A}\n- ${B}\n`;
  assert.equal(applyOverlapResolution(content, A, B, "b"), `# Rules\n- ${B}\n`);
});

test("merging replaces A in place and drops B", () => {
  const content = `# Rules\n- ${A}\n- ${B}\n`;
  assert.equal(applyOverlapResolution(content, A, B, "merge", "Run the linter before committing."), "# Rules\n- Run the linter before committing.\n");
});

test("skip is a no-op and an empty merge is refused", () => {
  const content = `- ${A}\n- ${B}\n`;
  assert.equal(applyOverlapResolution(content, A, B, "skip"), content);
  assert.equal(applyOverlapResolution(content, A, B, "merge", "   "), null);
});

test("returns null when a line has moved on since the scan", () => {
  assert.equal(applyOverlapResolution(`- ${A}\n`, A, B, "a"), null);
});

test("stripMarker removes list and quote markers", () => {
  assert.equal(stripMarker("  - > * item"), "item");
  assert.equal(stripMarker("plain"), "plain");
});
