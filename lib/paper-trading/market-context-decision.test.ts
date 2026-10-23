import { describe, expect, it } from "vitest";
import { MARKET_CONTEXTS } from "./training-gate";
import { MARKET_CONTEXT_DECISIONS, decisionStepForContext, previousDecisionStep, type MarketContextDecisionStep } from "./market-context-decision";

describe("market context binary decision", () => {
  it("offers exactly two choices at every step and reaches each final context once", () => {
    const reached: string[] = [];
    const visit = (step: MarketContextDecisionStep, depth: number) => {
      expect(depth).toBeLessThanOrEqual(3);
      const choices = MARKET_CONTEXT_DECISIONS[step];
      expect(choices).toHaveLength(2);
      for (const choice of choices) {
        if ("next" in choice) visit(choice.next, depth + 1);
        else reached.push(choice.context);
      }
    };
    visit("START", 1);
    expect(reached.sort()).toEqual([...MARKET_CONTEXTS].sort());
  });

  it("restores a final selection at its last decision and backs up one choice at a time", () => {
    expect(decisionStepForContext("STRONG_BREAKOUT")).toBe("BREAKOUT");
    expect(decisionStepForContext("WIDE_CHANNEL")).toBe("CHANNEL");
    expect(decisionStepForContext("NARROW_RANGE")).toBe("RANGE");
    expect(previousDecisionStep("BREAKOUT")).toBe("TREND");
    expect(previousDecisionStep("CHANNEL")).toBe("TREND");
    expect(previousDecisionStep("TREND")).toBe("START");
    expect(previousDecisionStep("RANGE")).toBe("START");
  });
});
