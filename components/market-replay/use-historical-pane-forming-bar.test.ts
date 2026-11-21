import { describe, expect, it, vi } from "vitest";
import { chartBarsBeforeHiddenBoundary, chartHiddenSeriesData } from "@/lib/market-replay/chart-hide-after";
import type { AggregatedMarketBarData, MarketDatasetSummary } from "@/lib/market-replay/types";
import type { WindowPayload } from "./replay-client-shared";
import { prepareHistoricalFormingBar, readHistoricalFormingBar, useHistoricalPaneFormingBar } from "./use-historical-pane-forming-bar";

const hooks = vi.hoisted(() => ({
  index: 0,
  values: new Map<number, unknown>(),
  effects: new Map<number, { dependencies: unknown[]; cleanup?: () => void }>(),
  pending: [] as (() => void)[],
}));

vi.mock("react", () => ({
  useState(initial: unknown) {
    const index = hooks.index++;
    if (!hooks.values.has(index)) hooks.values.set(index, initial);
    return [hooks.values.get(index), (next: unknown) => hooks.values.set(index, typeof next === "function" ? next(hooks.values.get(index)) : next)];
  },
  useRef(current: unknown) {
    const index = hooks.index++;
    if (!hooks.values.has(index)) hooks.values.set(index, { current });
    return hooks.values.get(index);
  },
  useEffect(effect: () => (() => void) | undefined, dependencies: unknown[]) {
    const index = hooks.index++;
    const previous = hooks.effects.get(index);
    if (previous && dependencies.every((value, i) => Object.is(value, previous.dependencies[i]))) return;
    hooks.pending.push(() => {
      previous?.cleanup?.();
      hooks.effects.set(index, { dependencies, cleanup: effect() });
    });
  },
}));

const dataset = { id: "history", sourceIntervalSeconds: 60, dataVersion: 1,
  symbol: "ES", timezone: "America/Chicago", tradingWeekdays: [1, 2, 3, 4, 5] } as MarketDatasetSummary;
const period = 300;
const session = "RTH" as const;

function bar(first: number, last: number, high: number, volume: number): AggregatedMarketBarData {
  return { timestamp: new Date(first * 60_000).toISOString(), bucketEnd: new Date((first + 5) * 60_000).toISOString(),
    firstSequence: first, lastSequence: last, sourceCount: last - first + 1, expectedCount: 5,
    open: 100, high, low: 99, close: high - 1, volume, status: last - first === 4 ? "COMPLETE" : "FORMING" };
}

function windowWith(visibleBars: AggregatedMarketBarData[]): WindowPayload {
  return { visibleBars, warmupBars: [], lastSourceBar: null };
}

describe("forming history candles in a slower pane", () => {
  it("updates the same five-minute candle as the main pane reveals bars and keeps later OHLCV hidden", async () => {
    const closed = bar(0, 4, 103, 5);
    const eventual = bar(5, 9, 150, 100);
    const future = bar(10, 14, 160, 200);
    const bars = [closed, eventual, future];
    const reader = vi.fn((url: string) => {
      const params = new URL(url, "http://localhost").searchParams;
      expect(params.get("visibleCount")).toBe("1");
      expect(params.get("warmupCount")).toBe("0");
      expect(params.get("displaySession")).toBe(session);
      const cursor = Number(params.get("endSequence"));
      return { result: Promise.resolve(windowWith([bar(5, cursor, 102 + cursor - 5, cursor - 4)])), release: vi.fn() };
    });
    const config = { dataset, period, session, reader };
    const signal = new AbortController().signal;
    for (const cursor of [5, 6, 7, 8]) {
      const forming = await readHistoricalFormingBar(config, eventual, cursor, signal);
      expect(forming).toMatchObject({ status: "FORMING", timestamp: eventual.timestamp, lastSequence: cursor,
        high: 102 + cursor - 5, volume: cursor - 4 });
      const revealed = chartBarsBeforeHiddenBoundary(bars, { bar: forming!, displayIntervalSeconds: period, displaySession: session }, period, session);
      expect(revealed).toEqual([closed, forming]);
      const series = chartHiddenSeriesData(bars, revealed);
      expect(series.candles[1]).toMatchObject({ high: forming!.high });
      expect(series.volumes[1]).toMatchObject({ value: forming!.volume });
      expect(series.candles[2]).not.toHaveProperty("high");
      expect(series.volumes[2]).not.toHaveProperty("value");
    }
    expect(await readHistoricalFormingBar(config, eventual, 9, signal)).toBeNull();
    const completed = chartBarsBeforeHiddenBoundary(bars, { bar: bar(9, 9, 150, 90), displayIntervalSeconds: 60, displaySession: session }, period, session);
    expect(completed).toEqual([closed, eventual]);
    expect(reader).toHaveBeenCalledTimes(4);
  });

  it("rejects a response that includes future sources or is from another session bucket", async () => {
    const bucket = bar(5, 9, 150, 100);
    const reader = vi.fn()
      .mockReturnValueOnce({ result: Promise.resolve(windowWith([bucket])), release: vi.fn() })
      .mockReturnValueOnce({ result: Promise.resolve(windowWith([bar(0, 4, 110, 20)])), release: vi.fn() });
    const config = { dataset, period, session, reader };
    const signal = new AbortController().signal;
    expect(await readHistoricalFormingBar(config, bucket, 6, signal)).toBeNull();
    expect(await readHistoricalFormingBar(config, bucket, 6, signal)).toBeNull();
  });

  it("releases an in-flight request and ignores its result after leaving playback", async () => {
    const controller = new AbortController();
    const release = vi.fn();
    let complete: (window: WindowPayload) => void = () => {};
    const reader = vi.fn(() => ({ result: new Promise<WindowPayload>(resolve => { complete = resolve; }), release }));
    const read = readHistoricalFormingBar({ dataset, period, session, reader }, bar(5, 9, 150, 100), 6, controller.signal);
    controller.abort();
    complete(windowWith([bar(5, 6, 110, 20)]));
    await expect(read).rejects.toMatchObject({ name: "AbortError" });
    expect(release).toHaveBeenCalledOnce();
  });

  it("renders a prepared snapshot at commit and retains it through a failed retry", async () => {
    const charts = [bar(5, 9, 150, 100)];
    const first = bar(5, 6, 104, 20);
    const second = bar(5, 7, 108, 30);
    const prepared = await prepareHistoricalFormingBar({ dataset, period, session,
      reader: () => ({ result: Promise.resolve(windowWith([first])), release: vi.fn() }) }, charts, 6, new AbortController().signal);
    const requests: { resolve: (value: WindowPayload) => void; reject: (cause: Error) => void }[] = [];
    const reader = vi.fn(() => ({ result: new Promise<WindowPayload>((resolve, reject) => requests.push({ resolve, reject })), release: vi.fn() }));
    const Render = (cursor: number) => {
      hooks.index = 0;
      hooks.pending = [];
      const view = useHistoricalPaneFormingBar({ dataset, period, session, reader, bars: charts, cursor, revision: 1, prepared });
      hooks.pending.forEach(effect => effect());
      return view;
    };

    try {
      expect(Render(6).bar).toEqual(first);
      expect(reader).not.toHaveBeenCalled();
      expect(Render(7).bar).toEqual(first);
      requests[0].reject(new Error("first failure"));
      await vi.waitFor(() => expect(Render(7)).toMatchObject({ bar: first, error: "first failure" }));
      Render(7).retry();
      expect(Render(7)).toMatchObject({ bar: first, error: null });
      requests[1].reject(new Error("retry failed"));
      await vi.waitFor(() => expect(Render(7)).toMatchObject({ bar: first, error: "retry failed" }));
      Render(7).retry();
      expect(Render(7).bar).toEqual(first);
      requests[2].resolve(windowWith([second]));
      await vi.waitFor(() => expect(Render(7)).toMatchObject({ bar: second, error: null }));
      expect(reader).toHaveBeenCalledTimes(3);
    } finally {
      hooks.effects.forEach(effect => effect.cleanup?.());
      hooks.effects.clear();
      hooks.values.clear();
    }
  });
});
