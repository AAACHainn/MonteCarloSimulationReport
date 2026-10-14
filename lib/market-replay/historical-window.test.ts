import { describe, expect, it, vi } from "vitest";
import { historicalWindowFocusSequence, mergeHistoricalBars, readLaterHistoryWindow } from "./historical-window";
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
