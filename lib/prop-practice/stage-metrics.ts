/** Presentation statistics only; never used by matching, sizing or failure rules. */
export type StageMetrics = {
  realizedAnchor: number;
  feeAnchor: number;
  realizedPnl: number;
  totalFees: number;
  peakEquity: number;
  maxDrawdown: number;
};

export function initialStageMetrics(initialCapital: number, realizedAnchor = 0, feeAnchor = 0): StageMetrics {
  return { realizedAnchor, feeAnchor, realizedPnl: 0, totalFees: 0, peakEquity: initialCapital, maxDrawdown: 0 };
}

export function observeStageMetrics(before: StageMetrics, realizedPnl: number, totalFees: number, equity: number): StageMetrics {
  const peakEquity = Math.max(before.peakEquity, equity);
  const drawdown = peakEquity > 0 ? Math.max(0, (peakEquity - equity) / peakEquity) : 0;
  return { ...before, realizedPnl: realizedPnl - before.realizedAnchor, totalFees: totalFees - before.feeAnchor,
    peakEquity, maxDrawdown: Math.max(before.maxDrawdown, drawdown) };
}

export type MetricFill = { side: string; price: number; quantity: number; fee: number; realizedPnl: number; immediate: boolean };
export type MetricReplay = { metrics: StageMetrics; cash: number; quantity: number };

/** Reconstruct statistics from recorded executions, not by rerunning matching.
 * A source candle is observed once after its ordinary fills, then after any
 * current-price closes. Those reduce-only closes only add fees/slippage, so
 * their final result also captures the largest drawdown at that candle.
 */
export function replayMetricClose(before: MetricReplay, initialCapital: number, close: number, fills: MetricFill[]): MetricReplay {
  let { metrics, cash, quantity } = before;
  let realized = metrics.realizedAnchor + metrics.realizedPnl, fees = metrics.feeAnchor + metrics.totalFees;
  for (const immediate of [false, true]) {
    for (const fill of fills) {
      if (fill.immediate !== immediate) continue;
      const signed = (fill.side === "BUY" ? 1 : -1) * fill.quantity;
      cash -= signed * fill.price; quantity += signed;
      realized += fill.realizedPnl; fees += fill.fee;
    }
    const equity = initialCapital + cash + quantity * close - (fees - metrics.feeAnchor);
    metrics = observeStageMetrics(metrics, realized, fees, equity);
  }
  return { metrics, cash, quantity };
}
