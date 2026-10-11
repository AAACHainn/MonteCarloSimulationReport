import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ find: vi.fn(), read: vi.fn() }));
vi.mock("@/lib/db", () => ({ prisma: { marketDataset: { findUnique: mocks.find } } }));
vi.mock("@/lib/market-replay/export-window", () => ({ readExportWindow: mocks.read }));
import { GET } from "./route";
const dataset = { id: "d", status: "READY", dataVersion: 1, barCount: 1000, symbol: "ES", timeframe: "1m", sourceIntervalSeconds: 60, timezone: "America/Chicago", sessionMode: "TWENTY_FOUR_SEVEN", sessionOpenMinute: null, sessionCloseMinute: null, tradingWeekdays: "1,2,3,4,5" };
const context = { params: Promise.resolve({ id: "d" }) };
const url = "http://localhost/api?anchorSequence=50&endSequence=999&dataVersion=1&displayIntervalSeconds=300&displaySession=RTH";
beforeEach(() => { vi.clearAllMocks(); mocks.find.mockResolvedValue(dataset); mocks.read.mockResolvedValue({ bars: [], warmupBars: [], previousSequence: null, nextSequence: null }); });
describe("PDF read-only window API", () => {
  it("passes the chosen RTH session and snapshot limits to the reader", async () => {
    expect((await GET(new Request(url), context)).status).toBe(200);
    expect(mocks.read).toHaveBeenCalledWith(expect.objectContaining({ endSequence: 999, count: 200, session: expect.objectContaining({ timezone: "America/Chicago", mode: "DAILY_SESSION", openMinute: 510 }) }));
  });
  it("rejects oversized windows and invalid periods", async () => {
    expect((await GET(new Request(url + "&count=201"), context)).status).toBe(400);
    expect((await GET(new Request(url.replace("300", "90")), context)).status).toBe(400);
    expect(mocks.read).not.toHaveBeenCalled();
  });
  it("rejects a changed version before and after reading", async () => {
    mocks.find.mockResolvedValue({ ...dataset, dataVersion: 2 });
    expect((await GET(new Request(url), context)).status).toBe(409); expect(mocks.read).not.toHaveBeenCalled();
    mocks.find.mockResolvedValueOnce(dataset).mockResolvedValueOnce({ dataVersion: 2 });
    expect((await GET(new Request(url), context)).status).toBe(409);
  });
  it("returns 404 if the dataset is removed", async () => {
    mocks.find.mockResolvedValue(null); expect((await GET(new Request(url), context)).status).toBe(404);
  });
});
