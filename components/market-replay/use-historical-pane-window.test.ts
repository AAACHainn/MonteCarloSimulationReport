import { describe, expect, it, vi } from "vitest";
import type { AggregatedMarketBarData, MarketDatasetSummary } from "@/lib/market-replay/types";
import type { WindowPayload } from "./replay-client-shared";
import { readInitialHistoricalPaneWindow } from "./use-historical-pane-window";

const dataset = { id: "history", sourceIntervalSeconds: 60, dataVersion: 1,
  symbol: "ES", timezone: "America/Chicago", tradingWeekdays: [1, 2, 3, 4, 5] } as MarketDatasetSummary;

function bar(sequence: number, phase: AggregatedMarketBarData["phase"] = "CLOSED"): AggregatedMarketBarData {
  return { timestamp: String(sequence), bucketEnd: String(sequence + 1), firstSequence: sequence, lastSequence: sequence,
    sourceCount: 1, expectedCount: 1, open: 10, high: 12, low: 9, close: 11, volume: null, phase, status: "COMPLETE" };
}

function windowWith(visibleBars: AggregatedMarketBarData[]): WindowPayload {
  return { visibleBars, warmupBars: [], lastSourceBar: null };
}

describe("loading the initial historical pane window", () => {
  it("finds the first RTH bar beyond an empty ETH-centered page without reading past the session endpoint", async () => {
    const seen: number[] = [];
    const firstRth = 1_000;
    const end = 1_250;
    const reader = vi.fn((url: string) => {
      const request = new URL(url, "http://localhost");
      const focus = Number(request.searchParams.get("focusSequence"));
      const cutoff = Number(request.searchParams.get("endSequence"));
      const pageEnd = Math.min(cutoff, focus + Number(request.searchParams.get("visibleCount")) / 2);
      expect(cutoff).toBe(end);
      expect(request.searchParams.get("displaySession")).toBe("RTH");
      seen.push(focus);
      const visibleBars = Array.from({ length: Math.max(0, Math.min(pageEnd - firstRth + 1, 120)) }, (_, i) => bar(firstRth + i));
      return { result: Promise.resolve(windowWith(visibleBars)), release: vi.fn() };
    });
    const loaded = await readInitialHistoricalPaneWindow({ dataset, period: 60, session: "RTH", warmup: 20, reader, end }, 100, new AbortController().signal);
    expect(loaded.visibleBars[0].firstSequence).toBe(firstRth);
    expect(loaded.visibleBars).toHaveLength(120);
    expect(loaded.key.endsWith(":100")).toBe(true);
    expect(seen[0]).toBe(100);
    expect(seen.at(-1)).toBe(firstRth);
    expect(Math.max(...seen)).toBeLessThanOrEqual(end);
  });

  it("cancels a pending pane window and ignores a late response", async () => {
    const controller = new AbortController();
    let finish: (window: WindowPayload) => void = () => {};
    const release = vi.fn();
    const reader = vi.fn(() => ({ result: new Promise<WindowPayload>(resolve => { finish = resolve; }), release }));
    const request = readInitialHistoricalPaneWindow({ dataset, period: 60, session: "ETH", warmup: 0, reader, end: 500 }, 100, controller.signal);
    controller.abort();
    finish(windowWith([bar(100)]));
    await expect(request).rejects.toMatchObject({ name: "AbortError" });
    expect(release).toHaveBeenCalledOnce();
    expect(reader).toHaveBeenCalledOnce();
  });
});
