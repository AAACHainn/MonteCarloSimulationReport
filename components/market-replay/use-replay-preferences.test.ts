import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_BAR_COUNT_CONFIG } from "@/lib/market-replay/bar-count";
import { capturePdfChartPreferences } from "./use-replay-preferences";

const dataset = { id: "es-dataset", startTime: "2026-09-08T13:30:00Z", timezone: "America/Chicago" };
let stored: Map<string, string>;
let setItem: ReturnType<typeof vi.fn>;

beforeEach(() => {
  stored = new Map();
  setItem = vi.fn();
  vi.stubGlobal("window", { localStorage: { getItem: (key: string) => stored.get(key) ?? null, setItem } });
});
afterEach(() => vi.unstubAllGlobals());

describe("PDF chart preference capture", () => {
  it("captures every saved Bar Count setting without writing replay preferences", () => {
    const config = { enabled: true, interval: 2, recentTradingDays: 4, regularColor: "#123456", bar18Color: "#AB1234", hourCloseColor: "#456789" };
    stored.set("market-replay-bar-count-settings-v1", JSON.stringify(config));
    const captured = capturePdfChartPreferences(dataset);
    expect(captured.barCountConfig).toEqual(config);
    stored.set("market-replay-bar-count-settings-v1", JSON.stringify({ ...config, interval: 6 }));
    expect(captured.barCountConfig.interval).toBe(2);
    expect(capturePdfChartPreferences(dataset).barCountConfig.interval).toBe(6);
    expect(setItem).not.toHaveBeenCalled();
  });

  it.each(["bar-count", "indicators"])("respects the %s visibility switch", (target) => {
    stored.set("market-replay-bar-count-settings-v1", JSON.stringify({ ...DEFAULT_BAR_COUNT_CONFIG, enabled: target !== "bar-count" }));
    stored.set("market-replay-chart-visibility-v1", JSON.stringify({ indicators: target !== "indicators" }));
    expect(capturePdfChartPreferences(dataset).barCountConfig.enabled).toBe(false);
  });

  it("uses the same defaults when storage is missing, invalid or unavailable", () => {
    expect(capturePdfChartPreferences(dataset).barCountConfig).toEqual(DEFAULT_BAR_COUNT_CONFIG);
    stored.set("market-replay-bar-count-settings-v1", "bad JSON");
    expect(capturePdfChartPreferences(dataset).barCountConfig).toEqual(DEFAULT_BAR_COUNT_CONFIG);
    vi.stubGlobal("window", { localStorage: { getItem: () => { throw new Error("Storage unavailable"); } } });
    expect(capturePdfChartPreferences(dataset).barCountConfig).toEqual(DEFAULT_BAR_COUNT_CONFIG);
  });
});
