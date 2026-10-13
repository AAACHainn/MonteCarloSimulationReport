import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ findUnique: vi.fn() }));

vi.mock("@/lib/db", () => ({
  prisma: {
    marketDataset: { findUnique: mocks.findUnique },
    $transaction: async (action: (tx: unknown) => unknown) => action({ marketDataset: { findUnique: mocks.findUnique } }),
  },
}));

import { POST } from "./route";
import { POST as createPOST } from "../../replay-sessions/route";

describe("replay start API errors", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns a JSON error when the database operation fails", async () => {
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.findUnique.mockRejectedValue(new Error("database failure"));
    const response = await createPOST(new Request("http://localhost/replay-sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "新训练", mode: "TRAINING",
        timestamp: "2026-01-01T00:00:00.000Z",
        playbackRate: 1,
        displayIntervalSeconds: 60,
        displaySession: "ETH",
      }),
    }), { params: Promise.resolve({ id: "dataset" }) });

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ error: "会话操作失败，请重试。" });
    expect(errorLog).toHaveBeenCalledOnce();
    errorLog.mockRestore();
  });
  it("requires an explicit session when restarting through the compatibility endpoint", async () => {
    const response = await POST(new Request("http://localhost/replay/start", { method: "POST" }), { params: Promise.resolve({ id: "dataset" }) });
    expect(response.status).toBe(409);
    expect((await response.json()).code).toBe("SESSION_REQUIRED");
    expect(mocks.findUnique).not.toHaveBeenCalled();
  });
});
