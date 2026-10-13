import { replayRouteBusinessScope } from "@/test-utils/replay-route-business-scope";
vi.mock("@/lib/replay-sessions/scope", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/replay-sessions/scope")>(), ...replayRouteBusinessScope, getReplayScope: () => ({ id: "replay-root" }),
}));
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findFirst: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    $transaction: async (callback: (tx: unknown) => unknown) => callback({ replayJournalSession: { update: mocks.update }, replaySession: { update: mocks.update } }),
    replayJournalSession: {
      findFirst: mocks.findFirst,
      update: mocks.update,
      delete: mocks.delete,
    },
  },
}));

import { PATCH } from "./route";

const context = { params: Promise.resolve({ id: "dataset-1", sessionId: "session-1" }) };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.findFirst.mockResolvedValue({ id: "session-1" });
  mocks.update.mockResolvedValue({ id: "session-1", name: "上午突破练习" });
});

describe("replay journal session API", () => {
  it("renames a session within the requested dataset", async () => {
    const response = await PATCH(new Request("http://localhost/api", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "  上午突破练习  " }),
    }), context);

    expect(response.status).toBe(200);
    expect(mocks.findFirst).toHaveBeenCalledWith({
      where: { id: "session-1", datasetId: "dataset-1" },
      select: { id: true },
    });
    expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "session-1" },
      data: { name: "上午突破练习" },
    }));
  });

  it("rejects an empty session name", async () => {
    const response = await PATCH(new Request("http://localhost/api", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "   " }),
    }), context);

    expect(response.status).toBe(400);
    expect(mocks.update).not.toHaveBeenCalled();
  });
});
