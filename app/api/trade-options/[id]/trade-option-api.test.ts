import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findUnique: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    tradeOption: {
      findUnique: mocks.findUnique,
      update: mocks.update,
      delete: mocks.delete,
    },
  },
}));

import { DELETE } from "./route";

const context = { params: Promise.resolve({ id: "setup-1" }) };

beforeEach(() => {
  vi.clearAllMocks();
});

describe("trade option deletion with replay journal references", () => {
  it("deactivates a Setup referenced by a replay journal", async () => {
    mocks.findUnique.mockResolvedValue({
      id: "setup-1",
      _count: { instrumentTrades: 0, strategyTrades: 0, replayJournalSetups: 1 },
    });
    const response = await DELETE(new Request("http://localhost/api/trade-options/setup-1"), context);
    expect(await response.json()).toEqual({ ok: true, deactivated: true });
    expect(mocks.update).toHaveBeenCalledWith({ where: { id: "setup-1" }, data: { active: false } });
    expect(mocks.delete).not.toHaveBeenCalled();
  });

  it("deletes an option with no references", async () => {
    mocks.findUnique.mockResolvedValue({
      id: "setup-1",
      _count: { instrumentTrades: 0, strategyTrades: 0, replayJournalSetups: 0 },
    });
    const response = await DELETE(new Request("http://localhost/api/trade-options/setup-1"), context);
    expect(await response.json()).toEqual({ ok: true, deactivated: false });
    expect(mocks.delete).toHaveBeenCalledWith({ where: { id: "setup-1" } });
  });
});
