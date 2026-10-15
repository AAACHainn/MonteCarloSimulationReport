export function sessionMetrics(trades: Array<{ grossPnl: number; fees: number; plannedRisk: number | null; status: string }>, entries: Array<{ review: string; setupOptionId: string | null; direction?: string; gainLoss?: number; initialRisk?: number; initialStopPrice?: number | null; setupOption?: { name: string } | null }>) {
  const closed = trades.filter((t) => t.status === "CLOSED");
  const values = closed.map((t) => t.grossPnl - t.fees);
  const validR = closed.filter((t) => t.plannedRisk !== null && t.plannedRisk > 0);
  let loss = 0, maxLoss = 0;
  for (const v of values) { loss = v < 0 ? loss + 1 : 0; maxLoss = Math.max(maxLoss, loss); }
  const groups = new Map<string, typeof entries>();
  for (const entry of entries) {
    const key = (entry.setupOption?.name ?? "未记录 Setup") + " / " + (entry.direction ?? "未知方向");
    groups.set(key, [...(groups.get(key) ?? []), entry]);
  }
  return {
    id: "metrics:session", unit: "CLOSED_PAPER_TRADE_NET_AFTER_FEES",
    journalRows: entries.length, reviewedRows: entries.filter((e) => e.review.trim()).length,
    missingSetupRows: entries.filter((e) => !e.setupOptionId).length,
    closedTrades: closed.length, openTrades: trades.length - closed.length,
    netPnl: values.reduce((a, b) => a + b, 0),
    winRatePercent: values.length ? values.filter((v) => v > 0).length / values.length * 100 : null,
    averageNetPnl: values.length ? values.reduce((a, b) => a + b, 0) / values.length : null,
    missingRiskTrades: closed.length - validR.length,
    meanPlannedRiskR: validR.length ? validR.reduce((sum, t) => sum + (t.grossPnl - t.fees) / t.plannedRisk!, 0) / validR.length : null,
    maxConsecutiveLosses: maxLoss, slippageAlreadyInFillPrices: true,
    journalGroups: [...groups].map(([label, rows], i) => ({
      id: "metrics:group:" + i, label, unit: "FIFO_ROW_PRICE_POINTS_BEFORE_FEES",
      count: rows.length, reviewed: rows.filter((r) => r.review.trim()).length,
      priceWinRatePercent: rows.length ? rows.filter((r) => (r.gainLoss ?? 0) > 0).length / rows.length * 100 : null,
      sumPricePoints: rows.reduce((sum, r) => sum + (r.gainLoss ?? 0), 0),
      netPnl: null, warning: "FIFO行组不提供未经可靠分摊的扣费净盈亏；Setup可能为事后填写。",
    })),
  };
}
