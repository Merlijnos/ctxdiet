import assert from "node:assert/strict";
import { test } from "node:test";

import { trimMarkdown } from "../src/trim.js";

test("collapses blank runs and strips trailing whitespace", () => {
  assert.equal(trimMarkdown("# A\n\n\n\nBody of the section here.   \n"), "# A\n\nBody of the section here.\n");
});

test("removes a line accidentally pasted twice in one section", () => {
  const input = "# Rules\n\nAlways write the minimum secure code.\nAlways write the minimum secure code.\n";
  assert.equal(trimMarkdown(input), "# Rules\n\nAlways write the minimum secure code.\n");
});

test("keeps a rule repeated under a different heading", () => {
  // Restating a rule in another section is deliberate emphasis, not a paste.
  const input =
    "## Testing\nRun the full suite before opening a pull request.\n\n" +
    "## Deployment\nRun the full suite before opening a pull request.\n";
  assert.equal(trimMarkdown(input), input.trimEnd() + "\n");
});

test("never orphans a section by dropping its heading", () => {
  const input =
    "## Testing\nAlpha content that is long enough to dedupe.\n\n" +
    "## Deploy\nBeta content that is long enough to dedupe.\n\n" +
    "## Testing\nGamma content that is long enough to dedupe.\n";
  const out = trimMarkdown(input);
  assert.equal(out.match(/^## Testing$/gm)?.length, 2, "both headings survive");
  assert.match(out, /Gamma content/);
});

test("drops a heading that is immediately repeated", () => {
  assert.equal(trimMarkdown("# Rules\n# Rules\nBody of the section here.\n"), "# Rules\nBody of the section here.\n");
});

test("leaves fenced code untouched", () => {
  const input = "# A\n\n```sh\nnpm run build --workspace packages\nnpm run build --workspace packages\n```\n";
  assert.equal(trimMarkdown(input), input);
});

test("leaves tilde fences and indented code untouched", () => {
  const tilde = "~~~\nduplicate line inside a tilde fence\nduplicate line inside a tilde fence\n~~~\n";
  assert.equal(trimMarkdown(tilde), tilde);
  const indented = "Setup:\n\n    a duplicated indented code line\n    a duplicated indented code line\n";
  assert.equal(trimMarkdown(indented), indented);
});

test("an unterminated fence protects the rest of the file", () => {
  const input = "# A\n\n```\nunterminated duplicate code line\nunterminated duplicate code line\n";
  assert.equal(trimMarkdown(input), input);
});

test("passes YAML front matter through untouched", () => {
  const input = "---\nname: rules\ndescription: Project rules\n---\n\nBody line that is long enough.\n";
  const out = trimMarkdown(input);
  assert.ok(out.startsWith("---\nname: rules\ndescription: Project rules\n---\n"));
});

test("keeps duplicate table rows", () => {
  const input = "| a long table cell value here | second |\n| a long table cell value here | second |\n";
  assert.equal(trimMarkdown(input), input);
});

test("is idempotent", () => {
  const input = "# A\n\n\nDuplicated prose line right here.\nDuplicated prose line right here.\n\n\n";
  const once = trimMarkdown(input);
  assert.equal(trimMarkdown(once), once);
});

test("empty input stays empty", () => {
  assert.equal(trimMarkdown(""), "");
  assert.equal(trimMarkdown("\n\n\n"), "");
});
