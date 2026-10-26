import { beforeEach, describe, expect, it, vi } from "vitest";
import type { IChartApi, SeriesOptionsMap } from "lightweight-charts";
import { useReplayChartEma } from "./use-replay-chart-ema";
import { calculateEmaSeries } from "@/lib/market-replay/ema";
import type { AggregatedMarketBarData, EmaIndicatorConfig } from "@/lib/market-replay/types";

const hooks = vi.hoisted(() => ({ index: 0, slots: [] as unknown[], effects: [] as Array<() => void> }));
type EffectSlot = { deps: unknown[] };
vi.mock("react", () => ({
  useRef: (current: unknown) => {
    const slot = hooks.index++;
    if (!(slot in hooks.slots)) hooks.slots[slot] = { current };
    return hooks.slots[slot];
  },
  useLayoutEffect: (work: () => void) => { hooks.effects.push(work); hooks.index++; },
  useEffect: (work: () => void, deps: unknown[]) => {
    const slot = hooks.index++, previous = hooks.slots[slot] as EffectSlot | undefined;
    if (!previous || deps.some((value, index) => !Object.is(value, previous.deps[index]))) {
      hooks.effects.push(() => { hooks.slots[slot] = { deps }; work(); });
    }
  },
}));
const bar = (sequence: number) => ({
  timestamp: new Date(sequence * 60_000).toISOString(), close: 100 + sequence,
  firstSequence: sequence, lastSequence: sequence,
}) as AggregatedMarketBarData;
const indicator: EmaIndicatorConfig = { id: "ema", length: 2, color: "#2563eb", lineWidth: 2, lineStyle: "SOLID", visible: true };
function chart() {
  const lines: Array<{ applyOptions: ReturnType<typeof vi.fn>; setData: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> }> = [];
  const api = {
    addSeries: vi.fn(() => { const line = { applyOptions: vi.fn(), setData: vi.fn(), update: vi.fn() }; lines.push(line); return line; }),
    removeSeries: vi.fn(),
  };
  return { api, lines, ref: { current: api as unknown as IChartApi } };
}
function RenderHook(props: Parameters<typeof useReplayChartEma>[0]) {
  hooks.index = 0;
  useReplayChartEma(props);
  hooks.effects.splice(0).forEach(work => work());
}
beforeEach(() => { hooks.index = 0; hooks.slots = []; hooks.effects = []; });

describe("EMA visibility without chart movement", () => {
  it("reuses the line and its data for total and individual visibility toggles", () => {
    const c = chart();
    const props = { chartRef: c.ref, bars: [bar(2), bar(3)], warmupBars: [bar(0), bar(1)], enabled: true, indicators: [indicator], chartKey: 0.25 };
    RenderHook(props);
    const line = c.lines[0];
    const options = c.api.addSeries.mock.calls[0] as unknown as [unknown, Partial<SeriesOptionsMap["Line"]>];
    expect(options[1].autoscaleInfoProvider?.(() => null)).toBeNull();
    expect(options[1].lastValueVisible).toBe(false);
    RenderHook({ ...props, enabled: false });
    expect(line.applyOptions).toHaveBeenLastCalledWith({ visible: false });
    RenderHook(props);
    RenderHook({ ...props, indicators: [{ ...indicator, visible: false }] });
    expect(line.applyOptions).toHaveBeenLastCalledWith({ visible: false });
    RenderHook(props);
    expect(line.applyOptions).toHaveBeenLastCalledWith(expect.objectContaining({ visible: true }));
    expect(c.api.addSeries).toHaveBeenCalledOnce();
    expect(c.api.removeSeries).not.toHaveBeenCalled();
    expect(line.setData).toHaveBeenCalledOnce();
    expect(line.update).not.toHaveBeenCalled();
  });

  it("updates the forming tail and new bars with the original EMA formula", () => {
    const c = chart();
    const props = { chartRef: c.ref, bars: [bar(2), bar(3)], warmupBars: [bar(0), bar(1)], enabled: true, indicators: [indicator], chartKey: 1 };
    RenderHook(props);
    const changed = { ...bar(3), close: 130 };
    const bars = [bar(2), changed, bar(4)];
    RenderHook({ ...props, bars });
    const expected = calculateEmaSeries([...props.warmupBars, ...bars], 2, 4).points.at(-1)!;
    expect(c.lines[0].update).toHaveBeenLastCalledWith({ time: 240, value: expected.value });
    expect(c.lines[0].setData).toHaveBeenCalledOnce();
  });

  it("clears old hidden timestamps on rewind/window changes, then recalculates on show", () => {
    const c = chart();
    const props = { chartRef: c.ref, bars: [bar(10), bar(11)], warmupBars: [bar(8), bar(9)], enabled: true, indicators: [indicator], chartKey: 1 };
    RenderHook(props);
    RenderHook({ ...props, enabled: false });
    const next = { ...props, bars: [bar(2), bar(3)], warmupBars: [bar(0), bar(1)] };
    RenderHook({ ...next, enabled: false });
    expect(c.lines[0].setData).toHaveBeenLastCalledWith([]);
    RenderHook(next);
    expect(c.lines[0].setData).toHaveBeenLastCalledWith([
      { time: 120, value: 101.5 }, { time: 180, value: 102.5 },
    ]);
    expect(c.api.addSeries).toHaveBeenCalledOnce();
  });

  it("recalculates on length or prehistory changes and removes only deleted indicators", () => {
    const c = chart();
    const props = { chartRef: c.ref, bars: [bar(2), bar(3)], warmupBars: [bar(0), bar(1)], enabled: true, indicators: [indicator], chartKey: 1 };
    RenderHook(props);
    const next = { ...props, indicators: [{ ...indicator, length: 3 }] };
    RenderHook(next);
    expect(c.lines[0].setData).toHaveBeenLastCalledWith([{ time: 120, value: 101 }, { time: 180, value: 102 }]);
    RenderHook({ ...next, warmupBars: [bar(-1), ...props.warmupBars] });
    expect(c.lines[0].setData).toHaveBeenCalledTimes(3);
    RenderHook({ ...next, indicators: [] });
    expect(c.api.removeSeries).toHaveBeenCalledOnce();
    expect(c.api.removeSeries).toHaveBeenCalledWith(c.lines[0]);
  });

  it("creates fresh series when the owning chart is recreated", () => {
    const c = chart();
    const props = { chartRef: c.ref, bars: [bar(2), bar(3)], warmupBars: [bar(0), bar(1)], enabled: true, indicators: [indicator], chartKey: 1 };
    RenderHook(props);
    const next = chart();
    c.ref.current = next.ref.current;
    RenderHook({ ...props, chartKey: 0.25 });
    expect(next.api.addSeries).toHaveBeenCalledOnce();
    expect(next.lines[0].setData).toHaveBeenCalledOnce();
    expect(c.api.removeSeries).not.toHaveBeenCalled();
  });
});
