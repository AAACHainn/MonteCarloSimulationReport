import { describe, expect, it } from "vitest";
import {
  calculateJournalStats,
  calculateSqn,
  calculateJournalTrade,
  getSqnAssessment,
  getSqnRating,
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
      sqn: -0.34874291623145787,
    });
  });

  it("calculates SQN with the sample standard deviation", () => {
    expect(calculateSqn([1, -1, -0.5, 2, -3])).toBeCloseTo(-0.3487429162);
  });

  it("caps only the SQN trade-count factor at 100", () => {
    const oneHundredTrades = Array.from({ length: 100 }, (_, index) => index % 2 === 0 ? 0 : 2);
    const twoHundredTrades = Array.from({ length: 200 }, (_, index) => index % 2 === 0 ? 0 : 2);

    expect(calculateSqn(oneHundredTrades)).toBeCloseTo(Math.sqrt(99));
    expect(calculateSqn(twoHundredTrades)).toBeCloseTo(10 * Math.sqrt(199 / 200));
  });

  it("returns null when SQN cannot be calculated", () => {
    expect(calculateSqn([])).toBeNull();
    expect(calculateSqn([1])).toBeNull();
    expect(calculateSqn([1, 1])).toBeNull();
  });

  it("uses the sample count to determine rating reliability", () => {
    expect(getSqnAssessment(3, 29)).toEqual({
      reliability: "INSUFFICIENT_SAMPLE",
      rating: null,
    });
    expect(getSqnAssessment(3, 30)).toEqual({
      reliability: "PRELIMINARY",
      rating: "EXCELLENT",
    });
    expect(getSqnAssessment(3, 99)).toEqual({
      reliability: "PRELIMINARY",
      rating: "EXCELLENT",
    });
    expect(getSqnAssessment(3, 100)).toEqual({
      reliability: "ESTABLISHED",
      rating: "EXCELLENT",
    });
  });

  it("uses continuous SQN rating boundaries", () => {
    expect(getSqnRating(1.59)).toBe("POOR");
    expect(getSqnRating(1.6)).toBe("BELOW_AVERAGE");
    expect(getSqnRating(2)).toBe("AVERAGE");
    expect(getSqnRating(2.5)).toBe("GOOD");
    expect(getSqnRating(3)).toBe("EXCELLENT");
    expect(getSqnRating(5)).toBe("EXCELLENT");
    expect(getSqnRating(5.01)).toBe("SUPERB");
    expect(getSqnRating(7)).toBe("RARE");
  });
});
