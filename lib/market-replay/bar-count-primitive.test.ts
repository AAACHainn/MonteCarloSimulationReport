import { describe, expect, it, vi } from "vitest";
import { BarCountPrimitive } from "./bar-count-primitive";
import { DEFAULT_BAR_COUNT_CONFIG } from "./bar-count";
import type { AggregatedMarketBarData, TradingSessionConfig } from "./types";

const session: TradingSessionConfig = { mode: "DAILY_SESSION", timezone: "America/Chicago", openMinute: 510, closeMinute: 915, weekdays: [1, 2, 3, 4, 5] };
const bars: AggregatedMarketBarData[] = Array.from({ length: 24 }, (_, index) => ({
  timestamp: new Date(Date.parse("2026-09-08T13:30:00Z") + index * 300000).toISOString(),
  bucketEnd: new Date(Date.parse("2026-09-08T13:30:00Z") + (index + 1) * 300000).toISOString(),
  firstSequence: index, lastSequence: index, open: 100, high: 101, low: 99, close: 100,
  volume: 1, sourceCount: 1, expectedCount: 1, status: "COMPLETE",
}));

function mounted(scale = 1, step = 40, start = 20) {
  const primitive = new BarCountPrimitive(scale);
  primitive.attached({
    chart: { timeScale: () => ({ getVisibleLogicalRange: () => ({ from: 0, to: 24 }), width: () => 1000, logicalToCoordinate: (index: number) => start + index * step }), panes: () => [{ getHeight: () => 600 }] },
    series: { priceToCoordinate: () => 100 }, requestUpdate: vi.fn(),
  } as unknown as Parameters<BarCountPrimitive["attached"]>[0]);
  const context = { font: "", textAlign: "", textBaseline: "", fillStyle: "", save: vi.fn(), restore: vi.fn(), fillText: vi.fn(), fillRect: vi.fn(), measureText: (text: string) => ({ width: text.length * 10 * scale * 0.6 }) };
  function draw() {
    primitive.updateAllViews();
    const renderer = primitive.paneViews()[0].renderer();
    renderer.draw({
      useMediaCoordinateSpace: (callback: (scope: { context: typeof context }) => void) => callback({ context }),
    } as unknown as Parameters<typeof renderer.draw>[0]);
  }
  return { primitive, context, draw };
}

describe("Bar Count primitive export scale", () => {
  it.each([[1, 10, 112], [2.8, 28, 133.6]])("keeps session numbering and colors at scale %s", (scale, fontSize, y) => {
    const { primitive, context, draw } = mounted(scale);
    primitive.setData({ bars: bars.slice(10), displaySession: "RTH", displayIntervalSeconds: 300, session, config: DEFAULT_BAR_COUNT_CONFIG });
    draw();
    expect(context.font).toContain(`${fontSize}px`);
    expect(context.fillStyle).toBe(DEFAULT_BAR_COUNT_CONFIG.hourCloseColor);
    expect(context.fillText.mock.calls[0]).toEqual(["12", 60, y]);
    expect(context.fillText.mock.calls.some(([text]) => text === "18")).toBe(true);
  });

  it("keeps three-digit PDF numbers within the pane and makes room for hourly labels", () => {
    const { primitive, context, draw } = mounted(2.8, 10, 5);
    const dense = bars.map((bar, index) => ({
      ...bar,
      timestamp: new Date(Date.parse("2026-09-08T16:17:00Z") + index * 60000).toISOString(),
      bucketEnd: new Date(Date.parse("2026-09-08T16:18:00Z") + index * 60000).toISOString(),
    }));
    primitive.setData({ bars: dense, displaySession: "RTH", displayIntervalSeconds: 60, session, config: { ...DEFAULT_BAR_COUNT_CONFIG, interval: 1 } });
    draw();
    const labels = context.fillText.mock.calls as [string, number, number][];
    expect(labels[0][1]).toBeGreaterThan(25);
    expect(labels.some(([text]) => text === "180")).toBe(true);
    for (let index = 1; index < labels.length; index++) {
      expect(labels[index][1] - labels[index - 1][1]).toBeGreaterThan(3 * 28 * 0.6);
    }
    expect(context.fillRect).toHaveBeenCalledTimes(labels.length);
  });

  it("removes labels when session, period or captured visibility suppresses the indicator", () => {
    const { primitive, context, draw } = mounted(2.8);
    const input = { bars, displaySession: "RTH" as const, displayIntervalSeconds: 300, session, config: DEFAULT_BAR_COUNT_CONFIG };
    primitive.setData(input); draw();
    expect(context.fillText).toHaveBeenCalled();
    for (const overrides of [{ displaySession: "ETH" as const, legacy: true }, { displayIntervalSeconds: 7200 }, { config: { ...DEFAULT_BAR_COUNT_CONFIG, enabled: false } }]) {
      context.fillText.mockClear();
      primitive.setData({ ...input, ...overrides }); draw();
      expect(context.fillText).not.toHaveBeenCalled();
    }
    primitive.detached();
  });
});

it("invalidates ETH labels on boundary color/session changes, appends, and trading-day rollover", () => {
  const { primitive, context, draw } = mounted(2.8);
  const eth = { ...session, mode: "OVERNIGHT_SESSION" as const, openMinute: 1020, closeMinute: 960 };
  const input = { bars: bars.slice(0, 2), displaySession: "ETH" as const, displayIntervalSeconds: 300, session: eth, rthSession: session, config: { ...DEFAULT_BAR_COUNT_CONFIG, interval: 100 } };
  primitive.setData(input); draw();
  expect(context.fillText.mock.calls.map(([text]) => text)).toEqual(["187"]);
  expect(context.fillStyle).toBe(DEFAULT_BAR_COUNT_CONFIG.rthBoundaryColor);
  const config = { ...input.config, rthBoundaryColor: "#123ABC" };
  context.fillText.mockClear();
  primitive.setData({ ...input, config }); draw();
  expect(context.fillStyle).toBe("#123ABC");
  context.fillText.mockClear();
  primitive.setData({ ...input, config, rthSession: { ...session, openMinute: 515 } }); draw();
  expect(context.fillText.mock.calls.map(([text]) => text)).toEqual(["188"]);
  context.fillText.mockClear();
  primitive.setData({ ...input, config, bars: bars.slice(0, 3) }); draw();
  expect(context.fillText.mock.calls.map(([text]) => text)).toEqual(["187"]);
  context.fillText.mockClear();
  primitive.setData({ ...input, config, rthSession: null }); draw();
  expect(context.fillText).not.toHaveBeenCalled();
  const nextOpen = { ...bars[0], timestamp: "2026-09-08T22:00:00Z", bucketEnd: "2026-09-08T22:05:00Z" };
  primitive.setData({ ...input, config: { ...config, recentTradingDays: 1 }, bars: [...input.bars, nextOpen] }); draw();
  expect(context.fillText.mock.calls.map(([text]) => text)).toEqual(["1"]);
});

it.each([1, 2.8])("updates and trims 24/7 labels over UTC midnight at scale %s", (scale) => {
  const { primitive, context, draw } = mounted(scale);
  const session = { mode: "TWENTY_FOUR_SEVEN" as const, timezone: "Asia/Shanghai", openMinute: null, closeMinute: null, weekdays: [1, 2, 3, 4, 5, 6, 7] };
  const times = ["2026-11-13T23:55:00Z", "2026-11-14T00:00:00Z", "2026-11-14T00:05:00Z"];
  const data = times.map((timestamp, i) => ({ ...bars[i], timestamp, bucketEnd: new Date(Date.parse(timestamp) + 300000).toISOString() }));
  const input = { displaySession: "ETH" as const, displayIntervalSeconds: 300, session, config: { ...DEFAULT_BAR_COUNT_CONFIG, recentTradingDays: 1 } };
  primitive.setData({ ...input, bars: data.slice(0, 1) }); draw();
  expect(context.fillText.mock.calls.map(([text]) => text)).toEqual(["288"]);
  context.fillText.mockClear();
  primitive.setData({ ...input, bars: data.slice(0, 2) }); draw();
  expect(context.fillText.mock.calls.map(([text]) => text)).toEqual(["1"]);
  context.fillText.mockClear();
  primitive.setData({ ...input, bars: data }); draw();
  expect(context.fillText.mock.calls.map(([text]) => text)).toEqual(["1", "2"]);
  context.fillText.mockClear();
  primitive.setData({ ...input, bars: data, allowContinuous: false }); draw();
  expect(context.fillText).not.toHaveBeenCalled();
  primitive.setData({ ...input, bars: data }); draw();
  expect(context.fillText.mock.calls.map(([text]) => text)).toEqual(["1", "2"]);
});
