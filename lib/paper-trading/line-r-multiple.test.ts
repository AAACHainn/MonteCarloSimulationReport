import { describe, expect, it } from "vitest";
import {
  createBracketRReference,
  formatRMultiple,
  priceDifferenceFromEntry,
  protectiveOrderRReference,
  rMultipleAtPrice,
} from "./line-r-multiple";
import type { PaperOrderData, PaperSessionSnapshot } from "./types";

describe("paper trading price-line R multiples", () => {
  it("uses the original long stop distance as 1R", () => {
    const reference = createBracketRReference("BUY", 100, 95);
    expect(rMultipleAtPrice(reference, 95)).toBe(-1);
    expect(rMultipleAtPrice(reference, 97.5)).toBe(-0.5);
    expect(rMultipleAtPrice(reference, 100)).toBe(0);
    expect(rMultipleAtPrice(reference, 105)).toBe(1);
    expect(rMultipleAtPrice(reference, 110)).toBe(2);
  });

  it("uses the original short stop distance as 1R", () => {
    const reference = createBracketRReference("SELL", 100, 105);
    expect(rMultipleAtPrice(reference, 105)).toBe(-1);
    expect(rMultipleAtPrice(reference, 102.5)).toBe(-0.5);
    expect(rMultipleAtPrice(reference, 100)).toBe(0);
    expect(rMultipleAtPrice(reference, 95)).toBe(1);
  });

  it("formats two decimals without negative zero", () => {
    expect(formatRMultiple(-1)).toBe("-1.00R");
    expect(formatRMultiple(1.234)).toBe("1.23R");
    expect(formatRMultiple(-0.001)).toBe("0.00R");
    expect(formatRMultiple(null)).toBe("—R");
  });

  it("calculates an absolute price difference from the entry", () => {
    const longReference = createBracketRReference("BUY", 6086.5, 6081);
    const shortReference = createBracketRReference("SELL", 6086.5, 6092);
    expect(priceDifferenceFromEntry(longReference, 6081)).toBe(5.5);
    expect(priceDifferenceFromEntry(longReference, 6097.5)).toBe(11);
    expect(priceDifferenceFromEntry(shortReference, 6092)).toBe(5.5);
    expect(priceDifferenceFromEntry(null, 6081)).toBeNull();
  });

  it("resolves an active protective order against its original bracket stop", () => {
    const protectiveOrder = {
      id: "stop", side: "SELL", type: "STOP", status: "PENDING", quantity: 2,
      riskAmount: null, price: 100, stopLoss: null, takeProfit: null,
      reduceOnly: true, isProtective: true, ocoGroupId: "oco",
      createdSequence: 12, activeFromSequence: 12, filledSequence: null,
      filledAt: null, filledPrice: null, cancelReason: null,
    } satisfies PaperOrderData;
    const parentOrder = {
      ...protectiveOrder,
      id: "entry", side: "BUY", type: "LIMIT", status: "FILLED", quantity: 2,
      riskAmount: 10, price: 100, stopLoss: 95, takeProfit: 110,
      reduceOnly: false, isProtective: false, ocoGroupId: null,
      createdSequence: 10, activeFromSequence: 11, filledSequence: 12,
      filledAt: "2026-01-01T00:00:00.000Z", filledPrice: 100,
    } satisfies PaperOrderData;
    const snapshot = {
      session: { averageEntryPrice: 100, netQuantity: 2 },
      activeOrders: [protectiveOrder], recentOrders: [parentOrder], recentFills: [], recentTrades: [],
    } as unknown as PaperSessionSnapshot;

    const reference = protectiveOrderRReference(snapshot, protectiveOrder);
    expect(rMultipleAtPrice(reference, 97.5)).toBe(-0.5);
    expect(rMultipleAtPrice(reference, 100)).toBe(0);
    expect(rMultipleAtPrice(reference, 110)).toBe(2);
  });
});
