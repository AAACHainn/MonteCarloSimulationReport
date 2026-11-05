import { describe, expect, it, vi } from "vitest";
import { chartThemes } from "@/lib/chart-theme";
import { useReplayChartSetup } from "./use-replay-chart-setup";
const state = vi.hoisted(() => ({ mode: "light" as "light" | "dark", effects: [] as Array<{ work: () => void; deps: unknown[] }> }));
vi.mock("@/components/appearance-provider", () => ({ useAppearance: () => ({ mode: state.mode }) }));
vi.mock("./use-replay-chart-ema", () => ({ useReplayChartEma: () => {} }));
vi.mock("react", () => ({ useRef: (current: unknown) => ({ current }), useCallback: (fn: unknown) => fn,
  useMemo: (fn: () => unknown) => fn(), useEffect: (work: () => void, deps: unknown[]) => state.effects.push({ work, deps }) }));

describe("changing an existing replay chart appearance", () => {
  it("keeps chart lifecycle dependencies, viewport, playback, selection and draft while repainting all primitives", () => {
    const ref = <T,>(current: T) => ({ current });
    const chart = { applyOptions: vi.fn(), remove: vi.fn(), timeScale: vi.fn() };
    const primitive = { setTheme: vi.fn() };
    const draft = { id: "draft" };
    const core = { chartRef: ref(chart), priceTickSize: 0.25, draft,
      rectanglePrimitiveRef: ref(primitive), trendLinePrimitiveRef: ref(primitive), fibonacciPrimitiveRef: ref(primitive),
      textPrimitiveRef: ref(primitive), arrowPrimitiveRef: ref(primitive), abcdPrimitiveRef: ref(primitive),
      tradeAnnotationPrimitiveRef: ref(primitive), barCountPrimitiveRef: ref(primitive), candleCountdownPrimitiveRef: ref(primitive),
      selectedDrawingId: "selected", playbackActive: true, gridVisible: false,
      currentSourceSequenceRef: ref(100), viewportModeRef: ref("history"), paperSnapshot: null };
    const Render = () => { state.effects = []; useReplayChartSetup(core as unknown as Parameters<typeof useReplayChartSetup>[0]); return state.effects; };
    state.mode = "light";
    const before = Render(); before.find(e => e.deps.includes(chartThemes.light))!.work();
    state.mode = "dark";
    const after = Render(); after.find(e => e.deps.includes(chartThemes.dark))!.work();
    // The first effect owns createChart/remove; a theme change must never reschedule it.
    expect(after[0].deps.every((dep, i) => Object.is(dep, before[0].deps[i]))).toBe(true);
    expect(chart.remove).not.toHaveBeenCalled(); expect(chart.timeScale).not.toHaveBeenCalled();
    expect(chart.applyOptions).toHaveBeenLastCalledWith(expect.objectContaining({ layout: expect.objectContaining({ textColor: chartThemes.dark.text }) }));
    expect(primitive.setTheme).toHaveBeenCalledTimes(18);
    expect(primitive.setTheme).toHaveBeenLastCalledWith(chartThemes.dark);
    expect(core.chartRef.current).toBe(chart); expect(core.draft).toBe(draft);
    expect(core).toMatchObject({ selectedDrawingId: "selected", playbackActive: true, gridVisible: false });
    expect(core.currentSourceSequenceRef.current).toBe(100); expect(core.viewportModeRef.current).toBe("history");
    expect(JSON.stringify(chart.applyOptions.mock.calls)).not.toMatch(/visibleLogicalRange|autoScale|barSpacing|gridVisible/);
  });
});
