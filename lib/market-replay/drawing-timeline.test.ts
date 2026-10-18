import { afterEach, describe, expect, it, vi } from "vitest";
import { AggregationCalendar, getAdjacentAggregationBucketStart, getAggregationBucket } from "./aggregation";
import { anchorForLogicalIndex } from "./chart-drawings";
import { DrawingTimelineLocator, drawingTimelineBars, MAX_DRAWING_ANCHOR_CACHE } from "./drawing-timeline";
import type { AggregatedMarketBarData, TradingSessionConfig } from "./types";

const rth: TradingSessionConfig = { mode: "DAILY_SESSION", timezone: "America/Chicago",
  openMinute: 510, closeMinute: 915, weekdays: [1, 2, 3, 4, 5] };
const eth: TradingSessionConfig = { ...rth, mode: "OVERNIGHT_SESSION", openMinute: 1020, closeMinute: 960 };
const continuous: TradingSessionConfig = { ...rth, mode: "TWENTY_FOUR_SEVEN", timezone: "UTC" };
function bar(timestamp: string, sequence = 0, interval = 300, session = rth): AggregatedMarketBarData {
  const bucket = getAggregationBucket(Date.parse(timestamp), 60, interval, session)!;
  return { timestamp: new Date(bucket.start).toISOString(), bucketEnd: new Date(bucket.end).toISOString(),
    firstSequence: sequence, lastSequence: sequence + bucket.expectedCount - 1,
    open: 100, high: 110, low: 90, close: 105, volume: 1,
    sourceCount: bucket.expectedCount, expectedCount: bucket.expectedCount, status: "COMPLETE" };
}
function locator(bars: AggregatedMarketBarData[], interval = 300, session = rth) {
  const result = new DrawingTimelineLocator();
  result.setTimeline(drawingTimelineBars(bars), interval, { sourceIntervalSeconds: 60, session });
  return result;
}
const anchor = (timestamp: string, sourceSequence: number | null = null) => ({ timestamp, sourceSequence });
afterEach(() => vi.restoreAllMocks());

describe("trading-day calendar", () => {
  it.each([60, 300, 7200])("matches adjacent buckets across weekends and both DST boundaries at %i seconds", (interval) => {
    for (const session of [rth, eth, { ...eth, weekdays: [1, 2, 3, 4, 5, 6, 7] }]) {
      for (const time of ["2026-03-06T20:00:00Z", "2026-10-30T20:00:00Z"]) {
        const start = getAggregationBucket(Date.parse(time), 60, interval, session)!.start;
        const calendar = new AggregationCalendar(interval, session);
        const origin = calendar.position(start, 1)!;
        for (const direction of [-1, 1] as const) {
          let cursor = start;
          for (let offset = 1; offset <= 100; offset++) {
            cursor = getAdjacentAggregationBucketStart(cursor, direction, interval, session)!;
            expect(calendar.position(cursor, direction)! - origin).toBe(offset * direction);
            expect(calendar.timestampAtOffset(start, offset * direction)).toBe(cursor);
          }
        }
      }
    }
  });

  it("uses actual elapsed session duration on overnight DST trading days", () => {
    const session = { ...eth, weekdays: [1, 2, 3, 4, 5, 6, 7] };
    const spring = new AggregationCalendar(3600, session);
    expect(spring.position(Date.parse("2026-03-08T22:00:00Z"), 1)!
      - spring.position(Date.parse("2026-03-07T23:00:00Z"), 1)!).toBe(22);
    const fall = new AggregationCalendar(3600, session);
    expect(fall.position(Date.parse("2026-11-01T23:00:00Z"), 1)!
      - fall.position(Date.parse("2026-10-31T22:00:00Z"), 1)!).toBe(24);
  });

  it("counts partial final buckets and snaps closed-market times by direction", () => {
    const calendar = new AggregationCalendar(7200, rth);
    const fridayLast = Date.parse("2026-06-19T19:30:00Z");
    const mondayFirst = Date.parse("2026-06-22T13:30:00Z");
    expect(calendar.timestampAtOffset(fridayLast, 1)).toBe(mondayFirst);
    expect(calendar.timestampAtOffset(mondayFirst, -1)).toBe(fridayLast);
    const friday = calendar.position(fridayLast, 1)!;
    expect(calendar.position(Date.parse("2026-06-20T12:00:00Z"), 1)! - friday).toBe(1);
    expect(calendar.position(Date.parse("2026-06-20T12:00:00Z"), -1)).toBe(friday);
    expect(calendar.position(Date.parse("2026-06-22T20:14:00Z"), 1)! - friday).toBe(4);
  });

  it("projects beyond the old 100,000 bucket cutoff without truncation", () => {
    const calendar = new AggregationCalendar(1, rth);
    const start = Date.parse("2026-01-02T14:30:00Z");
    expect(calendar.position(Date.parse("2026-01-12T14:30:00Z"), 1)!
      - calendar.position(start, 1)!).toBe(6 * 405 * 60);
    expect(calendar.timestampAtOffset(start, 6 * 405 * 60)).toBe(Date.parse("2026-01-12T14:30:00Z"));
  });

  it("rejects unsupported calendar distances without returning truncated or wall-time positions", () => {
    const result = locator([bar("2026-06-19T20:10:00Z")]);
    expect(result.logicalIndexForAnchor(anchor("2200-06-19T20:10:00Z"))).toBeNull();
    expect(result.logicalIndexForAnchor(anchor("1800-06-19T20:10:00Z"))).toBeNull();
    expect(result.timestampForLogicalIndex(100_000_000)).toBeNull();
    expect(result.logicalIndexForAnchor(anchor("invalid"))).toBeNull();
  });
});

describe("drawing timeline locator", () => {
  it("carries only already-loaded time and sequence metadata, including hidden time slots", () => {
    const bars = [bar("2026-06-19T20:10:00Z", 100), bar("2026-06-22T13:30:00Z", 1000)];
    const metadata = drawingTimelineBars(bars);
    expect(Object.keys(metadata[0]).sort()).toEqual(["bucketEnd", "firstSequence", "lastSequence", "timestamp"]);
    const timeline = locator(bars);
    expect(timeline.logicalIndexForAnchor(anchor(bars[1].timestamp))).toBe(1);
    const hidden = anchorForLogicalIndex({ logicalIndex: 1, price: 100, bars: bars.slice(0, 1),
      displayIntervalSeconds: 300, sourceIntervalSeconds: 60, session: rth, timeline });
    expect(hidden).toEqual({ timestamp: bars[1].timestamp, sourceSequence: null, price: 100 });
    expect(timeline.logicalIndexForAnchor(hidden)).toBe(1);
  });

  it("uses source containment, keeps missing candles absent and interpolates loaded gaps", () => {
    const bars = [bar("2026-06-19T13:30:00Z", 100), bar("2026-06-19T13:40:00Z", 110)];
    const timeline = locator(bars);
    expect(timeline.logicalIndexForAnchor(anchor(bars[0].timestamp, 103))).toBe(0);
    expect(timeline.logicalIndexForAnchor(anchor("2026-06-19T13:35:00Z", 105))).toBe(0.5);
    expect(timeline.logicalIndexForAnchor(anchor("2026-06-19T13:35:00Z"))).toBe(0.5);
    expect(timeline.logicalIndexForAnchor(anchor("2026-06-19T13:34:00Z"))).toBe(0);
  });

  it("uses calendar time for out-of-window source anchors across closed-market sequence gaps", () => {
    const friday = bar("2026-06-19T20:10:00Z", 1000);
    const monday = bar("2026-06-22T13:30:00Z", 5000);
    expect(locator([friday]).logicalIndexForAnchor(anchor(monday.timestamp, 5000))).toBe(1);
    expect(locator([monday]).logicalIndexForAnchor(anchor(friday.timestamp, 1000))).toBe(-1);
  });

  it("updates indices on append, prepend, crop and an equal-length interior revision", () => {
    const bars = Array.from({ length: 5 }, (_, i) => bar(new Date(Date.parse("2026-06-19T13:30:00Z") + i * 300_000).toISOString(), i * 5));
    const timeline = locator(bars.slice(1, 4));
    const target = anchor(bars[2].timestamp, 10);
    expect(timeline.logicalIndexForAnchor(target)).toBe(1);
    const update = (window: AggregatedMarketBarData[]) => timeline.setTimeline(drawingTimelineBars(window), 300, { sourceIntervalSeconds: 60, session: rth });
    update(bars.slice(1)); expect(timeline.logicalIndexForAnchor(target)).toBe(1);
    update(bars); expect(timeline.logicalIndexForAnchor(target)).toBe(2);
    update(bars.slice(2)); expect(timeline.logicalIndexForAnchor(target)).toBe(0);
    update([bars[0], bars[2], bars[4]]); expect(timeline.logicalIndexForAnchor(target)).toBe(1);
    update([bars[0], bars[1], bars[4]]); expect(timeline.logicalIndexForAnchor(target)).toBeCloseTo(1 + 1 / 3);
  });

  it.each([60, 300, 7200])("resolves source and time anchors after switching to %i seconds", (interval) => {
    const timeline = locator([bar("2026-06-19T20:10:00Z", 1000)]);
    const next = bar("2026-06-19T19:30:00Z", 960, interval);
    timeline.setTimeline(drawingTimelineBars([next]), interval, { sourceIntervalSeconds: 60, session: rth });
    const target = anchor("2026-06-22T16:25:00Z");
    const expected = interval === 7200 ? 2 : interval === 300 ? 44 : 220;
    expect(timeline.logicalIndexForAnchor(target)).toBe(expected);
  });

  it("invalidates calendar locations on session, interval and scope changes", () => {
    const metadata = drawingTimelineBars([bar("2026-06-19T20:10:00Z", 1000)]);
    const timeline = new DrawingTimelineLocator();
    const target = anchor("2026-06-22T13:30:00Z");
    timeline.setTimeline(metadata, 300, { sourceIntervalSeconds: 60, session: rth }, "a");
    expect(timeline.logicalIndexForAnchor(target)).toBe(1);
    timeline.setTimeline(metadata, 300, { sourceIntervalSeconds: 60, session: eth }, "a");
    expect(timeline.logicalIndexForAnchor(target)).toBeGreaterThan(1);
    timeline.setTimeline(metadata, 300, { sourceIntervalSeconds: 60, session: continuous }, "b");
    expect(timeline.logicalIndexForAnchor(target)).toBe(784);
  });

  it("reuses calendar positions across new windows and ignores price changes", () => {
    const initial = [bar("2026-06-19T20:10:00Z", 1000)];
    const timeline = locator(initial);
    const target = anchor("2026-07-22T13:30:00Z");
    const position = timeline.logicalIndexForAnchor(target);
    const conversions = vi.spyOn(Intl.DateTimeFormat.prototype, "formatToParts");
    const parse = vi.spyOn(Date, "parse");
    for (let i = 0; i < 100; i++) expect(timeline.logicalIndexForAnchor({ ...target, price: i } as typeof target)).toBe(position);
    expect(conversions).not.toHaveBeenCalled();
    expect(parse).not.toHaveBeenCalled();
    timeline.setTimeline(drawingTimelineBars([...initial]), 300, { sourceIntervalSeconds: 60, session: rth });
    expect(timeline.logicalIndexForAnchor(target)).toBe(position);
    expect(conversions).not.toHaveBeenCalled();
  });

  it("reuses immutable indexed slots on source advances, parsing only revised/new candles", () => {
    const bars = [bar("2026-06-19T13:30:00Z", 0), bar("2026-06-19T13:35:00Z", 5)];
    const timeline = locator(bars);
    const parsed = vi.spyOn(Date, "parse");
    timeline.setTimeline(drawingTimelineBars([...bars]), 300, { sourceIntervalSeconds: 60, session: rth });
    expect(parsed).not.toHaveBeenCalled();
    timeline.setTimeline(drawingTimelineBars([...bars, { ...bars[1], firstSequence: 10, lastSequence: 14,
      timestamp: "2026-06-19T13:40:00Z", bucketEnd: "2026-06-19T13:45:00Z" }]), 300, { sourceIntervalSeconds: 60, session: rth });
    expect(parsed).toHaveBeenCalledTimes(2);
  });

  it("does not scale initial timezone conversions with the number of intervening buckets", () => {
    const conversions = vi.spyOn(Intl.DateTimeFormat.prototype, "formatToParts");
    for (const interval of [1, 300]) {
      const calendar = new AggregationCalendar(interval, rth);
      conversions.mockClear();
      const start = calendar.position(Date.parse("2026-01-02T14:30:00Z"), 1)!;
      const end = calendar.position(Date.parse("2027-01-04T14:30:00Z"), 1)!;
      expect(end).toBeGreaterThan(start);
      expect(conversions.mock.calls.length).toBeLessThanOrEqual(2);
    }
  });

  it("bounds anchor caches during a long drag and preserves correct recomputation after eviction", () => {
    const timeline = locator([bar("2026-06-19T20:10:00Z")]);
    for (let i = 0; i < MAX_DRAWING_ANCHOR_CACHE + 30; i++) {
      timeline.logicalIndexForAnchor(anchor(new Date(Date.parse("2026-06-22T13:30:00Z") + i * 1000).toISOString()));
    }
    const caches = timeline as unknown as { anchors: Map<string, unknown>; positions: Map<string, unknown> };
    expect(caches.anchors.size).toBeLessThanOrEqual(MAX_DRAWING_ANCHOR_CACHE);
    expect(caches.positions.size).toBeLessThanOrEqual(MAX_DRAWING_ANCHOR_CACHE);
    expect(timeline.logicalIndexForAnchor(anchor("2026-06-22T13:30:00Z"))).toBe(1);
  });
});
