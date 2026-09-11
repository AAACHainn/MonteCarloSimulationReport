import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const tx = {
    paperTradingSession: { findUnique: vi.fn(), update: vi.fn() },
    replayProgress: { findUnique: vi.fn() },
    marketDataset: { findUnique: vi.fn() },
    marketBar: { findUnique: vi.fn() },
    paperOrder: { create: vi.fn(), findFirst: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
  };
  return {
    tx,
    transaction: vi.fn(async (callback: (client: typeof tx) => unknown) => callback(tx)),
    getSnapshot: vi.fn(async () => ({ session: { version: 2 } })),
  };
});

vi.mock("@/lib/db", () => ({ prisma: { $transaction: mocks.transaction } }));
vi.mock("@/lib/paper-trading/serialize", () => ({ getPaperSessionSnapshot: mocks.getSnapshot }));

import { DELETE, POST } from "./route";
import { PATCH } from "./[orderId]/route";

const context = { params: Promise.resolve({ id: "dataset" }) };
const patchContext = { params: Promise.resolve({ id: "dataset", orderId: "order" }) };

function request(method: string, body: unknown) {
  return new Request("http://localhost/api/test", {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("paper order API fixed-risk behavior", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.tx.paperTradingSession.findUnique.mockResolvedValue({
      id: "session", version: 1, commissionBps: 0, slippageBps: 0, netQuantity: 0,
    });
    mocks.tx.replayProgress.findUnique.mockResolvedValue({ currentSequence: 9 });
    mocks.tx.marketDataset.findUnique.mockResolvedValue({ barCount: 100, priceTickSize: 0.01 });
    mocks.tx.marketBar.findUnique.mockResolvedValue({ close: 100 });
    mocks.tx.paperOrder.create.mockResolvedValue({ id: "order" });
    mocks.tx.paperOrder.update.mockResolvedValue({ id: "order" });
    mocks.tx.paperOrder.updateMany.mockResolvedValue({ count: 2 });
    mocks.tx.paperTradingSession.update.mockResolvedValue({ version: 2 });
    mocks.tx.paperOrder.findFirst.mockResolvedValue({
      id: "order", side: "BUY", type: "LIMIT", status: "PENDING", quantity: 20,
      riskAmount: 100, price: 100, stopLoss: 95, takeProfit: 110, isProtective: false,
    });
  });

  it("recomputes authoritative quantity for a fixed-risk create", async () => {
    const response = await POST(request("POST", {
      side: "BUY", type: "LIMIT", quantity: 999, riskAmount: 100,
      price: 100, stopLoss: 95, takeProfit: 110, expectedVersion: 1,
    }), context);
    expect(response.status).toBe(201);
    expect(mocks.tx.paperOrder.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      quantity: 20, riskAmount: 100, price: 100, stopLoss: 95, takeProfit: 110,
    }) });
  });

  it("keeps the legacy explicit-quantity create compatible", async () => {
    const response = await POST(request("POST", {
      side: "SELL", type: "STOP", quantity: 3, price: 95,
      stopLoss: 105, takeProfit: 85, expectedVersion: 1,
    }), context);
    expect(response.status).toBe(201);
    expect(mocks.tx.paperOrder.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      quantity: 3, riskAmount: undefined,
    }) });
  });

  it("rejects an invalid bracket and a stale version", async () => {
    const invalid = await POST(request("POST", {
      side: "BUY", type: "LIMIT", quantity: 1, riskAmount: 100,
      price: 100, stopLoss: 101, takeProfit: 110, expectedVersion: 1,
    }), context);
    expect(invalid.status).toBe(400);
    mocks.tx.paperTradingSession.findUnique.mockResolvedValueOnce({
      id: "session", version: 2, commissionBps: 0, slippageBps: 0, netQuantity: 0,
    });
    const conflict = await POST(request("POST", {
      side: "BUY", type: "LIMIT", quantity: 1, price: 99, expectedVersion: 1,
    }), context);
    expect(conflict.status).toBe(409);
  });

  it("atomically updates all three lines and keeps fixed risk", async () => {
    const response = await PATCH(request("PATCH", {
      price: 102, stopLoss: 98, takeProfit: 110, riskAmount: 200, expectedVersion: 1,
    }), patchContext);
    expect(response.status).toBe(200);
    expect(mocks.tx.paperOrder.update).toHaveBeenCalledWith({
      where: { id: "order" },
      data: expect.objectContaining({
        price: 102, stopLoss: 98, takeProfit: 110, riskAmount: 200, quantity: 50,
        activeFromSequence: 10,
      }),
    });
  });

  it("cancels every pending order for ALL and only protective orders for BRACKET", async () => {
    const all = await DELETE(request("DELETE", { expectedVersion: 1, scope: "ALL" }), context);
    expect(all.status).toBe(200);
    expect(mocks.tx.paperOrder.updateMany).toHaveBeenLastCalledWith({
      where: { sessionId: "session", status: "PENDING" },
      data: { status: "CANCELLED", cancelReason: "USER_CANCELLED" },
    });

    const bracket = await DELETE(request("DELETE", { expectedVersion: 1, scope: "BRACKET" }), context);
    expect(bracket.status).toBe(200);
    expect(mocks.tx.paperOrder.updateMany).toHaveBeenLastCalledWith({
      where: { sessionId: "session", status: "PENDING", isProtective: true },
      data: { status: "CANCELLED", cancelReason: "USER_CANCELLED" },
    });
  });

  it("recomputes quantity when a submitted bracket line moves", async () => {
    const response = await PATCH(request("PATCH", { stopLoss: 90, expectedVersion: 1 }), patchContext);
    expect(response.status).toBe(200);
    expect(mocks.tx.paperOrder.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ stopLoss: 90, quantity: 10 }),
    }));
  });

  it("rejects an invalid submitted bracket without writing", async () => {
    const response = await PATCH(request("PATCH", { takeProfit: 99, expectedVersion: 1 }), patchContext);
    expect(response.status).toBe(400);
    expect(mocks.tx.paperOrder.update).not.toHaveBeenCalled();
  });

  it("rejects create and update prices that are off tick", async () => {
    mocks.tx.marketDataset.findUnique.mockResolvedValue({ barCount: 100, priceTickSize: 0.25 });
    const create = await POST(request("POST", {
      side: "BUY", type: "LIMIT", quantity: 1, price: 100.1, expectedVersion: 1,
    }), context);
    expect(create.status).toBe(400);

    const update = await PATCH(request("PATCH", { price: 100.1, expectedVersion: 1 }), patchContext);
    expect(update.status).toBe(400);
    expect(mocks.tx.paperOrder.update).not.toHaveBeenCalled();
  });
});
