import { describe, expect, it, vi } from "vitest";
import { aggregateMarketBars } from "./aggregation";
import { createHistoricalPlayback, historicalReplayEndSequence } from "./historical-playback";
import { chartBarsBeforeHiddenBoundary } from "./chart-hide-after";
import type { AggregatedMarketBarData, DisplaySession } from "./types";

function bar(sequence: number, count = 5): AggregatedMarketBarData {
  return { timestamp: new Date(sequence * 60_000).toISOString(), bucketEnd: new Date((sequence + count) * 60_000).toISOString(),
    firstSequence: sequence, lastSequence: sequence + count - 1, sourceCount: count, expectedCount: count,
    open: 10, high: 12, low: 9, close: 11, volume: 5, status: "COMPLETE" };
}
function setup(bars = [bar(0), bar(5), bar(10)], endSequence = 14) {
  const timeline = { bars, seconds: 300, session: "ETH" as DisplaySession };
  const readLater = vi.fn<(after: number, signal: AbortSignal) => Promise<AggregatedMarketBarData[]>>(async () => []);
  const engine = createHistoricalPlayback({ endSequence, getTimeline: () => timeline, readLater, loadFailed: "load failed" });
  const start = (selected = bars[0]) => engine.start({ bar: selected, displayIntervalSeconds: timeline.seconds, displaySession: timeline.session });
  const visible = () => chartBarsBeforeHiddenBoundary(timeline.bars, engine.getSnapshot().boundary, timeline.seconds, timeline.session);
  return { engine, timeline, readLater, start, visible };
}

describe("view-only historical playback", () => {
  it("keeps the selected candle visible, starts paused and reveals one displayed candle at a time", async () => {
    const s = setup(); s.start();
    expect(s.engine.getSnapshot()).toMatchObject({ active: true, playing: false });
    expect(s.visible()).toEqual([bar(0)]);
    await s.engine.step();
    expect(s.visible()).toEqual([bar(0), bar(5)]);
    expect(s.readLater).not.toHaveBeenCalled();
  });
  it("stops at the actual revealed endpoint, including a final partial displayed candle", async () => {
    const s = setup([bar(0), bar(5), bar(10, 2)], 11); s.start(bar(5)); s.engine.toggle();
    await s.engine.step();
    expect(s.engine.getSnapshot()).toMatchObject({ finished: true, playing: false, boundary: { bar: bar(10, 2) } });
    s.engine.toggle(); await s.engine.step();
    expect(s.engine.getSnapshot().playing).toBe(false);
    expect(s.readLater).not.toHaveBeenCalled();
  });
  it("restores every loaded candle on exit, including an earlier static hide", async () => {
    const s = setup(); s.engine.hide({ bar: bar(5), displayIntervalSeconds: 300, displaySession: "ETH" });
    s.start(); await s.engine.step(); s.engine.toggle(); s.engine.exit();
    expect(s.engine.getSnapshot()).toMatchObject({ active: false, boundary: null, playing: false });
    expect(s.visible()).toEqual(s.timeline.bars);
  });
  it("serializes concurrent steps and aborts late results after exit", async () => {
    const s = setup([bar(0)], 100);
    let resolve!: (bars: AggregatedMarketBarData[]) => void;
    s.readLater.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    s.start(); const pending = s.engine.step(); await s.engine.step();
    expect(s.readLater).toHaveBeenCalledTimes(1);
    const signal = s.readLater.mock.calls[0][1];
    s.engine.exit(); expect(signal.aborted).toBe(true);
    resolve([bar(5)]); await pending;
    expect(s.engine.getSnapshot()).toMatchObject({ active: false, boundary: null, busy: false });
  });
  it("discards an old request after restarting at a different candle", async () => {
    const s = setup([bar(0)], 100);
    let resolve!: (bars: AggregatedMarketBarData[]) => void;
    s.readLater.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    s.start(); const pending = s.engine.step(); s.start(bar(50)); resolve([bar(5)]); await pending;
    expect(s.engine.getSnapshot().boundary!.bar).toEqual(bar(50));
  });
  it("keeps the source boundary through period changes and hides a bucket crossing that boundary", async () => {
    const s = setup(); s.start(bar(5)); s.engine.pause();
    s.timeline.seconds = 900; s.timeline.bars = [bar(0, 15), bar(15, 15)];
    expect(s.visible()).toEqual([]);
    expect(s.engine.getSnapshot().boundary!.bar.lastSequence).toBe(9);
    // At a larger period the next step finishes that containing displayed bucket.
    await s.engine.step();
    expect(s.visible()).toEqual([bar(0, 15)]);
  });
  it("uses a bounded later page across gaps and finishes if all remaining sources are outside the display session", async () => {
    const s = setup([bar(0)], 1000); s.start();
    s.readLater.mockResolvedValueOnce([bar(0), bar(800)]);
    await s.engine.step();
    expect(s.engine.getSnapshot().boundary!.bar).toEqual(bar(800));
    await s.engine.step();
    expect(s.engine.getSnapshot()).toMatchObject({ finished: true, playing: false });
    expect(s.readLater.mock.calls.map(call => call[0])).toEqual([4, 804]);
  });
  it("pauses on a failed page and allows retry without moving the boundary", async () => {
    const s = setup([bar(0)], 100); s.start(); s.engine.toggle();
    s.readLater.mockRejectedValueOnce(new Error("offline")); await s.engine.step();
    expect(s.engine.getSnapshot()).toMatchObject({ playing: false, error: "offline", boundary: { bar: bar(0) } });
    s.readLater.mockResolvedValueOnce([bar(5)]); await s.engine.step();
    expect(s.engine.getSnapshot()).toMatchObject({ error: null, boundary: { bar: bar(5) } });
  });
  it("pause cancels pending work without un-hiding candles", async () => {
    const s = setup([bar(0)], 100);
    let resolve!: (bars: AggregatedMarketBarData[]) => void;
    s.readLater.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    s.start(); s.engine.toggle(); const pending = s.engine.step(); s.engine.pause();
    resolve([bar(5)]); await pending;
    expect(s.engine.getSnapshot()).toMatchObject({ active: true, playing: false, busy: false, boundary: { bar: bar(0) } });
  });
  it("keeps the source boundary across ETH/RTH switches and can continue ETH after the RTH tail ends", async () => {
    const s = setup([bar(0), bar(5), bar(10)], 14); s.start(bar(5));
    s.timeline.session = "RTH"; s.timeline.bars = [bar(0), bar(5)]; s.engine.timelineChanged();
    expect(s.engine.getSnapshot()).toMatchObject({ playing: false, boundary: { bar: bar(5) } });
    await s.engine.step(); expect(s.engine.getSnapshot().finished).toBe(true);
    s.timeline.session = "ETH"; s.timeline.bars = [bar(0), bar(5), bar(10)]; s.engine.timelineChanged();
    expect(s.engine.getSnapshot().finished).toBe(false);
    expect(s.engine.getSnapshot().boundary!.bar.lastSequence).toBe(9);
    await s.engine.step();
    expect(s.engine.getSnapshot()).toMatchObject({ finished: true, boundary: { bar: bar(10), displaySession: "ETH" } });
  });
  it("discards a pending old-session response after changing the displayed session", async () => {
    const s = setup([bar(0)], 100);
    let resolve!: (bars: AggregatedMarketBarData[]) => void;
    s.readLater.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    s.start(); const pending = s.engine.step();
    s.timeline.session = "RTH"; s.engine.timelineChanged();
    resolve([bar(5)]); await pending;
    expect(s.engine.getSnapshot()).toMatchObject({ playing: false, busy: false, boundary: { bar: bar(0) } });
  });
  it("rejects invalid playback rates and a start beyond the historical endpoint", () => {
    const s = setup(); s.start(bar(20)); expect(s.engine.getSnapshot().active).toBe(false);
    for (const rate of [0, 101, NaN, 1.5]) s.engine.setRate(rate);
    expect(s.engine.getSnapshot().rate).toBe(8); s.engine.setRate(100); expect(s.engine.getSnapshot().rate).toBe(100);
  });
});

describe("historical playback endpoint", () => {
  const base = { barCount: 2000, roundEnd: null, projectionSequence: 500, progressSequence: 1000, activeProjection: true };
  it("includes already practised flat candles using this session's own progress", () => {
    expect(historicalReplayEndSequence(base)).toBe(1000);
  });
  it("uses an ended round's frozen endpoint, never a later round's progress", () => {
    expect(historicalReplayEndSequence({ ...base, roundEnd: 450, activeProjection: false })).toBe(450);
    expect(historicalReplayEndSequence({ ...base, activeProjection: false })).toBe(500);
  });
  it("falls back to the selected projection and clamps to available source data", () => {
    expect(historicalReplayEndSequence({ ...base, progressSequence: null })).toBe(500);
    expect(historicalReplayEndSequence({ ...base, barCount: 900 })).toBe(899);
  });
});

function aggregatedThrough(end: number) {
  return aggregateMarketBars({ bars: Array.from({ length: end + 1 }, (_, sequence) => ({
    sequence, timestamp: new Date(sequence * 60_000).toISOString(), open: 100, high: 102, low: 99, close: 101, volume: 1,
  })), sourceSeconds: 60, displaySeconds: 300, currentSequence: end, finalSequence: 99,
  session: { mode: "TWENTY_FOUR_SEVEN", timezone: "UTC", weekdays: [1, 2, 3, 4, 5, 6, 7], openMinute: null, closeMinute: null } });
}

describe("displayed steps across source-truncated window edges", () => {
  it("completes the next displayed candle before revealing it, without spending a second step on the same timestamp", async () => {
    const s = setup(aggregatedThrough(10), 19); s.start(s.timeline.bars[1]);
    expect(s.timeline.bars[2].phase).toBe("FORMING");
    s.readLater.mockImplementation(async () => { s.timeline.bars = aggregatedThrough(19); return s.timeline.bars; });
    await s.engine.step();
    expect(s.engine.getSnapshot().boundary!.bar).toMatchObject({ firstSequence: 10, lastSequence: 14, phase: "CLOSED" });
    await s.engine.step();
    expect(s.engine.getSnapshot()).toMatchObject({ finished: true, boundary: { bar: { firstSequence: 15, lastSequence: 19 } } });
    expect(s.readLater).toHaveBeenCalledTimes(1);
  });
  it("still reveals a genuinely partial candle at the historical endpoint", async () => {
    const s = setup(aggregatedThrough(11), 11); s.start(s.timeline.bars[1]);
    await s.engine.step();
    expect(s.engine.getSnapshot()).toMatchObject({ finished: true, boundary: { bar: { firstSequence: 10, lastSequence: 11, phase: "FORMING" } } });
    expect(s.readLater).not.toHaveBeenCalled();
  });
  it("keeps the old boundary when completing a truncated candle fails", async () => {
    const s = setup(aggregatedThrough(10), 19); s.start(s.timeline.bars[1]);
    s.readLater.mockRejectedValueOnce(new Error("offline"));
    await s.engine.step();
    expect(s.engine.getSnapshot()).toMatchObject({ boundary: { bar: { lastSequence: 9 } }, error: "offline", finished: false });
  });
});
