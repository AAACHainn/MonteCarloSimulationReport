import { describe, expect, it } from "vitest";
import { advancePaperTrading } from "./engine";
import { closeLotsFifo, serializeReplayJournalEntry } from "./journal";
import type { PaperJournalContext, PaperOrderData, PaperPositionLotData, PaperSessionState } from "./types";

const context: PaperJournalContext = {
  abrValue: 2,
  abrLength: 8,
  displayIntervalSeconds: 300,
  displaySession: "ETH",
  displayUtcOffsetMinutes: 480,
  priceTickSize: 0.25,
};

const state: PaperSessionState = {
  id: "session", datasetId: "dataset", initialCapital: 10_000, currency: "USD",
  commissionBps: 0, slippageBps: 0, lastProcessedSequence: -1,
  netQuantity: 0, averageEntryPrice: null, realizedPnl: 0, totalFees: 0,
  totalSlippage: 0, peakEquity: 10_000, maxDrawdown: 0, version: 1,
};

function order(values: Partial<PaperOrderData> = {}): PaperOrderData {
  return {
    id: "entry", side: "BUY", type: "LIMIT", status: "PENDING", quantity: 1,
    riskAmount: 5, price: 100, stopLoss: 95, takeProfit: 104, reduceOnly: false,
    isProtective: false, ocoGroupId: null, createdSequence: -1, activeFromSequence: 0,
    filledSequence: null, filledAt: null, filledPrice: null, cancelReason: null, ...values,
  };
}

function ids() {
  let value = 0;
  return () => `id-${value++}`;
}

describe("paper replay journal", () => {
  it.each(["MARKET", "LIMIT", "STOP"] as const)("keeps the %s entry order type on a new lot", (type) => {
    const result = advancePaperTrading({
      state,
      orders: [order({ type, price: type === "MARKET" ? null : 100, takeProfit: null })],
      bar: { sequence: 0, timestamp: "2026-09-01T00:00:00.000Z", open: 100, high: 101, low: 99, close: 100, volume: null },
      makeId: ids(),
      journalContext: context,
    });
    expect(result.lots).toMatchObject([{ entryOrderType: type }]);
  });

  it("tracks only the adverse path after entry and closes on the same bar", () => {
    const result = advancePaperTrading({
      state,
      orders: [order()],
      bar: { sequence: 0, timestamp: "2026-09-01T00:00:00.000Z", open: 102, high: 106, low: 99, close: 105, volume: null },
      makeId: ids(),
      journalContext: context,
    });
    expect(result.journalEntries).toHaveLength(1);
    expect(result.journalEntries[0]).toMatchObject({
      direction: "LONG", entryPrice: 100, exitPrice: 104,
      entryOrderType: "LIMIT", initialStopPrice: 95, initialRisk: 5, actualRisk: 1, gainLoss: 4,
      abrValue: 2, abrLength: 8, displayIntervalSeconds: 300,
    });
    expect(result.lots).toHaveLength(0);
  });

  it("matches partial exits against entry lots FIFO", () => {
    const lot = (id: string, sequence: number, quantity: number): PaperPositionLotData => ({
      ...context, id, entryFillId: `fill-${id}`, side: "LONG", openedSequence: sequence,
      openedAt: `2026-09-01T00:00:0${sequence}.000Z`, entryPrice: 100 + sequence,
      entryOrderType: "LIMIT", initialStopPrice: 95,
      initialQuantity: quantity, remainingQuantity: quantity, initialRisk: 5, actualRisk: 2,
    });
    const result = closeLotsFifo([lot("first", 0, 2), lot("second", 1, 2)], 3, {
      fillId: "exit", sequence: 5, timestamp: "2026-09-01T00:00:05.000Z", price: 105,
    });
    expect(result.entries.map((entry) => [entry.lotId, entry.quantity])).toEqual([["first", 2], ["second", 1]]);
    expect(result.lots).toMatchObject([{ id: "second", remainingQuantity: 1 }]);
  });

  it("uses actual risk for missing iRisk and tick only for zero-risk RR denominators", () => {
    const base = {
      id: "entry", no: 1, journalSessionId: "journal", lotId: "lot", direction: "LONG",
      quantity: 1, openedSequence: 0, openedAt: new Date("2026-09-01T00:00:00Z"),
      closedSequence: 1, closedAt: new Date("2026-09-01T00:01:00Z"), entryPrice: 100,
      entryOrderType: null, exitPrice: 101, initialStopPrice: null, abrValue: 2, abrLength: 8, displayIntervalSeconds: 300,
      displaySession: "ETH", displayUtcOffsetMinutes: 480, priceTickSize: 0.25,
      initialRisk: 0, actualRisk: 0, gainLoss: 1,
      journalSession: { archivedAt: null },
    } as const;
    const serialized = serializeReplayJournalEntry(base);
    expect(serialized).toMatchObject({
      result: "W", initialRiskAbr: 0, actualRiskAbr: 0,
      initialRiskRr: 4, actualRiskRr: 4, abrRr: 0.5,
    });
  });

  it("returns dashes through null ratios when ABR is unavailable", () => {
    const serialized = serializeReplayJournalEntry({
      id: "entry", no: 1, journalSessionId: "journal", lotId: "lot", direction: "SHORT",
      quantity: 1, openedSequence: 0, openedAt: new Date("2026-09-01T00:00:00Z"),
      closedSequence: 1, closedAt: new Date("2026-09-01T00:01:00Z"), entryPrice: 100,
      entryOrderType: "STOP", exitPrice: 100, initialStopPrice: 101, abrValue: null, abrLength: 8, displayIntervalSeconds: 300,
      displaySession: "ETH", displayUtcOffsetMinutes: 0, priceTickSize: 0.25,
      initialRisk: 1, actualRisk: 0, gainLoss: 0, journalSession: { archivedAt: null },
    });
    expect(serialized).toMatchObject({ result: "BE", initialRiskAbr: null, actualRiskAbr: null, abrRr: null });
  });

  it("waits for a legacy untracked position to flatten before starting journal lots", () => {
    const legacyState = { ...state, netQuantity: 1, averageEntryPrice: 100 };
    const add = advancePaperTrading({
      state: legacyState,
      orders: [order({ id: "legacy-add", quantity: 1, takeProfit: null })],
      bar: { sequence: 0, timestamp: "2026-09-01T00:00:00.000Z", open: 100, high: 101, low: 99, close: 100, volume: null },
      makeId: ids(),
      journalContext: context,
    });
    expect(add.lots).toHaveLength(0);
    expect(add.journalEntries).toHaveLength(0);

    const reverse = advancePaperTrading({
      state: { ...add.state, lastProcessedSequence: 0 },
      lots: add.lots,
      orders: [order({ id: "legacy-reverse", side: "SELL", quantity: 3, price: 100, stopLoss: 105, takeProfit: null })],
      bar: { sequence: 1, timestamp: "2026-09-01T00:01:00.000Z", open: 100, high: 101, low: 99, close: 100, volume: null },
      makeId: ids(),
      journalContext: context,
    });
    expect(reverse.journalEntries).toHaveLength(0);
    expect(reverse.lots).toMatchObject([{ side: "SHORT", remainingQuantity: 1 }]);
  });
});
