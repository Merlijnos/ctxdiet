/**
 * Lexical near-duplicate detection + resolution for instruction files. Flags
 * pairs of rule lines whose wording overlaps heavily (reworded duplicates) and
 * lets the user resolve them. Offline, no ML: it catches paraphrases that share
 * vocabulary, not true synonyms ("use TS" vs "no JavaScript").
 */
export interface OverlapPair {
  a: string;
  b: string;
}

export type ResolveChoice = "a" | "b" | "merge" | "skip";

const WORD = /[a-z0-9]+/gi;

/** Strip list/quote markers and surrounding whitespace from a line. */
export function stripMarker(line: string): string {
  return line.replace(/^[\s>*+\-]+/, "").trim();
}

function wordSet(line: string): Set<string> {
  const matched = line.toLowerCase().match(WORD) ?? [];
  return new Set(matched.filter((w) => w.length > 2));
}

function jaccard(a: Set<string>, b: Set<string>): number {
  let intersection = 0;
  for (const w of a) if (b.has(w)) intersection++;
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/** Substantial instruction lines outside code fences. */
function ruleLines(text: string): string[] {
  const out: string[] = [];
  let inFence = false;
  for (const raw of text.split("\n")) {
    if (/^\s*```/.test(raw)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const line = stripMarker(raw);
    if (line.length >= 25 && /[a-z]/i.test(line) && !/^#{1,6}\s/.test(line)) {
      out.push(line);
    }
  }
  return out;
}

export function findOverlaps(text: string, threshold = 0.6): OverlapPair[] {
  const lines = ruleLines(text);
  const sets = lines.map(wordSet);
  const out: OverlapPair[] = [];
  const paired = new Set<number>();

  for (let i = 0; i < lines.length; i++) {
    if (paired.has(i) || sets[i].size < 4) continue;
    for (let j = i + 1; j < lines.length; j++) {
      if (paired.has(j) || sets[j].size < 4) continue;
      if (lines[i] === lines[j]) continue; // exact dups are the trimmer's job
      if (jaccard(sets[i], sets[j]) >= threshold) {
        out.push({ a: lines[i], b: lines[j] });
        paired.add(j);
        break;
      }
    }
  }
  return out;
}

/**
 * Apply a resolution to file content. Pure (no I/O) so it can be tested.
 * Locates the two rule lines by their stripped form; returns null if either is
 * gone (so the caller can skip safely). For "merge", `merged` replaces line A's
 * text (marker preserved) and line B is removed.
 */
export function applyOverlapResolution(
  content: string,
  a: string,
  b: string,
  choice: ResolveChoice,
  merged?: string
): string | null {
  if (choice === "skip") return content;

  const lines = content.split("\n");
  const idxA = lines.findIndex((l) => stripMarker(l) === a);
  const idxB = lines.findIndex((l, i) => i !== idxA && stripMarker(l) === b);
  if (idxA < 0 || idxB < 0) return null;

  if (choice === "a") {
    lines.splice(idxB, 1);
  } else if (choice === "b") {
    lines.splice(idxA, 1);
  } else if (choice === "merge") {
    const text = (merged ?? "").trim();
    if (text === "") return null;
    const marker = lines[idxA].slice(0, lines[idxA].length - stripMarker(lines[idxA]).length);
    lines[idxA] = marker + text;
    lines.splice(idxB, 1);
  }
  return lines.join("\n");
}
