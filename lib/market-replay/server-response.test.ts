import { describe, expect, it } from "vitest";
import type { PaperSessionSnapshot } from "@/lib/paper-trading/types";
import { resolveReplayServerResponse } from "./server-response";
import type { ReplayServerResponse } from "./server-sync-types";

const previous: PaperSessionSnapshot = {
  session: { id: "account", datasetId: "dataset", initialCapital: 1000, currency: "USD", commissionBps: 0,
    slippageBps: 0, lastProcessedSequence: 10, netQuantity: 0, averageEntryPrice: null, realizedPnl: 0,
    totalFees: 0, totalSlippage: 0, peakEquity: 1000, maxDrawdown: 0, version: 11 },
  activeOrders: [], openLots: [], recentOrders: [], recentFills: [],
  recentTrades: [{ id: "old-trade", side: "LONG", status: "CLOSED", openedSequence: 1, openedAt: "2026-01-01T00:00:00Z",
    closedSequence: 2, closedAt: "2026-01-01T00:00:01Z", grossPnl: 10, fees: 0, plannedRisk: 5 }],
  stats: { balance: 1000, equity: 1000, unrealizedPnl: 0, netPnl: 0, tradeCount: 1, journalEntryCount: 0,
    winRate: 1, profitFactor: null, averageWin: 10, averageLoss: 0, maxConsecutiveWins: 1,
    maxConsecutiveLosses: 0, maxDrawdown: 0, totalFees: 0, totalSlippage: 0 },
};
const compact: ReplayServerResponse = {
  requestId: "advance", fromSequence: 10, currentSequence: 11, generation: 1, syncVersion: 2, dataVersion: 1, historyVersion: 1,
  fills: [], snapshot: { session: { ...previous.session, lastProcessedSequence: 11, version: 12 },
    stats: { ...previous.stats, equity: 1001 }, activeOrders: [], openLots: [] },
};

describe("compact advance snapshot resolution", () => {
  it("retains unchanged history by reference and applies authoritative account updates", () => {
    const result = resolveReplayServerResponse(compact, previous, 11);
    expect(result.snapshot?.recentTrades).toBe(previous.recentTrades);
    expect(result.snapshot?.recentOrders).toBe(previous.recentOrders);
    expect(result.snapshot?.recentFills).toBe(previous.recentFills);
    expect(result.snapshot?.session.version).toBe(12);
    expect(result.snapshot?.stats.equity).toBe(1001);
    expect(previous.session.version).toBe(11);
  });
  it("replaces history including explicitly empty lists after a trade change", () => {
    const full = { ...compact, snapshot: { ...previous, recentOrders: [], recentFills: [], recentTrades: [] } };
    expect(resolveReplayServerResponse(full, previous, 11).snapshot?.recentTrades).toEqual([]);
    expect(resolveReplayServerResponse(full, null, null).snapshot).toEqual(full.snapshot);
  });
  it.each([
    null,
    { ...previous, session: { ...previous.session, id: "another-account" } },
    { ...previous, session: { ...previous.session, datasetId: "another-dataset" } },
    { ...previous, session: { ...previous.session, version: 10 } },
    { ...previous, session: { ...previous.session, lastProcessedSequence: 9 } },
  ])("rejects missing or mismatched bases instead of merging another account's history", (base) => {
    expect(() => resolveReplayServerResponse(compact, base, 11)).toThrow();
  });
  it("accepts a replay with no initialized account", () => {
    expect(resolveReplayServerResponse({ ...compact, snapshot: null }, null, null).snapshot).toBeNull();
  });
});
