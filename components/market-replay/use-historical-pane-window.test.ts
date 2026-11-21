import { describe, expect, it, vi } from "vitest";
import type { AggregatedMarketBarData, MarketDatasetSummary } from "@/lib/market-replay/types";
import { commitHistoricalWindowChange } from "@/lib/market-replay/historical-window";
import type { WindowPayload } from "./replay-client-shared";
import { prepareHistoricalPaneWindow, readInitialHistoricalPaneWindow } from "./use-historical-pane-window";

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
  it.each([false, true])("finds the first later RTH page when the focused page is empty (reset: %s)", async (resetView) => {
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
    const config = { dataset, period: 60, session: "RTH" as const, warmup: 20, reader, end };
    const signal = new AbortController().signal;
    const loaded = resetView ? (await prepareHistoricalPaneWindow(config, 100, null, signal, true)).window
      : await readInitialHistoricalPaneWindow(config, 100, signal);
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

describe("preparing a historical pane timeline change", () => {
  it("uses the recovered reset page as the prepared pane and restores its safe forming snapshot", async () => {
    const target = 900;
    const previous = bar(target - 1);
    const crossing = { ...bar(target), lastSequence: target + 1, sourceCount: 2 };
    const forming = { ...bar(target, "FORMING") };
    const reader = vi.fn((url: string) => {
      const query = new URL(url, "http://localhost").searchParams;
      const bars = query.get("visibleCount") === "1" ? [forming]
        : query.has("focusSequence") ? [bar(1_200)] : [previous, crossing];
      return { result: Promise.resolve(windowWith(bars)), release: vi.fn() };
    });
    const prepared = await prepareHistoricalPaneWindow({ dataset, period: 300, session: "RTH", warmup: 20, end: 2_000, reader },
      target, target, new AbortController().signal, true);
    expect(prepared.window.key.endsWith(":900")).toBe(true);
    expect(prepared.window.visibleBars).toEqual([previous, crossing]);
    expect(prepared.forming).toMatchObject({ through: target, bar: forming });
    expect(reader).toHaveBeenCalledTimes(3);
  });

  it("keeps the old timeline if the new window succeeds but its forming bar fails", async () => {
    const bucket = { ...bar(100), lastSequence: 104, sourceCount: 5, expectedCount: 5 };
    const failure = new Error("forming snapshot failed");
    const reader = vi.fn((url: string) => {
      const query = new URL(url, "http://localhost").searchParams;
      return { result: query.get("visibleCount") === "1" ? Promise.reject(failure) : Promise.resolve(windowWith([bucket])),
        release: vi.fn() };
    });
    const apply = vi.fn();
    const config = { dataset, period: 300, session: "RTH" as const, warmup: 20, end: 500, reader };
    const prepare = async (signal: AbortSignal) => {
      const prepared = await prepareHistoricalPaneWindow(config, 101, 101, signal);
      return () => apply(prepared);
    };
    await expect(commitHistoricalWindowChange(new AbortController().signal, prepare)).rejects.toBe(failure);
    expect(reader).toHaveBeenCalledTimes(2);
    expect(apply).not.toHaveBeenCalled();
  });

  it("returns the completed window and its bounded forming snapshot together", async () => {
    const bucket = { ...bar(100), lastSequence: 104, sourceCount: 5, expectedCount: 5 };
    const forming = { ...bucket, phase: "FORMING" as const, lastSequence: 101, sourceCount: 2 };
    const reader = vi.fn((url: string) => {
      const query = new URL(url, "http://localhost").searchParams;
      const bounded = query.get("visibleCount") === "1";
      expect(query.get("endSequence")).toBe(bounded ? "101" : "500");
      return { result: Promise.resolve(windowWith([bounded ? forming : bucket])), release: vi.fn() };
    });
    const prepared = await prepareHistoricalPaneWindow({ dataset, period: 300, session: "RTH", warmup: 20, end: 500, reader },
      101, 101, new AbortController().signal);
    expect(prepared.window.visibleBars).toEqual([bucket]);
    expect(prepared.forming).toMatchObject({ through: 101, bar: forming });
    expect(reader).toHaveBeenCalledTimes(2);
  });
});
