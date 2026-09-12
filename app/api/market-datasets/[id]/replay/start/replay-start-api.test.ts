import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ findUnique: vi.fn() }));

vi.mock("@/lib/db", () => ({
  prisma: { marketDataset: { findUnique: mocks.findUnique } },
}));

import { POST } from "./route";

describe("replay start API errors", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns a JSON error when the database operation fails", async () => {
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.findUnique.mockRejectedValue(new Error("database failure"));
    const response = await POST(new Request("http://localhost/replay/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        timestamp: "2026-01-01T00:00:00.000Z",
        playbackRate: 1,
        displayIntervalSeconds: 60,
        displaySession: "ETH",
      }),
    }), { params: Promise.resolve({ id: "dataset" }) });

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ error: "无法建立回放，请稍后重试。" });
    expect(errorLog).toHaveBeenCalledOnce();
    errorLog.mockRestore();
  });
});
