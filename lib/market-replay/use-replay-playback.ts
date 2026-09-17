"use client";

import { useCallback, useRef, useState, type MutableRefObject } from "react";
import { pauseReplay, playReplay } from "./engine";
import { createPlaybackIntentTracker, type ReplayPauseReason, type ReplaySuspension } from "./playback-lifecycle";
import type { ReplayState } from "./types";

export function useReplayPlayback(
  replayRef: MutableRefObject<ReplayState | null>,
  setReplay: (action: ReplayState | null | ((state: ReplayState | null) => ReplayState | null)) => void,
) {
  const trackerRef = useRef(createPlaybackIntentTracker());
  const [pauseReason, setPauseReason] = useState<ReplayPauseReason | null>(null);

  const play = useCallback(() => {
    trackerRef.current.invalidate();
    setPauseReason(null);
    setReplay((state) => state ? playReplay(state) : state);
  }, [setReplay]);

  const pause = useCallback((reason: ReplayPauseReason) => {
    trackerRef.current.invalidate();
    setPauseReason(reason);
    setReplay((state) => state ? pauseReplay(state) : state);
  }, [setReplay]);

  const suspend = useCallback((reason: ReplayPauseReason = "operation") => {
    const suspension = trackerRef.current.suspend(replayRef.current?.status === "playing");
    if (suspension.wasPlaying) {
      setReplay((state) => state ? pauseReplay(state) : state);
      setPauseReason(reason);
    }
    return suspension;
  }, [replayRef, setReplay]);

  const restore = useCallback((suspension: ReplaySuspension | null | undefined) => {
    if (!suspension || !trackerRef.current.mayResume(suspension)) return false;
    const state = replayRef.current;
    if (!state || state.status !== "paused") return false;
    setPauseReason(null);
    setReplay(playReplay(state));
    return true;
  }, [replayRef, setReplay]);

  const finish = useCallback(() => {
    trackerRef.current.invalidate();
    setPauseReason("finished");
    setReplay((state) => state ? { ...state, status: "finished" } : state);
  }, [setReplay]);

  return { pauseReason, play, pause, suspend, restore, finish };
}
