import { Model } from "./types";

/** Input price in USD per million tokens. Estimates for cost projection only. */
export const PRICE_PER_MTOK: Record<Model, number> = {
  opus: 15,
  sonnet: 3,
  haiku: 0.8,
};

export function monthlyCost(
  tokensPerSession: number,
  sessionsPerMonth: number,
  model: Model
): number {
  return (tokensPerSession * sessionsPerMonth) / 1_000_000 * PRICE_PER_MTOK[model];
}
