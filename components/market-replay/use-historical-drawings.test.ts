import { webcrypto } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useHistoricalDrawings } from "./use-historical-drawings";
import { DEFAULT_RECTANGLE_STYLE, DEFAULT_TEXT_STYLE, type MarketDrawing, type TextDrawing } from "@/lib/market-replay/chart-drawings";

// Keep state/ref slots across explicit renders; exercise network and storage behavior without adding a DOM dependency.
const hooks = vi.hoisted(() => ({ index: 0, slots: [] as unknown[], effects: [] as Array<() => () => void> }));
vi.mock("react", () => ({
  useState: (initial: unknown) => {
    const index = hooks.index++;
    if (!(index in hooks.slots)) hooks.slots[index] = initial;
    return [hooks.slots[index], (value: unknown) => { hooks.slots[index] = typeof value === "function" ? value(hooks.slots[index]) : value; }];
  },
  useRef: (initial: unknown) => { const index = hooks.index++; if (!(index in hooks.slots)) hooks.slots[index] = { current: initial }; return hooks.slots[index]; },
  useCallback: (callback: unknown) => callback,
  useEffect: (effect: () => () => void) => hooks.effects.push(effect),
}));

const original: MarketDrawing = { id: "original", datasetId: "dataset", type: "RECTANGLE", style: DEFAULT_RECTANGLE_STYLE,
  geometry: { start: { timestamp: "2026-10-01T00:00:00.000Z", sourceSequence: 0, price: 100 },
    end: { timestamp: "2026-10-01T00:01:00.000Z", sourceSequence: 1, price: 101 } },
  createdAt: "2026-10-01T00:00:00.000Z", updatedAt: "2026-10-01T00:00:00.000Z" };
let remote: MarketDrawing[];
let storage: { getItem: ReturnType<typeof vi.fn>; setItem: ReturnType<typeof vi.fn>; removeItem: ReturnType<typeof vi.fn> };
let fetcher: ReturnType<typeof vi.fn<typeof fetch>>;
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });

beforeEach(() => {
  hooks.index = 0; hooks.slots = []; hooks.effects = [];
  remote = [structuredClone(original)];
  storage = { getItem: vi.fn(), setItem: vi.fn(), removeItem: vi.fn() };
  vi.stubGlobal("window", { localStorage: storage });
  // Same UUID path used over ordinary HTTP, where randomUUID is unavailable.
  vi.stubGlobal("crypto", { getRandomValues: webcrypto.getRandomValues.bind(webcrypto) });
  fetcher = vi.fn(async (url, init) => {
    const method = init?.method || "GET";
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    if (method === "POST") {
      const drawing = { ...original, ...body, id: "saved-new" } as MarketDrawing; remote.push(drawing); return json({ drawing }, 201);
    }
    if (method === "PATCH") {
      const id = String(url).split("/").at(-1); remote = remote.map(item => item.id === id ? { ...item, ...body } as MarketDrawing : item);
      return json({ drawing: remote.find(item => item.id === id) });
    }
    if (method === "DELETE") {
      const ids: string[] = body.ids ?? [String(url).split("/").at(-1)]; remote = remote.filter(item => !ids.includes(item.id));
      return json({ ok: true, drawings: remote });
    }
    return json({ drawings: remote });
  });
});
afterEach(() => vi.unstubAllGlobals());

function harness() {
  const RenderHook = () => { hooks.index = 0; return useHistoricalDrawings({ datasetId: "dataset", fetch: fetcher }); };
  RenderHook(); const effect = hooks.effects.shift()!; const cleanup = effect();
  return { render: RenderHook, effect, cleanup, ready: async () => { await vi.waitFor(() => expect(RenderHook().loaded).toBe(true)); return RenderHook(); } };
}

describe("historical drawing persistence", () => {
  it("keeps text creation out of the optimistic collection during delayed POST and reconciles once", async () => {
    const app = harness(); const api = await app.ready();
    let resolve!: (response: Response) => void;
    fetcher.mockImplementationOnce(() => new Promise<Response>(done => { resolve = done; }));
    const candidate = { datasetId: "dataset", type: "TEXT" as const, geometry: { anchor: original.geometry.start, text: "文字" }, style: DEFAULT_TEXT_STYLE };
    const operation = api.create(candidate);
    expect(app.render().drawings).toEqual([original]); expect(app.render().busy).toBe(true);
    expect(await app.render().create(candidate)).toBeNull();
    const saved: TextDrawing = { ...candidate, id: "text-saved", createdAt: original.createdAt, updatedAt: original.updatedAt };
    resolve(json({ drawing: saved }, 201)); expect(await operation).toEqual(saved);
    expect(app.render().drawings).toEqual([original, saved]);
    expect(await app.render().update(saved.id, { geometry: saved.geometry, style: saved.style })).toBe(true);
    expect(fetcher.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(1);
    expect(fetcher.mock.calls.filter(([, init]) => init?.method === "PATCH")).toHaveLength(0);
  });
  it("ignores late text writes after scope cleanup", async () => {
    const app = harness(); const api = await app.ready();
    let resolve!: (response: Response) => void;
    fetcher.mockImplementationOnce(() => new Promise<Response>(done => { resolve = done; }));
    const candidate = { datasetId: "dataset", type: "TEXT" as const, geometry: { anchor: original.geometry.start, text: "文字" }, style: DEFAULT_TEXT_STYLE };
    const operation = api.create(candidate); app.cleanup();
    resolve(json({ drawing: { ...candidate, id: "late", createdAt: original.createdAt, updatedAt: original.updatedAt } }, 201));
    expect(await operation).toBeNull(); expect(app.render().drawings).toEqual([original]);
  });
  it("uses the server as authority and never merges stale browser originals on reload", async () => {
    storage.getItem.mockReturnValue(JSON.stringify([{ ...original, style: { ...DEFAULT_RECTANGLE_STYLE, fillOpacity: 75 } }, { ...original, id: "history-journal-local" }]));
    const app = harness(); const api = await app.ready();
    expect(api.drawings).toEqual([original]);
    expect(await api.remove(original.id)).toBe(true);
    expect(app.render().drawings).toEqual([]);
    expect(await app.render().refresh()).toBe(true);
    expect(app.render().drawings).toEqual([]);
    expect(storage.getItem).not.toHaveBeenCalled();
    expect(storage.setItem).not.toHaveBeenCalled();
    expect(storage.removeItem).not.toHaveBeenCalled();
    expect(fetcher.mock.calls.filter(([, init]) => init?.method === "DELETE")).toHaveLength(1);
    app.cleanup();
  });
  it("saves creation, geometry, style and clear on the server and preserves changes on reopening", async () => {
    storage.getItem.mockReturnValue("[]");
    const app = harness(); await app.ready();
    expect(app.render().drawings).toEqual([original]);
    expect(await app.render().remove(original.id)).toBe(true);
    expect(app.render().drawings).toEqual([]);
    const drawing = await app.render().create({ datasetId: "dataset", type: "RECTANGLE", style: DEFAULT_RECTANGLE_STYLE, geometry: original.geometry });
    expect(drawing).not.toBeNull(); expect(drawing!.id).toBe("saved-new");
    const geometry = { ...original.geometry, end: { ...original.geometry.end, price: 105 } };
    const style = { ...DEFAULT_RECTANGLE_STYLE, fillOpacity: 35 };
    expect(await app.render().update(drawing!.id, { geometry, style })).toBe(true);
    expect(app.render().drawings[0].geometry).toEqual(geometry);
    expect(remote).toEqual([expect.objectContaining({ id: drawing!.id, geometry, style })]); app.cleanup();
    hooks.slots = []; hooks.effects = []; hooks.index = 0;
    const reopened = harness(); await reopened.ready();
    expect(reopened.render().drawings).toEqual([expect.objectContaining({ id: drawing!.id, geometry, style })]);
    expect(await reopened.render().clear()).toBe(true); expect(remote).toEqual([]);
    expect(await reopened.render().refresh()).toBe(true); expect(reopened.render().drawings).toEqual([]);
    expect(fetcher.mock.calls.flatMap(([, init]) => init?.method ?? [])).toEqual(["DELETE", "POST", "PATCH", "DELETE"]);
    expect(storage.getItem).not.toHaveBeenCalled(); expect(storage.setItem).not.toHaveBeenCalled(); expect(storage.removeItem).not.toHaveBeenCalled();
    reopened.cleanup();
  });
  it("restores failed deletions and releases the pending lock", async () => {
    const app = harness(); await app.ready(); fetcher.mockResolvedValueOnce(json({ error: "delete failed" }, 503));
    expect(await app.render().remove(original.id)).toBe(false);
    expect(app.render().drawings).toEqual([original]); expect(app.render().error).toBe("delete failed"); expect(app.render().busy).toBe(false);
    expect(await app.render().remove(original.id)).toBe(true); expect(app.render().drawings).toEqual([]); app.cleanup();
  });
  it("serializes commits, ignores no-op geometry, and sends a single changed update", async () => {
    const app = harness(); await app.ready();
    expect(await app.render().update(original.id, { geometry: original.geometry })).toBe(true); expect(fetcher).toHaveBeenCalledOnce();
    let resolve!: (response: Response) => void;
    fetcher.mockImplementationOnce(() => new Promise<Response>(done => { resolve = done; }));
    const pending = app.render().update(original.id, { style: { ...DEFAULT_RECTANGLE_STYLE, fillOpacity: 25 } });
    expect(await app.render().clear()).toBe(false); expect(await app.render().refresh()).toBe(false);
    resolve(json({ drawing: { ...original, style: { ...DEFAULT_RECTANGLE_STYLE, fillOpacity: 25 } } }));
    expect(await pending).toBe(true); expect(fetcher).toHaveBeenCalledTimes(2); expect(app.render().busy).toBe(false); app.cleanup();
  });
  it("works when access to browser storage is unavailable", async () => {
    const accessStorage = vi.fn(() => { throw new Error("storage disabled"); });
    vi.stubGlobal("window", Object.defineProperty({}, "localStorage", { get: accessStorage }));
    const app = harness(); await app.ready();
    expect(await app.render().create({ datasetId: "dataset", type: "RECTANGLE", style: DEFAULT_RECTANGLE_STYLE, geometry: original.geometry })).not.toBeNull();
    expect(await app.render().remove(original.id)).toBe(true);
    expect(accessStorage).not.toHaveBeenCalled(); app.cleanup();
  });
  it("loads successfully after the development Strict Mode effect replay", async () => {
    fetcher.mockImplementationOnce((_url, init) => new Promise<Response>((_resolve, reject) => {
      init!.signal!.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
    }));
    const app = harness(); app.cleanup(); const cleanup = app.effect();
    await app.ready(); expect(app.render().busy).toBe(false); expect(app.render().drawings).toEqual([original]); cleanup();
  });
});
