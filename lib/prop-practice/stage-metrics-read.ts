import type { Prisma } from "@prisma/client";
import type { PropState } from "./rules";
import { initialStageMetrics, replayMetricClose, type MetricFill, type MetricReplay } from "./stage-metrics";

/** Read-only compatibility for accounts created before per-stage display stats.
 * New states maintain metrics as completed original results are observed.
 * Do not infer drawdown from sparse equity samples or reset original totals.
 */
export async function hydrateStageMetrics(db: Prisma.TransactionClient, sessionId: string, datasetId: string, state: PropState): Promise<PropState> {
  const stage = state.stages.at(-1)!;
  if (stage.metrics) return state;
  const account = await db.paperTradingSession.findUniqueOrThrow({ where: { id: sessionId } });
  const anchors = await db.paperFill.aggregate({ where: { sessionId, sequence: { lt: stage.startSequence } }, _sum: { realizedPnl: true, fee: true } });
  let replay: MetricReplay = { metrics: initialStageMetrics(stage.initialCapital, anchors._sum.realizedPnl ?? 0, anchors._sum.fee ?? 0), cash: 0, quantity: 0 };
  const end = Math.min(stage.endSequence ?? account.lastProcessedSequence, account.lastProcessedSequence);
  for (let from = stage.startSequence; from <= end; from += 4096) {
    const to = Math.min(end, from + 4095), sequence = { gte: from, lte: to };
    const [bars, fills] = await Promise.all([
      db.marketBar.findMany({ where: { datasetId, sequence }, orderBy: { sequence: "asc" }, select: { sequence: true, close: true } }),
      db.paperFill.findMany({ where: { sessionId, sequence }, select: { sequence: true, side: true, price: true, quantity: true, fee: true, realizedPnl: true,
        order: { select: { isProtective: true, createdSequence: true, activeFromSequence: true } } } }),
    ]);
    const bySequence = new Map<number, MetricFill[]>();
    for (const fill of fills) {
      const items = bySequence.get(fill.sequence) ?? [];
      items.push({ ...fill, immediate: !fill.order.isProtective && fill.order.createdSequence === fill.sequence && fill.order.activeFromSequence === fill.sequence });
      bySequence.set(fill.sequence, items);
    }
    for (const bar of bars) replay = replayMetricClose(replay, stage.initialCapital, bar.close, bySequence.get(bar.sequence) ?? []);
  }
  return { ...state, stages: [...state.stages.slice(0, -1), { ...stage, metrics: replay.metrics }],
    last: state.last ? { ...state.last, realizedPnl: account.realizedPnl, totalFees: account.totalFees } : null };
}
