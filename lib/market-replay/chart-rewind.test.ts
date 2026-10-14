import { describe, expect, it, vi } from "vitest";
import { chartRewindTarget, readChartRewindPoint } from "./chart-rewind";
import { aggregateMarketBars } from "./aggregation";
import type { MarketBarData } from "./types";

const base = Date.parse("2026-10-09T13:30:00Z");
function aggregate(sequences: number[], displaySeconds = 300) {
  const source: MarketBarData[] = sequences.map((sequence) => ({ sequence, timestamp: new Date(base + sequence * 60_000).toISOString(),
    open: 100, high: 102, low: 99, close: 101, volume: null }));
  return aggregateMarketBars({ bars: source, sourceSeconds: 60, displaySeconds,
    session: { mode: "TWENTY_FOUR_SEVEN", timezone: "UTC", openMinute: null, closeMinute: null, weekdays: [] },
    currentSequence: sequences.at(-1) ?? -1, finalSequence: 100 });
}

describe("chart context menu rewind selection", () => {
  it("uses the selected display candle's last source sequence rather than its chart index or opening time", () => {
    const bars = aggregate([0, 1, 2, 3, 4, 5, 6]);
    const range = { minSequence: -1, maxSequence: 6 };
    expect(chartRewindTarget(bars, 0.2, range)).toEqual({ sequence: 4, timestamp: "2026-10-09T13:30:00.000Z" });
    expect(chartRewindTarget(bars, 0.8, range)).toEqual({ sequence: 6, timestamp: "2026-10-09T13:35:00.000Z" });
    expect(bars[1].status).toBe("FORMING");
  });
  it("uses the actual close of incomplete candles without inventing missing source bars", () => {
    const bars = aggregate([0, 1, 3, 5, 6]);
    expect(bars[0].status).toBe("INCOMPLETE");
    expect(chartRewindTarget(bars, 0, { minSequence: -1, maxSequence: 6 })?.sequence).toBe(3);
  });
  it("keeps logical selection correct across a weekend gap and after earlier history is prepended", () => {
    const bars = aggregate([0, 1, 2, 3, 4, 5, 6]);
    const monday = { ...bars[1], timestamp: "2026-10-12T13:35:00.000Z", firstSequence: 90, lastSequence: 91 };
    const range = { minSequence: -1, maxSequence: 91 };
    const selected = chartRewindTarget([bars[0], monday], 1, range);
    expect(selected?.sequence).toBe(91);
    expect(chartRewindTarget([{ ...bars[0], firstSequence: 0, lastSequence: 0 }, bars[0], monday], 2, range)).toEqual(selected);
  });
  it.each([null, Number.NaN, Number.POSITIVE_INFINITY, -0.6, 1.5, 25])("rejects empty chart space or invalid coordinates (%s)", (logical) => {
    expect(chartRewindTarget(aggregate([0, 1, 2, 3, 4, 5, 6]), logical, { minSequence: -1, maxSequence: 6 })).toBeNull();
  });
  it("rejects empty charts, pre-start history and unrevealed future candles", () => {
    const bars = aggregate([0, 1, 2, 3, 4, 5, 6]);
    expect(chartRewindTarget([], 0, { minSequence: -1, maxSequence: 6 })).toBeNull();
    expect(chartRewindTarget(bars, 0, { minSequence: 5, maxSequence: 6 })).toBeNull();
    expect(chartRewindTarget(bars, 1, { minSequence: -1, maxSequence: 5 })).toBeNull();
    expect(chartRewindTarget(bars, 0, { minSequence: 4, maxSequence: 6 })?.sequence).toBe(4);
  });

  it("waits for slow progress persistence before locating the selected candle", async () => {
    let resolve!: (value: boolean) => void;
    const sync = new Promise<boolean>((done) => { resolve = done; });
    const point = { sequence: 6, timestamp: "2026-10-09T13:36:00Z" };
    const locate = vi.fn(async () => point);
    const pending = readChartRewindPoint(() => sync, locate, new AbortController().signal);
    await Promise.resolve(); expect(locate).not.toHaveBeenCalled();
    resolve(true);
    expect(await pending).toEqual(point); expect(locate).toHaveBeenCalledOnce();
  });
  it("keeps a failed synchronization from validating or silently changing the selected target", async () => {
    const locate = vi.fn();
    await expect(readChartRewindPoint(async () => false, locate, new AbortController().signal)).rejects.toThrow();
    expect(locate).not.toHaveBeenCalled();
  });
  it("does not locate a target after closing during synchronization", async () => {
    const controller = new AbortController(), locate = vi.fn();
    const pending = readChartRewindPoint(async () => { controller.abort(); return true; }, locate, controller.signal);
    expect(await pending).toBeNull(); expect(locate).not.toHaveBeenCalled();
  });
  it("discards stale lookup results after the selected target is replaced or the dialog is closed", async () => {
    const controller = new AbortController();
    expect(await readChartRewindPoint(async () => true, async () => {
      controller.abort(); return { sequence: 6, timestamp: "2026-10-09T13:36:00Z" };
    }, controller.signal)).toBeNull();
  });
});
