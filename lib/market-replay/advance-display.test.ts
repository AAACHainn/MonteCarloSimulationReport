import { afterEach, describe, expect, it, vi } from "vitest";
import type { AggregatedMarketBarData } from "./types";
import { advancedDisplayBars, canReuseAnnotations } from "./advance-display";
import { DisplayBarCache } from "./bar-cache";

function bar(first: number, last = first): AggregatedMarketBarData {
  return { timestamp: new Date(first * 60000).toISOString(), bucketEnd: new Date((first + 5) * 60000).toISOString(),
    firstSequence: first, lastSequence: last, open: 100, high: 101, low: 99, close: 100,
    volume: null, sourceCount: last - first + 1, expectedCount: 5, status: "FORMING" };
}
afterEach(() => vi.useRealTimers());
describe("ordinary advance browser work", () => {
  it("persists an updated forming bucket and each new bucket, excluding the unchanged prefix", () => {
    const bars = [bar(0, 4), bar(5, 9), bar(10, 14), bar(15, 16)];
    expect(advancedDisplayBars(bars, 12)).toEqual(bars.slice(2));
    expect(advancedDisplayBars(bars, 16)).toEqual([]); // advancing outside the display session
    expect(advancedDisplayBars(bars, -1)).toEqual(bars);
  });
  it("also persists a previous forming bucket finalized by a gap into a new bucket", () => {
    const previous = bar(5, 7);
    const completed = { ...previous, status: "INCOMPLETE" as const };
    expect(advancedDisplayBars([bar(0, 4), completed, bar(10)], 7, previous)).toEqual([completed, bar(10)]);
  });
  it("coalesces repeated updates to one bucket and flushes under continuous playback", async () => {
    vi.useFakeTimers();
    const cache = new DisplayBarCache({ datasetId: "test", dataVersion: 1, displayIntervalSeconds: 300, displaySession: "ETH", sessionFingerprint: "UTC" });
    const persist = vi.spyOn(cache, "persist").mockResolvedValue();
    for (let i = 0; i < 5; i++) { cache.schedulePersist([bar(0, i)]); await vi.advanceTimersByTimeAsync(50); }
    expect(persist).toHaveBeenCalledTimes(1);
    expect(persist).toHaveBeenLastCalledWith([bar(0, 4)]);
    cache.schedulePersist([bar(5), bar(10)]);
    await vi.advanceTimersByTimeAsync(250);
    expect(persist).toHaveBeenLastCalledWith([bar(5), bar(10)]);
    cache.schedulePersist([bar(15)]); cache.dispose();
    await vi.advanceTimersByTimeAsync(250);
    expect(persist).toHaveBeenCalledTimes(2);
  });
  it("serializes cache writes and lets a window refresh supersede older delayed candles", async () => {
    vi.useFakeTimers();
    const cache = new DisplayBarCache({ datasetId: "test", dataVersion: 1, displayIntervalSeconds: 300, displaySession: "ETH", sessionFingerprint: "UTC" });
    let release: () => void = () => undefined;
    const blocked = new Promise<void>(resolve => { release = resolve; });
    const storage = cache as unknown as { persistNow(bars: AggregatedMarketBarData[]): Promise<void> };
    const write = vi.spyOn(storage, "persistNow").mockImplementationOnce(() => blocked).mockResolvedValue();
    cache.schedulePersist([bar(0, 1)]);
    const refresh = cache.persist([bar(0, 4)]);
    await Promise.resolve();
    expect(write).toHaveBeenCalledWith([bar(0, 4)]);
    cache.schedulePersist([bar(5)]);
    await vi.advanceTimersByTimeAsync(250);
    expect(write).toHaveBeenCalledTimes(1);
    release(); await refresh;
    await cache.persist([bar(10)]);
    expect(write.mock.calls.map(([bars]) => bars)).toEqual([[bar(0, 4)], [bar(5)], [bar(10)]]);
    cache.dispose();
  });
  it("reuses a complete live window without new journal entries, while leftward pans refetch", () => {
    const coverage = { fromSequence: 100, toSequence: 300, revealedSequence: 300, journalEntryCount: 8 };
    expect(canReuseAnnotations(coverage, 105, 305, 305, 8)).toBe(true);
    expect(canReuseAnnotations(coverage, 120, 250, 305, 8)).toBe(true);
    expect(canReuseAnnotations(coverage, 99, 305, 305, 8)).toBe(false);
    expect(canReuseAnnotations(coverage, 105, 305, 305, 9)).toBe(false);
    expect(canReuseAnnotations(coverage, 105, 299, 299, 8)).toBe(false);
    expect(canReuseAnnotations(coverage, 105, 305, 305, undefined)).toBe(false);
    expect(canReuseAnnotations(null, 105, 305, 305, 8)).toBe(false);
    expect(canReuseAnnotations(coverage, 105, 306, 305, 8)).toBe(false);
  });
  it("does not assume an unretrieved historical range has no annotations", () => {
    const coverage = { fromSequence: 100, toSequence: 200, revealedSequence: 300, journalEntryCount: 8 };
    expect(canReuseAnnotations(coverage, 110, 201, 301, 8)).toBe(false);
    expect(canReuseAnnotations(coverage, 110, 199, 301, 8)).toBe(true);
  });
});
