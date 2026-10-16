import { z } from "zod";
import { replayJournalResult } from "@/lib/paper-trading/journal";
export const statisticInputSchema = z.object({
  specVersion: z.literal("1"), currency: z.string().min(1).max(20), endSequence: z.number().int(),
  trades: z.array(z.object({ id: z.string(), status: z.enum(["CLOSED", "OPEN"]), closedSequence: z.number().int().nullable(), grossPnl: z.number().finite(), fees: z.number().finite(), plannedRisk: z.number().finite().nullable() }).strict()).max(10000),
}).strict();
export type StatisticInput = z.infer<typeof statisticInputSchema>;
export type StatisticRow = { logicalKey: string; direction: string; gainLoss: number; priceTickSize: number; setupOptionId: string | null; setupOption: { name: string } | null; review: string; disciplineStatus?: string; discipline?: unknown };
export const rowDirection = (r: StatisticRow) => ["LONG", "SHORT"].includes(r.direction) ? r.direction : "UNKNOWN";
export const rowDiscipline = (r: StatisticRow) => r.disciplineStatus ?? (r.discipline ? "PRESENT" : "NOT_RECORDED");
export function overallStatistics(raw: unknown, rows: StatisticRow[]) {
  const parsed = statisticInputSchema.safeParse(raw);
  if (!parsed.success) return null;
  const input = parsed.data;
  if (input.trades.some((t) => t.status === "CLOSED" && (t.closedSequence === null || t.closedSequence > input.endSequence))) return null;
  const closed = input.trades.filter((t) => t.status === "CLOSED").sort((a, b) => a.closedSequence! - b.closedSequence! || a.id.localeCompare(b.id));
  const net = closed.map((t) => t.grossPnl - t.fees), risks = closed.filter((t) => t.plannedRisk !== null && t.plannedRisk > 0);
  const netPnl = net.reduce((a, b) => a + b, 0);
  let streak = 0, maxStreak = 0;
  for (const v of net) { streak = v < 0 ? streak + 1 : 0; maxStreak = Math.max(maxStreak, streak); }
  const metrics = { netPnl, winRatePercent: closed.length ? net.filter((v) => v > 0).length / closed.length * 100 : null, averageNetPnl: closed.length ? netPnl / closed.length : null,
    meanPlannedRiskR: risks.length ? risks.reduce((sum, t) => sum + (t.grossPnl - t.fees) / t.plannedRisk!, 0) / risks.length : null, maxConsecutiveLosses: maxStreak };
  if (Object.values(metrics).some((v) => v !== null && !Number.isFinite(v))) return null;
  return { view: "overall", basis: { unit: "CLOSED_PAPER_TRADE_NET_AFTER_FEES", currency: input.currency, endSequence: input.endSequence, statisticSpecVersion: input.specVersion, feesIncluded: true, slippageAlreadyInFillPrices: true, sort: "closedSequence,id ASC" },
    coverage: { journalRows: rows.length, reviewedRows: rows.filter((r) => r.review.trim()).length, missingSetupRows: rows.filter((r) => !r.setupOptionId).length,
      closedTrades: closed.length, openTrades: input.trades.length - closed.length, validRiskTrades: risks.length, missingRiskTrades: closed.length - risks.length }, metrics,
    limitations: closed.length ? ["NET_SETUP_STATS_UNAVAILABLE"] : ["NO_CLOSED_TRADES", "NET_SETUP_STATS_UNAVAILABLE"] };
}
export function groupedStatistics(rows: StatisticRow[]) {
  const grouped = new Map<string, StatisticRow[]>();
  for (const r of rows) {
    if (!Number.isFinite(r.gainLoss) || !Number.isFinite(r.priceTickSize)) return null;
    const key = JSON.stringify([r.setupOptionId, rowDirection(r)]);
    const members = grouped.get(key) ?? []; members.push(r); grouped.set(key, members);
  }
  const groups = [...grouped].sort(([a], [b]) => a.localeCompare(b)).map(([key, members]) => ({ key, setupOptionId: members[0].setupOptionId, setupName: members[0].setupOption?.name ?? null, direction: rowDirection(members[0]),
    journalRows: members.length, reviewedRows: members.filter((r) => r.review.trim()).length, missingDisciplineRows: members.filter((r) => rowDiscipline(r) === "NOT_RECORDED").length,
    unavailableDisciplineRows: members.filter((r) => rowDiscipline(r) === "CORRUPT").length, priceWinRatePercent: members.filter((r) => replayJournalResult(r.gainLoss, r.priceTickSize) === "W").length / members.length * 100,
    sumPricePoints: members.reduce((n, r) => n + r.gainLoss, 0), netPnl: null, netWinRatePercent: null, meanPlannedRiskR: null, memberKeys: members.map((r) => r.logicalKey).sort(),
    limitations: { netPnl: "NET_SETUP_STATS_UNAVAILABLE", netWinRatePercent: "NET_SETUP_STATS_UNAVAILABLE", meanPlannedRiskR: "NET_SETUP_STATS_UNAVAILABLE" } }));
  return groups.every((g) => Number.isFinite(g.sumPricePoints)) ? groups : null;
}
