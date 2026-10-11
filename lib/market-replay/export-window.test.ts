import { beforeEach, describe, expect, it, vi } from "vitest";
import { pdfBars } from "@/lib/paper-trading/pdf-test-fixtures";
import { resolveDisplaySession } from "./chart-sessions";
const mocks = vi.hoisted(() => ({ unique: vi.fn(), first: vi.fn(), many: vi.fn(), blocks: vi.fn() }));
vi.mock("@/lib/db", () => ({ prisma: { marketBar: { findUnique: mocks.unique, findFirst: mocks.first, findMany: mocks.many }, marketBarBlock: { findMany: mocks.blocks } } }));
import { readExportWindow } from "./export-window";

let rows: { sequence: number; timestamp: Date; open: number; high: number; low: number; close: number; volume: number | null }[];
function matches(row: typeof rows[number], where: { sequence?: { lte?: number }; timestamp?: { gte?: Date; lt?: Date } }) {
  return (where.sequence?.lte === undefined || row.sequence <= where.sequence.lte)
    && (!where.timestamp?.gte || row.timestamp >= where.timestamp.gte)
    && (!where.timestamp?.lt || row.timestamp < where.timestamp.lt);
}
const options = { datasetId: "d", anchorSequence: 5, direction: "forward" as const, count: 3, warmupCount: 1, endSequence: 29, sourceSeconds: 60, displaySeconds: 180, session: { mode: "TWENTY_FOUR_SEVEN" as const, timezone: "UTC", openMinute: null, closeMinute: null, weekdays: [1,2,3,4,5,6,7] } };
beforeEach(() => {
  vi.clearAllMocks();
  rows = pdfBars(30).map((b) => ({ sequence: b.firstSequence, timestamp: new Date(b.timestamp), open: b.open, high: b.high, low: b.low, close: b.close, volume: b.volume }));
  mocks.unique.mockImplementation(({ where }) => rows.find((b) => b.sequence === where.datasetId_sequence.sequence) ?? null);
  mocks.first.mockImplementation(({ where, orderBy }) => {
    const found = rows.filter((b) => matches(b, where)); return (orderBy.timestamp === "asc" ? found[0] : found.at(-1)) ?? null;
  });
  mocks.many.mockImplementation(({ where, take }) => rows.filter((b) => matches(b, where)).slice(0, take));
  mocks.blocks.mockResolvedValue([]);
});
describe("read-only export window", () => {
  it("completes the anchor bucket and separates EMA warmup", async () => {
    const result = await readExportWindow(options);
    expect(result.bars.map((b) => [b.firstSequence,b.lastSequence])).toEqual([[3,5],[6,8],[9,11]]);
    expect(result.warmupBars.map((b) => b.firstSequence)).toEqual([0]);
    expect(result.bars.every((b) => b.status === "COMPLETE")).toBe(true);
    expect(result.nextSequence).toBe(12); expect(result.previousSequence).toBe(2);
    expect(mocks.many.mock.calls.every(([q]) => q.take === 4096)).toBe(true);
  });
  it("returns backwards bars chronologically and never reads past the snapshot", async () => {
    const result = await readExportWindow({ ...options, direction: "backward", anchorSequence: 7, endSequence: 7, warmupCount: 0 });
    expect(result.bars.map((b) => b.firstSequence)).toEqual([0,3,6]);
    expect(result.bars.at(-1)!.lastSequence).toBe(7); expect(result.bars.at(-1)!.status).toBe("INCOMPLETE");
    expect(result.nextSequence).toBeNull();
  });
  it("counts real RTH bars across a weekend and daylight-saving transition", async () => {
    const times = ["2026-10-30T20:13:00Z","2026-10-30T20:14:00Z","2026-10-30T22:00:00Z","2026-11-02T14:30:00Z","2026-11-02T14:31:00Z"];
    rows = times.map((t,i) => ({ sequence:i,timestamp:new Date(t),open:100,high:101,low:99,close:100,volume:1 }));
    const session = resolveDisplaySession({ symbol:"ES", timeframe:"1m",sourceIntervalSeconds:60,timezone:"UTC",sessionMode:"TWENTY_FOUR_SEVEN",sessionOpenMinute:null,sessionCloseMinute:null,tradingWeekdays:"1,2,3,4,5" }, "RTH")!;
    const result = await readExportWindow({ ...options, anchorSequence: 1, endSequence: 4, sourceSeconds: 60, displaySeconds: 60, session });
    expect(result.bars.map((b) => b.firstSequence)).toEqual([1,3,4]);
    expect(result.warmupBars.map((b) => b.firstSequence)).toEqual([0]);
  });
  it("uses existing blocks without building summaries or reading covered raw rows", async () => {
    const start = Date.UTC(2026,8,8);
    rows = [0,4095].map((n) => ({ sequence:n, timestamp:new Date(start+n*1000),open:100,high:101,low:99,close:100,volume:1 }));
    mocks.blocks.mockResolvedValue(Array.from({ length:8 },(_,i) => ({ startSequence:i*512,endSequence:i*512+511,startTime:new Date(start+i*512000),endTime:new Date(start+(i*512+511)*1000),open:100,high:101,low:99,close:100,volume:512,volumeCount:512,barCount:512 })));
    const result = await readExportWindow({ ...options, anchorSequence: 0, endSequence: 20_000_000-1, sourceSeconds:1,displaySeconds:4096,count:1,warmupCount:0 });
    expect(result.bars[0].sourceCount).toBe(4096); expect(result.bars[0].status).toBe("COMPLETE");
    expect(mocks.many).not.toHaveBeenCalled();
    expect(mocks.blocks).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ blockSize:512 }) }));
  });
});
