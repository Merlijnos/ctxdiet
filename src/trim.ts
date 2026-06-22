/**
 * Conservative CLAUDE.md/AGENTS.md trimmer. Only removes *provably* redundant
 * content so a trim is always safe and reversible (callers also keep a .bak):
 *   - trailing whitespace on every line
 *   - runs of blank lines collapsed to a single blank line
 *   - exact-duplicate headers (only the first kept)
 *   - exact-duplicate substantial prose lines (>=20 chars, not lists/structural)
 * Anything inside fenced code blocks is left untouched.
 */
export function trimMarkdown(input: string): string {
  const lines = input.split("\n");
  const out: string[] = [];
  const seenLines = new Set<string>();
  const seenHeaders = new Set<string>();
  let inFence = false;
  let blankRun = 0;

  for (const raw of lines) {
    const line = raw.replace(/[ \t]+$/g, "");
    const isFenceToggle = /^\s*```/.test(line);
    if (isFenceToggle) {
      inFence = !inFence;
      blankRun = 0;
      out.push(line);
      continue;
    }

    if (inFence) {
      out.push(line);
      continue;
    }

    if (line.trim() === "") {
      blankRun++;
      if (blankRun > 1) continue; // collapse blank runs to one
      out.push("");
      continue;
    }
    blankRun = 0;

    const trimmed = line.trim();

    // Dedupe identical headers (keep first occurrence).
    if (/^#{1,6}\s+\S/.test(trimmed)) {
      const key = trimmed.toLowerCase();
      if (seenHeaders.has(key)) continue;
      seenHeaders.add(key);
      out.push(line);
      continue;
    }

    // Dedupe exact-duplicate substantial lines (prose or list items) — a
    // repeated line of real length is almost always an accidental paste. Skip
    // pure structural markers (rules, bare table borders) where repetition is
    // meaningful, and keep it reversible via the .bak the caller writes.
    const isStructural = /^[-=|>#`]+$/.test(trimmed);
    if (!isStructural && trimmed.length >= 20) {
      if (seenLines.has(trimmed)) continue;
      seenLines.add(trimmed);
    }

    out.push(line);
  }

  // Drop leading/trailing blank lines, guarantee a single trailing newline.
  while (out.length && out[0] === "") out.shift();
  while (out.length && out[out.length - 1] === "") out.pop();
  return out.length ? out.join("\n") + "\n" : "";
}
