import { CHARS_PER_TOKEN } from "./constants";

/**
 * Estimate tokens with the documented chars/4 heuristic. This is an estimate,
 * not a real tokenizer — see README.
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

/** Same heuristic from a byte count (bytes ≈ chars for the text we read). */
export function estimateTokensFromBytes(bytes: number): number {
  return Math.ceil(bytes / CHARS_PER_TOKEN);
}
