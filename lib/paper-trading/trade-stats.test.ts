import { describe, expect, it } from "vitest";
import { summarizeClosedTrades } from "./trade-stats";

describe("incremental paper trade stats", () => {
  it("tracks totals and resets streaks on flat trades", () => {
    expect(summarizeClosedTrades([10, 5, 0, -4, -6, -2, 8])).toEqual({
      closedTradeCount: 7,
      winningTradeCount: 3,
      losingTradeCount: 3,
      grossWinningPnl: 23,
      grossLosingPnl: 12,
      currentWinStreak: 1,
      currentLossStreak: 0,
      maxConsecutiveWins: 2,
      maxConsecutiveLosses: 3,
    });
  });
});
