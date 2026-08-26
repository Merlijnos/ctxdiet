import { parseFrontmatter } from "./frontmatter.js";

/**
 * Conservative CLAUDE.md/AGENTS.md trimmer.
 *
 * The bar is that a trim can never change what the file *means*. It removes:
 *   - trailing whitespace on every line
 *   - runs of blank lines collapsed to a single blank line
 *   - duplicate headers that introduce nothing (an immediately repeated heading)
 *   - repeated substantial lines *within one section*
 *
 * Left alone: YAML front matter, fenced code blocks, indented code blocks, and
 * anything that only repeats across different sections. A rule restated under
 * a different heading is usually deliberate emphasis, not an accidental paste.
 */

const FENCE = /^\s{0,3}(`{3,}|~{3,})/;
const HEADING = /^#{1,6}\s+\S/;
const SETEXT = /^\s{0,3}(={2,}|-{2,})\s*$/;
const INDENTED_CODE = /^(?: {4}|\t)/;
const STRUCTURAL = /^[-=|>#`*_+\s]+$/;

/** Repeats shorter than this are usually structure, not redundancy. */
const MIN_DEDUPE_LENGTH = 20;

export function trimMarkdown(input: string): string {
  // Front matter is machine-read; never touch it.
  const { block, body } = parseFrontmatter(input);
  const trimmedBody = trimBody(body);
  if (block === "") return trimmedBody;
  return trimmedBody === "" ? block + "\n" : `${block}\n\n${trimmedBody}`;
}

function trimBody(input: string): string {
  const lines = input.split("\n");
  const out: string[] = [];
  /** Reset per section: a repeat only counts as redundant within one heading. */
  let seenInSection = new Set<string>();
  let fence: string | null = null;
  let blankRun = 0;

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i] ?? "";
    const line = raw.replace(/[ \t]+$/g, "");

    // --- fenced code: copy verbatim, including blank lines ---
    const fenceMatch = FENCE.exec(line);
    if (fence !== null) {
      out.push(line);
      if (fenceMatch && (fenceMatch[1] ?? "").startsWith(fence)) fence = null;
      continue;
    }
    if (fenceMatch) {
      fence = fenceMatch[1] ?? "```";
      blankRun = 0;
      out.push(line);
      continue;
    }

    if (line.trim() === "") {
      blankRun++;
      if (blankRun > 1) continue;
      out.push("");
      continue;
    }
    blankRun = 0;

    // --- indented code: never deduplicated ---
    if (INDENTED_CODE.test(line)) {
      out.push(line);
      continue;
    }

    const trimmed = line.trim();

    if (HEADING.test(trimmed)) {
      // Only drop a repeated heading when it introduces nothing. Otherwise
      // removing it silently reparents that section's content under the
      // previous heading, which changes what the file says.
      const previous = lastContentLine(out);
      if (previous !== null && previous.trim().toLowerCase() === trimmed.toLowerCase()) {
        continue;
      }
      seenInSection = new Set();
      out.push(line);
      continue;
    }

    // A setext underline turns the line above it into a heading; treat the
    // pair as a section break too.
    if (SETEXT.test(line) && lastContentLine(out) !== null) {
      seenInSection = new Set();
      out.push(line);
      continue;
    }

    // Table rows are data: two identical rows are a legitimate table, not a
    // stray paste.
    const isTableRow = trimmed.startsWith("|");
    if (!isTableRow && !STRUCTURAL.test(trimmed) && trimmed.length >= MIN_DEDUPE_LENGTH) {
      if (seenInSection.has(trimmed)) continue;
      seenInSection.add(trimmed);
    }

    out.push(line);
  }

  while (out.length && out[0] === "") out.shift();
  while (out.length && out[out.length - 1] === "") out.pop();
  return out.length ? out.join("\n") + "\n" : "";
}

/** Last non-blank line already emitted, or null. */
function lastContentLine(out: string[]): string | null {
  for (let i = out.length - 1; i >= 0; i--) {
    const l = out[i] ?? "";
    if (l.trim() !== "") return l;
  }
  return null;
}
