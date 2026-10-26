"use client";

import { copy } from "@/lib/i18n";
import { setDisplayInterval } from "@/lib/market-replay/engine";
import type { ReplayState } from "@/lib/market-replay/types";
import type { useReplayCore } from "./use-replay-core";
import type { useReplayDrawingWindow } from "./use-replay-drawing-window";
import type { useReplayEngine } from "./use-replay-engine";

type Core = Pick<ReturnType<typeof useReplayCore>, "latestReplayRef" | "viewChangingRef" | "suspendPlayback"
  | "restorePlayback" | "manualStepsRef" | "advanceCompletionRef" | "playbackAccumulatorRef" | "playbackClockRef"
  | "chartViewportRef" | "chartWindowDetachedRef" | "indicatorWarmupCountRef" | "setReplay" | "setEmaError" | "setPaperError">;
type Dependencies = Pick<ReturnType<typeof useReplayDrawingWindow>, "loadWindow">
  & Pick<ReturnType<typeof useReplayEngine>, "flushVisible" | "queueSave">;

/** Keep chart data on its applied timeline until the complete target window is ready. */
export async function changeReplayDisplayInterval(core: Core, { loadWindow, flushVisible, queueSave }: Dependencies, seconds: number) {
  const { latestReplayRef, viewChangingRef, suspendPlayback, restorePlayback, manualStepsRef, advanceCompletionRef,
    playbackAccumulatorRef, playbackClockRef, chartViewportRef, chartWindowDetachedRef, indicatorWarmupCountRef,
    setReplay, setEmaError, setPaperError } = core;
  if (!latestReplayRef.current || viewChangingRef.current) return false;
  if (latestReplayRef.current.displayIntervalSeconds === seconds) return true;
  viewChangingRef.current = true;
  const suspension = suspendPlayback();
  manualStepsRef.current.cancel();
  let previous: ReplayState | null = null;
  const rollback = () => { if (previous && latestReplayRef.current?.generation === previous.generation) { setReplay(previous); queueSave(previous, true); } };
  try {
    await advanceCompletionRef.current;
    if (!(await flushVisible())) return false;
    const current = latestReplayRef.current;
    if (!current) return false;
    previous = current;
    const viewport = chartViewportRef.current?.capture(current.currentSequence, !chartWindowDetachedRef.current) ?? null;
    const history = viewport?.mode === "history";
    const focus = history ? Math.max(0, Math.min(current.currentSequence, Math.floor(viewport.anchor.sourceSequence ?? current.currentSequence))) : null;
    playbackAccumulatorRef.current = 0;
    playbackClockRef.current = performance.now();
    const next = setDisplayInterval(current, seconds);
    setReplay(next); setEmaError(null); queueSave(next, true);
    const applied = await loadWindow(next.currentSequence, seconds, next.displaySession, indicatorWarmupCountRef.current,
      null, focus, history, null, false, () => latestReplayRef.current?.generation === current.generation, viewport);
    if (!applied) { rollback(); return false; }
    return true;
  } catch (error) {
    rollback();
    setPaperError(error instanceof Error ? error.message : copy.marketReplay.loadError);
    return false;
  } finally {
    viewChangingRef.current = false;
    restorePlayback(suspension);
  }
}
