import { describe, expect, it, vi } from "vitest";
import { historicalWindowFocusSequence, mergeHistoricalBars, readLaterHistoryWindow, boundedHistoricalPlaybackWindow, commitHistoricalWindowChange } from "./historical-window";
import { createHistoricalPlayback, isHistoricalPlaybackBarReady } from "./historical-playback";
import { calculateEmaSeries } from "./ema";
import { REPLAY_HISTORY_BAR_LIMIT } from "./types";
import type { AggregatedMarketBarData } from "./types";

function bar(sequence: number, count = 5): AggregatedMarketBarData {
  return { timestamp: String(sequence), bucketEnd: String(sequence + 5), firstSequence: sequence,
    lastSequence: sequence + count - 1, sourceCount: count, expectedCount: 5,
    open: 10, high: 12, low: 9, close: 11, volume: null, status: count === 5 ? "COMPLETE" : "INCOMPLETE" };
}

describe("historical chart window extension", () => {
  it("supports extending both directions without duplicates or mutating the loaded window", () => {
    const current = [bar(5), bar(10)];
    const left = mergeHistoricalBars(current, [bar(0), bar(5)]);
    const both = mergeHistoricalBars(left, [bar(10), bar(15)]);
    expect(both.map((item) => item.firstSequence)).toEqual([0, 5, 10, 15]);
    expect(current.map((item) => item.firstSequence)).toEqual([5, 10]);
  });
  it("keeps the complete overlapping bucket when a boundary request returns a partial bucket", () => {
    expect(mergeHistoricalBars([bar(5)], [bar(5, 2)])).toEqual([bar(5)]);
    expect(mergeHistoricalBars([bar(5, 2)], [bar(5)])).toEqual([bar(5)]);
  });
  it("preserves source gaps instead of inventing candles", () => {
    expect(mergeHistoricalBars([bar(100)], [bar(0)]).map((item) => item.firstSequence)).toEqual([0, 100]);
  });
});

describe("locating a date and browsing later revealed candles", () => {
  it("appends the next window while retaining complete overlapping candles", async () => {
    const current = [bar(95), bar(100)];
    const readWindow = vi.fn(async () => ({ visibleBars: [bar(100, 2), bar(105), bar(110)] }));
    const page = await readLaterHistoryWindow({ afterSequence: 104, endSequence: 114, sourceSeconds: 60,
      displaySeconds: 300, visibleCount: 300, readWindow });
    expect(readWindow).toHaveBeenCalledTimes(1);
    expect(readWindow).toHaveBeenCalledWith(105);
    expect(mergeHistoricalBars(current, page!.visibleBars).map((item) => item.firstSequence)).toEqual([95, 100, 105, 110]);
    expect(mergeHistoricalBars(current, page!.visibleBars)[1].sourceCount).toBe(5);
  });

  it("continues across an overnight or weekend source gap, capped at the revealed progress", async () => {
    const requests: number[] = [];
    const page = await readLaterHistoryWindow({ afterSequence: 104, endSequence: 1_200, sourceSeconds: 60,
      displaySeconds: 60, visibleCount: 100,
      readWindow: async (focus) => {
        requests.push(focus);
        return { visibleBars: focus < 1_000 ? [bar(100)] : [bar(100), bar(1_000), bar(1_005)] };
      },
    });
    expect(page!.visibleBars.at(-1)!.lastSequence).toBe(1_009);
    expect(requests.length).toBeGreaterThan(1);
    expect(Math.max(...requests)).toBeLessThanOrEqual(1_200);
  });

  it("searches back after a large probe so no intervening trading days disappear", async () => {
    const readWindow = vi.fn(async (focus: number) => ({ visibleBars: focus < 1_000 ? [bar(100)]
      : focus <= 1_020 ? [bar(100), bar(1_000), bar(1_005)] : [bar(focus - 5), bar(focus)] }));
    const page = await readLaterHistoryWindow({ afterSequence: 104, endSequence: 4_000, sourceSeconds: 60,
      displaySeconds: 60, visibleCount: 300, readWindow });
    expect(page!.visibleBars.map((item) => item.firstSequence)).toEqual([100, 1_000, 1_005]);
    expect(readWindow.mock.calls.some(([focus]) => focus > 1_020)).toBe(true);
  });

  it("stops when the remaining revealed source bars are filtered out", async () => {
    const readWindow = vi.fn(async () => ({ visibleBars: [bar(100)] }));
    expect(await readLaterHistoryWindow({ afterSequence: 104, endSequence: 200, sourceSeconds: 60,
      displaySeconds: 300, visibleCount: 300, readWindow })).toBeNull();
    expect(readWindow.mock.calls.at(-1)).toEqual([200]);
    readWindow.mockClear();
    expect(await readLaterHistoryWindow({ afterSequence: 200, endSequence: 200, sourceSeconds: 60,
      displaySeconds: 300, visibleCount: 300, readWindow })).toBeNull();
    expect(readWindow).not.toHaveBeenCalled();
  });

  it("discards a window when navigation changes while the request is pending", async () => {
    let active = true;
    const readWindow = vi.fn(async () => { active = false; return { visibleBars: [bar(100), bar(105)] }; });
    expect(await readLaterHistoryWindow({ afterSequence: 104, endSequence: 200, sourceSeconds: 60,
      displaySeconds: 300, visibleCount: 300, readWindow, shouldContinue: () => active })).toBeNull();
    expect(readWindow).toHaveBeenCalledTimes(1);
  });
});

describe("historical period changes", () => {
  it("uses the inspected source sequence rather than restarting at the first trade", () => {
    expect(historicalWindowFocusSequence({ fromSequence: 800, toSequence: 1000 }, 100, 100, 2000)).toBe(900);
  });
  it("keeps the selected trade as the initial focus", () => {
    expect(historicalWindowFocusSequence(null, 500, 100, 2000)).toBe(500);
  });
  it("clamps blank chart margins to the historical session boundaries", () => {
    expect(historicalWindowFocusSequence({ fromSequence: 0, toSequence: 10 }, 100, 100, 2000)).toBe(100);
    expect(historicalWindowFocusSequence({ fromSequence: 2500, toSequence: 3000 }, 100, 100, 2000)).toBe(2000);
  });
});

describe("committing an asynchronous historical window change", () => {
  it("keeps all settings and windows when one pane fails while switching session", async () => {
    const controller = new AbortController();
    const apply = vi.fn();
    const failed = new Error("secondary window failed");
    await expect(commitHistoricalWindowChange(controller.signal, async () => {
      const [primary, secondary] = await Promise.all([Promise.resolve([bar(5)]), Promise.reject(failed)]);
      return () => apply(primary, secondary);
    })).rejects.toBe(failed);
    expect(apply).not.toHaveBeenCalled();
    await expect(commitHistoricalWindowChange(controller.signal, async () => () => apply([bar(5)], [bar(10)]))).resolves.toBe(true);
    expect(apply).toHaveBeenCalledOnce();
    expect(apply).toHaveBeenCalledWith([bar(5)], [bar(10)]);
  });

  it("discards a completed seek after the user exits playback", async () => {
    const playback = createHistoricalPlayback({ endSequence: 50,
      getTimeline: () => ({ bars: [bar(0)], seconds: 60, session: "ETH" }), readLater: async () => [], loadFailed: "failed" });
    const target = { bar: bar(0), displayIntervalSeconds: 60, displaySession: "ETH" as const };
    const controller = new AbortController();
    playback.start(target);
    let finish: (apply: () => void) => void = () => {};
    const seek = commitHistoricalWindowChange(controller.signal, () => new Promise(resolve => { finish = resolve; }));
    controller.abort();
    playback.exit();
    finish(() => playback.start(target));
    await expect(seek).resolves.toBe(false);
    expect(playback.getSnapshot()).toMatchObject({ active: false, boundary: null });
  });
});


describe("bounded historical playback memory", () => {
  it("retains a capped overlapping tail and the actual preceding indicator warmup", () => {
    const current = Array.from({ length: REPLAY_HISTORY_BAR_LIMIT }, (_, index) => bar(index * 5));
    const incoming = [bar((REPLAY_HISTORY_BAR_LIMIT - 1) * 5), bar(REPLAY_HISTORY_BAR_LIMIT * 5)];
    const result = boundedHistoricalPlaybackWindow(current, incoming, 10);
    expect(result.visibleBars).toHaveLength(REPLAY_HISTORY_BAR_LIMIT);
    expect(result.visibleBars[0]).toEqual(bar(5));
    expect(result.visibleBars.at(-1)).toEqual(incoming[1]);
    expect(result.warmupBars).toEqual([bar(0)]);
    expect(boundedHistoricalPlaybackWindow([bar(0)], [bar(5)], 10).warmupBars).toBeNull();
  });
});

describe("preserving indicator context across repeated window compaction", () => {
  it("combines existing warmup with each removed prefix, keeping a full 1000-bar context", () => {
    const previous = Array.from({ length: 1000 }, (_, index) => bar(index * 5));
    const current = Array.from({ length: REPLAY_HISTORY_BAR_LIMIT }, (_, index) => bar((index + 1000) * 5));
    const incoming = [bar((REPLAY_HISTORY_BAR_LIMIT + 1000) * 5)];
    const first = boundedHistoricalPlaybackWindow(current, incoming, 1000, previous);
    expect(first.warmupBars).toHaveLength(1000);
    expect(first.warmupBars).toEqual([...previous.slice(1), current[0]]);
    expect(first.visibleBars).toHaveLength(REPLAY_HISTORY_BAR_LIMIT);
    const ema = calculateEmaSeries([...first.warmupBars!, first.visibleBars[0]], 1000, 1000, 1000);
    expect(ema.points).toEqual([{ sequence: 1000, value: 11 }]);
    const second = boundedHistoricalPlaybackWindow(first.visibleBars, [bar((REPLAY_HISTORY_BAR_LIMIT + 1001) * 5)], 1000, first.warmupBars!);
    expect(second.warmupBars).toEqual([...previous.slice(2), ...current.slice(0, 2)]);
    expect(second.visibleBars[0]).toEqual(current[2]);
    expect(previous).toHaveLength(1000);
  });
});

describe("reading through artificial forming page tails", () => {
  it("continues probing when the only later candle is still cut off by a page boundary", async () => {
    const partial = { ...bar(10, 1), phase: "FORMING" as const, status: "INCOMPLETE" as const, quality: "GAP" as const };
    const readWindow = vi.fn(async (focus: number) => ({ visibleBars: [bar(5), focus < 14 ? partial : bar(10)] }));
    const page = await readLaterHistoryWindow({ afterSequence: 9, endSequence: 19, sourceSeconds: 60,
      displaySeconds: 300, visibleCount: 1, readWindow,
      acceptBar: bar => isHistoricalPlaybackBarReady(bar, 19) });
    expect(readWindow.mock.calls.map(([focus]) => focus)).toEqual([10, 14]);
    expect(page!.visibleBars.at(-1)!.lastSequence).toBe(14);
  });
  it("accepts a closed gap candle without requiring fabricated missing source bars", () => {
    expect(isHistoricalPlaybackBarReady({ ...bar(10, 2), phase: "CLOSED", status: "INCOMPLETE", quality: "GAP" }, 19)).toBe(true);
  });
});
