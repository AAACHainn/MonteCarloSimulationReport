import { describe, expect, it } from "vitest";
import {
  MAX_PAPER_ORDER_QUANTITY,
  calculateRiskSizing,
  orderTypeForEntry,
  targetPriceForR,
} from "./risk-sizing";

describe("paper trading fixed-risk sizing", () => {
  it.each([
    ["BUY", "LIMIT", 100, 95, 110],
    ["BUY", "STOP", 100, 95, 110],
    ["SELL", "LIMIT", 100, 105, 90],
    ["SELL", "STOP", 100, 105, 90],
  ] as const)("sizes a %s %s order", (side, type, entryPrice, stopLoss, takeProfit) => {
    const result = calculateRiskSizing({
      side, type, entryPrice, stopLoss, takeProfit, riskAmount: 100,
      commissionBps: 0, slippageBps: 0,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.quantity).toBeCloseTo(20);
    expect(result.value.projectedLoss).toBeCloseTo(100);
    expect(result.value.rewardRiskRatio).toBeCloseTo(2);
  });

  it("includes both commissions and adverse stop slippage", () => {
    const result = calculateRiskSizing({
      side: "BUY", type: "STOP", entryPrice: 100, stopLoss: 95, takeProfit: 110,
      riskAmount: 100, commissionBps: 10, slippageBps: 20,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.estimatedEntryFill).toBeCloseTo(100.2);
    expect(result.value.estimatedStopFill).toBeCloseTo(94.81);
    expect(result.value.unitRisk).toBeCloseTo(5.58501);
    expect(result.value.quantity).toBeCloseTo(100 / 5.58501);
    expect(result.value.projectedLoss).toBeCloseTo(100);
  });

  it("rejects a zero or wrong-side stop", () => {
    const zeroDistance = calculateRiskSizing({
      side: "BUY", type: "LIMIT", entryPrice: 100, stopLoss: 100,
      riskAmount: 100, commissionBps: 0, slippageBps: 0,
    });
    const wrongSide = calculateRiskSizing({
      side: "SELL", type: "STOP", entryPrice: 100, stopLoss: 99,
      riskAmount: 100, commissionBps: 0, slippageBps: 0,
    });
    expect(zeroDistance).toEqual({ ok: false, error: "INVALID_STOP_SIDE" });
    expect(wrongSide).toEqual({ ok: false, error: "INVALID_STOP_SIDE" });
  });

  it("rejects a target on the loss side", () => {
    expect(calculateRiskSizing({
      side: "BUY", type: "LIMIT", entryPrice: 100, stopLoss: 95, takeProfit: 99,
      riskAmount: 100, commissionBps: 0, slippageBps: 0,
    })).toEqual({ ok: false, error: "INVALID_TARGET_SIDE" });
  });

  it("rejects quantities over the safety limit", () => {
    const result = calculateRiskSizing({
      side: "BUY", type: "LIMIT", entryPrice: 100, stopLoss: 99.9999999999,
      riskAmount: MAX_PAPER_ORDER_QUANTITY, commissionBps: 0, slippageBps: 0,
    });
    expect(result).toEqual({ ok: false, error: "QUANTITY_LIMIT" });
  });

  it("derives the order type after an entry line crosses current price", () => {
    expect(orderTypeForEntry("BUY", 99, 100)).toBe("LIMIT");
    expect(orderTypeForEntry("BUY", 100, 100)).toBe("LIMIT");
    expect(orderTypeForEntry("SELL", 101, 100)).toBe("LIMIT");
    expect(orderTypeForEntry("SELL", 100, 100)).toBe("LIMIT");
    expect(orderTypeForEntry("SELL", 99, 100)).toBe("STOP");
  });

  it("creates geometric target prices from R", () => {
    expect(targetPriceForR("BUY", 100, 95, 2)).toBe(110);
    expect(targetPriceForR("SELL", 100, 105, 2)).toBe(90);
  });
});
