/**
 * Lexical near-duplicate detection for instruction files. Flags pairs of rule
 * lines whose wording overlaps heavily (reworded duplicates) so the user can
 * merge them — it does NOT remove anything. This is the honest, offline, no-ML
 * stand-in for "semantic dedup": it catches paraphrases that share vocabulary,
 * not true synonyms ("use TS" vs "no JavaScript"), which would need embeddings.
 */
export interface OverlapPair {
  a: string;
  b: string;
}

const WORD = /[a-z0-9]+/gi;

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

/** Substantial instruction lines outside code fences, stripped of list/quote markers. */
function ruleLines(text: string): string[] {
  const out: string[] = [];
  let inFence = false;
  for (const raw of text.split("\n")) {
    if (/^\s*```/.test(raw)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const line = raw.replace(/^[\s>*+\-]+/, "").trim();
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
