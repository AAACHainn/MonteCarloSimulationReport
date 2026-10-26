import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useReplayIndicatorWarmup } from "./use-replay-indicator-warmup";
import { createReplayState } from "@/lib/market-replay/engine";
import type { AggregatedMarketBarData } from "@/lib/market-replay/types";

const hooks = vi.hoisted(() => ({ index: 0, slots: [] as unknown[], effects: [] as Array<() => void> }));
type EffectSlot = { deps: unknown[]; cleanup?: void | (() => void) };
vi.mock("react", () => ({
  useRef: (current: unknown) => {
    const slot = hooks.index++;
    if (!(slot in hooks.slots)) hooks.slots[slot] = { current };
    return hooks.slots[slot];
  },
  useEffect: (work: () => void | (() => void), deps: unknown[]) => {
    const slot = hooks.index++, previous = hooks.slots[slot] as EffectSlot | undefined;
    if (!previous || deps.some((value, index) => !Object.is(value, previous.deps[index]))) {
      hooks.effects.push(() => { previous?.cleanup?.(); hooks.slots[slot] = { deps, cleanup: work() }; });
    }
  },
}));
const bar = (sequence: number) => ({
  timestamp: new Date(sequence * 60_000).toISOString(), close: 100 + sequence,
  firstSequence: sequence, lastSequence: sequence,
}) as AggregatedMarketBarData;
const bars = (start: number, count: number) => Array.from({ length: count }, (_, index) => bar(start + index));
function setup() {
  const replay = { ...createReplayState(2000, 0, 1, 60), currentSequence: 799, status: "playing" as const };
  const visible = bars(500, 300), warmup = bars(480, 20);
  const responders: Array<(response: Response) => void> = [];
  const core = {
    dataset: { id: "fixture", dataVersion: 1, tradingWeekdays: [1, 2, 3, 4, 5] },
    replaySession: { id: "session", activeProjectionId: "projection" }, replay, bars: visible,
    emaSettingsLoaded: true, abrSettingsLoaded: true, indicatorWarmupCount: 20,
    previousIndicatorWarmupCountRef: { current: null as number | null }, skipNextIndicatorReloadRef: { current: false },
    latestReplayRef: { current: replay }, barsRef: { current: visible }, warmupBarsRef: { current: warmup },
    historyEpochRef: { current: 0 }, fetch: vi.fn<typeof fetch>(() => new Promise<Response>(resolve => responders.push(resolve))),
    setWarmupBars: vi.fn(), setEmaError: vi.fn(),
  };
  const render = () => RenderHook(core as unknown as Parameters<typeof useReplayIndicatorWarmup>[0]);
  const respond = (index: number, start: number, count: number) => responders[index](new Response(JSON.stringify({ visibleBars: bars(start, count), warmupBars: [], lastSourceBar: null })));
  return { core, render, respond, responders };
}
function RenderHook(core: Parameters<typeof useReplayIndicatorWarmup>[0]) {
  hooks.index = 0;
  useReplayIndicatorWarmup(core);
  hooks.effects.splice(0).forEach(work => work());
}
beforeEach(() => { hooks.index = 0; hooks.slots = []; hooks.effects = []; });
afterEach(() => { for (const slot of hooks.slots) (slot as EffectSlot | undefined)?.cleanup?.(); });

describe("indicator warmup preserves the replay window", () => {
  it("fetches only before the oldest loaded candle and preserves candles and playback", async () => {
    const s = setup(); s.render();
    expect(s.core.fetch).not.toHaveBeenCalled();
    const visible = s.core.barsRef.current, replay = { ...s.core.latestReplayRef.current };
    s.core.indicatorWarmupCount = 200; s.render();
    const url = new URL(s.core.fetch.mock.calls[0][0] as string, "http://fixture");
    expect(url.searchParams.get("endSequence")).toBe("499");
    expect(url.searchParams.get("visibleCount")).toBe("200");
    expect(url.searchParams.get("warmupCount")).toBe("0");
    s.respond(0, 300, 200);
    await vi.waitFor(() => expect(s.core.setWarmupBars).toHaveBeenCalledOnce());
    expect(s.core.warmupBarsRef.current).toEqual(bars(300, 200));
    expect(s.core.barsRef.current).toBe(visible);
    expect(s.core.latestReplayRef.current).toEqual(replay);
    s.core.indicatorWarmupCount = 20; s.render();
    // Playback may compact the shared warmup while EMA is hidden.
    s.core.warmupBarsRef.current = bars(480, 20);
    s.core.indicatorWarmupCount = 200; s.render();
    expect(s.core.warmupBarsRef.current).toEqual(bars(300, 200));
    expect(s.core.fetch).toHaveBeenCalledOnce();
  });

  it("aborts rapid toggles and ignores a late response after hiding", async () => {
    const s = setup(); s.render(); s.core.indicatorWarmupCount = 200; s.render();
    const signal = s.core.fetch.mock.calls[0][1]?.signal;
    s.core.indicatorWarmupCount = 20; s.render();
    expect(signal?.aborted).toBe(true);
    expect(s.core.fetch).toHaveBeenCalledOnce();
    s.respond(0, 300, 200);
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(s.core.setWarmupBars).not.toHaveBeenCalled();
    s.core.indicatorWarmupCount = 200; s.render(); s.respond(1, 300, 200);
    await vi.waitFor(() => expect(s.core.setWarmupBars).toHaveBeenCalledOnce());
  });

  it.each(["epoch", "timeframe", "generation", "anchor"])("rejects stale prehistory after a %s change", async (change) => {
    const s = setup(); s.core.indicatorWarmupCount = 200; s.render();
    if (change === "epoch") s.core.historyEpochRef.current++;
    if (change === "timeframe") s.core.latestReplayRef.current = { ...s.core.replay, displayIntervalSeconds: 300 };
    if (change === "generation") s.core.latestReplayRef.current = { ...s.core.replay, generation: 2 };
    if (change === "anchor") s.core.barsRef.current = bars(100, 300);
    s.respond(0, 300, 200);
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(s.core.setWarmupBars).not.toHaveBeenCalled();
    expect(s.core.setEmaError).not.toHaveBeenCalled();
  });

  it("allows tail advancement during a request while the oldest candle stays fixed", async () => {
    const s = setup(); s.core.indicatorWarmupCount = 200; s.render();
    s.core.bars = [...s.core.bars, bar(800)]; s.core.barsRef.current = s.core.bars;
    s.core.latestReplayRef.current = { ...s.core.replay, currentSequence: 800 };
    s.core.replay = s.core.latestReplayRef.current;
    s.render();
    expect(s.core.fetch.mock.calls[0][1]?.signal?.aborted).toBe(false);
    s.respond(0, 300, 200);
    await vi.waitFor(() => expect(s.core.setWarmupBars).toHaveBeenCalledOnce());
    expect(s.core.barsRef.current.at(-1)?.lastSequence).toBe(800);
    expect(s.core.latestReplayRef.current.currentSequence).toBe(800);
    expect(s.core.fetch).toHaveBeenCalledOnce();
  });

  it("accepts a short history without retry loops and excludes overlapping/future candles", async () => {
    const s = setup(); s.core.indicatorWarmupCount = 1000; s.render();
    s.respond(0, 450, 100);
    await vi.waitFor(() => expect(s.core.setWarmupBars).toHaveBeenCalledOnce());
    expect(s.core.warmupBarsRef.current).toEqual(bars(450, 50));
    s.core.indicatorWarmupCount = 20; s.render();
    s.core.indicatorWarmupCount = 1000; s.render();
    expect(s.core.fetch).toHaveBeenCalledOnce();
  });

  it("keeps data on failure and allows retry after toggling again", async () => {
    const s = setup(); s.core.indicatorWarmupCount = 200; s.render();
    const original = s.core.warmupBarsRef.current;
    s.responders[0](new Response(JSON.stringify({ error: "offline" }), { status: 503 }));
    await vi.waitFor(() => expect(s.core.setEmaError).toHaveBeenCalledWith("offline"));
    expect(s.core.warmupBarsRef.current).toBe(original);
    expect(s.core.setWarmupBars).not.toHaveBeenCalled();
    s.core.indicatorWarmupCount = 20; s.render();
    s.core.indicatorWarmupCount = 200; s.render(); s.respond(1, 300, 200);
    await vi.waitFor(() => expect(s.core.setEmaError).toHaveBeenLastCalledWith(null));
  });

  it("leaves ABR's explicit update path in control of its own window refresh", () => {
    const s = setup(); s.render();
    s.core.skipNextIndicatorReloadRef.current = true;
    s.core.indicatorWarmupCount = 60; s.render();
    expect(s.core.skipNextIndicatorReloadRef.current).toBe(false);
    expect(s.core.fetch).not.toHaveBeenCalled();
  });
});
