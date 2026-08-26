import assert from "node:assert/strict";
import { test } from "node:test";

import { parseFrontmatter } from "../src/frontmatter.js";

test("splits front matter from body", () => {
  const fm = parseFrontmatter("---\nname: rev\ndescription: Reviews code.\n---\n\nBody.\n");
  assert.equal(fm.fields["name"], "rev");
  assert.equal(fm.fields["description"], "Reviews code.");
  assert.equal(fm.body.trim(), "Body.");
  assert.equal(fm.block, "---\nname: rev\ndescription: Reviews code.\n---");
});

test("no front matter leaves the content as body", () => {
  const fm = parseFrontmatter("# Heading\nBody.\n");
  assert.equal(fm.block, "");
  assert.equal(fm.body, "# Heading\nBody.\n");
  assert.deepEqual(fm.fields, {});
});

test("an unterminated block is not front matter", () => {
  const fm = parseFrontmatter("---\nname: rev\nBody without a closing delimiter.\n");
  assert.equal(fm.block, "");
  assert.equal(fm.fields["name"], undefined);
});

test("strips surrounding quotes and lowercases keys", () => {
  const fm = parseFrontmatter('---\nName: "quoted value"\n---\nbody\n');
  assert.equal(fm.fields["name"], "quoted value");
});

test("a value containing a colon survives", () => {
  const fm = parseFrontmatter("---\ndescription: Use when: the user asks.\n---\nbody\n");
  assert.equal(fm.fields["description"], "Use when: the user asks.");
});
