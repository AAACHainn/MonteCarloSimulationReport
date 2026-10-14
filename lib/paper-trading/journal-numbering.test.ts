import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ query: vi.fn(), scope: vi.fn() }));
vi.mock("@/lib/db", () => ({ prisma: { $queryRaw: mocks.query } }));
vi.mock("@/lib/replay-sessions/scope", async (original) => ({
  ...await original<typeof import("@/lib/replay-sessions/scope")>(), getReplayScope: mocks.scope,
}));
import { withReplayJournalDisplayNumbers } from "./journal-numbering";

beforeEach(() => { vi.clearAllMocks(); mocks.scope.mockReturnValue({ projectionId: "current-result" }); });
describe("current-result journal display numbering", () => {
  it("decorates a filtered subset with the full result's ordinal, retaining identity and stored records", async () => {
    const entry = { id: "survivor", accountNo: 6, no: 91, review: "复盘内容", cycleKey: "cycle-1" };
    mocks.query.mockResolvedValue([{ id: "other", displayNo: BigInt(1) }, { id: "survivor", displayNo: BigInt(2) }]);
    expect(await withReplayJournalDisplayNumbers([entry])).toEqual([{ ...entry, accountNo: 2 }]);
    expect(entry.accountNo).toBe(6);
    const [sql, projection] = mocks.query.mock.calls[0];
    expect(sql.join("?")).toContain("PARTITION BY journalSessionId ORDER BY accountNo ASC, id ASC");
    expect(projection).toBe("current-result");
  });
  it("keeps window order and uses global session ordinals rather than restarting each window", async () => {
    mocks.query.mockResolvedValue([{ id: "first", displayNo: BigInt(1) }, { id: "eleventh", displayNo: BigInt(11) }, { id: "twelfth", displayNo: BigInt(12) }]);
    expect(await withReplayJournalDisplayNumbers([{ id: "twelfth", accountNo: 24 }, { id: "eleventh", accountNo: 22 }]))
      .toEqual([{ id: "twelfth", accountNo: 12 }, { id: "eleventh", accountNo: 11 }]);
  });
  it("supports an explicitly selected server-page projection", async () => {
    mocks.query.mockResolvedValue([{ id: "entry", displayNo: 1 }]);
    expect(await withReplayJournalDisplayNumbers([{ id: "entry", accountNo: 6 }], "page-result")).toEqual([{ id: "entry", accountNo: 1 }]);
    expect(mocks.query.mock.calls[0][1]).toBe("page-result");
  });
  it("rejects stale or foreign records missing from the selected result", async () => {
    mocks.query.mockResolvedValue([]);
    await expect(withReplayJournalDisplayNumbers([{ id: "foreign", accountNo: 6 }])).rejects.toMatchObject({ code: "SESSION_CONFLICT", status: 409 });
  });
  it("avoids queries for empty results and preserves unscoped internal legacy readers", async () => {
    expect(await withReplayJournalDisplayNumbers([])).toEqual([]);
    mocks.scope.mockReturnValue(undefined);
    const entries = [{ id: "legacy", accountNo: 6 }];
    expect(await withReplayJournalDisplayNumbers(entries)).toBe(entries);
    expect(mocks.query).not.toHaveBeenCalled();
  });
});
