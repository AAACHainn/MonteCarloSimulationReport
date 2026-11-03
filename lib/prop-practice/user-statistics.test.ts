import { describe, expect, it } from "vitest";
import { buildUserPropStatistics, netMinor, type RoundSource, type WalletSource } from "./user-statistics";

const date = (day: number) => new Date(Date.UTC(2026, 0, day));
function round(session: string, number: number, phase: string, result: string | null, day: number): RoundSource {
  return {
    replaySessionId: session, number, createdAt: date(day), endedAt: result ? date(day + 1) : null,
    state: JSON.stringify({ phase, result }), account: { replaySession: { name: session, status: "ACTIVE" } },
  };
}
function entry(sessionId: string, roundNumber: number, type: string, amount: number, day: number): WalletSource {
  return { sessionId, roundNumber, type, amountMinor: BigInt(amount), createdAt: date(day), sessionName: sessionId };
}

describe("user prop statistics", () => {
  it("includes active and ended rounds in fee return and matches fees to the right round", () => {
    const result = buildUserPropStatistics([
      round("a", 1, "FUNDED", "FAILED", 1), round("a", 2, "FUNDED", null, 5),
    ], [
      entry("a", 2, "PAYOUT", 46000, 8), entry("a", 2, "PURCHASE", -15000, 5),
      entry("a", 1, "PAYOUT", 120000, 4), entry("a", 1, "ACTIVATION", -10000, 3),
      entry("a", 1, "PURCHASE", -15000, 2),
    ], []);
    expect(result.rows.map(row => [row.number, row.evaluation, row.status])).toEqual([[2, "passed", "active"], [1, "passed", "fundedFailed"]]);
    expect(result.rows[1].purchaseAt).toEqual(date(2));
    expect(netMinor(result.rows[1])).toBe(BigInt(95000));
    expect(result.totals).toMatchObject({ net: BigInt(126000), payouts: 2, payoutRounds: 2 });
    expect(result.feeReturnPercent).toBe(315);
  });

  it("keeps deleted purchases in the count and recovers retained pass evidence", () => {
    const result = buildUserPropStatistics([], [
      entry("paid", 1, "PAYOUT", 22000, 8), entry("paid", 1, "PAYOUT", 18000, 6),
      entry("unknown", 1, "PURCHASE", 0, 5), entry("paid", 1, "PURCHASE", -15000, 3),
    ], [{ sessionId: "growth-only", roundNumber: 1, sourceSummary: JSON.stringify({ sessionName: "历史会话" }) }]);
    expect(result.outcomes).toEqual({ passed: 2, notPassed: 1, pending: 0 });
    expect(result.rows[0]).toMatchObject({ status: "deleted", evaluation: "notPassed", purchaseAt: date(5) });
    expect(result.rows[1]).toMatchObject({ status: "deleted", evaluation: "passed", received: BigInt(40000), latestPayoutAt: date(8), payoutCount: 2 });
    expect(result.rows[2]).toMatchObject({ name: "历史会话", purchaseAt: null, createdAt: null });
    expect(result.totals.net).toBe(BigInt(25000));
  });

  it("groups failed and stopped evaluations while keeping current evaluations pending", () => {
    const result = buildUserPropStatistics([
      round("a", 1, "EVALUATION", "FAILED", 1),
      round("a", 2, "EVALUATION", "STOPPED", 2),
      round("a", 3, "EVALUATION", null, 3),
    ], [], []);
    expect(result.outcomes).toEqual({ passed: 0, notPassed: 2, pending: 1 });
    expect(result.rows).toHaveLength(3);
    expect(result.feeReturnPercent).toBeNull();
  });
});
