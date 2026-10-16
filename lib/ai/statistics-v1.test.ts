import { describe, expect, it } from "vitest";
import { groupedStatistics, overallStatistics, type StatisticInput, type StatisticRow } from "./statistics-v1";
const row = (key: string, setup: string | null = null, name = "同名 Setup", gainLoss = 1): StatisticRow => ({ logicalKey: key, direction: "LONG", gainLoss, priceTickSize: 1, setupOptionId: setup, setupOption: setup ? { name } : null, review: "", discipline: null });
describe("C: statistics formula version 1", () => {
  const input: StatisticInput = { specVersion: "1", currency: "CNY", endSequence: 100, trades: [
    { id: "c", status: "CLOSED", closedSequence: 3, grossPnl: 1, fees: 1, plannedRisk: null },
    { id: "a", status: "CLOSED", closedSequence: 1, grossPnl: 10, fees: 2, plannedRisk: 4 },
    { id: "b", status: "CLOSED", closedSequence: 2, grossPnl: -3, fees: 1, plannedRisk: 0 },
    { id: "d", status: "OPEN", closedSequence: null, grossPnl: 100, fees: 50, plannedRisk: 1 },
  ] };
  it("recomputes +8/-4/0, deducts fees once, excludes open positions and preserves the risk denominator", () => {
    const result = overallStatistics(input, [row("1"), row("2"), row("3"), row("4")])!;
    expect(result.basis.currency).toBe("CNY");
    expect(result.coverage).toMatchObject({ journalRows: 4, closedTrades: 3, openTrades: 1, validRiskTrades: 1, missingRiskTrades: 2 });
    expect(result.metrics).toEqual({ netPnl: 4, winRatePercent: 1 / 3 * 100, averageNetPnl: 4 / 3, meanPlannedRiskR: 2, maxConsecutiveLosses: 1 });
  });
  it("uses null for empty denominators and refuses missing currency, nonfinite values or future contributions", () => {
    expect(overallStatistics({ ...input, trades: [] }, [])!.metrics).toMatchObject({ netPnl: 0, winRatePercent: null, averageNetPnl: null, meanPlannedRiskR: null, maxConsecutiveLosses: 0 });
    expect(overallStatistics({ ...input, currency: "" }, [])).toBeNull();
    expect(overallStatistics({ ...input, trades: [{ ...input.trades[0], fees: Infinity }] }, [])).toBeNull();
    expect(overallStatistics({ ...input, endSequence: 1 }, [])).toBeNull();
  });
  it("keeps identical Setup names separate, uses journal tolerance and includes missing/corrupt discipline", () => {
    const rows = [row("1", "a", undefined, 1e-10), row("2", "b", undefined, -1), { ...row("3", "a"), disciplineStatus: "CORRUPT", review: "记录" }, row("4")];
    const groups = groupedStatistics(rows)!;
    expect(groups).toHaveLength(3);
    expect(groups.reduce((sum, g) => sum + g.journalRows, 0)).toBe(4);
    expect(groups.find((g) => g.setupOptionId === "a")).toMatchObject({ journalRows: 2, priceWinRatePercent: 50, reviewedRows: 1, missingDisciplineRows: 1, unavailableDisciplineRows: 1, netPnl: null });
    expect(groupedStatistics([{ ...row("1"), direction: "BROKEN" }])![0].direction).toBe("UNKNOWN");
  });
});
