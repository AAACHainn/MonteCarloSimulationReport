import { describe, expect, it } from "vitest";
import { chartDisplayConfig, cloneChartDisplay, lineSeriesPoint, parseChartSelection } from "./chart-display";
import { DEFAULT_CANDLESTICK_STYLE } from "./candlestick-style";
import { chartHiddenSeriesData, chartBarsBeforeHiddenBoundary, chartHideAfterTarget } from "./chart-hide-after";
import { aggregateMarketBars } from "./aggregation";
import { previewSourceBars, PREVIEW_SESSION } from "./chart-style-preview-data";
import type { UTCTimestamp } from "lightweight-charts";

describe("page-only chart display configuration", () => {
  it.each([null, "", "broken", "{}", '{"chartType":"unknown","line":{"priceSource":"close","color":"#2563EB"}}',
    '{"chartType":"line","line":{"priceSource":"high","color":"#2563EB"}}', '{"chartType":"line","line":{"priceSource":"close","color":"red"}}'])("falls back safely from invalid selection %s", raw => {
    expect(parseChartSelection(raw)).toEqual({ chartType: "candlestick", line: { priceSource: "close", color: "#2563EB" } });
  });
  it("preserves legacy candle colors and independent hidden parts when combining new line selection", () => {
    const candle = { ...DEFAULT_CANDLESTICK_STYLE, upColor: "#123456", wickVisible: false };
    const selected = parseChartSelection('{"chartType":"line","line":{"priceSource":"open","color":"#ABCDEF"}}');
    const config = chartDisplayConfig(candle, selected);
    const draft = cloneChartDisplay(config);
    draft.line.color = "#010203"; draft.candlestickStyle.upColor = "#654321"; draft.chartType = "candlestick";
    expect(config).toEqual({ ...selected, candlestickStyle: candle });
    expect(candle.upColor).toBe("#123456");
    expect(chartDisplayConfig(candle).chartType).toBe("candlestick");
  });
  it("maps open and close without retaining OHLC, candle overrides or changing whitespace timestamps", () => {
    const point = { time: 100 as UTCTimestamp, open: 10, high: 14, low: 9, close: 13, wickColor: "#F59E0B" };
    expect(lineSeriesPoint(point, "close")).toEqual({ time: 100, value: 13 });
    expect(lineSeriesPoint(point, "open")).toEqual({ time: 100, value: 10 });
    expect(lineSeriesPoint({ time: 200 as UTCTimestamp }, "open")).toEqual({ time: 200 });
    expect(point.close).toBe(13);
  });
  it("keeps a forming hidden boundary frozen and crossing buckets hidden in either price source", () => {
    const aggregate = (sequence: number, period = 300, pulse = 0) => aggregateMarketBars({
      bars: previewSourceBars(sequence, pulse), sourceSeconds: 60, displaySeconds: period,
      session: PREVIEW_SESSION, currentSequence: sequence, finalSequence: 399, emissionMode: "DENSE",
    });
    const initial = aggregate(121);
    const boundary = chartHideAfterTarget(initial, initial.length - 1, 300, "ETH")!;
    const advanced = aggregate(128, 300, 6);
    const shown = chartBarsBeforeHiddenBoundary(advanced, boundary, 300, "ETH");
    expect(shown.at(-1)).toEqual(boundary.bar);
    const points = chartHiddenSeriesData(advanced, shown).candles;
    for (const source of ["open", "close"] as const) {
      const line = points.map(point => lineSeriesPoint(point, source));
      expect(line.at(-1)).toEqual({ time: points.at(-1)!.time });
      expect(line.length).toBe(advanced.length);
    }
    const changedPeriod = aggregate(128, 900);
    expect(chartBarsBeforeHiddenBoundary(changedPeriod, boundary, 900, "ETH").every(bar => bar.lastSequence <= boundary.bar.lastSequence)).toBe(true);
  });
  it("updates the forming close while keeping its opening price and timestamp", () => {
    const bars = (pulse: number) => aggregateMarketBars({ bars: previewSourceBars(121, pulse), sourceSeconds: 60,
      displaySeconds: 300, session: PREVIEW_SESSION, currentSequence: 121, finalSequence: 399 });
    const before = bars(0).at(-1)!, after = bars(4).at(-1)!;
    expect(after.timestamp).toBe(before.timestamp);
    expect(after.open).toBe(before.open);
    expect(after.close).toBeCloseTo(before.close + 1);
    expect(after.lastSequence).toBe(before.lastSequence);
  });
});
