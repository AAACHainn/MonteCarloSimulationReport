import { describe, expect, it } from "vitest";
import { derivePaperTradeTransitions, reduceRecentPaperTrades } from "./reducers";
import type { PaperFillData, PaperOrderData } from "./types";

const order: PaperOrderData = {
  id: "entry", side: "BUY", type: "MARKET", status: "FILLED", quantity: 2,
  riskAmount: 100, price: null, stopLoss: 95, takeProfit: null, reduceOnly: false,
  isProtective: false, ocoGroupId: null, createdSequence: -1, activeFromSequence: 0,
  filledSequence: 0, filledAt: "2026-09-01T00:00:00.000Z", filledPrice: 100, cancelReason: null,
};
const fill = (reason: PaperFillData["reason"], sequence: number, values: Partial<PaperFillData> = {}): PaperFillData => ({
  id: `fill-${sequence}`, orderId: "entry", sequence, timestamp: new Date(sequence * 1000).toISOString(),
  side: "BUY", price: 100, quantity: 2, fee: 2, slippageCost: 0, realizedPnl: 0,
  closedQuantity: 0, openedQuantity: 2, netQuantityAfter: 2, averagePriceAfter: 100, reason,
  ...values,
});

describe("paper trade reducers", () => {
  it("derives risk and reduces an entry-to-close cycle identically for browser and server consumers", () => {
    const fills = [
      fill("ENTRY", 0),
      fill("CLOSE", 1, { side: "SELL", realizedPnl: 20, closedQuantity: 2, openedQuantity: 0, netQuantityAfter: 0, averagePriceAfter: null }),
    ];
    const transitions = derivePaperTradeTransitions([order], fills);
    expect(transitions[0].plannedRisk).toBe(100);
    const trades = reduceRecentPaperTrades([], transitions);
    expect(trades[0]).toMatchObject({
      status: "CLOSED", openedSequence: 0, closedSequence: 1,
      grossPnl: 20, fees: 4, plannedRisk: 100,
    });
  });
});
