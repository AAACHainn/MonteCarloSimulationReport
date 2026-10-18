import { describe, expect, it } from "vitest";
import { advancePaperTrading, closePaperTradingAtCurrentPrice } from "./engine";
import type { PaperOrderData, PaperSessionState } from "./types";

let counter = 0;
const makeId = () => `generated-${counter += 1}`;
const state = (overrides: Partial<PaperSessionState> = {}): PaperSessionState => ({
  id: "session", datasetId: "dataset", initialCapital: 100_000, currency: "USDT",
  commissionBps: 0, slippageBps: 0, lastProcessedSequence: 9,
  netQuantity: 0, averageEntryPrice: null, realizedPnl: 0, totalFees: 0,
  totalSlippage: 0, peakEquity: 100_000, maxDrawdown: 0, version: 1, ...overrides,
});
const order = (overrides: Partial<PaperOrderData> = {}): PaperOrderData => ({
  id: `order-${counter += 1}`, side: "BUY", type: "MARKET", status: "PENDING",
  quantity: 1, riskAmount: null, price: null, stopLoss: null, takeProfit: null, reduceOnly: false,
  isProtective: false, ocoGroupId: null, createdSequence: 9, activeFromSequence: 10,
  filledSequence: null, filledAt: null, filledPrice: null, cancelReason: null, ...overrides,
});
const bar = { sequence: 10, timestamp: "2026-01-01T00:10:00.000Z", open: 100, high: 110, low: 90, close: 105, volume: null };

describe("paper trading engine", () => {
  it("fills a market order at the next bar open", () => {
    const result = advancePaperTrading({ state: state(), orders: [order()], bar, makeId });
    expect(result.fills[0]).toMatchObject({ price: 100, quantity: 1, reason: "ENTRY" });
    expect(result.state.netQuantity).toBe(1);
  });

  it("uses the bullish open-low-high-close path for competing price orders", () => {
    const buyLimit = order({ type: "LIMIT", price: 95 });
    const buyStop = order({ type: "STOP", price: 108 });
    const result = advancePaperTrading({ state: state(), orders: [buyStop, buyLimit], bar, makeId });
    expect(result.fills.map((fill) => fill.orderId)).toEqual([buyLimit.id, buyStop.id]);
    expect(result.state.averageEntryPrice).toBe(101.5);
  });

  it("gives limit orders opening-gap price improvement", () => {
    const result = advancePaperTrading({ state: state(), orders: [order({ type: "LIMIT", price: 105 })], bar, makeId });
    expect(result.fills[0].price).toBe(100);
  });

  it("adds, reduces and reverses a net position", () => {
    const adding = advancePaperTrading({
      state: state({ netQuantity: 2, averageEntryPrice: 90 }),
      orders: [order({ side: "BUY", quantity: 2 })], bar, makeId,
    });
    expect(adding.state.netQuantity).toBe(4);
    expect(adding.state.averageEntryPrice).toBe(95);

    const reversing = advancePaperTrading({
      state: state({ netQuantity: 2, averageEntryPrice: 90 }),
      orders: [order({ side: "SELL", quantity: 3 })], bar, makeId,
    });
    expect(reversing.fills[0]).toMatchObject({ closedQuantity: 2, openedQuantity: 1, realizedPnl: 20, reason: "REVERSE" });
    expect(reversing.state.netQuantity).toBe(-1);
    expect(reversing.state.averageEntryPrice).toBe(100);
  });

  it("creates a position-wide OCO and triggers it later in the same bar", () => {
    const result = advancePaperTrading({
      state: state(),
      orders: [order({ stopLoss: 95, takeProfit: 108 })], bar, makeId,
    });
    expect(result.fills.map((fill) => fill.reason)).toEqual(["ENTRY", "STOP_LOSS"]);
    expect(result.state.netQuantity).toBe(0);
    const takeProfit = result.orders.find((item) => item.isProtective && item.type === "LIMIT");
    expect(takeProfit?.status).toBe("CANCELLED");
  });

  it("applies adverse stop slippage and commission", () => {
    const result = advancePaperTrading({
      state: state({ netQuantity: 1, averageEntryPrice: 100, commissionBps: 10, slippageBps: 10 }),
      orders: [order({ side: "SELL", type: "STOP", price: 95, reduceOnly: true })], bar, makeId,
    });
    expect(result.fills[0].price).toBeCloseTo(94.905);
    expect(result.fills[0].fee).toBeCloseTo(0.094905);
    expect(result.state.netQuantity).toBe(0);
  });

  it("rejects attempts to skip a bar", () => {
    expect(() => advancePaperTrading({ state: state(), orders: [], bar: { ...bar, sequence: 11 }, makeId })).toThrow();
  });
});

describe("current-price market close", () => {
  it.each([2, -2])("closes a %s position at the current source close without replaying other orders", (netQuantity) => {
    const closing = order({ id: "close", side: netQuantity > 0 ? "SELL" : "BUY", quantity: 99, reduceOnly: true });
    const protective = order({ id: "stop", side: closing.side, type: "STOP", price: netQuantity > 0 ? 95 : 108,
      reduceOnly: true, isProtective: true, ocoGroupId: "bracket" });
    const pending = order({ id: "entry" });
    const original = state({ lastProcessedSequence: 10, netQuantity, averageEntryPrice: 100, commissionBps: 10, slippageBps: 20 });
    const result = closePaperTradingAtCurrentPrice({ state: original, orders: [protective, pending, closing], bar, makeId }, closing.id);
    const price = 105 * (netQuantity > 0 ? 0.998 : 1.002);
    expect(result.fills).toHaveLength(1);
    expect(result.fills[0]).toMatchObject({ orderId: "close", sequence: 10, timestamp: bar.timestamp,
      price, quantity: 2, closedQuantity: 2, openedQuantity: 0, reason: "CLOSE" });
    expect(result.fills[0].fee).toBeCloseTo(price * 2 / 1000);
    expect(result.state).toMatchObject({ netQuantity: 0, averageEntryPrice: null, lastProcessedSequence: 10, version: 2 });
    expect(result.orders.find((item) => item.id === "stop")).toMatchObject({ status: "CANCELLED", cancelReason: "POSITION_CLOSED" });
    expect(result.orders.find((item) => item.id === "entry")).toEqual(pending);
    expect(result.equityPoint.sequence).toBe(10);
    expect(result.equityPoint.equity).toBe(result.equityPoint.balance);
    expect(original.netQuantity).toBe(netQuantity);
    expect(closing.status).toBe("PENDING");
  });

  it("supports partial reduction and preserves the remaining protective quantity", () => {
    const closing = order({ side: "SELL", quantity: 1, reduceOnly: true });
    const protective = order({ side: "SELL", quantity: 3, type: "STOP", price: 95, reduceOnly: true, isProtective: true });
    const result = closePaperTradingAtCurrentPrice({ state: state({ lastProcessedSequence: 10, netQuantity: 3, averageEntryPrice: 100 }),
      orders: [closing, protective], bar, makeId }, closing.id);
    expect(result.fills[0]).toMatchObject({ price: 105, reason: "REDUCE" });
    expect(result.state.netQuantity).toBe(2);
    expect(result.orders[1]).toMatchObject({ quantity: 2, status: "PENDING" });
  });

  it("rejects unprocessed bars, opening orders, and absent positions", () => {
    const closing = order({ side: "SELL", reduceOnly: true });
    expect(() => closePaperTradingAtCurrentPrice({ state: state({ netQuantity: 1, averageEntryPrice: 100 }), orders: [closing], bar, makeId }, closing.id)).toThrow();
    for (const current of [state({ lastProcessedSequence: 10 }), state({ lastProcessedSequence: 10, netQuantity: -1, averageEntryPrice: 100 })]) {
      expect(() => closePaperTradingAtCurrentPrice({ state: current, orders: [closing], bar, makeId }, closing.id)).toThrow();
    }
    const entry = order();
    expect(() => closePaperTradingAtCurrentPrice({ state: state({ lastProcessedSequence: 10, netQuantity: 1, averageEntryPrice: 100 }), orders: [entry], bar, makeId }, entry.id)).toThrow();
  });
});
