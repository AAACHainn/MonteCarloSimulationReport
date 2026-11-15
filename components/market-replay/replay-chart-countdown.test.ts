import { describe, expect, it, vi } from "vitest";
import { useReplayChartSetup } from "./use-replay-chart-setup";
import type { AggregatedMarketBarData } from "@/lib/market-replay/types";
const effects = vi.hoisted(() => [] as Array<{ work: () => void; deps: unknown[] }>);
vi.mock("react", async original => ({ ...await original<typeof import("react")>(),
  useRef: (current: unknown) => ({ current }), useCallback: (fn: unknown) => fn,
  useMemo: (fn: () => unknown) => fn(), useLayoutEffect: () => {},
  useEffect: (work: () => void, deps: unknown[]) => effects.push({ work, deps }),
}));
vi.mock("@/components/appearance-provider", () => ({ useAppearance: () => ({ mode: "light" }) }));
vi.mock("./use-replay-chart-ema", () => ({ useReplayChartEma: () => {} }));
describe("countdown wiring on a masked historical chart", () => {
  it("shows the playback deadline through the historical mask, while respecting indicator visibility and static hiding", () => {
    const bars: AggregatedMarketBarData[] = [];
    const countdown = { current: { setData: vi.fn() } };
    const core = { visibleBars: bars, candleCountdownPrimitiveRef: countdown, candleRef: { current: null },
      candleCountdownSeconds: 12, candleCountdownEnabled: true, playbackActive: true, displayIntervalSeconds: 300,
      sourceIntervalSeconds: 60, currentSourceTimestamp: null, paperSnapshot: null,
      hiddenAfter: { bar: { lastSequence: 100 }, displayIntervalSeconds: 300, displaySession: "ETH" },
      historicalPlaybackActive: true };
    const Render = () => {
      effects.length = 0;
      useReplayChartSetup(core as unknown as Parameters<typeof useReplayChartSetup>[0]);
      effects.find(effect => effect.deps[0] === bars && effect.deps.at(-1) === countdown)!.work();
    };
    Render();
    expect(countdown.current.setData).toHaveBeenLastCalledWith(expect.objectContaining({ enabled: true, playing: true, remainingSeconds: 12 }));
    core.candleCountdownEnabled = false; Render();
    expect(countdown.current.setData).toHaveBeenLastCalledWith(expect.objectContaining({ enabled: false }));
    core.candleCountdownEnabled = true; core.historicalPlaybackActive = false; Render();
    expect(countdown.current.setData).toHaveBeenLastCalledWith(expect.objectContaining({ enabled: false }));
  });
});
