import JSZip from "jszip";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ findFirst: vi.fn() }));

vi.mock("@/lib/db", () => ({
  prisma: {
    replayJournalSession: { findFirst: mocks.findFirst },
  },
}));

import { GET } from "./route";

const context = { params: Promise.resolve({ id: "dataset-1", sessionId: "session-1" }) };

function entry(accountNo: number, setupName: string, reasonName: string) {
  return {
    id: `entry-${accountNo}`,
    no: accountNo + 100,
    accountNo,
    journalSessionId: "session-1",
    lotId: `lot-${accountNo}`,
    direction: accountNo === 1 ? "LONG" : "SHORT",
    quantity: 2,
    openedSequence: 10 * accountNo,
    openedAt: new Date(`2026-09-${String(accountNo).padStart(2, "0")}T01:00:00.000Z`),
    closedSequence: 10 * accountNo + 5,
    closedAt: new Date(`2026-09-${String(accountNo).padStart(2, "0")}T02:00:00.000Z`),
    entryPrice: 100,
    entryOrderType: "MARKET",
    exitPrice: accountNo === 1 ? 104 : 98,
    initialStopPrice: 98,
    abrValue: 4,
    abrLength: 8,
    displayIntervalSeconds: 300,
    displaySession: "RTH",
    displayUtcOffsetMinutes: 480,
    priceTickSize: 0.25,
    initialRisk: 2,
    actualRisk: 2.5,
    gainLoss: accountNo === 1 ? 4 : -2,
    setupOptionId: `setup-${accountNo}`,
    setupOption: { name: setupName },
    tradeReasons: [{ id: `reason-${accountNo}`, name: reasonName }],
    createdAt: new Date("2026-09-23T00:00:00.000Z"),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.findFirst.mockResolvedValue({
    id: "session-1",
    name: "上午突破练习",
    archivedAt: null,
    entries: [entry(1, "突破", "顺势"), entry(2, "回调", "结构")],
  });
});

describe("replay journal Excel export API", () => {
  it("exports every trade and every journal column for the selected session", async () => {
    const response = await GET(new Request("http://localhost/api"), context);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    expect(response.headers.get("content-disposition")).toContain("filename*=UTF-8''");
    expect(mocks.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "session-1", datasetId: "dataset-1" },
    }));

    const workbook = await JSZip.loadAsync(await response.arrayBuffer());
    const sheet = await workbook.file("xl/worksheets/sheet1.xml")!.async("string");
    expect(sheet).toContain('dimension ref="A1:P3"');
    expect(sheet).toContain('autoFilter ref="A1:P3"');
    expect(sheet).toContain("Setup");
    expect(sheet).toContain("交易理由");
    expect(sheet).toContain("突破");
    expect(sheet).toContain("顺势");
    expect(sheet).toContain("回调");
    expect(sheet).toContain("结构");
    expect(sheet.match(/<row r=/g)).toHaveLength(3);
  });

  it("returns 404 when the session does not belong to the dataset", async () => {
    mocks.findFirst.mockResolvedValue(null);
    const response = await GET(new Request("http://localhost/api"), context);
    expect(response.status).toBe(404);
  });
});
