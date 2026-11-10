import { describe, expect, it } from "vitest";
import { positionDrawingCopy } from "./drawing-clipboard";
import { drawingAnchors, nudgeDrawing } from "./drawing-translation";
import { anchorForLogicalIndex, createMarketDrawingSchema, DEFAULT_ABCD_STYLE, DEFAULT_ARROW_STYLES, DEFAULT_FIBONACCI_RETRACEMENT_STYLE, DEFAULT_RECTANGLE_STYLE, DEFAULT_TEXT_STYLE, DEFAULT_TREND_LINE_STYLE, type MarketDrawing } from "./chart-drawings";
import { DrawingTimelineLocator } from "./drawing-timeline";
import type { AggregatedMarketBarData, TradingSessionConfig } from "./types";
const styles = { TREND_LINE: DEFAULT_TREND_LINE_STYLE, RECTANGLE: DEFAULT_RECTANGLE_STYLE, TEXT: DEFAULT_TEXT_STYLE,
  FIB_RETRACEMENT: DEFAULT_FIBONACCI_RETRACEMENT_STYLE, AB_CD: DEFAULT_ABCD_STYLE, ...DEFAULT_ARROW_STYLES };
const session: TradingSessionConfig = { mode: "DAILY_SESSION", timezone: "America/Chicago", openMinute: 510, closeMinute: 915, weekdays: [1, 2, 3, 4, 5] };
// Friday close, weekend, Monday open, and a missing Monday source candle.
const timestamps = ["2026-06-19T20:13:00Z", "2026-06-19T20:14:00Z", "2026-06-22T13:30:00Z", "2026-06-22T13:32:00Z", "2026-06-22T13:33:00Z", "2026-06-22T13:34:00Z"];
const bars = timestamps.map((timestamp, i) => ({ timestamp: new Date(timestamp).toISOString(), bucketEnd: new Date(Date.parse(timestamp) + 60_000).toISOString(),
  firstSequence: i * 100, lastSequence: i * 100, expectedCount: 1 })) as AggregatedMarketBarData[];
function placement() {
  const timeline = new DrawingTimelineLocator(); timeline.setTimeline(bars, 60, { sourceIntervalSeconds: 60, session });
  const anchor = (index: number, price: number) => Number.isSafeInteger(index) && timeline.timestampForLogicalIndex(index) !== null
    ? anchorForLogicalIndex({ logicalIndex: index, price, bars, displayIntervalSeconds: 60, timeline }) : null;
  return { timeline, anchor, copy: (source: MarketDrawing, index = 4, price = 200) => positionDrawingCopy(source, { logicalIndex: index, price }, timeline, anchor) };
}
function source(type: keyof typeof styles, start = 0, end = 2): MarketDrawing {
  const anchor = (i: number, price: number) => ({ timestamp: bars[i].timestamp, price, sourceSequence: bars[i].firstSequence });
  const first = anchor(start, 100), last = anchor(end, 104);
  const geometry = type === "TEXT" ? { anchor: first, text: "line one\n第二行" } : type.startsWith("ARROW") ? { anchor: first }
    : type === "AB_CD" ? { a: first, b: last, c: anchor(3, 101) } : { start: first, end: last };
  return { id: "original", datasetId: "dataset", type, geometry, style: styles[type], createdAt: "", updatedAt: "" } as MarketDrawing;
}
describe("drawing clipboard placement", () => {
  it.each(Object.keys(styles) as (keyof typeof styles)[])("copies %s without mutating content/style or changing displayed shape across gaps", type => {
    const original = source(type), before = structuredClone(original), { timeline, copy } = placement();
    const result = copy(original)!; expect(result).not.toBeNull();
    expect(original).toEqual(before); expect(result.style).toEqual(original.style); expect(result.style).not.toBe(original.style);
    expect(result.type).toBe(type);
    const oldPoints = drawingAnchors(original), points = drawingAnchors(result);
    const dx = timeline.logicalIndexForAnchor(points[0])! - timeline.logicalIndexForAnchor(oldPoints[0])!;
    const dy = points[0].price - oldPoints[0].price;
    for (let i = 0; i < points.length; i++) {
      expect(timeline.logicalIndexForAnchor(points[i])! - timeline.logicalIndexForAnchor(oldPoints[i])!).toBe(dx);
      expect(points[i].price - oldPoints[i].price).toBe(dy);
    }
    if (result.type === "TEXT") expect(result.geometry.text).toBe("line one\n第二行");
    else if (points.length === 2) expect(Date.parse(points[1].timestamp) - Date.parse(points[0].timestamp)).not.toBe(Date.parse(oldPoints[1].timestamp) - Date.parse(oldPoints[0].timestamp));
  });
  it("uses one shared offset for odd spans instead of independently rounding the endpoints", () => {
    const { copy, timeline } = placement(), result = copy(source("TREND_LINE", 0, 3), 4)!;
    const points = drawingAnchors(result).map(anchor => timeline.logicalIndexForAnchor(anchor)!);
    expect(points[1] - points[0]).toBe(3); expect(Math.abs((points[0] + points[1]) / 2 - 4)).toBeLessThanOrEqual(.5);
  });
  it("preserves geometry when copying beyond the loaded window across the trading calendar", () => {
    const { copy, timeline } = placement(), result = copy(source("TREND_LINE"), 12)!;
    const points = drawingAnchors(result).map(anchor => timeline.logicalIndexForAnchor(anchor)!);
    expect(points[1] - points[0]).toBe(2); expect((points[1] + points[0]) / 2).toBe(12);
  });
  it("does not silently round unrepresentable interpolated anchors and deform a copy", () => {
    const original = source("TREND_LINE"); drawingAnchors(original)[0].sourceSequence = 50;
    expect(placement().copy(original)).toBeNull();
  });
  it("does not create a copy for an invalid position or unsupported timeline", () => {
    const { copy } = placement(); expect(copy(source("TREND_LINE"), NaN)).toBeNull(); expect(copy(source("TREND_LINE"), 100_000_000)).toBeNull();
  });
  it.each(["RECTANGLE", "AB_CD"] as const)("keeps distinct source anchors in the same aggregate when pasting or nudging %s", type => {
    const start = Date.parse("2026-06-22T13:30:00Z");
    const aggregates = Array.from({ length: 8 }, (_, i) => ({ timestamp: new Date(start + i * 300_000).toISOString(),
      bucketEnd: new Date(start + (i + 1) * 300_000).toISOString(), firstSequence: i * 5, lastSequence: i * 5 + 4, expectedCount: 5 })) as AggregatedMarketBarData[];
    const point = (sequence: number, price: number) => ({ timestamp: new Date(start + sequence * 60_000).toISOString(), sourceSequence: sequence, price });
    const original = { ...source(type), geometry: type === "RECTANGLE" ? { start: point(0, 100), end: point(1, 104) }
      : { a: point(0, 100), b: point(5, 104), c: point(6, 101) } } as MarketDrawing;
    const before = structuredClone(original), timeline = new DrawingTimelineLocator();
    timeline.setTimeline(aggregates, 300, { sourceIntervalSeconds: 60, session });
    const valid = (drawing: MarketDrawing) => createMarketDrawingSchema.safeParse({ type: drawing.type, geometry: drawing.geometry, style: drawing.style }).success;
    expect(valid(original)).toBe(true);
    const anchorAt = (index: number, price: number) => anchorForLogicalIndex({ logicalIndex: index, price, bars: aggregates, displayIntervalSeconds: 300, timeline });
    const result = positionDrawingCopy(original, { logicalIndex: 3, price: 200 }, timeline, anchorAt);
    expect(result).not.toBeNull(); expect(valid(result!)).toBe(true); expect(original).toEqual(before);
    const oldAnchors = drawingAnchors(original), anchors = drawingAnchors(result!);
    const delta = timeline.logicalIndexForAnchor(anchors[0])! - timeline.logicalIndexForAnchor(oldAnchors[0])!;
    anchors.forEach((anchor, i) => expect(timeline.logicalIndexForAnchor(anchor)! - timeline.logicalIndexForAnchor(oldAnchors[i])!).toBe(delta));
    const first = type === "RECTANGLE" ? 0 : 1, second = first + 1;
    expect(Date.parse(anchors[second].timestamp) - Date.parse(anchors[first].timestamp)).toBe(60_000);
    const moved = nudgeDrawing(original, "ArrowRight", 1, 0.25, timeline, anchorAt)!;
    expect(valid(moved)).toBe(true);
    const nudged = drawingAnchors(moved);
    nudged.forEach((anchor, i) => expect(timeline.logicalIndexForAnchor(anchor)).toBe(timeline.logicalIndexForAnchor(oldAnchors[i])! + 1));
    expect(Date.parse(nudged[second].timestamp) - Date.parse(nudged[first].timestamp)).toBe(60_000);
    expect(nudgeDrawing(moved, "ArrowLeft", 1, 0.25, timeline, anchorAt)).not.toBeNull();
  });
});

describe("drawing translation by keyboard", () => {
  it.each(Object.keys(styles) as (keyof typeof styles)[])("moves %s exactly one logical bar across a compressed timeline", type => {
    const original = source(type, 1, 2), { timeline, anchor } = placement();
    const moved = nudgeDrawing(original, "ArrowRight", 1, 0.25, timeline, anchor)!;
    const before = drawingAnchors(original), after = drawingAnchors(moved);
    expect(after[0].timestamp).toBe(bars[2].timestamp);
    after.forEach((point, i) => {
      expect(timeline.logicalIndexForAnchor(point)).toBe(timeline.logicalIndexForAnchor(before[i])! + 1);
      expect(point.price).toBe(before[i].price);
    });
    expect(moved.style).toEqual(original.style);
    if (moved.type === "TEXT" && original.type === "TEXT") expect(moved.geometry.text).toBe(original.geometry.text);
  });

  it("translates legacy prices off the tick grid while keeping their anchors and price difference", () => {
    const original = source("RECTANGLE");
    const before = drawingAnchors(original);
    before[0].price = -0.11;
    before[1].price = 100.19;
    const { timeline, anchor } = placement();
    const moved = nudgeDrawing(original, "ArrowUp", 3, 0.25, timeline, anchor)!;
    expect(drawingAnchors(moved)).toEqual([{ ...before[0], price: 0.64 }, { ...before[1], price: 100.94 }]);
    expect(nudgeDrawing(moved, "ArrowDown", 3, 0.25, timeline, anchor)).toEqual(original);
  });

  it.each([[1, 1e-13, 1.0000000000001], [1e-110, 1e-112, 1.01e-110]])(
    "moves price %s by a representable tick of %s", (price, tick, expected) => {
      const original = source("TEXT"), { timeline, anchor } = placement();
      drawingAnchors(original)[0].price = price;
      const moved = nudgeDrawing(original, "ArrowUp", 1, tick, timeline, anchor);
      expect(moved && drawingAnchors(moved)[0]).toEqual({ ...drawingAnchors(original)[0], price: expected });
    },
  );

  it("validates the previous session's short final candle before that candle is loaded", () => {
    const friday = { timestamp: "2026-06-19T19:30:00.000Z", bucketEnd: "2026-06-19T20:15:00.000Z", firstSequence: 0, lastSequence: 44 };
    const monday = { timestamp: "2026-06-22T13:30:00.000Z", bucketEnd: "2026-06-22T14:30:00.000Z", firstSequence: 45, lastSequence: 104 };
    const displayIntervalSeconds = 3600;
    const timeline = new DrawingTimelineLocator();
    let window = [monday];
    timeline.setTimeline(window, displayIntervalSeconds, { sourceIntervalSeconds: 60, session });
    const anchorAt = (logicalIndex: number, price: number) => anchorForLogicalIndex({
      logicalIndex, price, bars: window as AggregatedMarketBarData[], displayIntervalSeconds, timeline,
    });
    const original = source("TEXT");
    const point = drawingAnchors(original)[0];
    point.sourceSequence = null;
    point.timestamp = "2026-06-22T14:20:00.000Z";
    expect(nudgeDrawing(original, "ArrowLeft", 1, 0.25, timeline, anchorAt)).toBeNull();
    point.timestamp = "2026-06-22T14:15:00.000Z";
    expect(nudgeDrawing(original, "ArrowLeft", 1, 0.25, timeline, anchorAt)).toBeNull();

    point.timestamp = "2026-06-22T14:14:00.000Z";
    const moved = nudgeDrawing(original, "ArrowLeft", 1, 0.25, timeline, anchorAt)!;
    const movedPoint = drawingAnchors(moved)[0];
    expect(movedPoint.timestamp).toBe("2026-06-19T20:14:00.000Z");
    expect(timeline.logicalIndexForAnchor(movedPoint)).toBe(-1);
    window = [friday, monday];
    timeline.setTimeline(window, displayIntervalSeconds, { sourceIntervalSeconds: 60, session });
    expect(timeline.logicalIndexForAnchor(movedPoint)).toBe(0);
  });

  it("rejects the whole horizontal step if one legacy anchor cannot be represented", () => {
    const original = source("RECTANGLE"), { timeline, anchor } = placement();
    drawingAnchors(original)[0].sourceSequence = 50;
    const before = structuredClone(original);
    expect(nudgeDrawing(original, "ArrowRight", 1, 0.25, timeline, anchor)).toBeNull();
    expect(original).toEqual(before);
  });
});
