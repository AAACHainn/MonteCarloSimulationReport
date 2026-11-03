import { describe, expect, it } from "vitest";
import { advancePaperTrading } from "./engine";
import { derivePaperTradeTransitions, reduceRecentPaperTrades } from "./reducers";
import { defaultPartialExitQuantity, isValidProtectivePrice, nextPartialExitNumber, protectiveOrderLabel, protectiveQuantityMode } from "./protective-orders";
import type { PaperOrderData, PaperSessionState } from "./types";

const state: PaperSessionState = { id: "s", datasetId: "d", initialCapital: 10000, currency: "USD", commissionBps: 0, slippageBps: 0,
  lastProcessedSequence: 0, netQuantity: 10, averageEntryPrice: 100, realizedPnl: 0, totalFees: 0, totalSlippage: 0,
  peakEquity: 10000, maxDrawdown: 0, version: 1 };
const order = (id: string, type: "LIMIT" | "STOP", price: number, quantity = 10, group: string | null = "main"): PaperOrderData => ({
  id, type, price, quantity, side: "SELL", status: "PENDING", riskAmount: null, stopLoss: null, takeProfit: null,
  reduceOnly: true, isProtective: true, ocoGroupId: group, createdSequence: 0, activeFromSequence: 1,
  filledSequence: null, filledAt: null, filledPrice: null, cancelReason: null,
});
const bar = { sequence: 1, timestamp: "2026-11-03T00:01:00Z", open: 100, high: 112, low: 99, close: 111, volume: null };
let id = 0;
const run = (orders: PaperOrderData[], overrides = {}, session = state) => advancePaperTrading({ state: session, orders, bar: { ...bar, ...overrides }, makeId: () => "generated-" + ++id });

describe("independent partial protective exits", () => {
  it("keeps both main exits alive after a partial target fills", () => {
    const result = run([order("main-tp", "LIMIT", 120), order("main-sl", "STOP", 90), order("partial_tp_1_a", "LIMIT", 110, 5, null)]);
    expect(result.fills).toHaveLength(1);
    expect(result.fills[0]).toMatchObject({ reason: "TAKE_PROFIT", quantity: 5, netQuantityAfter: 5, realizedPnl: 50 });
    expect(result.orders.filter(o => o.status === "PENDING").map(o => [o.id, o.quantity])).toEqual([["main-tp", 5], ["main-sl", 5]]);
    expect(derivePaperTradeTransitions(result.orders, result.fills)[0].kind).toBe("REDUCE");
  });
  it("keeps the target and farther stop after a partial stop fills", () => {
    const result = run([order("main-tp", "LIMIT", 120), order("main-sl", "STOP", 90), order("partial_sl_1_a", "STOP", 95, 5, null)], { low: 94, high: 101, close: 100 });
    expect(result.fills[0]).toMatchObject({ reason: "STOP_LOSS", quantity: 5, netQuantityAfter: 5 });
    expect(result.orders.filter(o => o.status === "PENDING").map(o => o.quantity)).toEqual([5, 5]);
  });
  it("processes several targets in one source bar and never opens a reverse position", () => {
    const result = run([order("main-tp", "LIMIT", 120), order("main-sl", "STOP", 90),
      order("partial_tp_1_a", "LIMIT", 105, 6, null), order("partial_tp_2_a", "LIMIT", 110, 6, null)]);
    expect(result.fills.map(f => f.quantity)).toEqual([6, 4]);
    expect(result.state.netQuantity).toBe(0);
    expect(result.orders.filter(o => o.status === "PENDING")).toHaveLength(0);
    expect(result.fills.every(f => f.openedQuantity === 0)).toBe(true);
  });
  it("cancels all partial exits when a main stop closes the position first", () => {
    const result = run([order("main-tp", "LIMIT", 120), order("main-sl", "STOP", 95),
      order("partial_tp_1_a", "LIMIT", 110, 5, null)], { low: 94 });
    expect(result.fills.map(f => f.orderId)).toEqual(["main-sl"]);
    expect(result.orders.find(o => o.id === "partial_tp_1_a")).toMatchObject({ status: "CANCELLED", cancelReason: "POSITION_CLOSED" });
  });
  it("grows main lines after adding but preserves fixed exits, including when replacing a bracket", () => {
    const adding = { ...order("adding", "LIMIT", 100), side: "BUY" as const, quantity: 4, isProtective: false, reduceOnly: false, ocoGroupId: null, stopLoss: 90, takeProfit: 125 };
    const result = run([order("main-tp", "LIMIT", 120), order("main-sl", "STOP", 90), order("partial_tp_1_a", "LIMIT", 115, 5, null), adding]);
    expect(result.state.netQuantity).toBe(14);
    expect(result.orders.find(o => o.id === "partial_tp_1_a")).toMatchObject({ status: "PENDING", quantity: 5 });
    expect(result.orders.filter(o => o.status === "PENDING" && protectiveQuantityMode(o) === "ALL").map(o => o.quantity)).toEqual([14, 14]);
  });
  it("clips fixed lines after manual reduction and cancels them on reversal", () => {
    const reducing = { ...order("reduce", "LIMIT", 100), isProtective: false, ocoGroupId: null, quantity: 7 };
    const result = run([order("main-tp", "LIMIT", 120), order("partial_tp_1_a", "LIMIT", 115, 5, null), reducing]);
    expect(result.state.netQuantity).toBe(3);
    expect(result.orders.filter(o => o.status === "PENDING").map(o => o.quantity)).toEqual([3, 3]);
    const reverse = { ...reducing, quantity: 15, reduceOnly: false };
    expect(run([order("partial_tp_1_a", "LIMIT", 115, 5, null), reverse]).orders[0]).toMatchObject({ status: "CANCELLED", cancelReason: "POSITION_REVERSED" });
  });
  it("supports short positions with the same quantity and cancellation semantics", () => {
    const orders = [order("main-tp", "LIMIT", 80), order("main-sl", "STOP", 120), order("partial_tp_1_a", "LIMIT", 90, 5, null)].map(o => ({ ...o, side: "BUY" as const }));
    const result = run(orders, { low: 89, high: 101, close: 91 }, { ...state, netQuantity: -10 });
    expect(result.fills[0]).toMatchObject({ quantity: 5, netQuantityAfter: -5, reason: "TAKE_PROFIT" });
    expect(result.orders.filter(o => o.status === "PENDING").map(o => o.quantity)).toEqual([5, 5]);
  });
  it("keeps a position cycle open across partial protective fills and closes it only at zero", () => {
    const first = run([order("main-tp", "LIMIT", 120), order("partial_tp_1_a", "LIMIT", 110, 5, null)]);
    const trades = [{ id: "trade", side: "LONG" as const, status: "OPEN" as const, openedSequence: 0, openedAt: bar.timestamp,
      closedSequence: null, closedAt: null, grossPnl: 0, fees: 1, plannedRisk: 100 }];
    const partial = reduceRecentPaperTrades(trades, derivePaperTradeTransitions(first.orders, first.fills));
    expect(partial[0]).toMatchObject({ status: "OPEN", grossPnl: 50, closedSequence: null });
    const second = advancePaperTrading({ state: first.state, orders: first.orders, bar: { ...bar, sequence: 2, high: 125 }, makeId: () => "generated-" + ++id });
    expect(reduceRecentPaperTrades(partial, derivePaperTradeTransitions(second.orders, second.fills))[0]).toMatchObject({ status: "CLOSED", grossPnl: 150, closedSequence: 2 });
  });
  it("does not activate a newly placed line on its creation bar", () => {
    const result = run([{ ...order("partial_tp_1_a", "LIMIT", 110, 5, null), activeFromSequence: 2 }]);
    expect(result.fills).toHaveLength(0);
  });
});

describe("partial exit identity and price rules", () => {
  it("uses fixed half of the current remaining position and stable independent ordinals", () => {
    expect(defaultPartialExitQuantity(-7)).toBe(3.5);
    expect(protectiveOrderLabel(order("partial_tp_3_a", "LIMIT", 110))).toBe("TP3");
    expect(protectiveOrderLabel(order("projection::p::partial_sl_2_a", "STOP", 90))).toBe("SL2");
    expect(nextPartialExitNumber([{ id: "partial_tp_3_a" }, { id: "partial_tp_1_b" }])).toBe(4);
  });
  it.each([[10, "LIMIT", 110, true], [10, "STOP", 95, true], [-10, "LIMIT", 90, true], [-10, "STOP", 105, true],
    [10, "STOP", 105, false], [0, "LIMIT", 110, false], [10, "LIMIT", 100, false], [10, "MARKET", 110, false]] as const)(
    "validates %s %s at %s", (quantity, type, price, valid) => { expect(isValidProtectivePrice(quantity, type, price, 100)).toBe(valid); });
});
