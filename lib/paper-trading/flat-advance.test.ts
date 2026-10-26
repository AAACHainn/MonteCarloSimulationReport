import { describe, expect, it } from "vitest";
import { advancePaperTrading } from "./engine";
import { advanceFlatAccount, canAdvanceFlatAccount, flatEquityPoint, flatSampleSequences } from "./flat-advance";
import type { PaperSessionState } from "./types";

const account: PaperSessionState = { id: "a", datasetId: "d", initialCapital: 1000, currency: "USD",
  commissionBps: 0, slippageBps: 0, lastProcessedSequence: -1, netQuantity: 0, averageEntryPrice: null,
  realizedPnl: -100, totalFees: 5, totalSlippage: 0, peakEquity: 1000, maxDrawdown: 0, version: 1 };

describe("constant flat-account advance", () => {
  it("advances cash-adjusted accounts without treating deposits or withdrawals as trading return", () => {
    const state = { ...account, cashAdjustment: 500, peakEquity: 1000, lastProcessedSequence: 0 };
    const advanced = advanceFlatAccount(state, 10);
    expect(advanced).toMatchObject({ cashAdjustment: 500, peakEquity: 1000, maxDrawdown: 0.105 });
    const point = flatEquityPoint(advanced, 10, new Date(10_000).toISOString());
    expect(point).toMatchObject({ balance: 1395, equity: 1395, drawdown: 0.105 });
  });
  it.each([0, 800, 1000, 1200])("matches every source result with an existing equity peak of %s", peakEquity => {
    const original = { ...account, peakEquity };
    let state = original;
    for (let sequence = 0; sequence < 200; sequence++) {
      const bar = { sequence, timestamp: new Date(sequence * 1000).toISOString(), open: 30, high: 100, low: 1, close: 70, volume: null };
      const slow = advancePaperTrading({ state, orders: [], lots: [], bar, makeId: () => "unused" });
      expect(advanceFlatAccount(original, sequence)).toEqual(slow.state);
      expect(flatEquityPoint(slow.state, sequence, bar.timestamp)).toEqual(slow.equityPoint);
      state = slow.state;
    }
    expect(original.lastProcessedSequence).toBe(-1);
  });
  it("rejects positions, incomplete position state, pending orders and residual lots", () => {
    expect(canAdvanceFlatAccount(account, 0, 0)).toBe(true);
    for (const state of [{ ...account, netQuantity: 1e-15 }, { ...account, averageEntryPrice: 1 }, { ...account, activeCycleKey: "cycle" }]) {
      expect(canAdvanceFlatAccount(state, 0, 0)).toBe(false);
      expect(() => advanceFlatAccount(state, 3)).toThrow();
    }
    expect(canAdvanceFlatAccount(account, 1, 0)).toBe(false);
    expect(canAdvanceFlatAccount(account, 0, 1)).toBe(false);
  });
  it("samples actual source identities across aligned bounded requests without dropping points", () => {
    const all = flatSampleSequences(52, 8700, 113);
    const split = [...new Set([...flatSampleSequences(52, 4052, 113), ...flatSampleSequences(4052, 8700, 113)])];
    expect(split.sort((a, b) => a - b)).toEqual(all);
    expect(flatSampleSequences(-1, 6, 1)).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });
});
