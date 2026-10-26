import { describe, expect, it, vi } from "vitest";
import { useReplayDrawingWindow } from "./use-replay-drawing-window";
import { replayWindowRequest } from "./replay-client-shared";
import { createReplayState } from "@/lib/market-replay/engine";
import type { AggregatedMarketBarData } from "@/lib/market-replay/types";
import type { ReplayViewportSnapshot } from "@/lib/market-replay/chart-range";

vi.mock("react", () => ({ useCallback: (fn: unknown) => fn, useMemo: (fn: () => unknown) => fn(),
  useEffect: () => {}, useRef: (current: unknown) => ({ current }), startTransition: (fn: () => void) => fn() }));
const bar = (sequence: number) => ({ timestamp: new Date(sequence * 60_000).toISOString(), firstSequence: sequence,
  lastSequence: sequence, close: 100, volume: null }) as AggregatedMarketBarData;
const viewport: ReplayViewportSnapshot = { mode: "history", anchor: { timestamp: bar(200).timestamp, sourceSequence: 200 },
  position: 0.5, logicalSpan: 400, barSpacing: 5 };
function setup(cached: boolean, status = 200) {
  const dataset = { id: "fixture", dataVersion: 1, tradingWeekdays: [1,2,3,4,5,6,7], sourceIntervalSeconds: 60,
    barCount: 2000, startTime: bar(0).timestamp, timezone: "UTC", sessionMode: "TWENTY_FOUR_SEVEN", barEmissionMode: "TRADE_DRIVEN" };
  const replay = createReplayState(2000, 0, 1, 900, 799);
  const window = { visibleBars: [bar(190), bar(205)], warmupBars: [bar(180)], lastSourceBar: { ...bar(205), sequence: 205 } };
  const liveWindow = { visibleBars: [bar(780), bar(799)], warmupBars: [bar(779)], lastSourceBar: { ...bar(799), sequence: 799 } };
  const oldBars = [bar(100), bar(101)], oldSource = { sequence: 799 };
  const core = {
    dataset, replay, bars: oldBars, latestReplayRef: { current: replay }, chartVisibility: { drawings: true }, drawings: [],
    playbackDisplayRef: { current: null }, barsRef: { current: oldBars }, warmupBarsRef: { current: [] }, currentSourceBarRef: { current: oldSource },
    windowCache: { current: new Map() }, windowRequestRef: { current: 0 }, windowAbortRef: { current: null },
    historyAbortRef: { current: null }, historyEpochRef: { current: 0 }, historyLoadingRef: { current: false },
    historyLastBarsBeforeRef: { current: null }, historyLaterExhaustedThroughRef: { current: null }, historyHasEarlierRef: { current: true },
    chartWindowDetachedRef: { current: false }, confirmedPaperSnapshotRef: { current: null }, paperSessionLoadedRef: { current: true },
    annotationCoverageRef: { current: null }, annotationRequestRef: { current: 0 }, annotationAbortRef: { current: null },
    setBars: vi.fn(), setChartDisplay: vi.fn(), setChartDataRevision: vi.fn(), setWarmupBars: vi.fn(), setCurrentSourceBar: vi.fn(),
    setTradeAnnotations: vi.fn(), setTradeAnnotationsTruncated: vi.fn(), getDisplayCache: vi.fn(() => ({ persist: vi.fn(async () => {}) })),
    viewChangingRef: { current: true },
    fetch: vi.fn<typeof fetch>(async (url) => new Response(JSON.stringify(String(url).includes("annotations")
      ? { items: [], truncated: false } : status === 200 ? String(url).includes("focusSequence") ? window : liveWindow : { error: "offline" }), { status })),
  };
  const request = replayWindowRequest(dataset as unknown as Parameters<typeof replayWindowRequest>[0], 799, 900, "ETH", 200, 200, 404);
  if (cached) {
    core.windowCache.current.set(request.cacheKey, window);
    core.windowCache.current.set(replayWindowRequest(dataset as unknown as Parameters<typeof replayWindowRequest>[0], 799, 900, "ETH", 200).cacheKey, liveWindow);
  }
  // This harness isolates the window loader; unrelated mount effects are suppressed.
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const loader = useReplayDrawingWindow(core as unknown as Parameters<typeof useReplayDrawingWindow>[0]);
  return { core, loader, oldBars, oldSource, window, liveWindow };
}

describe("applying a new display-period window", () => {
  it.each([false, true])("commits matching data and period metadata for cached=%s", async cached => {
    const s = setup(cached);
    const applied = await s.loader.loadWindow(799, 900, "ETH", 200, null, 200, true, null, false, () => true, viewport);
    expect(applied).toBe(true);
    expect(s.core.setBars).toHaveBeenCalledWith(s.window.visibleBars);
    expect(s.core.setChartDisplay).toHaveBeenCalledWith({ displayIntervalSeconds: 900, displaySession: "ETH", viewport });
    expect(s.core.setWarmupBars).toHaveBeenCalledWith(s.window.warmupBars);
    expect(s.core.currentSourceBarRef.current).toBe(s.oldSource);
    expect(s.core.setCurrentSourceBar).not.toHaveBeenCalled();
    expect(s.core.chartWindowDetachedRef.current).toBe(true);
    const calls = s.core.fetch.mock.calls.filter(([url]) => String(url).includes("/bars/window"));
    expect(calls.length).toBe(cached ? 0 : 2);
    expect(s.core.playbackDisplayRef.current).toEqual({ bars: s.liveWindow.visibleBars, warmupBars: s.liveWindow.warmupBars });
    if (!cached) {
      const url = new URL(calls[0][0] as string, "http://fixture");
      expect(url.searchParams.get("focusSequence")).toBe("200");
      expect(url.searchParams.get("visibleCount")).toBe("404");
      expect(url.searchParams.get("endSequence")).toBe("799");
    }
  });

  it("does not commit either the new period or data when loading fails", async () => {
    const s = setup(false, 503);
    await expect(s.loader.loadWindow(799, 900, "ETH", 200, null, 200, true, null, false, () => true, viewport)).rejects.toThrow("offline");
    expect(s.core.setBars).not.toHaveBeenCalled();
    expect(s.core.setChartDisplay).not.toHaveBeenCalled();
    expect(s.core.barsRef.current).toBe(s.oldBars);
  });

  it("keeps the old chart if its required live calculation window cannot be loaded", async () => {
    const s = setup(false);
    const read = s.core.fetch.getMockImplementation()!;
    s.core.fetch.mockImplementation(async (url, init) => String(url).includes("/bars/window") && !String(url).includes("focusSequence")
      ? new Response(JSON.stringify({ error: "live context unavailable" }), { status: 503 }) : read(url, init));
    await expect(s.loader.loadWindow(799, 900, "ETH", 200, null, 200, true, null, false, () => true, viewport))
      .rejects.toThrow("live context unavailable");
    expect(s.core.setChartDisplay).not.toHaveBeenCalled();
    expect(s.core.setBars).not.toHaveBeenCalled();
    expect(s.core.barsRef.current).toBe(s.oldBars);
    expect(s.core.playbackDisplayRef.current).toBeNull();
  });

  it("rejects a stale generation even for a historical transition", async () => {
    const s = setup(true);
    const applied = await s.loader.loadWindow(799, 900, "ETH", 200, null, 200, true, null, false, () => {
      s.core.latestReplayRef.current = { ...s.core.replay, generation: 2 };
      return true;
    }, viewport);
    expect(applied).toBe(false);
    expect(s.core.setChartDisplay).not.toHaveBeenCalled();
    expect(s.core.setBars).not.toHaveBeenCalled();
  });
});
