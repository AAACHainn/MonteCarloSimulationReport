import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";

function replayTimelineRanges() {
  const bundlePath = join(dirname(createRequire(import.meta.url).resolve("lightweight-charts/package.json")), "dist", "lightweight-charts.development.mjs");
  const source = readFileSync(bundlePath, "utf8")
    .replace(/^import .* from 'fancy-canvas';$/m, "")
    .replace(/^export \{ .* \};$/m, "");
  return runInNewContext(source + `
;(() => {
  const behavior = new (defaultHorzScaleBehavior())();
  behavior.updateFormatter = () => {};
  const model = {
    _internal_recalculateAllPanes() {},
    _internal_lightUpdate() {},
    _internal_timeScale() { return this._private__timeScale; },
  };
  const scale = new TimeScale(model, { ...timeScaleOptionsDefaults, shiftVisibleRangeOnNewBar: false }, {}, behavior);
  model._private__timeScale = scale;
  model._private__horzScaleBehavior = behavior;
  scale._internal_setWidth(1000);
  const layer = new DataLayer(behavior);
  const makeSeries = (type) => ({
    _internal_seriesType: () => type,
    _internal_customSeriesPlotValuesBuilder: () => undefined,
    _internal_customSeriesWhitespaceCheck: () => undefined,
    _internal_isConflationEnabled: () => false,
  });
  const candles = makeSeries('Candlestick');
  const ema = makeSeries('Line');
  const apply = (series, data) => {
    const update = layer._internal_setSeriesData(series, data);
    const timeUpdate = update._internal_timeScale;
    ChartModel.prototype._internal_updateTimeScale.call(model, timeUpdate._internal_baseIndex, timeUpdate._internal_points, timeUpdate._internal_firstChangedPointIndex);
  };
  const candleData = (first, last) => Array.from({ length: last - first + 1 }, (_, offset) => {
    const time = first + offset;
    return { time, open: 100 + time, high: 102 + time, low: 99 + time, close: 101 + time };
  });
  const lineData = (first, last) => Array.from({ length: last - first + 1 }, (_, offset) => {
    const time = first + offset;
    return { time, value: 101 + time };
  });
  const readRange = () => {
    const range = scale._internal_visibleLogicalRange();
    return { from: range?._internal_left() ?? null, to: range?._internal_right() ?? null };
  };
  apply(candles, candleData(500, 799));
  apply(ema, lineData(500, 799));
  scale._internal_setLogicalRange({ from: 20, to: 219 });
  const capturedBeforePlaceholder = readRange();
  apply(ema, [{ time: 0 }]);
  const afterPlaceholder = readRange();
  apply(candles, candleData(0, 799));
  scale._internal_setLogicalRange({ from: capturedBeforePlaceholder.from + 500, to: capturedBeforePlaceholder.to + 500 });
  const restoredFromCapture = readRange();
  scale._internal_setLogicalRange({ from: afterPlaceholder.from + 500, to: afterPlaceholder.to + 500 });
  const restoredFromShiftedRange = readRange();
  return { capturedBeforePlaceholder, afterPlaceholder, restoredFromCapture, restoredFromShiftedRange };
})()`) as {
    capturedBeforePlaceholder: { from: number | null; to: number | null };
    afterPlaceholder: { from: number | null; to: number | null };
    restoredFromCapture: { from: number | null; to: number | null };
    restoredFromShiftedRange: { from: number | null; to: number | null };
  };
}

describe("Lightweight Charts timeline reset viewport mapping", () => {
  it("restores the captured viewport without including the placeholder's one-point shift", () => {
    const ranges = replayTimelineRanges();
    expect(ranges.capturedBeforePlaceholder).toEqual({ from: 20, to: 219 });
    expect(ranges.afterPlaceholder).toEqual({ from: 21, to: 220 });
    expect(ranges.restoredFromCapture).toEqual({ from: 520, to: 719 });
    expect(ranges.restoredFromShiftedRange).toEqual({ from: 521, to: 720 });
  });
});
