import { beforeEach, describe, expect, it, vi } from "vitest";
import { useReplayEngine } from "./use-replay-engine";
import { createReplayState } from "@/lib/market-replay/engine";

const saves = vi.hoisted(() => ({ queueSave: vi.fn(), flushPreferences: vi.fn() }));
vi.mock("react", () => ({ useCallback: (fn: unknown) => fn, useEffect: () => {} }));
vi.mock("./use-replay-preference-save", () => ({ useReplayPreferenceSave: () => saves }));
function setup(status: "playing" | "paused" = "playing") {
  const replay = { ...createReplayState(2000, 0, 1, 60, 799), status };
  const latestReplayRef = { current: replay };
  let finishAdvance!: () => void;
  const core = {
    dataset: { id: "fixture" }, replay, latestReplayRef,
    shortcuts: { platform: "OTHER" }, textDrawing: { editor: null },
    confirmedPaperSnapshotRef: { current: null }, preparingEntryCheckRef: { current: false },
    requestRetryingRef: { current: false }, viewChangingRef: { current: false },
    chartWindowDetachedRef: { current: true }, recoveryRequiredRef: { current: false }, historyConflictRef: { current: false },
    advanceCompletionRef: { current: new Promise<void>(resolve => { finishAdvance = resolve; }) },
    paperMutationChainRef: { current: Promise.resolve() },
    indicatorWarmupCountRef: { current: 200 }, playbackEpochRef: { current: 0 }, playbackClockRef: { current: 0 },
    manualStepsRef: { current: { cancel: vi.fn() } },
    chartViewportRef: { current: { followLatest: vi.fn() } },
    pausePlayback: vi.fn(() => { latestReplayRef.current = { ...latestReplayRef.current, status: "paused" }; }),
    playPlayback: vi.fn(() => { latestReplayRef.current = { ...latestReplayRef.current, status: "playing" }; }),
    setReviewReturning: vi.fn(), setJournalReview: vi.fn(), setChartFocusSequence: vi.fn(), setPaperError: vi.fn(),
  };
  const loadWindow = vi.fn(async (endSequence: number) => {
    if (endSequence !== latestReplayRef.current.currentSequence) return false;
    core.chartWindowDetachedRef.current = false;
    return true;
  });
  // Mount/playback effects are suppressed; these tests exercise actual control callbacks.
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const engine = useReplayEngine(core as unknown as Parameters<typeof useReplayEngine>[0],
    { loadWindow } as unknown as Parameters<typeof useReplayEngine>[1]);
  const acknowledge = (sequence = 810) => {
    latestReplayRef.current = { ...latestReplayRef.current, currentSequence: sequence, confirmedSequence: sequence };
    finishAdvance();
  };
  return { core, engine, loadWindow, acknowledge };
}
beforeEach(() => vi.clearAllMocks());

describe("playback controls with a detached historical chart", () => {
  it("pauses immediately during an in-flight advance without requiring a live-window load", async () => {
    const s = setup();
    s.loadWindow.mockRejectedValue(new Error("offline"));
    await s.engine.togglePlayback();
    expect(s.core.pausePlayback).toHaveBeenCalledOnce();
    expect(s.core.latestReplayRef.current.status).toBe("paused");
    expect(s.core.chartWindowDetachedRef.current).toBe(true);
    expect(s.loadWindow).not.toHaveBeenCalled();
    expect(saves.queueSave).not.toHaveBeenCalled();
    s.acknowledge();
    await vi.waitFor(() => expect(saves.queueSave).toHaveBeenCalledWith(
      expect.objectContaining({ currentSequence: 810, status: "paused" }), true));
    expect(s.core.playPlayback).not.toHaveBeenCalled();
  });

  it("returns to the live tail only after the in-flight advance has been acknowledged", async () => {
    const s = setup();
    const returning = s.engine.returnToLiveWindow();
    expect(s.core.viewChangingRef.current).toBe(true);
    expect(s.loadWindow).not.toHaveBeenCalled();
    s.acknowledge();
    expect(await returning).toBe(true);
    expect(s.loadWindow).toHaveBeenCalledWith(810, 60, "ETH", 200);
    expect(s.core.chartViewportRef.current.followLatest).toHaveBeenCalledOnce();
    expect(s.core.viewChangingRef.current).toBe(false);
    expect(s.core.setReviewReturning).toHaveBeenLastCalledWith(false);
  });

  it("loads the settled live window before resuming a paused historical chart", async () => {
    const s = setup("paused");
    const playing = s.engine.togglePlayback();
    expect(s.core.playPlayback).not.toHaveBeenCalled();
    expect(s.loadWindow).not.toHaveBeenCalled();
    s.acknowledge();
    await playing;
    expect(s.loadWindow).toHaveBeenCalledWith(810, 60, "ETH", 200);
    expect(s.core.playPlayback).toHaveBeenCalledOnce();
  });

  it("rejects a changed generation after waiting without loading or focusing an old window", async () => {
    const s = setup("paused");
    const returning = s.engine.returnToLiveWindow();
    s.core.latestReplayRef.current = { ...s.core.latestReplayRef.current, generation: 2 };
    s.acknowledge();
    expect(await returning).toBe(false);
    expect(s.loadWindow).not.toHaveBeenCalled();
    expect(s.core.chartViewportRef.current.followLatest).not.toHaveBeenCalled();
    expect(s.core.viewChangingRef.current).toBe(false);
  });

  it("keeps playback paused when the live window cannot be loaded", async () => {
    const s = setup("paused");
    s.loadWindow.mockRejectedValueOnce(new Error("offline"));
    s.acknowledge();
    await s.engine.togglePlayback();
    expect(s.core.playPlayback).not.toHaveBeenCalled();
    expect(s.core.setPaperError).toHaveBeenCalledWith("offline");
    expect(s.core.viewChangingRef.current).toBe(false);
  });
});
