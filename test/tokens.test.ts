import assert from "node:assert/strict";
import { test } from "node:test";

import { grade, gradeRank } from "../src/constants.js";
import { monthlyCost } from "../src/pricing.js";
import { estimateTokens, estimateTokensFromBytes } from "../src/tokens.js";

test("token counts are proportional and beat a naive chars/4", () => {
  assert.equal(estimateTokens(""), 0);
  const short = estimateTokens("hello world");
  const long = estimateTokens("hello world ".repeat(100));
  assert.ok(short > 0 && long > short * 50);
});

test("counts are stable across calls", () => {
  const text = "# Rules\n\nAlways write the minimum secure code that solves the task.\n";
  assert.equal(estimateTokens(text), estimateTokens(text));
});

test("byte estimates stay on the documented heuristic", () => {
  assert.equal(estimateTokensFromBytes(4000), 1000);
  assert.equal(estimateTokensFromBytes(0), 0);
});

test("grades follow the documented thresholds", () => {
  assert.equal(grade(0), "A");
  assert.equal(grade(499), "A");
  assert.equal(grade(500), "B");
  assert.equal(grade(4999), "C");
  assert.equal(grade(10_000), "F");
});

test("grade ranking orders A best to F worst", () => {
  assert.ok(gradeRank("A") < gradeRank("C"));
  assert.ok(gradeRank("C") < gradeRank("F"));
});

test("cost scales with tokens, sessions and model", () => {
  assert.equal(monthlyCost(1_000_000, 1, "sonnet"), 3);
  assert.equal(monthlyCost(1_000_000, 2, "sonnet"), 6);
  assert.ok(monthlyCost(1_000_000, 1, "opus") > monthlyCost(1_000_000, 1, "haiku"));
  assert.equal(monthlyCost(0, 100, "opus"), 0);
});

test("window share is expressed against the model's context window", async () => {
  const { windowShare } = await import("../src/report.js");
  assert.equal(windowShare(20_000, "sonnet"), "10% of a 200k window");
  assert.equal(windowShare(2_000, "sonnet"), "1.0% of a 200k window");
  assert.equal(windowShare(0, "sonnet"), "0.0% of a 200k window");
  // An unknown model must not produce NaN in the headline.
  assert.equal(windowShare(20_000, "unknown"), "10% of a 200k window");
});
