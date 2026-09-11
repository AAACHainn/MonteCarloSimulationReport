export type IncrementalTradeStats = {
  closedTradeCount: number;
  winningTradeCount: number;
  losingTradeCount: number;
  grossWinningPnl: number;
  grossLosingPnl: number;
  currentWinStreak: number;
  currentLossStreak: number;
  maxConsecutiveWins: number;
  maxConsecutiveLosses: number;
};

export const EMPTY_TRADE_STATS: IncrementalTradeStats = {
  closedTradeCount: 0,
  winningTradeCount: 0,
  losingTradeCount: 0,
  grossWinningPnl: 0,
  grossLosingPnl: 0,
  currentWinStreak: 0,
  currentLossStreak: 0,
  maxConsecutiveWins: 0,
  maxConsecutiveLosses: 0,
};

export function recordClosedTrade(
  current: IncrementalTradeStats,
  netPnl: number,
): IncrementalTradeStats {
  const next = { ...current, closedTradeCount: current.closedTradeCount + 1 };
  if (netPnl > 0) {
    next.winningTradeCount += 1;
    next.grossWinningPnl += netPnl;
    next.currentWinStreak += 1;
    next.currentLossStreak = 0;
    next.maxConsecutiveWins = Math.max(next.maxConsecutiveWins, next.currentWinStreak);
  } else if (netPnl < 0) {
    next.losingTradeCount += 1;
    next.grossLosingPnl += Math.abs(netPnl);
    next.currentLossStreak += 1;
    next.currentWinStreak = 0;
    next.maxConsecutiveLosses = Math.max(next.maxConsecutiveLosses, next.currentLossStreak);
  } else {
    next.currentWinStreak = 0;
    next.currentLossStreak = 0;
  }
  return next;
}

export function summarizeClosedTrades(values: number[]) {
  return values.reduce(recordClosedTrade, EMPTY_TRADE_STATS);
}
