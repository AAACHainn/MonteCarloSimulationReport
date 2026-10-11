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
    for (const overrides of [{ displaySession: "ETH" as const }, { displayIntervalSeconds: 7200 }, { config: { ...DEFAULT_BAR_COUNT_CONFIG, enabled: false } }]) {
      context.fillText.mockClear();
      primitive.setData({ ...input, ...overrides }); draw();
      expect(context.fillText).not.toHaveBeenCalled();
    }
    primitive.detached();
  });
});
