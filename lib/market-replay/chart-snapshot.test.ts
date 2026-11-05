import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createChartSnapshotRenderer } from "./chart-snapshot";
import { defaultChartPreferences } from "@/lib/ai/chart-contract";
import { DEFAULT_CANDLESTICK_STYLE, DARK_CANDLESTICK_COLOR_PRESETS, CANDLESTICK_COLOR_PRESETS } from "./candlestick-style";
import { snapshotRendererVersion } from "./snapshot-version";
import type { PdfWindow } from "@/lib/paper-trading/pdf-types";
const fixture = vi.hoisted(() => ({ candleOptions: {} as Record<string, unknown>, candleData: vi.fn(), volumeData: vi.fn(), chartOptions: {} as Record<string, unknown> }));
vi.mock("lightweight-charts", () => ({ CandlestickSeries: "candles", HistogramSeries: "volume", LineSeries: "ema", ColorType: { Solid: "solid" }, CrosshairMode: { Hidden: 2 }, TickMarkType: {},
  createChart: (_container: unknown, options: Record<string, unknown>) => {
    fixture.chartOptions = options;
    return { addSeries: (kind: string, opts: Record<string, unknown>) => {
      if (kind === "candles") fixture.candleOptions = opts;
      return { attachPrimitive: vi.fn(), setData: kind === "candles" ? fixture.candleData : fixture.volumeData, priceScale: () => ({ applyOptions: vi.fn() }) };
    }, timeScale: () => ({ setVisibleLogicalRange: vi.fn() }), priceScale: () => ({ applyOptions: vi.fn() }), remove: vi.fn(), takeScreenshot: () => ({ width: 2400, height: 1200 }) };
  } }));
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("requestAnimationFrame", (fn: () => void) => { queueMicrotask(fn); return 1; });
  vi.stubGlobal("document", { hidden: false, fonts: { ready: Promise.resolve() }, createElement: () => ({ width: 0, height: 0,
    getContext: () => ({ fillRect: vi.fn(), drawImage: vi.fn() }), toBlob: (fn: (blob: Blob) => void) => fn(new Blob(["png"])) }) });
});
afterEach(() => vi.unstubAllGlobals());
it.each([undefined, 1, 2, 3])("renders frozen version %s independently of DOM appearance, including derived volume colors", async version => {
  const preferences = defaultChartPreferences(0);
  preferences.candlestickStyle = { ...DEFAULT_CANDLESTICK_STYLE, ...DARK_CANDLESTICK_COLOR_PRESETS[0].colors };
  const frozen = structuredClone(preferences);
  const style = version === 3 ? CANDLESTICK_COLOR_PRESETS[0].colors : DARK_CANDLESTICK_COLOR_PRESETS[0].colors;
  const display = { displayIntervalSeconds: 60, displaySession: "ETH" as const, session: { mode: "TWENTY_FOUR_SEVEN" as const, timezone: "UTC", openMinute: null, closeMinute: null, weekdays: [1, 2, 3, 4, 5, 6, 7] } };
  const renderer = createChartSnapshotRenderer({} as HTMLElement, preferences, 0.25, display, snapshotRendererVersion(version));
  const window: PdfWindow = { bars: [{ timestamp: "2026-11-01T00:00:00Z", bucketEnd: "2026-11-01T00:01:00Z", firstSequence: 0, lastSequence: 0, open: 100, high: 102, low: 98, close: 101, volume: 10, status: "COMPLETE", phase: "CLOSED", quality: "NORMAL", sourceCount: 1, expectedCount: 1 }], warmupBars: [], previousSequence: null, nextSequence: null };
  await renderer.capture(window, { fromSequence: 0, toSequence: 0, count: 1, entryIds: [], beforeCount: 0, afterCount: 0, part: 1, parts: 1 }, [], new AbortController().signal);
  expect(fixture.candleOptions.upColor).toBe(style.upColor);
  expect(fixture.volumeData.mock.calls[0][0][0].color).toBe(style.upColor + "55");
  expect(fixture.chartOptions.layout).toMatchObject({ background: { color: "#ffffff" } });
  expect(preferences).toEqual(frozen);
  renderer.remove();
});
