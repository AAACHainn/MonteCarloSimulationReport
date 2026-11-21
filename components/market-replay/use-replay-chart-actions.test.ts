import { afterEach, describe, expect, it, vi } from "vitest";
import type { MouseEvent } from "react";
import { useReplayChartActions } from "./use-replay-chart-actions";

vi.mock("react", () => ({ useCallback: (callback: unknown) => callback, useState: (value: unknown) => [value, vi.fn()] }));
afterEach(() => vi.unstubAllGlobals());

function RenderFixture() {
  const ref = <T,>(current: T) => ({ current });
  const bars = Array.from({ length: 200 }, (_, index) => ({ timestamp: new Date(index * 60_000).toISOString(),
    firstSequence: index, lastSequence: index, open: 100, high: 101, low: 99, close: 100, volume: null }));
  const range = { setVisibleLogicalRange: vi.fn(), width: () => 1000, coordinateToLogical: () => 100 };
  const prices = { applyOptions: vi.fn() }, volumes = { applyOptions: vi.fn() };
  const core = {
    readOnly: true, bars, barsRef: ref(bars.slice(0, 25)), displayIntervalSeconds: 60, displaySession: "ETH", priceTickSize: 0.25,
    chartRef: ref({ timeScale: () => range, panes: () => [{ getHeight: () => 600 }] }),
    candleRef: ref({ priceScale: () => prices, coordinateToPrice: () => 100 }), volumeRef: ref({ priceScale: () => volumes }),
    viewportModeRef: ref("history"), viewportUpdatingRef: ref(false), viewportGestureRef: ref(true), pendingFollowRef: ref(true),
    drawingToolRef: ref(null), drawingDraftRef: ref(null), drawingPreviewRef: ref(null),
    currentPrice: 100, contextMenu: null, measurement: null, paperSnapshot: null,
    setContextMenu: vi.fn(), syncLineActionCoordinates: vi.fn(), syncDrawingPrimitive: vi.fn(), syncVisibleSequenceRange: vi.fn(),
  };
  const actions = useReplayChartActions(core as unknown as Parameters<typeof useReplayChartActions>[0],
    { draftSizing: null } as unknown as Parameters<typeof useReplayChartActions>[1]);
  return { actions, core, range, prices, volumes };
}

describe("historical chart view reset", () => {
  it("opens the view menu in blank space beyond the revealed candles", () => {
    const { actions, core } = RenderFixture();
    const event = { preventDefault: vi.fn(), target: { closest: () => null },
      currentTarget: { getBoundingClientRect: () => ({ left: 0, top: 0, width: 1200, height: 800 }) },
      clientX: 500, clientY: 200 };
    actions.openContextMenu(event as unknown as MouseEvent<HTMLDivElement>);
    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(core.setContextMenu).toHaveBeenCalledWith(expect.objectContaining({ hideAfter: null, rewindTarget: null }));
  });

  it("resets to the revealed tail while preserving the hidden boundary and resuming view following", () => {
    const nextFrame = vi.fn<(callback: FrameRequestCallback) => number>();
    vi.stubGlobal("requestAnimationFrame", nextFrame);
    const { actions, core, range, prices, volumes } = RenderFixture();
    const visible = core.barsRef.current;
    actions.resetChartView();
    const next = range.setVisibleLogicalRange.mock.calls[0][0];
    expect(next.from + (next.to - next.from) * 0.618).toBeCloseTo(24);
    expect(prices.applyOptions).toHaveBeenCalledWith({ autoScale: true });
    expect(volumes.applyOptions).toHaveBeenCalledWith({ autoScale: true });
    expect(core.barsRef.current).toBe(visible);
    expect(core.bars).toHaveLength(200);
    expect(core.viewportModeRef.current).toBe("following");
    expect(core.pendingFollowRef.current).toBe(false);
    expect(core.viewportGestureRef.current).toBe(false);
    expect(core.syncVisibleSequenceRange).not.toHaveBeenCalled();
    nextFrame.mock.calls[0][0](0);
    expect(core.viewportUpdatingRef.current).toBe(false);
    expect(core.syncVisibleSequenceRange).toHaveBeenCalledOnce();
  });
});
