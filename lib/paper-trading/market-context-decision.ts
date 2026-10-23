import type { MarketContext } from "./training-gate";

export type MarketContextDecisionStep = "START" | "TREND" | "RANGE" | "BREAKOUT" | "CHANNEL";
export type MarketContextDecisionChoice = { next: Exclude<MarketContextDecisionStep, "START"> } | { context: MarketContext };

export const MARKET_CONTEXT_DECISIONS: Record<MarketContextDecisionStep, readonly [MarketContextDecisionChoice, MarketContextDecisionChoice]> = {
  START: [{ next: "TREND" }, { next: "RANGE" }],
  TREND: [{ next: "BREAKOUT" }, { next: "CHANNEL" }],
  RANGE: [{ context: "NARROW_RANGE" }, { context: "WIDE_RANGE" }],
  BREAKOUT: [{ context: "STRONG_BREAKOUT" }, { context: "WEAK_BREAKOUT" }],
  CHANNEL: [{ context: "NARROW_CHANNEL" }, { context: "WIDE_CHANNEL" }],
};

export function decisionStepForContext(context: MarketContext): MarketContextDecisionStep {
  if (context === "NARROW_RANGE" || context === "WIDE_RANGE") return "RANGE";
  if (context === "STRONG_BREAKOUT" || context === "WEAK_BREAKOUT") return "BREAKOUT";
  return "CHANNEL";
}

export function previousDecisionStep(step: MarketContextDecisionStep): MarketContextDecisionStep {
  if (step === "BREAKOUT" || step === "CHANNEL") return "TREND";
  return "START";
}
