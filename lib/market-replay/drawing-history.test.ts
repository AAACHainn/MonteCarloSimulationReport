import { describe, expect, it, vi } from "vitest";
import { DrawingHistory, cloneDrawingValue, sameDrawingSnapshot, type DrawingChange } from "./drawing-history";
import { DEFAULT_TREND_LINE_STYLE, DEFAULT_TEXT_STYLE, type MarketDrawing, type TrendLineDrawing } from "./chart-drawings";

const date = "2026-11-08T00:00:00.000Z";
const anchor = { timestamp: date, sourceSequence: 0, price: 100 };
const line = (id = "a", width = 2): TrendLineDrawing => ({ id, datasetId: "dataset", type: "TREND_LINE", createdAt: date, updatedAt: date,
  geometry: { start: anchor, end: { ...anchor, timestamp: "2026-11-08T00:01:00.000Z", price: 102, sourceSequence: 1 } }, style: { ...DEFAULT_TREND_LINE_STYLE, width } });
const text = (value: string): MarketDrawing => ({ id: "text", datasetId: "dataset", type: "TEXT", createdAt: date, updatedAt: date,
  geometry: { anchor, text: value }, style: DEFAULT_TEXT_STYLE });
const response = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });
function backend(initial: MarketDrawing[] = []) {
  const remote = new Map(initial.map(item => [item.id, cloneDrawingValue(item)]));
  const fetcher = vi.fn<typeof fetch>(async (_url, init) => {
    const { changes } = JSON.parse(String(init?.body)) as { changes: DrawingChange[] };
    if (!changes.every(change => sameDrawingSnapshot(remote.get(change.id) ?? null, change.before))) return response({}, 409);
    for (const change of changes) { if (change.after) remote.set(change.id, cloneDrawingValue(change.after)); else remote.delete(change.id); }
    return response({ drawings: changes.flatMap(change => change.after ? [change.after] : []), deletedIds: changes.filter(change => !change.after).map(change => change.id) });
  });
  return { remote, fetcher };
}

describe("page-local drawing history", () => {
  it("keeps 100 complete operations, deep copies snapshots, ignores no-ops and clears redo on a new edit", async () => {
    const history = new DrawingHistory();
    for (let index = 0; index < 105; index++) history.record([{ id: String(index), before: null, after: line(String(index)) }], "create");
    const { fetcher } = backend(Array.from({ length: 105 }, (_, index) => line(String(index))));
    for (let index = 0; index < 100; index++) await history.travel("undo", fetcher, "dataset");
    expect(history.getSnapshot().undo).toBeNull(); expect(fetcher).toHaveBeenCalledTimes(100);
    const original = line(); history.record([{ id: "a", before: null, after: original }], "paste");
    original.geometry.start.price = 999;
    expect(history.getSnapshot().undo!.changes[0].after!.geometry).not.toEqual(original.geometry);
    expect(history.getSnapshot().redo).toBeNull();
    const current = history.getSnapshot().undo;
    history.record([{ id: "a", before: line(), after: line() }], "modify"); expect(history.getSnapshot().undo).toBe(current);
  });
  it("undoes and redoes a clear as one batch, leaving later unrelated objects alone", async () => {
    const history = new DrawingHistory(), before = [line("a"), line("b")];
    history.record(before.map(item => ({ id: item.id, before: item, after: null })), "clear");
    const { remote, fetcher } = backend([line("from-other-tab")]);
    await history.travel("undo", fetcher, "dataset");
    expect([...remote.keys()].sort()).toEqual(["a", "b", "from-other-tab"]);
    expect(history.getSnapshot().undo).toBeNull(); expect(history.getSnapshot().redo?.action).toBe("clear");
    await history.travel("redo", fetcher, "dataset"); expect([...remote.keys()]).toEqual(["from-other-tab"]);
  });
  it("groups text autosaves, including a new object's null before snapshot", async () => {
    const history = new DrawingHistory(); history.setTextGroup("editor");
    history.record([{ id: "text", before: null, after: text("first") }], "create");
    history.record([{ id: "text", before: text("first"), after: text("last") }], "modify");
    expect(history.getSnapshot().undo).toBeNull(); history.setTextGroup(null);
    expect(history.getSnapshot().undo?.changes).toEqual([{ id: "text", before: null, after: text("last") }]);
    const { remote, fetcher } = backend([text("last")]); await history.travel("undo", fetcher, "dataset"); expect(remote.size).toBe(0);
    await history.travel("redo", fetcher, "dataset"); expect(remote.get("text")).toEqual(text("last"));
  });
  it("records confirmed HTTP responses only and groups DELETE ids without deleting a concurrent addition", async () => {
    const history = new DrawingHistory();
    await history.observe(async () => response({ drawings: [line("a"), line("b")] }), "/api/market-datasets/dataset/drawings");
    await history.observe(async () => response({}, 500), "/api/market-datasets/dataset/drawings/a", { method: "DELETE" });
    expect(history.getSnapshot().undo).toBeNull();
    await history.observe(async () => response({ drawings: [line("c")] }), "/api/market-datasets/dataset/drawings", { method: "DELETE", body: JSON.stringify({ ids: ["a", "b"] }) });
    expect(history.getSnapshot().undo?.changes.map(change => change.id)).toEqual(["a", "b"]);
    expect(history.getSnapshot().undo?.action).toBe("clear");
  });
  it("keeps history on a network failure, but invalidates it when another writer changed the object", async () => {
    const history = new DrawingHistory(); history.record([{ id: "a", before: line("a", 2), after: line("a", 3) }], "line-width");
    await expect(history.travel("undo", async () => { throw new Error("offline"); }, "dataset")).rejects.toThrow("offline");
    expect(history.getSnapshot().undo?.action).toBe("line-width"); expect(history.getSnapshot().busy).toBe(false);
    const { remote, fetcher } = backend([line("a", 4)]);
    await expect(history.travel("undo", fetcher, "dataset")).rejects.toThrow("DRAWING_HISTORY_CONFLICT");
    expect(remote.get("a")).toEqual(line("a", 4)); expect(history.getSnapshot().undo).toBeNull(); expect(history.getSnapshot().redo).toBeNull();
  });
  it("keeps separate pages independent and compares editable snapshots despite changed update timestamps/key order", () => {
    const first = new DrawingHistory(), second = new DrawingHistory(); first.record([{ id: "a", before: null, after: line() }], "create");
    expect(second.getSnapshot().undo).toBeNull();
    expect(sameDrawingSnapshot(line(), { ...line(), updatedAt: "2026-12-01T00:00:00.000Z" })).toBe(true);
  });
  it("uses transaction snapshots rather than a stale browser cache for updates and clears", async () => {
    const history = new DrawingHistory(); history.seed([line("a", 1)]);
    await history.observe(async () => response({ drawing: line("a", 3), historyBefore: line("a", 2) }), "/api/market-datasets/dataset/drawings/a", { method: "PATCH" });
    expect(history.getSnapshot().undo?.changes[0].before?.style).toMatchObject({ width: 2 });
    await history.observe(async () => response({ drawings: [], historyBefore: [line("a", 4)] }), "/api/market-datasets/dataset/drawings", { method: "DELETE", body: JSON.stringify({ ids: ["a"] }) });
    expect(history.getSnapshot().undo?.changes[0].before?.style).toMatchObject({ width: 4 });
  });
  it("does not let a late response from an unmounted page populate a fresh history", async () => {
    const history = new DrawingHistory(); let finish!: (response: Response) => void;
    const pending = history.observe(() => new Promise<Response>(resolve => { finish = resolve; }), "/api/market-datasets/dataset/drawings", { method: "POST" });
    history.reset(); finish(response({ drawing: line() }, 201)); await pending;
    expect(history.getSnapshot().undo).toBeNull();
  });
});
