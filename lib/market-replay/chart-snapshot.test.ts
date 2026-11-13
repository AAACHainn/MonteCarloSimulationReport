import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createChartSnapshotRenderer } from "./chart-snapshot";
import { defaultChartPreferences } from "@/lib/ai/chart-contract";
import { DEFAULT_CANDLESTICK_STYLE, DARK_CANDLESTICK_COLOR_PRESETS, CANDLESTICK_COLOR_PRESETS } from "./candlestick-style";
import { snapshotRendererVersion, chartImageVariantVersion } from "./snapshot-version";
import { BarCountPrimitive } from "./bar-count-primitive";
import { buildBarCountLabels } from "./bar-count";
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
it.each([undefined, 1, 2, 3, 4, 5])("renders frozen version %s independently of DOM appearance, including derived volume colors", async version => {
  const preferences = defaultChartPreferences(0);
  preferences.candlestickStyle = { ...DEFAULT_CANDLESTICK_STYLE, ...DARK_CANDLESTICK_COLOR_PRESETS[0].colors };
  const frozen = structuredClone(preferences);
  const style = (version ?? 0) >= 3 ? CANDLESTICK_COLOR_PRESETS[0].colors : DARK_CANDLESTICK_COLOR_PRESETS[0].colors;
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

it.each([undefined, 2, 3, 4, 5])("keeps frozen Bar Count rules and variant identities for version %s", async (version) => {
  const preferences = defaultChartPreferences(0);
  preferences.barCountConfig.rthBoundaryColor = "#123ABC";
  const spy = vi.spyOn(BarCountPrimitive.prototype, "setData");
  const session = { mode: "OVERNIGHT_SESSION" as const, timezone: "America/Chicago", openMinute: 1020, closeMinute: 960, weekdays: [1, 2, 3, 4, 5] };
  const display = { displayIntervalSeconds: 300, displaySession: "ETH" as const, session, rthSession: { ...session, mode: "DAILY_SESSION" as const, openMinute: 510, closeMinute: 915 } };
  const renderer = createChartSnapshotRenderer({} as HTMLElement, preferences, 0.25, display, snapshotRendererVersion(version));
  try {
    const window: PdfWindow = { bars: [{ timestamp: "2026-09-08T13:30:00Z", bucketEnd: "2026-09-08T13:35:00Z", firstSequence: 0, lastSequence: 0, open: 100, high: 102, low: 98, close: 101, volume: 10, status: "COMPLETE", sourceCount: 1, expectedCount: 1 }], warmupBars: [], previousSequence: null, nextSequence: null };
    await renderer.capture(window, { fromSequence: 0, toSequence: 0, count: 1, entryIds: [], beforeCount: 0, afterCount: 0, part: 1, parts: 1 }, [], new AbortController().signal);
    const labels = buildBarCountLabels(spy.mock.calls[0][0]);
    if ((version ?? 0) >= 4) expect(labels).toMatchObject([{ number: 187, kind: "RTH_BOUNDARY", color: "#123ABC" }]);
    else expect(labels).toEqual([]);
    expect(chartImageVariantVersion(version)).toBe(version === 5 ? "image:6" : version === 4 ? "image:5" : version === 3 ? "image:4" : "image:3");
  } finally {
    renderer.remove();
    spy.mockRestore();
  }
});

it.each([undefined, 2, 3, 4, 5])("preserves continuous-market screenshot behavior for version %s", async (version) => {
  const preferences = defaultChartPreferences(480);
  const spy = vi.spyOn(BarCountPrimitive.prototype, "setData");
  const session = { mode: "TWENTY_FOUR_SEVEN" as const, timezone: "Asia/Shanghai", openMinute: null, closeMinute: null, weekdays: [1, 2, 3, 4, 5, 6, 7] };
  const display = { displayIntervalSeconds: 420, displaySession: "ETH" as const, session };
  const renderer = createChartSnapshotRenderer({} as HTMLElement, preferences, 0.25, display, snapshotRendererVersion(version));
  const times = ["2026-11-13T23:57:00Z", "2026-11-14T00:04:00Z", "2026-11-14T00:11:00Z"];
  const window: PdfWindow = { bars: times.map((timestamp, index) => ({
    timestamp, bucketEnd: new Date(Date.parse(timestamp) + 420000).toISOString(),
    firstSequence: index, lastSequence: index, open: 100, high: 102, low: 98, close: 101, volume: 10,
    status: "COMPLETE", sourceCount: 1, expectedCount: 7,
  })), warmupBars: [], previousSequence: null, nextSequence: null };
  const frozen = structuredClone({ preferences, window });
  try {
    await renderer.capture(window, { fromSequence: 0, toSequence: 2, count: 3, entryIds: [], beforeCount: 0, afterCount: 0, part: 1, parts: 1 }, [], new AbortController().signal);
    const labels = buildBarCountLabels(spy.mock.calls[0][0]);
    expect(labels.map(label => label.number)).toEqual(version === 5 ? [206, 1, 2] : []);
    expect({ preferences, window }).toEqual(frozen);
  } finally {
    renderer.remove();
    spy.mockRestore();
  }
});
