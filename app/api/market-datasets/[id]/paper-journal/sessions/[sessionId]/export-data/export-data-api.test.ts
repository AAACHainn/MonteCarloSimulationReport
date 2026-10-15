import { replayRouteBusinessScope } from "@/test-utils/replay-route-business-scope";
vi.mock("@/lib/replay-sessions/scope", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/replay-sessions/scope")>(), ...replayRouteBusinessScope,
}));
import { beforeEach, describe, expect, it, vi } from "vitest";
import { pdfEntry, pdfSnapshot } from "@/lib/paper-trading/pdf-test-fixtures";
import { copy } from "@/lib/i18n";
const mocks = vi.hoisted(() => ({ dataset: vi.fn(), session: vi.fn(), transaction: vi.fn() }));
vi.mock("@/lib/db", () => ({ prisma: { $transaction: mocks.transaction } }));
import { GET } from "./route";
const context = { params: Promise.resolve({ id: "dataset-qa", sessionId: "session-qa" }) };
beforeEach(() => {
  vi.clearAllMocks();
  const d = pdfSnapshot().dataset;
  mocks.dataset.mockResolvedValue({ ...d, tradingWeekdays: d.tradingWeekdays.join(","), startTime: new Date(d.startTime), endTime: new Date(d.endTime), createdAt: new Date(d.createdAt) });
  mocks.session.mockResolvedValue({ id: "session-qa", name: "复盘测试", archivedAt: null, createdAt: new Date(), entries: [1,2,3].map((no) => {
    const e = pdfEntry(no, no * 10, no * 10 + 5, { direction: no === 2 ? "SHORT" : "LONG" });
    return { ...e, accountNo: e.no, no: e.globalNo, openedAt: new Date(e.openedAt), closedAt: new Date(e.closedAt) };
  }) });
  mocks.transaction.mockImplementation((fn) => fn({ marketDataset: { findUnique: mocks.dataset }, replayJournalSession: { findFirst: mocks.session } }));
});
describe("PDF filtered snapshot API", () => {
  it("applies filters to all records, ignoring pagination and display columns", async () => {
    const response = await GET(new Request("http://localhost/api?directions=LONG&page=2&take=1&columns=no"), context);
    const data = await response.json();
    expect(data.entries.map((e: { no: number }) => e.no)).toEqual([1,3]);
    expect(data.session.totalCount).toBe(3); expect(data.summary.tradeCount).toBe(2); expect(data.entries[0].review).toBeTruthy();
    expect(data.dataset.progress).toBeNull(); expect(data.endSequence).toBe(999); expect(response.headers.get("cache-control")).toBe("no-store");
    expect(mocks.transaction).toHaveBeenCalledTimes(1);
  });
  it("reuses expression, setup, reason and result filtering", async () => {
    const response = await GET(new Request("http://localhost/api?initialRiskAbr=p%3E0.4&setupOptionIds=setup-qa&tradeReasonIds=reason-qa&results=W"), context);
    expect((await response.json()).entries).toHaveLength(3);
  });
  it.each(["YES", "NO"])("exports only entries matching checklist use (%s)", async (selection) => {
    const session = await mocks.session();
    session.entries[0].discipline = JSON.stringify({
      strategyId: "setup-qa", strategyName: "突破练习", checklistVersion: 1,
      checklist: [{ id: "risk", text: "确认风险金额" }], confirmedAt: "2026-10-14T00:00:00.000Z",
    });
    mocks.session.mockResolvedValue(session);

    const response = await GET(new Request(`http://localhost/api?checklistUsed=${selection}&page=2&take=1`), context);
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.entries.map((e: { no: number }) => e.no)).toEqual(selection === "YES" ? [1] : [2, 3]);
    expect(data.session.totalCount).toBe(3);
    expect(data.summary.tradeCount).toBe(selection === "YES" ? 1 : 2);
    expect(data.filterDescription).toBe(`${copy.paperTrading.checklistUsed}: ${selection === "YES" ? copy.paperTrading.checklistYes : copy.paperTrading.checklistNo}`);
  });

  it("returns an empty filtered result with correct totals", async () => {
    const response = await GET(new Request("http://localhost/api?results=L"), context);
    const data = await response.json(); expect(data.entries).toHaveLength(0); expect(data.session.totalCount).toBe(3); expect(data.summary.tradeCount).toBe(0);
  });
  it("rejects malformed expressions and missing sessions", async () => {
    expect((await GET(new Request("http://localhost/api?initialRiskAbr=invalid"), context)).status).toBe(400);
    mocks.session.mockResolvedValue(null); expect((await GET(new Request("http://localhost/api"), context)).status).toBe(404);
  });
});
