import { average, median } from "@/lib/monte-carlo/stats";

export type JournalTradeInput = {
  entryPrice: number;
  stopLossPrice: number;
  targetPrice: number;
  exitPrice: number;
  riskAmount: number;
};

export type CalculatedJournalTrade = {
  direction: "LONG" | "SHORT";
  rMultiple: number;
  pnl: number;
};

export type JournalStats = {
  tradeCount: number;
  winRate: number;
  totalR: number;
  averageR: number;
  medianR: number;
  maxLosingStreak: number;
};

export class JournalTradeValidationError extends Error {}

export function calculateJournalTrade(input: JournalTradeInput): CalculatedJournalTrade {
  const values = [
    input.entryPrice,
    input.stopLossPrice,
    input.targetPrice,
    input.exitPrice,
    input.riskAmount,
  ];

  if (values.some((value) => !Number.isFinite(value))) {
    throw new JournalTradeValidationError("交易价格和风险额必须是有效数字。");
  }
  if (input.entryPrice <= 0 || input.stopLossPrice <= 0 || input.targetPrice <= 0 || input.exitPrice <= 0) {
    throw new JournalTradeValidationError("交易价格必须大于 0。");
  }
  if (input.riskAmount <= 0) {
    throw new JournalTradeValidationError("风险额必须大于 0。");
  }
  if (input.stopLossPrice === input.entryPrice) {
    throw new JournalTradeValidationError("止损价格不能等于入场价格。");
  }

  const isLong = input.stopLossPrice < input.entryPrice;
  if ((isLong && input.targetPrice <= input.entryPrice) || (!isLong && input.targetPrice >= input.entryPrice)) {
    throw new JournalTradeValidationError("目标价格必须位于交易方向的盈利侧。");
  }

  const riskDistance = Math.abs(input.entryPrice - input.stopLossPrice);
  const realizedDistance = isLong ? input.exitPrice - input.entryPrice : input.entryPrice - input.exitPrice;
  const rMultiple = realizedDistance / riskDistance;

  return {
    direction: isLong ? "LONG" : "SHORT",
    rMultiple,
    pnl: input.riskAmount * rMultiple,
  };
}

export function calculateJournalStats(rMultiples: number[]): JournalStats {
  let currentLosingStreak = 0;
  let maxLosingStreak = 0;

  for (const value of rMultiples) {
    if (value < 0) {
      currentLosingStreak += 1;
      maxLosingStreak = Math.max(maxLosingStreak, currentLosingStreak);
    } else {
      currentLosingStreak = 0;
    }
  }

  return {
    tradeCount: rMultiples.length,
    winRate: rMultiples.length === 0 ? 0 : (rMultiples.filter((value) => value > 0).length / rMultiples.length) * 100,
    totalR: rMultiples.reduce((sum, value) => sum + value, 0),
    averageR: average(rMultiples),
    medianR: median(rMultiples),
    maxLosingStreak,
  };
}
