import { describe, expect, it } from "vitest";
import { calculateLatestAbr } from "./abr";
import { replayCalculationWindow, retainReplayCalculationWindow } from "./playback-window";
import type { AggregatedMarketBarData } from "./types";
const bars = (start: number, count: number, range: number) => Array.from({ length: count }, (_, offset) => ({
  timestamp: new Date((start + offset) * 60_000).toISOString(), firstSequence: start + offset, lastSequence: start + offset,
  open: 100, close: 100, high: 100 + range, low: 100,
}) as AggregatedMarketBarData);

describe("playback context while inspecting a detached historical viewport", () => {
  it("uses the current live ABR without changing the historical chart", () => {
    const history = { bars: bars(100, 300, 50), warmupBars: bars(80, 20, 50) };
    const live = { bars: bars(1000, 300, 2), warmupBars: bars(980, 20, 2) };
    const active = replayCalculationWindow(history, true, live);
    expect(calculateLatestAbr(active.warmupBars, active.bars, 20)).toBe(2);
    expect(history.bars.at(-1)?.lastSequence).toBe(399);
    expect(replayCalculationWindow(history, false, live)).toBe(history);
    expect(replayCalculationWindow(history, true, null)).toBe(history);
  });
  it("bounds retained live data while preserving its indicator context and latest source candle", () => {
    const before = { bars: bars(1000, 1600, 2), warmupBars: bars(800, 200, 7) };
    const compacted = retainReplayCalculationWindow(before, 1000);
    expect(compacted.bars.length).toBe(300);
    expect(compacted.warmupBars.length).toBe(1000);
    expect(compacted.bars.at(-1)).toBe(before.bars.at(-1));
    expect(compacted.warmupBars.at(-1)?.lastSequence).toBe(compacted.bars[0].firstSequence - 1);
    expect(calculateLatestAbr(compacted.warmupBars, compacted.bars, 1000)).toBe(calculateLatestAbr(before.warmupBars, before.bars, 1000));
    expect(before.bars.length).toBe(1600);
  });
});
