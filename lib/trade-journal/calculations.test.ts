import { describe, expect, it } from "vitest";
import {
  calculateJournalStats,
  calculateJournalTrade,
  JournalTradeValidationError,
} from "./calculations";

describe("calculateJournalTrade", () => {
  it("calculates a profitable long trade", () => {
    expect(calculateJournalTrade({ entryPrice: 100, stopLossPrice: 90, targetPrice: 120, exitPrice: 115, riskAmount: 500 })).toEqual({
      direction: "LONG",
      rMultiple: 1.5,
      pnl: 750,
    });
  });

  it("calculates a losing short trade", () => {
    expect(calculateJournalTrade({ entryPrice: 100, stopLossPrice: 110, targetPrice: 80, exitPrice: 105, riskAmount: 1000 })).toEqual({
      direction: "SHORT",
      rMultiple: -0.5,
      pnl: -500,
    });
  });

  it("rejects a stop equal to entry", () => {
    expect(() => calculateJournalTrade({ entryPrice: 100, stopLossPrice: 100, targetPrice: 120, exitPrice: 115, riskAmount: 500 }))
      .toThrow(JournalTradeValidationError);
  });

  it("rejects a target on the losing side", () => {
    expect(() => calculateJournalTrade({ entryPrice: 100, stopLossPrice: 90, targetPrice: 80, exitPrice: 115, riskAmount: 500 }))
      .toThrow("目标价格必须位于交易方向的盈利侧。");
  });

  it("rejects an invalid risk amount", () => {
    expect(() => calculateJournalTrade({ entryPrice: 100, stopLossPrice: 90, targetPrice: 120, exitPrice: 115, riskAmount: 0 }))
      .toThrow("风险额必须大于 0。");
  });
});

describe("calculateJournalStats", () => {
  it("summarizes R multiples and losing streaks", () => {
    expect(calculateJournalStats([1, -1, -0.5, 2, -3])).toEqual({
      tradeCount: 5,
      winRate: 40,
      totalR: -1.5,
      averageR: -0.3,
      medianR: -0.5,
      maxLosingStreak: 2,
    });
  });
});
