import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useHistoricalPlayback } from "./use-historical-playback";
import type { AggregatedMarketBarData } from "@/lib/market-replay/types";

// A minimal hook lifecycle lets the real timer and cursor run without a browser or business API.
const harness = vi.hoisted(() => ({ cursor: 0, slots: new Map<number, unknown>(),
  effects: new Map<number, { deps: unknown[]; cleanup?: () => void }>(), pending: [] as Array<() => void> }));
vi.mock("react", () => ({
  useRef: (current: unknown) => {
    const id = harness.cursor++;
    if (!harness.slots.has(id)) harness.slots.set(id, { current });
    return harness.slots.get(id);
  },
  useState: (initial: unknown) => {
    const id = harness.cursor++;
    if (!harness.slots.has(id)) harness.slots.set(id, typeof initial === "function" ? initial() : initial);
    return [harness.slots.get(id), (value: unknown) => {
      harness.slots.set(id, typeof value === "function" ? value(harness.slots.get(id)) : value);
    }];
  },
  useSyncExternalStore: (...args: [unknown, () => unknown]) => args[1](),
  useEffect: (work: () => (() => void) | undefined, deps: unknown[]) => {
    const id = harness.cursor++;
    const previous = harness.effects.get(id);
    if (previous && deps.every((value, index) => Object.is(value, previous.deps[index]))) return;
    harness.pending.push(() => { previous?.cleanup?.(); harness.effects.set(id, { deps, cleanup: work() }); });
  },
}));
function bar(sequence: number): AggregatedMarketBarData {
  return { timestamp: new Date(sequence * 1000).toISOString(), bucketEnd: new Date((sequence + 5) * 1000).toISOString(),
    firstSequence: sequence, lastSequence: sequence + 4, open: 100, high: 101, low: 99, close: 100,
    sourceCount: 5, expectedCount: 5, volume: 1, status: "COMPLETE" };
}
function setup() {
  const options = { endSequence: 14, seconds: 5, disabled: false,
    getTimeline: () => ({ bars: [bar(0), bar(5), bar(10)], seconds: 5, session: "ETH" as const }),
    readLater: vi.fn(async () => []) };
  const Render = () => {
    harness.cursor = 0; harness.pending = [];
    const result = useHistoricalPlayback(options);
    harness.pending.forEach(work => work());
    return result;
  };
  const engine = Render().engine;
  engine.start({ bar: bar(0), displayIntervalSeconds: 5, displaySession: "ETH" });
  engine.setRate(1); engine.toggle(); Render();
  return { engine, render: Render, options };
}
beforeEach(() => {
  harness.slots.clear(); harness.effects.clear(); harness.pending = [];
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "performance"] });
  vi.stubGlobal("document", Object.assign(new EventTarget(), { hidden: false }));
});
afterEach(() => {
  harness.effects.forEach(effect => effect.cleanup?.());
  vi.useRealTimers(); vi.unstubAllGlobals();
});
describe("historical playback countdown and scheduler", () => {
  it("counts down to the same deadline that reveals the next complete displayed candle", async () => {
    const s = setup();
    expect(s.render().countdownSeconds).toBe(5);
    await vi.advanceTimersByTimeAsync(1000);
    expect(s.render().countdownSeconds).toBe(4);
    expect(s.engine.getSnapshot().boundary!.bar.lastSequence).toBe(4);
    await vi.advanceTimersByTimeAsync(4000);
    s.render();
    expect(s.engine.getSnapshot().boundary!.bar.lastSequence).toBe(9);
    expect(s.render().countdownSeconds).toBe(5);
    await vi.advanceTimersByTimeAsync(5000);
    s.render();
    expect(s.engine.getSnapshot()).toMatchObject({ finished: true, playing: false });
    expect(s.render().countdownSeconds).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });
  it("changes speed without leaving an earlier timer that could reveal an extra candle", async () => {
    const s = setup();
    await vi.advanceTimersByTimeAsync(2000); s.render();
    s.engine.setRate(5); s.render();
    expect(s.render().countdownSeconds).toBe(1);
    await vi.advanceTimersByTimeAsync(1000);
    s.render(); s.engine.pause(); s.render();
    await vi.advanceTimersByTimeAsync(10000);
    expect(s.engine.getSnapshot().boundary!.bar.lastSequence).toBe(9);
    expect(s.render().countdownSeconds).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });
  it("does not advance after pause even before React commits the timer cleanup", async () => {
    const s = setup(); s.engine.pause();
    await vi.advanceTimersByTimeAsync(5000);
    expect(s.engine.getSnapshot().boundary!.bar.lastSequence).toBe(4);
    s.render(); expect(vi.getTimerCount()).toBe(0);
  });
  it("clears both countdown and advance timers on background pause and exit", async () => {
    const s = setup();
    Object.assign(document, { hidden: true }); document.dispatchEvent(new Event("visibilitychange"));
    s.render();
    expect(s.render().countdownSeconds).toBeNull();
    await vi.advanceTimersByTimeAsync(10000);
    expect(s.engine.getSnapshot()).toMatchObject({ playing: false, boundary: { bar: bar(0) } });
    s.engine.exit(); s.render();
    expect(s.render()).toMatchObject({ active: false, boundary: null, countdownSeconds: null });
    expect(vi.getTimerCount()).toBe(0);
  });
});
