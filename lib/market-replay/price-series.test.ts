import { describe, expect, it, vi } from "vitest";
import type { IChartApi, IPriceLine, ISeriesPrimitive, PriceLineOptions, Time, UTCTimestamp } from "lightweight-charts";
import { ReplayPriceSeries } from "./price-series";
import { chartDisplayConfig, type PriceSeriesPoint } from "./chart-display";

function harness() {
  let range = { from: 12, to: 52 }, autoScale = false;
  const priceRange = { from: 90, to: 110 };
  const scale = { options: () => ({ autoScale }), applyOptions: vi.fn((next: { autoScale: boolean }) => { autoScale = next.autoScale; }),
    getVisibleRange: () => priceRange, setVisibleRange: vi.fn() };
  const native: Array<ReturnType<typeof makeNative>> = [];
  function makeNative() {
    return { data: [] as unknown[], setData: vi.fn(function (this: { data: unknown[] }, points: unknown[]) { this.data = points; }),
      update: vi.fn(), applyOptions: vi.fn(), seriesOrder: () => 0, setSeriesOrder: vi.fn(), priceScale: () => scale,
      priceToCoordinate: vi.fn((p: number) => 200 - p), coordinateToPrice: vi.fn((p: number) => 200 - p),
      attachPrimitive: vi.fn(), detachPrimitive: vi.fn(),
      createPriceLine: vi.fn((initial: Partial<PriceLineOptions>) => {
        let options = { ...initial };
        return { options: () => options, applyOptions: (patch: Partial<PriceLineOptions>) => { options = { ...options, ...patch }; } };
      }), removePriceLine: vi.fn() };
  }
  const chart = { addSeries: vi.fn(() => { const next = makeNative(); native.push(next); return next; }), removeSeries: vi.fn(),
    timeScale: () => ({ getVisibleLogicalRange: () => range, setVisibleLogicalRange: vi.fn((next: typeof range) => { range = next; }) }) };
  const config = chartDisplayConfig();
  const facade = new ReplayPriceSeries(chart as unknown as IChartApi, config, 0.25);
  return { chart, native, facade, scale, priceRange, config, range: () => range };
}
const points: PriceSeriesPoint[] = [
  { time: 100 as UTCTimestamp, open: 100, high: 103, low: 99, close: 102 },
  { time: 200 as UTCTimestamp },
];

describe("stable primary price-series adapter", () => {
  it("replaces only the native series and rebinds stable price lines, primitives and coordinates", () => {
    const h = harness(); h.facade.setData(points);
    const primitive = {} as ISeriesPrimitive<Time>;
    h.facade.attachPrimitive(primitive);
    const line = h.facade.createPriceLine({ price: 98, color: "#123456" });
    line.applyOptions({ title: "drag preview" });
    const before = { ...h.range() };
    expect(h.facade.setDisplay({ ...h.config, chartType: "line" })).toBe(true);
    expect(h.chart.removeSeries).toHaveBeenCalledWith(h.native[0]);
    expect(h.native[0].detachPrimitive).toHaveBeenCalledWith(primitive);
    expect(h.native[1].attachPrimitive).toHaveBeenCalledTimes(1);
    expect(h.native[1].attachPrimitive).toHaveBeenCalledWith(primitive);
    expect(h.native[1].data).toEqual([{ time: 100, value: 102 }, { time: 200 }]);
    expect(h.range()).toEqual(before);
    expect(h.native[1].setSeriesOrder).toHaveBeenCalledWith(0);
    expect(h.scale.setVisibleRange).toHaveBeenCalledWith(h.priceRange);
    expect(line.options()).toMatchObject({ price: 98, title: "drag preview" });
    line.applyOptions({ price: 97 });
    expect(h.native[1].createPriceLine.mock.results[0].value.options().price).toBe(97);
    expect(h.facade.priceToCoordinate(104)).toBe(96);
    h.facade.removePriceLine(line);
    expect(h.native[1].removePriceLine).toHaveBeenCalledOnce();
  });
  it("changes line source and color without replacing the native series or mutating candle data", () => {
    const h = harness(); h.facade.setData(points);
    const config = { ...h.config, chartType: "line" as const };
    h.facade.setDisplay(config);
    const count = h.chart.addSeries.mock.calls.length;
    h.facade.setDisplay({ ...config, line: { priceSource: "open", color: "#ABCDEF" } });
    expect(h.chart.addSeries).toHaveBeenCalledTimes(count);
    expect(h.native[1].data).toEqual([{ time: 100, value: 100 }, { time: 200 }]);
    expect(h.native[1].applyOptions).toHaveBeenLastCalledWith({ color: "#ABCDEF" });
    h.facade.setDisplay(h.config);
    expect(h.native[2].data).toEqual(points);
    expect(points[0]).toMatchObject({ close: 102 });
  });
  it("keeps stable handles over repeated switches and forwards forming updates to the chosen source", () => {
    const h = harness(); h.facade.setData(points.slice(0, 1));
    const primitive = {} as ISeriesPrimitive<Time>;
    h.facade.attachPrimitive(primitive); h.facade.attachPrimitive(primitive);
    const line: IPriceLine = h.facade.createPriceLine({ price: 95 });
    for (let i = 0; i < 6; i++) h.facade.setDisplay({ ...h.config, chartType: i % 2 ? "candlestick" : "line" });
    expect(h.native.every(series => series.attachPrimitive.mock.calls.length === 1)).toBe(true);
    h.facade.setDisplay({ ...h.config, chartType: "line", line: { priceSource: "open", color: "#2563EB" } });
    h.facade.update({ time: 100 as UTCTimestamp, open: 100, high: 110, low: 99, close: 108 });
    expect(h.native.at(-1)!.update).toHaveBeenLastCalledWith({ time: 100, value: 100 });
    line.applyOptions({ price: 94 });
    expect(line.options().price).toBe(94);
    h.facade.detachPrimitive(primitive);
    expect(h.native.at(-1)!.detachPrimitive).toHaveBeenCalledOnce();
  });
});
