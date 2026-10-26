import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useReplayChartSetup } from "./use-replay-chart-setup";
import type { AggregatedMarketBarData } from "@/lib/market-replay/types";
import type { ReplayViewportSnapshot } from "@/lib/market-replay/chart-range";

const harness = vi.hoisted(() => ({ revision: "viewport-window-fixture" }));
vi.mock("react", () => ({ useCallback: (fn: unknown) => fn, useMemo: (fn: () => unknown) => fn(),
  useRef: (current: unknown) => ({ current }), useLayoutEffect: () => {},
  // Execute the data effect only; DOM creation and unrelated overlays have separate tests.
  useEffect: (work: () => void, deps: unknown[]) => { if (deps.includes(harness.revision)) work(); },
}));
const bars = (count: number, minutes = 1) => Array.from({ length: count }, (_, index) => ({
  timestamp: new Date(index * minutes * 60_000).toISOString(), firstSequence: index * minutes,
  lastSequence: (index + 1) * minutes - 1, open: 100, high: 101, low: 99, close: 100, volume: null,
}) as AggregatedMarketBarData);
function setup(previous = bars(300)) {
  let range = { from: 176, to: 375 }, autoScale = false;
  const scale = { options: () => ({ autoScale }), applyOptions: vi.fn((options: { autoScale: boolean }) => { autoScale = options.autoScale; }) };
  const line = { update: vi.fn(), setData: vi.fn(), priceScale: () => scale };
  const time = { width: () => 1000, options: () => ({ barSpacing: 5 }), getVisibleLogicalRange: () => range,
    setVisibleLogicalRange: vi.fn((next: { from: number; to: number }) => { range = next; }) };
  const ref = <T,>(current: T) => ({ current });
  const core = {
    chartRef: ref({ timeScale: () => time }), candleRef: ref(line), volumeRef: ref(null),
    bars: previous, visibleBars: previous, visibleWarmupBars: [], projectionBars: previous,
    lastDataRef: ref(previous), lastDataRevisionRef: ref(harness.revision), lastHiddenAfterRef: ref(null),
    lastDataIntervalRef: ref(60), lastDataSessionRef: ref("ETH"), displaySessionRef: ref("ETH"),
    barsRef: ref(previous), timelineBarsRef: ref(previous), projectionBarsRef: ref(previous),
    drawingScopeRef: ref("scope"), displayIntervalSecondsRef: ref(60), requestedDisplayIntervalSecondsRef: ref(60),
    drawingSessionRef: ref(null), requestedDrawingSessionRef: ref(null),
    viewportModeRef: ref<"following" | "history">("following"), viewportGestureRef: ref(false),
    viewportUpdatingRef: ref(false), currentSourceSequenceRef: ref(299), pendingFollowRef: ref(false), liveWindowRef: ref(true),
    dataRevision: harness.revision, displayIntervalSeconds: 60, displaySession: "ETH", visibilityScope: "scope",
    hiddenAfter: null, readOnly: false, emaIndicators: [], priceTickSize: 1, viewportSnapshot: null as ReplayViewportSnapshot | null,
    syncVisibleSequenceRange: vi.fn(), syncMeasurementCoordinates: vi.fn(), syncDrawingPrimitive: vi.fn(),
  };
  const render = () => RenderHook(core as unknown as Parameters<typeof useReplayChartSetup>[0]);
  return { core, render, line, scale, time };
}
function RenderHook(core: Parameters<typeof useReplayChartSetup>[0]) { useReplayChartSetup(core); }
beforeEach(() => vi.stubGlobal("requestAnimationFrame", vi.fn(() => 1)));
afterEach(() => vi.unstubAllGlobals());

describe("applying chart viewport transitions", () => {
  it("does not consume the requested period until that period's data is actually applied", () => {
    const s = setup(); s.render();
    expect(s.core.lastDataIntervalRef.current).toBe(60);
    expect(s.scale.applyOptions).not.toHaveBeenCalled();
    s.core.viewportSnapshot = { mode: "following", anchor: { sourceSequence: 299, timestamp: s.core.bars[299].timestamp },
      position: 0.618, logicalSpan: 199, barSpacing: 5 };
    const next = bars(20, 15);
    Object.assign(s.core, { bars: next, visibleBars: next, projectionBars: next, displayIntervalSeconds: 900 });
    s.core.requestedDisplayIntervalSecondsRef.current = 900;
    s.render();
    expect(s.core.lastDataIntervalRef.current).toBe(900);
    expect(s.scale.applyOptions).toHaveBeenLastCalledWith({ autoScale: true });
    const range = s.time.getVisibleLogicalRange();
    expect(range.to - range.from).toBeCloseTo(199);
    expect((19 - range.from + 0.5) / 200).toBeCloseTo(0.618);
  });

  it("performs a full period replacement even when one forming candle shares the same timestamp", () => {
    const s = setup(bars(1));
    s.core.bars = bars(1, 15); s.core.visibleBars = s.core.bars; s.core.projectionBars = s.core.bars;
    s.core.displayIntervalSeconds = 900; s.core.requestedDisplayIntervalSecondsRef.current = 900;
    s.render();
    expect(s.line.setData).toHaveBeenCalledOnce();
    expect(s.line.update).not.toHaveBeenCalled();
    expect(s.scale.applyOptions).toHaveBeenLastCalledWith({ autoScale: true });
  });

  it("keeps a manually inspected viewport and manual vertical scaling through ordinary advancement", () => {
    const s = setup(); s.core.viewportModeRef.current = "history";
    const old = s.time.getVisibleLogicalRange();
    s.core.bars = bars(301); s.core.visibleBars = s.core.bars; s.core.projectionBars = s.core.bars;
    s.render();
    expect(s.time.getVisibleLogicalRange()).toEqual(old);
    expect(s.scale.options().autoScale).toBe(false);
    expect(s.scale.applyOptions).not.toHaveBeenCalled();
  });
});
