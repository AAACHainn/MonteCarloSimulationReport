import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { runInNewContext } from "node:vm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { IChartApi, SeriesOptionsMap } from "lightweight-charts";
import { useReplayChartEma } from "./use-replay-chart-ema";
import { calculateEmaSeries } from "@/lib/market-replay/ema";
import type { AggregatedMarketBarData, EmaIndicatorConfig } from "@/lib/market-replay/types";

const hooks = vi.hoisted(() => ({ index: 0, slots: [] as unknown[], effects: [] as Array<() => void>, layoutEffects: [] as Array<() => void> }));
type EffectSlot = { deps: unknown[] };
vi.mock("react", () => ({
  useRef: (current: unknown) => {
    const slot = hooks.index++;
    if (!(slot in hooks.slots)) hooks.slots[slot] = { current };
    return hooks.slots[slot];
  },
  useLayoutEffect: (work: () => void) => { hooks.layoutEffects.push(work); hooks.index++; },
  useEffect: (work: () => void, deps: unknown[]) => {
    const slot = hooks.index++, previous = hooks.slots[slot] as EffectSlot | undefined;
    if (!previous || deps.some((value, index) => !Object.is(value, previous.deps[index]))) {
      hooks.effects.push(() => { hooks.slots[slot] = { deps }; work(); });
    }
  },
}));
const bar = (sequence: number) => ({
  timestamp: new Date(sequence * 60_000).toISOString(), close: 100 + sequence,
  firstSequence: sequence, lastSequence: sequence,
}) as AggregatedMarketBarData;
const indicator: EmaIndicatorConfig = { id: "ema", length: 2, color: "#2563eb", lineWidth: 2, lineStyle: "SOLID", visible: true };
function chart() {
  const lines: Array<{ applyOptions: ReturnType<typeof vi.fn>; setData: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> }> = [];
  const api = {
    addSeries: vi.fn(() => { const line = { applyOptions: vi.fn(), setData: vi.fn(), update: vi.fn() }; lines.push(line); return line; }),
    removeSeries: vi.fn(),
  };
  return { api, lines, ref: { current: api as unknown as IChartApi } };
}
function RenderHook(props: Parameters<typeof useReplayChartEma>[0], updateCandles?: () => void) {
  hooks.index = 0;
  useReplayChartEma(props);
  hooks.layoutEffects.splice(0).forEach(work => work());
  updateCandles?.();
  hooks.effects.splice(0).forEach(work => work());
}
beforeEach(() => { hooks.index = 0; hooks.slots = []; hooks.effects = []; hooks.layoutEffects = []; });

describe("EMA visibility without chart movement", () => {
  it("reuses the line and its data for total and individual visibility toggles", () => {
    const c = chart();
    const props = { chartRef: c.ref, bars: [bar(2), bar(3)], warmupBars: [bar(0), bar(1)], enabled: true, indicators: [indicator], chartKey: 0.25 };
    RenderHook(props);
    const line = c.lines[0];
    const options = c.api.addSeries.mock.calls[0] as unknown as [unknown, Partial<SeriesOptionsMap["Line"]>];
    expect(options[1].autoscaleInfoProvider?.(() => null)).toBeNull();
    expect(options[1].lastValueVisible).toBe(false);
    RenderHook({ ...props, enabled: false });
    expect(line.applyOptions).toHaveBeenLastCalledWith({ visible: false });
    RenderHook(props);
    RenderHook({ ...props, indicators: [{ ...indicator, visible: false }] });
    expect(line.applyOptions).toHaveBeenLastCalledWith({ visible: false });
    RenderHook(props);
    expect(line.applyOptions).toHaveBeenLastCalledWith(expect.objectContaining({ visible: true }));
    expect(c.api.addSeries).toHaveBeenCalledOnce();
    expect(c.api.removeSeries).not.toHaveBeenCalled();
    expect(line.setData).toHaveBeenCalledOnce();
    expect(line.update).not.toHaveBeenCalled();
  });

  it("updates the forming tail and new bars with the original EMA formula", () => {
    const c = chart();
    const props = { chartRef: c.ref, bars: [bar(2), bar(3)], warmupBars: [bar(0), bar(1)], enabled: true, indicators: [indicator], chartKey: 1 };
    RenderHook(props);
    const changed = { ...bar(3), close: 130 };
    const bars = [bar(2), changed, bar(4)];
    RenderHook({ ...props, bars });
    const expected = calculateEmaSeries([...props.warmupBars, ...bars], 2, 4).points.at(-1)!;
    expect(c.lines[0].update).toHaveBeenLastCalledWith({ time: 240, value: expected.value });
    expect(c.lines[0].setData).toHaveBeenCalledOnce();
  });

  it("clears old hidden timestamps on rewind/window changes, then recalculates on show", () => {
    const c = chart();
    const props = { chartRef: c.ref, bars: [bar(10), bar(11)], warmupBars: [bar(8), bar(9)], enabled: true, indicators: [indicator], chartKey: 1 };
    RenderHook(props);
    RenderHook({ ...props, enabled: false });
    const next = { ...props, bars: [bar(2), bar(3)], warmupBars: [bar(0), bar(1)] };
    RenderHook({ ...next, enabled: false });
    expect(c.lines[0].setData).toHaveBeenLastCalledWith([{ time: 120 }]);
    RenderHook(next);
    expect(c.lines[0].setData).toHaveBeenLastCalledWith([
      { time: 120, value: 101.5 }, { time: 180, value: 102.5 },
    ]);
    expect(c.api.addSeries).toHaveBeenCalledOnce();
  });

  it("recalculates on length or prehistory changes and removes only deleted indicators", () => {
    const c = chart();
    const props = { chartRef: c.ref, bars: [bar(2), bar(3)], warmupBars: [bar(0), bar(1)], enabled: true, indicators: [indicator], chartKey: 1 };
    RenderHook(props);
    const next = { ...props, indicators: [{ ...indicator, length: 3 }] };
    RenderHook(next);
    expect(c.lines[0].setData).toHaveBeenLastCalledWith([{ time: 120, value: 101 }, { time: 180, value: 102 }]);
    RenderHook({ ...next, warmupBars: [bar(-1), ...props.warmupBars] });
    expect(c.lines[0].setData).toHaveBeenCalledTimes(3);
    RenderHook({ ...next, indicators: [] });
    expect(c.api.removeSeries).toHaveBeenCalledOnce();
    expect(c.api.removeSeries).toHaveBeenCalledWith(c.lines[0]);
  });

  it("keeps a price-free time slot through repeated hide and restore transitions", () => {
    const c = chart();
    const full = Array.from({ length: 6 }, (_, index) => bar(index + 2));
    const props = { chartRef: c.ref, bars: full, timelineBars: full, warmupBars: [bar(0), bar(1)], enabled: true, indicators: [indicator], chartKey: 1 };
    RenderHook(props);
    const line = c.lines[0];
    for (let attempt = 0; attempt < 3; attempt += 1) {
      // The boundary candle is a frozen snapshot, including its EMA close.
      const hidden = [full[0], { ...full[1], close: 130 }];
      RenderHook({ ...props, bars: hidden });
      const points = calculateEmaSeries([...props.warmupBars, ...hidden], 2, 3).points;
      expect(line.setData).toHaveBeenLastCalledWith(points.filter(point => point.sequence >= 2)
        .map(point => ({ time: point.sequence * 60, value: point.value })));
      RenderHook(props);
      const expected = calculateEmaSeries([...props.warmupBars, ...full], 2, 7).points.at(-1)!;
      expect(line.update).toHaveBeenLastCalledWith({ time: 420, value: expected.value });
    }
    expect(line.setData.mock.calls.every(([points]) => points.length > 0)).toBe(true);
    expect(c.api.addSeries).toHaveBeenCalledOnce();
    expect(c.api.removeSeries).not.toHaveBeenCalled();
  });

  it("uses only the full timeline's first time when the hidden boundary leaves no visible bars", () => {
    const c = chart();
    const full = [bar(10), bar(11)];
    const props = { chartRef: c.ref, bars: full, timelineBars: full, warmupBars: [bar(8), bar(9)], enabled: true, indicators: [indicator], chartKey: 1 };
    RenderHook(props);
    RenderHook({ ...props, bars: [], warmupBars: [] });
    expect(c.lines[0].setData).toHaveBeenLastCalledWith([{ time: 600 }]);
    RenderHook(props);
    expect(c.lines[0].setData).toHaveBeenLastCalledWith([
      { time: 600, value: 109.5 }, { time: 660, value: 110.5 },
    ]);
    expect(c.lines[0].setData.mock.calls.every(([points]) => points.length > 0)).toBe(true);
  });

  it.each(["global", "individual"])("retains a time slot while the EMA is disabled (%s)", mode => {
    const c = chart();
    const full = [bar(2), bar(3), bar(4)];
    const props = { chartRef: c.ref, bars: full, timelineBars: full, warmupBars: [bar(0), bar(1)], enabled: true, indicators: [indicator], chartKey: 1 };
    RenderHook(props);
    const disabled = { ...props, enabled: mode !== "global", indicators: [{ ...indicator, visible: mode !== "individual" }] };
    RenderHook(disabled);
    RenderHook({ ...disabled, bars: full.slice(0, 1) });
    RenderHook(disabled);
    expect(c.lines[0].setData).toHaveBeenLastCalledWith([{ time: 120 }]);
    expect(c.lines[0].applyOptions).toHaveBeenLastCalledWith({ visible: false });
    RenderHook(props);
    expect(c.lines[0].setData).toHaveBeenLastCalledWith([
      { time: 120, value: 101.5 }, { time: 180, value: 102.5 }, { time: 240, value: 103.5 },
    ]);
  });

  it("moves an already-cleared hidden EMA's placeholder with subsequent window replacements", () => {
    const c = chart();
    const props = { chartRef: c.ref, bars: [bar(2), bar(3)], warmupBars: [bar(0), bar(1)], enabled: true, indicators: [indicator], chartKey: 1 };
    RenderHook(props);
    const disabled = { ...props, enabled: false };
    RenderHook(disabled);
    RenderHook({ ...disabled, bars: [bar(10), bar(11)], warmupBars: [bar(8), bar(9)] });
    expect(c.lines[0].setData).toHaveBeenLastCalledWith([{ time: 600 }]);
    RenderHook({ ...disabled, bars: [bar(20), bar(21)], warmupBars: [bar(18), bar(19)] }, () => {
      // It must move before the candle effect calculates the new logical range.
      expect(c.lines[0].setData).toHaveBeenLastCalledWith([{ time: 1200 }]);
    });
    const setCount = c.lines[0].setData.mock.calls.length;
    RenderHook({ ...disabled, bars: [bar(20), bar(21), bar(22)], warmupBars: [bar(18), bar(19)] });
    expect(c.lines[0].setData).toHaveBeenCalledTimes(setCount);
  });

  it("keeps the series registered when there are too few bars to calculate EMA", () => {
    const c = chart();
    const props = { chartRef: c.ref, bars: [bar(0)], warmupBars: [], enabled: true, indicators: [indicator], chartKey: 1 };
    RenderHook(props);
    expect(c.lines[0].setData).toHaveBeenLastCalledWith([{ time: 0 }]);
    RenderHook({ ...props, bars: [bar(0), bar(1)] });
    expect(c.lines[0].update).toHaveBeenLastCalledWith({ time: 60, value: 100.5 });
    RenderHook({ ...props, bars: [] });
    expect(c.lines[0].setData).toHaveBeenLastCalledWith([]);
  });

  it("creates fresh series when the owning chart is recreated", () => {
    const c = chart();
    const props = { chartRef: c.ref, bars: [bar(2), bar(3)], warmupBars: [bar(0), bar(1)], enabled: true, indicators: [indicator], chartKey: 1 };
    RenderHook(props);
    const next = chart();
    c.ref.current = next.ref.current;
    RenderHook({ ...props, chartKey: 0.25 });
    expect(next.api.addSeries).toHaveBeenCalledOnce();
    expect(next.lines[0].setData).toHaveBeenCalledOnce();
    expect(c.api.removeSeries).not.toHaveBeenCalled();
  });
});

// Exercise the installed chart library's data layer without a browser or canvas.
// Its public API requires a DOM, so expose only DataLayer from the local bundle
// in an isolated VM; no dependency files or application globals are modified.
type SeriesStub = ReturnType<typeof dataLayerSeries>;
type PointData = { _internal_mapping: Map<SeriesStub, unknown> };
type PlotRow = { _internal_index: number };
type DataLayer = {
  _internal_setSeriesData: (series: SeriesStub, data: Array<{ time: number }>) => void;
  _internal_updateSeriesData: (series: SeriesStub, data: { time: number; value: number }, historical: boolean) => void;
  _private__pointDataByTimePoint: Map<number, PointData>;
  _private__sortedTimePoints: Array<{ time: { _internal_timestamp: number }; pointData: PointData }>;
  _private__seriesRowsBySeries: Map<SeriesStub, PlotRow[]>;
};
function dataLayerSeries(type: "Line" | "Candlestick") {
  return {
    _internal_seriesType: () => type,
    _internal_customSeriesPlotValuesBuilder: () => undefined,
    _internal_customSeriesWhitespaceCheck: () => undefined,
    _internal_isConflationEnabled: () => false,
  };
}
function realDataLayer() {
  const bundle = join(dirname(createRequire(import.meta.url).resolve("lightweight-charts/package.json")), "dist", "lightweight-charts.development.mjs");
  const source = readFileSync(bundle, "utf8")
    .replace(/^import .* from 'fancy-canvas';$/m, "")
    .replace(/^export \{ .* \};$/m, "");
  const internals = runInNewContext(source + "\n({ DataLayer, defaultHorzScaleBehavior });") as {
    DataLayer: new (behavior: unknown) => DataLayer;
    defaultHorzScaleBehavior: () => new () => unknown;
  };
  return new internals.DataLayer(new (internals.defaultHorzScaleBehavior())());
}

describe("EMA hide/restore with the real chart data layer", () => {
  it.each([true, false])("preserves time-point mappings and restores candle/EMA indices (EMA enabled: %s)", enabled => {
    const layer = realDataLayer();
    const candles = dataLayerSeries("Candlestick"), ema = dataLayerSeries("Line");
    const c = chart();
    c.api.addSeries.mockImplementation(() => {
      const line = {
        applyOptions: vi.fn(),
        setData: vi.fn(data => layer._internal_setSeriesData(ema, data)),
        update: vi.fn(data => layer._internal_updateSeriesData(ema, data, false)),
      };
      c.lines.push(line);
      return line;
    });
    const full = Array.from({ length: 6 }, (_, index) => bar(index + 2));
    const props = { chartRef: c.ref, bars: full, timelineBars: full, warmupBars: [bar(0), bar(1)], enabled: true, indicators: [indicator], chartKey: 1 };
    const candleData = (visibleCount: number) => full.map((item, index) => index < visibleCount
      ? { time: (index + 2) * 60, open: item.close, high: item.close, low: item.close, close: item.close }
      : { time: (index + 2) * 60 });
    const assertTimeline = () => {
      expect(layer._private__pointDataByTimePoint.size).toBe(6);
      expect(layer._private__sortedTimePoints).toHaveLength(6);
      for (const point of layer._private__sortedTimePoints) {
        expect(layer._private__pointDataByTimePoint.get(point.time._internal_timestamp)).toBe(point.pointData);
      }
    };
    RenderHook(props, () => layer._internal_setSeriesData(candles, candleData(6)));
    if (!enabled) RenderHook({ ...props, enabled });
    for (let attempt = 0; attempt < 3; attempt += 1) {
      RenderHook({ ...props, enabled, bars: full.slice(0, 3) },
        () => layer._internal_setSeriesData(candles, candleData(3)));
      assertTimeline();
      expect(layer._private__seriesRowsBySeries.get(candles)?.map(row => row._internal_index)).toEqual([0, 1, 2]);
      RenderHook({ ...props, enabled }, () => layer._internal_setSeriesData(candles, candleData(6)));
      assertTimeline();
      expect(layer._private__seriesRowsBySeries.get(candles)?.map(row => row._internal_index)).toEqual([0, 1, 2, 3, 4, 5]);
      if (enabled) expect(layer._private__seriesRowsBySeries.get(ema)?.map(row => row._internal_index)).toEqual([0, 1, 2, 3, 4, 5]);
      else expect(layer._private__seriesRowsBySeries.get(ema)).toEqual([]);
    }
    if (!enabled) RenderHook(props);
    expect(layer._private__seriesRowsBySeries.get(ema)?.map(row => row._internal_index)).toEqual([0, 1, 2, 3, 4, 5]);
  });
});
