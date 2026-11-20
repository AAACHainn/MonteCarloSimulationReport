import { afterEach, describe, expect, it, vi } from "vitest";
import { advancePaneWindow, createPaneReader } from "./use-replay-pane-bars";
import { REPLAY_HISTORY_BAR_LIMIT, type AggregatedMarketBarData } from "@/lib/market-replay/types";

afterEach(() => vi.unstubAllGlobals());

const bar = (sequence: number) => ({ timestamp: new Date(sequence * 60_000).toISOString(),
  firstSequence: sequence, lastSequence: sequence }) as AggregatedMarketBarData;
const windowAt = (from: number, to: number, context = "pane2") => ({ context, sequence: to,
  visibleBars: Array.from({ length: to - from + 1 }, (_, i) => bar(from + i)), warmupBars: [bar(from - 1)] });

describe("secondary replay windows", () => {
  it("retains the panned window across disjoint reads and resumes with the latest live tail", () => {
    const oldWindow = windowAt(1, 300);
    const firstTail = windowAt(701, 1000);
    const secondTail = windowAt(702, 1001);
    const detached = advancePaneWindow({ live: oldWindow, history: null }, firstTail, true, 1);
    expect(detached).toEqual({ live: firstTail, history: oldWindow });
    const advanced = advancePaneWindow(detached, secondTail, true, 1);
    expect(advanced).toEqual({ live: secondTail, history: oldWindow });
    expect(advancePaneWindow(advanced, secondTail, false, 1)).toEqual({ live: secondTail, history: null });
  });

  it("joins overlapping windows in order and replaces the old forming bar", () => {
    const oldWindow = windowAt(1, 300);
    const latest = windowAt(299, 598);
    const next = advancePaneWindow({ live: oldWindow, history: null }, latest, true, 1);
    expect(next.history).toBeNull();
    expect(next.live?.visibleBars).toEqual(windowAt(1, 598).visibleBars);
    expect(next.live?.visibleBars[298]).toBe(latest.visibleBars[0]);
    expect(next.live?.warmupBars).toBe(oldWindow.warmupBars);
  });

  it("keeps the view at capacity and discards retained windows when the chart context changes", () => {
    const oldWindow = windowAt(1, REPLAY_HISTORY_BAR_LIMIT);
    const window = windowAt(1, REPLAY_HISTORY_BAR_LIMIT + 1);
    const next = advancePaneWindow({ live: oldWindow, history: null }, window, true, 0);
    expect(next.history).toBe(oldWindow);
    expect(next.live?.visibleBars).toHaveLength(600);
    expect(next.live?.warmupBars).toEqual([]);
    const newContext = windowAt(800, 1099, "pane2:new-period");
    expect(advancePaneWindow(next, newContext, true, 0)).toEqual({ live: newContext, history: null });
  });
});

describe("shared replay pane window reader", () => {
  it("shares requests and results only within the same dataset and window version", async () => {
    const payload = { visibleBars: [], warmupBars: [] };
    const fetcher = vi.fn(async () => Response.json(payload));
    vi.stubGlobal("fetch", fetcher);
    const read = createPaneReader();
    const one = read("/window", "version-1");
    const two = read("/window", "version-1");
    expect(two.result).toBe(one.result);
    expect(await one.result).toEqual(payload);
    expect(await read("/window", "version-1").result).toEqual(payload);
    expect(fetcher).toHaveBeenCalledTimes(1);
    await read("/window", "version-2").result;
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("cancels when the last chart that needs a window is hidden", async () => {
    const signals: AbortSignal[] = [];
    vi.stubGlobal("fetch", vi.fn((_input: string, options: RequestInit) => {
      const signal = options.signal;
      if (signal) signals.push(signal);
      return new Promise<Response>((_resolve, reject) => {
        signal?.addEventListener("abort", () => reject(signal?.reason), { once: true });
      });
    }));
    const read = createPaneReader();
    const one = read("/window", "shared");
    const two = read("/window", "shared");
    const rejected = expect(one.result).rejects.toMatchObject({ name: "AbortError" });
    one.release();
    expect(signals[0]?.aborted).toBe(false);
    two.release();
    expect(signals[0]?.aborted).toBe(true);
    await rejected;
  });
});
