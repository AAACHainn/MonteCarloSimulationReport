import { describe, expect, it, vi } from "vitest";
import { changeReplayDisplayInterval } from "./change-replay-display";
import { createReplayState } from "@/lib/market-replay/engine";
import type { ReplayViewportSnapshot } from "@/lib/market-replay/chart-range";

type Core = Parameters<typeof changeReplayDisplayInterval>[0];
type Dependencies = Parameters<typeof changeReplayDisplayInterval>[1];
const snapshot: ReplayViewportSnapshot = { mode: "following", anchor: { sourceSequence: 799, timestamp: "2026-01-01T13:19:00Z" },
  position: 0.618, logicalSpan: 250, barSpacing: 5 };
function setup(viewport = snapshot) {
  const current = createReplayState(10000, 0, 1, 60, 799);
  const latestReplayRef = { current };
  const core = {
    latestReplayRef, viewChangingRef: { current: false },
    suspendPlayback: vi.fn(() => ({ token: 1 })), restorePlayback: vi.fn(),
    manualStepsRef: { current: { cancel: vi.fn() } }, advanceCompletionRef: { current: Promise.resolve() },
    playbackAccumulatorRef: { current: 5 }, playbackClockRef: { current: 0 },
    chartViewportRef: { current: { capture: vi.fn(() => viewport) } }, chartWindowDetachedRef: { current: viewport.mode === "history" },
    indicatorWarmupCountRef: { current: 200 },
    setReplay: vi.fn((state: typeof current) => { latestReplayRef.current = state; }), setEmaError: vi.fn(), setPaperError: vi.fn(),
  };
  const dependencies = { loadWindow: vi.fn<Dependencies["loadWindow"]>(async () => true),
    flushVisible: vi.fn(async () => true), queueSave: vi.fn() };
  const change = (seconds: number) => changeReplayDisplayInterval(core as unknown as Core, dependencies, seconds);
  return { core, dependencies, change, current };
}

describe("replay display changes", () => {
  it("captures the settled viewport, keeps source progress and passes the target window its snapshot", async () => {
    const s = setup();
    s.dependencies.flushVisible.mockImplementationOnce(async () => {
      s.core.latestReplayRef.current = { ...s.current, currentSequence: 800, syncVersion: 3 };
      return true;
    });
    expect(await s.change(900)).toBe(true);
    expect(s.core.chartViewportRef.current.capture).toHaveBeenCalledWith(800, true);
    expect(s.core.latestReplayRef.current).toMatchObject({ currentSequence: 800, generation: s.current.generation, syncVersion: 3, displayIntervalSeconds: 900 });
    expect(s.dependencies.loadWindow).toHaveBeenCalledWith(800, 900, "ETH", 200, null, null, false, null, false, expect.any(Function), snapshot);
    expect(s.core.restorePlayback).toHaveBeenCalledOnce();
    expect(s.core.viewChangingRef.current).toBe(false);
  });

  it("loads around the historical anchor instead of replacing it with the live tail", async () => {
    const history = { ...snapshot, mode: "history" as const, anchor: { ...snapshot.anchor, sourceSequence: 200 } };
    const s = setup(history);
    await s.change(300);
    expect(s.core.chartViewportRef.current.capture).toHaveBeenCalledWith(799, false);
    expect(s.dependencies.loadWindow).toHaveBeenCalledWith(799, 300, "ETH", 200, null, 200, true, null, false, expect.any(Function), history);
    expect(s.core.latestReplayRef.current.currentSequence).toBe(799);
  });

  it("serializes changes while a network window is pending, and rolls back rejected windows", async () => {
    const s = setup(); let resolve!: (value: boolean) => void;
    s.dependencies.loadWindow.mockImplementationOnce(() => new Promise<boolean>(done => { resolve = done; }));
    const changing = s.change(900);
    await vi.waitFor(() => expect(s.dependencies.loadWindow).toHaveBeenCalledOnce());
    expect(s.core.viewChangingRef.current).toBe(true);
    expect(await s.change(300)).toBe(false);
    expect(s.dependencies.loadWindow).toHaveBeenCalledOnce();
    resolve(false);
    expect(await changing).toBe(false);
    expect(s.core.latestReplayRef.current).toEqual(s.current);
    expect(s.dependencies.queueSave).toHaveBeenLastCalledWith(s.current, true);
    expect(s.core.restorePlayback).toHaveBeenCalledOnce();
  });

  it("keeps the old settings after failed loads and always releases the playback suspension", async () => {
    const s = setup(); s.dependencies.loadWindow.mockRejectedValueOnce(new Error("offline"));
    expect(await s.change(900)).toBe(false);
    expect(s.core.latestReplayRef.current).toEqual(s.current);
    expect(s.core.setPaperError).toHaveBeenCalledWith("offline");
    expect(s.core.viewChangingRef.current).toBe(false);
    expect(s.core.restorePlayback).toHaveBeenCalledOnce();
  });

  it("does not overwrite a newer replay generation when an older request is rejected", async () => {
    const s = setup();
    s.dependencies.loadWindow.mockImplementationOnce(async (...args) => {
      s.core.latestReplayRef.current = { ...s.current, generation: 2, currentSequence: 10 };
      expect(args[9]!()).toBe(false);
      return false;
    });
    expect(await s.change(900)).toBe(false);
    expect(s.core.latestReplayRef.current.generation).toBe(2);
    expect(s.core.latestReplayRef.current.currentSequence).toBe(10);
  });

  it("leaves the chart untouched for the same period or an unsuccessful account flush", async () => {
    const s = setup();
    expect(await s.change(60)).toBe(true);
    expect(s.core.suspendPlayback).not.toHaveBeenCalled();
    s.dependencies.flushVisible.mockResolvedValueOnce(false);
    expect(await s.change(900)).toBe(false);
    expect(s.core.setReplay).not.toHaveBeenCalled();
    expect(s.dependencies.loadWindow).not.toHaveBeenCalled();
    expect(s.core.chartViewportRef.current.capture).not.toHaveBeenCalled();
  });
});
