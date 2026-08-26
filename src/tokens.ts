import { createRequire } from "node:module";

import { CHARS_PER_TOKEN } from "./constants.js";

// Real BPE tokenizer (gpt-tokenizer, pure-JS, offline) for accurate counts on
// text files. Loaded lazily so startup stays fast; falls back to chars/4 if it
// is ever unavailable. Note: no exact offline Claude tokenizer exists — the
// GPT-4 (cl100k) encoding is a close cross-model proxy, not a billing figure.
let encoder: ((s: string) => number) | null = null;
let encoderLoaded = false;

function loadEncoder(): ((s: string) => number) | null {
  if (encoderLoaded) return encoder;
  encoderLoaded = true;
  try {
    // Loaded through createRequire rather than a static import: the BPE ranks
    // table costs ~150ms to parse, and `--help`, `--version` and clean repos
    // should never pay for it.
    const req = createRequire(import.meta.url);
    const gpt = req("gpt-tokenizer") as { countTokens(s: string): number };
    encoder = (s: string) => gpt.countTokens(s);
  } catch {
    encoder = null;
  }
  return encoder;
}

/** Accurate token count for text; falls back to chars/4 if the tokenizer fails. */
export function estimateTokens(text: string): number {
  if (text.length === 0) return 0;
  const enc = loadEncoder();
  if (enc) {
    try {
      return enc(text);
    } catch {
      /* fall through to heuristic */
    }
  }
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

/**
 * Rough token estimate from a byte count, used for heavy directories we don't
 * read into memory (binary-ish, only ever an upper-bound). Stays chars/4.
 */
export function estimateTokensFromBytes(bytes: number): number {
  return Math.ceil(bytes / CHARS_PER_TOKEN);
}
